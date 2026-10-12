"""The Operations scouts scoreboard (canvas screen 04), as a plain function so
the Overview (OP-4) and the report provider can reuse it.

Every number is read from source records through `targets.services` (targets,
calendar, actuals), `portfolio.health` (the health mix), `field` (check-ins),
`fraud` and `reports`; nothing is typed in. One row per active scout."""
from datetime import timedelta

from django.utils import timezone

from accounts.models import BusinessOwner, Role, StaffUser
from fraud.models import FraudFlag
from field.models import VisitCheckIn
from portfolio import health
from portfolio.areas import scout_areas
from reports import services as report_services
from reports.models import StaffReport
from reports.providers import day_bounds
from targets import services as target_services
from targets.models import METRICS, REGISTRATIONS, VISITS

SCOPES = ("team", "all")
FLAG_DAYS = 7


def scouts_in_scope(user, scope="team"):
    """Active, activated scouts: the caller's own team, or every scout. A Super
    Admin's team is every scout."""
    scouts = StaffUser.objects.filter(role__name=Role.SCOUT, is_active=True, invite_token__isnull=True).select_related("manager", "role")
    if scope == "team" and user.role.name != Role.SUPER_ADMIN:
        scouts = scouts.filter(manager=user)
    return scouts.order_by("full_name")


def _is_mine(user, scout):
    return user.role.name == Role.SUPER_ADMIN or scout.manager_id == user.pk


def _place(visit):
    if visit.business_owner_id:
        return visit.business_owner.display_name
    return visit.prospect.name if visit.prospect_id else "Visit"


def _leave_cut(calendar, metric, start, end):
    """What leave takes off the month's total: the total as if there were no leave, minus the total."""
    without = 0
    for day in calendar.days(start, end):
        if day.weekday() in calendar.weekdays and day not in calendar.holidays:
            plan = calendar.plan_on(metric, day)
            without += plan.daily_value if plan else 0
    return without - calendar.total(metric, start, end)


def _back_on(scout, today):
    """The first working day after the leave that covers `today`."""
    calendar = target_services.Calendar(scout, today, today + timedelta(days=45))
    return next((d for d in calendar.days() if d > today and calendar.state(d) == target_services.WORKING), None)


def _health_mix(scouts):
    owners = BusinessOwner.objects.filter(account_manager__in=scouts).exclude(kyc_status=BusinessOwner.REJECTED)
    mix = {s.pk: {"size": 0, "healthy": 0, "needs_attention": 0, "at_risk": 0, "new": 0} for s in scouts}
    for row in health.rate_all(owners, timezone.now()):
        bucket = mix[row.owner.account_manager_id]
        bucket["size"] += 1
        bucket[row.rating] += 1
    return mix


def scouts_scoreboard(user, scope="team", *, today=None, now=None):
    """The scoreboard for `user`: rows for `scope` ("team" or "all"), the team
    totals and both counts. Rows outside the caller's team carry mine=False
    (read-only for them)."""
    scope = scope if scope in SCOPES else "team"
    now = now or timezone.now()
    today = today or timezone.localdate()
    month_start, month_end = report_services.period_bounds("month", today)
    low, high = day_bounds(today, today)

    everyone = list(scouts_in_scope(user, "all"))
    team_count = sum(1 for s in everyone if _is_mine(user, s))
    scouts = [s for s in everyone if scope == "all" or _is_mine(user, s)]
    ids = [s.pk for s in scouts]

    areas = scout_areas(scouts)
    mix = _health_mix(scouts)
    today_visits = {}
    for visit in VisitCheckIn.objects.filter(scout_id__in=ids, checked_in_at__gte=low, checked_in_at__lt=high).exclude(status=VisitCheckIn.ABANDONED).select_related("business_owner__profile", "prospect").order_by("checked_in_at", "id"):
        today_visits.setdefault(visit.scout_id, []).append(visit)
    outside = {}
    for scout_id in VisitCheckIn.objects.filter(scout_id__in=ids, outside_radius=True, checked_in_at__gte=now - timedelta(days=FLAG_DAYS)).exclude(status=VisitCheckIn.ABANDONED).values_list("scout_id", flat=True):
        outside[scout_id] = outside.get(scout_id, 0) + 1
    open_cases = set(FraudFlag.objects.filter(kind=FraudFlag.OUTSIDE_RADIUS, status=FraudFlag.OPEN, staff_subject_id__in=ids).values_list("staff_subject_id", flat=True))
    reports = {}
    for report in StaffReport.objects.filter(staff_id__in=ids, period=StaffReport.DAY, period_start__gte=today - timedelta(days=10), period_start__lte=today).order_by("-period_start"):
        reports.setdefault(report.staff_id, []).append(report)

    rows = []
    totals = {m: {"done": 0, "target": 0} for m in METRICS}
    flagged_today = 0
    for scout in scouts:
        calendar = target_services.Calendar(scout, month_start, month_end)
        state = calendar.state(today)
        measures = {}
        for metric in METRICS:
            has_plan = calendar.has_plan(metric)
            measures[metric] = {
                "done": target_services.actual(scout, metric, today, today),
                "target": calendar.daily(metric, today) if has_plan else None,
            }
        month_done = target_services.actual(scout, REGISTRATIONS, month_start, month_end)
        has_plan = calendar.has_plan(REGISTRATIONS)
        due = calendar.total(REGISTRATIONS, month_start, today) if has_plan else None
        month = {
            "done": month_done,
            "target": calendar.total(REGISTRATIONS) if has_plan else None,
            "due_by_today": due,
            "on_pace": (month_done >= due) if has_plan else None,
            "leave_cut": _leave_cut(calendar, REGISTRATIONS, month_start, month_end) if has_plan else 0,
        }
        visits = today_visits.get(scout.pk, [])
        last = visits[-1] if visits else None
        mine = _is_mine(user, scout)
        if mine and state == target_services.WORKING:
            for metric in METRICS:
                totals[metric]["done"] += measures[metric]["done"]
                totals[metric]["target"] += measures[metric]["target"] or 0
        if mine:
            flagged_today += sum(1 for v in visits if v.outside_radius)

        own = reports.get(scout.pk, [])
        todays = next((r for r in own if r.period_start == today), None)
        previous = next((r for r in own if r.period_start < today), None)
        due_at = report_services.due_time_for(scout)
        row = {
            "id": scout.pk, "name": scout.full_name, "areas": areas.get(scout.pk, []),
            "manager": {"id": scout.manager_id, "name": scout.manager.full_name} if scout.manager_id else None,
            "mine": mine, "state": state,
            "back_on": _back_on(scout, today) if state == target_services.ON_LEAVE else None,
            "measures": measures, "month": month, "portfolio": mix.get(scout.pk, {}),
            "check_in": {
                "place": _place(last), "at": timezone.localtime(last.checked_in_at).isoformat(),
                "outside_radius": last.outside_radius, "distance_m": last.distance_m,
            } if last else None,
            "outside_7d": outside.get(scout.pk, 0), "fraud_case_open": scout.pk in open_cases,
            "report": {
                "today": {
                    "status": todays.status if todays else "not_yet",
                    "due": f"{due_at:%H:%M}",
                    "late": todays is None and state == target_services.WORKING and timezone.localtime(now).time() > due_at,
                    "is_late": bool(todays and todays.is_late),
                },
                "last": {
                    "date": previous.period_start, "status": previous.status, "is_late": previous.is_late,
                    "similar": previous.similarity >= report_services.SIMILARITY_FLAG,
                } if previous else None,
            },
        }
        rows.append(row)

    return {
        "scope": scope, "today": today, "month_label": f"{today:%B}", "now": now,
        "counts": {"team": team_count, "all": len(everyone)},
        "totals": {**totals, "visits_flagged": flagged_today},
        "scouts": rows,
    }
