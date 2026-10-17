"""Offers of one catalogue product (catalogue plan 6; spec §10). Each business's listing is its own offer (own price,
stock, cart line, fee and pickup); nothing here adds anything to a cart.

* A live offer is published, from a business public browse shows (listings.visibility), priced, and in stock: an
  uncounted stock (null) counts as in stock, zero hides the offer (spec §1 row 15).
* The featured offer is the lowest price among live offers from KYC-verified businesses. A tie goes to the shop nearest
  the customer when the app sends the customer's position (?lat=&lng=; a straight-line measure from the business pin,
  used only to order and never shown), then to the oldest offer.
* An offer row never carries a phone number, email, address, map pin or the listing's contact_phone: businesses are
  never contacted directly (CLAUDE.md). The business shows by its display name only. A stock the business does not
  count is null, never a guess."""
from django.db.models import Q

from accounts.models import BusinessOwner
from field.services import business_pin, haversine_m
from listings.models import Listing
from listings.visibility import hidden_business_q

from .models import product_row

PRICE, AVAILABILITY = "price", "availability"


def in_stock_q(prefix=""):
    """Listings with something left. `prefix` is the path to the Listing, ending "__", or ""."""
    return Q(**{f"{prefix}stock_quantity__isnull": True}) | Q(**{f"{prefix}stock_quantity__gt": 0})


def live_q(prefix=""):
    """Listings a customer may see and buy now (see the module text)."""
    return (
        Q(**{f"{prefix}status": Listing.PUBLISHED, f"{prefix}price_amount__isnull": False})
        & in_stock_q(prefix)
        & ~hidden_business_q(f"{prefix}business_owner__")
    )


def live_offers(product_id):
    return (
        Listing.objects.filter(live_q(), catalogue_product_id=product_id)
        .select_related("business_owner__profile", "zone")
        .order_by("pk")
    )


def position_from(params):
    """(lat, lng) from ?lat=&lng=, or None when either is missing, not a number, or out of range."""
    try:
        lat, lng = float(params.get("lat")), float(params.get("lng"))
    except (TypeError, ValueError):
        return None
    if not (-90 <= lat <= 90 and -180 <= lng <= 180):
        return None
    return lat, lng


def _tie(listing, position):
    pin = business_pin(listing.business_owner) if position is not None else None
    distance = None if pin is None else haversine_m(position[0], position[1], pin[0], pin[1])
    return (distance is None, distance or 0.0, listing.pk)


def featured(offers, position=None):
    """The featured offer among live `offers`, or None when no verified business offers it."""
    verified = [offer for offer in offers if offer.business_owner.kyc_status == BusinessOwner.VERIFIED]
    if not verified:
        return None
    return min(verified, key=lambda offer: (offer.price_amount, *_tie(offer, position)))


def ordered(offers, ordering=PRICE, position=None):
    """Cheapest first, or most available first (an uncounted stock after every counted one); ties as in `featured`."""
    if ordering == AVAILABILITY:
        return sorted(offers, key=lambda offer: (
            offer.stock_quantity is None, -(offer.stock_quantity or 0), offer.price_amount, *_tie(offer, position),
        ))
    return sorted(offers, key=lambda offer: (offer.price_amount, *_tie(offer, position)))


def offer_row(listing):
    return {
        "listing_id": listing.pk, "name": listing.name, "price_amount": str(listing.price_amount),
        "price_unit": listing.price_unit, "condition": listing.condition,
        "business_name": listing.business_owner.display_name,
        "verified": listing.business_owner.kyc_status == BusinessOwner.VERIFIED,
        "zone": listing.zone.name, "available_quantity": listing.stock_quantity,
    }


def other_sellers(listing, params):
    """GET listings/<id>/other-sellers/: the other live offers of `listing`'s product and the featured offer (which may
    be `listing` itself). An ungrouped listing answers an empty list."""
    ordering = AVAILABILITY if params.get("ordering") == AVAILABILITY else PRICE
    product = listing.catalogue_product
    if product is None:
        return {"catalogue_product": None, "featured_offer_id": None, "ordering": ordering, "offers": []}
    position = position_from(params)
    offers = list(live_offers(product.pk))
    best = featured(offers, position)
    return {
        "catalogue_product": product_row(product),
        "featured_offer_id": None if best is None else best.pk,
        "ordering": ordering,
        "offers": [offer_row(offer) for offer in ordered(offers, ordering, position) if offer.pk != listing.pk],
    }
