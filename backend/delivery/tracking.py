"""Map payloads for each audience. Positions come only from the rider's open shift; distances only from
routing.service. Each builder returns exactly what its audience may see and nothing else."""
from django.utils import timezone

from orders.models import DeliveryAssignment as DA
from routing import service as routing_service

from . import config, dispatching, services, stops
from .models import PickupStop, ShiftSession

TO_PICKUP = (DA.ASSIGNED, DA.ACCEPTED, DA.AT_PICKUP)
TO_DROP = (DA.PICKED_UP, DA.AT_CUSTOMER)
QUEUE_RIDER_CAP = 30


def line(geometry):
    """GeoJSON [lng, lat] pairs to [lat, lng] pairs; nothing to draw gives None, never a made-up line."""
    return [[lat, lng] for lng, lat in geometry] if geometry else None


def next_stop(a):
    return "pickup" if a.status in TO_PICKUP else "drop" if a.status in TO_DROP else None


def _rider(a):
    return getattr(a.dispatch, "rider", None) if a.dispatch_id else None


def rider_fix(a, now=None):
    rider = _rider(a)
    shift = services.open_shift(rider) if rider else None
    if not shift or shift.last_lat is None or shift.last_lng is None or shift.last_fix_at is None:
        return None
    if shift.last_accuracy_m is not None and shift.last_accuracy_m > services.MAX_ACCURACY_M:
        return None  # a fix this loose is not used for distances, so it is not drawn either
    now = now or timezone.now()
    age = max(0, int((now - shift.last_fix_at).total_seconds()))
    return {"lat": float(shift.last_lat), "lng": float(shift.last_lng), "age_s": age,
            "stale": age > int(config.effective_rules()["stale_s"])}


def is_current(a):
    """True when this assignment is the job the rider is on now (their oldest active one)."""
    job = services.current_job(a.dispatch) if a.dispatch_id else None
    return job is not None and job.pk == a.pk


def _point_of(stop):
    return {"lat": stop.lat, "lng": stop.lng, "name": stops.stop_name(stop)} if stop is not None and stop.lat is not None else None


def _pickup(a):
    """The saved stop the rider is heading to or at; once every stop is done, the first one (the manager's map keeps it).
    Never re-derived from the order's plan: a job from before multi-stop delivery keeps its first item's business."""
    rows = stops.stops_of(a)
    return _point_of(stops.current_stop(a) or (rows[0] if rows else None))


def _pickups(a):
    """Every saved stop in sequence, for the manager's and the rider's map (never a shop's or the customer's)."""
    return [{"id": s.pk, "sequence": s.sequence, "name": stops.stop_name(s), "lat": s.lat, "lng": s.lng, "status": s.status,
             "planned_arrival": s.planned_arrival} for s in stops.stops_of(a)]


def _drop(a):
    lat, lng = services.drop_stop(a.order)
    return {"lat": lat, "lng": lng} if lat is not None else None


def _leg(a, fix, pickup, drop):
    """(leg, route) from the rider's fix to the next stop, both None when either end is unknown."""
    stop = next_stop(a)
    target = pickup if stop == "pickup" else drop if stop == "drop" else None
    if not fix or not target:
        return None, None
    got = routing_service.leg((fix["lat"], fix["lng"]), (target["lat"], target["lng"]), geometry=True)
    leg = {"to": stop, "distance_km": got["distance_km"], "duration_s": got["duration_s"], "basis": got["basis"]}
    return leg, line(got.get("geometry"))


def manager_job_map(a, now=None):
    fix = rider_fix(a, now)
    pickup, drop = _pickup(a), _drop(a)
    rider = None
    if fix:
        r = _rider(a)
        rider = {**fix, "name": a.dispatch.full_name, "vehicle_type": r.vehicle_type}
    leg, route = _leg(a, fix, pickup, drop)
    return {"stage": a.status, "pickup": pickup, "pickups": _pickups(a), "drop": drop, "rider": rider, "leg": leg, "route": route}


def customer_map(a, now=None):
    """The buyer sees the rider only once the parcel is picked up (after the last shop: the status turns picked_up only
    when every stop is collected or skipped), as a first name and a vehicle type. Before that, how many shops are done,
    as counts only: no shop's name, place or code."""
    drop = _drop(a)
    out = {"stage": a.status, "drop": drop, "rider": None, "leg": None, "route": None, "rider_busy": False}
    p = stops.progress(a)
    out["stops"] = {"total": p["total"], "done": p["done"], "skipped": p["skipped"]}
    if a.status not in TO_DROP:
        return out
    if not is_current(a):
        # The rider holds an older job and drives to that door first: show nothing of their position.
        out["rider_busy"] = True
        return out
    fix = rider_fix(a, now)
    if fix:
        parts = (a.dispatch.full_name or "").split()
        out["rider"] = {**fix, "first_name": parts[0] if parts else "Your rider", "vehicle_type": _rider(a).vehicle_type}
    out["leg"], out["route"] = _leg(a, fix, None, drop)
    return out


def business_map(a, owner, now=None):
    """The business sees its own stop only: the rider while its shop is the stop being worked, the planned arrival
    before that, and nothing once its stop is collected or skipped. Never anything about the customer, and never another
    shop's stop, code or report. Reads the saved stops: a job from before multi-stop delivery is its first item's shop."""
    out = {"stage": a.status, "pickup": None, "stop": None, "rider": None, "leg": None, "route": None, "rider_busy": False, "rider_elsewhere": False}
    own = stops.stop_for_owner(a, owner.pk)
    if own is None:
        return out
    out["stop"] = {"status": own.status, "planned_arrival": own.planned_arrival if own.status == PickupStop.PENDING else None}
    if own.status not in PickupStop.OPEN or a.status not in TO_PICKUP:
        return out
    pickup = _point_of(own)
    out["pickup"] = pickup
    current = stops.current_stop(a)
    if current is None or current.business_owner_id != owner.pk:
        out["rider_elsewhere"] = True  # the rider is at an earlier shop: no position, no route
        return out
    if not is_current(a):
        out["rider_busy"] = True
        return out
    fix = rider_fix(a, now)
    if fix:
        parts = (a.dispatch.full_name or "").split()
        out["rider"] = {**fix, "first_name": parts[0] if parts else "The rider", "vehicle_type": _rider(a).vehicle_type}
    out["leg"], out["route"] = _leg(a, fix, pickup, None)
    return out


def _queue_pickups(order):
    """The shops the next rider collects from, in order: a returned job's saved stops (so a job from before multi-stop
    delivery shows its one saved shop), else the order's plan."""
    info = services.dispatch_info(order)
    if info["from_saved"]:
        rows = stops.stops_for_next_rider(order.delivery_assignment)
        return [{"sequence": n, "name": stops.stop_name(s), "lat": s.lat, "lng": s.lng} for n, s in enumerate(rows, start=1)]
    entry_list = stops.shop_entries(order.items.all())
    entries = {e["key"]: e for e in entry_list}
    return [{"sequence": n, "name": entries[k]["name"], "lat": entries[k]["lat"], "lng": entries[k]["lng"]}
            for n, k in enumerate(stops.sequence_for_order(order, entry_list), start=1)]


def queue_map(order, now=None):
    """Pickup (where the next rider starts), every shop in collection order, drop, the trip between the first shop and
    the drop, and every on-shift rider with a fix (nearest 30), each with the road time to the pickup and the dispatch
    engine's verdict."""
    now = now or timezone.now()
    plat, plng, pname, _ = services.dispatch_point(order)
    pickup = {"lat": plat, "lng": plng, "name": pname} if plat is not None else None
    dlat, dlng = services.drop_stop(order)
    drop = {"lat": dlat, "lng": dlng} if dlat is not None else None
    trip = route = None
    if pickup and drop:
        got = routing_service.leg((plat, plng), (dlat, dlng), geometry=True)
        trip = {"distance_km": got["distance_km"], "duration_s": got["duration_s"], "basis": got["basis"]}
        route = line(got.get("geometry"))
    ranked = dispatching.rank(order)
    eligible = {r["rider_id"] for r in ranked["eligible"]}
    reasons = {r["rider_id"]: r["reason"] for r in ranked["left_out"]}
    stale_s = int(config.effective_rules()["stale_s"])
    shifts = list(ShiftSession.objects.filter(ended_at__isnull=True, last_lat__isnull=False, last_lng__isnull=False,
                                              last_fix_at__isnull=False).select_related("rider__staff"))
    if pickup:
        shifts.sort(key=lambda s: services.haversine_m(s.last_lat, s.last_lng, plat, plng))
    shifts = shifts[:QUEUE_RIDER_CAP]
    legs = routing_service.legs_from([(float(s.last_lat), float(s.last_lng)) for s in shifts], (plat, plng)) if pickup and shifts else [None] * len(shifts)
    riders = []
    for s, got in zip(shifts, legs):
        age = max(0, int((now - s.last_fix_at).total_seconds()))
        riders.append({
            "rider_id": s.rider_id, "name": s.rider.staff.full_name, "lat": float(s.last_lat), "lng": float(s.last_lng),
            "age_s": age, "stale": age > stale_s, "eligible": s.rider_id in eligible, "reason": reasons.get(s.rider_id),
            "minutes_to_pickup": int(round(got["duration_s"] / 60)) if got else None,
            "distance_km": got["distance_km"] if got else None, "basis": got["basis"] if got else None,
        })
    return {"pickup": pickup, "pickups": _queue_pickups(order), "drop": drop, "trip": trip, "route": route, "riders": riders}
