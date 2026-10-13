"""Delivery disputes and returns (permission ``delivery.disputes`` to decide; ``delivery.manage`` to read).
The evidence is assembled from what was stamped; the decision is recorded, never executed as money: a refund is
an approval request (Super Admin) and payments are simulated, and the screen says so."""
from datetime import timedelta
from decimal import Decimal, InvalidOperation

from django.db import transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import HasAnyRolePermission, HasRolePermission, RequiresSudo
from approvals import services as approvals
from disputes.models import Dispute
from field.services import haversine_m
from fraud import services as fraud
from fraud.models import FraudFlag
from orders.models import DeliveryAssignment

from . import config, payloads, services
from .models import DeliveryEvent, Rider

OPEN = (Dispute.OPEN, Dispute.INVESTIGATING)
OUTCOMES = {"refund": "Refund the customer", "no_refund": "No refund", "redeliver": "Deliver again", "return_to_shop": "Return to the business"}
FAULTS = {"rider": "Rider", "business": "Business", "customer": "Customer", "none": "No one"}
FILTERS = {
    "not_received": Q(case_type="not_received") | Q(reason=Dispute.DELIVERY_ISSUE, case_type=""),
    "damaged": Q(case_type="damaged"), "wrong_item": Q(case_type="wrong_item"), "unreachable": Q(case_type="unreachable"), "return": Q(case_type="return"),
}


def delivery_cases():
    return Dispute.objects.filter(Q(reason=Dispute.DELIVERY_ISSUE) | ~Q(case_type="")).select_related("order", "order__customer", "rider", "resolved_by")


def due_at(d, limits):
    if d.answer_due_at:
        return d.answer_due_at
    return d.created_at + timedelta(hours=limits.dispute_answer_hours) if limits else None


def case_row(d, limits, now):
    due = due_at(d, limits)
    return {
        "id": d.pk, "order_id": d.order_id, "case_type": d.case_type or ("not_received" if d.reason == Dispute.DELIVERY_ISSUE else ""),
        "case_type_label": d.get_case_type_display() if d.case_type else "Delivery problem", "status": d.status, "status_label": d.get_status_display(),
        "customer": d.order.customer.full_name if d.order_id else None, "rider": d.rider.full_name if d.rider_id else None, "created_at": d.created_at,
        "answer_due_at": due, "minutes_left": int((due - now).total_seconds() // 60) if due and d.status in OPEN else None,
        "overdue": bool(due and d.status in OPEN and due < now),
    }


class CasesView(APIView):
    def get_permissions(self):
        return [HasAnyRolePermission("delivery.manage", "delivery.disputes")]

    def get(self, request):
        now = timezone.now()
        limits = config.effective_limits()
        cases = delivery_cases()
        kind = request.query_params.get("type")
        if kind in FILTERS:
            cases = cases.filter(FILTERS[kind])
        status = request.query_params.get("status", "open")
        if status == "open":
            cases = cases.filter(status__in=OPEN)
        elif status == "closed":
            cases = cases.filter(status__in=Dispute.FINAL_STATUSES, updated_at__gte=now - timedelta(days=7))
        rows = [case_row(d, limits, now) for d in cases.order_by("created_at")[:200]]
        base = delivery_cases()
        open_cases = base.filter(status__in=OPEN)
        counts = {k: open_cases.filter(q).count() for k, q in FILTERS.items()}
        return Response({
            "results": rows, "counts": counts, "open": open_cases.count(),
            "overdue": sum(1 for d in open_cases if (due_at(d, limits) or now) < now) if limits else None,
            "closed_7d": base.filter(status__in=Dispute.FINAL_STATUSES, updated_at__gte=now - timedelta(days=7)).count(),
            "answer_limit": "set" if limits else "none",
            "patterns": patterns(now),
        })


def patterns(now):
    """Repeat not-received claims per rider over 30 days, counted from the cases themselves (two or more)."""
    since = now - timedelta(days=30)
    out = []
    from django.db.models import Count

    rows = delivery_cases().filter(created_at__gte=since, rider__isnull=False).values("rider_id", "rider__full_name").annotate(n=Count("id")).filter(n__gte=2)
    for row in rows:
        out.append({"kind": "rider", "text": f"{row['rider__full_name']} is on {row['n']} delivery cases in 30 days", "rider_id": row["rider_id"]})
    return out


def speed_between(events):
    """km/h between consecutive stamped steps, from the stamps (straight-line)."""
    rows, previous = [], None
    for e in events:
        if previous and e.lat is not None and previous.lat is not None and e.at > previous.at:
            hours = (e.at - previous.at).total_seconds() / 3600
            km = haversine_m(previous.lat, previous.lng, e.lat, e.lng) / 1000
            rows.append({"from": previous.step, "to": e.step, "km": round(km, 2), "minutes": round(hours * 60), "kmh": round(km / hours) if hours else None})
        previous = e
    return rows


class CaseDetailView(APIView):
    def get_permissions(self):
        return [HasAnyRolePermission("delivery.manage", "delivery.disputes")]

    def get(self, request, pk):
        now = timezone.now()
        limits = config.effective_limits()
        d = get_object_or_404(delivery_cases(), pk=pk)
        assignment = DeliveryAssignment.objects.filter(order_id=d.order_id).select_related("dispatch", "dispatch__rider").first() if d.order_id else None
        events = list(assignment.events.all()) if assignment else []
        evidence = None
        if assignment:
            evidence = {
                "assignment_id": assignment.pk, "status": assignment.status, "timeline": [payloads.event_row(e) for e in events],
                "speeds": speed_between(events), "flagged": [e.step for e in events if e.flagged],
                "photos": [{"id": p.pk, "kind": p.kind, "at": p.at} for p in assignment.photos.all()],
                "calls": [{"kind": c.kind, "at": c.started_at, "outcome": c.outcome} for c in assignment.calls.all()],
                "code_tries": {"pickup": assignment.pickup_code_attempts, "drop": assignment.drop_code_attempts},
                "failed": {"reason": assignment.failed_reason, "note": assignment.failed_note, "at": assignment.failed_at} if assignment.failed_at else None,
                "rider_note": assignment.rider_note,
            }
        rider_staff = d.rider or (assignment.dispatch if assignment else None)
        rider = getattr(rider_staff, "rider", None) if rider_staff else None
        earlier = delivery_cases().filter(rider=rider_staff).exclude(pk=d.pk).count() if rider_staff else 0
        refund = None
        from approvals.models import ApprovalRequest

        for a in ApprovalRequest.objects.filter(kind=config.REFUND, payload__dispute_id=d.pk).select_related("maker", "decided_by").order_by("-created_at")[:1]:
            refund = {"approval_id": a.pk, "status": a.status, "amount": a.payload.get("amount"), "asked_by": a.maker.full_name, "decided_by": a.decided_by.full_name if a.decided_by_id else None}
        return Response({
            "case": case_row(d, limits, now), "description": d.description, "reason": d.reason,
            "order": {"id": d.order_id, "total": str(d.order.total_amount) if d.order_id else None, "placed_at": d.order.placed_at if d.order_id else None, "address": d.order.delivery_address if d.order_id else None},
            "evidence": evidence, "rider": {"id": rider.pk if rider else None, "staff_id": rider_staff.pk, "full_name": rider_staff.full_name, "other_cases": earlier} if rider_staff else None,
            "decision": {"outcome": d.outcome, "outcome_label": OUTCOMES.get(d.outcome, d.outcome), "fault": d.fault, "note": d.resolution_notes, "decided_at": d.decided_at,
                         "decided_by": payloads.person(d.resolved_by), "refund_amount": str(d.refund_amount) if d.refund_amount is not None else None} if d.decided_at else None,
            "refund": refund, "outcomes": OUTCOMES, "faults": FAULTS,
            "payments": "Payments are simulated until a payment provider is connected: a refund is recorded and approved, no money moves.",
        })


class DecideView(APIView):
    """POST cases/<id>/decide/ {outcome, fault, note, refund_amount, stop_rider_jobs, send_to_operations} — record the
    decision. Needs the password again (it can ask for a refund). The note is required."""

    def get_permissions(self):
        return [HasRolePermission("delivery.disputes"), RequiresSudo()]

    def post(self, request, pk):
        data = request.data
        outcome, fault, note = data.get("outcome"), data.get("fault"), str(data.get("note", "")).strip()
        if outcome not in OUTCOMES:
            return Response({"detail": "Choose an outcome.", "field": "outcome"}, status=400)
        if fault not in FAULTS:
            return Response({"detail": "Say who was at fault.", "field": "fault"}, status=400)
        if not note:
            return Response({"detail": "Write a note for the record.", "field": "note"}, status=400)
        amount = None
        if outcome == "refund":
            try:
                amount = Decimal(str(data.get("refund_amount"))).quantize(Decimal("0.01"))
            except (InvalidOperation, ValueError, TypeError):
                return Response({"detail": "Enter the refund amount in GH₵.", "field": "refund_amount"}, status=400)
        with transaction.atomic():
            d = get_object_or_404(delivery_cases().select_for_update(of=("self",)), pk=pk)
            if d.status in Dispute.FINAL_STATUSES:
                return Response({"detail": "This case has already been decided.", "code": "already_decided"}, status=409)
            if amount is not None and (amount <= 0 or (d.order_id and amount > d.order.total_amount)):
                return Response({"detail": "The refund must be more than 0 and no more than the order total.", "field": "refund_amount"}, status=400)
            d.status = Dispute.RESOLVED
            d.outcome, d.fault, d.resolution_notes = outcome, fault, note[:2000]
            d.refund_amount, d.resolved_by, d.decided_at = amount, request.user, timezone.now()
            if d.flagged_by_id is None:
                d.flagged_by = request.user
            d.save()
            rider_staff = d.rider
            if rider_staff is None and d.order_id:
                a = DeliveryAssignment.objects.filter(order_id=d.order_id).select_related("dispatch").first()
                rider_staff = a.dispatch if a else None
            if data.get("stop_rider_jobs") and rider_staff is not None:
                Rider.objects.filter(staff=rider_staff).update(job_hold=True, job_hold_reason=f"Case #{d.pk}"[:300])
            if data.get("send_to_operations"):
                fraud.raise_flag(
                    FraudFlag.OTHER, title=f"Delivery case #{d.pk} sent by the Delivery Manager", detail=note[:500],
                    staff_subject=rider_staff, raised_by=request.user, source=FraudFlag.STAFF, dedupe_key=f"delivery-case-{d.pk}",
                )
            approval = None
            if amount is not None:
                try:
                    approval = approvals.submit(
                        request.user, config.REFUND, title=f"Refund GH₵ {amount} for delivery case #{d.pk}", payload={"dispute_id": d.pk, "amount": str(amount)},
                        target=d, maker_note=note[:500], request=request,
                    )
                except approvals.ApprovalError as exc:
                    transaction.set_rollback(True)
                    return Response({"detail": exc.message}, status=400)
        return Response({"id": d.pk, "status": d.status, "refund_approval_id": approval.pk if approval else None})
