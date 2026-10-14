"""The Delivery Manager's live screens (permission ``delivery.manage``): the live board, active
deliveries, one delivery's record, and the two things a manager does there (decide a location flag,
call the rider). All reads are GET; nothing here writes on a GET."""
from django.db import transaction
from django.http import FileResponse, Http404
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import HasRolePermission
from activity.models import ActivityEvent
from activity.services import record
from accounts.phones import mask_phone
from disputes.models import Dispute
from orders.models import DeliveryAssignment

from . import board, files, payloads, services, stops, tracking
from .models import DeliveryCall, DeliveryPhoto

PERMISSION = "delivery.manage"


class ManageView(APIView):
    def get_permissions(self):
        return [HasRolePermission(PERMISSION)]


class LiveView(ManageView):
    def get(self, request):
        return Response(board.live())


class ActiveView(ManageView):
    """GET active/?filter=all|at_customer|flagged|stale"""

    def get(self, request):
        return Response(board.active(request.query_params.get("filter", "all")))


def manager_job(assignment, now=None):
    """One delivery's full record for the manager. No codes (only whether they matched and how many wrong
    tries); the customer's phone is masked."""
    now = now or timezone.now()
    order = assignment.order
    events = list(assignment.events.select_related("by"))
    drop = services.drop_stop(order)
    block = payloads.stops_block(assignment, evidence=True)
    shift = None
    rider = getattr(assignment.dispatch, "rider", None)
    if rider is not None:
        shift = services.open_shift(rider)
    return {
        "id": assignment.pk, "order_id": order.pk, "status": assignment.status, "status_label": assignment.get_status_display(),
        "assignment_mode": assignment.assignment_mode, "assigned_by": payloads.person(assignment.assigned_by),
        "rider": {"id": rider.pk if rider else None, "staff_id": assignment.dispatch_id, "full_name": assignment.dispatch.full_name if assignment.dispatch_id else None,
                  "vehicle": rider.get_vehicle_type_display() if rider else None, "plate": assignment.vehicle.plate if assignment.vehicle_id else None},
        "shift": payloads.shift_block(shift, now),
        "customer": {"name": order.customer.full_name, "phone_masked": mask_phone(order.delivery_phone) if order.delivery_phone else None},
        "delivery_address": order.delivery_address, "delivery_lat": drop[0], "delivery_lng": drop[1],
        "pickup": block["primary"], "multi_pickup": block["multi_pickup"],
        "stops": [{**r, "id": 0} if r["id"] is None else r for r in block["all"]], "progress": block["progress"], "route_plan": assignment.route_plan or order.route_plan, "skip_history": block["skip_history"],
        "items": [{"name": i.listing.name, "quantity": i.quantity, "business": getattr(i.listing.business_owner, "display_name", None)} for i in order.items.all()],
        "payment": payloads.payment_label(order), "total_amount": str(order.total_amount),
        "placed_at": order.placed_at, "assigned_at": assignment.assigned_at, "deadline_at": assignment.deadline_at,
        "timeline": [payloads.event_row(e) for e in events], "steps": payloads.steps_for(assignment, events),
        "codes": {
            "pickup": {"matched": assignment.picked_up_at is not None, "wrong_tries": assignment.pickup_code_attempts},
            "drop": {"matched": assignment.delivered_at is not None, "wrong_tries": assignment.drop_code_attempts},
            # Unlocks reset the wrong-tries counters, so the log is the only evidence a step was ever locked.
            "unlocks": ActivityEvent.objects.filter(verb="delivery-job-unlock-code", target_type=assignment._meta.label_lower, target_id=str(assignment.pk)).count(),
        },
        "wait": payloads.wait_info(assignment, now),
        "flag": {"decision": assignment.flag_decision, "decided_by": payloads.person(assignment.flag_decided_by), "decided_at": assignment.flag_decided_at,
                 "note": assignment.flag_note, "wait_pay_held": assignment.wait_pay_held, "flagged_steps": [e.step for e in events if e.flagged]},
        "photos": [{"id": p.pk, "kind": p.kind, "kind_label": p.get_kind_display(), "at": p.at} for p in assignment.photos.all()],
        "calls": [{"id": c.pk, "kind": c.kind, "at": c.started_at, "outcome": c.outcome, "by": payloads.person(c.caller)} for c in assignment.calls.select_related("caller")],
        "failed": {"at": assignment.failed_at, "reason": assignment.failed_reason, "note": assignment.failed_note} if assignment.failed_at else None,
        "rider_note": assignment.rider_note, "fee": None,  # arrives with the rate card; nothing is estimated here
        "cases": [{"id": d.pk, "status": d.status, "reason": d.reason, "created_at": d.created_at} for d in Dispute.objects.filter(order=order)],
        "confirmed_at": assignment.confirmed_at, "delivered_at": assignment.delivered_at,
    }


class JobDetailView(ManageView):
    def get(self, request, pk):
        assignment = get_object_or_404(
            DeliveryAssignment.objects.select_related("order", "order__customer", "dispatch", "dispatch__rider", "assigned_by", "flag_decided_by", "vehicle")
            .prefetch_related("order__items__listing__business_owner__profile", "order__items__listing__category", "stops__business_owner__profile", "photos", "calls"),
            pk=pk,
        )
        return Response(manager_job(assignment))


class JobMapView(ManageView):
    """GET jobs/<id>/map/ — where the rider is and the route for one job."""

    def get(self, request, pk):
        assignment = get_object_or_404(DeliveryAssignment.objects.select_related("order", "order__customer", "dispatch", "dispatch__rider").prefetch_related("order__items__listing__business_owner__profile", "stops__business_owner__profile"), pk=pk)
        return Response(tracking.manager_job_map(assignment))


class FlagDecisionView(ManageView):
    """POST jobs/<id>/flag-decision/ {"decision": "cleared"|"upheld", "note", "hold_wait_pay"} — a tap far
    from its stop still counts; the manager records whether it was fine. Upholding can hold waiting pay
    (a hold only: there is no pay record yet)."""

    def post(self, request, pk):
        with transaction.atomic():
            assignment = get_object_or_404(DeliveryAssignment.objects.select_for_update(of=("self",)), pk=pk)
            if not assignment.events.filter(flagged=True).exists():
                return Response({"detail": "This delivery has no flagged tap.", "code": "no_flag"}, status=409)
            decision = request.data.get("decision")
            if decision not in (DeliveryAssignment.FLAG_CLEARED, DeliveryAssignment.FLAG_UPHELD):
                return Response({"detail": "Choose cleared or upheld."}, status=400)
            note = str(request.data.get("note", "")).strip()
            if decision == DeliveryAssignment.FLAG_UPHELD and not note:
                return Response({"detail": "Say why the flag stands."}, status=400)
            assignment.flag_decision, assignment.flag_note = decision, note[:300]
            assignment.flag_decided_by, assignment.flag_decided_at = request.user, timezone.now()
            assignment.wait_pay_held = decision == DeliveryAssignment.FLAG_UPHELD and bool(request.data.get("hold_wait_pay"))
            assignment.save(update_fields=["flag_decision", "flag_note", "flag_decided_by", "flag_decided_at", "wait_pay_held"])
        return Response({"decision": assignment.flag_decision, "wait_pay_held": assignment.wait_pay_held})


class CallRiderView(ManageView):
    """POST jobs/<id>/call-rider/ — log a call to the rider and return their phone for a tel: link."""

    def post(self, request, pk):
        assignment = get_object_or_404(DeliveryAssignment.objects.select_related("dispatch"), pk=pk)
        phone = assignment.dispatch.phone if assignment.dispatch_id else None
        if not phone:
            return Response({"detail": "This rider has no phone number on file.", "code": "no_phone"}, status=409)
        call = services.log_call(assignment, request.user, DeliveryCall.MANAGER_TO_RIDER)
        return Response({"call_id": call.pk, "phone": phone, "started_at": call.started_at}, status=201)


class UnlockCodeView(ManageView):
    """POST jobs/<id>/unlock-code/ {"which": "pickup"|"drop", "note"} - a step locked by five wrong codes is
    reopened by a manager who says why. Only the counter is reset; the code itself never changes or leaves
    the server. The unlock is written to the activity log with the note."""

    def post(self, request, pk):
        which = request.data.get("which")
        if which not in ("pickup", "drop"):
            return Response({"detail": "Choose the pickup or the drop code."}, status=400)
        note = request.data.get("note")
        note = note.strip() if isinstance(note, str) else ""
        if not note:
            return Response({"detail": "Say why you are unlocking this code."}, status=400)
        with transaction.atomic():
            assignment = get_object_or_404(DeliveryAssignment.objects.select_for_update(of=("self",)), pk=pk)
            stop = None
            if which == "pickup":
                rows = stops.ensure_stops(assignment)
                wanted = request.data.get("stop")
                if wanted not in (None, ""):
                    stop = next((s for s in rows if str(s.pk) == str(wanted)), None)
                    if stop is None:
                        raise Http404
                else:
                    stop = stops.current_stop(assignment) or (rows[0] if rows else None)
            before = stop.code_attempts if stop is not None else getattr(assignment, f"{which}_code_attempts")
            if before < services.CODE_ATTEMPT_LIMIT:
                return Response({"detail": "This code is not locked.", "code": "not_locked"}, status=409)
            if stop is not None:
                stop.code_attempts = 0
                stop.save(update_fields=["code_attempts"])
            if stop is None or stop.sequence == 1:  # the assignment field mirrors stop 1
                setattr(assignment, f"{which}_code_attempts", 0)
                assignment.save(update_fields=[f"{which}_code_attempts"])
            label = f"the pickup code at {stops.stop_name(stop)}" if stop is not None else f"the {which} code"
            # Last, because record() holds the activity chain lock until commit.
            record(
                request.user, "delivery-job-unlock-code", target=assignment, method="POST",
                summary=f"Unlocked {label} on order #{assignment.order_id}: {note[:200]}",
                before={"which": which, "stop": stop.sequence if stop else None, "wrong_tries": before},
                after={"which": which, "stop": stop.sequence if stop else None, "wrong_tries": 0, "note": note[:300]}, request=request,
            )
        return Response({"which": which, "attempts": 0})


class StopSkipView(ManageView):
    """POST jobs/<id>/stops/<stop_id>/skip/ {note} — a shop closed or cancelled after dispatch: skip its stop (the same
    refund case as a rider's skip). Any open stop, before the order leaves for the customer. The rider is told."""

    def post(self, request, pk, stop_id):
        from notifications.services import notify_staff

        with transaction.atomic():
            assignment = get_object_or_404(DeliveryAssignment.objects.select_for_update(of=("self",)), pk=pk)
            rows = stops.ensure_stops(assignment)  # a job from before multi-stop delivery has no saved stop until now
            # A GET never writes, so the record names such a job's one unsaved stop as id 0: it means the first stop.
            stop = next((s for s in rows if s.pk == stop_id or (stop_id == 0 and s.sequence == 1)), None)
            if stop is None:
                raise Http404
            try:
                services.skip_stop(assignment, request.user, request.data.get("note"), stop=stop)
            except services.DeliveryError as exc:
                return Response(exc.body(), status=exc.status_code)
            stop.refresh_from_db()  # skip_stop re-reads the stop under the lock and writes that copy
        if assignment.dispatch_id:
            ended = assignment.status == DeliveryAssignment.FAILED
            notify_staff(assignment.dispatch, "delivery_alert", f"Skip {stops.stop_name(stop)} on Order #{assignment.order_id}",
                         body=("Your manager took this shop off the delivery and no shop is left, so this delivery has ended. Nothing more to collect."
                               if ended else "Your manager took this shop off the delivery. Open the job for the next stop."),
                         link="/staff/jobs", icon="🛵")
        return Response({"stop": stop.pk, "status": stop.status, "assignment_status": assignment.status})


class PhotoFileView(ManageView):
    """GET jobs/<id>/photos/<photo>/ — a delivery photo, through this view only."""

    def get(self, request, pk, photo_id):
        photo = get_object_or_404(DeliveryPhoto, pk=photo_id, assignment_id=pk)
        return files.serve(photo.image)
