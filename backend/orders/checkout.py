"""The checkout steps that need no request, response framework state or payment call (review ARC-08).

``OrderCheckoutView`` used to hold all of this inline in one 280-line method. Each function here does one step and
returns ``None`` when the step passes, or a ready-made refusal ``Response`` when it does not, which the view returns
as it is. They *return* the refusal instead of raising it on purpose: the view runs them inside ``transaction.atomic``,
and an exception would roll back work that a refusal must keep (the refreshed price snapshots of ``refuse_stale_prices``).
The order in which the view calls them, and the lock order inside ``reserve_stock`` (listings by pk, then variants by pk),
are part of the contract - see backend/CLAUDE.md."""
from dataclasses import dataclass

from rest_framework import status
from rest_framework.exceptions import ValidationError as DRFValidationError
from rest_framework.response import Response

from accounts.gps import validate_ashanti_gps
from accounts.models import BusinessOwner
from listings import variants as variants_module
from listings.models import Listing, ListingVariant
from listings.visibility import hidden_business_q

from .models import Order


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
