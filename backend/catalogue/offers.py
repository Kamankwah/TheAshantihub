"""Offers of one catalogue product (catalogue plan 6; spec §10). Each business's listing is its own offer (own price,
stock, cart line, fee and pickup); nothing here adds anything to a cart.

* A live offer is published, from a business public browse shows (listings.visibility), priced, and in stock: an
  uncounted stock (null) counts as in stock, zero hides the offer (spec §1 row 15).
* Only KYC-verified businesses are listed (Director ruling: unverified sellers hidden, spec (cxvii)).
* The featured offer is the lowest price now (`prices_now`: the regular price, a live listing discount, or a live
  flash-sale price) among live offers. A tie goes to the shop nearest
  the customer when the app sends the customer's position (?lat=&lng=; a straight-line measure from the business pin,
  used only to order and never shown), then to the oldest offer.
* An offer row never carries a phone number, email, address, map pin or the listing's contact_phone: businesses are
  never contacted directly (CLAUDE.md). The business shows by its display name only. A stock the business does not
  count is null, never a guess."""
from decimal import Decimal

from django.db.models import Count, Min, Q
from django.utils import timezone

from accounts.models import BusinessOwner
from cart.guard import deliverable_q
from delivery.services import valid_point
from field.services import haversine_m
from listings.models import Listing
from listings.pricing import effective_price_expr, is_discounted
from listings.visibility import hidden_business_q
from marketing import checkout as promo_checkout
from marketing import promos
from marketing.models_promos import FlashSaleListing

from . import identity
from .errors import CatalogueError
from .models import CatalogueProduct, product_row

PRICE, AVAILABILITY = "price", "availability"
MAX_OFFERS = 50  # a hard cap on the offers read for one product


def in_stock_q(prefix=""):
    """Listings with something left. `prefix` is the path to the Listing, ending "__", or ""."""
    return Q(**{f"{prefix}stock_quantity__isnull": True}) | Q(**{f"{prefix}stock_quantity__gt": 0})


def live_q(prefix=""):
    """Listings a customer may see and buy now (see the module text)."""
    return (
        Q(**{f"{prefix}status": Listing.PUBLISHED, f"{prefix}price_amount__gt": 0})
        & deliverable_q(prefix)  # goods and food only: a listing moved to a service or stay category drops out
        & in_stock_q(prefix)
        & ~hidden_business_q(f"{prefix}business_owner__")
    )


def live_offers(product_id, exclude_owner_id=None, limit=MAX_OFFERS):
    """Live offers of one product, cheapest first, capped at MAX_OFFERS. `exclude_owner_id` leaves one business out
    before the cap, so its own listings never crowd other businesses' offers out."""
    queryset = Listing.objects.filter(live_q(), catalogue_product_id=product_id, business_owner__kyc_status=BusinessOwner.VERIFIED)
    if exclude_owner_id is not None:
        queryset = queryset.exclude(business_owner_id=exclude_owner_id)
    return (
        queryset
        .select_related("business_owner__profile", "zone", "category")  # effective_price reads the category
        .order_by(effective_price_expr(), "pk")[:limit]
    )


def position_from(params):
    """(lat, lng) from ?lat=&lng=, or None when either is missing, not a number, out of range, or 0,0."""
    return valid_point(params.get("lat"), params.get("lng"))


def _tie(listing, position):
    """Nearest first, by the listing's own public lat/lng only (never the staff-only business pin); with no position
    or no listing point there is no distance tie-break and the oldest offer wins."""
    point = valid_point(listing.lat, listing.lng) if position is not None else None
    distance = None if point is None else haversine_m(position[0], position[1], point[0], point[1])
    return (distance is None, distance or 0.0, listing.pk)


REGULAR, DISCOUNT, FLASH_SALE = "regular", "discount", "flash_sale"


def prices_now(listings, now=None):
    """{listing_id: (price, basis)}: what the customer pays now. The regular price; the listing's own live discount
    (the sale price on the listing, read in Python from rows already loaded: no query); and, while promotions are on, a
    lower live flash-sale price (a fixed number of queries whatever the offer count). The advertised sale price orders
    the list: a visitor's per-customer allowance is not known (as `FlashPriceTag` shows it)."""
    now = now or timezone.now()
    prices = {}
    for listing in listings:
        discounted = is_discounted(listing, now)
        prices[listing.pk] = (listing.effective_price, DISCOUNT if discounted else REGULAR)
    if not listings or not promos.enabled():
        return prices
    sales = {sale.pk: sale for sale in promo_checkout.live_window_sales(now)}
    if not sales:
        return prices
    open_sales = {pk for pk, sale in sales.items() if sale.stock_cap - promo_checkout._sold(sale) > 0}
    rows = FlashSaleListing.objects.filter(
        sale_id__in=open_sales, listing_id__in=list(prices), agreed_at__isnull=False, declined_at__isnull=True,
    ).order_by("sale_id")
    for row in promo_checkout.usable_rows(list(rows), listings):
        price, _ = prices[row.listing_id]
        if row.sale_price < price:
            prices[row.listing_id] = (Decimal(row.sale_price), FLASH_SALE)
    return prices


def featured(offers, position=None, prices=None):
    """The featured offer among live `offers`, or None when no verified business offers it."""
    verified = [offer for offer in offers if offer.business_owner.kyc_status == BusinessOwner.VERIFIED]
    if not verified:
        return None
    return min(verified, key=lambda offer: (prices[offer.pk][0], *_tie(offer, position)))


def ordered(offers, ordering=PRICE, position=None, prices=None):
    """Cheapest first, or most available first (an uncounted stock after every counted one); ties as in `featured`."""
    if ordering == AVAILABILITY:
        return sorted(offers, key=lambda offer: (
            offer.stock_quantity is None, -(offer.stock_quantity or 0), prices[offer.pk][0], *_tie(offer, position),
        ))
    return sorted(offers, key=lambda offer: (prices[offer.pk][0], *_tie(offer, position)))


def _business_name(owner):
    """The profile's business name, or None: never the owner's personal name."""
    profile = getattr(owner, "profile", None)
    return ((profile.business_name or "").strip() if profile is not None else "") or None


def offer_row(listing, prices):
    price, basis = prices[listing.pk]
    return {
        "listing_id": listing.pk, "name": listing.name, "price_amount": str(listing.effective_price),
        "price_now": str(price.quantize(Decimal("0.01"))), "price_basis": basis,
        "price_unit": listing.price_unit, "condition": listing.condition,
        "business_name": _business_name(listing.business_owner),
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
    # Other businesses only: the listing's own business's other offers are not "other sellers". The listing itself
    # stays a candidate for the featured offer, so featured_offer_id is the listing or a row in `offers`.
    offers = [o for o in live_offers(product.pk) if o.pk == listing.pk or o.business_owner_id != listing.business_owner_id]
    prices = prices_now(offers)
    best = featured(offers, position, prices)
    return {
        "catalogue_product": product_row(product),
        "featured_offer_id": None if best is None else best.pk,
        "ordering": ordering,
        "offers": [offer_row(offer, prices) for offer in ordered(offers, ordering, position, prices) if offer.pk != listing.pk],
    }


# --- A business's lookup (read-only) ---------------------------------------------------------------------------------

QUERY_REQUIRED = "Type at least two letters of the product's name, or its barcode."
SEARCH_LIMIT = 20
MAX_WORDS = 8  # more words than this are ignored: a lookup is never a long scan


def search(params):
    """GET products/: catalogue entries by barcode (any spelling) or by every word of ?q= (normalised), with how many
    live offers each has now and the lowest live price (null when nobody offers it now), and whether more matched than the
    cap of SEARCH_LIMIT shows (the screen should ask for a narrower search). Returns (rows, truncated). Raises
    CatalogueError."""
    raw_barcode = str(params.get("barcode") or "").strip()
    if raw_barcode:
        try:
            key = identity.clean_barcode(raw_barcode)
        except identity.BarcodeError as exc:
            raise CatalogueError(str(exc), "invalid_barcode") from None
        queryset = CatalogueProduct.objects.filter(barcode=key)
    else:
        words = identity.normalise_name(str(params.get("q") or "")[:300]).split()[:MAX_WORDS]
        if not any(len(word) >= 2 for word in words):
            raise CatalogueError(QUERY_REQUIRED, "query_required")
        queryset = CatalogueProduct.objects.all()
        for word in words:
            queryset = queryset.filter(normalised_name__contains=word)
    live = live_q("offers__") & Q(offers__business_owner__kyc_status=BusinessOwner.VERIFIED)
    rows = queryset.annotate(
        offer_count=Count("offers", filter=live, distinct=True),
        lowest_price=Min(effective_price_expr("offers__"), filter=live),
    ).order_by("normalised_name", "pk")[:SEARCH_LIMIT + 1]
    rows = list(rows)
    return [
        {**product_row(row), "offer_count": row.offer_count,
         "lowest_price": None if row.lowest_price is None else str(row.lowest_price)}
        for row in rows[:SEARCH_LIMIT]
    ], len(rows) > SEARCH_LIMIT


def sourcing(product, owner):
    """GET products/<id>/offers/: other businesses' live offers of `product`, cheapest first, and the owner's own
    listings grouped with it. Read-only: the rows carry no contact details and nothing here orders anything."""
    mine = list(
        Listing.objects.filter(catalogue_product=product, business_owner=owner).order_by("pk").values_list("pk", flat=True)
    )
    others = list(live_offers(product.pk, exclude_owner_id=owner.pk, limit=MAX_OFFERS + 1))
    shown = others[:MAX_OFFERS]
    prices = prices_now(shown)
    return {
        "catalogue_product": product_row(product), "your_listings": mine,
        "offers": [offer_row(offer, prices) for offer in ordered(shown, prices=prices)],
        "truncated": len(others) > MAX_OFFERS,
    }
