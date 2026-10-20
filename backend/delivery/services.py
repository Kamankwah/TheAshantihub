"""The rules of a delivery job and a rider's shift. Views stay thin; every state change lives here.

``record()`` (activity log) is called by the activity middleware for every staff write, so a service
never records its own event unless it has a richer story. Anything that must persist after a refused
request (a wrong code is counted) is written before the refusal is returned, because the middleware
only rolls back on an exception."""
import math
import secrets
from datetime import timedelta
from decimal import Decimal

from django.db import transaction
from django.utils import timezone

from field.services import haversine_m
from notifications.services import notify_customer, notify_staff

from .models import (
    DeliveryCall, DeliveryEvent, DeliveryZone, LocationPing, PickupStop, Rider, RiderDocument, ShiftSession,
)

# ── Settings the rider flow reads (a later package moves these into the versioned rules) ─────────
FLAG_DISTANCE_M = 150          # a tap farther than this from its stop still works but is flagged
CODE_ATTEMPT_LIMIT = 5         # wrong tries on one code before the job is flagged for a manager
WAIT_LIMIT = timedelta(minutes=10)
STALE_AFTER = timedelta(seconds=120)
PING_RETENTION = timedelta(hours=48)
MAX_ACCURACY_M = 5000          # a fix this loose is stored but not used for distance checks
ROAD_FACTOR = 1.3              # straight-line x 1.3: the only distance estimate until a road service is connected
ALL_STOPS_SKIPPED = "all_stops_skipped"  # failed_reason when no shop on the delivery could hand over (back to the queue)

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


def first_item(order):
    """The order's first line item by pk, or None. The single-pickup rule from before multi-stop delivery: a job made
    then is served with this item's business (stops._legacy_stop). Everything else (the rider's steps, payloads, every
    map and the owner's order row) reads the saved stops (stops.stops_of / current_stop / stop_for_owner)."""
    return min(order.items.all(), key=lambda i: i.pk, default=None)


def pickup_stop(order):
    """(lat, lng, business name) of the first business the planned route visits (the dispatch point), or
    (None, None, name) when it has no location. For an ORDER not yet given to a rider (the queue, offers, ranking).
    An assignment's pickups are its saved stops (stops.stops_of): never re-derive them from here, because a job made
    before multi-stop delivery keeps its first item's business whatever the plan says."""
    from . import stops

    entries = stops.shop_entries(order.items.all())
    sequence = stops.sequence_for_order(order, entries)
    if not sequence:
        return None, None, ""
    entry = next(e for e in entries if e["key"] == sequence[0])
    return (entry["lat"], entry["lng"], entry["name"]) if entry["lat"] is not None else (None, None, entry["name"])


def dispatch_info(order):
    """Where a rider given this waiting order starts, computed once per order object (a queue row, its route label, its
    ranking and its map all ask): {"lat", "lng", "name", "count", "from_saved", "owner_ids"}. An order never given to a
    rider reads its plan (pickup_stop). One whose attempt failed reads its saved stops (stops.stops_for_next_rider), so a
    returned job from before multi-stop delivery still starts at the shop its saved stop names, whatever the plan says;
    `from_saved` is then true and `owner_ids` are the saved stops' businesses in order."""
    cached = order.__dict__.get("_dispatch_info")
    if cached is not None:
        return cached
    from . import stops

    assignment = getattr(order, "delivery_assignment", None)
    if assignment is None:
        plat, plng, name = pickup_stop(order)
        info = {"lat": plat, "lng": plng, "name": name, "count": len(stops.sequence_for_order(order)), "from_saved": False, "owner_ids": None}
    else:
        saved = stops.stops_for_next_rider(assignment)
        first = saved[0] if saved else None
        info = {"lat": first.lat if first else None, "lng": first.lng if first else None, "name": stops.stop_name(first) if first else "",
                "count": len(saved), "from_saved": True, "owner_ids": [s.business_owner_id for s in saved]}
    order.__dict__["_dispatch_info"] = info
    return info


def dispatch_point(order):
    """(lat, lng, name, stop_count) of dispatch_info."""
    info = dispatch_info(order)
    return info["lat"], info["lng"], info["name"], info["count"]


def active_jobs(staff):
    """A rider's active assignments, oldest first. The rider app works the first one, so this ordering
    is the single definition of "the job the rider is on" (MeView and tracking both use it)."""
    from orders.models import DeliveryAssignment

    return DeliveryAssignment.objects.filter(
        dispatch=staff, status__in=DeliveryAssignment.ACTIVE_STATUSES,
    ).order_by("assigned_at", "pk")


def current_job(staff):
    return active_jobs(staff).first()


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


def zone_of(lat, lng, zones=None):
    """The delivery zone whose drawn boundary holds the point, else None ("unzoned"). A screen listing many orders passes
    `zones` (list(DeliveryZone.objects.filter(active=True, boundary__isnull=False))) to read the zones once."""
    if valid_point(lat, lng) is None:
        return None
    for zone in (zones if zones is not None else DeliveryZone.objects.filter(active=True, boundary__isnull=False)):
        ring = zone.boundary
        if isinstance(ring, list) and len(ring) >= 3 and point_in_ring(float(lat), float(lng), ring):
            return zone
    return None


# ── Codes ──────────────────────────────────────────────────────────────────────────────────────
def new_code(exclude=()):
    """A four-digit code not in `exclude` (the other codes on the same delivery)."""
    while True:
        code = f"{secrets.randbelow(10000):04d}"
        if code not in exclude:
            return code


def ensure_codes(assignment):
    """The customer's delivery code, made once. Pickup codes live on the stops (stops.ensure_stops)."""
    if not assignment.drop_code:
        assignment.drop_code = new_code()
        return ["drop_code"]
    return []


def _code_matches(expected, given):
    return bool(expected) and secrets.compare_digest(str(expected), str(given or "").strip())


# ── Assigning ──────────────────────────────────────────────────────────────────────────────────
def not_due_error(order):
    from accounts.hours import ACCRA

    when = order.ready_not_before.astimezone(ACCRA).strftime("%a %d %b, %H:%M")
    return DeliveryError(f"The business opens {when}; this delivery is held until then and cannot be assigned yet.", 409, "not_due")


IN_HOUSE_ONLY_MESSAGE = "A re-assigned delivery is done by AshantiHub's own riders."


def reassignment_refused(existing, rider):
    """True when giving the order's assignment `existing` (or None) to `rider` (a Rider row, or None for a dispatch with no
    rider profile, who counts as AshantiHub's own) is a re-assignment to a rider who is not AshantiHub's own (Plan 7F-E
    Task 6, Ruling R3): the job was accepted or taken further, or failed, and goes to a different rider. The one test that
    assign, the ranking and a manager's offer all use."""
    from orders.models import DeliveryAssignment

    return (
        existing is not None and rider is not None and existing.dispatch_id != rider.staff_id
        and existing.status != DeliveryAssignment.ASSIGNED and rider.employment != Rider.ASHANTIHUB
    )


def in_house_only_error():
    return DeliveryError(IN_HOUSE_ONLY_MESSAGE, 409, "redelivery_in_house_only")


def assign(order, rider_staff, assigned_by, *, mode):
    """Give a paid door-to-door order to a rider (one assignment per order). Creates the four-digit
    codes the first time and stamps an ``assigned`` event. Re-assigning before the rider has picked up
    swaps the rider and starts the job again; once the goods are picked up it is refused. `order` must be
    locked by the caller (orders.locks.lock_order: the order row before its assignment).

    A re-assignment (Plan 7F-E Task 6, owner Ruling R3) is a job the first rider had accepted or taken further, or one
    that failed, given to a different rider: it goes to AshantiHub's own riders only (409 redelivery_in_house_only), and
    it ends the first rider's leg. Any reset of the job (a swap, or a failed job given again) clears the assignment's
    pickup stamp and the reopened stops' collection stamps, so the first leg's pickup counts for no one
    (ledger.riders.pickup_made); it stays in the append-only DeliveryEvent rows. A swap of a job still waiting to be
    accepted is ordinary dispatch, open to any rider."""
    from orders import locks
    from orders.models import DeliveryAssignment

    now = timezone.now()
    if order.ready_not_before is not None and order.ready_not_before > now:
        raise not_due_error(order)
    existing = locks.lock_assignment(order)
    previous_reason = existing.failed_reason if existing is not None else ""
    failed = existing is not None and existing.status == DeliveryAssignment.FAILED  # read before the reset below changes it
    if existing is not None and existing.status not in (
        DeliveryAssignment.ASSIGNED, DeliveryAssignment.ACCEPTED, DeliveryAssignment.AT_PICKUP, DeliveryAssignment.FAILED,
    ):
        raise DeliveryError("This delivery is already on the road or finished, so it cannot be given to another rider.", 409, "not_reassignable")
    swapped = existing is not None and existing.dispatch_id != rider_staff.pk
    rider = Rider.objects.filter(staff=rider_staff).select_related("vehicle").first()
    if reassignment_refused(existing, rider):
        raise in_house_only_error()
    assignment = existing or DeliveryAssignment(order=order)
    assignment.dispatch = rider_staff
    assignment.assigned_by = assigned_by
    assignment.assignment_mode = mode
    if existing is None or swapped or existing.status == DeliveryAssignment.FAILED:
        assignment.status = DeliveryAssignment.ASSIGNED
        for field in ("accepted_at", "arrived_pickup_at", "arrived_drop_at", "failed_at", "picked_up_at", "picked_up_by"):
            setattr(assignment, field, None)
        assignment.failed_reason = assignment.failed_note = ""
        assignment.pickup_code_attempts = assignment.drop_code_attempts = 0
    if rider is not None and rider.vehicle_id:
        assignment.vehicle_id = rider.vehicle_id
    from . import stops

    if existing is not None:
        # Settle an existing row's stops before ensure_codes gives it a drop code: a job from before codes existed
        # (no codes, no stops) must keep its one uncoded first-item stop, not take the plan path and get new codes.
        stops.ensure_stops(assignment)
    ensure_codes(assignment)
    if assignment.deadline_at is None:
        from .dispatching import deadline_for

        assignment.deadline_at = deadline_for(order)
    assignment.save()
    stops.ensure_stops(assignment)
    if existing is not None and (swapped or failed):
        stops.reopen_for_new_rider(assignment, failed=failed, all_skipped=previous_reason == ALL_STOPS_SKIPPED)
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


def _stamp(assignment, step, rider_staff, stop, lat, lng, accuracy, *, note="", at_stop=None, dispute=None):
    """Write the step's event with its distance from the stop; return the event. `at_stop` is the PickupStop the
    step belongs to (None for the customer's door); `dispute` is a skip's refund case."""
    distance = None
    if stop and stop[0] is not None and (accuracy is None or accuracy <= MAX_ACCURACY_M):
        distance = round(haversine_m(lat, lng, stop[0], stop[1]))
    return DeliveryEvent.objects.create(
        assignment=assignment, step=step, at=timezone.now(), by=rider_staff, lat=lat, lng=lng, accuracy_m=accuracy,
        distance_m=distance, flagged=distance is not None and distance > FLAG_DISTANCE_M, note=note[:300], stop=at_stop,
        dispute=dispute,
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
    from . import stops

    stops.ensure_stops(assignment)
    stops.refresh_planned_arrivals(assignment, origin=stops.rider_point(assignment), start=assignment.accepted_at)
    return assignment


def arrive_pickup(assignment, rider_staff, lat, lng, accuracy):
    """The rider is at the stop being worked (the first open one in the saved sequence). Its distance is measured from
    that stop's saved point, never from the order's plan: a job from before multi-stop delivery keeps its one stop."""
    from orders.models import DeliveryAssignment

    from . import stops

    if assignment.status not in (DeliveryAssignment.ASSIGNED, DeliveryAssignment.ACCEPTED):
        raise DeliveryError("You can only arrive at the pickup before collecting the order.", 409, "wrong_step")
    lat, lng, accuracy = _fix(lat, lng, accuracy)
    stops.ensure_stops(assignment)
    stop = stops.current_stop(assignment)
    if stop is None:
        raise DeliveryError("Every shop on this delivery is done.", 409, "wrong_step")
    event = _stamp(assignment, DeliveryEvent.ARRIVED_PICKUP, rider_staff, (stop.lat, stop.lng), lat, lng, accuracy, at_stop=stop)
    stop.status, stop.arrived_at = PickupStop.ARRIVED, event.at
    stop.save(update_fields=["status", "arrived_at"])
    assignment.status = DeliveryAssignment.AT_PICKUP
    assignment.arrived_pickup_at = event.at
    assignment.save(update_fields=["status", "arrived_pickup_at"])
    if event.flagged:
        _alert_managers(assignment, "A rider tapped far from the pickup", f"Order #{assignment.order_id}: {event.distance_m} m from the stop.")
    return event


def pickup(assignment, rider_staff, code, lat, lng, accuracy):
    """Collect the current stop with its own code. The last open stop sends the job to the customer."""
    from orders.models import DeliveryAssignment

    from . import stops

    if assignment.status != DeliveryAssignment.AT_PICKUP:
        raise DeliveryError("Tap 'I've arrived' at the pickup first.", 409, "wrong_step")
    lat, lng, accuracy = _fix(lat, lng, accuracy)
    stops.ensure_stops(assignment)
    stop = stops.current_stop(assignment)
    if stop is None or stop.status != PickupStop.ARRIVED:
        raise DeliveryError("Tap 'I've arrived' at the pickup first.", 409, "wrong_step")
    _check_stop_code(assignment, stop, code)
    last = len(stops.open_stops(assignment)) == 1
    step = DeliveryEvent.PICKED_UP if last else DeliveryEvent.COLLECTED_STOP
    event = _stamp(assignment, step, rider_staff, (stop.lat, stop.lng), lat, lng, accuracy, at_stop=stop)
    stop.status, stop.collected_at, stop.collected_by_id = PickupStop.COLLECTED, event.at, assignment.dispatch_id
    stop.save(update_fields=["status", "collected_at", "collected_by"])
    _after_stop(assignment, stop, rider_staff, event.at, left_shop=True)
    return event


def _after_stop(assignment, stop, by, at, *, left_shop, summary_event=False):
    """Move a job on once `stop` is collected or skipped: to the next stop, to the customer, or (nothing was collected
    at all) to failed. `left_shop` is true when the rider was at that shop; `summary_event` writes the picked-up stamp
    when a skip, not a collection, ended the pickups."""
    from orders.models import DeliveryAssignment

    from . import stops

    if stops.open_stops(assignment):
        if left_shop:
            assignment.status, assignment.arrived_pickup_at = DeliveryAssignment.ACCEPTED, None
            assignment.save(update_fields=["status", "arrived_pickup_at"])
        if assignment.accepted_at is not None:
            origin = (stop.lat, stop.lng) if left_shop and stop.lat is not None else stops.rider_point(assignment)
            stops.refresh_planned_arrivals(assignment, origin=origin, start=at)
        return
    if not assignment.stops.filter(status=PickupStop.COLLECTED).exists():
        assignment.status, assignment.failed_at, assignment.failed_reason = DeliveryAssignment.FAILED, at, ALL_STOPS_SKIPPED
        assignment.failed_note = "No shop on this delivery could hand over its items."
        assignment.save(update_fields=["status", "failed_at", "failed_reason", "failed_note"])
        # The order is back in the Delivery queue (board.waiting_orders takes any failed job); say so to the managers.
        _alert_managers(assignment, "Every shop skipped: order is back in the queue", f"Order #{assignment.order_id}: no shop could hand over. Check the skip notes and give it to a rider again.")
        return
    if summary_event:
        DeliveryEvent.objects.create(assignment=assignment, step=DeliveryEvent.PICKED_UP, at=at, by=by, note="The last shop was skipped.")
    # The pickup belongs to the rider on the job (not to a manager whose skip ended the pickups), but only when that rider
    # collected a stop of their own: after a mid-route swap the goods may all be an earlier rider's, whose leg has ended, so
    # the stamp names that rider and counts for no one (ledger.riders.pickup_made; Plan 7F-E Task 6).
    collected = assignment.stops.filter(status=PickupStop.COLLECTED)
    if collected.filter(collected_by_id=assignment.dispatch_id).exists():
        by_id = assignment.dispatch_id
    else:
        by_id = collected.exclude(collected_by=None).order_by("sequence").values_list("collected_by_id", flat=True).first()
    assignment.status, assignment.picked_up_at, assignment.picked_up_by_id = DeliveryAssignment.PICKED_UP, at, by_id
    assignment.save(update_fields=["status", "picked_up_at", "picked_up_by"])
    _sync(assignment)


_CURRENT_STOP = object()  # skip_stop's default: an internal caller skips the stop being worked without naming it


def skip_stop(assignment, by, note, *, stop=None, stop_id=_CURRENT_STOP, lat=None, lng=None, accuracy=None):
    """A shop cannot hand over: its stop is skipped with a note (required), the customer is told, and a delivery case
    asks for that shop's lines only to be refunded. The skip event keeps the evidence (rider pin, time, note) and the
    case. A rider skips the stop being worked. The rider app names it (SkipStopView requires it): `stop_id` is the id
    the rider's job shows (None only while a job from before multi-stop delivery has no saved stop yet). Naming any other
    stop, or sending the same skip again after it went through, is 409 `stop_done` and changes nothing; a stop of
    another delivery is 404. An internal caller may leave `stop_id` out to take the current stop. A manager passes
    `stop` (any open stop of this delivery, for a shop that closed or cancelled after dispatch). Callers hold the
    assignment's row lock, under which every stop write happens, and the stop is re-read under it."""
    from orders.models import DeliveryAssignment as DA

    from . import stops

    note = note.strip() if isinstance(note, str) else ""
    if not note:
        raise DeliveryError("Say why this shop cannot hand over.", 400, "invalid", field="note")
    if len(note) > 300:
        raise DeliveryError("Keep the note to 300 characters.", 400, "invalid", field="note")
    by_manager = stop is not None
    allowed = (DA.ASSIGNED, DA.ACCEPTED, DA.AT_PICKUP) if by_manager else (DA.ACCEPTED, DA.AT_PICKUP)
    if assignment.status not in allowed:
        raise DeliveryError("A shop can only be skipped before the order leaves for the customer.", 409, "wrong_step")
    done = DeliveryError("That shop is already done. Open the job again for the next stop.", 409, "stop_done")
    if by_manager:
        if stop.pk is None or stop.assignment_id != assignment.pk:
            raise DeliveryError("That shop is not on this delivery.", 404, "not_found")
    elif stop_id is _CURRENT_STOP:
        pass
    elif stop_id is not None:
        if not PickupStop.objects.filter(pk=stop_id, assignment=assignment).exists():
            raise DeliveryError("That shop is not on this delivery.", 404, "not_found")
    elif assignment.stops.exists():
        raise done  # the rider's screen showed a stop that was not saved yet; it is now, so this is a stale tap
    stops.ensure_stops(assignment)
    if by_manager:
        stop = PickupStop.objects.filter(pk=stop.pk, assignment=assignment).first()  # fresh, under the assignment lock
    else:
        stop = stops.current_stop(assignment)
        if stop is not None and isinstance(stop_id, int) and stop.pk != stop_id:
            raise done
    if stop is None or stop.status not in PickupStop.OPEN:
        raise done
    if not by_manager:  # the rider's pin, time and note are the evidence, so the location is required
        lat, lng, accuracy = _fix(lat, lng, accuracy)
    left_shop = stop.status == PickupStop.ARRIVED
    stop.status, stop.skip_note, stop.skipped_by = PickupStop.SKIPPED, note, by
    stop.dispute = open_case_for_skipped_stop(assignment, stop)
    if by_manager:  # a manager's skip has no pin: it is the manager's word, not the rider's report
        event = DeliveryEvent.objects.create(assignment=assignment, step=DeliveryEvent.SKIPPED_STOP, at=timezone.now(), by=by, note=note,
                                             stop=stop, dispute=stop.dispute)
    else:
        event = _stamp(assignment, DeliveryEvent.SKIPPED_STOP, by, (stop.lat, stop.lng), lat, lng, accuracy, note=note, at_stop=stop,
                       dispute=stop.dispute)
        if event.flagged:
            _alert_managers(assignment, "A rider skipped a shop far from it", f"Order #{assignment.order_id}: {stops.stop_name(stop)}, {event.distance_m} m from the shop.")
    stop.save(update_fields=["status", "skip_note", "skipped_by", "dispute"])
    notify_customer(
        assignment.order.customer, "order_status", "A shop could not hand over your items",
        body=f"{stops.stop_name(stop)} could not hand over its part of Order #{assignment.order_id}. AshantiHub Support will review a refund and be in touch.",
        link="/my-account", icon="🧾",
    )
    _after_stop(assignment, stop, by, event.at, left_shop=left_shop, summary_event=True)
    return event


def open_case_for_skipped_stop(assignment, stop):
    """The delivery case a skipped stop opens: that shop's lines only, with their total, for the usual case decision
    (a manager records the refund; payments are simulated). A shop skipped again after a re-dispatch, while the case
    its earlier skip opened is still open, keeps that case: the same lines are never put up for refund twice."""
    from disputes.models import Dispute

    from . import config, stops

    earlier = Dispute.objects.filter(skip_events__stop=stop, status__in=(Dispute.OPEN, Dispute.INVESTIGATING)).order_by("created_at", "pk").first()
    if earlier is not None:
        return earlier
    order = assignment.order
    lines = stops.stop_lines(stop, order)
    total = sum((i.line_total for i in lines), Decimal("0.00"))
    listed = "; ".join(f"{i.listing.name} × {i.quantity} (GH₵ {i.line_total})" for i in lines)
    limits = config.effective_limits()
    return Dispute.objects.create(
        order=order, raised_by=order.customer, reason=Dispute.DELIVERY_ISSUE, case_type=Dispute.NOT_RECEIVED, rider=assignment.dispatch,
        answer_due_at=timezone.now() + timedelta(hours=limits.dispute_answer_hours) if limits else None,
        description=f"{stops.stop_name(stop)} could not hand over its items (stop {stop.sequence}): {listed}. "
                    f"Refund these lines only: GH₵ {total}. Note: {stop.skip_note}",
        status=Dispute.OPEN,
    )


def _check_stop_code(assignment, stop, code):
    """A stop's own code, counted and locked per stop. Stop 1's count is mirrored into the assignment's legacy field.
    The count is saved before the refusal is raised (the request does not roll back)."""
    from . import stops

    if stop.code == "":
        return
    if stop.code_attempts >= CODE_ATTEMPT_LIMIT:
        raise DeliveryError("Too many wrong codes. A manager has been told; ask them to help.", 423, "code_locked")
    if _code_matches(stop.code, code):
        return
    stop.code_attempts += 1
    stop.save(update_fields=["code_attempts"])
    if stop.sequence == 1:
        assignment.pickup_code_attempts = stop.code_attempts
        assignment.save(update_fields=["pickup_code_attempts"])
    if stop.code_attempts >= CODE_ATTEMPT_LIMIT:
        _alert_managers(assignment, "A delivery code was entered wrongly 5 times", f"Order #{assignment.order_id} (pickup code at {stops.stop_name(stop)}).")
    raise DeliveryError("That code is not right.", 400, "wrong_code", attempts_left=max(0, CODE_ATTEMPT_LIMIT - stop.code_attempts))


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
    from .rates import snapshot_rider_pay

    snapshot_rider_pay(assignment)
    _sync(assignment)
    notify_customer(
        assignment.order.customer, "order_status", "Your order has been delivered",
        body=f"Order #{assignment.order_id} has been delivered. Please confirm you received it.", link="/my-account", icon="📦",
    )
    return event


def _check_code(assignment, which, code):
    """Compare a four-digit code; count wrong tries and, at the limit, lock the step and tell the manager.
    The counter is saved before the refusal is raised (the request does not roll back). The rider's steps check only
    the drop code here; a pickup code belongs to its stop (_check_stop_code)."""
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
    """The dispute a failed delivery opens automatically (once): a delivery case with its type, the rider and the
    time to answer (from the time limits in force; empty if none). ``raised_by`` stays the customer so the
    existing queues show it."""
    from disputes.models import Dispute

    from . import config

    order = assignment.order
    # A skipped shop's refund case is never the failed delivery's own case. Its stop's link is cleared when a fully
    # skipped order is re-dispatched, so the skip event's link (append-only) is what marks it.
    existing = Dispute.objects.filter(
        order=order, status__in=(Dispute.OPEN, Dispute.INVESTIGATING), reason=Dispute.DELIVERY_ISSUE,
        pickup_stop__isnull=True, skip_events__isnull=True,
    ).first()
    if existing:
        return existing
    case_type = {"no_answer": "unreachable", "wrong_address": "unreachable", "refused": "return"}.get(assignment.failed_reason, "not_received")
    limits = config.effective_limits()
    return Dispute.objects.create(
        order=order, raised_by=order.customer, reason=Dispute.DELIVERY_ISSUE, case_type=case_type, rider=assignment.dispatch,
        answer_due_at=timezone.now() + timedelta(hours=limits.dispute_answer_hours) if limits else None,
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
    """The first version of the rider screen had no location. It still works for a one-shop job: the stop's code is
    checked when it has one and the step is stamped without a place (so no distance, no flag). A job collecting from
    several shops is refused (409 multi_stop): only the rider app takes each shop in turn with its own code."""
    from orders.models import DeliveryAssignment

    from . import stops

    if assignment.status not in (DeliveryAssignment.ASSIGNED, DeliveryAssignment.ACCEPTED, DeliveryAssignment.AT_PICKUP):
        raise DeliveryError("This delivery is not awaiting pickup.", 400, "wrong_step")

    rows = stops.ensure_stops(assignment)
    if len(rows) > 1:
        raise DeliveryError(f"This delivery collects from {len(rows)} shops. Use the rider app, which takes each shop in turn.", 409, "multi_stop")
    if rows:
        _check_stop_code(assignment, rows[0], code)
    now = timezone.now()
    if rows:
        rows[0].status, rows[0].collected_at, rows[0].collected_by_id = PickupStop.COLLECTED, now, assignment.dispatch_id
        rows[0].save(update_fields=["status", "collected_at", "collected_by"])
    assignment.status = DeliveryAssignment.PICKED_UP
    assignment.picked_up_at, assignment.picked_up_by_id = now, assignment.dispatch_id
    assignment.save(update_fields=["status", "picked_up_at", "picked_up_by"])
    DeliveryEvent.objects.create(assignment=assignment, step=DeliveryEvent.PICKED_UP, at=now, by=rider_staff, stop=rows[0] if rows else None)
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
    from .rates import snapshot_rider_pay

    snapshot_rider_pay(assignment)
    DeliveryEvent.objects.create(assignment=assignment, step=DeliveryEvent.DELIVERED, at=now, by=rider_staff)
    _sync(assignment)
    notify_customer(
        assignment.order.customer, "order_status", "Your order has been delivered",
        body=f"Order #{assignment.order_id} has been delivered. Please confirm you received it.", link="/my-account", icon="📦",
    )
