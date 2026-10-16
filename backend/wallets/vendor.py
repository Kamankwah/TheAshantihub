"""A business's own money, as its dashboard shows it (spec §6; vendor plan 4): Pending and Available, the lifetime fee
cap, and one row per sale with the item subtotal, the platform fee, what is due and where the money stands. Read-only:
nothing here posts, changes a balance or takes a lock.

Sale rows come from the fee snapshots (ledger.OrderFeeSnapshot: one per order, business and fee category, fixed at
payment), so they show what the ledger recorded, never today's rules; balances come from the ledger accounts. Only the
business's own snapshots, item lines and accounts are read: an order can span several businesses (backend/CLAUDE.md,
owner-scoped order isolation). No customer's name, phone or address appears here: the order screen
(GET /api/orders/owner/) already carries what fulfilment needs. Money is integer pesewas inside and GH₵ strings in the
rows. Only product orders are in the ledger today; booking sales (Plan 1b) slot in as a second source of rows with kind
"booking" (spec §13 (lxxii))."""
from datetime import datetime, time, timedelta

from django.db.models import Count, F, Max, Q, Sum
from django.db.models.functions import TruncDate
from django.utils import timezone
from django.utils.dateparse import parse_date

from accounts.models import BusinessOwner
from disputes.models import Dispute
from ledger import fees, posting, settings_store, verification
from ledger.models import Account, FulfilmentCheck, JournalLine, OrderFeeSnapshot
from ledger.money import to_pesewas
from marketing.models_waivers import WaivedFeeCharge
from orders.models import Order, OrderItem
from otp.identity import ref

from .models import Withdrawal
from .services import money

AWAITING, RELEASED, REFUNDED = "awaiting_call", "released", "refunded"
STATUSES = (AWAITING, RELEASED, REFUNDED)
WAITING_FOR_HANDOVER = "Waiting for delivery or collection"
WAITING_FOR_CALL = "Waiting for Support's call to the customer"
ON_HOLD = "On hold while AshantiHub checks the order"  # an open dispute or a refund awaiting approval: never more than this
LABELS = {RELEASED: "Released to your Available balance", REFUNDED: "Refunded to the customer"}


class RangeError(Exception):
    """A bad ?date_from= / ?date_to=: `field` names the parameter, `message` is what to show."""

    def __init__(self, field, message):
        super().__init__(message)
        self.field, self.message = field, message

    def body(self):
        return {self.field: self.message}


def _date(params, field):
    raw = params.get(field)
    if raw in (None, ""):
        return None
    try:
        value = parse_date(str(raw))
    except ValueError:  # well formed but not a real day, like 2026-02-30
        value = None
    if value is None:
        raise RangeError(field, "Use a date like 2026-10-16.")
    if value.year < 2020:  # no ledger row is older
        raise RangeError(field, "Choose a date from 2020 on.")
    if value.year > 2100:  # keeps day arithmetic on the range from overflowing
        raise RangeError(field, "Choose a date up to 2100.")
    return value


def optional_dates(params):
    """(date_from or None, date_to or None) from the query string; raises RangeError."""
    date_from, date_to = _date(params, "date_from"), _date(params, "date_to")
    if date_from is not None and date_to is not None and date_from > date_to:
        raise RangeError("date_from", "The start date is after the end date.")
    return date_from, date_to


def sale_groups(owner, *, status=None, date_from=None, date_to=None):
    """One row per order the business sold into while the ledger was on, newest first: its snapshots on that order
    summed (pesewas) and counted. `status` narrows to awaiting_call, released or refunded; the dates are the purchase day
    in Accra."""
    snapshots = OrderFeeSnapshot.objects.filter(business_owner=owner)
    if date_from is not None:
        snapshots = snapshots.filter(order__placed_at__date__gte=date_from)
    if date_to is not None:
        snapshots = snapshots.filter(order__placed_at__date__lte=date_to)
    groups = (
        snapshots.values("order_id")
        .annotate(
            placed_at=Max("order__placed_at"), base=Sum("base_pesewas"), fee=Sum("charged_pesewas"),
            refunded_base=Sum("refunded_base_pesewas"), refunded_fee=Sum("refunded_fee_pesewas"),
            parts=Count("id"), reversed_parts=Count("id", filter=Q(reversed_at__isnull=False)),
            open_parts=Count("id", filter=Q(released_at__isnull=True, reversed_at__isnull=True)),
            last_released=Max("released_at"),  # not "released_at": an annotation may not reuse a field's name
        )
        .order_by("-placed_at", "-order_id")
    )
    if status == AWAITING:
        groups = groups.filter(open_parts__gt=0)
    elif status == RELEASED:
        groups = groups.filter(open_parts=0).exclude(reversed_parts=F("parts"))
    elif status == REFUNDED:
        groups = groups.filter(reversed_parts=F("parts"))
    return groups


def status_of(group):
    """refunded once every snapshot is reversed (refunded whole); released once every one left was released; else the
    money still waits in Pending for Support's call (spec §4.1)."""
    if group["reversed_parts"] == group["parts"]:
        return REFUNDED
    if group["open_parts"] == 0:
        return RELEASED
    return AWAITING


def rows(owner, groups):
    """The API rows for these sale groups (one page, or a whole export range), in their order, in a fixed handful of
    queries whatever their number. `platform_fee` and `net` are what is left after refunds; `net` is what is (or will
    be) the business's: subtotal − refunded − fee − its free-delivery promo."""
    groups = list(groups)
    ids = [group["order_id"] for group in groups]
    orders = Order.objects.select_related("delivery_assignment").in_bulk(ids)
    checks = {check.order_id: check for check in FulfilmentCheck.objects.filter(order_id__in=ids)}
    items = {}
    for item in OrderItem.objects.filter(order_id__in=ids, listing__business_owner=owner).select_related("listing").order_by("pk"):
        items.setdefault(item.order_id, []).append(
            {"name": item.listing.name, "quantity": item.quantity, "line_total": money(to_pesewas(item.line_total))}
        )
    # The business's free-delivery promo on the order: owed until release, charged from Available then, reversed (and
    # given back) on a whole refund (ledger.escrow.charge_waiver / return_waiver), so OWED is what it pays.
    promos = {
        charge.order_id: to_pesewas(charge.amount)
        for charge in WaivedFeeCharge.objects.filter(order_id__in=ids, business_owner=owner, status=WaivedFeeCharge.OWED)
    }
    held = set(
        Dispute.objects.filter(order_id__in=ids).exclude(status__in=Dispute.FINAL_STATUSES).values_list("order_id", flat=True)
    )
    # A delivery case already final whose refund waits for approval also stops the release (the bulk form of
    # ledger.escrow.has_pending_refund), so Support's call cannot release the money yet.
    from approvals.models import ApprovalRequest

    dispute_orders = dict(Dispute.objects.filter(order_id__in=ids).values_list("pk", "order_id"))
    held |= {
        dispute_orders[int(target)] for target in ApprovalRequest.objects.filter(
            kind="delivery.refund_request", status=ApprovalRequest.PENDING, target_type="disputes.dispute",
            target_id__in=[str(pk) for pk in dispute_orders],
        ).values_list("target_id", flat=True)
    }
    out = []
    for group in groups:
        order = orders[group["order_id"]]
        status = status_of(group)
        handed_over = verification.handed_over(order, checks.get(order.pk) or FulfilmentCheck(order=order))
        on_hold = status == AWAITING and order.pk in held
        fee = group["fee"] - group["refunded_fee"]
        promo = promos.get(order.pk, 0)
        if status == AWAITING:
            label = ON_HOLD if on_hold else (WAITING_FOR_CALL if handed_over else WAITING_FOR_HANDOVER)
        else:
            label = LABELS[status]
        out.append({
            "kind": "order", "order": order.pk, "reference": f"Order #{order.pk}", "placed_at": order.placed_at,
            "items": items.get(order.pk, []),
            "item_subtotal": money(group["base"]), "refunded": money(group["refunded_base"]),
            "platform_fee": money(fee), "free_delivery_promo": money(promo),
            "net": money(group["base"] - group["refunded_base"] - fee - promo),
            "status": status, "status_label": label, "handed_over": handed_over, "on_hold": on_hold,
            "released_at": group["last_released"] if status == RELEASED else None,
        })
    return out


def fee_cap(owner, now=None):
    """The lifetime platform-fee cap (spec §1 row 2) as the business sees it: the cap in force (None: no cap), the fees
    charged so far against it, and what is left (None with no cap)."""
    cap = settings_store.current("fee_cap_pesewas", now)
    used = fees.charged_to_date(owner)
    return {
        "limit": money(cap) if cap is not None else None, "used": money(used),
        "remaining": money(max(cap - used, 0)) if cap is not None else None,
    }


def overview(owner, now=None):
    """Pending (waiting for Support's call), Available (released; may be negative after a late refund, which blocks
    withdrawals), what can be withdrawn (Available when positive, before the per-withdrawal and daily limits and a usable
    payout destination, which wallets.withdrawals checks), how many sales wait, and the fee cap."""
    pending = posting.balance_of(Account.VENDOR_PENDING, owner)
    available = posting.balance_of(Account.VENDOR_AVAILABLE, owner)
    return {
        "pending": money(pending), "available": money(available), "withdrawable": money(max(available, 0)),
        "negative": available < 0, "awaiting_call": sale_groups(owner, status=AWAITING).count(),
        "fee_cap": fee_cap(owner, now),
    }


# --- the daily summary (Task 2) ------------------------------------------------------------------------------------

OWNER_TYPE = BusinessOwner._meta.label_lower
P, A = Account.VENDOR_PENDING, Account.VENDOR_AVAILABLE
DR, CR = JournalLine.DEBIT, JournalLine.CREDIT
# How each ledger line on a business's own accounts counts in its daily summary: (journal kind, account, side) ->
# (column, sign). The release takes the item subtotal out of Pending (a debit) and credits Available with it less the
# platform fee, so the fee is the difference. Any other line lands in "other" (credits in, debits out), so for every day
#   sold - fees - refunded - free_delivery_promo - withdrawn + other = net_change (the change in Pending + Available).
# Booking sales (Plan 1b) add their booking_* kinds here (spec §13 (lxxii)).
FOLD = {
    ("order_payment", P, CR): ("sold", 1),
    ("order_release", P, DR): ("fees", 1),
    ("order_release", A, CR): ("fees", -1),
    ("order_refund", P, DR): ("refunded", 1),
    ("order_refund", A, DR): ("refunded", 1),
    ("order_refund", A, CR): ("refunded", -1),
    ("order_waiver_charge", A, DR): ("free_delivery_promo", 1),
    ("order_waiver_return", A, CR): ("free_delivery_promo", -1),
    ("withdrawal_hold", A, DR): ("withdrawn", 1),
    ("withdrawal_reversed", A, CR): ("withdrawn", -1),
}
COLUMNS = ("sold", "fees", "released", "refunded", "free_delivery_promo", "withdrawn", "other", "net_change")


def account(owner, kind):
    """The business's own ledger account of `kind`, or None when none was ever opened (reading never opens one)."""
    return Account.objects.filter(kind=kind, owner_type=OWNER_TYPE, owner_id=str(owner.pk)).first()


def date_range(params, *, default_days, max_days, today=None):
    """(first, last) Accra days, inclusive, from ?date_from=&date_to=: by default the last `default_days` days up to
    today; at most `max_days` days. Raises RangeError (a date outside 2020..2100 is refused by optional_dates, so the day
    sums below never overflow)."""
    today = today or timezone.localdate()
    date_from, date_to = optional_dates(params)
    date_to = date_to or today
    date_from = date_from or date_to - timedelta(days=default_days - 1)
    if date_from > date_to:
        raise RangeError("date_from", "The start date is after the end date.")
    if (date_to - date_from).days + 1 > max_days:
        raise RangeError("date_from", f"Choose at most {max_days} days.")
    return date_from, date_to


def bounds(first, last):
    """[start, end) aware datetimes covering the Accra days first..last."""
    zone = timezone.get_current_timezone()
    return (
        timezone.make_aware(datetime.combine(first, time.min), zone),
        timezone.make_aware(datetime.combine(last + timedelta(days=1), time.min), zone),
    )


def _blank():
    return {"orders": 0, **{column: 0 for column in COLUMNS}}


def _shown(row):
    return {"orders": row["orders"], **{column: money(row[column]) for column in COLUMNS}}


def daily(owner, first, last):
    """The business's money for the Accra days first..last, from the journal lines on its own Pending and Available
    accounts (never another holder's: accounts are matched by kind, owner type and id). Newest day first; days when
    nothing moved are left out; `totals` covers the range. `orders` counts the payments into Pending; `released` is what
    moved to Available at release (shown, not part of the identity in FOLD's note)."""
    accounts = [found for found in (account(owner, P), account(owner, A)) if found is not None]
    days = {}
    if accounts:
        start, end = bounds(first, last)
        lines = (
            JournalLine.objects.filter(account__in=accounts, journal__created_at__gte=start, journal__created_at__lt=end)
            .annotate(day=TruncDate("journal__created_at"))
            .values("day", "journal__kind", "account__kind", "side")
            .annotate(total=Sum("amount"), journals=Count("journal", distinct=True))
            .order_by()
        )
        for line in lines:
            row = days.setdefault(line["day"], _blank())
            key = (line["journal__kind"], line["account__kind"], line["side"])
            signed = line["total"] if line["side"] == CR else -line["total"]
            if key in FOLD:
                column, sign = FOLD[key]
                row[column] += sign * line["total"]
            else:
                row["other"] += signed
            row["net_change"] += signed
            if key == ("order_payment", P, CR):
                row["orders"] += line["journals"]
            if key == ("order_release", A, CR):
                row["released"] += line["total"]
    totals = _blank()
    for row in days.values():
        for name in ("orders", *COLUMNS):
            totals[name] += row[name]
    return {
        "from": first, "to": last,
        "days": [{"day": day, **_shown(days[day])} for day in sorted(days, reverse=True)],
        "totals": _shown(totals),
    }


# --- the statement (Task 3) ----------------------------------------------------------------------------------------

STATEMENT_HEADER = [
    "Date", "Type", "Reference", "Gross (GHS)", "Platform fee (GHS)", "Free-delivery promo (GHS)", "Refunded (GHS)",
    "Withdrawal charge (GHS)", "Amount (GHS)", "Status",
]
SALE_STATEMENT_STATUS = {AWAITING: "Pending", RELEASED: "Available", REFUNDED: "Refunded"}
WITHDRAWAL_STATEMENT_STATUS = {
    Withdrawal.PENDING: "Withdrawal in progress", Withdrawal.PROCESSING: "Withdrawal in progress",
    Withdrawal.SUCCEEDED: "Withdrawn", Withdrawal.FAILED: "Returned to Available", Withdrawal.CANCELLED: "Returned to Available",
}


def statement(owner, first, last):
    """The business's statement for the Accra days first..last, oldest first (spec §6, the transactions page's export):
    each sale bought on those days (gross, the platform fee shown separately, the free-delivery promo, what was refunded,
    the amount due or paid, and Pending / Available / Refunded) and each withdrawal asked for on them (what left
    Available, the provider's charge, what arrived; Withdrawn, in progress or returned). Every cell is a date, a number,
    a fixed word or an AshantiHub reference - no item name, note or person - so a spreadsheet never runs a formula from it
    (the text cells still go through reports.exports.escape_cell, as the repo's other exports do; numbers are left alone,
    a net can be negative)."""
    from reports.exports import escape_cell

    entries = []
    for row in rows(owner, sale_groups(owner, date_from=first, date_to=last)):
        entries.append((row["placed_at"], 0, row["order"], [
            timezone.localdate(row["placed_at"]).isoformat(), "Sale", escape_cell(row["reference"]), row["item_subtotal"],
            row["platform_fee"], row["free_delivery_promo"], row["refunded"], "", row["net"],
            escape_cell(SALE_STATEMENT_STATUS[row["status"]]),
        ]))
    holder_type, holder_id = ref(owner)
    start, end = bounds(first, last)
    for withdrawal in Withdrawal.objects.filter(
        holder_type=holder_type, holder_id=holder_id, created_at__gte=start, created_at__lt=end,
    ):
        entries.append((withdrawal.created_at, 1, withdrawal.pk, [
            timezone.localdate(withdrawal.created_at).isoformat(), "Withdrawal", escape_cell(withdrawal.reference),
            money(withdrawal.amount_pesewas), "", "", "", money(withdrawal.charge_pesewas), money(withdrawal.net_pesewas),
            escape_cell(WITHDRAWAL_STATEMENT_STATUS[withdrawal.status]),
        ]))
    entries.sort(key=lambda entry: entry[:3])
    return [entry[3] for entry in entries]
