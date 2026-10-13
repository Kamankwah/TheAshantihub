"""The "From the system" sections of a Delivery Manager's and a rider's reports, counted from source rows over the
whole local days start..end. A figure with no source (cash on delivery, pay) is not given a value: its row says it
is not available. Called by reports.providers."""
from django.db.models import Count, F, Q
from django.utils import timezone

from disputes.models import Dispute
from orders.models import DeliveryAssignment, Order
from reports.providers import day_bounds

from .models import DeliveryEvent, ShiftSession


def _on_time(qs):
    with_deadline = qs.filter(deadline_at__isnull=False)
    n = with_deadline.count()
    if not n:
        return "No delivery had a deadline (time limits not set)"
    return f"{with_deadline.filter(delivered_at__lte=F('deadline_at')).count()} of {n} delivered"


def delivery_manager_sections(staff, start, end):
    low, high = day_bounds(start, end)
    placed = Order.objects.filter(status=Order.PAID, delivery_method=Order.DOOR_TO_DOOR, placed_at__gte=low, placed_at__lt=high)
    jobs = DeliveryAssignment.objects.filter(assigned_at__gte=low, assigned_at__lt=high)
    delivered = DeliveryAssignment.objects.filter(delivered_at__gte=low, delivered_at__lt=high)
    failed = DeliveryAssignment.objects.filter(failed_at__gte=low, failed_at__lt=high)
    cases = Dispute.objects.filter(created_at__gte=low, created_at__lt=high).filter(Q(reason=Dispute.DELIVERY_ISSUE) | ~Q(case_type=""))
    flagged = DeliveryEvent.objects.filter(at__gte=low, at__lt=high, flagged=True)
    per_rider = delivered.values("dispatch__full_name").annotate(n=Count("id")).order_by("-n", "dispatch__full_name")[:12]
    reasons = {}
    for reason in failed.values_list("failed_reason", flat=True):
        reasons[reason or "other"] = reasons.get(reason or "other", 0) + 1
    return [
        {"key": "deliveries", "title": "Deliveries", "rows": [
            {"label": "Door-to-door orders placed", "value": placed.count()},
            {"label": "Delivered", "value": delivered.count()},
            {"label": "On time", "value": _on_time(delivered)},
            {"label": "Could not deliver", "value": failed.count()},
            {"label": "Failure reasons", "value": ", ".join(f"{k.replace('_', ' ')} {v}" for k, v in sorted(reasons.items())) or "None"},
            {"label": "Assigned by auto-assign", "value": jobs.filter(assignment_mode__in=("auto", "offer")).count()},
            {"label": "Assigned by hand or forced", "value": jobs.filter(assignment_mode__in=("manual", "forced")).count()},
        ]},
        {"key": "cases", "title": "Disputes and returns", "rows": [
            {"label": "New cases", "value": cases.count()},
            {"label": "Decided", "value": cases.filter(status__in=Dispute.FINAL_STATUSES).count()},
            {"label": "Open now", "value": Dispute.objects.filter(status__in=(Dispute.OPEN, Dispute.INVESTIGATING)).filter(Q(reason=Dispute.DELIVERY_ISSUE) | ~Q(case_type="")).count()},
        ]},
        {"key": "checkins", "title": "Check-ins and cash", "rows": [
            {"label": "Check-ins over 150 m", "value": flagged.count()},
            {"label": "Shifts started", "value": ShiftSession.objects.filter(started_at__gte=low, started_at__lt=high).count()},
            {"label": "Cash on delivery", "value": "Not offered at checkout yet"},
        ]},
        {"key": "riders", "title": "Deliveries by rider", "rows": [{"label": r["dispatch__full_name"] or "Unassigned", "value": r["n"]} for r in per_rider]},
    ]


def dispatch_sections(staff, start, end):
    low, high = day_bounds(start, end)
    mine = DeliveryAssignment.objects.filter(dispatch=staff)
    delivered = mine.filter(delivered_at__gte=low, delivered_at__lt=high)
    flagged = DeliveryEvent.objects.filter(by=staff, at__gte=low, at__lt=high, flagged=True)
    shifts = ShiftSession.objects.filter(rider__staff=staff, started_at__gte=low, started_at__lt=high)
    return [{"key": "jobs", "title": "My jobs", "rows": [
        {"label": "Accepted", "value": mine.filter(accepted_at__gte=low, accepted_at__lt=high).count()},
        {"label": "Delivered", "value": delivered.count()},
        {"label": "On time", "value": _on_time(delivered)},
        {"label": "Could not deliver", "value": mine.filter(failed_at__gte=low, failed_at__lt=high).count()},
        {"label": "Check-ins over 150 m", "value": flagged.count()},
        {"label": "Shifts", "value": shifts.count()},
        {"label": "Cash handed in", "value": "Not available: cash on delivery is not offered yet"},
    ]}]
