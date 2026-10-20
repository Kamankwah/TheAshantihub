"""The Accountant's money screens, read from the records that exist: the Money
desk (overview), Collections and the money alerts. There is no ledger, payout,
payroll, tax or reconciliation record in AshantiHub yet, so nothing here
computes or implies one; what no record backs is named under "not recorded"."""
from collections import defaultdict
from datetime import timedelta
from decimal import Decimal

from django.db.models import Count, Q, Sum
from django.utils import timezone

from activity.models import ActivityEvent, ChainCheck
from commission.models import CommissionAccrual
from disputes.models import Dispute
from fraud.models import FraudFlag
from ledger import escrow
from payments.models import CheckoutSession

from . import money, sales

ZERO = Decimal("0.00")

# ----------------------------------------------------------------- money desk

OVERVIEW_NOT_RECORDED = [
    {"name": "Owed to sellers, riders and scouts", "why": "No payout, settlement or rider-pay record exists, so AshantiHub cannot say what is owed. It arrives with the Accounting phase."},
    {"name": "Customer funds account", "why": "There is no ledger or bank balance to compare held money against. Only event ticket money is held (below)."},
    {"name": "Taxes due", "why": "No tax is calculated anywhere yet. Rates wait for the accountant's confirmation."},
    {"name": "Payroll", "why": "No payroll, pay profile or payslip record exists."},
    {"name": "Reconciliation", "why": "There is no Hubtel settlement file, bank or mobile money statement to compare."},
]


def overview(staff, today=None):
    from approvals import services as approvals
    from core import later_phase

    today = today or timezone.localdate()
    start = sales.month_start(today)
    payouts = later_phase.payouts_overview()
    revenue = sales.revenue_lines(start, today)
    types = []
    for key, label, _note, _kinds in sales.REVENUE_TYPES:
        types.append({"key": key, "label": label, "amount": sales.money(sum((l["amount"] for l in revenue if l["type"] == key), ZERO))})
    total = sum((Decimal(t["amount"]) for t in types), ZERO)
    refunded, refund_n = sales.refunds_total(start, today)
    check = ChainCheck.objects.first()
    return {
        "now": timezone.now(), "simulated": payouts["simulated"],
        "tickets": payouts["tickets"],
        "commission": {"on_hold": payouts["commission"]["on_hold"], "payable": payouts["commission"]["payable"]},
        "revenue": {"from": start, "to": today, "total": sales.money(total), "types": types},
        "refunds": {"amount": sales.money(refunded), "count": refund_n},
        "disputes_waiting": Dispute.objects.filter(status__in=[Dispute.OPEN, Dispute.INVESTIGATING]).count(),
        "approvals_waiting": approvals.waiting_for(staff).count(),
        "chain": {"checked": True, "checked_at": check.checked_at, "ok": check.ok, "events": check.events} if check else {"checked": False},
        "not_recorded": OVERVIEW_NOT_RECORDED,
    }


# ----------------------------------------------------------------- collections

# checkout kind -> (type key, label). Delivery fees have no record, so no type.
COLLECTION_TYPES = [
    ("orders", "Orders", (CheckoutSession.ORDER_CHECKOUT,)),
    ("bookings", "Bookings and services", (CheckoutSession.BOOKING, CheckoutSession.SERVICE_REQUEST)),
    ("subscriptions", "Subscriptions", (CheckoutSession.SUBSCRIPTION,)),
    ("promotions", "Promotions and hero", (CheckoutSession.LISTING_PROMOTION, CheckoutSession.HERO_EXTEND)),
    ("event_fees", "Event listings", (CheckoutSession.EVENT_PAY, CheckoutSession.EVENT_RENEW)),
    ("tickets", "Tickets", (CheckoutSession.TICKET_PURCHASE,)),
    ("topups", "Wallet top-ups", (CheckoutSession.WALLET_TOPUP,)),
    ("redeliveries", "Re-delivery fees", (CheckoutSession.REDELIVERY_FEE,)),
]
KIND_LABEL = {kind: label for _k, label, kinds in COLLECTION_TYPES for kind in kinds}
KIND_TYPE = {kind: key for key, _l, kinds in COLLECTION_TYPES for kind in kinds}
STATUSES = ("success", "pending", "failed", "expired")
PAGE_SIZE = 100
WALLET_NOT_RECORDED = {
    "name": "Paid from a wallet",
    "why": "Orders, services, stays and tickets paid from an AshantiHub wallet are not collections; the money was counted when the wallet was topped up.",
}
COLLECTIONS_NOT_RECORDED = [
    {"name": "Delivery fees", "why": "Delivery fees are not charged yet, so no payment carries one."},
    {"name": "VAT, NHIL and GETFund", "why": "No tax is calculated anywhere yet, so no payment is split into tax."},
    {"name": "Where the money goes", "why": "Order and booking money is not held in escrow, so no payment is marked as held or released."},
]


def _wallet_in_use():
    """Wallet top-ups and wallet-paid orders, services, stays and tickets (all excluded from Collections) only exist
    once the ledger is on (or after it was): until then the screen
    shows no top-ups tile and no wallet note, exactly as before the wallets."""
    return escrow.enabled() or CheckoutSession.objects.filter(kind=CheckoutSession.WALLET_TOPUP).exists()


def _payer(session):
    if session.customer_id:
        return session.customer.full_name
    owner = session.business_owner
    return owner.display_name if owner else ""


def _filtered(start, end, kind, status, query):
    low, high = sales.window(start, end)
    # Wallet-paid sessions moved no provider money (the top-up that funded the wallet is already counted).
    base = CheckoutSession.objects.filter(created_at__gte=low, created_at__lt=high).exclude(provider=CheckoutSession.WALLET)
    if kind and kind != "all":
        wanted = next((kinds for key, _l, kinds in COLLECTION_TYPES if key == kind), ())
        base = base.filter(kind__in=wanted)
    if status and status != "all":
        base = base.filter(status=status)
    query = (query or "").strip()
    if query:
        base = base.filter(
            Q(reference__icontains=query) | Q(purpose__icontains=query) | Q(customer__full_name__icontains=query)
            | Q(business_owner__full_name__icontains=query) | Q(transaction__reference__icontains=query)
        )
    return base


EXPORT_LIMIT = 20000


def export_rows(start, end, *, kind=None, status=None, query=""):
    base = _filtered(start, end, kind, status, query)
    return base.select_related("customer", "business_owner__profile", "transaction").order_by("-created_at", "-id")[:EXPORT_LIMIT]


def collections(start, end, *, kind=None, status=None, query="", page=1):
    base = _filtered(start, end, kind, status, query)
    summary = {key: {"count": 0, "amount": ZERO} for key, _l, _k in COLLECTION_TYPES}
    for row in base.filter(status=CheckoutSession.SUCCESS).values("kind").annotate(n=Count("id"), total=Sum("amount")):
        bucket = summary[KIND_TYPE[row["kind"]]]
        bucket["count"] += row["n"]
        bucket["amount"] += row["total"] or ZERO
    total = base.count()
    wallet = _wallet_in_use()
    shown = [t for t in COLLECTION_TYPES if wallet or t[0] != "topups"]
    page = max(1, page)
    rows = base.select_related("customer", "business_owner__profile", "transaction").order_by("-created_at", "-id")[(page - 1) * PAGE_SIZE: page * PAGE_SIZE]
    return {
        "from": start, "to": end, "simulated": sales.simulated(), "count": total, "page": page, "page_size": PAGE_SIZE,
        "types": [{"key": key, "label": label} for key, label, _k in shown],
        "summary": [{"key": key, "label": label, "count": summary[key]["count"], "amount": sales.money(summary[key]["amount"])} for key, label, _k in shown],
        "rows": [_collection_row(s) for s in rows],
        "not_recorded": ([WALLET_NOT_RECORDED] if wallet else []) + COLLECTIONS_NOT_RECORDED,
    }


def _collection_row(s):
    return {
        "id": s.pk, "at": s.created_at, "type": KIND_TYPE.get(s.kind, s.kind), "type_label": KIND_LABEL.get(s.kind, s.kind),
        "payer": _payer(s), "what": s.purpose, "reference": s.reference,
        "provider": s.provider, "provider_reference": s.transaction.reference if s.transaction_id else "",
        "status": s.status, "amount": sales.money(s.amount),
    }


def collections_document(report):
    return [(
        "Collections",
        ["When", "Type", "Payer", "What", "Our reference", "Provider", "Provider reference", "Status", "Amount (GH₵)"],
        [[r["at"].strftime("%Y-%m-%d %H:%M"), r["type_label"], r["payer"], r["what"], r["reference"], r["provider"], r["provider_reference"], r["status"], r["amount"]] for r in report["rows"]],
    )]


# ------------------------------------------------------------- money alerts

OUTLIER_FACTOR = 3
OUTLIER_MIN_REFUNDS = 3
REPEAT_REFUNDS = 3
RESOLVED_VERB = "money_alert.resolved"

RULES = [
    {"key": "refund_outlier", "name": "A refund much larger than usual", "live": True,
     "what": f"A refund over {OUTLIER_FACTOR} times the average of the last 90 days (needs at least {OUTLIER_MIN_REFUNDS} refunds)."},
    {"key": "repeat_refunds", "name": "A business refunded again and again", "live": True,
     "what": f"{REPEAT_REFUNDS} or more disputes refunded against one business in 30 days."},
    {"key": "fraud_flag", "name": "An open fraud case on a business", "live": True,
     "what": "Shown for information. It is decided under Fraud cases by Operations."},
    {"key": "payout_details", "name": "Payout details changed recently", "live": False, "what": "Needs a change record for payout details; none is kept."},
    {"key": "manual_journal", "name": "A manual journal to cash", "live": False, "what": "Needs the ledger, which does not exist yet."},
    {"key": "rider_cash", "name": "A rider holding too much cash", "live": False, "what": "Needs rider cash-on-delivery records, which do not exist yet."},
    {"key": "reconciliation_age", "name": "An unmatched item that has waited too long", "live": False, "what": "Needs reconciliation, which does not exist yet."},
    {"key": "chain_failure", "name": "The audit chain failed", "live": False, "what": "Shown on the Audit chain screen and alerts every Super Admin; it is not repeated here."},
]


def _repeat_refund_alerts(now):
    low = now - timedelta(days=30)
    disputes = (
        Dispute.objects.filter(status=Dispute.RESOLVED, refund_amount__gt=0, updated_at__gte=low, order__isnull=False)
        .prefetch_related("order__items__listing__business_owner__profile")
    )
    by_owner = defaultdict(list)
    for d in disputes:
        for owner in {i.listing.business_owner for i in d.order.items.all()}:
            by_owner[owner].append(d)
    alerts = []
    for owner, items in by_owner.items():
        if len(items) >= REPEAT_REFUNDS:
            latest = max(items, key=lambda d: d.updated_at)
            alerts.append({
                "key": f"repeat_refunds:{owner.pk}:{latest.pk}", "rule": "repeat_refunds", "severity": "review",
                "title": f"{owner.display_name} refunded {len(items)} times in 30 days",
                "detail": f"Disputes {', '.join(f'DR-{d.pk}' for d in sorted(items, key=lambda d: d.pk))} were resolved with a refund.",
                "at": latest.updated_at, "resolvable": True,
            })
    return alerts


def _outlier_alerts(now):
    rows = money.refund_rows((now - timedelta(days=90)).date(), now.date())
    amounts = [Decimal(r["amount"]) for r in rows]
    if len(amounts) < OUTLIER_MIN_REFUNDS:
        return []
    average = sum(amounts, ZERO) / len(amounts)
    return [{
        "key": f"refund_outlier:{r['ref']}", "rule": "refund_outlier", "severity": "review",
        "title": f"{r['ref']} refunded {sales.money(r['amount'])}, about {round(float(Decimal(r['amount']) / average), 1)} times the average",
        "detail": f"{r['source_label']}: {r['detail']}. The 90-day average is {sales.money(average)} over {len(amounts)} refunds.",
        "at": r["at"], "resolvable": True,
    } for r in rows if Decimal(r["amount"]) > average * OUTLIER_FACTOR]


def _fraud_alerts():
    flags = FraudFlag.objects.filter(status=FraudFlag.OPEN, business_owner__isnull=False).select_related("business_owner__profile")[:50]
    # Title and business only: evidence and detail can hold personal data and stay under Fraud cases.
    return [{
        "key": f"fraud_flag:{f.pk}", "rule": "fraud_flag", "severity": "info",
        "title": f"Open fraud case on {f.business_owner.display_name}", "detail": f.get_kind_display(),
        "at": f.created_at, "resolvable": False,
    } for f in flags]


def money_alerts(now=None):
    now = now or timezone.now()
    alerts = _outlier_alerts(now) + _repeat_refund_alerts(now) + _fraud_alerts()
    keys = [a["key"] for a in alerts]
    resolved = {}
    if keys:
        for event in ActivityEvent.objects.filter(verb=RESOLVED_VERB, target_id__in=keys).order_by("id"):
            resolved[event.target_id] = {"by": event.actor_label, "at": event.occurred_at, "note": (event.after or {}).get("note", "")}
    for alert in alerts:
        alert["resolved"] = resolved.get(alert["key"])
    alerts.sort(key=lambda a: a["at"], reverse=True)
    return {
        "now": now, "alerts": alerts, "open": sum(1 for a in alerts if a["resolvable"] and not a["resolved"]),
        "rules": RULES,
    }


def alert_keys(now=None):
    return {a["key"] for a in money_alerts(now)["alerts"]}
