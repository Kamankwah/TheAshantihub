"""Sale prices, the honest "was" price and the price history (Plan M1, Task 6).

One price read: `Listing.effective_price` (Python) and `effective_price_expr()` (the same value in a database
expression, for ordering and aggregates). A sale price counts only while it is below the regular price; if the owner
later lowers the regular price to or under the sale price, the sale is not a discount and the regular price applies.

A struck-through "was" price is shown only when the listing really held its current regular price for the previous
7 full days (an open `ListingPriceHistory` row for that price that started at least 7 days ago). Raising the price
and starting a sale the same day therefore never produces a "was" price. History is recorded from `Listing.save` on
create and whenever `price_amount` is saved; a bulk `QuerySet.update(price_amount=...)` bypasses `save` and records
nothing, so price edits must go through `save` (or call `record_price`)."""
from datetime import timedelta
from decimal import ROUND_HALF_UP, Decimal

from django.db import transaction
from django.db.models import Case, F, Q, When
from django.utils import timezone

WAS_PRICE_DAYS = 7
CENTS = Decimal("0.01")


def dec(value):
    """A price as a 2-place Decimal (None stays None); accepts the strings tests and forms assign."""
    if value is None or value == "":
        return None
    return Decimal(str(value)).quantize(CENTS)


def sale_allowed(listing_or_category):
    """Only goods and food carry a sale price: a service or stay is charged `price_amount` by the booking flow, so a
    sale price there would show a price the customer does not pay."""
    from cart import guard

    category = getattr(listing_or_category, "category", listing_or_category)
    return guard.kind_of_category(category) in guard.DELIVERABLE


def _listing_of(obj, listing=None):
    """The listing a priced row belongs to: itself, or a variant's parent (pass `listing` to skip the lookup)."""
    if listing is not None:
        return listing
    return obj.listing if hasattr(obj, "listing_id") else obj


def live_discount_q(prefix="", listing_prefix=None, now=None):
    """THE rule for a live discount, in the database: a sale price below the regular price, on goods or food, that has
    not passed its end date. `prefix` is the path to the row holding `sale_price` (a Listing: "" or "offers__"; a
    ListingVariant: "variants__") ending "__"; `listing_prefix` is the path to its Listing (same as `prefix` unless
    the row is a variant, e.g. "variants__listing__"). Expiry is read-time, so no job is needed."""
    from cart.guard import deliverable_q

    now = now or timezone.now()
    price, sale = F(f"{prefix}price_amount"), F(f"{prefix}sale_price")
    return (
        deliverable_q(prefix if listing_prefix is None else listing_prefix)
        & Q(**{f"{prefix}sale_price__isnull": False}) & Q(**{f"{prefix}sale_price__lt": price})
        & (Q(**{f"{prefix}sale_ends_at__isnull": True}) | Q(**{f"{prefix}sale_ends_at__gt": now}))
    )


def effective_price_expr(prefix=""):
    """The sale price while a live discount applies, otherwise the regular price, in the database.
    `prefix` is the path to the Listing ending "__" (e.g. "offers__"), or ""."""
    price, sale = F(f"{prefix}price_amount"), F(f"{prefix}sale_price")
    return Case(When(live_discount_q(prefix), then=sale), default=price)


def is_discounted(obj, now=None, listing=None):
    """The same rule in Python, for a Listing or a ListingVariant (pass its `listing` to avoid a lookup)."""
    price, sale = dec(obj.price_amount), dec(obj.sale_price)
    if price is None or sale is None or sale >= price:
        return False
    if obj.sale_ends_at is not None and obj.sale_ends_at <= (now or timezone.now()):
        return False
    return sale_allowed(_listing_of(obj, listing))


def effective_price(obj, now=None, listing=None):
    price = dec(obj.price_amount)
    if price is not None and is_discounted(obj, now, listing):
        return dec(obj.sale_price)
    return price


def _history(obj):
    from .models import ListingPriceHistory

    if hasattr(obj, "listing_id"):
        return ListingPriceHistory.objects.filter(variant=obj)
    return ListingPriceHistory.objects.filter(listing=obj, variant__isnull=True)


def _record(obj, listing, variant, now):
    from .models import ListingPriceHistory

    now = now or timezone.now()
    price = dec(obj.price_amount)
    with transaction.atomic():
        open_row = _history(obj).select_for_update().filter(ended_at__isnull=True).first()
        if open_row is not None and open_row.price == price:
            return
        if open_row is not None:
            open_row.ended_at = now  # the only write a history row ever gets: it is closed once, never rewritten
            open_row.save(update_fields=["ended_at"])
        if price is not None:
            ListingPriceHistory.objects.create(listing=listing, variant=variant, price=price, started_at=now)


def record_price(listing, now=None):
    """Keep the history in step with `listing.price_amount`: close the open row and open a new one when the regular
    price differs from it, do nothing when it is unchanged. The listing must already be saved. History is append-only:
    rows are never deleted and their price and start never change."""
    _record(listing, listing, None, now)


def record_variant_price(variant, now=None):
    """The same for one variant's regular price (rows with `variant` set; the listing's own history is untouched)."""
    _record(variant, variant.listing, variant, now)


def was_price_since(obj, started_at, now=None, listing=None):
    """The "was" price given when the current regular price started (None when unknown), by the 7-day rule."""
    now = now or timezone.now()
    if started_at is None or not is_discounted(obj, now, listing):
        return None
    if started_at > now - timedelta(days=WAS_PRICE_DAYS):
        return None
    return dec(obj.price_amount)


def was_price(obj, now=None, listing=None):
    """`price_amount` when a discount is live and that regular price has stood 7 full days, otherwise None.
    Works for a listing and for a variant (each keeps its own history)."""
    if not is_discounted(obj, now, listing):
        return None
    row = _history(obj).filter(ended_at__isnull=True, price=dec(obj.price_amount)).order_by("-started_at").first()
    return was_price_since(obj, row.started_at if row else None, now, listing)


def discount_percent(was, now_price):
    """Whole percent off, only from a real "was" price."""
    if was is None or now_price is None or was <= 0 or now_price >= was:
        return None
    return int(((was - now_price) / was * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


# ── Discounts the owner starts and ends (Plan M2 Task 8) ───────────────────────────────────────────────────────────
MIN_PERCENT_OFF = Decimal("1")
MAX_PERCENT_OFF = Decimal("90")
NOT_GOODS_MESSAGE = "Only goods and food can have a discount. Services and stays are charged their regular price."
RUNNING_MESSAGE = "This already has a discount running. End it before starting a new one."
RANGE_MESSAGE = "A sale price must be below the regular price ({regular}) and between 1% and 90% off."


class PricingError(Exception):
    """A discount request the rules refuse. `status` is the HTTP status; `payload` is the body."""

    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status
        self.payload = {"detail": message}


def _percent(regular, sale):
    return int(((regular - sale) / regular * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def _parse_number(value, what):
    if isinstance(value, bool) or value is None or value == "":
        raise PricingError(f"Enter {what}.")
    try:
        number = Decimal(str(value).strip())
    except Exception:  # InvalidOperation, ValueError
        raise PricingError(f"Enter {what} as a number.") from None
    if not number.is_finite():
        raise PricingError(f"Enter {what} as a number.")
    return number


def sale_for(regular, sale_price=None, percent_off=None):
    """The sale price (2 places) for a request that sent exactly one of `sale_price` / `percent_off`, checked against
    the regular price: below it, at least 1% and at most 90% off. Raises PricingError."""
    if (sale_price in (None, "")) == (percent_off in (None, "")):
        raise PricingError("Send either a sale price or a percentage off, not both.")
    if percent_off not in (None, ""):
        pct = _parse_number(percent_off, "a percentage off")
        if not (MIN_PERCENT_OFF <= pct <= MAX_PERCENT_OFF):
            raise PricingError("The percentage off must be between 1 and 90.")
        sale = (regular * (Decimal(100) - pct) / Decimal(100)).quantize(CENTS, rounding=ROUND_HALF_UP)
    else:
        sale = _parse_number(sale_price, "a sale price").quantize(CENTS, rounding=ROUND_HALF_UP)
    lowest = (regular * Decimal("0.10")).quantize(CENTS, rounding=ROUND_HALF_UP)
    highest = (regular * Decimal("0.99")).quantize(CENTS, rounding=ROUND_HALF_UP)
    if sale <= 0 or sale >= regular or sale > highest or sale < lowest:
        raise PricingError(RANGE_MESSAGE.format(regular=regular))
    return sale


def _end_date(value, now):
    if value in (None, ""):
        return None
    from django.utils.dateparse import parse_datetime

    parsed = value if hasattr(value, "tzinfo") else None
    if parsed is None:
        try:
            parsed = parse_datetime(str(value))
        except ValueError:
            parsed = None
    if parsed is None:
        raise PricingError("Enter the end date and time.")
    if timezone.is_naive(parsed):
        parsed = timezone.make_aware(parsed)
    if parsed <= now:
        raise PricingError("The end date must be in the future.")
    return parsed


def _lock(listing_id, variant_id):
    """The listing row (and the variant row) locked for writing, and whether the listing has active variants."""
    from .models import Listing, ListingVariant

    listing = Listing.objects.select_for_update().select_related("category").get(pk=listing_id)
    has_variants = listing.variants.filter(is_active=True).exists()
    variant = None
    if variant_id not in (None, ""):
        try:
            variant = ListingVariant.objects.select_for_update().get(pk=variant_id, listing=listing, is_active=True)
        except (ListingVariant.DoesNotExist, ValueError, TypeError):
            raise PricingError("That variant is not on this listing.") from None
        if not has_variants:  # pragma: no cover - an active variant means has_variants
            raise PricingError("That variant is not on this listing.")
    elif has_variants:
        raise PricingError("This listing has variants. Choose one: each variant is discounted on its own.")
    return listing, variant


def start_discount(listing_id, *, variant=None, sale_price=None, percent_off=None, ends_at=None, now=None):
    """Put a sale price (and optional end date) on a published goods or food listing, or on one of its variants. Goes
    live at once. Returns the row. Raises PricingError (409 when a discount is already running)."""
    from .models import Listing

    now = now or timezone.now()
    with transaction.atomic():
        listing, target_variant = _lock(listing_id, variant)
        if listing.status != Listing.PUBLISHED:
            raise PricingError("Only a published listing can have a discount.")
        if not sale_allowed(listing):
            raise PricingError(NOT_GOODS_MESSAGE)
        target = target_variant or listing
        regular = dec(target.price_amount)
        if regular is None or regular <= 0:
            raise PricingError("Set a price before starting a discount.")
        if is_discounted(target, now, listing):
            raise PricingError(RUNNING_MESSAGE, status=409)
        sale = sale_for(regular, sale_price, percent_off)
        end = _end_date(ends_at, now)
        target.sale_price, target.sale_ends_at = sale, end
        fields = ["sale_price", "sale_ends_at"]
        target.save(update_fields=fields if target_variant else [*fields, "updated_at"])
    return target


def end_discount(listing_id, *, variant=None):
    """Clear the sale price and end date of the listing or variant. Allowed on any status (a dropped listing's sale can
    be cleared). Raises PricingError 404 when there is nothing to end."""
    with transaction.atomic():
        listing, target_variant = _lock(listing_id, variant)
        target = target_variant or listing
        if target.sale_price is None:
            raise PricingError("There is no discount running here.", status=404)
        target.sale_price = target.sale_ends_at = None
        fields = ["sale_price", "sale_ends_at"]
        target.save(update_fields=fields if target_variant else [*fields, "updated_at"])
    return target


def live_discounts(listing, now=None):
    """The listing's live discounts as rows: the listing's own and each active variant's."""
    now = now or timezone.now()
    rows = []

    def row(target, variant=None):
        regular, sale = dec(target.price_amount), dec(target.sale_price)
        rows.append({
            "target": "variant" if variant else "listing", "variant": variant.pk if variant else None,
            "label": variant.label if variant else None, "regular_price": str(regular), "sale_price": str(sale),
            "percent_off": _percent(regular, sale), "ends_at": target.sale_ends_at,
        })

    if is_discounted(listing, now):
        row(listing)
    for variant in listing.variants.all():
        if variant.is_active and is_discounted(variant, now, listing):
            row(variant, variant)
    return rows
