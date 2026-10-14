"""The pickup stops of one delivery (spec 2026-10-14): which businesses one rider collects from, in which order, and how
each stands. The order is planned once (at checkout, on Order.route_plan) and fixed for the assignment.

Reads (stops_of, current_stop, stop_for_owner, progress) never write: an assignment made before multi-stop delivery has
no stop rows and reads as one unsaved stop for its first item's business, exactly as it was served. Writes call
ensure_stops first.

Every entry is keyed by its business id (unique by construction). A business with no located pin keeps a stop with null
lat/lng; callers that route (the planner) must skip or fall back for those themselves."""
from field.services import business_pin

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


def sequence_for_order(order):
    """Business ids in collection order: the plan stored at checkout when it covers exactly this order's businesses,
    else the fallback order."""
    entries = shop_entries(order.items.all())
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
    a pickup code) keeps its single first-item pickup, with its code and wrong tries, so nothing in flight changes."""
    from . import services

    rows = list(assignment.stops.order_by("sequence"))
    if rows:
        return rows
    order = assignment.order
    entries = {e["key"]: e for e in shop_entries(order.items.all())}
    if not entries:
        return []
    if assignment.pickup_code:
        stop = _legacy_stop(assignment)
        stop.save()
        rows, sequence = [stop], [stop.business_owner_id]
    else:
        sequence = sequence_for_order(order)
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
