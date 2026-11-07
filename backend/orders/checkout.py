"""The checkout steps that need no request, response framework state or payment call (review ARC-08).

``OrderCheckoutView`` used to hold all of this inline in one 280-line method. Each function here does one step and
returns ``None`` when the step passes, or a ready-made refusal ``Response`` when it does not, which the view returns
as it is. They *return* the refusal instead of raising it on purpose: the view runs them inside ``transaction.atomic``,
and an exception would roll back work that a refusal must keep (the refreshed price snapshots of ``refuse_stale_prices``).
The order in which the view calls them, and the lock order inside ``reserve_stock`` (listings by pk, then variants by pk),
are part of the contract - see backend/CLAUDE.md."""
from dataclasses import dataclass
from decimal import Decimal
from typing import Any

from django.conf import settings
from django.utils import timezone
from rest_framework import status
from rest_framework.exceptions import ValidationError as DRFValidationError
from rest_framework.response import Response

from accounts.gps import validate_ashanti_gps
from accounts.models import BusinessOwner
from cart import guard as cart_guard
from listings import variants as variants_module
from listings.models import Listing, ListingVariant
from listings.visibility import hidden_business_q
from marketing import checkout as promo_checkout
from marketing import code_guard, promos, waivers

from . import hold
from .models import Order, OrderItem


def _refuse(body, code=status.HTTP_400_BAD_REQUEST):
    return Response(body, status=code)


def refuse_unavailable_listings(items):
    """A line whose listing was dropped, discontinued or unpublished, or whose business is hidden, is refused before any
    stock is touched; the cart is left as it is for the shopper to fix."""
    hidden_ids = set(
        BusinessOwner.objects.filter(
            pk__in={item.listing.business_owner_id for item in items}
        ).filter(hidden_business_q("")).values_list("pk", flat=True)
    )
    for item in items:
        if item.listing.status != Listing.PUBLISHED or item.listing.business_owner_id in hidden_ids:
            return _refuse({"detail": f"“{item.listing.name}” is no longer available. Remove it from your cart.", "code": "listing_unavailable"})
    return None


@dataclass
class Delivery:
    method: str
    address: str
    phone: str
    gps_address: str
    landmark: str


def read_delivery(data):
    """The delivery method and door-to-door address from the request body: ``(Delivery, None)`` or ``(None, refusal)``.
    Defaults to store pickup so an older client that sends no delivery fields still checks out. A GhanaPost digital
    address (Ashanti only) and a landmark are required for door-to-door, checked before any routing call so a refusal
    costs no network round trip; store pickup stores both blank."""
    method = data.get("delivery_method") or Order.STORE_PICKUP
    if method not in dict(Order.DELIVERY_METHOD_CHOICES):
        return None, _refuse({"delivery_method": "Choose door-to-door delivery or store pickup."})
    address = (data.get("delivery_address") or "").strip()
    phone = (data.get("delivery_phone") or "").strip()
    gps_address = landmark = ""
    if method == Order.DOOR_TO_DOOR:
        if not address or not phone:
            return None, _refuse({"detail": "Door-to-door delivery needs a delivery address and phone number."})
        try:
            gps_address = validate_ashanti_gps(data.get("delivery_gps_address"))
        except DRFValidationError as exc:
            return None, _refuse({"delivery_gps_address": [str(m) for m in exc.detail]})
        raw_landmark = data.get("delivery_landmark") or ""
        landmark = raw_landmark.strip() if isinstance(raw_landmark, str) else ""  # a non-string reads as missing
        if not landmark:
            return None, _refuse({"delivery_landmark": ["Add a landmark near your door so the rider can find you."]})
        if len(landmark) > 200:
            return None, _refuse({"delivery_landmark": ["Keep the landmark under 200 characters."]})
    return Delivery(method, address, phone, gps_address, landmark), None


def refuse_stale_prices(items):
    """Review BE-11. A line keeps the price it was added at (ruling R33 re-reads it on add and on a quantity change), so a
    sale that ended or a price a seller raised since would still be charged at the old figure, and a sale that started
    would be missed. Compare with today's price before anything is written; if any line differs, refresh the snapshots and
    ask the shopper to look at the new total and confirm. Nothing but the snapshots is saved by this refusal."""
    changed = []
    variant_listing_ids = set(
        ListingVariant.objects.filter(listing_id__in={i.listing_id for i in items}, is_active=True).values_list("listing_id", flat=True)
    )
    for item in items:
        if item.variant_id is None and item.listing_id in variant_listing_ids:
            continue  # a plain line on a listing that gained variants is refused (choose_variant) in reserve_stock
        current = item.variant.effective_price if item.variant_id else item.listing.effective_price
        if current is not None and current != item.unit_price_snapshot:
            changed.append({
                "listing": item.listing_id, "name": item.listing.name,
                "was": str(item.unit_price_snapshot), "now": str(current),
            })
            item.unit_price_snapshot = current
            item.save(update_fields=["unit_price_snapshot"])
    if changed:
        return _refuse(
            {"detail": "Some prices changed since you added them. Check your cart total and confirm again.",
             "code": "price_changed", "changes": changed},
            status.HTTP_409_CONFLICT,
        )
    return None


def reserve_stock(items):
    """Check the whole cart's stock under row locks, then decrement it: ``(reservations, None)`` or ``(None, refusal)``.

    Stock is reserved at checkout, not at payment; ``payments.services._fail_order_checkout`` puts it back if the payment
    fails or expires. A listing with ``stock_quantity=None`` is untracked and never decremented. Variant lines reserve
    from the variant's own stock. Locks are taken in one global order, every Listing row by primary key and then every
    ListingVariant row by primary key, so two checkouts can never wait on each other; the stock is checked for the whole
    cart before anything is decremented. Must be called inside ``transaction.atomic``."""
    locked = {
        row.pk: row
        for row in Listing.objects.select_for_update().filter(pk__in={i.listing_id for i in items}).order_by("pk")
    }
    locked_variants = {
        row.pk: row
        for row in ListingVariant.objects.select_for_update()
        .filter(pk__in={i.variant_id for i in items if i.variant_id}).order_by("pk")
    }
    with_variants = set(
        ListingVariant.objects.filter(listing_id__in=locked, is_active=True).values_list("listing_id", flat=True)
    )
    for item in items:
        if item.variant_id is None and item.listing_id in with_variants:
            # A plain line from before the listing gained variants: its stock is the derived total, so refuse.
            return None, _refuse({
                "detail": f"Choose an option for “{locked[item.listing_id].name}”: remove it from your cart and add it again.",
                "code": "choose_variant",
            })
    for item in items:
        listing = locked[item.listing_id]
        if listing.status != Listing.PUBLISHED:  # taken down or dropped since the earlier check: re-read under the lock
            return None, _refuse({"detail": f"“{listing.name}” is no longer available. Remove it from your cart.", "code": "listing_unavailable"})
        if item.variant_id is None:
            if listing.stock_quantity is not None and listing.stock_quantity < item.quantity:
                return None, _refuse({"detail": f"Only {listing.stock_quantity} of “{listing.name}” left in stock."})
            continue
        variant = locked_variants.get(item.variant_id)
        if variant is None or not variant.is_active:
            return None, _refuse({
                "detail": f"“{listing.name} ({item.variant.label})” is no longer available. Remove it from your cart.",
                "code": "listing_unavailable",
            })
        if variant.stock_quantity is not None and variant.stock_quantity < item.quantity:
            return None, _refuse({"detail": f"Only {variant.stock_quantity} of “{listing.name} ({variant.label})” left in stock."})
    reservations = []
    touched = {}
    for item in items:
        listing = locked[item.listing_id]
        if item.variant_id is None:
            if listing.stock_quantity is not None:
                listing.stock_quantity -= item.quantity
                listing.save(update_fields=["stock_quantity"])
                reservations.append({"listing_id": listing.id, "quantity": item.quantity})
            continue
        variant = locked_variants[item.variant_id]
        if variant.stock_quantity is not None:
            variant.stock_quantity -= item.quantity
            variant.save(update_fields=["stock_quantity"])
            reservations.append({"listing_id": listing.id, "variant_id": variant.id, "quantity": item.quantity})
        touched[listing.pk] = listing
    for listing in touched.values():
        variants_module.sync_listing(listing)
    return reservations, None


@dataclass
class Route:
    """The door-to-door route plan and the delivery fee quoted for it (both ``None`` for store pickup / fees off)."""

    plan: Any = None
    quoted: Any = None  # (rate card, fee breakdown) from delivery.rates.checkout_fee


def plan_route(items, data, delivery_method):
    """Door-to-door only: the service-area and pin checks, the pickup route and the delivery fee: ``(Route, None)`` or
    ``(None, refusal)``. The route and fee may call the road-routing service (a network round trip), so the view runs this
    before the transaction opens: it needs no row lock and must not hold a database transaction open while it waits."""
    if delivery_method != Order.DOOR_TO_DOOR:
        return Route(), None
    from delivery.rates import PIN_REQUIRED_MESSAGE, checkout_fee, pin_required
    from delivery.stops import plan_with_distances
    from routing import region

    lat, lng = data.get("delivery_lat"), data.get("delivery_lng")
    if lat not in (None, "") and lng not in (None, "") and not region.in_service_area(lat, lng):
        return None, _refuse({"detail": region.OUT_OF_AREA_MESSAGE, "code": "out_of_area"})
    if pin_required(lat, lng):
        return None, _refuse({"delivery_lat": [PIN_REQUIRED_MESSAGE]})
    plan, distances = plan_with_distances(items, lat, lng)
    try:
        # The food radius from the planner's own table: no second routing call (cart.guard.check_food_radius).
        cart_guard.check_food_radius(items, distances=distances)
    except cart_guard.GuardError as exc:
        return None, _refuse(exc.body())
    quoted = checkout_fee(items, lat, lng, plan=plan) if settings.DELIVERY_FEE_ENABLED else None
    return Route(plan, quoted), None


def price_promotions(request, items, delivery):
    """Checkout promotions (marketing): off unless ``settings.MARKETING_PROMOS_ENABLED``; then priced before anything is
    reserved or written, under the flash-sale and coupon row locks. Returns ``(promo, None)`` (``promo`` is ``None`` with
    the switch off) or ``(None, refusal)``. Must be called inside ``transaction.atomic``."""
    if not promos.enabled():
        return None, None
    if promo_checkout.normalise_code(request.data.get("coupon_code")) and code_guard.blocked(request):
        return None, _refuse({"detail": code_guard.TOO_MANY}, status.HTTP_429_TOO_MANY_REQUESTS)
    try:
        promo = promo_checkout.price(
            request.user, items, request.data.get("coupon_code"), lock=True,
            delivery_phone=delivery.phone if delivery.method == Order.DOOR_TO_DOOR else "",
        )
    except promo_checkout.PromoError as exc:
        code_guard.record_failure(request)
        return None, _refuse({"detail": exc.message})
    return promo, None


@dataclass
class Pricing:
    total: Decimal
    fee_card: Any = None
    fee_quote: Any = None  # the breakdown stored on the order, net of any waiver
    charged: Any = None  # the delivery fee actually charged
    waiver: Any = None


def price_order(items, promo, route):
    """The order total: the cart (or the promo's total, net of any coupon) plus the delivery fee from the rate card in
    force. The fee is fixed here, on the order; later card changes never touch it. A live free-delivery promo covering
    every line waives the fee (the original amount stays in the breakdown); an AshantiHub-funded promo waives it only when
    the fee fits in its budget cap, decided under the promo's row lock (a hard cap: concurrent checkouts wait)."""
    total = promo.total if promo else sum((i.unit_price_snapshot * i.quantity for i in items), Decimal("0.00"))
    pricing = Pricing(total)
    if route.quoted is not None:
        pricing.fee_card, fee_quote = route.quoted
        pricing.waiver = waivers.covering_waiver([i.listing for i in items], timezone.now(), fee=fee_quote["total"], lock=True)
        pricing.charged, pricing.fee_quote = waivers.apply_to_fee(pricing.waiver, fee_quote)
        pricing.total += pricing.charged
    return pricing


def create_order(user, data, items, delivery, route, pricing, promo, request_id):
    """Write the order, its lines, any fee-waiver charge and any coupon redemption. Must be called inside
    ``transaction.atomic``, after ``reserve_stock``."""
    door = delivery.method == Order.DOOR_TO_DOOR
    fee_quote = pricing.fee_quote
    order = Order.objects.create(
        customer=user, status=Order.PENDING, total_amount=pricing.total, ready_not_before=hold.for_items(items),
        delivery_fee=pricing.charged if fee_quote else None, delivery_fee_breakdown=fee_quote, rate_card=pricing.fee_card,
        route_plan=route.plan,
        **(promo.order_extras() if promo else {}),
        delivery_method=delivery.method,
        delivery_address=delivery.address if door else "",
        delivery_phone=delivery.phone if door else "",
        delivery_gps_address=delivery.gps_address, delivery_landmark=delivery.landmark,
        delivery_lat=data.get("delivery_lat") if door else None,
        delivery_lng=data.get("delivery_lng") if door else None,
        request_id=request_id,
    )
    if pricing.waiver is not None and fee_quote and fee_quote.get("waived"):
        waivers.record_charge(order, pricing.waiver, Decimal(fee_quote["waived"]["amount"]))
    if promo:
        promo_checkout.create_lines(order, promo)
        promo_checkout.record_redemption(order, promo, user)
    else:
        for item in items:
            OrderItem.objects.create(
                order=order, listing=item.listing, variant=item.variant,
                variant_label=item.variant.label if item.variant_id else "",
                quantity=item.quantity, unit_price=item.unit_price_snapshot,
                line_total=item.unit_price_snapshot * item.quantity,
            )
    return order
