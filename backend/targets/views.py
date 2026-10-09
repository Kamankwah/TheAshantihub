"""Targets API (spec S6). A staff member reads their own targets; writes are
Operations' (own team) and Super Admin's, behind the permissions seeded in
accounts.0039: targets.manage, targets.limits, calendar.manage, leave.record."""
from datetime import date

from django.db import IntegrityError, transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import Role, StaffUser
from accounts.permissions import HasAnyRolePermission, HasRolePermission, IsStaff
from activity.services import record
from approvals import services as approvals

from . import plans, services
from .models import DEFAULT_WEEKDAYS, METRICS, Leave, PublicHoliday, TargetLimit, WorkPattern

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
        team = team.filter(manager__isnull=False) if request.user.role.name == Role.SUPER_ADMIN else team.filter(manager=request.user)
        return Response({
            "metrics": list(METRICS),
            "limits": [_limit(x) for x in TargetLimit.objects.order_by("metric")],
            "staff": [
                {"id": s.pk, "full_name": s.full_name, "role": s.role.name, "daily": plans.current_values(s)}
                for s in team.order_by("full_name")
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
            with transaction.atomic():
                written = plans.write_plans(staff, now, effective_from, request.user) if now else []
                if cuts:
                    pending = approvals.submit(
                        request.user, "targets.cut", title=f"Lower {staff.full_name}'s daily targets", target=staff,
                        payload={"staff": staff.pk, "values": cuts, "effective_from": effective_from.isoformat()},
                        maker_note=str(data.get("note", ""))[:500], request=request,
                    )
                if now:
                    record(request.user, "targets.plan_set", target=staff, after={"values": now, "effective_from": effective_from.isoformat()}, request=request)
        except plans.PlanError as exc:
            return _error(exc.message, exc.status_code)
        except approvals.ApprovalError as exc:
            return _error(exc.message, getattr(exc, "status_code", 400))
        return Response({
            "applied": sorted({p.metric for p in written} | (set(cuts) if pending is not None and pending.status == "approved" else set())),
            "pending_approval": {"id": pending.pk, "metrics": sorted(cuts), "status": pending.status} if pending is not None else None,
            "daily": plans.current_values(staff),
        }, status=status.HTTP_202_ACCEPTED if pending is not None and pending.status == "pending" and not written else status.HTTP_200_OK)


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


def _leave(leave):
    return {
        "id": leave.pk, "staff": leave.staff_id, "staff_name": leave.staff.full_name, "start": leave.start, "end": leave.end,
        "kind": leave.kind, "kind_label": leave.get_kind_display(), "note": leave.note, "recorded_by": leave.recorded_by.full_name,
    }


class LeaveView(APIView):
    """GET leave/[?staff=] · POST leave/ — leave.record, own team."""

    def get_permissions(self):
        return [HasRolePermission("leave.record")]

    def get(self, request):
        rows = Leave.objects.select_related("staff", "recorded_by")
        if request.query_params.get("staff"):
            staff, refused = _team_member(request.user, request.query_params["staff"])
            if refused:
                return refused
            rows = rows.filter(staff=staff)
        elif request.user.role.name != Role.SUPER_ADMIN:
            rows = rows.filter(staff__manager=request.user)
        return Response([_leave(x) for x in rows[:200]])

    def post(self, request):
        data = _body(request)
        staff, refused = _team_member(request.user, data.get("staff"))
        if refused:
            return refused
        try:
            start, end = _day(data.get("start"), "start"), _day(data.get("end"), "end")
        except plans.PlanError as exc:
            return _error(exc.message)
        kind = data.get("kind") or Leave.ANNUAL
        if start is None or end is None:
            return _error("Give the first and last day of the leave.")
        if end < start:
            return _error("The last day can't be before the first day.")
        if (end - start).days > 366:
            return _error("Leave can't be longer than a year.")
        if kind not in dict(Leave.KIND_CHOICES):
            return _error("Use annual, sick or other.")
        with transaction.atomic():
            leave = Leave.objects.create(staff=staff, start=start, end=end, kind=kind, note=str(data.get("note", ""))[:300], recorded_by=request.user)
            record(request.user, "leave.recorded", target=leave, after={"staff": staff.pk, "start": start.isoformat(), "end": end.isoformat(), "kind": kind}, request=request)
        return Response(_leave(leave), status=status.HTTP_201_CREATED)


class LeaveDetailView(APIView):
    def get_permissions(self):
        return [HasRolePermission("leave.record")]

    def delete(self, request, pk):
        leave = get_object_or_404(Leave.objects.select_related("staff"), pk=pk)
        if not plans.in_scope(request.user, leave.staff):
            return _error("You can only do this for your own team.", status.HTTP_403_FORBIDDEN)
        with transaction.atomic():
            record(request.user, "leave.removed", target=leave, before={"staff": leave.staff_id, "start": leave.start.isoformat(), "end": leave.end.isoformat()}, request=request)
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
        return Response({"staff": member.pk, "weekdays": pattern.weekdays if pattern else list(DEFAULT_WEEKDAYS), "is_default": pattern is None})

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
