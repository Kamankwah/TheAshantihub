"""Product variants: keeping the listing's own price and stock in step, and the live price/stock edit.

A listing with at least one active variant has no price or stock of its own to edit: `sync_listing` derives the "from"
price (lowest active price) and the stock (sum, or None when any active variant is untracked) and writes them with
`Listing.save`, so the price history hook records the derived price. When the last active variant is switched off the
listing keeps its last derived values and simply stops being a variant listing."""
from decimal import Decimal, InvalidOperation

from django.db import transaction

from . import pricing
from .models import Listing, ListingVariant

MAX_VARIANTS = 40
MAX_ATTRIBUTES = 4
MAX_STOCK = 2147483647  # PositiveIntegerField
MAX_POSITION = 32767  # PositiveSmallIntegerField
MAX_LABEL = 100
LIVE_FIELDS = ("price_amount", "stock_quantity", "add")
STRUCTURE_LOCKED = "Changes to a live listing are sent for approval."
VARIANT_LISTING_MESSAGE = "Edit each variant's price and stock."


class VariantError(Exception):
    """A variant change the listing or the input does not allow. `payload` is the 400 body."""

    def __init__(self, message, field="detail"):
        super().__init__(message)
        self.payload = {field: message}


def active(listing):
    return ListingVariant.objects.filter(listing=listing, is_active=True)


def has_variants(listing):
    return active(listing).exists()


def sync_listing(listing):
    """Derive the listing's price, stock and (absent) sale price from its active variants. No-op without any."""
    rows = list(active(listing).values_list("price_amount", "stock_quantity"))
    if not rows:
        return listing
    stocks = [stock for _, stock in rows]
    listing.price_amount = min(price for price, _ in rows)
    listing.stock_quantity = None if any(stock is None for stock in stocks) else sum(stocks)
    listing.sale_price = None  # a variant listing has no listing-level sale; discounts are per variant
    listing.save(update_fields=["price_amount", "stock_quantity", "sale_price", "updated_at"])
    return listing


def _whole(value, field, minimum, maximum=None):
    if isinstance(value, bool) or value is None:
        raise VariantError("Must be a whole number.", field)
    try:
        number = int(value)
        if str(number) != str(value).strip():
            raise ValueError
    except (TypeError, ValueError):
        raise VariantError("Must be a whole number.", field)
    if number < minimum:
        raise VariantError("Cannot be negative." if minimum == 0 else "Must be greater than zero.", field)
    if maximum is not None and number > maximum:
        raise VariantError("That number is too large.", field)
    return number


def positive_price(value):
    try:
        price = Decimal(str(value)).quantize(pricing.CENTS)
    except (InvalidOperation, ValueError):
        raise VariantError("Enter a price.", "price_amount")
    if not price.is_finite() or price <= 0 or price >= Decimal("100000000"):
        raise VariantError("Price must be more than zero.", "price_amount")
    return price


def set_live(variant, data):
    """Change one variant's price and/or stock on a live listing, then re-derive the listing. `data` may hold only
    price_amount, stock_quantity (absolute) or add (increment); stock_quantity and add are not sent together."""
    unknown = sorted(set(data) - set(LIVE_FIELDS))
    if unknown:
        raise VariantError("Only price and stock can be changed here.", unknown[0])
    if not data:
        raise VariantError("Send price_amount, stock_quantity or add.")
    if "stock_quantity" in data and "add" in data:
        raise VariantError("Send either stock_quantity or add, not both.")
    price = positive_price(data["price_amount"]) if "price_amount" in data else None
    stock = _whole(data["stock_quantity"], "stock_quantity", 0, MAX_STOCK) if "stock_quantity" in data else None
    add = _whole(data["add"], "add", 1, MAX_STOCK) if "add" in data else None
    with transaction.atomic():
        listing = Listing.objects.select_for_update().get(pk=variant.listing_id)
        if listing.status == Listing.DISCONTINUED:
            raise VariantError("A discontinued listing cannot be changed.")
        row = ListingVariant.objects.select_for_update().get(pk=variant.pk, listing=listing)
        if price is not None:
            row.price_amount = price
        if stock is not None:
            row.stock_quantity = stock
        if add is not None:
            row.stock_quantity = (row.stock_quantity or 0) + add
            if row.stock_quantity > MAX_STOCK:
                raise VariantError("That number is too large.", "add")
        row.save()
        if row.is_active:
            sync_listing(listing)
    return row


def deactivate(variant):
    """Switch a variant off (kept for old orders) and re-derive the listing from what is left."""
    with transaction.atomic():
        listing = Listing.objects.select_for_update().get(pk=variant.listing_id)
        row = ListingVariant.objects.select_for_update().get(pk=variant.pk, listing=listing)
        row.is_active = False
        row.save(update_fields=["is_active"])
        sync_listing(listing)
    return row


def active_rows(listing):
    """The listing's active variants in display order, using prefetched rows when the queryset has them."""
    return [row for row in listing.variants.all() if row.is_active]
