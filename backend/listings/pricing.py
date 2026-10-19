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
from django.db.models import F
from django.db.models.functions import Coalesce, Least
from django.utils import timezone

WAS_PRICE_DAYS = 7
CENTS = Decimal("0.01")


def dec(value):
    """A price as a 2-place Decimal (None stays None); accepts the strings tests and forms assign."""
    if value is None or value == "":
        return None
    return Decimal(str(value)).quantize(CENTS)


def effective_price_expr(prefix=""):
    """The sale price when it is a real discount, otherwise the regular price, in the database. `prefix` is the path
    to the Listing ending "__" (e.g. "offers__"), or ""."""
    price, sale = F(f"{prefix}price_amount"), F(f"{prefix}sale_price")
    return Least(Coalesce(sale, price), price)


def effective_price(listing):
    price, sale = dec(listing.price_amount), dec(listing.sale_price)
    if price is None:
        return None
    if sale is None:
        return price
    return min(sale, price)


def is_discounted(listing):
    price, sale = dec(listing.price_amount), dec(listing.sale_price)
    return price is not None and sale is not None and sale < price


def record_price(listing, now=None):
    """Keep the history in step with `listing.price_amount`: close the open row and open a new one when the regular
    price differs from it, do nothing when it is unchanged. The listing must already be saved."""
    from .models import ListingPriceHistory

    now = now or timezone.now()
    price = dec(listing.price_amount)
    with transaction.atomic():
        open_row = ListingPriceHistory.objects.select_for_update().filter(listing=listing, ended_at__isnull=True).first()
        if open_row is not None and open_row.price == price:
            return
        if open_row is not None:
            open_row.ended_at = now
            open_row.save(update_fields=["ended_at"])
        if price is not None:
            ListingPriceHistory.objects.create(listing=listing, price=price, started_at=now)


def was_price_since(listing, started_at, now=None):
    """The "was" price given when the current regular price started (None when unknown), by the 7-day rule."""
    now = now or timezone.now()
    if started_at is None or not is_discounted(listing):
        return None
    if started_at > now - timedelta(days=WAS_PRICE_DAYS):
        return None
    return dec(listing.price_amount)


def was_price(listing, now=None):
    """`price_amount` when a sale is on and that regular price has stood 7 full days, otherwise None."""
    if not is_discounted(listing):
        return None
    row = listing.price_history.filter(ended_at__isnull=True, price=dec(listing.price_amount)).order_by("-started_at").first()
    return was_price_since(listing, row.started_at if row else None, now)


def discount_percent(was, now_price):
    """Whole percent off, only from a real "was" price."""
    if was is None or now_price is None or was <= 0 or now_price >= was:
        return None
    return int(((was - now_price) / was * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
