"""The rules of a delivery job and a rider's shift. Views stay thin; every state change lives here.

``record()`` (activity log) is called by the activity middleware for every staff write, so a service
never records its own event unless it has a richer story. Anything that must persist after a refused
request (a wrong code is counted) is written before the refusal is returned, because the middleware
only rolls back on an exception."""
import math
import secrets
from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from field.services import business_pin, haversine_m
from notifications.services import notify_customer, notify_staff

from .models import (
    DeliveryCall, DeliveryEvent, DeliveryZone, LocationPing, Rider, RiderDocument, ShiftSession,
)

# ── Settings the rider flow reads (a later package moves these into the versioned rules) ─────────
FLAG_DISTANCE_M = 150          # a tap farther than this from its stop still works but is flagged
CODE_ATTEMPT_LIMIT = 5         # wrong tries on one code before the job is flagged for a manager
WAIT_LIMIT = timedelta(minutes=10)
STALE_AFTER = timedelta(seconds=120)
PING_RETENTION = timedelta(hours=48)
MAX_ACCURACY_M = 5000          # a fix this loose is stored but not used for distance checks
ROAD_FACTOR = 1.3              # straight-line x 1.3: the only distance estimate until a road service is connected

REQUIRED_DOCUMENTS = (
    RiderDocument.GHANA_CARD, RiderDocument.LICENCE, RiderDocument.VEHICLE_REG,
    RiderDocument.ROADWORTHY, RiderDocument.INSURANCE,
)
# Optional papers (shown, never blocking): the commercial licence is pending DVLA rules.
OPTIONAL_DOCUMENTS = (RiderDocument.OKADA_LICENCE,)


class DeliveryError(Exception):
    def __init__(self, message, status_code=400, code="invalid", **extra):
        super().__init__(message)
        self.message, self.status_code, self.code, self.extra = message, status_code, code, extra

    def body(self):
        return {"detail": self.message, "code": self.code, **self.extra}


# ── Geometry ───────────────────────────────────────────────────────────────────────────────────
def valid_point(lat, lng):
    try:
        lat, lng = float(lat), float(lng)
    except (TypeError, ValueError):
        return None
    if not (-90 <= lat <= 90 and -180 <= lng <= 180) or (lat == 0 and lng == 0):
        return None
    return lat, lng


def pickup_stop(order):
    """(lat, lng, business name) of the first business on the order, or (None, None, name). The pin on
    the business profile wins; a listing's own coordinates are the fallback. Multi-business orders are
    delivered from the first business only (v1: one pickup per assignment)."""
    for item in sorted(order.items.all(), key=lambda i: i.pk):
        owner = item.listing.business_owner
        pin = business_pin(owner) or valid_point(item.listing.lat, item.listing.lng)
        name = getattr(owner, "display_name", None) or owner.full_name
        return (float(pin[0]), float(pin[1]), name) if pin else (None, None, name)
    return None, None, ""


def drop_stop(order):
    pin = valid_point(order.delivery_lat, order.delivery_lng)
    return pin if pin else (None, None)


def distance_estimate_km(lat1, lng1, lat2, lng2):
    """A straight-line distance scaled by ROAD_FACTOR. Labelled an estimate wherever it is shown."""
    return round(haversine_m(lat1, lng1, lat2, lng2) * ROAD_FACTOR / 1000, 2)


def point_in_ring(lat, lng, ring):
    """Ray casting over a ring of [lng, lat] points."""
    inside = False
    n = len(ring)
    for i in range(n):
        x1, y1 = ring[i]
        x2, y2 = ring[(i + 1) % n]
        if (y1 > lat) != (y2 > lat) and lng < (x2 - x1) * (lat - y1) / ((y2 - y1) or 1e-12) + x1:
            inside = not inside
    return inside


def zone_of(lat, lng):
    """The delivery zone whose drawn boundary holds the point, else None ("unzoned")."""
    if valid_point(lat, lng) is None:
        return None
    for zone in DeliveryZone.objects.filter(active=True, boundary__isnull=False):
        ring = zone.boundary
        if isinstance(ring, list) and len(ring) >= 3 and point_in_ring(float(lat), float(lng), ring):
            return zone
    return None


# ── Codes ──────────────────────────────────────────────────────────────────────────────────────
def new_code():
    return f"{secrets.randbelow(10000):04d}"


def ensure_codes(assignment):
    changed = []
    if not assignment.pickup_code:
        assignment.pickup_code = new_code()
        changed.append("pickup_code")
    if not assignment.drop_code:
        assignment.drop_code = new_code()
        changed.append("drop_code")
    return changed


def _code_matches(expected, given):
    return bool(expected) and secrets.compare_digest(str(expected), str(given or "").strip())


# ── Assigning ──────────────────────────────────────────────────────────────────────────────────
def assign(order, rider_staff, assigned_by, *, mode):
    """Give a paid door-to-door order to a rider (one assignment per order). Creates the four-digit
    codes the first time and stamps an ``assigned`` event. Re-assigning before the rider has picked up
    swaps the rider and starts the job again; once the goods are picked up it is refused."""
    from orders.models import DeliveryAssignment

    now = timezone.now()
    existing = DeliveryAssignment.objects.select_for_update().filter(order=order).first()
    if existing is not None and existing.status not in (
        DeliveryAssignment.ASSIGNED, DeliveryAssignment.ACCEPTED, DeliveryAssignment.AT_PICKUP, DeliveryAssignment.FAILED,
    ):
        raise DeliveryError("This delivery is already on the road or finished, so it cannot be given to another rider.", 409, "not_reassignable")
    assignment = existing or DeliveryAssignment(order=order)
    swapped = existing is not None and existing.dispatch_id != rider_staff.pk
    assignment.dispatch = rider_staff
    assignment.assigned_by = assigned_by
    assignment.assignment_mode = mode
    if existing is None or swapped or existing.status == DeliveryAssignment.FAILED:
        assignment.status = DeliveryAssignment.ASSIGNED
        for field in ("accepted_at", "arrived_pickup_at", "arrived_drop_at", "failed_at"):
            setattr(assignment, field, None)
        assignment.failed_reason = assignment.failed_note = ""
        assignment.pickup_code_attempts = assignment.drop_code_attempts = 0
    rider = Rider.objects.filter(staff=rider_staff).select_related("vehicle").first()
    if rider is not None and rider.vehicle_id:
        assignment.vehicle_id = rider.vehicle_id
    ensure_codes(assignment)
    assignment.save()
    DeliveryEvent.objects.create(assignment=assignment, step=DeliveryEvent.ASSIGNED, at=now, by=assigned_by)
    return assignment


# ── The rider's steps ──────────────────────────────────────────────────────────────────────────
def _fix(lat, lng, accuracy):
    pin = valid_point(lat, lng)
    if pin is None:
        raise DeliveryError("Location is needed for this step. Allow location and try again.", 400, "location_needed")
    try:
        accuracy = float(accuracy) if accuracy not in (None, "") else None
    except (TypeError, ValueError):
        accuracy = None
    return pin[0], pin[1], accuracy


def _stamp(assignment, step, rider_staff, stop, lat, lng, accuracy, *, note=""):
    """Write the step's event with its distance from the stop; return the event."""
    distance = None
    if stop and stop[0] is not None and (accuracy is None or accuracy <= MAX_ACCURACY_M):
        distance = round(haversine_m(lat, lng, stop[0], stop[1]))
    return DeliveryEvent.objects.create(
        assignment=assignment, step=step, at=timezone.now(), by=rider_staff, lat=lat, lng=lng, accuracy_m=accuracy,
        distance_m=distance, flagged=distance is not None and distance > FLAG_DISTANCE_M, note=note[:300],
    )


def _sync(assignment):
    assignment.sync_order()


def _alert_managers(assignment, title, body):
    """Tell the rider's manager (and no one else) something needs a look. In-app only."""
    manager = getattr(assignment.dispatch, "manager", None)
    if manager is not None:
        notify_staff(manager, "delivery_alert", title, body=body, link="/staff/active-deliveries", icon="🚚")


def accept(assignment, rider_staff):
    from orders.models import DeliveryAssignment

    if assignment.status != DeliveryAssignment.ASSIGNED:
        raise DeliveryError("This job is not waiting to be accepted.", 409, "wrong_step")
    assignment.status = DeliveryAssignment.ACCEPTED
    assignment.accepted_at = timezone.now()
    assignment.save(update_fields=["status", "accepted_at"])
    DeliveryEvent.objects.create(assignment=assignment, step=DeliveryEvent.ACCEPTED, at=assignment.accepted_at, by=rider_staff)
    _sync(assignment)
    return assignment


def arrive_pickup(assignment, rider_staff, lat, lng, accuracy):
    from orders.models import DeliveryAssignment

    if assignment.status not in (DeliveryAssignment.ASSIGNED, DeliveryAssignment.ACCEPTED):
        raise DeliveryError("You can only arrive at the pickup before collecting the order.", 409, "wrong_step")
    lat, lng, accuracy = _fix(lat, lng, accuracy)
    plat, plng, _ = pickup_stop(assignment.order)
    event = _stamp(assignment, DeliveryEvent.ARRIVED_PICKUP, rider_staff, (plat, plng), lat, lng, accuracy)
    assignment.status = DeliveryAssignment.AT_PICKUP
    assignment.arrived_pickup_at = event.at
    assignment.save(update_fields=["status", "arrived_pickup_at"])
    if event.flagged:
        _alert_managers(assignment, "A rider tapped far from the pickup", f"Order #{assignment.order_id}: {event.distance_m} m from the stop.")
    return event


def pickup(assignment, rider_staff, code, lat, lng, accuracy):
    from orders.models import DeliveryAssignment

    if assignment.status != DeliveryAssignment.AT_PICKUP:
        raise DeliveryError("Tap 'I've arrived' at the pickup first.", 409, "wrong_step")
    lat, lng, accuracy = _fix(lat, lng, accuracy)
    _check_code(assignment, "pickup", code)
    plat, plng, _ = pickup_stop(assignment.order)
    event = _stamp(assignment, DeliveryEvent.PICKED_UP, rider_staff, (plat, plng), lat, lng, accuracy)
    assignment.status = DeliveryAssignment.PICKED_UP
    assignment.picked_up_at = event.at
    assignment.save(update_fields=["status", "picked_up_at"])
    _sync(assignment)
    return event


def arrive_drop(assignment, rider_staff, lat, lng, accuracy):
    from orders.models import DeliveryAssignment

    if assignment.status != DeliveryAssignment.PICKED_UP:
        raise DeliveryError("Collect the order before arriving at the customer.", 409, "wrong_step")
    lat, lng, accuracy = _fix(lat, lng, accuracy)
    event = _stamp(assignment, DeliveryEvent.ARRIVED_DROP, rider_staff, drop_stop(assignment.order), lat, lng, accuracy)
    assignment.status = DeliveryAssignment.AT_CUSTOMER
    assignment.arrived_drop_at = event.at
    assignment.save(update_fields=["status", "arrived_drop_at"])
    notify_customer(
        assignment.order.customer, "order_status", "Your rider has arrived",
        body=f"Your courier is at the delivery address for Order #{assignment.order_id}. Have your delivery code ready.",
        link="/my-account", icon="🛵",
    )
    if event.flagged:
        _alert_managers(assignment, "A rider tapped far from the customer", f"Order #{assignment.order_id}: {event.distance_m} m from the stop.")
    return event


def deliver(assignment, rider_staff, code, lat, lng, accuracy):
    from orders.models import DeliveryAssignment

    if assignment.status != DeliveryAssignment.AT_CUSTOMER:
        raise DeliveryError("Tap 'I'm outside' at the customer's address first.", 409, "wrong_step")
    lat, lng, accuracy = _fix(lat, lng, accuracy)
    _check_code(assignment, "drop", code)
    event = _stamp(assignment, DeliveryEvent.DELIVERED, rider_staff, drop_stop(assignment.order), lat, lng, accuracy)
    assignment.status = DeliveryAssignment.DELIVERED
    assignment.delivered_at = event.at
    assignment.save(update_fields=["status", "delivered_at"])
    _sync(assignment)
    notify_customer(
        assignment.order.customer, "order_status", "Your order has been delivered",
        body=f"Order #{assignment.order_id} has been delivered. Please confirm you received it.", link="/my-account", icon="📦",
    )
    return event


def _check_code(assignment, which, code):
    """Compare a four-digit code; count wrong tries and, at the limit, lock the step and tell the manager.
    The counter is saved before the refusal is raised (the request does not roll back)."""
    field, attempts = ("pickup_code", "pickup_code_attempts") if which == "pickup" else ("drop_code", "drop_code_attempts")
    if getattr(assignment, field) == "":  # a job from before codes existed has nothing to check
        return
    if getattr(assignment, attempts) >= CODE_ATTEMPT_LIMIT:
        raise DeliveryError("Too many wrong codes. A manager has been told; ask them to help.", 423, "code_locked")
    if _code_matches(getattr(assignment, field), code):
        return
    setattr(assignment, attempts, getattr(assignment, attempts) + 1)
    assignment.save(update_fields=[attempts])
    if getattr(assignment, attempts) >= CODE_ATTEMPT_LIMIT:
        _alert_managers(assignment, "A delivery code was entered wrongly 5 times", f"Order #{assignment.order_id} ({which} code).")
    left = max(0, CODE_ATTEMPT_LIMIT - getattr(assignment, attempts))
    raise DeliveryError("That code is not right.", 400, "wrong_code", attempts_left=left)


CANT_DELIVER_REASONS = {
    "no_answer": "Customer did not answer",
    "wrong_address": "Address could not be found",
    "refused": "Customer refused the order",
    "unsafe": "Not safe to deliver",
    "other": "Something else",
}


def cant_deliver(assignment, rider_staff, reason, note, lat, lng, accuracy):
    """The rider could not hand the order over. Needs the rider to be on the road with the goods. 'No
    answer' needs the 10-minute wait to have run and at least two logged calls (checked here, not on the
    phone). Opens a delivery dispute and a task for the rider's manager."""
    from disputes.models import Dispute
    from orders.models import DeliveryAssignment
    from staff_tasks.models import Task
    from staff_tasks.services import create_task

    if assignment.status not in (DeliveryAssignment.PICKED_UP, DeliveryAssignment.AT_CUSTOMER):
        raise DeliveryError("You can only report a failed delivery once you have the order.", 409, "wrong_step")
    if reason not in CANT_DELIVER_REASONS:
        raise DeliveryError("Choose a reason.", 400, "invalid", field="reason")
    now = timezone.now()
    if reason == "no_answer":
        if assignment.status != DeliveryAssignment.AT_CUSTOMER or assignment.arrived_drop_at is None or now - assignment.arrived_drop_at < WAIT_LIMIT:
            raise DeliveryError("Wait at the address for 10 minutes before reporting no answer.", 409, "wait_not_over")
        if assignment.calls.filter(kind=DeliveryCall.RIDER_TO_CUSTOMER).count() < 2:
            raise DeliveryError("Call the customer at least twice before reporting no answer.", 409, "calls_needed")
    lat, lng, accuracy = _fix(lat, lng, accuracy)
    event = _stamp(
        assignment, DeliveryEvent.CANT_DELIVER, rider_staff, drop_stop(assignment.order), lat, lng, accuracy,
        note=f"{CANT_DELIVER_REASONS[reason]}. {note}".strip(),
    )
    assignment.status = DeliveryAssignment.FAILED
    assignment.failed_at = event.at
    assignment.failed_reason = reason
    assignment.failed_note = (note or "")[:500]
    assignment.save(update_fields=["status", "failed_at", "failed_reason", "failed_note"])
    dispute = open_case_for_failed_delivery(assignment)
    manager = rider_staff.manager
    if manager is not None and manager.is_active:
        create_task(
            manager, f"Can't deliver: Order #{assignment.order_id}", now + timedelta(hours=2),
            notes=f"{rider_staff.full_name}: {CANT_DELIVER_REASONS[reason]}. {note}".strip(), source=assignment, created_by=None,
            kind=Task.DELIVERY_PROBLEM,
        )
    return event, dispute


def open_case_for_failed_delivery(assignment):
    """The dispute a failed delivery opens automatically (once). ``raised_by`` stays the customer so the
    existing queues show it; the case type and rider are filled by the dispute extension."""
    from disputes.models import Dispute

    order = assignment.order
    existing = Dispute.objects.filter(order=order, status__in=(Dispute.OPEN, Dispute.INVESTIGATING), reason=Dispute.DELIVERY_ISSUE).first()
    if existing:
        return existing
    return Dispute.objects.create(
        order=order, raised_by=order.customer, reason=Dispute.DELIVERY_ISSUE,
        description=f"The rider could not deliver: {CANT_DELIVER_REASONS.get(assignment.failed_reason, 'unknown')}. {assignment.failed_note}".strip(),
        status=Dispute.OPEN,
    )


def log_call(assignment, caller, kind):
    return DeliveryCall.objects.create(assignment=assignment, kind=kind, caller=caller)


# ── Papers ─────────────────────────────────────────────────────────────────────────────────────
def required_documents_missing(rider, today=None):
    """Required kinds with no approved, unexpired paper on file."""
    today = today or timezone.localdate()
    ok = set()
    for doc in rider.documents.filter(status=RiderDocument.APPROVED):
        if doc.expires_on is None or doc.expires_on >= today:
            ok.add(doc.kind)
    return [kind for kind in REQUIRED_DOCUMENTS if kind not in ok]


# ── Shifts and location ────────────────────────────────────────────────────────────────────────
def open_shift(rider):
    return ShiftSession.objects.filter(rider=rider, ended_at__isnull=True).first()


def start_shift(rider, *, lat, lng, accuracy, vehicle=None, zone=None):
    staff = rider.staff
    if staff.is_suspended or not staff.is_active:
        raise DeliveryError("Your account is suspended, so you cannot start a shift.", 403, "suspended")
    missing = required_documents_missing(rider)
    if missing:
        raise DeliveryError("Your papers are not all approved yet, so you cannot go on shift.", 409, "papers_missing", missing=missing)
    lat, lng, accuracy = _fix(lat, lng, accuracy)
    now = timezone.now()
    shift = open_shift(rider)
    if shift is None:
        shift = ShiftSession.objects.create(
            rider=rider, zone=zone or rider.home_zone, vehicle=vehicle or rider.vehicle,
            last_lat=lat, last_lng=lng, last_accuracy_m=accuracy, last_fix_at=now,
        )
    record_ping(rider, lat=lat, lng=lng, accuracy=accuracy, speed=None, shift=shift)
    return shift


def end_shift(rider, reason="rider"):
    from orders.models import DeliveryAssignment

    shift = open_shift(rider)
    if shift is None:
        return None
    if reason == "rider" and DeliveryAssignment.objects.filter(dispatch=rider.staff_id, status__in=DeliveryAssignment.ACTIVE_STATUSES).exists():
        raise DeliveryError("Finish or hand back your current job before going off shift.", 409, "job_in_progress")
    shift.ended_at = timezone.now()
    shift.ended_reason = reason
    shift.on_break = False
    shift.save(update_fields=["ended_at", "ended_reason", "on_break"])
    return shift


def record_ping(rider, *, lat, lng, accuracy, speed, shift=None):
    pin = valid_point(lat, lng)
    if pin is None:
        raise DeliveryError("That location is not valid.", 400, "location_needed")
    now = timezone.now()
    shift = shift or open_shift(rider)
    if shift is None:
        raise DeliveryError("Go on shift before sending your location.", 409, "not_on_shift")
    ping = LocationPing.objects.create(rider=rider, at=now, lat=pin[0], lng=pin[1], accuracy_m=accuracy, speed_mps=speed)
    shift.last_lat, shift.last_lng, shift.last_accuracy_m, shift.last_fix_at = pin[0], pin[1], accuracy, now
    shift.save(update_fields=["last_lat", "last_lng", "last_accuracy_m", "last_fix_at"])
    return ping


def fix_age_seconds(shift, now=None):
    if shift is None or shift.last_fix_at is None:
        return None
    return max(0, int(((now or timezone.now()) - shift.last_fix_at).total_seconds()))


def is_stale(shift, now=None):
    age = fix_age_seconds(shift, now)
    return age is None or age > STALE_AFTER.total_seconds()


def purge_old_pings(now=None):
    cutoff = (now or timezone.now()) - PING_RETENTION
    deleted, _ = LocationPing.objects.filter(at__lt=cutoff).delete()
    return deleted


# ── The older panel's two buttons (orders/delivery/<id>/pickup|deliver/) ──────────────────────────
def legacy_pickup(assignment, rider_staff, code):
    """The first version of the rider screen had no location. It still works, but the codes are checked
    when the job has them and the step is stamped without a place (so no distance, no flag)."""
    from orders.models import DeliveryAssignment

    if assignment.status not in (DeliveryAssignment.ASSIGNED, DeliveryAssignment.ACCEPTED, DeliveryAssignment.AT_PICKUP):
        raise DeliveryError("This delivery is not awaiting pickup.", 400, "wrong_step")
    _check_code(assignment, "pickup", code)
    now = timezone.now()
    assignment.status = DeliveryAssignment.PICKED_UP
    assignment.picked_up_at = now
    assignment.save(update_fields=["status", "picked_up_at"])
    DeliveryEvent.objects.create(assignment=assignment, step=DeliveryEvent.PICKED_UP, at=now, by=rider_staff)
    _sync(assignment)


def legacy_deliver(assignment, rider_staff, code):
    from orders.models import DeliveryAssignment

    if assignment.status not in (DeliveryAssignment.PICKED_UP, DeliveryAssignment.AT_CUSTOMER):
        raise DeliveryError("This delivery has not been picked up yet.", 400, "wrong_step")
    _check_code(assignment, "drop", code)
    now = timezone.now()
    assignment.status = DeliveryAssignment.DELIVERED
    assignment.delivered_at = now
    assignment.save(update_fields=["status", "delivered_at"])
    DeliveryEvent.objects.create(assignment=assignment, step=DeliveryEvent.DELIVERED, at=now, by=rider_staff)
    _sync(assignment)
    notify_customer(
        assignment.order.customer, "order_status", "Your order has been delivered",
        body=f"Order #{assignment.order_id} has been delivered. Please confirm you received it.", link="/my-account", icon="📦",
    )
