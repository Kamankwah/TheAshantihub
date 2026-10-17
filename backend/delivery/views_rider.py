"""The rider's own endpoints (permission ``delivery.dispatch``, scoped to the caller's own Rider and
jobs; another rider's job answers 404). The rider app (Dispatch role) is built on these.

Every step write returns the refreshed job (``payloads.rider_job``). A refused step answers
``{"detail", "code", ...}`` with the status in ``services.DeliveryError``."""
from datetime import timedelta

from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import HasRolePermission
from orders.models import DeliveryAssignment

from . import employment, files, payloads, services
from .models import DeliveryCall, DeliveryPhoto, Rider, RiderDocument, RiderIssue

PERMISSION = "delivery.dispatch"


class RiderView(APIView):
    """Base: dispatch only, and the caller must have a Rider profile (made when the account is)."""

    def get_permissions(self):
        return [HasRolePermission(PERMISSION)]

    def rider(self, request):
        rider = Rider.objects.select_related("staff", "staff__manager", "vehicle", "home_zone").filter(staff=request.user).first()
        if rider is None:
            rider = Rider.objects.create(staff=request.user)  # a rider made before profiles existed
        return rider

    def job(self, request, pk, *, lock=False):
        queryset = DeliveryAssignment.objects.select_related("order", "order__customer", "dispatch", "dispatch__manager")
        queryset = queryset.prefetch_related("order__items__listing__business_owner__profile", "order__items__listing__category", "events", "calls", "photos")
        if lock:
            # Never prefetch the stops on the write path: a step may create them (ensure_stops) during the request.
            queryset = queryset.select_for_update(of=("self",))
        else:
            queryset = queryset.prefetch_related("stops__business_owner__profile")
        return get_object_or_404(queryset, pk=pk, dispatch=request.user)

    @staticmethod
    def refused(exc):
        return Response(exc.body(), status=exc.status_code)


class LocationSerializer(serializers.Serializer):
    lat = serializers.FloatField(min_value=-90, max_value=90, required=False, allow_null=True)
    lng = serializers.FloatField(min_value=-180, max_value=180, required=False, allow_null=True)
    accuracy_m = serializers.FloatField(min_value=0, required=False, allow_null=True)


class StepSerializer(LocationSerializer):
    code = serializers.CharField(max_length=8, required=False, allow_blank=True)
    reason = serializers.CharField(max_length=30, required=False)
    note = serializers.CharField(max_length=500, required=False, allow_blank=True)
    stop_id = serializers.IntegerField(min_value=1, required=False, allow_null=True)


class MeView(RiderView):
    """GET rider/me/ — everything the rider's home needs in one call."""

    def get(self, request):
        rider = self.rider(request)
        now = timezone.now()
        shift = services.open_shift(rider)
        today = timezone.localdate(now)
        mine = DeliveryAssignment.objects.filter(dispatch=request.user)
        active = services.current_job(request.user)
        manager = request.user.manager
        missing = services.required_documents_missing(rider)
        return Response({
            "rider": {
                "id": rider.pk, "full_name": request.user.full_name, "vehicle_type": rider.vehicle_type,
                "vehicle": {"id": rider.vehicle_id, "plate": rider.vehicle.plate, "description": rider.vehicle.description} if rider.vehicle_id else None,
                "home_zone": rider.home_zone.name if rider.home_zone_id else None, "job_hold": rider.job_hold,
                "suspended": request.user.is_suspended, "suspension_reason": request.user.suspension_reason if request.user.is_suspended else None,
                "manager": {"id": manager.pk, "full_name": manager.full_name, "phone": manager.phone} if manager else None,
                # Who the rider works for (wallets Plan 5): only a third-party rider has a wallet (rider/wallet/*).
                "employment": rider.employment, "wallet": employment.wallet_rider(request.user) is not None,
            },
            "shift": payloads.shift_block(shift, now),
            "papers": {"required": list(services.REQUIRED_DOCUMENTS), "missing": missing, "can_start_shift": not missing},
            "active_job_id": active.pk if active else None,
            "today": {
                "accepted": mine.filter(accepted_at__date=today).count(),
                "delivered": mine.filter(delivered_at__date=today).count(),
                "could_not_deliver": mine.filter(failed_at__date=today).count(),
            },
            "stale_after_seconds": int(services.STALE_AFTER.total_seconds()),
            "flag_distance_m": services.FLAG_DISTANCE_M,
            "wait_limit_seconds": int(services.WAIT_LIMIT.total_seconds()),
            "push": "not_connected",
        })


class ShiftStartView(RiderView):
    def post(self, request):
        data = LocationSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        rider = self.rider(request)
        try:
            shift = services.start_shift(rider, lat=data.validated_data.get("lat"), lng=data.validated_data.get("lng"), accuracy=data.validated_data.get("accuracy_m"))
        except services.DeliveryError as exc:
            return self.refused(exc)
        return Response(payloads.shift_block(shift), status=status.HTTP_201_CREATED)


class ShiftEndView(RiderView):
    def post(self, request):
        rider = self.rider(request)
        try:
            shift = services.end_shift(rider, "rider")
        except services.DeliveryError as exc:
            return self.refused(exc)
        return Response({"ended": shift is not None})


class ShiftBreakView(RiderView):
    """POST rider/shift/break/ {"on": true|false} — a break pauses new offers (eligibility reads it)."""

    def post(self, request):
        rider = self.rider(request)
        shift = services.open_shift(rider)
        if shift is None:
            return Response({"detail": "You are not on shift.", "code": "not_on_shift"}, status=409)
        on = bool(request.data.get("on", True))
        if on != shift.on_break:
            shift.on_break = on
            shift.break_started_at = timezone.now() if on else None
            shift.save(update_fields=["on_break", "break_started_at"])
        return Response(payloads.shift_block(shift))


class PingView(RiderView):
    """POST rider/ping/ — one location fix. Exempt from the activity log (a ping every 15 seconds would
    flood the hash chain) and rate-limited. Stored 48 hours; the live map reads the cached last fix."""

    activity_exempt = True
    throttle_scope = "rider_ping"

    def post(self, request):
        data = LocationSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        rider = self.rider(request)
        speed = request.data.get("speed_mps")
        try:
            speed = float(speed) if speed not in (None, "") else None
        except (TypeError, ValueError):
            speed = None
        try:
            services.record_ping(rider, lat=data.validated_data.get("lat"), lng=data.validated_data.get("lng"), accuracy=data.validated_data.get("accuracy_m"), speed=speed)
        except services.DeliveryError as exc:
            return self.refused(exc)
        return Response({"ok": True, "at": timezone.now()})


class JobListView(RiderView):
    """GET rider/jobs/?scope=active|today|week|all — the rider's jobs, newest first."""

    def get(self, request):
        scope = request.query_params.get("scope", "active")
        queryset = DeliveryAssignment.objects.filter(dispatch=request.user).select_related("order", "order__customer")
        queryset = queryset.prefetch_related(
            "order__items__listing__business_owner__profile", "order__items__listing__category", "stops__business_owner__profile",
            "events", "calls", "photos",
        )
        now = timezone.now()
        today = timezone.localdate(now)
        if scope == "active":
            queryset = queryset.filter(status__in=DeliveryAssignment.ACTIVE_STATUSES)
        elif scope == "today":
            queryset = queryset.filter(assigned_at__date=today)
        elif scope == "week":
            queryset = queryset.filter(assigned_at__date__gte=today - timedelta(days=6))
        rows = [payloads.rider_job(a, now) for a in queryset.order_by("-assigned_at")[:100]]
        counts = {
            "accepted": sum(1 for r in rows if r["accepted_at"]),
            "delivered": sum(1 for r in rows if r["status"] in ("delivered", "confirmed")),
            "could_not_deliver": sum(1 for r in rows if r["status"] == "failed"),
            "flagged": sum(1 for r in rows if r["flagged"]),
        }
        return Response({"scope": scope, "counts": counts, "results": rows})


class JobDetailView(RiderView):
    def get(self, request, pk):
        return Response(payloads.rider_job(self.job(request, pk)))


class _StepView(RiderView):
    """POST a step of one's own job. ``action`` is the service function to run."""

    action = None

    def post(self, request, pk):
        data = StepSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        d = data.validated_data
        assignment = self.job(request, pk, lock=True)
        try:
            self.run(assignment, request.user, d)
        except services.DeliveryError as exc:
            return self.refused(exc)
        assignment.refresh_from_db()
        return Response(payloads.rider_job(self.job(request, pk)))

    def run(self, assignment, staff, d):
        raise NotImplementedError


class AcceptView(_StepView):
    def run(self, a, staff, d):
        services.accept(a, staff)


class ArrivePickupView(_StepView):
    def run(self, a, staff, d):
        services.arrive_pickup(a, staff, d.get("lat"), d.get("lng"), d.get("accuracy_m"))


class PickupView(_StepView):
    def run(self, a, staff, d):
        services.pickup(a, staff, d.get("code"), d.get("lat"), d.get("lng"), d.get("accuracy_m"))


class ArriveDropView(_StepView):
    def run(self, a, staff, d):
        services.arrive_drop(a, staff, d.get("lat"), d.get("lng"), d.get("accuracy_m"))


class DeliverView(_StepView):
    def run(self, a, staff, d):
        services.deliver(a, staff, d.get("code"), d.get("lat"), d.get("lng"), d.get("accuracy_m"))


class CantDeliverView(_StepView):
    def run(self, a, staff, d):
        services.cant_deliver(a, staff, d.get("reason"), d.get("note", ""), d.get("lat"), d.get("lng"), d.get("accuracy_m"))


class SkipStopView(_StepView):
    """POST rider/jobs/<id>/skip-stop/ {stop_id, note, lat, lng, accuracy_m?} — the shop being worked cannot hand over.
    `stop_id` is required and must be the job's `current_stop_id` (null only when the job shows null), so a retried tap
    is refused (409 stop_done) instead of skipping the next shop. The rider's location is required (the pin, the time
    and the note are the evidence)."""

    def run(self, a, staff, d):
        if "stop_id" not in d:
            raise services.DeliveryError("Say which shop you are skipping.", 400, "invalid", field="stop_id")
        services.skip_stop(a, staff, d.get("note", ""), stop_id=d["stop_id"], lat=d.get("lat"), lng=d.get("lng"), accuracy=d.get("accuracy_m"))


class CallCustomerView(RiderView):
    """POST rider/jobs/<id>/call/ — log a call to the customer's delivery phone and hand the number to
    the app (for a tel: link). Only while the job is on the road; the phone is never in the job payload."""

    def post(self, request, pk):
        assignment = self.job(request, pk)
        if assignment.status not in DeliveryAssignment.ACTIVE_STATUSES:
            return Response({"detail": "This job is not on the road.", "code": "wrong_step"}, status=409)
        phone = assignment.order.delivery_phone
        if not phone:
            return Response({"detail": "The customer left no delivery phone.", "code": "no_phone"}, status=409)
        call = services.log_call(assignment, request.user, DeliveryCall.RIDER_TO_CUSTOMER)
        return Response({"call_id": call.pk, "phone": phone, "started_at": call.started_at}, status=status.HTTP_201_CREATED)


class CallOutcomeView(RiderView):
    """POST rider/calls/<id>/outcome/ {"outcome": "connected"|"no_answer"} — what the rider reports."""

    def post(self, request, pk):
        call = get_object_or_404(DeliveryCall, pk=pk, caller=request.user, kind=DeliveryCall.RIDER_TO_CUSTOMER)
        outcome = request.data.get("outcome")
        if outcome not in (DeliveryCall.CONNECTED, DeliveryCall.NO_ANSWER):
            return Response({"detail": "Choose connected or no answer."}, status=400)
        call.outcome = outcome
        call.save(update_fields=["outcome"])
        return Response({"ok": True})


class JobPhotoView(RiderView):
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request, pk):
        assignment = self.job(request, pk)
        if assignment.status not in DeliveryAssignment.ACTIVE_STATUSES and assignment.status != DeliveryAssignment.FAILED:
            return Response({"detail": "This job is finished.", "code": "wrong_step"}, status=409)
        image = request.FILES.get("image")
        kind = request.data.get("kind", DeliveryPhoto.PICKUP)
        if image is None or kind not in dict(DeliveryPhoto.KIND_CHOICES):
            return Response({"detail": "Send an image and a kind (pickup, drop or evidence)."}, status=400)
        if assignment.photos.count() >= 6:
            return Response({"detail": "That job already has 6 photos.", "code": "too_many"}, status=409)
        clean = files.clean_upload(image, {"image/jpeg": ".jpg", "image/png": ".png"})
        if clean is None:
            return Response({"detail": "That file is not a JPEG or PNG image."}, status=400)
        photo = DeliveryPhoto(assignment=assignment, kind=kind, uploaded_by=request.user)
        photo.image.save(clean.name, clean, save=True)
        return Response({"id": photo.pk, "kind": photo.kind, "at": photo.at}, status=status.HTTP_201_CREATED)


class JobNoteView(RiderView):
    """POST rider/jobs/<id>/note/ {"note"} — the rider's own explanation (for example after a flagged tap)."""

    def post(self, request, pk):
        assignment = self.job(request, pk)
        assignment.rider_note = str(request.data.get("note", ""))[:500]
        assignment.save(update_fields=["rider_note"])
        return Response(payloads.rider_job(self.job(request, pk)))


class DocumentListCreateView(RiderView):
    """GET/POST rider/documents/ — the rider's own papers, and upload of a new or renewed one. A new
    upload waits for the manager's check; an approved earlier paper keeps counting until it expires."""

    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get(self, request):
        rider = self.rider(request)
        docs = rider.documents.select_related("reviewed_by")
        return Response({
            "required": list(services.REQUIRED_DOCUMENTS), "optional": list(services.OPTIONAL_DOCUMENTS),
            "missing": services.required_documents_missing(rider), "results": [payloads.document_row(d) for d in docs],
        })

    def post(self, request):
        rider = self.rider(request)
        kind = request.data.get("kind")
        if kind not in dict(RiderDocument.KIND_CHOICES):
            return Response({"detail": "Choose which paper this is."}, status=400)
        upload = request.FILES.get("file")
        if upload is None:
            return Response({"detail": "Attach a photo or PDF of the paper."}, status=400)
        expires_on = request.data.get("expires_on") or None
        field = serializers.DateField(required=False, allow_null=True)
        try:
            expires_on = field.run_validation(expires_on)
        except serializers.ValidationError:
            return Response({"detail": "Enter the expiry date as YYYY-MM-DD."}, status=400)
        if expires_on is not None and expires_on < timezone.localdate():
            return Response({"detail": "That paper has already expired."}, status=400)
        if kind == RiderDocument.GHANA_CARD and expires_on is None:
            return Response({"detail": "Enter the expiry date on your Ghana Card (YYYY-MM-DD)."}, status=400)
        clean = files.clean_upload(upload)
        if clean is None:
            return Response({"detail": "That file is not a JPEG, PNG or PDF."}, status=400)
        doc = RiderDocument(rider=rider, kind=kind, number=str(request.data.get("number", ""))[:40], expires_on=expires_on, uploaded_by=request.user)
        doc.file.save(clean.name, clean, save=True)
        return Response(payloads.document_row(doc), status=status.HTTP_201_CREATED)


class IssueView(RiderView):
    """GET/POST rider/issues/ — report an issue to the manager (a task and an in-app notice)."""

    def get(self, request):
        rider = self.rider(request)
        return Response({"results": [_issue_row(i) for i in rider.issues.all()[:50]]})

    def post(self, request):
        from notifications.services import notify_staff
        from staff_tasks.models import Task
        from staff_tasks.services import create_task

        rider = self.rider(request)
        kind = request.data.get("kind")
        if kind not in dict(RiderIssue.KIND_CHOICES):
            return Response({"detail": "Choose what kind of problem this is."}, status=400)
        assignment = None
        if request.data.get("job"):
            assignment = DeliveryAssignment.objects.filter(pk=request.data.get("job"), dispatch=request.user).first()
        pin = services.valid_point(request.data.get("lat"), request.data.get("lng"))
        issue = RiderIssue.objects.create(
            rider=rider, assignment=assignment, kind=kind, text=str(request.data.get("text", ""))[:2000],
            lat=pin[0] if pin else None, lng=pin[1] if pin else None,
        )
        manager = request.user.manager
        if manager is not None and manager.is_active:
            label = dict(RiderIssue.KIND_CHOICES)[kind]
            create_task(manager, f"{request.user.full_name}: {label}", timezone.now() + timedelta(hours=1), notes=issue.text, source=issue, kind=Task.DELIVERY_PROBLEM)
            notify_staff(manager, "delivery_alert", f"{request.user.full_name} reported: {label}", body=issue.text[:200], link="/staff/tasks", icon="🚨")
        if bool(request.data.get("pause_offers")):
            shift = services.open_shift(rider)
            if shift is not None and not shift.on_break:
                shift.on_break, shift.break_started_at = True, timezone.now()
                shift.save(update_fields=["on_break", "break_started_at"])
        return Response(_issue_row(issue), status=status.HTTP_201_CREATED)


def _issue_row(issue):
    return {
        "id": issue.pk, "kind": issue.kind, "kind_label": issue.get_kind_display(), "text": issue.text, "job_id": issue.assignment_id,
        "status": issue.status, "created_at": issue.created_at,
    }
