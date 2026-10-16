"""The Delivery Manager's fleet screens: riders, papers, vehicles, zones and invites (permission
``delivery.fleet``). Suspending or reinstating a rider by hand uses the existing staff endpoints
(``accounts/staff/<id>/suspend|unsuspend/``, sudo); this module adds only what they do not cover."""
from datetime import timedelta

from django.db import transaction
from django.http import FileResponse, Http404
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import Role, StaffSession, StaffUser
from accounts.permissions import HasRolePermission, RequiresSudo
from accounts.serializers import invite_state
from accounts import sessions
from notifications.services import notify_staff

from . import employment, files, fleet, payloads, services
from .models import DeliveryZone, Rider, RiderDocument, Vehicle, VehicleHandover, VEHICLE_TYPES

PERMISSION = "delivery.fleet"


class FleetView(APIView):
    def get_permissions(self):
        return [HasRolePermission(PERMISSION)]


class RidersView(FleetView):
    """GET riders/?status=&zone=&vehicle= — the roster (screen 07)."""

    def get(self, request):
        everyone = fleet.roster()
        p = request.query_params
        rows = everyone
        if p.get("status"):
            rows = [r for r in rows if r["status"] == p["status"]]
        if p.get("zone"):
            rows = [r for r in rows if r["home_zone"] and str(r["home_zone"]["id"]) == p["zone"]]
        if p.get("vehicle"):
            rows = [r for r in rows if r["vehicle_type"] == p["vehicle"]]
        counts = {}
        for r in everyone:
            counts[r["status"]] = counts.get(r["status"], 0) + 1
        return Response({
            "results": rows, "counts": counts, "total": len(everyone),
            "stale_after_seconds": int(services.STALE_AFTER.total_seconds()),
        })


class RiderDetailView(FleetView):
    """GET riders/<id>/ — the profile (screen 08). PATCH — change vehicle type or home zone, or the
    note. (Suspend/unsuspend, sign out a device: the staff endpoints.)"""

    def get(self, request, pk):
        rider = get_object_or_404(Rider.objects.select_related("staff", "staff__manager", "vehicle", "home_zone"), pk=pk)
        return Response(fleet.profile(rider))

    def patch(self, request, pk):
        rider = get_object_or_404(Rider.objects.select_related("staff"), pk=pk)
        changed = []
        if "vehicle_type" in request.data:
            if request.data["vehicle_type"] not in dict(VEHICLE_TYPES):
                return Response({"vehicle_type": "Not a vehicle type."}, status=400)
            rider.vehicle_type = request.data["vehicle_type"]
            changed.append("vehicle_type")
        if "home_zone" in request.data:
            zone_id = request.data["home_zone"]
            rider.home_zone = get_object_or_404(DeliveryZone, pk=zone_id) if zone_id else None
            changed.append("home_zone")
        if changed:
            rider.save(update_fields=changed)
        return Response(fleet.profile(rider))


class RiderJobHoldView(FleetView):
    """POST riders/<id>/job-hold/ {"hold": bool, "reason"} — stop (or resume) new jobs for a rider
    without suspending the account. The engine skips a held rider; a manager can still assign by hand."""

    def post(self, request, pk):
        rider = get_object_or_404(Rider.objects.select_related("staff"), pk=pk)
        hold = bool(request.data.get("hold", True))
        rider.job_hold = hold
        rider.job_hold_reason = str(request.data.get("reason", ""))[:300] if hold else ""
        rider.save(update_fields=["job_hold", "job_hold_reason"])
        return Response({"id": rider.pk, "job_hold": rider.job_hold, "job_hold_reason": rider.job_hold_reason})


class RiderEmploymentView(FleetView):
    """POST riders/<id>/employment/ {"employment": "ashantihub"|"third_party", "company_name", "note"} — propose who the
    rider works for (wallets Plan 5). A Super Admin approves it with the password (their own change applies at once).
    201 {approval_id, status, employment}; 409 no_change / already_pending / rider_money_open (+ open)."""

    def post(self, request, pk):
        rider = get_object_or_404(Rider.objects.select_related("staff"), pk=pk)
        data = request.data if isinstance(request.data, dict) else {}
        try:
            approval = employment.propose(request.user, rider, data, note=data.get("note", ""), request=request)
        except employment.EmploymentError as exc:
            return Response(exc.body(), status=exc.status_code)
        rider.refresh_from_db()
        return Response(
            {"approval_id": approval.pk, "status": approval.status, "employment": employment.row(rider)},
            status=status.HTTP_201_CREATED,
        )


class RiderReinstateView(FleetView):
    """POST riders/<id>/reinstate/ — lift a suspension caused by an expired paper, once every required
    paper is approved and in date. A suspension a manager made by hand is lifted with the staff unsuspend
    (this refuses it, so the two reasons are never mixed)."""

    def get_permissions(self):
        return [HasRolePermission(PERMISSION), RequiresSudo()]

    def post(self, request, pk):
        rider = get_object_or_404(Rider.objects.select_for_update().select_related("staff"), pk=pk)
        staff = rider.staff
        if not staff.is_suspended:
            return Response({"detail": "This rider is not suspended."}, status=409)
        if rider.suspension_source != Rider.DOCUMENTS:
            return Response({"detail": "This suspension was made by a manager. Lift it from the rider's profile.", "code": "manual_suspension"}, status=409)
        missing = services.required_documents_missing(rider)
        if missing:
            return Response({"detail": "Every required paper must be approved and in date first.", "code": "papers_missing", "missing": missing}, status=409)
        staff.is_suspended, staff.suspension_reason = False, ""
        staff.save(update_fields=["is_suspended", "suspension_reason"])
        rider.suspension_source = ""
        rider.save(update_fields=["suspension_source"])
        return Response({"id": rider.pk, "suspended": False})


# ── Papers ─────────────────────────────────────────────────────────────────────────────────────
class DocumentsView(FleetView):
    """GET documents/?bucket=waiting|expiring|expired|all — papers across the fleet (screen 09), and the
    counts that make its tabs and the menu badge."""

    def get(self, request):
        today = timezone.localdate()
        horizon = today + timedelta(days=fleet.EXPIRING_DAYS)
        docs = RiderDocument.objects.select_related("rider__staff", "reviewed_by").order_by("expires_on", "-uploaded_at")
        live = docs.exclude(rider__staff__is_active=False)
        waiting = live.filter(status=RiderDocument.UPLOADED)
        expired = live.filter(status=RiderDocument.EXPIRED)
        expiring = live.filter(status=RiderDocument.APPROVED, expires_on__gte=today, expires_on__lte=horizon)
        bucket = request.query_params.get("bucket", "waiting")
        queryset = {"waiting": waiting, "expiring": expiring, "expired": expired}.get(bucket, live)
        rows = []
        for d in queryset[:200]:
            row = payloads.document_row(d)
            row["rider"] = {"id": d.rider_id, "full_name": d.rider.staff.full_name, "suspended": d.rider.staff.is_suspended}
            rows.append(row)
        riders_without = [
            {"id": r.pk, "full_name": r.staff.full_name, "missing": services.required_documents_missing(r, today)}
            for r in Rider.objects.select_related("staff").filter(staff__is_active=True, staff__invite_token__isnull=True)
        ]
        riders_without = [r for r in riders_without if r["missing"]]
        return Response({
            "bucket": bucket, "results": rows,
            "counts": {"waiting": waiting.count(), "expiring": expiring.count(), "expired": expired.count(), "riders_missing_papers": len(riders_without)},
            "riders_missing_papers": riders_without,
        })


class DocumentReviewView(FleetView):
    """POST documents/<id>/review/ {"decision": "approve"|"reject", "reject_reason", "expires_on"} — nobody
    checks their own paper (a manager who is also the uploader is refused)."""

    def post(self, request, pk):
        with transaction.atomic():
            doc = get_object_or_404(RiderDocument.objects.select_for_update(of=("self",)).select_related("rider__staff"), pk=pk)
            if doc.uploaded_by_id == request.user.pk:
                return Response({"detail": "You cannot check a paper you uploaded yourself."}, status=403)
            if doc.status != RiderDocument.UPLOADED:
                return Response({"detail": "This paper has already been checked.", "code": "already_checked"}, status=409)
            decision = request.data.get("decision")
            now = timezone.now()
            if decision == "approve":
                expires_on = request.data.get("expires_on")
                if expires_on:
                    try:
                        doc.expires_on = serializers.DateField().run_validation(expires_on)
                    except serializers.ValidationError:
                        return Response({"detail": "Enter the expiry date as YYYY-MM-DD."}, status=400)
                if doc.expires_on is not None and doc.expires_on < timezone.localdate():
                    return Response({"detail": "That paper has already expired."}, status=400)
                doc.status = RiderDocument.APPROVED
                doc.reject_reason = ""
                # An older approved paper of this kind is replaced by the new one.
                RiderDocument.objects.filter(rider=doc.rider, kind=doc.kind, status=RiderDocument.APPROVED).exclude(pk=doc.pk).update(status=RiderDocument.EXPIRED)
            elif decision == "reject":
                reason = str(request.data.get("reject_reason", "")).strip()
                if not reason:
                    return Response({"detail": "Say why the paper is sent back."}, status=400)
                doc.status, doc.reject_reason = RiderDocument.REJECTED, reason[:300]
            else:
                return Response({"detail": "Choose approve or reject."}, status=400)
            doc.reviewed_by, doc.reviewed_at = request.user, now
            doc.save()
            notify_staff(
                doc.rider.staff, "delivery_document", f"Your {doc.get_kind_display()} was {'approved' if decision == 'approve' else 'sent back'}",
                body=doc.reject_reason, link="/staff/documents", icon="🪪",
            )
        row = payloads.document_row(doc)
        row["rider"] = {"id": doc.rider_id, "full_name": doc.rider.staff.full_name}
        return Response(row)


class DocumentRemindView(FleetView):
    """POST documents/<id>/remind/ — nudge the rider (in-app notice; SMS is not connected)."""

    def post(self, request, pk):
        doc = get_object_or_404(RiderDocument.objects.select_related("rider__staff"), pk=pk)
        when = f" on {doc.expires_on:%-d %b}" if doc.expires_on else ""
        notify_staff(
            doc.rider.staff, "delivery_document", f"Please renew your {doc.get_kind_display()}",
            body=f"It expires{when}. Upload the new one in Documents." if doc.expires_on else "Please upload it in Documents.",
            link="/staff/documents", icon="🪪",
        )
        return Response({"ok": True})


class DocumentFileView(FleetView):
    """GET documents/<id>/file/ — the scan, through this authenticated view only (never a public URL)."""

    def get(self, request, pk):
        doc = get_object_or_404(RiderDocument, pk=pk)
        return files.serve(doc.file)


# ── Vehicles ───────────────────────────────────────────────────────────────────────────────────
class VehicleSerializer(serializers.ModelSerializer):
    class Meta:
        model = Vehicle
        fields = ["plate", "vehicle_type", "description", "owner_kind", "registration_expires", "roadworthy_expires", "insurance_expires", "status"]

    def validate_plate(self, value):
        value = " ".join(value.upper().split())
        qs = Vehicle.objects.filter(plate__iexact=value)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError("That plate is already on the list.")
        return value


class VehiclesView(FleetView):
    """GET vehicles/ and POST vehicles/ (screen 10)."""

    def get(self, request):
        vehicles = Vehicle.objects.prefetch_related("current_riders__staff")
        rows = [fleet.vehicle_row(v) for v in vehicles]
        by_type = {}
        for v in vehicles:
            by_type[v.vehicle_type] = by_type.get(v.vehicle_type, 0) + 1
        return Response({"results": rows, "counts": by_type, "total": len(rows)})

    def post(self, request):
        data = VehicleSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        vehicle = data.save()
        return Response(fleet.vehicle_row(vehicle), status=status.HTTP_201_CREATED)


class VehicleDetailView(FleetView):
    def get(self, request, pk):
        vehicle = get_object_or_404(Vehicle.objects.prefetch_related("current_riders__staff"), pk=pk)
        row = fleet.vehicle_row(vehicle)
        row["handovers"] = [
            {"at": h.at, "from": h.from_rider.staff.full_name if h.from_rider_id else None, "to": h.to_rider.staff.full_name if h.to_rider_id else None, "by": payloads.person(h.by), "note": h.note}
            for h in vehicle.handovers.select_related("from_rider__staff", "to_rider__staff", "by")[:30]
        ]
        return Response(row)

    def patch(self, request, pk):
        vehicle = get_object_or_404(Vehicle, pk=pk)
        data = VehicleSerializer(vehicle, data=request.data, partial=True)
        data.is_valid(raise_exception=True)
        data.save()
        vehicle = Vehicle.objects.prefetch_related("current_riders__staff").get(pk=pk)
        return Response(fleet.vehicle_row(vehicle))


class VehicleAssignView(FleetView):
    """POST vehicles/<id>/assign/ {"rider": id|null, "note"} — hand a vehicle to a rider (or take it back).
    A rider holds one vehicle at a time; every move is recorded."""

    def post(self, request, pk):
        with transaction.atomic():
            vehicle = get_object_or_404(Vehicle.objects.select_for_update(), pk=pk)
            if vehicle.status != Vehicle.ACTIVE:
                return Response({"detail": "A retired vehicle cannot be handed out."}, status=409)
            new = None
            if request.data.get("rider"):
                new = get_object_or_404(Rider.objects.select_for_update().select_related("staff"), pk=request.data["rider"])
            old = vehicle.current_riders.first()
            if old and new and old.pk == new.pk:
                return Response(fleet.vehicle_row(vehicle))
            if old:
                old.vehicle = None
                old.save(update_fields=["vehicle"])
            if new:
                Rider.objects.filter(vehicle=vehicle).update(vehicle=None)
                if new.vehicle_id:
                    VehicleHandover.objects.create(vehicle_id=new.vehicle_id, from_rider=new, to_rider=None, by=request.user, note="Replaced by another vehicle")
                new.vehicle = vehicle
                new.vehicle_type = vehicle.vehicle_type
                new.save(update_fields=["vehicle", "vehicle_type"])
            VehicleHandover.objects.create(vehicle=vehicle, from_rider=old, to_rider=new, by=request.user, note=str(request.data.get("note", ""))[:300])
        vehicle = Vehicle.objects.prefetch_related("current_riders__staff").get(pk=pk)
        return Response(fleet.vehicle_row(vehicle))


# ── Zones ──────────────────────────────────────────────────────────────────────────────────────
def _clean_ring(value):
    """A boundary is a list of at least three [lng, lat] points inside Ghana's bounds, or None to clear it."""
    if value in (None, [], ""):
        return None
    if not isinstance(value, list) or len(value) < 3 or len(value) > 200:
        raise serializers.ValidationError("A boundary needs between 3 and 200 points.")
    ring = []
    for point in value:
        try:
            lng, lat = float(point[0]), float(point[1])
        except (TypeError, ValueError, IndexError, KeyError):
            raise serializers.ValidationError("Each point must be [longitude, latitude].")
        if not (-3.5 <= lng <= 1.5 and 4.0 <= lat <= 11.5):
            raise serializers.ValidationError("A point is outside Ghana.")
        ring.append([lng, lat])
    return ring


class ZoneSerializer(serializers.ModelSerializer):
    boundary = serializers.JSONField(required=False, allow_null=True)

    class Meta:
        model = DeliveryZone
        fields = ["name", "boundary", "centre_lat", "centre_lng", "express_offered", "active"]

    def validate_boundary(self, value):
        return _clean_ring(value)


def _riders_by_zone():
    out = {}
    for r in Rider.objects.select_related("staff").filter(home_zone__isnull=False, staff__is_active=True):
        out.setdefault(r.home_zone_id, []).append({"id": r.pk, "full_name": r.staff.full_name})
    return out


class ZonesView(FleetView):
    def get(self, request):
        by_zone = _riders_by_zone()
        return Response({"results": [fleet.zone_row(z, by_zone) for z in DeliveryZone.objects.all()]})

    def post(self, request):
        data = ZoneSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        zone = data.save(updated_by=request.user)
        return Response(fleet.zone_row(zone, {}), status=status.HTTP_201_CREATED)


class ZoneDetailView(FleetView):
    def patch(self, request, pk):
        zone = get_object_or_404(DeliveryZone, pk=pk)
        data = ZoneSerializer(zone, data=request.data, partial=True)
        data.is_valid(raise_exception=True)
        zone = data.save(updated_by=request.user)
        return Response(fleet.zone_row(zone, _riders_by_zone()))


# ── Invites ────────────────────────────────────────────────────────────────────────────────────
class InvitesView(FleetView):
    """GET invites/ — the riders the caller leads who have not set a password yet (screen 11), and the
    options the form offers. Sending, resending and cancelling use the staff invite endpoints."""

    def get(self, request):
        pending = []
        invited = StaffUser.objects.filter(manager=request.user, role__name=Role.DISPATCH, invite_token__isnull=False, is_active=True)
        for staff in invited.select_related("rider", "rider__home_zone").order_by("-invite_sent_at", "-created_at"):
            rider = getattr(staff, "rider", None)
            pending.append({
                "id": staff.pk, "full_name": staff.full_name, "email": staff.email, "state": invite_state(staff),
                "sent_at": staff.invite_sent_at or staff.created_at, "expires_at": staff.invite_expires_at,
                "opened_at": staff.invite_opened_at, "vehicle_type": rider.vehicle_type if rider else None,
                "home_zone": rider.home_zone.name if rider and rider.home_zone_id else None,
                "first_shift_date": rider.first_shift_date if rider else None,
            })
        return Response({
            "pending": pending,
            "vehicle_types": [{"value": v, "label": l} for v, l in VEHICLE_TYPES],
            "zones": [{"id": z.pk, "name": z.name} for z in DeliveryZone.objects.filter(active=True)],
            "sms": "not_connected",
        })
