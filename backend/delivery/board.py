"""The Delivery Manager's live board: what is waiting, what is on the road, which riders are where.
Everything is derived from assignments, shifts and pings; with no riders on shift the screens say so
(no sample pins). The board shows no route distances of its own; where a screen does show distances, it labels them from the
routing status: road routes when routing is configured and answering, otherwise straight-line estimates scaled by
``services.ROAD_FACTOR``. The dispatch queue's rider ranking is the exception: it is always an estimate (``dispatching.rank``)."""
from datetime import timedelta

from django.db.models import F, Q
from django.utils import timezone

from disputes.models import Dispute
from orders.models import DeliveryAssignment, Order

from routing import service as routing_service

from . import payloads, services, stops
from .models import DeliveryEvent, DeliveryZone, Rider, ShiftSession


ESTIMATE_RANKING_NOTE = "Rider distances here are straight-line estimates (x 1.3), not road routes. Road routes are not used to rank riders yet."


def routing_block(*, estimate_figures=False):
    """The routing mode the screens report, from the live service status (never a fixed claim).
    ``estimate_figures`` is for a screen whose own numbers are straight-line estimates whatever OSRM is doing (the
    dispatch queue's ranking): it keeps the live status but says what the figures on that screen are."""
    s = routing_service.status()
    if estimate_figures:
        note = ESTIMATE_RANKING_NOTE
    elif s["mode"] == "road":
        note = "Distances and times are road routes."
    elif not s["configured"]:
        note = "Straight-line estimate. A road route service is not connected."
    else:
        note = "Straight-line estimate. The road route service is not answering, so distances and times are estimates."
    block = {**s, "note": note}
    if estimate_figures:
        block["distance_basis"] = routing_service.BASIS_ESTIMATE
    return block


def waiting_orders():
    """Paid door-to-door orders no rider holds: never assigned, or the last attempt failed. Oldest first."""
    return (
        Order.objects.filter(status=Order.PAID, delivery_method=Order.DOOR_TO_DOOR)
        .exclude(delivery_status=Order.DELIVERED)
        .exclude(refunds__whole=True)  # a wholly refunded order must never be sent out (ledger.refunds.is_wholly_refunded)
        .filter(Q(delivery_assignment__isnull=True) | Q(delivery_assignment__status=DeliveryAssignment.FAILED))
        .select_related("customer", "delivery_assignment")
        .prefetch_related("items__listing__business_owner__profile", "items__listing__category",
                          "delivery_assignment__stops__business_owner__profile", "delivery_assignment__events")
        .order_by("placed_at")
    )


def _route(order, assignment=None, point=None):
    """Where the job runs from and to. A waiting order reads its plan's first shop (the dispatch point); a job a rider
    holds reads its saved stops (the one being worked, else the first), so a job from before multi-stop delivery shows
    the shop it was actually sent to."""
    if assignment is None or assignment.status == DeliveryAssignment.FAILED:  # waiting: where the next rider starts
        plat, _, name, _ = point or services.dispatch_point(order)
        located = plat is not None
    else:
        rows = stops.stops_of(assignment)
        stop = stops.current_stop(assignment) or (rows[0] if rows else None)
        name, located = (stops.stop_name(stop), stop.lat is not None) if stop is not None else ("", False)
    return {"from": name, "to": order.delivery_address or None, "pickup_located": located, "drop_located": order.delivery_lat is not None and order.delivery_lng is not None}


def detour_warning(plan):
    """The manager's warning for an order whose planned route runs over the detour allowance (spec section 4). It keys off
    `over_limit`, not the percentage, which is None when the first shop sits at the drop point."""
    if not plan or not plan.get("over_limit"):
        return None
    pct = plan.get("detour_pct")
    longer = f"{pct:g}% longer than going direct" if pct is not None else "longer than going direct"
    estimate = " (straight-line estimate)" if plan.get("basis") == routing_service.BASIS_ESTIMATE else ""
    return f"Planned route is {longer} from the first shop (allowance {plan.get('limit_pct')}%){estimate}."


def queue_row(order, now, zones=None):
    zone = services.zone_of(order.delivery_lat, order.delivery_lng, zones)
    assignment = getattr(order, "delivery_assignment", None)
    info = services.dispatch_info(order)
    point = (info["lat"], info["lng"], info["name"], info["count"])
    return {
        "order_id": order.pk, "placed_at": order.placed_at, "waiting_minutes": int((now - order.placed_at).total_seconds() // 60),
        "route": _route(order, point=point), "zone": zone.name if zone else None, "unzoned": zone is None,
        "deadline_at": assignment.deadline_at if assignment else None,
        "returned": bool(assignment and assignment.status == DeliveryAssignment.FAILED),
        "returned_reason": assignment.failed_reason if assignment and assignment.status == DeliveryAssignment.FAILED else "",
        "skips": stops.skip_history(assignment) if assignment else [],
        "stops": info["count"], "route_plan": order.route_plan,
        # A plan describes the route the order was placed with; once a returned job's saved stops differ from it (some were
        # skipped, or it predates the plan) the plan no longer describes the route the next rider will ride, so no warning.
        "detour_warning": detour_warning(order.route_plan) if not info["from_saved"] or info["owner_ids"] == (order.route_plan or {}).get("owner_ids") else None,
        "payment": payloads.payment_label(order),
    }


def _last_event(assignment):
    events = list(assignment.events.all())
    return events[-1] if events else None


def _step_note(a, now):
    if a.status == DeliveryAssignment.AT_CUSTOMER:
        wait = payloads.wait_info(a, now)
        return f"Waiting {wait['elapsed_seconds'] // 60} of {wait['limit_seconds'] // 60} min" if wait else ""
    if a.status == DeliveryAssignment.AT_PICKUP and a.arrived_pickup_at:
        return f"Waiting for the business {int((now - a.arrived_pickup_at).total_seconds() // 60)} min"
    return ""


def active_row(a, shifts, now):
    shift = shifts.get(a.dispatch_id)
    last = _last_event(a)
    slack = int((a.deadline_at - now).total_seconds() // 60) if a.deadline_at else None
    rider = getattr(a.dispatch, "rider", None)
    flag = next((e for e in reversed(list(a.events.all())) if e.flagged), None)
    stale = bool(shift) and services.is_stale(shift, now)
    return {
        "id": a.pk, "order_id": a.order_id, "route": _route(a.order, a),
        "rider": {"id": rider.pk if rider else None, "staff_id": a.dispatch_id, "full_name": a.dispatch.full_name if a.dispatch_id else None},
        "vehicle": rider.get_vehicle_type_display() if rider else None,
        "status": a.status, "status_label": a.get_status_display(), "step_note": _step_note(a, now),
        "last_stamp": {"at": last.at, "label": payloads.STEP_LABELS.get(last.step), "distance_m": last.distance_m, "flagged": last.flagged} if last else None,
        "location_age_seconds": services.fix_age_seconds(shift, now), "stale": stale, "deadline_at": a.deadline_at, "minutes_to_spare": slack,
        "payment": payloads.payment_label(a.order),
        "flag": {"kind": "location", "label": f"Tap {last_flag_distance(flag)} m away", "decision": a.flag_decision} if flag and not a.flag_decision else ({"kind": "stale", "label": "Stale location"} if stale else None),
        "assigned_at": a.assigned_at, "assignment_mode": a.assignment_mode,
    }


def last_flag_distance(event):
    return int(event.distance_m) if event and event.distance_m is not None else 0


def active_queryset():
    return (
        DeliveryAssignment.objects.filter(status__in=DeliveryAssignment.ACTIVE_STATUSES)
        .select_related("order", "order__customer", "dispatch", "dispatch__rider")
        .prefetch_related("events", "order__items__listing__business_owner__profile", "order__items__listing__category", "stops__business_owner__profile")
        .order_by("assigned_at")
    )


def open_shifts():
    return {s.rider.staff_id: s for s in ShiftSession.objects.filter(ended_at__isnull=True).select_related("rider", "zone")}


def active(filter_name="all", now=None):
    now = now or timezone.now()
    today = timezone.localdate(now)
    shifts = open_shifts()
    rows = [active_row(a, shifts, now) for a in active_queryset()]
    pipeline = {s: 0 for s in DeliveryAssignment.ACTIVE_STATUSES}
    for r in rows:
        pipeline[r["status"]] += 1
    delivered_today = DeliveryAssignment.objects.filter(delivered_at__date=today)
    on_time = delivered_today.filter(deadline_at__isnull=False)
    counts = {
        "all": len(rows), "at_customer": pipeline[DeliveryAssignment.AT_CUSTOMER],
        "flagged": sum(1 for r in rows if r["flag"] and r["flag"]["kind"] == "location"), "stale": sum(1 for r in rows if r["stale"]),
        "cash": 0,
    }
    if filter_name == "at_customer":
        rows = [r for r in rows if r["status"] == DeliveryAssignment.AT_CUSTOMER]
    elif filter_name == "flagged":
        rows = [r for r in rows if r["flag"] and r["flag"]["kind"] == "location"]
    elif filter_name == "stale":
        rows = [r for r in rows if r["stale"]]
    return {
        "pipeline": {
            **pipeline,
            "delivered_today": delivered_today.count(),
            "delivered_today_on_time": on_time.filter(delivered_at__lte=F("deadline_at")).count(),
            "delivered_today_with_deadline": on_time.count(),
            "could_not_deliver_today": DeliveryAssignment.objects.filter(failed_at__date=today).count(),
        },
        "counts": counts, "filter": filter_name, "results": rows, "cash_on_delivery": "not_offered",
    }


def live(now=None):
    """GET live/ — the live operations screen in one read."""
    now = now or timezone.now()
    today = timezone.localdate(now)
    shifts = open_shifts()
    act = [active_row(a, shifts, now) for a in active_queryset()]
    on_job_staff = {r["rider"]["staff_id"] for r in act}
    pins = []
    status_counts = {"on_shift": 0, "free": 0, "on_job": 0, "break": 0, "stale": 0}
    for staff_id, shift in shifts.items():
        rider = shift.rider
        stale = services.is_stale(shift, now)
        on_job = staff_id in on_job_staff
        status = "on_job" if on_job else ("break" if shift.on_break else "free")
        status_counts["on_shift"] += 1
        status_counts[status] += 1
        status_counts["stale"] += 1 if stale else 0
        has_fix = shift.last_lat is not None
        pins.append({
            "rider_id": rider.pk, "full_name": rider.staff.full_name, "status": status, "lat": shift.last_lat if has_fix else None,
            "lng": shift.last_lng if has_fix else None, "last_fix_at": shift.last_fix_at, "age_seconds": services.fix_age_seconds(shift, now), "stale": stale,
        })
    zones = list(DeliveryZone.objects.filter(active=True, boundary__isnull=False))
    waiting = [queue_row(o, now, zones) for o in waiting_orders()[:50]]
    waiting_total = waiting_orders().count()
    delivered = DeliveryAssignment.objects.filter(delivered_at__date=today)
    with_deadline = delivered.filter(deadline_at__isnull=False)
    late_now = [r for r in act if r["minutes_to_spare"] is not None and r["minutes_to_spare"] < 0]
    needs = []
    for row in waiting[:5]:
        needs.append({"kind": "unassigned", "order_id": row["order_id"], "text": f"Order #{row['order_id']} has waited {row['waiting_minutes']} min for a rider", "minutes": row["waiting_minutes"]})
    for row in waiting:
        if row["detour_warning"]:
            needs.append({"kind": "detour", "order_id": row["order_id"], "text": f"Order #{row['order_id']}: {row['detour_warning']}"})
    for r in act:
        if r["stale"]:
            needs.append({"kind": "stale", "order_id": r["order_id"], "text": f"{r['rider']['full_name']} on order #{r['order_id']}: no fresh location", "rider_id": r["rider"]["id"]})
        if r["flag"] and r["flag"]["kind"] == "location":
            needs.append({"kind": "flag", "order_id": r["order_id"], "text": f"Order #{r['order_id']}: {r['flag']['label']}", "assignment_id": r["id"]})
    for r in late_now:
        needs.append({"kind": "late", "order_id": r["order_id"], "text": f"Order #{r['order_id']} is {abs(r['minutes_to_spare'])} min past its deadline", "assignment_id": r["id"]})
    disputes = list(
        Dispute.objects.filter(status__in=(Dispute.OPEN, Dispute.INVESTIGATING), reason__in=(Dispute.DELIVERY_ISSUE, Dispute.ORDER_ISSUE))
        .select_related("order").order_by("created_at")[:5]
    )
    return {
        "now": now,
        "kpis": {
            "on_the_road": len(act), "waiting": waiting_total, "late_now": len(late_now),
            "delivered_today": delivered.count(),
            "on_time_today": {"on_time": with_deadline.filter(delivered_at__lte=F("deadline_at")).count(), "of": with_deadline.count()},
            "riders": status_counts,
        },
        "needs_you": needs[:12], "pins": pins, "queue": waiting[:8],
        "disputes": [{"id": d.pk, "order_id": d.order_id, "reason": d.reason, "reason_label": d.get_reason_display(), "created_at": d.created_at, "status": d.status} for d in disputes],
        "stale_after_seconds": int(services.STALE_AFTER.total_seconds()),
        "routing": routing_block(),
        "auto_assign": None,
    }
