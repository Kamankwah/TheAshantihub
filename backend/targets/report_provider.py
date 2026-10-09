"""The scout's "From the system" sections (spec S13): the four measures from
targets.services (the same counts Today and Targets show), plus visits, calls
by outcome, registrations, approvals, follow-ups, the portfolio and commission.
Everything is counted from source records over the whole local days start..end;
the snapshot taken on submit freezes it. Called by reports.providers."""
from decimal import Decimal

from django.db.models import Count, Sum
from django.utils import timezone

from reports.providers import day_bounds

from . import services
from .models import METRICS


def _money(value):
    return f"{(value or Decimal('0')):.2f}"


def _plural(n, one, many):
    return f"{n} {one if n == 1 else many}"


def _targets(staff, start, end):
    calendar = services.Calendar(staff, start, end)
    rows = []
    for metric in METRICS:
        row = {"label": services.LABELS[metric], "value": services.actual(staff, metric, start, end)}
        if calendar.has_plan(metric):
            row["target"] = calendar.total(metric)
        rows.append(row)
    return rows


def scout_sections(staff, start, end):
    from accounts.models import BusinessOwner
    from approvals.models import ApprovalRequest
    from calls.models import CallLog
    from commission.models import CommissionAccrual
    from field.models import VisitCheckIn
    from portfolio import health
    from staff_tasks.models import Task

    low, high = day_bounds(start, end)
    now = timezone.now()

    # Follow-ups: tasks that fell due in the period.
    due = Task.objects.filter(owner=staff, due_at__gte=low, due_at__lt=high).exclude(status=Task.CANCELLED)
    done = due.filter(status=Task.DONE).count()
    missed = due.filter(status=Task.OPEN, due_at__lt=now).count()
    total = due.count()

    registered = BusinessOwner.objects.filter(registered_by=staff)
    waiting = registered.filter(kyc_status=BusinessOwner.PENDING).count()
    submitted = registered.filter(created_at__gte=low, created_at__lt=high).count()
    approved = registered.filter(kyc_status=BusinessOwner.VERIFIED, reviewed_at__gte=low, reviewed_at__lt=high).count()
    returned = registered.filter(kyc_status=BusinessOwner.REJECTED, reviewed_at__gte=low, reviewed_at__lt=high).count()

    lines = CommissionAccrual.objects.filter(staff=staff, earned_at__gte=low, earned_at__lt=high).exclude(status=CommissionAccrual.REVERSED)
    earned = lines.aggregate(total=Sum("amount"))["total"] or Decimal("0")
    held = lines.filter(status=CommissionAccrual.ON_HOLD).aggregate(total=Sum("amount"))["total"] or Decimal("0")

    summary = [f"Follow-ups {done} of {total} done", f"{_plural(waiting, 'registration', 'registrations')} waiting for KYC"]
    if earned:
        summary.append(f"GH₵ {_money(earned)} commission earned" + (", on hold" if held == earned else ""))

    visits = VisitCheckIn.objects.filter(scout=staff, status=VisitCheckIn.DONE, checked_in_at__gte=low, checked_in_at__lt=high)
    outcomes = {
        row["outcome"]: row["n"]
        for row in CallLog.objects.filter(staff=staff, started_at__gte=low, started_at__lt=high).values("outcome").annotate(n=Count("id"))
    }
    ratings = {rating: 0 for rating in health.RATINGS}
    for row in health.rate_all(BusinessOwner.objects.filter(account_manager=staff).exclude(kyc_status=BusinessOwner.REJECTED), now):
        ratings[row.rating] += 1

    return [
        {"key": "targets", "title": "Targets", "rows": _targets(staff, start, end), "summary": " · ".join(summary)},
        {"key": "visits", "title": "Visits", "rows": [
            {"label": "Visits done", "value": visits.count()},
            {"label": "Outside the business's radius", "value": visits.filter(outside_radius=True).count()},
        ]},
        {"key": "call_outcomes", "title": "Calls by outcome", "rows": [
            {"label": label, "value": outcomes[value]} for value, label in CallLog.OUTCOME_CHOICES if outcomes.get(value)
        ]},
        {"key": "registrations", "title": "Registrations", "rows": [
            {"label": "Submitted", "value": submitted},
            {"label": "Approved", "value": approved},
            {"label": "Returned", "value": returned},
            {"label": "Waiting for KYC now", "value": waiting},
        ]},
        {"key": "scout_approvals", "title": "Waiting for approval", "rows": [
            {"label": "Requests still pending", "value": ApprovalRequest.objects.filter(maker=staff, status=ApprovalRequest.PENDING).count()},
        ]},
        {"key": "follow_ups", "title": "Follow-ups", "rows": [
            {"label": "Done", "value": done}, {"label": "Missed", "value": missed},
        ]},
        {"key": "portfolio", "title": "My businesses now", "rows": [
            {"label": label, "value": ratings[rating]} for rating, label in (
                (health.AT_RISK, "At risk"), (health.NEEDS_ATTENTION, "Needs attention"), (health.NEW, "New"), (health.HEALTHY, "Healthy"),
            )
        ]},
        {"key": "commission", "title": "Commission", "rows": [
            {"label": "Earned in the period (GH₵)", "value": _money(earned)},
            {"label": "Of it on hold (GH₵)", "value": _money(held)},
        ]},
    ]
