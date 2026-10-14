"""The shop-aware cart guard (spec 2026-10-14, section 5). A delivery cart holds products and food only (services are
requested and stays booked through their own flows), from at most max_shops_per_delivery businesses, of which at most
max_food_shops sell food, and a new food place must be within near_shop_radius_km of a business already in the cart.
Limits come from delivery.config.effective_cart_limits() (the live rate card, else the built-in defaults, named so).
Search uses the same context to put the cart's shops first, then shops near them (road km, labelled when estimated),
then everyone else. The shop and food limits bind a door-to-door checkout only (a store pickup has no rider); the
service/stay rule binds every checkout. Nothing here deletes a cart row."""
import math
from decimal import Decimal

from django.core.cache import cache
from django.db.models import Q

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
NO_FOOD_MESSAGE = "Deliveries cannot include food at the moment."
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
    category = listing.category
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


def _plural(n, word):
    return f"{n} {word}{'' if n == 1 else 's'}"


def shop_limit_message(limits, action="Remove one to add this."):
    return f"Your delivery can include up to {_plural(limits['max_shops_per_delivery'], 'shop')}. {action}"


def food_limit_message(limits, action="Remove one to add this."):
    if limits["max_food_shops"] == 0:
        return NO_FOOD_MESSAGE
    return f"Your delivery can include food from up to {_plural(limits['max_food_shops'], 'place')}. {action}"


def food_far_message(limits):
    km = f"{Decimal(limits['near_shop_radius_km']).normalize():f}"
    return f"This food place is more than {km} km from the shops in your cart, so one rider cannot collect it on the same trip."


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


def _candidates(located, radius, exclude):
    """{owner id: (lat, lng)} for every visible business with a deliverable published listing near a located cart shop,
    the cart's own businesses left out. One query."""
    rows = (Listing.objects.filter(status=Listing.PUBLISHED).filter(deliverable_q()).filter(_box(located, radius))
            .exclude(hidden_business_q()).exclude(business_owner_id__in=exclude)
            .select_related("business_owner__profile").order_by("business_owner_id", "pk"))
    points = {}
    for listing in rows:
        if points.get(listing.business_owner_id) is None:
            points[listing.business_owner_id] = _listing_point(listing)
    return {k: (float(v[0]), float(v[1])) for k, v in points.items() if v is not None}


def near_map(shops, limits):
    """{owner id: {"km", "basis", "from_id", "from_name"}} for every business within the radius (road km, or the labelled
    estimate) of any located cart shop, the nearest cart shop winning; cart shops are left out. A road is never shorter
    than the straight line, so only businesses within the radius as the crow flies are measured, nearest first, in ONE
    routing table (routing.service.legs_between). Cached for NEAR_TTL_S per cart-shop set and radius."""
    radius = float(limits["near_shop_radius_km"])
    located = sorted((s for s in shops if s["lat"] is not None), key=lambda s: s["key"])
    if not located:
        return {}
    key = "cartguard:near:%s:%s" % (radius, "|".join(f"{s['key']}@{s['lat']:.5f},{s['lng']:.5f}" for s in located))
    cached = cache.get(key)
    if cached is not None:
        return cached
    crow = {}
    for oid, point in _candidates(located, radius, {s["key"] for s in shops}).items():
        nearest = min(haversine_m(s["lat"], s["lng"], point[0], point[1]) for s in located) / 1000
        if nearest <= radius:
            crow[oid] = (point, nearest)
    order = sorted(crow, key=lambda oid: (crow[oid][1], oid))
    out = {}
    if order:
        table = routing_service.legs_between([crow[oid][0] for oid in order], [(s["lat"], s["lng"]) for s in located])
        for oid, row in zip(order, table):
            for shop, got in zip(located, row):
                km = float(got["distance_km"])
                if km <= radius and (oid not in out or km < out[oid]["km"]):
                    out[oid] = {"km": km, "basis": got["basis"], "from_id": shop["key"], "from_name": shop["name"]}
    for entry in out.values():
        entry["km"] = round(entry["km"], 2)
    cache.set(key, out, NEAR_TTL_S)
    return out


def context(lines, *, limits=None):
    """What the guard knows about a cart: its shops (stops.shop_entries over the deliverable lines: a service or stay row
    left from before the guard is no pickup, and checkout refuses it anyway), the limits, the listings in it and (lazily,
    see near) the businesses near its shops. `lines` need listing__business_owner__profile and listing__category."""
    limits = limits or config.effective_cart_limits()
    shops = shop_entries([line for line in lines if kind_of(line.listing) in DELIVERABLE])
    return {
        "limits": limits, "shops": shops, "ids": {s["key"] for s in shops}, "food_ids": {s["key"] for s in shops if s["food"]},
        "listing_ids": {line.listing_id for line in lines}, "near": None,
    }


def near(ctx):
    if ctx["near"] is None:
        ctx["near"] = near_map(ctx["shops"], ctx["limits"])
    return ctx["near"]


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
    if kind == FOOD and ctx["ids"] and owner_id not in ctx["ids"] and owner_id not in near(ctx):
        if not any(s["lat"] is not None for s in ctx["shops"]):
            return CART_UNLOCATED_MESSAGE, FOOD_UNLOCATED
        if _listing_point(listing) is None:
            return FOOD_UNLOCATED_MESSAGE, FOOD_UNLOCATED
        return food_far_message(limits), FOOD_FAR
    return None


def check_add(lines, listing):
    reason = blocked_reason(context(lines), listing)
    if reason:
        raise GuardError(*reason)


def check_checkout(lines, delivery_method, *, ctx=None):
    """Refuse a cart that cannot be checked out: any service or stay line (every method), or more shops or food places
    than one delivery allows (door-to-door only: a store pickup has no rider). Nothing is removed from the cart."""
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


def _blocked(fn):
    try:
        fn()
    except GuardError as exc:
        return exc.body()
    return None


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
                     "door_to_door": _blocked(lambda: check_checkout(lines, Order.DOOR_TO_DOOR, ctx=ctx))},
    }
    if listing is not None:
        reason = blocked_reason(ctx, listing)
        out["listing"] = {"id": listing.pk, "blocked": {"detail": reason[0], "code": reason[1]} if reason else None}
    return out
