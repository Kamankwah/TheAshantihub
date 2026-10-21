"""Targets API (spec S6). A staff member reads their own targets; writes are
Operations' (own team) and Super Admin's, behind the permissions seeded in
accounts.0039: targets.manage, targets.limits, calendar.manage, leave.record."""
from datetime import date, timedelta

from django.db import IntegrityError, transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import Role, StaffUser
from accounts.permissions import HasAnyRolePermission, HasRolePermission, IsStaff, sees_every_team
from activity.models import ActivityEvent
from activity.services import record
from approvals import services as approvals

from portfolio.areas import scout_areas

from . import plans, services
from .models import METRICS, Leave, PublicHoliday, TargetLimit, WorkPattern

PERIODS = ("day", "week", "month")


def _error(message, code=status.HTTP_400_BAD_REQUEST):
    return Response({"detail": message}, status=code)


def _day(value, name="date"):
    if not value:
        return None
    try:
        return date.fromisoformat(str(value))
    except ValueError:
        raise plans.PlanError(f"Use YYYY-MM-DD for {name}.") from None


def _team_member(user, pk):
    """The staff member `pk` if the caller may act on them, else a refusal Response."""
    try:
        pk = int(pk)
    except (TypeError, ValueError):
        return None, _error("Choose a staff member.")
    staff = get_object_or_404(StaffUser.objects.select_related("manager", "role"), pk=pk)
    if not plans.in_scope(user, staff):
        return None, _error("You can only do this for your own team.", status.HTTP_403_FORBIDDEN)
    return staff, None


def _body(request):
    return request.data if isinstance(request.data, dict) else {}


class MyTargetsView(APIView):
    """GET me/?period=day|week|month&date=YYYY-MM-DD[&staff=id]"""

    permission_classes = [IsStaff]

    def get(self, request):
        period = request.query_params.get("period", "week")
        if period not in PERIODS:
            return _error("Use day, week or month.")
        try:
            day = _day(request.query_params.get("date"), "date") or timezone.localdate()
            staff = request.user
            if request.query_params.get("staff"):
                if "targets.manage" not in request.user.effective_permission_codenames():
                    return _error("You can only read your own targets.", status.HTTP_403_FORBIDDEN)
                staff, refused = _team_member(request.user, request.query_params["staff"])
                if refused:
                    return refused
            return Response(services.period_summary(staff, period, day))
        except plans.PlanError as exc:
            return _error(exc.message)
        except (OverflowError, ValueError):
            return _error("That date is out of range.")


class PlansView(APIView):
    """GET plans/ — the plan in force today for each scout on the caller's team
    (every active staff member with a manager, for a Super Admin). PUT sets one
    staff member's daily targets from a date, within the limits."""

    def get_permissions(self):
        return [HasRolePermission("targets.manage")]

    def get(self, request):
        team = StaffUser.objects.filter(is_active=True).select_related("role", "manager")
        team = team.exclude(pk=request.user.pk)
        team = team.filter(manager__isnull=False) if sees_every_team(request.user) else team.filter(manager=request.user)
        team = list(team.order_by("full_name"))
        today = timezone.localdate()
        cuts = plans.pending_cuts({s.pk for s in team})
        scouts = [s for s in team if s.role.name == Role.SCOUT]
        areas = scout_areas(scouts)
        return Response({
            "metrics": list(METRICS),
            "today": today,
            "limits": [_limit(x) for x in TargetLimit.objects.order_by("metric")],
            "staff": [
                {
                    "id": s.pk, "full_name": s.full_name, "role": s.role.name, "daily": plans.current_values(s),
                    "state": services.Calendar(s, today, today).state(today), "areas": areas.get(s.pk, []),
                    "joined": s.activated_at or s.created_at,
                    "pending_cut": cuts.get(s.pk),
                }
                for s in team
            ],
        })

    def put(self, request):
        data = _body(request)
        staff, refused = _team_member(request.user, data.get("staff"))
        if refused:
            return refused
        today = timezone.localdate()
        try:
            values = plans.clean_values(data.get("values"))
            effective_from = plans.parse_effective_from(data.get("effective_from"), today)
            plans.check_limits(values)
            now, cuts = plans.split_cuts(staff, values, effective_from, today)
            pending = None
            previous = plans.current_values(staff, list(now)) if now else {}
            with transaction.atomic():
                written = plans.write_plans(staff, now, effective_from, request.user) if now else []
                if cuts:
                    pending = approvals.submit(
                        request.user, "targets.cut", title=f"Lower {staff.full_name}'s daily targets", target=staff,
                        payload={"staff": staff.pk, "values": cuts, "effective_from": effective_from.isoformat()},
                        maker_note=str(data.get("note", ""))[:500], request=request,
                    )
                if now:
                    record(request.user, "targets.plan_set", target=staff, before={"values": previous}, after={"values": now, "effective_from": effective_from.isoformat()}, request=request)
        except plans.PlanError as exc:
            return _error(exc.message, exc.status_code)
        except approvals.ApprovalError as exc:
            return _error(exc.message, getattr(exc, "status_code", 400))
        return Response({
            "applied": sorted({p.metric for p in written} | (set(cuts) if pending is not None and pending.status == "approved" else set())),
            "pending_approval": {"id": pending.pk, "metrics": sorted(cuts), "status": pending.status} if pending is not None else None,
            "daily": plans.current_values(staff),
        }, status=status.HTTP_202_ACCEPTED if pending is not None and pending.status == "pending" and not written else status.HTTP_200_OK)


class PlansPreviewView(APIView):
    """POST plans/preview/ {changes: [{staff, values}], effective_from?} — what the typed
    targets would do to each scout's week and month (before -> after). Writes nothing."""

    def get_permissions(self):
        return [HasRolePermission("targets.manage")]

    def post(self, request):
        data = _body(request)
        items = data.get("changes")
        if not isinstance(items, list) or not items or len(items) > 100:
            return _error("Give the targets to preview.")
        today = timezone.localdate()
        try:
            effective_from = plans.parse_effective_from(data.get("effective_from"), today)
            changes = []
            for item in items:
                item = item if isinstance(item, dict) else {}
                staff, refused = _team_member(request.user, item.get("staff"))
                if refused:
                    return refused
                changes.append((staff, plans.clean_values(item.get("values"))))
        except plans.PlanError as exc:
            return _error(exc.message)
        return Response({**plans.preview(request.user, changes, effective_from, today), "effective_from": effective_from})


class TargetsHistoryView(APIView):
    """GET history/ — the latest target changes for the caller's team and the
    limits Super Admin set, from the activity log."""

    def get_permissions(self):
        return [HasRolePermission("targets.manage")]

    def get(self, request):
        team = StaffUser.objects.filter(is_active=True).exclude(pk=request.user.pk)
        team = team.filter(manager__isnull=False) if sees_every_team(request.user) else team.filter(manager=request.user)
        names = dict(team.values_list("pk", "full_name"))
        ids = [str(pk) for pk in names]
        events = ActivityEvent.objects.filter(
            Q(verb__in=("targets.plan_set", "targets.cut_applied"), target_type="accounts.staffuser", target_id__in=ids) | Q(verb="targets.limits_set")
        ).order_by("-occurred_at", "-id")[:15]
        return Response([
            {
                "id": e.pk, "verb": e.verb, "at": e.occurred_at, "staff_id": int(e.target_id) if e.verb != "targets.limits_set" else None,
                "staff_name": names.get(int(e.target_id)) if e.verb != "targets.limits_set" else None,
                "before": (e.before or {}).get("values"), "after": e.after,
                "by": e.actor_label, "by_role": e.actor_role, "by_me": e.actor_id == request.user.pk,
            }
            for e in events
        ])


def _limit(limit):
    return {"metric": limit.metric, "min_daily": limit.min_daily, "max_daily": limit.max_daily}


class LimitsView(APIView):
    """GET limits/ (anyone who sets targets) · PUT limits/ (targets.limits)."""

    def get_permissions(self):
        if self.request.method == "GET":
            return [HasAnyRolePermission("targets.manage", "targets.limits")]
        return [HasRolePermission("targets.limits")]

    def get(self, request):
        return Response([_limit(x) for x in TargetLimit.objects.order_by("metric")])

    def put(self, request):
        items = _body(request).get("limits")
        if not isinstance(items, list) or not items:
            return _error("Give at least one limit.")
        cleaned = {}
        for item in items:
            item = item if isinstance(item, dict) else {}
            metric, low, high = item.get("metric"), item.get("min_daily"), item.get("max_daily")
            if metric not in METRICS:
                return _error(f"{metric} is not a measure.")
            if any(isinstance(v, bool) or not isinstance(v, int) or v < 0 for v in (low, high)):
                return _error(f"The {metric} limits must be whole numbers, 0 or more.")
            if low > high:
                return _error(f"The lowest {metric} target can't be above the highest.")
            cleaned[metric] = (low, high)
        with transaction.atomic():
            for metric, (low, high) in cleaned.items():
                TargetLimit.objects.update_or_create(metric=metric, defaults={"min_daily": low, "max_daily": high, "set_by": request.user})
            record(request.user, "targets.limits_set", target_type="targets.targetlimit", target_id="all",
                   after={m: {"min": lo, "max": hi} for m, (lo, hi) in cleaned.items()}, request=request)
        return Response([_limit(x) for x in TargetLimit.objects.order_by("metric")])


def _holiday(holiday):
    return {"id": holiday.pk, "date": holiday.date, "name": holiday.name}


class HolidaysView(APIView):
    """GET holidays/?year= (any staff member) · POST holidays/ (calendar.manage)."""

    def get_permissions(self):
        return [IsStaff()] if self.request.method == "GET" else [HasRolePermission("calendar.manage")]

    def get(self, request):
        year = request.query_params.get("year")
        holidays = PublicHoliday.objects.all()
        if year:
            if not str(year).isdigit() or not 1900 < int(year) < 2200:
                return _error("Use a four-digit year.")
            holidays = holidays.filter(date__year=int(year))
        return Response([_holiday(h) for h in holidays])

    def post(self, request):
        data = _body(request)
        name = str(data.get("name", "")).strip()
        try:
            day = _day(data.get("date"))
        except plans.PlanError as exc:
            return _error(exc.message)
        if day is None or not name:
            return _error("Give the holiday's observed date and its name.")
        try:
            with transaction.atomic():
                holiday = PublicHoliday.objects.create(date=day, name=name[:120])
                record(request.user, "calendar.holiday_added", target=holiday, after={"date": day.isoformat(), "name": holiday.name}, request=request)
        except IntegrityError:
            return _error("That date is already a public holiday.", status.HTTP_409_CONFLICT)
        return Response(_holiday(holiday), status=status.HTTP_201_CREATED)


class HolidayDetailView(APIView):
    def get_permissions(self):
        return [HasRolePermission("calendar.manage")]

    def delete(self, request, pk):
        holiday = get_object_or_404(PublicHoliday, pk=pk)
        with transaction.atomic():
            record(request.user, "calendar.holiday_removed", target=holiday, before={"date": holiday.date.isoformat(), "name": holiday.name}, request=request)
            holiday.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


LEAVE_HISTORY_DAYS = 90
KIND_WORDS = "annual, sick, compassionate, maternity or paternity, or unpaid leave"


class WorkingDays:
    """Counts the working days of a leave (the person's weekday pattern minus public
    holidays) from preloaded patterns and holidays. Existing leave doesn't change the count."""

    def __init__(self, staff_list, start, end):
        self.staff = {s.pk: s for s in staff_list}
        self.patterns = {p.staff_id: set(p.weekdays) for p in WorkPattern.objects.filter(staff_id__in=list(self.staff))}
        self.holidays = set(PublicHoliday.objects.filter(date__gte=start, date__lte=end).values_list("date", flat=True))

    def count(self, staff_id, start, end):
        weekdays = self.patterns.get(staff_id) or set(services.default_weekdays(self.staff[staff_id]))
        day, total = start, 0
        while day <= end:
            total += day.weekday() in weekdays and day not in self.holidays
            day += timedelta(days=1)
        return total


def _leave_status(leave, today):
    if leave.end < today:
        return "taken"
    return "on_leave" if leave.start <= today else "upcoming"


def _leave(leave, counter=None, today=None):
    today = today or timezone.localdate()
    status_ = _leave_status(leave, today)
    return {
        "id": leave.pk, "staff": leave.staff_id, "staff_name": leave.staff.full_name, "staff_role": leave.staff.role.name,
        "start": leave.start, "end": leave.end,
        "kind": leave.kind, "kind_label": leave.get_kind_display(), "note": leave.note, "recorded_by": leave.recorded_by.full_name,
        "recorded_by_id": leave.recorded_by_id, "recorded_at": leave.created_at,
        "status": status_, "can_change": status_ != "taken",
        "working_days": counter.count(leave.staff_id, leave.start, leave.end) if counter else None,
    }


def _leave_data(data, *, partial_from=None):
    """(start, end, kind, note) from a request body; `partial_from` fills what a PATCH leaves out."""
    try:
        start = _day(data.get("start"), "start") if "start" in data else (partial_from.start if partial_from else None)
        end = _day(data.get("end"), "end") if "end" in data else (partial_from.end if partial_from else None)
    except plans.PlanError as exc:
        raise plans.PlanError(exc.message) from exc
    kind = data.get("kind") or (partial_from.kind if partial_from else Leave.ANNUAL)
    if start is None or end is None:
        raise plans.PlanError("Give the first and last day of the leave.")
    if end < start:
        raise plans.PlanError("The last day can't be before the first day.")
    if (end - start).days > 366:
        raise plans.PlanError("Leave can't be longer than a year.")
    # "other" is kept on leave recorded before the five kinds; it can stay, not be chosen.
    if kind not in Leave.RECORDABLE_KINDS and not (partial_from is not None and kind == partial_from.kind == Leave.OTHER):
        raise plans.PlanError(f"Use {KIND_WORDS}.")
    note = str(data["note"])[:300] if "note" in data else (partial_from.note if partial_from else "")
    return start, end, kind, note


class LeaveView(APIView):
    """GET leave/[?staff=&from=&to=] · POST leave/ — leave.record, own team.
    Without from/to the list is leave that ended in the last 90 days or is still to come."""

    def get_permissions(self):
        return [HasRolePermission("leave.record")]

    def get(self, request):
        today = timezone.localdate()
        rows = Leave.objects.select_related("staff__role", "recorded_by")
        if request.query_params.get("staff"):
            staff, refused = _team_member(request.user, request.query_params["staff"])
            if refused:
                return refused
            rows = rows.filter(staff=staff)
        elif request.user.role.name != Role.SUPER_ADMIN:
            rows = rows.filter(staff__manager=request.user)
        try:
            low, high = _day(request.query_params.get("from"), "from"), _day(request.query_params.get("to"), "to")
        except plans.PlanError as exc:
            return _error(exc.message)
        rows = rows.filter(end__gte=low or today - timedelta(days=LEAVE_HISTORY_DAYS))
        if high:
            rows = rows.filter(start__lte=high)
        rows = list(rows[:200])
        counter = WorkingDays([r.staff for r in rows], min((r.start for r in rows), default=today), max((r.end for r in rows), default=today))
        return Response([_leave(x, counter, today) for x in rows])

    def post(self, request):
        data = _body(request)
        staff, refused = _team_member(request.user, data.get("staff"))
        if refused:
            return refused
        try:
            start, end, kind, note = _leave_data(data)
        except plans.PlanError as exc:
            return _error(exc.message)
        with transaction.atomic():
            leave = Leave.objects.create(staff=staff, start=start, end=end, kind=kind, note=note, recorded_by=request.user)
            record(request.user, "leave.recorded", target=leave, after={"staff": staff.pk, "start": start.isoformat(), "end": end.isoformat(), "kind": kind}, request=request)
        return Response(_leave(leave, WorkingDays([staff], start, end)), status=status.HTTP_201_CREATED)


class LeavePreviewView(APIView):
    """GET leave/preview/?staff=&start=&end= — how many working days a leave would cover."""

    def get_permissions(self):
        return [HasRolePermission("leave.record")]

    def get(self, request):
        staff, refused = _team_member(request.user, request.query_params.get("staff"))
        if refused:
            return refused
        try:
            start, end = _day(request.query_params.get("start"), "start"), _day(request.query_params.get("end"), "end")
        except plans.PlanError as exc:
            return _error(exc.message)
        if start is None or end is None or end < start or (end - start).days > 366:
            return _error("Give a first and last day, the last not before the first.")
        return Response({"staff": staff.pk, "working_days": WorkingDays([staff], start, end).count(staff.pk, start, end)})


class LeaveDetailView(APIView):
    def get_permissions(self):
        return [HasRolePermission("leave.record")]

    def _load(self, request, pk):
        leave = get_object_or_404(Leave.objects.select_related("staff__role", "recorded_by"), pk=pk)
        if not plans.in_scope(request.user, leave.staff):
            return None, _error("You can only do this for your own team.", status.HTTP_403_FORBIDDEN)
        if leave.end < timezone.localdate():
            # A past day's target was already judged against this leave; changing it would rewrite history.
            return None, _error("Leave that has already been taken can't be changed.")
        return leave, None

    def patch(self, request, pk):
        leave, refused = self._load(request, pk)
        if refused:
            return refused
        today = timezone.localdate()
        try:
            start, end, kind, note = _leave_data(_body(request), partial_from=leave)
        except plans.PlanError as exc:
            return _error(exc.message)
        if start < leave.start and leave.start <= today:
            return _error("Leave that has started keeps its first day; an earlier first day would rewrite days already judged.")
        if start != leave.start and (leave.start <= today or start < today):
            return _error("Leave that has started keeps its first day, and a new first day can't be in the past.")
        if leave.start <= today and end < today:
            return _error("Leave that has started can be shortened to today at the earliest; past days stay as they were.")
        before = {"start": leave.start.isoformat(), "end": leave.end.isoformat(), "kind": leave.kind, "note": leave.note}
        with transaction.atomic():
            leave.start, leave.end, leave.kind, leave.note = start, end, kind, note
            leave.save(update_fields=["start", "end", "kind", "note"])
            record(request.user, "leave.updated", target=leave, before={"staff": leave.staff_id, **before},
                   after={"staff": leave.staff_id, "start": start.isoformat(), "end": end.isoformat(), "kind": kind, "note": note}, request=request)
        return Response(_leave(leave, WorkingDays([leave.staff], start, end)))

    def delete(self, request, pk):
        leave, refused = self._load(request, pk)
        if refused:
            return refused
        with transaction.atomic():
            record(request.user, "leave.removed", target=leave, before={"staff": leave.staff_id, "start": leave.start.isoformat(), "end": leave.end.isoformat(), "kind": leave.kind}, request=request)
            leave.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class WorkPatternView(APIView):
    """GET/PUT work-pattern/<staff>/ — targets.manage, own team."""

    def get_permissions(self):
        return [HasRolePermission("targets.manage")]

    def get(self, request, staff):
        member, refused = _team_member(request.user, staff)
        if refused:
            return refused
        pattern = WorkPattern.objects.filter(staff=member).first()
        return Response({"staff": member.pk, "weekdays": pattern.weekdays if pattern else list(services.default_weekdays(member)), "is_default": pattern is None})

    def put(self, request, staff):
        member, refused = _team_member(request.user, staff)
        if refused:
            return refused
        days = _body(request).get("weekdays")
        if (not isinstance(days, list) or not days or len(set(days)) != len(days)
                or any(isinstance(d, bool) or not isinstance(d, int) or not 0 <= d <= 6 for d in days)):
            return _error("Give the working weekdays as numbers 0 (Monday) to 6 (Sunday), each once.")
        with transaction.atomic():
            WorkPattern.objects.update_or_create(staff=member, defaults={"weekdays": sorted(days), "set_by": request.user})
            record(request.user, "targets.work_pattern_set", target=member, after={"weekdays": sorted(days)}, request=request)
        return Response({"staff": member.pk, "weekdays": sorted(days), "is_default": False})
