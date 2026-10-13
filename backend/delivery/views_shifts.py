"""The weekly rota (permission ``delivery.fleet``) and the rider's view of it. A planned ``Shift`` is a plan; the
rider's actual time is a ``ShiftSession``. The demand estimate is computed from real deliveries: with fewer than
four comparable weekdays of history it says "not enough history" instead of a number."""
import math
from datetime import date, datetime, time, timedelta

from django.db import transaction
from django.db.models import Count, Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import HasRolePermission
from notifications.services import notify_staff
from orders.models import DeliveryAssignment

from . import services
from .models import DeliveryZone, Rider, Shift
from .views_rider import RiderView

PERMISSION = "delivery.fleet"
DELIVERIES_PER_SHIFT = 12  # one rider-shift is planned to cover about this many deliveries
HISTORY_WEEKS = 4


def week_start(day):
    return day - timedelta(days=day.weekday())


def parse_day(raw, default=None):
    try:
        return date.fromisoformat(str(raw))
    except ValueError:
        return default


def bounds(monday):
    tz = timezone.get_current_timezone()
    low = timezone.make_aware(datetime.combine(monday, time.min), tz)
    return low, low + timedelta(days=7)


def demand(monday, today):
    """Per weekday: the average deliveries on the previous four same weekdays and the shifts that implies. Needs all
    four of those days to have had at least one delivery, else ``enough_history`` is false and no number is given."""
    out = []
    tz = timezone.get_current_timezone()
    for offset in range(7):
        day = monday + timedelta(days=offset)
        past = [day - timedelta(weeks=w) for w in range(1, HISTORY_WEEKS + 1)]
        past = [d for d in past if d < today]
        counts = []
        for d in past:
            low = timezone.make_aware(datetime.combine(d, time.min), tz)
            counts.append(DeliveryAssignment.objects.filter(assigned_at__gte=low, assigned_at__lt=low + timedelta(days=1)).exclude(status=DeliveryAssignment.FAILED).count())
        enough = len(past) == HISTORY_WEEKS and all(c > 0 for c in counts)
        avg = sum(counts) / len(counts) if counts else None
        out.append({
            "date": day, "enough_history": enough, "average_deliveries": round(avg, 1) if enough else None,
            "shifts_needed": math.ceil(avg / DELIVERIES_PER_SHIFT) if enough else None, "per_shift": DELIVERIES_PER_SHIFT,
        })
    return out


def shift_row(s):
    return {
        "id": s.pk, "rider": {"id": s.rider_id, "full_name": s.rider.staff.full_name} if s.rider_id else None, "zone": {"id": s.zone_id, "name": s.zone.name} if s.zone_id else None,
        "starts_at": s.starts_at, "ends_at": s.ends_at, "status": s.status, "status_label": s.get_status_display(), "published_at": s.published_at,
        "swap_with": {"id": s.swap_with_id, "full_name": s.swap_with.staff.full_name} if s.swap_with_id else None,
    }


class ShiftsView(APIView):
    def get_permissions(self):
        return [HasRolePermission(PERMISSION)]

    def get(self, request):
        today = timezone.localdate()
        monday = week_start(parse_day(request.query_params.get("week"), today))
        low, high = bounds(monday)
        shifts = Shift.objects.filter(starts_at__gte=low, starts_at__lt=high).select_related("rider__staff", "zone", "swap_with__staff")
        rows = [shift_row(s) for s in shifts]
        return Response({
            "week_start": monday, "results": rows, "demand": demand(monday, today),
            "counts": {"draft": sum(r["status"] == "draft" for r in rows), "published": sum(r["status"] == "published" for r in rows), "open": sum(r["status"] == "open" for r in rows), "swap": sum(r["status"] == "swap" for r in rows)},
            "riders": [{"id": r.pk, "full_name": r.staff.full_name} for r in Rider.objects.select_related("staff").filter(staff__is_active=True, staff__is_suspended=False)],
            "zones": [{"id": z.pk, "name": z.name} for z in DeliveryZone.objects.filter(active=True)],
        })

    def post(self, request):
        class S(serializers.Serializer):
            rider = serializers.IntegerField(required=False, allow_null=True)
            zone = serializers.IntegerField(required=False, allow_null=True)
            starts_at = serializers.DateTimeField()
            ends_at = serializers.DateTimeField()

        data = S(data=request.data)
        data.is_valid(raise_exception=True)
        d = data.validated_data
        if d["ends_at"] <= d["starts_at"] or d["ends_at"] - d["starts_at"] > timedelta(hours=16):
            return Response({"detail": "A shift must end after it starts and last no more than 16 hours.", "field": "ends_at"}, status=400)
        rider = get_object_or_404(Rider, pk=d["rider"]) if d.get("rider") else None
        zone = get_object_or_404(DeliveryZone, pk=d["zone"]) if d.get("zone") else None
        if rider and Shift.objects.filter(rider=rider, starts_at__lt=d["ends_at"], ends_at__gt=d["starts_at"]).exclude(status=Shift.OPEN).exists():
            return Response({"detail": "This rider already has a shift at that time.", "code": "overlap"}, status=409)
        shift = Shift.objects.create(rider=rider, zone=zone, starts_at=d["starts_at"], ends_at=d["ends_at"], status=Shift.DRAFT if rider else Shift.OPEN, created_by=request.user)
        return Response(shift_row(shift), status=201)


class ShiftDetailView(APIView):
    def get_permissions(self):
        return [HasRolePermission(PERMISSION)]

    def patch(self, request, pk):
        shift = get_object_or_404(Shift, pk=pk)
        if "rider" in request.data:
            shift.rider = get_object_or_404(Rider, pk=request.data["rider"]) if request.data["rider"] else None
            shift.status = Shift.OPEN if shift.rider is None else (Shift.DRAFT if shift.status == Shift.OPEN else shift.status)
            if shift.rider and Shift.objects.filter(rider=shift.rider, starts_at__lt=shift.ends_at, ends_at__gt=shift.starts_at).exclude(pk=shift.pk).exists():
                return Response({"detail": "This rider already has a shift at that time.", "code": "overlap"}, status=409)
        shift.save()
        return Response(shift_row(shift))

    def delete(self, request, pk):
        shift = get_object_or_404(Shift, pk=pk)
        if shift.status == Shift.PUBLISHED and shift.starts_at < timezone.now():
            return Response({"detail": "A shift that has started cannot be removed."}, status=409)
        shift.delete()
        return Response(status=204)


class CopyWeekView(APIView):
    def get_permissions(self):
        return [HasRolePermission(PERMISSION)]

    def post(self, request):
        source = week_start(parse_day(request.data.get("from"), None) or timezone.localdate() - timedelta(days=7))
        target = week_start(parse_day(request.data.get("to"), None) or source + timedelta(days=7))
        if target <= source:
            return Response({"detail": "Copy into a later week."}, status=400)
        if Shift.objects.filter(starts_at__gte=bounds(target)[0], starts_at__lt=bounds(target)[1]).exists():
            return Response({"detail": "That week already has shifts. Remove them first.", "code": "week_not_empty"}, status=409)
        low, high = bounds(source)
        delta = target - source
        made = [
            Shift(rider=s.rider, zone=s.zone, starts_at=s.starts_at + delta, ends_at=s.ends_at + delta, status=Shift.DRAFT if s.rider_id else Shift.OPEN, created_by=request.user)
            for s in Shift.objects.filter(starts_at__gte=low, starts_at__lt=high)
        ]
        Shift.objects.bulk_create(made)
        return Response({"copied": len(made)}, status=201)


class PublishView(APIView):
    def get_permissions(self):
        return [HasRolePermission(PERMISSION)]

    def post(self, request):
        monday = week_start(parse_day(request.data.get("week"), None) or timezone.localdate())
        low, high = bounds(monday)
        now = timezone.now()
        drafts = list(Shift.objects.filter(starts_at__gte=low, starts_at__lt=high, status=Shift.DRAFT, rider__isnull=False).select_related("rider__staff"))
        riders = {}
        for s in drafts:
            s.status, s.published_at = Shift.PUBLISHED, now
            riders.setdefault(s.rider_id, s.rider)
        Shift.objects.bulk_update(drafts, ["status", "published_at"])
        for rider in riders.values():
            notify_staff(rider.staff, "delivery_shift", f"Your shifts for the week of {monday:%-d %b} are published", link="/staff/shift", icon="📅")
        return Response({"published": len(drafts), "riders_told": len(riders)})


class SwapDecisionView(APIView):
    def get_permissions(self):
        return [HasRolePermission(PERMISSION)]

    def post(self, request, pk):
        with transaction.atomic():
            shift = get_object_or_404(Shift.objects.select_for_update(of=("self",)).select_related("rider__staff", "swap_with__staff"), pk=pk, status=Shift.SWAP)
            if request.data.get("approve"):
                old = shift.rider
                shift.rider, shift.swap_with, shift.status = shift.swap_with, None, Shift.PUBLISHED
                notify_staff(shift.rider.staff, "delivery_shift", "A shift was handed to you", link="/staff/shift", icon="📅")
                if old:
                    notify_staff(old.staff, "delivery_shift", "Your swap was approved", link="/staff/shift", icon="📅")
            else:
                shift.swap_with, shift.status = None, Shift.PUBLISHED
            shift.save()
        return Response(shift_row(shift))


class MyShiftsView(RiderView):
    """GET rider/shifts/ — the rider's published shifts for the next two weeks, and the shift in progress."""

    def get(self, request):
        rider = self.rider(request)
        now = timezone.now()
        shifts = Shift.objects.filter(rider=rider, status__in=(Shift.PUBLISHED, Shift.SWAP), ends_at__gte=now, starts_at__lte=now + timedelta(days=14)).select_related("zone", "swap_with__staff", "rider__staff")
        return Response({"results": [shift_row(s) for s in shifts]})


class MyShiftSwapView(RiderView):
    """POST rider/shifts/<id>/swap/ {with_rider} — ask to swap a shift; the manager decides."""

    def post(self, request, pk):
        rider = self.rider(request)
        shift = get_object_or_404(Shift, pk=pk, rider=rider, status=Shift.PUBLISHED, starts_at__gt=timezone.now())
        other = get_object_or_404(Rider, pk=request.data.get("with_rider"), staff__is_active=True, staff__is_suspended=False)
        if other.pk == rider.pk:
            return Response({"detail": "Choose another rider."}, status=400)
        shift.swap_with, shift.status = other, Shift.SWAP
        shift.save(update_fields=["swap_with", "status"])
        if request.user.manager_id:
            notify_staff(request.user.manager, "delivery_shift", f"{request.user.full_name} asked to swap a shift", link="/staff/shifts", icon="📅")
        return Response(shift_row(shift))
