"""One service for targets and actuals (spec S6), read by Today, Targets,
Visits, reports and later the Operations scoreboard.

A target is a daily value per measure; a day counts only if it is a working
day for that scout (their weekday pattern, minus public holidays and leave).
Actuals are counted from source records, never typed in."""
from datetime import timedelta

from django.db.models import F, Q
from django.utils import timezone

from reports.providers import day_bounds
from reports.services import period_bounds

from .models import CALLS, DEFAULT_WEEKDAYS, METRICS, REGISTRATIONS, RENEWALS, VISITS, Leave, PublicHoliday, TargetPlan, WorkPattern

LABELS = {REGISTRATIONS: "Registrations", VISITS: "Visits", CALLS: "Calls", RENEWALS: "Renewals"}
HOW = {
    REGISTRATIONS: "Count when Operations approves KYC",
    VISITS: "Count when you check out",
    CALLS: "Calls you log",
    RENEWALS: "Owner pays the subscription in the app",
}
WORKING, OFF, HOLIDAY, ON_LEAVE = "working", "off", "holiday", "leave"


class Calendar:
    """What the targets of one staff member look like over start..end, read
    from the database once so a month of days costs a handful of queries."""

    def __init__(self, staff, start, end):
        self.staff, self.start, self.end = staff, start, end
        pattern = WorkPattern.objects.filter(staff=staff).first()
        self.weekdays = set(pattern.weekdays) if pattern is not None else set(DEFAULT_WEEKDAYS)
        self.holidays = {h.date: h.name for h in PublicHoliday.objects.filter(date__gte=start, date__lte=end)}
        self.leaves = list(Leave.objects.filter(staff=staff, start__lte=end, end__gte=start).select_related("recorded_by"))
        self.plans = {metric: [] for metric in METRICS}
        for plan in TargetPlan.objects.filter(staff=staff, effective_from__lte=end).select_related("set_by"):
            self.plans[plan.metric].append(plan)
        for plans in self.plans.values():
            plans.sort(key=lambda p: (p.effective_from, p.id), reverse=True)

    def state(self, day):
        if day.weekday() not in self.weekdays:
            return OFF
        if day in self.holidays:
            return HOLIDAY
        if any(leave.start <= day <= leave.end for leave in self.leaves):
            return ON_LEAVE
        return WORKING

    def plan_on(self, metric, day):
        """The plan row in force on `day`, or None when no target was set by then."""
        return next((p for p in self.plans[metric] if p.effective_from <= day), None)

    def daily(self, metric, day):
        if self.state(day) != WORKING:
            return 0
        plan = self.plan_on(metric, day)
        return plan.daily_value if plan is not None else 0

    def has_plan(self, metric):
        return bool(self.plans[metric])

    def days(self, start=None, end=None):
        day, last = start or self.start, end or self.end
        while day <= last:
            yield day
            day += timedelta(days=1)

    def total(self, metric, start=None, end=None):
        return sum(self.daily(metric, day) for day in self.days(start, end))


def is_working_day(staff, day):
    return Calendar(staff, day, day).state(day) == WORKING


def daily_target(staff, metric, day):
    """The plan in force on `day` if it is a working day for the scout, else 0."""
    return Calendar(staff, day, day).daily(metric, day)


def target(staff, metric, start, end):
    """The sum of the daily targets over start..end (0 where no target was set)."""
    return Calendar(staff, start, end).total(metric)


def actual(staff, metric, start, end):
    """What the scout did over the local days start..end, from source records."""
    low, high = day_bounds(start, end)
    if metric == REGISTRATIONS:
        from accounts.models import BusinessOwner

        return BusinessOwner.objects.filter(
            registered_by=staff, kyc_status=BusinessOwner.VERIFIED, reviewed_at__gte=low, reviewed_at__lt=high,
        ).count()
    if metric == VISITS:
        from field.models import VisitCheckIn

        # Outside-radius visits count (they are flagged, not dropped); open and abandoned ones don't.
        return VisitCheckIn.objects.filter(
            scout=staff, status=VisitCheckIn.DONE, checked_in_at__gte=low, checked_in_at__lt=high,
        ).count()
    if metric == CALLS:
        from calls.models import CallLog

        return CallLog.objects.filter(staff=staff, started_at__gte=low, started_at__lt=high).count()
    if metric == RENEWALS:
        from billing.models import Transaction

        # A renewal belongs to whoever managed the business when it was paid.
        # One filter() call, so the assignment's start and end are tested on the same row.
        return Transaction.objects.filter(
            Q(business_owner__manager_assignments__ended_at__isnull=True) | Q(business_owner__manager_assignments__ended_at__gt=F("created_at")),
            status=Transaction.SUCCESS, checkout_sessions__kind="subscription", created_at__gte=low, created_at__lt=high,
            business_owner__manager_assignments__scout=staff,
            business_owner__manager_assignments__started_at__lte=F("created_at"),
        ).distinct().count()
    raise ValueError(f"Unknown measure {metric}")


def _day_state(calendar, day, today):
    state = calendar.state(day)
    if state in (HOLIDAY, ON_LEAVE):
        return state
    if day == today:
        return "today"
    return "done" if day < today else "ahead"


def period_summary(staff, period, day, *, today=None):
    """The Targets screen for one scout: the period's numbers per measure."""
    today = today or timezone.localdate()
    start, end = period_bounds(period, day)
    calendar = Calendar(staff, start, end)
    focus = day if period == "day" else today if start <= today <= end else None
    pattern_days = [d for d in calendar.days() if calendar.state(d) != OFF]
    working = [d for d in pattern_days if calendar.state(d) == WORKING]
    on_leave = [d for d in pattern_days if calendar.state(d) == ON_LEAVE]
    in_force = focus or end  # the plans to show as "your daily targets"

    measures = []
    for metric in METRICS:
        has_plan = calendar.has_plan(metric)
        measure = {
            "metric": metric, "label": LABELS[metric], "how": HOW[metric],
            "done": actual(staff, metric, start, end),
            "target": calendar.total(metric) if has_plan else None,
            "today_done": None, "today_target": None,
        }
        if focus is not None:
            measure["today_done"] = actual(staff, metric, focus, focus)
            measure["today_target"] = calendar.daily(metric, focus) if has_plan else None
        measures.append(measure)

    plans = [p for p in (calendar.plan_on(m, in_force) for m in METRICS) if p is not None]
    latest = max(plans, key=lambda p: (p.effective_from, p.id)) if plans else None
    return {
        "period": period,
        "label": _period_label(period, start, end),
        "start": start, "end": end, "today": today,
        "working_days": len(working), "leave_days": len(on_leave),
        "holiday_days": sum(1 for d in pattern_days if calendar.state(d) == HOLIDAY),
        "has_targets": any(calendar.has_plan(m) for m in METRICS),
        "measures": measures,
        "days": [
            {"date": d, "state": _day_state(calendar, d, today),
             **({"holiday": calendar.holidays[d]} if d in calendar.holidays else {})}
            for d in pattern_days
        ],
        "daily": [
            {"metric": m, "label": LABELS[m], "value": (calendar.plan_on(m, in_force).daily_value if calendar.plan_on(m, in_force) else None)}
            for m in METRICS
        ],
        "set_by": latest.set_by.full_name if latest is not None else None,
        "effective_from": latest.effective_from if latest is not None else None,
        "sunday_off": 6 not in calendar.weekdays,
        "leave": [
            {"start": leave.start, "end": leave.end, "kind": leave.kind, "recorded_by": leave.recorded_by.full_name}
            for leave in sorted(calendar.leaves, key=lambda x: x.start)
        ],
        "holidays": [{"date": d, "name": n} for d, n in sorted(calendar.holidays.items())],
        "lead": {"id": staff.manager_id, "name": staff.manager.full_name} if staff.manager_id else None,
    }


def _period_label(period, start, end):
    if period == "day":
        return f"{start:%a} {start.day} {start:%B}"
    if period == "week":
        return f"{start:%a} {start.day} – {end:%a} {end.day} {end:%B}"
    return f"{start:%B %Y}"


def month_total_with(staff, metric, new_value, effective_from, today):
    """The scout's total for the month of `today` if a plan of `new_value`
    started on `effective_from`, against what it is now: (before, after)."""
    start, end = period_bounds("month", today)
    calendar = Calendar(staff, start, end)
    before = calendar.total(metric)
    after = 0
    for day in calendar.days():
        if calendar.state(day) != WORKING:
            continue
        after += new_value if day >= effective_from else calendar.daily(metric, day)
    return before, after
