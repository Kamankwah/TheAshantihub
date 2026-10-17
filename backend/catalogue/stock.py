"""Days of stock left and the low-stock line (catalogue plan 6; spec §1 row 15, §10).

* Sales are the units on paid order lines (Order.PAID; a cancelled or unpaid order is not a sale) placed inside the
  window (the governed `stock_cover_window_days`, default 28), spread over the whole days the offer has been on sale
  inside that window (since its approval, Listing.reviewed_at, else its creation, or since its first counted sale if
  that is earlier: a re-approval moves reviewed_at forward but earlier sales still count; at least 1). A new offer is
  not diluted by days it did not exist.
* An offer is low when the business set its own line for it (StockAlertState.threshold_units) and stock is at or below
  it; otherwise, with sales in the window, when it has fewer than `low_stock_cover_days` (default 7) days of sales left;
  otherwise (no sales in the window) when stock is at or below `low_stock_fallback_units` (default 5). Sold out is 0,
  which is always low.
* Only counted offers (stock_quantity set) of products and food (cart.guard DELIVERABLE) are measured: an uncounted
  stock has no cover and is never guessed.
* Integer arithmetic decides (stock x days on sale < cover days x units sold); `days_of_cover` (one decimal, half up)
  is only for display."""
import re
from dataclasses import dataclass
from datetime import timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import Optional

from django.db.models import Min, Sum
from django.utils import timezone

from cart import guard
from ledger import settings_store
from listings.models import Listing
from orders.models import Order, OrderItem

from .models import StockAlertState

COVER_DAYS, FALLBACK_UNITS, WINDOW_DAYS = "low_stock_cover_days", "low_stock_fallback_units", "stock_cover_window_days"
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


def days_on_sale(listing, window_days, now, first_sale=None):
    """Whole days on sale inside the window: since approval (else creation), or since its first counted sale if that is
    earlier (a re-approval moves reviewed_at forward, but earlier sales still count); at least 1."""
    since = listing.reviewed_at or listing.created_at
    if first_sale is not None and (since is None or first_sale < since):
        since = first_sale
    days = int((now - since).total_seconds() // DAY_SECONDS) if since else window_days
    return max(1, min(window_days, days))


def units_sold(listing_ids, window_days, now):
    """{listing id: (units, first sale time)} on paid order lines placed inside the window; a listing with none is absent."""
    rows = (
        OrderItem.objects.filter(
            listing_id__in=listing_ids, order__status=Order.PAID,
            order__placed_at__gte=now - timedelta(days=window_days),
        )
        .values("listing_id")
        .annotate(units=Sum("quantity"), first=Min("order__placed_at"))
    )
    return {row["listing_id"]: (row["units"], row["first"]) for row in rows}


def measure(listing, sold, limits, *, own_line=None, now=None, first_sale=None):
    """The Cover of one counted listing that sold `sold` units inside the window (`first_sale`: when the first of them
    was placed, so days on sale never start after a sale it counts)."""
    now = now or timezone.now()
    stock = listing.stock_quantity
    on_sale = days_on_sale(listing, limits.window_days, now, first_sale)
    cover = None
    if sold:
        cover = (Decimal(stock * on_sale) / Decimal(sold)).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP)
    if own_line is not None:
        basis, line, low = OWN, own_line, stock <= own_line
    elif sold:
        basis, line, low = SALES, None, stock * on_sale < limits.cover_days * sold
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
    return measure_many([listing], now)[listing.pk]


def row(listing, cover):
    return {
        "listing_id": listing.pk, "name": listing.name, "stock": cover.stock, "units_sold": cover.units_sold,
        "days_on_sale": cover.days_on_sale,
        "days_of_cover": None if cover.days_of_cover is None else str(cover.days_of_cover),
        "basis": cover.basis, "line": cover.line, "low": cover.low, "sold_out": cover.sold_out,
    }


def needs_restocking(owner, now=None):
    """GET stock/: the owner's low offers (sold out first, then fewest days left, then least stock), the numbers behind
    each, how many of its offers are counted and not counted, and the defaults in force."""
    now = now or timezone.now()
    current = limits_at(now)
    mine = Listing.objects.filter(business_owner=owner)
    listings = list(tracked(mine).order_by("pk"))
    covers = measure_many(listings, now, current)
    low = sorted(
        ((listing, covers[listing.pk]) for listing in listings if covers[listing.pk].low),
        key=lambda pair: (
            not pair[1].sold_out, pair[1].days_of_cover is None, pair[1].days_of_cover or 0, pair[1].stock, pair[0].pk,
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
