"""The shop-aware cart guard (spec 2026-10-14, section 5). A delivery cart holds products and food only (services are
requested and stays booked through their own flows), from at most max_shops_per_delivery businesses, of which at most
max_food_shops sell food. The food radius is one invariant: every food shop in a cart of two or more shops has another
cart shop within near_shop_radius_km (a cart's only shop needs none). Limits come from
delivery.config.effective_cart_limits() (the live rate card, else the built-in defaults, named so).

Add-to-cart refuses what the add would break: a new food place with no cart shop in reach, a new shop next to a cart
whose only shop sells food and is out of reach, and food from a shop already in the cart that has no other cart shop
in reach. Door-to-door checkout checks the whole invariant again (a cart may predate the rule, a shop may have been
removed, or the radius lowered), with the route planner's own distance table, never a second routing call. The shop and
food limits bind a door-to-door checkout only (a store pickup has no rider); the service/stay rule binds every checkout.
A shop or food place whose distance cannot be measured (no location) is refused as `food_unlocated`; a distance that is
the straight-line estimate is said to be one. Search uses the same context to put the cart's shops first, then shops
near them (road km, labelled when estimated), then everyone else. Nothing here deletes a cart row."""
import math
from decimal import Decimal

from django.core.cache import cache
from django.db.models import Q
from django.utils import timezone

from delivery import config
from delivery.services import valid_point
from delivery.stops import shop_entries
from field.services import business_pin, haversine_m
from listings.models import Category, Listing
from listings.visibility import hidden_business_q
from orders.models import Order
from routing import service as routing_service

PRODUCT, FOOD, SERVICE, STAY, EVENT = "product", "food", "service", "stay", "event"
DELIVERABLE = (PRODUCT, FOOD)
NOT_DELIVERABLE, SHOP_LIMIT, FOOD_LIMIT, FOOD_FAR, FOOD_UNLOCATED = "not_deliverable", "shop_limit", "food_limit", "food_far", "food_unlocated"
SERVICE_STAY_MESSAGE = "Services are requested separately, and stays are booked separately."
FOOD_UNLOCATED_MESSAGE = "This food place has no location on the map yet, so it cannot join a delivery with other shops."
CART_UNLOCATED_MESSAGE = "The shops in your cart have no location on the map yet, so food cannot be added to the same delivery."
FOOD_IN_CART_UNLOCATED_MESSAGE = "The food place in your cart has no location on the map yet, so no other shop can join the same delivery."
SHOP_UNLOCATED_MESSAGE = "This shop has no location on the map yet, so it cannot join a delivery with the food place in your cart."
NO_FOOD_MESSAGE = "Deliveries cannot include food at the moment."
CHECKOUT_ACTION = "Remove it to check out."
NEAR_TTL_S = 60
KM_PER_DEGREE = 111.0  # a little under the true 111.2, so the bounding box is never smaller than the circle


class GuardError(Exception):
    def __init__(self, message, code):
        super().__init__(message)
        self.message, self.code = message, code

    def body(self):
        return {"detail": self.message, "code": self.code}


def kind_of(listing):
    """What a listing is to the cart: "stay" (accommodation), "food" (an is_food category), "product", "event" or
    "service". Reads listing.category."""
    return kind_of_category(listing.category)


def kind_of_category(category):
    """`kind_of` for a Category (a listing's, or one a form is about to give it)."""
    if category.is_accommodation:
        return STAY
    if category.is_food:
        return FOOD
    if category.kind == Category.PRODUCT:
        return PRODUCT
    return EVENT if category.kind == Category.EVENT else SERVICE


def deliverable_q(prefix=""):
    """Listings a delivery cart may hold (kind_of in DELIVERABLE): food or a product, never a stay."""
    return Q(**{f"{prefix}category__is_accommodation": False}) & (
        Q(**{f"{prefix}category__is_food": True}) | Q(**{f"{prefix}category__kind": Category.PRODUCT})
    )


# ── Messages ───────────────────────────────────────────────────────────────────────────────────
def _plural(n, word):
    return f"{n} {word}{'' if n == 1 else 's'}"


def shop_limit_message(limits, action="Remove one to add this."):
    return f"Your delivery can include up to {_plural(limits['max_shops_per_delivery'], 'shop')}. {action}"


def food_limit_message(limits, action="Remove one to add this."):
    if limits["max_food_shops"] == 0:
        return NO_FOOD_MESSAGE
    return f"Your delivery can include food from up to {_plural(limits['max_food_shops'], 'place')}. {action}"


def _radius_text(limits):
    return f"{Decimal(limits['near_shop_radius_km']).normalize():f}"


def _about(km, radius):
    """km to one decimal, or two when one decimal would round it down to the radius it is beyond."""
    text = f"{km:.1f}"
    return text if float(text) > radius else f"{km:.2f}"


def _far_message(limits, measured, subject, place, but):
    """`subject` is too far from `place`. "more than R km" only when that is known: a road distance, or a straight line
    already beyond the radius (measured None). An estimated distance is given as "about X km (estimate)"."""
    radius = _radius_text(limits)
    if measured is not None and measured["basis"] != routing_service.BASIS_ROAD:
        about = _about(measured["km"], float(limits["near_shop_radius_km"]))
        return f"{subject} is about {about} km (estimate) from {place}, beyond the {radius} km one rider can collect from on the same trip."
    return f"{subject} is more than {radius} km from {place}, so one rider cannot collect {but} on the same trip."


def food_far_message(limits, measured=None):
    return _far_message(limits, measured, "This food place", "the shops in your cart", "it")


def shop_far_message(limits, measured=None):
    return _far_message(limits, measured, "This shop", "the food place in your cart", "both")


def _checkout_far_message(limits, measured, name):
    return f"{_far_message(limits, measured, f'Food from {name}', 'the other shops in your cart', 'it')} {CHECKOUT_ACTION}"


# ── Where businesses are, and how far apart ─────────────────────────────────────────────────────
def _listing_point(listing):
    """Where a listing's business is: its pin, else the listing's own location; None when neither is known."""
    pin = business_pin(listing.business_owner)
    pin = valid_point(*pin) if pin else None
    return pin or valid_point(listing.lat, listing.lng)


def _box(located, radius):
    """A Q keeping listings whose business pin or own location lies in a box around any located cart shop (a superset of
    the radius circle), so the near-shop map never reads every listing on the marketplace."""
    box = Q()
    for shop in located:
        dlat = radius / KM_PER_DEGREE
        dlng = radius / (KM_PER_DEGREE * max(math.cos(math.radians(shop["lat"])), 0.01))
        bounds = [Decimal(str(round(v, 6))) for v in (shop["lat"] - dlat, shop["lat"] + dlat, shop["lng"] - dlng, shop["lng"] + dlng)]
        for prefix in ("business_owner__profile__", ""):
            box |= Q(**{f"{prefix}lat__gte": bounds[0], f"{prefix}lat__lte": bounds[1], f"{prefix}lng__gte": bounds[2], f"{prefix}lng__lte": bounds[3]})
    return box


def _crow_km(point, shops):
    """Straight-line km from `point` to the nearest of `shops` (located)."""
    return min(haversine_m(s["lat"], s["lng"], point[0], point[1]) for s in shops) / 1000


def _candidates(located, radius):
    """{owner id: (lat, lng)} for every visible business with a deliverable published listing near a located cart shop,
    except the located cart shops themselves (measured from their own cart points). A business is placed at its pin,
    else at its located listing nearest the cart, so a listing within reach always puts its business in the map.
    Depends on nothing but `located` and `radius`, which is exactly the near-map cache key. One query."""
    rows = (Listing.objects.filter(status=Listing.PUBLISHED).filter(deliverable_q()).filter(_box(located, radius))
            .exclude(hidden_business_q()).exclude(business_owner_id__in=[s["key"] for s in located])
            .select_related("business_owner__profile").order_by("business_owner_id", "pk"))
    points = {}
    for listing in rows:
        point = _listing_point(listing)
        if point is None:
            continue
        point, oid = (float(point[0]), float(point[1])), listing.business_owner_id
        if oid not in points or _crow_km(point, located) < _crow_km(points[oid], located):
            points[oid] = point
    return points


def _located(shops):
    return sorted((s for s in shops if s["lat"] is not None), key=lambda s: s["key"])


def _near_key(located, radius):
    return "cartguard:near:%s:%s" % (radius, "|".join(f"{s['key']}@{s['lat']:.5f},{s['lng']:.5f}" for s in located))


def near_map(shops, limits):
    """See _near_map (without the time it was measured)."""
    return _near_map(shops, limits)[1]


def _near_map(shops, limits, *, refresh=False):
    """{owner id: {"km", "basis", "from_id", "from_name", "near"}}: for every business within the radius as the crow flies
    of a located cart shop other than itself, the nearest such cart shop by road (or by the labelled estimate: `basis`
    says which, cell by cell), and whether that is within the radius. The located cart shops are in it too, measured
    against the OTHER cart shops (for the food radius invariant); readers that want other businesses drop the cart's
    ids. A road is never shorter than the straight line, so a business missing from the map is beyond the radius for
    certain, as of the time it was measured (returned with it: (measured_at, map)). One routing table
    (routing.service.legs_between), cached for NEAR_TTL_S per located-shop set and radius; refresh=True measures again."""
    radius = float(limits["near_shop_radius_km"])
    located = _located(shops)
    if not located:
        return None, {}
    key = _near_key(located, radius)
    cached = None if refresh else cache.get(key)
    if cached is not None:
        return cached
    at = timezone.now()  # before reading: a listing saved after this is newer than the map
    points = _candidates(located, radius)
    points.update({s["key"]: (s["lat"], s["lng"]) for s in located})
    crow = {}
    for oid, point in points.items():
        apart = [haversine_m(s["lat"], s["lng"], point[0], point[1]) / 1000 for s in located if s["key"] != oid]
        if apart and min(apart) <= radius:
            crow[oid] = (point, min(apart))
    order = sorted(crow, key=lambda oid: (crow[oid][1], oid))
    out = {}
    if order:
        table = routing_service.legs_between([crow[oid][0] for oid in order], [(s["lat"], s["lng"]) for s in located])
        for oid, row in zip(order, table):
            for shop, got in zip(located, row):
                km = float(got["distance_km"])
                if shop["key"] != oid and (oid not in out or km < out[oid]["km"]):
                    out[oid] = {"km": km, "basis": got["basis"], "from_id": shop["key"], "from_name": shop["name"]}
    for entry in out.values():
        entry["km"] = round(entry["km"], 2)
        entry["near"] = entry["km"] <= radius
    cache.set(key, (at, out), NEAR_TTL_S)
    return at, out


def cached_near_map(shops, limits):
    """The near-shop map if it is in the cache now, else None. Never measures."""
    located = _located(shops)
    if not located:
        return {}
    cached = cache.get(_near_key(located, float(limits["near_shop_radius_km"])))
    return cached[1] if cached is not None else None


# ── The guard's view of a cart ─────────────────────────────────────────────────────────────────
def context(lines, *, limits=None):
    """What the guard knows about a cart: its shops (stops.shop_entries over the deliverable lines: a service or stay row
    left from before the guard is no pickup, and checkout refuses it anyway), the limits, the listings in it and (lazily,
    see measured/near) how far businesses are from its shops. `lines` need listing__business_owner__profile and
    listing__category."""
    limits = limits or config.effective_cart_limits()
    shops = shop_entries([line for line in lines if kind_of(line.listing) in DELIVERABLE])
    return {
        "limits": limits, "shops": shops, "ids": {s["key"] for s in shops}, "food_ids": {s["key"] for s in shops if s["food"]},
        "listing_ids": {line.listing_id for line in lines}, "measured": None, "measured_at": None, "near": None,
    }


def measured(ctx, *, newer_than=None):
    """The near-shop map for this cart (measured once, then cached). `newer_than`: a listing's updated_at; a cached map
    measured before it cannot know that listing, so it is measured again (once: the new map is newer than the listing)."""
    stale = newer_than is not None and ctx["measured_at"] is not None and newer_than > ctx["measured_at"]
    if ctx["measured"] is None or stale:
        ctx["measured_at"], ctx["measured"] = _near_map(ctx["shops"], ctx["limits"], refresh=stale)
        ctx["near"] = {oid: e for oid, e in ctx["measured"].items() if e["near"] and oid not in ctx["ids"]}
    return ctx["measured"]


def near(ctx):
    """{owner id: entry} for the businesses within the radius of the cart, the cart's own businesses left out."""
    measured(ctx)
    return ctx["near"]


def _radius_reason(ctx, listing, kind):
    """What adding `listing` would break in the food radius invariant, as (message, code), else None."""
    shops, owner = ctx["shops"], listing.business_owner_id
    if not shops:
        return None
    limits = ctx["limits"]
    if owner not in ctx["ids"]:
        lone_food = shops[0] if len(shops) == 1 and shops[0]["food"] else None
        if kind != FOOD and lone_food is None:
            return None
        if kind == FOOD and not any(s["lat"] is not None for s in shops):
            return CART_UNLOCATED_MESSAGE, FOOD_UNLOCATED
        if kind != FOOD and lone_food["lat"] is None:
            return FOOD_IN_CART_UNLOCATED_MESSAGE, FOOD_UNLOCATED
        point = _listing_point(listing)
        if point is None:
            return (FOOD_UNLOCATED_MESSAGE if kind == FOOD else SHOP_UNLOCATED_MESSAGE), FOOD_UNLOCATED
        far = food_far_message if kind == FOOD else shop_far_message
        if _crow_km((float(point[0]), float(point[1])), [s for s in shops if s["lat"] is not None]) > float(limits["near_shop_radius_km"]):
            return far(limits), FOOD_FAR  # beyond reach in a straight line: no need to measure
        mapped = measured(ctx)
        if owner not in mapped:
            mapped = measured(ctx, newer_than=listing.updated_at)  # the map may predate this listing
        entry = mapped.get(owner)
        if entry is not None and entry["near"]:
            return None
        return far(limits, entry), FOOD_FAR
    if kind != FOOD or owner in ctx["food_ids"] or len(shops) == 1:
        return None
    # A shop already in the cart starts selling food to it: it now needs another cart shop within the radius.
    shop = next(s for s in shops if s["key"] == owner)
    if shop["lat"] is None:
        return FOOD_UNLOCATED_MESSAGE, FOOD_UNLOCATED
    others = [s for s in shops if s["key"] != owner and s["lat"] is not None]
    if not others:
        return CART_UNLOCATED_MESSAGE, FOOD_UNLOCATED
    if _crow_km((shop["lat"], shop["lng"]), others) > float(limits["near_shop_radius_km"]):
        return food_far_message(limits), FOOD_FAR
    entry = measured(ctx).get(owner)
    if entry is not None and entry["near"]:
        return None
    return food_far_message(limits, entry), FOOD_FAR


def blocked_reason(ctx, listing):
    """None when `listing` may join this cart now, else (message, code)."""
    kind = kind_of(listing)
    if kind not in DELIVERABLE:
        return SERVICE_STAY_MESSAGE, NOT_DELIVERABLE
    limits, owner_id = ctx["limits"], listing.business_owner_id
    if owner_id not in ctx["ids"] and len(ctx["ids"]) >= limits["max_shops_per_delivery"]:
        return shop_limit_message(limits), SHOP_LIMIT
    if kind == FOOD and owner_id not in ctx["food_ids"] and len(ctx["food_ids"]) >= limits["max_food_shops"]:
        return food_limit_message(limits), FOOD_LIMIT
    return _radius_reason(ctx, listing, kind)


def check_add(lines, listing):
    reason = blocked_reason(context(lines), listing)
    if reason:
        raise GuardError(*reason)


def check_checkout(lines, delivery_method, *, ctx=None):
    """Refuse a cart that cannot be checked out: any service or stay line (every method), or more shops or food places
    than one delivery allows (door-to-door only: a store pickup has no rider). Measures nothing (the food radius is
    check_food_radius, once the route is planned). Nothing is removed from the cart."""
    if any(kind_of(line.listing) not in DELIVERABLE for line in lines):
        raise GuardError(f"{SERVICE_STAY_MESSAGE} Remove them from your cart to check out.", NOT_DELIVERABLE)
    if delivery_method != Order.DOOR_TO_DOOR:
        return
    ctx = ctx or context(lines)
    limits = ctx["limits"]
    extra = len(ctx["ids"]) - limits["max_shops_per_delivery"]
    if extra > 0:
        raise GuardError(shop_limit_message(limits, f"Your cart has {len(ctx['ids'])}. Remove {extra} to check out."), SHOP_LIMIT)
    extra = len(ctx["food_ids"]) - limits["max_food_shops"]
    if extra > 0:
        message = (f"{NO_FOOD_MESSAGE} Remove the food from your cart to check out." if limits["max_food_shops"] == 0
                   else food_limit_message(limits, f"Your cart has {len(ctx['food_ids'])}. Remove {extra} to check out."))
        raise GuardError(message, FOOD_LIMIT)


def _gap(ctx, shop, others, radius, *, distances, measure):
    """(near, measured) for one located food shop against the other located cart shops: from the planner's table when
    given, else the near-shop map (measured now only when `measure`, else only if cached), else the straight line, which
    can only prove a shop too far. `measured` is {"km", "basis"} of the nearest one, or None when the verdict is the
    straight line beyond the radius (certain) or no measurement exists."""
    if _crow_km((shop["lat"], shop["lng"]), others) > radius:
        return False, None
    table = (distances or {}).get("km") or {}
    if shop["key"] in table and all(o["key"] in table for o in others):
        km = min(min(table[shop["key"]].get(o["key"], math.inf), table[o["key"]].get(shop["key"], math.inf)) for o in others)
        return km <= radius, {"km": km, "basis": distances["basis"]}
    mapped = measured(ctx) if measure else cached_near_map(ctx["shops"], ctx["limits"])
    if mapped is None:
        return True, None  # nothing measured and the straight line is within reach: not refused on a guess
    entry = mapped.get(shop["key"])
    return (entry is not None and entry["near"]), entry


def check_food_radius(lines, *, distances=None, ctx=None, measure=False):
    """Door-to-door checkout: every food shop in a cart of two or more shops must have another cart shop within the
    radius. `distances` is the route planner's shop-to-shop table (stops.plan_with_distances), so checkout asks the
    routing service nothing more; without it the cached near-shop map, else the straight line. A food shop, or a cart
    whose other shops, cannot be placed on the map is refused as food_unlocated. Nothing is removed from the cart."""
    ctx = ctx or context(lines)
    shops, limits = ctx["shops"], ctx["limits"]
    if len(shops) < 2:
        return
    radius = float(limits["near_shop_radius_km"])
    for shop in (s for s in shops if s["food"]):
        if shop["lat"] is None:
            raise GuardError(f"{shop['name']} has no location on the map yet, so its food cannot be collected with the other "
                             f"shops in your cart. {CHECKOUT_ACTION}", FOOD_UNLOCATED)
        others = [s for s in shops if s["key"] != shop["key"] and s["lat"] is not None]
        if not others:
            raise GuardError(f"The other shops in your cart have no location on the map yet, so food from {shop['name']} "
                             f"cannot be collected on the same trip. {CHECKOUT_ACTION}", FOOD_UNLOCATED)
        within, entry = _gap(ctx, shop, others, radius, distances=distances, measure=measure)
        if not within:
            raise GuardError(_checkout_far_message(limits, entry, shop["name"]), FOOD_FAR)


def _blocked(fn):
    try:
        fn()
    except GuardError as exc:
        return exc.body()
    return None


def _door_to_door(lines, ctx):
    check_checkout(lines, Order.DOOR_TO_DOOR, ctx=ctx)
    check_food_radius(lines, ctx=ctx, measure=True)


def summary(lines, listing=None):
    """GET /api/cart/guard/: the cart's shops, the limits (with their source), whether checkout is blocked and why, and
    optionally whether one listing may be added now."""
    ctx = context(lines)
    limits = ctx["limits"]
    out = {
        "active": bool(lines), "limits": config.limits_json(limits),
        "shops": [{"id": s["key"], "name": s["name"], "food": s["food"]} for s in ctx["shops"]],
        "food_shops": len(ctx["food_ids"]),
        "at_shop_limit": len(ctx["ids"]) >= limits["max_shops_per_delivery"],
        "at_food_limit": len(ctx["food_ids"]) >= limits["max_food_shops"],
        "checkout": {"any": _blocked(lambda: check_checkout(lines, Order.STORE_PICKUP, ctx=ctx)),
                     "door_to_door": _blocked(lambda: _door_to_door(lines, ctx))},
    }
    if listing is not None:
        reason = blocked_reason(ctx, listing)
        out["listing"] = {"id": listing.pk, "blocked": {"detail": reason[0], "code": reason[1]} if reason else None}
    return out
