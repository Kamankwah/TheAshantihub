"""The pickup stops of one delivery (spec 2026-10-14): which businesses one rider collects from, in which order, and how
each stands. The order is planned once (at checkout, on Order.route_plan) and fixed for the assignment.

Reads (stops_of, current_stop, stop_for_owner, progress) never write: an assignment made before multi-stop delivery has
no stop rows and reads as one unsaved stop for its first item's business, exactly as it was served. Writes call
ensure_stops first.

Every entry is keyed by its business id (unique by construction). A business with no located pin keeps a stop with null
lat/lng; callers that route (the planner) must skip or fall back for those themselves."""
from datetime import timedelta

from django.utils import timezone

from field.services import business_pin
from routing import service as routing_service

from .models import PickupStop


def _point(lat, lng):
    from . import services

    return services.valid_point(lat, lng)


def shop_entries(lines):
    """One entry per business, in the order its first line was added: {"key": owner id, "owner", "name", "lat", "lng",
    "food", "lines"}. `lines` are cart items or order items. The point is the business pin, else the first located
    listing (None when neither). A business with any food line is a food shop."""
    shops = {}
    for line in sorted(lines, key=lambda l: l.pk):
        listing = line.listing
        owner = listing.business_owner
        entry = shops.get(owner.pk)
        if entry is None:
            entry = shops[owner.pk] = {"key": owner.pk, "owner": owner, "name": getattr(owner, "display_name", None) or owner.full_name,
                                       "lat": None, "lng": None, "food": False, "lines": []}
        entry["lines"].append(line)
        entry["food"] = entry["food"] or bool(listing.category.is_food)
    for entry in shops.values():
        pin = business_pin(entry["owner"])
        pin = _point(*pin) if pin else None
        if pin is None:
            pin = next((p for p in (_point(l.listing.lat, l.listing.lng) for l in entry["lines"]) if p), None)
        if pin is not None:
            entry["lat"], entry["lng"] = float(pin[0]), float(pin[1])
    return list(shops.values())


def fallback_order(entries):
    """Cart order with every food shop moved to the end: the order used when no route could be planned."""
    return [e["key"] for e in entries if not e["food"]] + [e["key"] for e in entries if e["food"]]


def sequence_for_order(order, entries=None):
    """Business ids in collection order: the plan stored at checkout when it covers exactly this order's businesses,
    else the fallback order."""
    entries = shop_entries(order.items.all()) if entries is None else entries
    keys = [e["key"] for e in entries]
    planned = list((order.route_plan or {}).get("owner_ids") or [])
    if planned and sorted(planned) == sorted(keys):
        return planned
    return fallback_order(entries)


def _legacy_status(assignment):
    from orders.models import DeliveryAssignment as DA

    if assignment.status == DA.AT_PICKUP:
        return PickupStop.ARRIVED
    if assignment.picked_up_at is not None or assignment.status in (DA.PICKED_UP, DA.AT_CUSTOMER, DA.DELIVERED, DA.CONFIRMED):
        return PickupStop.COLLECTED
    return PickupStop.PENDING


def _legacy_stop(assignment):
    """The single pickup an assignment from before multi-stop delivery is served with (its first item's business), unsaved."""
    from . import services

    item = services.first_item(assignment.order)
    if item is None:
        return None
    entry = shop_entries([item])[0]
    status = _legacy_status(assignment)
    return PickupStop(
        assignment=assignment, sequence=1, business_owner=entry["owner"], lat=entry["lat"], lng=entry["lng"],
        code=assignment.pickup_code, code_attempts=assignment.pickup_code_attempts, status=status,
        arrived_at=assignment.arrived_pickup_at if status == PickupStop.ARRIVED else None,
        collected_at=assignment.picked_up_at if status == PickupStop.COLLECTED else None,
    )


def stops_of(assignment):
    """The assignment's stops in sequence. Never writes."""
    rows = sorted(assignment.stops.all(), key=lambda s: s.sequence)
    if rows:
        return rows
    legacy = _legacy_stop(assignment)
    return [legacy] if legacy is not None else []


def ensure_stops(assignment):
    """Make the stops once and return them. A new assignment gets one stop per business in sequence_for_order, each
    with its own code (stop 1's mirrored into pickup_code). An assignment made before multi-stop delivery (it already has
    a pickup code) keeps its single first-item pickup, with its code and wrong tries, so nothing in flight changes. So
    does one made before codes existed (no pickup and no drop code; services.assign always sets the drop code first):
    its one stop has no code, so nothing is checked, as before, and no shop is asked for a code it was never given."""
    from . import services

    rows = list(assignment.stops.order_by("sequence"))
    if rows:
        return rows
    order = assignment.order
    entry_list = shop_entries(order.items.all())
    entries = {e["key"]: e for e in entry_list}
    if not entries:
        return []
    if assignment.pickup_code or not assignment.drop_code:
        stop = _legacy_stop(assignment)
        stop.save()
        rows, sequence = [stop], [stop.business_owner_id]
    else:
        sequence = sequence_for_order(order, entry_list)
        used = {assignment.drop_code}
        for n, owner_id in enumerate(sequence, start=1):
            entry = entries[owner_id]
            code = services.new_code(exclude=used)
            used.add(code)
            rows.append(PickupStop.objects.create(assignment=assignment, sequence=n, business_owner=entry["owner"],
                                                  lat=entry["lat"], lng=entry["lng"], code=code))
        assignment.pickup_code = rows[0].code
    plan = dict(order.route_plan or {"planned": False})
    plan.update({"owner_ids": sequence, "stop_ids": [s.pk for s in rows]})
    assignment.route_plan = plan
    assignment.save(update_fields=["pickup_code", "route_plan"])
    return rows


def stops_for_next_rider(assignment):
    """The saved stops a rider given this job (again) will work, in sequence; never re-derived from the order's plan,
    so a job from before multi-stop delivery is its one first-item stop. After a failed attempt a re-dispatch reopens
    every stop when all were skipped, else every stop not skipped (reopen_for_new_rider); otherwise the open stops."""
    from orders.models import DeliveryAssignment as DA

    from . import services

    rows = stops_of(assignment)
    if assignment.status == DA.FAILED:
        if assignment.failed_reason == services.ALL_STOPS_SKIPPED:
            return rows
        return [s for s in rows if s.status != PickupStop.SKIPPED]
    return [s for s in rows if s.status in PickupStop.OPEN]


def open_stops(assignment):
    return [s for s in stops_of(assignment) if s.status in PickupStop.OPEN]


def current_stop(assignment):
    """The stop the rider works now: the first open one in sequence; None once every stop is collected or skipped."""
    return next((s for s in stops_of(assignment) if s.status in PickupStop.OPEN), None)


def stop_for_owner(assignment, owner_id):
    return next((s for s in stops_of(assignment) if s.business_owner_id == owner_id), None)


def progress(assignment):
    rows = stops_of(assignment)
    current = next((s for s in rows if s.status in PickupStop.OPEN), None)
    return {
        "total": len(rows), "done": sum(1 for s in rows if s.status == PickupStop.COLLECTED),
        "skipped": sum(1 for s in rows if s.status == PickupStop.SKIPPED), "current": current.sequence if current else None,
    }


def stop_lines(stop, order):
    return [i for i in sorted(order.items.all(), key=lambda i: i.pk) if i.listing.business_owner_id == stop.business_owner_id]


def stop_name(stop):
    owner = stop.business_owner
    return getattr(owner, "display_name", None) or owner.full_name


def reopen_for_new_rider(assignment, *, failed, all_skipped=False):
    """A new rider takes the job. Collected and skipped stops stay done (after a failed delivery collected stops reopen:
    the goods went back); every open stop starts again with its code unchanged and its wrong tries cleared.
    `all_skipped` is true when the failed attempt ended because every shop was skipped: the manager is re-dispatching
    the order, so the skipped stops reopen too (same codes). What the skips recorded is not lost: it lives on the
    append-only DeliveryEvent rows (stops.skip_history), and each skipped shop's refund case stays open as its own
    record, only unlinked from the stop so a second skip can open a fresh case."""
    for stop in ensure_stops(assignment):
        if stop.status == PickupStop.SKIPPED:
            if not all_skipped:
                continue
            stop.status, stop.skip_note, stop.skipped_by, stop.dispute = PickupStop.PENDING, "", None, None
        if failed or stop.status == PickupStop.ARRIVED:
            stop.status, stop.arrived_at = PickupStop.PENDING, None
            if failed:
                stop.collected_at = None
        if stop.status in PickupStop.OPEN:
            stop.code_attempts, stop.planned_arrival = 0, None
        stop.save(update_fields=["status", "arrived_at", "collected_at", "code_attempts", "planned_arrival", "skip_note", "skipped_by", "dispute"])
    first = assignment.stops.filter(sequence=1).first()
    if first is not None:
        assignment.pickup_code_attempts = first.code_attempts
        assignment.save(update_fields=["pickup_code_attempts"])


def rider_point(assignment):
    """The rider's last fix from their open shift, or None."""
    from . import services

    rider = getattr(assignment.dispatch, "rider", None) if assignment.dispatch_id else None
    shift = services.open_shift(rider) if rider else None
    if shift is None or shift.last_lat is None or shift.last_lng is None:
        return None
    return (float(shift.last_lat), float(shift.last_lng))


def refresh_planned_arrivals(assignment, origin=None, start=None):
    """Planned arrival at each open stop, chained along the fixed sequence by road time from `origin` (the rider's fix,
    or the stop just finished) starting at `start`. No origin, or a stop without a location, leaves that stop and every
    later one without a time (none is made up). Shops are shown it as "about HH:MM"."""
    at = start or timezone.now()
    here = origin
    for stop in [s for s in ensure_stops(assignment) if s.status in PickupStop.OPEN]:
        if here is None or stop.lat is None:
            stop.planned_arrival, here = None, None
        else:
            leg = routing_service.leg(here, (stop.lat, stop.lng))
            at = at + timedelta(seconds=int(leg["duration_s"]))
            stop.planned_arrival, here = at, (stop.lat, stop.lng)
        stop.save(update_fields=["planned_arrival"])


def skip_history(assignment):
    """Every skip on this delivery, oldest first, read from the append-only `skipped_stop` events. It outlives a failed
    attempt: re-dispatching resets the assignment and reopens the stops, but never touches these events. `by` is "rider"
    when the rider's own pin was recorded and "manager" for a manager's skip (no pin). `at_shop` is true only for a rider
    skip whose distance from the shop was measured and is within the flag distance; it is false when the distance could
    not be measured (the shop has no pin, or the fix was too loose; `distance_m` is then null and `distance_measured` false,
    so a screen must not call it "far from the shop": it was never measured). `case_id` is the refund
    case the skip opened or kept."""
    from .models import DeliveryEvent

    by_id = {s.pk: s for s in stops_of(assignment) if s.pk}
    # Read through assignment.events.all() so a prefetch (the queue's) answers it without a query per row.
    events = sorted((e for e in assignment.events.all() if e.step == DeliveryEvent.SKIPPED_STOP and e.stop_id is not None), key=lambda e: (e.at, e.pk))
    out = []
    for e in events:
        stop = by_id.get(e.stop_id)
        if stop is None:
            continue
        rider = e.lat is not None
        out.append({
            "stop_id": e.stop_id, "sequence": stop.sequence, "business_owner_id": stop.business_owner_id, "business_name": stop_name(stop),
            "at": e.at, "note": e.note, "pinned": rider, "lat": e.lat, "lng": e.lng, "accuracy_m": e.accuracy_m,
            "distance_m": e.distance_m, "distance_measured": rider and e.distance_m is not None,
            "at_shop": rider and e.distance_m is not None and not e.flagged,
            "by": "rider" if rider else "manager", "case_id": e.dispute_id,
        })
    return out


def plan_for_lines(lines, drop_lat, drop_lng):
    """The pickup route for a cart or an order, ready to store on Order.route_plan (JSON-safe); None for no lines.
    planned=True: every shop and the drop are located and there are at most planner.MAX_STOPS shops, so this is the
    shortest order with food last. Otherwise the fallback order, with direct_km measured from its first shop when both
    ends are known, and no total, detour or over-limit (none is made up). `basis` says how distances were measured (an
    estimate is labelled as one); `limit_source` is "version" when the detour limit is a live rate card's, else
    "defaults" (the built-in limit, never an approved one)."""
    from routing import planner

    from . import config, rates

    entries = shop_entries(lines)
    if not entries:
        return None
    limits = config.effective_cart_limits()
    limit = limits["detour_limit_pct"]
    drop = _point(drop_lat, drop_lng)
    plan = {"limit_pct": limit, "limit_source": limits["source"], "total_km": None, "direct_km": None, "legs_km": None,
            "detour_pct": None, "over_limit": False, "basis": None}
    if drop is not None and all(e["lat"] is not None for e in entries) and len(entries) <= planner.MAX_STOPS:
        got = planner.plan_route([{k: e[k] for k in ("key", "lat", "lng", "food")} for e in entries], drop)
        over = rates.detour_over_km(got["total_km"], got["direct_km"], limit)
        plan.update({"owner_ids": got["order"], "planned": True, "total_km": got["total_km"], "direct_km": got["direct_km"],
                     "legs_km": got["legs_km"], "detour_pct": planner.detour_pct(got["total_km"], got["direct_km"]),
                     "over_limit": over > 0, "basis": got["basis"]})
        return plan
    order = fallback_order(entries)
    plan.update({"owner_ids": order, "planned": False})
    first = next(e for e in entries if e["key"] == order[0])
    if drop is not None and first["lat"] is not None:
        leg = routing_service.leg((first["lat"], first["lng"]), drop)
        plan.update({"direct_km": float(leg["distance_km"]), "basis": leg["basis"]})
    return plan
