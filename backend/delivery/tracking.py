"""Map payloads for each audience. Positions come only from the rider's open shift; distances only from
routing.service. Each builder returns exactly what its audience may see and nothing else."""
from django.utils import timezone

from orders.models import DeliveryAssignment as DA
from routing import service as routing_service

from . import config, dispatching, services
from .models import ShiftSession

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
    now = now or timezone.now()
    age = max(0, int((now - shift.last_fix_at).total_seconds()))
    return {"lat": float(shift.last_lat), "lng": float(shift.last_lng), "age_s": age,
            "stale": age > int(config.effective_rules()["stale_s"])}


def _pickup(a):
    lat, lng, name = services.pickup_stop(a.order)
    return {"lat": lat, "lng": lng, "name": name} if lat is not None else None


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
    return {"stage": a.status, "pickup": pickup, "drop": drop, "rider": rider, "leg": leg, "route": route}


def customer_map(a, now=None):
    """The buyer sees the rider only once the parcel is picked up, as a first name and a vehicle type."""
    drop = _drop(a)
    out = {"stage": a.status, "drop": drop, "rider": None, "leg": None, "route": None}
    if a.status not in TO_DROP:
        return out
    fix = rider_fix(a, now)
    if fix:
        parts = (a.dispatch.full_name or "").split()
        out["rider"] = {**fix, "first_name": parts[0] if parts else "Your rider", "vehicle_type": _rider(a).vehicle_type}
    out["leg"], out["route"] = _leg(a, fix, None, drop)
    return out


def business_map(a, owner, now=None):
    """The business sees the rider only on the way to it, and nothing about the customer."""
    pin = services.business_pin(owner)
    pickup = {"lat": float(pin[0]), "lng": float(pin[1]), "name": getattr(owner, "display_name", None) or owner.full_name} if pin else None
    out = {"stage": a.status, "pickup": pickup, "rider": None, "leg": None, "route": None}
    if a.status not in TO_PICKUP:
        return out
    # Delivery is single-pickup: only the business the rider is heading to may watch the rider.
    heading = services.pickup_owner(a.order)
    if heading is None or heading.pk != owner.pk:
        return out
    fix = rider_fix(a, now)
    if fix:
        parts = (a.dispatch.full_name or "").split()
        out["rider"] = {**fix, "first_name": parts[0] if parts else "The rider", "vehicle_type": _rider(a).vehicle_type}
    out["leg"], out["route"] = _leg(a, fix, pickup, None)
    return out


def queue_map(order, now=None):
    """Pickup, drop, the trip between them and every on-shift rider with a fix (nearest 30), each with the
    road time to the pickup and the dispatch engine's verdict."""
    now = now or timezone.now()
    plat, plng, pname = services.pickup_stop(order)
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
    return {"pickup": pickup, "drop": drop, "trip": trip, "route": route, "riders": riders}
