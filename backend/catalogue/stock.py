"""Days of stock left and the low-stock line (catalogue plan 6; spec §1 row 15, §10).

* Sales are the units on paid order lines (Order.PAID; a cancelled or unpaid order is not a sale) placed inside the
  window (the governed `stock_cover_window_days`, default 28). `placed_at` is the clock because stock is reserved at
  checkout. Refunds: a whole refund before handover cancels the order (so it is excluded); a partial refund, or one
  after handover, leaves the order PAID and the units still count.
* Days on sale: the elapsed time since the offer was approved (Listing.reviewed_at, else its creation), pulled back to
  its earliest PAID sale EVER (even one before the window: that sale proves the offer was live then, so a re-approval,
  which moves reviewed_at forward, never compresses the window), clamped to between one day and the window. The
  decision uses elapsed seconds; the whole days shown are for display. A new offer is not diluted by days it did not
  exist.
* An offer is low when the business set its own line for it (StockAlertState.threshold_units) and stock is at or below
  it; otherwise, with sales in the window, when it has fewer than `low_stock_cover_days` (default 7) days of sales left;
  otherwise (no sales in the window) when stock is at or below `low_stock_fallback_units` (default 5). Sold out is 0,
  which is always low.
* Only counted offers (stock_quantity set) of products and food (cart.guard DELIVERABLE) are measured: an uncounted
  stock has no cover and is never guessed (`measure` answers None for one).
* Exact integer arithmetic decides (stock x elapsed seconds < cover days x units sold x 86,400); `days_of_cover` (one
  decimal, rounded DOWN so a row is flagged low exactly when the shown number is under the cover days) is only for
  display."""
import re
from dataclasses import dataclass
from datetime import timedelta
from decimal import ROUND_DOWN, Decimal
from typing import Optional

from django.db.models import Min, Q, Sum
from django.utils import timezone
from rest_framework.pagination import PageNumberPagination

from cart import guard
from ledger import settings_store
from listings.models import Listing
from orders.models import Order, OrderItem

from .models import StockAlertState

COVER_DAYS, FALLBACK_UNITS, WINDOW_DAYS = (
    settings_store.STOCK_COVER_DAYS, settings_store.STOCK_FALLBACK_UNITS, settings_store.STOCK_WINDOW_DAYS,
)
SALES, FALLBACK, OWN = "sales", "fallback", "own_threshold"
MAX_LINE = 100_000
LINE_MESSAGE = f"Enter a whole number of units from 0 to {MAX_LINE:,}, or leave it empty to use AshantiHub's default."
NOT_A_PRODUCT = "Only products and food have a stock line."
NOT_COUNTED = "Count this listing's stock first: a low-stock line needs a stock count."
DAY_SECONDS = 86400


@dataclass(frozen=True)
class Limits:
    cover_days: int
    fallback_units: int
    window_days: int


@dataclass(frozen=True)
class Cover:
    stock: int
    units_sold: int
    days_on_sale: int
    days_of_cover: Optional[Decimal]
    basis: str
    line: Optional[int]
    low: bool
    sold_out: bool


def limits_at(now=None):
    """The governed numbers in force at `now`."""
    now = now or timezone.now()
    return Limits(
        settings_store.current(COVER_DAYS, now), settings_store.current(FALLBACK_UNITS, now),
        settings_store.current(WINDOW_DAYS, now),
    )


def tracked(queryset):
    """The published, counted product and food offers in `queryset`."""
    return queryset.filter(status=Listing.PUBLISHED, stock_quantity__isnull=False).filter(guard.deliverable_q())


def seconds_on_sale(listing, window_days, now, first_sale=None):
    """Elapsed seconds on sale: since approval (else creation), pulled back to the earliest paid sale ever, clamped to
    [one day, the window]."""
    since = listing.reviewed_at or listing.created_at
    if first_sale is not None and (since is None or first_sale < since):
        since = first_sale
    seconds = int((now - since).total_seconds()) if since else window_days * DAY_SECONDS
    return max(DAY_SECONDS, min(window_days * DAY_SECONDS, seconds))


def days_on_sale(listing, window_days, now, first_sale=None):
    """Whole days on sale (display), from seconds_on_sale; at least 1."""
    return seconds_on_sale(listing, window_days, now, first_sale) // DAY_SECONDS


def units_sold(listing_ids, window_days, now):
    """{listing id: (units inside the window, time of the earliest paid sale ever)} in one grouped query; a listing with
    no paid sale at all is absent, one with only old sales has 0 units."""
    rows = (
        OrderItem.objects.filter(listing_id__in=listing_ids, order__status=Order.PAID)
        .values("listing_id")
        .annotate(
            units=Sum("quantity", filter=Q(order__placed_at__gte=now - timedelta(days=window_days))),
            first=Min("order__placed_at"),
        )
    )
    return {row["listing_id"]: (row["units"] or 0, row["first"]) for row in rows}


def measure(listing, sold, limits, *, own_line=None, now=None, first_sale=None):
    """The Cover of one counted listing that sold `sold` units inside the window (`first_sale`: when the first of them
    was placed, so days on sale never start after a sale it counts)."""
    now = now or timezone.now()
    stock = listing.stock_quantity
    if stock is None:
        return None
    seconds = seconds_on_sale(listing, limits.window_days, now, first_sale)
    on_sale = seconds // DAY_SECONDS
    cover = None
    if sold:
        cover = (Decimal(stock * seconds) / Decimal(sold * DAY_SECONDS)).quantize(Decimal("0.1"), rounding=ROUND_DOWN)
    if own_line is not None:
        basis, line, low = OWN, own_line, stock <= own_line
    elif sold:
        basis, line, low = SALES, None, stock * seconds < limits.cover_days * sold * DAY_SECONDS
    else:
        basis, line, low = FALLBACK, limits.fallback_units, stock <= limits.fallback_units
    return Cover(stock, sold, on_sale, cover, basis, line, low or stock == 0, stock == 0)


def own_lines(listing_ids):
    return dict(
        StockAlertState.objects.filter(listing_id__in=listing_ids, threshold_units__isnull=False)
        .values_list("listing_id", "threshold_units")
    )


def measure_many(listings, now=None, limits=None, lines=None):
    """{listing id: Cover} for counted listings: one sales query for the lot, and one for the own lines unless given."""
    now = now or timezone.now()
    limits = limits or limits_at(now)
    listings = list(listings)
    ids = [listing.pk for listing in listings]
    sold = units_sold(ids, limits.window_days, now)
    lines = own_lines(ids) if lines is None else lines
    covers = {}
    for listing in listings:
        units, first = sold.get(listing.pk, (0, None))
        covers[listing.pk] = measure(
            listing, units, limits, own_line=lines.get(listing.pk), now=now, first_sale=first,
        )
    return covers


def cover_of(listing, now=None):
    """The Cover of one listing, or None when its stock is not counted."""
    return measure_many([listing], now)[listing.pk]


def row(listing, cover):
    return {
        "listing_id": listing.pk, "name": listing.name, "stock": cover.stock, "units_sold": cover.units_sold,
        "days_on_sale": cover.days_on_sale,
        "days_of_cover": None if cover.days_of_cover is None else str(cover.days_of_cover),
        "basis": cover.basis, "line": cover.line, "low": cover.low, "sold_out": cover.sold_out,
    }


class StockPagination(PageNumberPagination):
    page_size = 20


def needs_restocking(owner, now=None):
    """GET stock/: the owner's low offers (sold out first, then fewest days left, offers with no days figure last, then
    id), the numbers behind each, how many of its offers are counted and not counted, and the defaults in force. The
    view pages `results` (20 a page)."""
    now = now or timezone.now()
    current = limits_at(now)
    mine = Listing.objects.filter(business_owner=owner)
    listings = list(
        tracked(mine).only("id", "name", "stock_quantity", "reviewed_at", "created_at").order_by("pk")
    )
    covers = measure_many(listings, now, current)
    low = sorted(
        ((listing, covers[listing.pk]) for listing in listings if covers[listing.pk].low),
        key=lambda pair: (
            not pair[1].sold_out, pair[1].days_of_cover is None, pair[1].days_of_cover or 0, pair[0].pk,
        ),
    )
    untracked = mine.filter(status=Listing.PUBLISHED, stock_quantity__isnull=True).filter(guard.deliverable_q()).count()
    return {
        "results": [row(listing, cover) for listing, cover in low],
        "tracked_offers": len(listings), "untracked_offers": untracked,
        "settings": {
            "cover_days": current.cover_days, "fallback_units": current.fallback_units, "window_days": current.window_days,
        },
    }


def parse_line(raw):
    """A business's own low-stock line: None (use the default) or a whole number 0..MAX_LINE. Raises ValueError."""
    if raw is None or raw == "":
        return None
    if isinstance(raw, bool) or not isinstance(raw, (int, str)):
        raise ValueError(raw)
    text = str(raw).strip()
    if not re.fullmatch(r"[0-9]+", text) or int(text) > MAX_LINE:
        raise ValueError(raw)
    return int(text)


def set_own_line(listing, units):
    """Set (or clear, with None) the business's own low-stock line for one offer. A changed line re-arms the low alert,
    so the offer is measured against it from the next run; saving the same line again changes nothing; the sold-out
    alert is left as it is."""
    state, _ = StockAlertState.objects.get_or_create(listing=listing)
    if state.threshold_units == units:
        return
    StockAlertState.objects.filter(pk=state.pk).update(
        threshold_units=units, low_alerted_at=None, low_alerted_stock=None, updated_at=timezone.now(),
    )
