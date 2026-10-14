"""Getting a waiting order to a rider: who is eligible, who scores best, offers with a timer, and the
engine that runs them (``delivery.tasks.run_engine``). The same ranking feeds the manager's queue screen,
so what the screen shows is what the engine would do; nothing is typed in.

Eligibility (a rider is left out, with the reason, when any fails): on shift, not on a break, a fix no
older than the stale limit, no job hold, not suspended, fewer than the maximum active jobs, within the
radius of the pickup (straight-line estimate), required papers valid, not already declined or timed out
for this order, and, once cash on delivery exists, under the cash cap. An order whose business has no
pin cannot be auto-assigned ("pickup location missing"); a manager can still assign it by hand."""
from datetime import datetime, timedelta
from decimal import Decimal

from django.db import transaction
from django.utils import timezone

from field.services import haversine_m
from notifications.services import notify_staff
from orders.models import DeliveryAssignment, Order
from routing import service as routing_service

from . import board, config, services
from .models import DeliveryEvent, DeliverySettings, Offer, QueueHold, Rider, ShiftSession


def deadline_for(order, *, express=False, limits=None):
    """placed_at plus the promise, moved to the next opening time when the order came in outside hours.
    None when no time limits are in force (no deadline is ever invented)."""
    limits = limits if limits is not None else config.effective_limits()
    if limits is None:
        return None
    tz = timezone.get_current_timezone()
    placed = timezone.localtime(order.placed_at, tz)
    opens = datetime.combine(placed.date(), limits.opens_at, tzinfo=tz)
    closes = datetime.combine(placed.date(), limits.closes_at, tzinfo=tz)
    if placed >= closes:
        start = opens + timedelta(days=1)
    elif placed < opens:
        start = opens
    else:
        start = placed
    minutes = limits.promise_express_min if express else limits.promise_standard_min
    return start + timedelta(minutes=minutes)


def rank(order, rules=None, now=None):
    """{"eligible": [...best first], "left_out": [...], "pickup_located": bool, "rules": ..., "distance_basis": ...}.
    Every rider distance here (``km``, the radius check, the distance score) is the straight-line estimate, so the
    payload says so in ``distance_basis`` whatever OSRM is doing; road legs arrive with stage 2."""
    rules = rules or config.effective_rules()
    now = now or timezone.now()
    plat, plng, _, _ = services.dispatch_point(order)
    shifts = {s.rider_id: s for s in ShiftSession.objects.filter(ended_at__isnull=True)}
    riders = list(Rider.objects.select_related("staff", "home_zone").filter(staff__is_active=True, staff__invite_token__isnull=True))
    active = {}
    for row in DeliveryAssignment.objects.filter(status__in=DeliveryAssignment.ACTIVE_STATUSES).values_list("dispatch_id", flat=True):
        active[row] = active.get(row, 0) + 1
    today = timezone.localdate(now)
    jobs_today = {}
    last_done = {}
    for staff_id, assigned_at, delivered_at in DeliveryAssignment.objects.filter(assigned_at__date=today).values_list("dispatch_id", "assigned_at", "delivered_at"):
        jobs_today[staff_id] = jobs_today.get(staff_id, 0) + 1
        if delivered_at and (staff_id not in last_done or delivered_at > last_done[staff_id]):
            last_done[staff_id] = delivered_at
    refused = set(Offer.objects.filter(order=order, status__in=(Offer.DECLINED, Offer.EXPIRED)).values_list("rider_id", flat=True))
    stale_after = timedelta(seconds=int(rules["stale_s"]))
    eligible, left_out = [], []
    for rider in riders:
        staff = rider.staff
        shift = shifts.get(rider.pk)
        reason = None
        km = None
        if staff.is_suspended:
            reason = "Suspended"
        elif shift is None:
            reason = "Not on shift"
        elif shift.on_break:
            reason = "On a break"
        elif rider.job_hold:
            reason = "Stopped from new jobs"
        elif shift.last_fix_at is None or now - shift.last_fix_at > stale_after:
            reason = "Location is stale"
        elif active.get(staff.pk, 0) >= int(rules["max_active_jobs"]):
            reason = f"Already has {active.get(staff.pk, 0)} jobs"
        elif services.required_documents_missing(rider):
            reason = "A required paper is missing or expired"
        elif cod_over_cap(rider, rules):
            reason = "Holds cash over the cap"
        elif rider.pk in refused:
            reason = "Declined or timed out on this order"
        elif plat is None:
            reason = "Pickup location missing"
        else:
            km = round(haversine_m(shift.last_lat, shift.last_lng, plat, plng) * services.ROAD_FACTOR / 1000, 2)
            if km > float(rules["radius_km"]):
                reason = f"{km:.1f} km away (limit {float(rules['radius_km']):g} km)"
        if reason:
            left_out.append({"rider_id": rider.pk, "full_name": staff.full_name, "reason": reason})
            continue
        n_today = jobs_today.get(staff.pk, 0)
        idle_since = last_done.get(staff.pk) or shift.started_at
        idle_min = max(0, (now - idle_since).total_seconds() / 60)
        parts = {
            "distance": {"label": f"{km:.1f} km away (estimate)", "points": round(max(0.0, 1 - km / float(rules["radius_km"])) * 100)},
            "fairness": {"label": f"{n_today} jobs today", "points": max(0, 100 - 20 * n_today)},
            "idle": {"label": f"Free for {int(idle_min)} min", "points": round(min(100.0, idle_min / 60 * 100))},
        }
        weights = {"distance": rules["w_distance"], "fairness": rules["w_fairness"], "idle": rules["w_idle"]}
        total = sum(parts[k]["points"] * weights[k] for k in parts) / 100
        eligible.append({
            "rider_id": rider.pk, "staff_id": staff.pk, "full_name": staff.full_name, "km": km, "total": round(total, 1),
            "parts": [{"key": k, "weight": weights[k], **parts[k]} for k in ("distance", "fairness", "idle")],
            "vehicle_type": rider.vehicle_type, "active_jobs": active.get(staff.pk, 0),
        })
    eligible.sort(key=lambda r: (-r["total"], r["km"] if r["km"] is not None else 1e9, r["rider_id"]))
    return {"eligible": eligible, "left_out": left_out, "pickup_located": plat is not None, "rules": {k: str(v) for k, v in rules.items()}, "distance_basis": routing_service.BASIS_ESTIMATE}


def cod_over_cap(rider, rules):
    """Cash held from cash-on-delivery jobs at or over the cap stops new jobs (always false while no job carries cash)."""
    from . import cash

    return cash.cod_offered() and cash.held(rider.staff_id, rider.pk) >= Decimal(str(rules["cash_cap"]))


def live_offer(order):
    return Offer.objects.filter(order=order, status=Offer.OFFERED).select_related("rider__staff").first()


def make_offer(order, rider, *, source, by=None, score=None, rules=None, now=None):
    now = now or timezone.now()
    rules = rules or config.effective_rules()
    existing = live_offer(order)
    if existing is not None:
        existing.status, existing.responded_at = Offer.WITHDRAWN, now
        existing.save(update_fields=["status", "responded_at"])
    offer = Offer.objects.create(
        order=order, rider=rider, source=source, offered_by=by, score=score or {},
        expires_at=now + timedelta(seconds=int(rules["offer_timeout_s"])),
    )
    notify_staff(rider.staff, "delivery_offer", f"New delivery offer: Order #{order.pk}", body="Open the app to accept or decline.", link="/staff/offers", icon="🛵")
    return offer


def accept_offer(offer_id, staff):
    """Atomically: the offer must still be live and unexpired and the order still waiting. Accepting takes
    the job (assigned and accepted in one step) and stamps both events."""
    with transaction.atomic():
        offer = Offer.objects.select_for_update().select_related("order", "rider__staff").get(pk=offer_id, rider__staff=staff)
        now = timezone.now()
        if offer.status != Offer.OFFERED:
            raise services.DeliveryError("This offer is no longer open.", 409, "offer_closed")
        if offer.expires_at <= now:
            offer.status, offer.responded_at = Offer.EXPIRED, now
            offer.save(update_fields=["status", "responded_at"])
            raise services.DeliveryError("This offer timed out.", 409, "offer_expired")
        order = Order.objects.select_for_update().get(pk=offer.order_id)
        held = DeliveryAssignment.objects.filter(order=order).exclude(status=DeliveryAssignment.FAILED).exists()
        if held or order.status != Order.PAID:
            offer.status, offer.responded_at = Offer.WITHDRAWN, now
            offer.save(update_fields=["status", "responded_at"])
            raise services.DeliveryError("This order has already been taken.", 409, "offer_closed")
        mode = DeliveryAssignment.AUTO if offer.source == Offer.AUTO else DeliveryAssignment.OFFER
        assignment = services.assign(order, staff, offer.offered_by, mode=mode)
        services.accept(assignment, staff)
        offer.status, offer.responded_at = Offer.ACCEPTED, now
        offer.save(update_fields=["status", "responded_at"])
        QueueHold.objects.filter(order=order).delete()
        return assignment


def decline_offer(offer_id, staff, reason=""):
    with transaction.atomic():
        offer = Offer.objects.select_for_update().get(pk=offer_id, rider__staff=staff)
        if offer.status != Offer.OFFERED:
            raise services.DeliveryError("This offer is no longer open.", 409, "offer_closed")
        offer.status, offer.responded_at, offer.decline_reason = Offer.DECLINED, timezone.now(), reason[:120]
        offer.save(update_fields=["status", "responded_at", "decline_reason"])
    return offer


def expire_offers(now=None):
    now = now or timezone.now()
    count = Offer.objects.filter(status=Offer.OFFERED, expires_at__lte=now).update(status=Offer.EXPIRED, responded_at=now)
    return count


def force_assign(order, rider, by, *, mode=DeliveryAssignment.FORCED):
    with transaction.atomic():
        order = Order.objects.select_for_update().get(pk=order.pk)
        existing = live_offer(order)
        if existing is not None:
            existing.status, existing.responded_at = Offer.WITHDRAWN, timezone.now()
            existing.save(update_fields=["status", "responded_at"])
        assignment = services.assign(order, rider.staff, by, mode=mode)
        QueueHold.objects.filter(order=order).delete()
    notify_staff(rider.staff, "delivery_offer", f"You were given Order #{order.pk}", body="Open the app: it is on your list.", link="/staff/jobs", icon="🛵")
    return assignment


def held_for_manager(order):
    """True for an order whose last attempt failed because every shop skipped it: the same shops would refuse the next
    rider too, so only a manager (a manual offer or assign, which the engine never blocks) puts it back out."""
    assignment = getattr(order, "delivery_assignment", None)
    return bool(assignment and assignment.status == DeliveryAssignment.FAILED and assignment.failed_reason == services.ALL_STOPS_SKIPPED)


def run_engine(now=None):
    """One pass: time out stale offers, then for each waiting order offer it to the best eligible rider, or
    give it straight to that rider when time is short or enough riders have said no. Does nothing while the
    auto-assign switch is off (offers a manager made still time out). An order every shop skipped is left for a manager."""
    now = now or timezone.now()
    out = {"expired": expire_offers(now), "offered": 0, "forced": 0}
    if not DeliverySettings.get().auto_assign_on:
        return out
    rules = config.effective_rules()
    limits = config.effective_limits()
    for order in board.waiting_orders():
        if held_for_manager(order):
            continue
        hold = getattr(order, "queue_hold", None)
        if hold is not None and hold.release_at > now:
            continue
        if live_offer(order) is not None:
            continue
        ranked = rank(order, rules, now)
        if not ranked["eligible"]:
            continue
        best = ranked["eligible"][0]
        rider = Rider.objects.select_related("staff").get(pk=best["rider_id"])
        refusals = Offer.objects.filter(order=order, status__in=(Offer.DECLINED, Offer.EXPIRED)).count()
        deadline = deadline_for(order, limits=limits)
        short = deadline is not None and (deadline - now) <= timedelta(minutes=int(rules["force_slack_min"]))
        if refusals >= int(rules["max_declines"]) or short:
            force_assign(order, rider, None, mode=DeliveryAssignment.AUTO)
            out["forced"] += 1
        else:
            make_offer(order, rider, source=Offer.AUTO, score=best, rules=rules, now=now)
            out["offered"] += 1
    return out
