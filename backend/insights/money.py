"""Refunds and commissions, read from the records that exist. A refund here is
a dispute resolved with a refund amount, or an event ticket refunded by staff;
there is no refund request, approval step, threshold or "paid from" record, so
none is shown. Commission lines come from commission.CommissionAccrual; the
"in batch" and "paid" columns stay empty until payout batches exist."""
from collections import defaultdict
from decimal import Decimal

from django.db.models import Sum

from accounts.models import StaffUser
from commission.models import CommissionAccrual, CommissionPolicy
from commission.services import REVERSAL_LABELS, policy_in_force
from disputes.models import Dispute
from events.models import Ticket

from . import sales

ZERO = Decimal("0.00")


def _owner_names(order):
    names = sorted({i.listing.business_owner.display_name for i in order.items.all()})
    return names[0] if len(names) == 1 else f"{len(names)} businesses" if names else ""


def refund_rows(start, end):
    low, high = sales.window(start, end)
    rows = []
    disputes = (
        Dispute.objects.filter(status=Dispute.RESOLVED, refund_amount__gt=0, updated_at__gte=low, updated_at__lt=high)
        .select_related("raised_by", "order__customer", "flagged_by", "resolved_by")
        .prefetch_related("order__items__listing__business_owner__profile")
    )
    for d in disputes:
        customer = d.raised_by or (d.order.customer if d.order_id else None)
        rows.append({
            "ref": f"DR-{d.pk}", "source": "dispute", "source_label": "Dispute", "detail": d.get_reason_display(),
            "customer": customer.full_name if customer else "", "business": _owner_names(d.order) if d.order_id else "",
            "order": d.order_id, "raised_by": d.flagged_by.full_name if d.flagged_by else "", "decided_by": d.resolved_by.full_name if d.resolved_by else "",
            "at": d.updated_at, "amount": sales.money(d.refund_amount), "status": "refunded",
        })
    tickets = (
        Ticket.objects.filter(refunded_at__gte=low, refunded_at__lt=high)
        .select_related("purchased_by", "refunded_by_staff", "ticket_type__event")
    )
    for t in tickets:
        event = t.ticket_type.event
        rows.append({
            "ref": f"TK-{t.pk}", "source": "ticket", "source_label": "Event ticket", "detail": t.refund_reason or event.name,
            "customer": t.purchased_by.full_name, "business": event.name, "order": None,
            "raised_by": "", "decided_by": t.refunded_by_staff.full_name if t.refunded_by_staff else "",
            "at": t.refunded_at, "amount": sales.money(t.price), "status": "refunded",
        })
    rows.sort(key=lambda r: r["at"], reverse=True)
    return rows


def refunds_report(start, end, source=None):
    rows = refund_rows(start, end)
    total = sum((Decimal(r["amount"]) for r in rows), ZERO)
    by_source = {"dispute": ZERO, "ticket": ZERO}
    counts = {"dispute": 0, "ticket": 0}
    for r in rows:
        by_source[r["source"]] += Decimal(r["amount"])
        counts[r["source"]] += 1
    lines, _ = sales.sales_lines(start, end)
    sales_total = sum((l["amount"] for l in lines), ZERO)
    shown = [r for r in rows if source in (None, "", "all") or r["source"] == source]
    return {
        "from": start, "to": end, "simulated": sales.simulated(),
        "kpis": {
            "refunded": sales.money(total), "count": len(rows),
            "share_of_sales": round(float(total / sales_total * 100), 1) if sales_total else None,
            "from_disputes": sales.money(by_source["dispute"]), "disputes": counts["dispute"],
            "from_tickets": sales.money(by_source["ticket"]), "tickets": counts["ticket"],
        },
        "rows": shown,
        "not_recorded": [
            {"name": "Refund requests and approval", "why": "There is no refund request or approval step yet; only refunds already recorded are listed. It arrives with the Accounting phase."},
            {"name": "Paid from", "why": "Whether a refund came out of held money, a seller's next settlement or AshantiHub is not recorded."},
            {"name": "Returns, cancelled orders and delivery damage", "why": "These have no refund record of their own yet."},
        ],
    }


def refunds_document(report):
    return [(
        "Refunds",
        ["Refund", "Source", "Detail", "Customer", "Business", "Raised by", "Decided by", "Date", "Amount (GH₵)"],
        [[r["ref"], r["source_label"], r["detail"], r["customer"], r["business"], r["raised_by"], r["decided_by"], r["at"].strftime("%Y-%m-%d"), r["amount"]] for r in report["rows"]],
    )]


# ---------------------------------------------------------------- commissions

def _tax_note():
    from commission.services import tax_ruling_in_force

    ruling = tax_ruling_in_force()
    if ruling is None:
        return "Tax on commission depends on the scouts' status (PAYE if employees, 10% withholding tax if independent agents). It waits for an accountant or GRA ruling before the first payout."
    return f"Scouts are recorded as {ruling.get_status_display().lower()} (ruling of {ruling.ruled_on:%d %b %Y}, ref {ruling.reference}). AshantiHub calculates no tax."


def commission_report(year=None):
    from commission.views import totals

    accruals = CommissionAccrual.objects.all()
    scouts = {}
    for row in accruals.values("staff", "status").annotate(total=Sum("amount")):
        scouts.setdefault(row["staff"], {s: ZERO for s, _l in CommissionAccrual.STATUS_CHOICES})[row["status"]] = row["total"] or ZERO
    names = {s.pk: s for s in StaffUser.objects.filter(pk__in=list(scouts)).select_related("role")}
    rows = [
        {
            "staff_id": pk, "name": names[pk].full_name if pk in names else f"Staff {pk}", "active": bool(pk in names and names[pk].is_active),
            "on_hold": sales.money(v["on_hold"]), "payable": sales.money(v["payable"]), "in_batch": sales.money(v["in_batch"]),
            "paid": sales.money(v["paid"]), "reversed": sales.money(v["reversed"]),
        }
        for pk, v in scouts.items()
    ]
    rows.sort(key=lambda r: r["name"])
    summary = totals(accruals)
    policy = {}
    for kind, label in CommissionPolicy.KIND_CHOICES:
        in_force = policy_in_force(kind)
        policy[kind] = {"label": label, "amount": sales.money(in_force.amount) if in_force else None, "since": in_force.effective_from if in_force else None}
    return {
        "simulated": sales.simulated(), "totals": summary, "scouts": rows, "policy": policy,
        "batches": {"exist": False, "note": "No payout batches exist yet. They arrive with the Accounting phase, so nothing is in a batch and nothing is recorded as paid."},
        "tax_note": _tax_note(),
        "reversal_labels": REVERSAL_LABELS,
    }


def statement_document(staff_ids=None):
    accruals = CommissionAccrual.objects.select_related("staff", "business_owner__profile").order_by("staff__full_name", "-earned_at")
    if staff_ids is not None:
        accruals = accruals.filter(staff_id__in=staff_ids)
    rows = [
        [a.staff.full_name, a.business_owner.display_name, a.get_kind_display(), sales.money(a.amount), a.get_status_display(),
         a.earned_at.strftime("%Y-%m-%d"), a.hold_until.strftime("%Y-%m-%d"), REVERSAL_LABELS.get(a.reversed_reason, "")]
        for a in accruals
    ]
    return [("Commission statement", ["Scout", "Business", "Earned for", "Amount (GH₵)", "Status", "Earned", "Held until", "Reversed because"], rows)]
