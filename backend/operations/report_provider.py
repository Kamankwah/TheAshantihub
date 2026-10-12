"""The Operations lead's "From the system" sections (spec S13): the team's
four measures against the sum of the scouts' targets, a per-scout table,
approvals decided with the median time to decide, at-risk businesses, fraud
cases, and the team's reports acknowledged or returned. Counted from source
records over the whole local days start..end; the snapshot taken on submit
freezes it. Called by reports.providers.

Support issues and delivery cases have no records yet (their screens come
later), so no row about them is made up here."""
from datetime import timedelta
from statistics import median

from django.db.models import Q
from django.utils import timezone

from reports.providers import day_bounds


def _duration(seconds):
    minutes = round(seconds / 60)
    hours, minutes = divmod(minutes, 60)
    if hours and minutes:
        return f"{hours} h {minutes} min"
    return f"{hours} h" if hours else f"{minutes} min"


def _of(done, target):
    return f"{done} / {target}" if target is not None else f"{done}"


def operations_sections(staff, start, end):
    from approvals.models import ApprovalRequest
    from fraud.models import FraudFlag
    from fraud.views import visible_flags
    from portfolio import health
    from portfolio.models import BusinessHealthSnapshot
    from portfolio.views import portfolio_queryset
    from reports.models import StaffReport
    from targets import services as target_services
    from targets.models import METRICS

    from .scoreboard import scouts_in_scope

    low, high = day_bounds(start, end)
    now = timezone.now()
    today = timezone.localdate(now)
    upto = min(end, today)
    scouts = list(scouts_in_scope(staff, "team"))

    totals = {metric: {"done": 0, "target": 0, "planned": 0} for metric in METRICS}
    table = []
    for scout in scouts:
        calendar = target_services.Calendar(scout, start, end)
        cells = []
        for metric in METRICS:
            done = target_services.actual(scout, metric, start, upto) if upto >= start else 0
            planned = calendar.has_plan(metric)
            target = calendar.total(metric, start, end) if planned else None
            totals[metric]["done"] += done
            if planned:
                totals[metric]["target"] += target
                totals[metric]["planned"] += 1
            cells.append(_of(done, target) if planned or done else "—")
        working = [d for d in calendar.days(start, upto) if calendar.state(d) == target_services.WORKING]
        in_days = StaffReport.objects.filter(
            staff=scout, period=StaffReport.DAY, period_start__gte=start, period_start__lte=upto,
            status__in=[StaffReport.SUBMITTED, StaffReport.ACKNOWLEDGED],
        ).count()
        if not working and start == end:
            report = "On leave" if calendar.state(start) == target_services.ON_LEAVE else "Not working"
        elif start == end:
            report = "Submitted" if in_days else "Not yet"
        else:
            report = f"{in_days} of {len(working)} days"
        cells.append(report)
        table.append({"label": scout.full_name, "value": " · ".join(cells), "cells": cells})

    measure_rows = []
    for metric in METRICS:
        row = {"label": target_services.LABELS[metric], "value": totals[metric]["done"]}
        if totals[metric]["planned"]:
            row["target"] = totals[metric]["target"]
        measure_rows.append(row)

    decided = ApprovalRequest.objects.filter(decided_by=staff, decided_at__gte=low, decided_at__lt=high)
    waits = [(a.decided_at - a.created_at).total_seconds() for a in decided]
    approved = decided.filter(status=ApprovalRequest.APPROVED).count()
    returned = decided.filter(status=ApprovalRequest.REJECTED).count()
    approvals_rows = [
        {"label": "Decided", "value": len(waits)},
        {"label": "Approved", "value": approved},
        {"label": "Returned", "value": returned},
    ]
    if waits:
        approvals_rows.append({"label": "Median time to decide (clock time)", "value": _duration(median(waits))})

    ratings = {rating: 0 for rating in health.RATINGS}
    for row in health.rate_all(portfolio_queryset(staff, "team"), now):
        ratings[row.rating] += 1
    at_risk_rows = [{"label": "At risk now", "value": ratings[health.AT_RISK]}, {"label": "Needs attention now", "value": ratings[health.NEEDS_ATTENTION]}]
    team_owners = portfolio_queryset(staff, "team").values("pk")
    snap_day = start - timedelta(days=1)
    snap = BusinessHealthSnapshot.objects.filter(date=snap_day, business_owner__in=team_owners)
    if snap.exists():
        was = snap.filter(rating=health.AT_RISK).count()
        change = ratings[health.AT_RISK] - was
        at_risk_rows.append({"label": f"Change since {snap_day:%-d %b}", "value": f"{change:+d}" if change else "0"})

    ids = [s.pk for s in scouts]
    team_cases = Q(business_owner__account_manager_id__in=ids) | Q(staff_subject_id__in=ids)
    flags = visible_flags(staff).filter(team_cases)
    fraud_rows = [
        {"label": "Raised", "value": flags.filter(created_at__gte=low, created_at__lt=high).count()},
        {"label": "Confirmed", "value": flags.filter(status=FraudFlag.CONFIRMED, resolved_at__gte=low, resolved_at__lt=high).count()},
        {"label": "Dismissed", "value": flags.filter(status=FraudFlag.DISMISSED, resolved_at__gte=low, resolved_at__lt=high).count()},
        {"label": "Still open now", "value": flags.filter(status=FraudFlag.OPEN).count()},
    ]

    reviewed = StaffReport.objects.filter(reviewer=staff, reviewed_at__gte=low, reviewed_at__lt=high)
    reports_rows = [
        {"label": "Acknowledged", "value": reviewed.filter(status=StaffReport.ACKNOWLEDGED).count()},
        {"label": "Returned", "value": reviewed.filter(status=StaffReport.RETURNED).count()},
        {"label": "Waiting for you now", "value": StaffReport.objects.filter(staff__manager=staff, staff__is_active=True, status=StaffReport.SUBMITTED).count()},
    ]

    return [
        {"key": "team_targets", "title": "Team against target", "rows": measure_rows,
         "summary": f"Target is the sum of the plans of {len(scouts)} {'scout' if len(scouts) == 1 else 'scouts'}. A registration counts at KYC approval."},
        {"key": "team_scouts", "title": "Scouts", "rows": table,
         "columns": [target_services.LABELS[m] for m in METRICS] + ["Day reports"]},
        {"key": "ops_approvals", "title": "Approvals you decided", "rows": approvals_rows},
        {"key": "ops_at_risk", "title": "At-risk businesses", "rows": at_risk_rows},
        {"key": "ops_fraud", "title": "Fraud cases", "rows": fraud_rows},
        {"key": "ops_reports", "title": "Your team's reports", "rows": reports_rows},
    ]
