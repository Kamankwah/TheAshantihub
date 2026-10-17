"""Low-stock and sold-out alerts (catalogue plan 6; spec §1 row 15, §10): each offer is told about once per crossing.

* `run` (hourly: catalogue.tasks.check_stock_alerts) measures every counted, published product and food offer of a
  business public browse shows (catalogue.stock) and moves its StockAlertState (`move_state`):
  - sold out (0) and not yet told: one "sold out" notice; the low alert counts as told too (at stock 0), so a partial
    restock that is still low says nothing more;
  - low and not yet told: one "running low" notice, remembering the stock it was told at;
  - the low alert is re-armed only by a restock: once the offer is no longer low and holds more than when it was told
    (a sales rate drifting over the line never repeats it), or when the business changes its own line
    (catalogue.stock.set_own_line); the sold-out alert once stock is above 0.
* Every move is one conditional UPDATE (`... IS NULL`), so two runs at once tell a business once. The whole run is one
  transaction: the state moves and their notices commit together, so a run that dies part-way leaves every state as it
  was and the next run tells those offers.
* One notice per business per run for each kind, naming up to five offers (`tell`).
* In-app only. Texts and emails by the business's preference wait for Stage 4's outbox (spec §13 (cii)): `tell` is the
  one place to add them.
* Nothing is measured or sent while STOCK_ALERTS_ENABLED is off (the default). A notice that fails to save
  (notifications never raise) while its state moved is not retried until the next restock (spec §13 (cxii)); a run that
  dies part-way is not that case: the run is one transaction, so nothing is marked told without its notice."""
from django.conf import settings
from django.db import transaction
from django.utils import timezone

from listings.models import Listing
from listings.visibility import hidden_business_q
from notifications.services import notify_business_owner

from . import stock
from .models import StockAlertState

LOW, SOLD_OUT = "stock_low", "stock_sold_out"
CHUNK = 500
NAMED = 5


def enabled():
    return bool(getattr(settings, "STOCK_ALERTS_ENABLED", False))


def _names(names):
    shown = ", ".join(f"“{name}”" for name in names[:NAMED])
    more = len(names) - NAMED
    return shown if more <= 0 else f"{shown} and {more} more"


def tell(owner, kind, names):
    """The business's in-app notice for one kind, naming its offers. The texts-and-emails hook goes here (cii).

    Rule for any such hook: `tell` runs inside the run's one transaction, so a hook must use its own savepoint
    (`transaction.atomic()`) and swallow its own errors; a failed text must never roll back the state moves of the
    whole run or stop the other businesses being told."""
    one = len(names) == 1
    if kind == SOLD_OUT:
        title = "Sold out" if one else f"{len(names)} products sold out"
        body = f"{_names(names)} {'has' if one else 'have'} sold out. Restock to keep selling."
        if getattr(settings, "SOLD_OUT_HIDDEN_ENABLED", False):
            body = (f"{_names(names)} {'has' if one else 'have'} sold out and no longer {'shows' if one else 'show'} in "
                    f"search. Restock to show {'it' if one else 'them'} again.")
        icon = "📭"
    else:
        title = "Running low" if one else f"{len(names)} products running low"
        body = f"{_names(names)} {'is' if one else 'are'} running low. Open your listings to restock."
        icon = "📦"
    return notify_business_owner(owner, kind, title, body=body, link="/business-dashboard", icon=icon)


def move_state(state, cover, now):
    """Apply one offer's measurement to its alert state; the kind of notice it earns now (LOW, SOLD_OUT) or None.
    `state` may be stale: every move is conditional on the row being as the move expects."""
    rows = StockAlertState.objects.filter(pk=state.pk)
    # The low moves also match the line the run measured against, so a line saved mid-run is not recorded against the
    # old one. The sold-out move does not depend on the line.
    low_rows = rows.filter(threshold_units=state.threshold_units)
    if cover.sold_out:
        if state.sold_out_alerted_at is None and rows.filter(sold_out_alerted_at__isnull=True).update(
            sold_out_alerted_at=now, updated_at=now,
        ):
            low_rows.filter(low_alerted_at__isnull=True).update(low_alerted_at=now, low_alerted_stock=0)
            return SOLD_OUT
        return None
    if state.sold_out_alerted_at is not None:
        # Conditional on the time this run read, so a sold-out alert set since is not cleared by a stale read.
        rows.filter(sold_out_alerted_at=state.sold_out_alerted_at).update(sold_out_alerted_at=None, updated_at=now)
    if cover.low:
        if state.low_alerted_at is None and low_rows.filter(low_alerted_at__isnull=True).update(
            low_alerted_at=now, low_alerted_stock=cover.stock, updated_at=now,
        ):
            return LOW
        return None
    if state.low_alerted_at is not None and cover.stock > (state.low_alerted_stock or 0):
        low_rows.filter(low_alerted_at=state.low_alerted_at).update(low_alerted_at=None, low_alerted_stock=None, updated_at=now)
    return None


def run(now=None):
    """Measure every offer and send what is due. Returns how many offers were told about (0 while switched off). One
    transaction: the state moves and their notices commit together, so a run that dies part-way (a deploy, a timeout)
    leaves every state as it was and the next run tells those offers. A second run at the same time waits on the rows the
    first moved, then finds them moved: still told once."""
    if not enabled():
        return 0
    now = now or timezone.now()
    current = stock.limits_at(now)
    ids = list(stock.tracked(Listing.objects.exclude(hidden_business_q())).order_by("pk").values_list("pk", flat=True))
    notices = {}
    for start in range(0, len(ids), CHUNK):
        _ensure_states(ids[start:start + CHUNK])    # in autocommit, before the run's transaction opens
    with transaction.atomic():
        for start in range(0, len(ids), CHUNK):
            _run_chunk(ids[start:start + CHUNK], current, now, notices)
        for (_, kind), (owner, names) in sorted(notices.items(), key=lambda item: item[0]):
            tell(owner, kind, names)
    return sum(len(names) for _, names in notices.values())


def _ensure_states(ids):
    """A state row for every offer in `ids`, inserted only for the ones missing (a steady hour inserts nothing). Run
    outside the run's transaction, so that transaction only UPDATEs state rows: inserting hundreds of rows with a foreign
    key to listings in it would key-share-lock those listings until commit, against checkout's FOR UPDATE."""
    have = set(StockAlertState.objects.filter(listing_id__in=ids).values_list("listing_id", flat=True))
    missing = [pk for pk in ids if pk not in have]
    if missing:
        StockAlertState.objects.bulk_create([StockAlertState(listing_id=pk) for pk in missing], ignore_conflicts=True)


def _run_chunk(ids, current, now, notices):
    """Measure one chunk of offers and collect the notices they earn, by (business, kind), into `notices`."""
    listings = list(stock.tracked(Listing.objects.filter(pk__in=ids)).select_related("business_owner").order_by("pk"))
    states = {state.listing_id: state for state in StockAlertState.objects.filter(listing_id__in=ids)}
    listings = [listing for listing in listings if listing.pk in states]
    lines = {pk: state.threshold_units for pk, state in states.items() if state.threshold_units is not None}
    covers = stock.measure_many(listings, now, current, lines)
    for listing in listings:
        kind = move_state(states[listing.pk], covers[listing.pk], now)
        if kind is not None:
            notices.setdefault((listing.business_owner_id, kind), (listing.business_owner, []))[1].append(listing.name)
