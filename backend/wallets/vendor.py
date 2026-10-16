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
from django.db.models import Count, F, Max, Q, Sum
from django.utils.dateparse import parse_date

from disputes.models import Dispute
from ledger import fees, posting, settings_store, verification
from ledger.models import Account, FulfilmentCheck, OrderFeeSnapshot
from ledger.money import to_pesewas
from marketing.models_waivers import WaivedFeeCharge
from orders.models import Order, OrderItem

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
