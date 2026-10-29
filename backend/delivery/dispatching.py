"""Getting a waiting order to a rider: who is eligible, who scores best, offers with a timer, and the
engine that runs them (``delivery.tasks.run_engine``). The same ranking feeds the manager's queue screen,
so what the screen shows is what the engine would do; nothing is typed in.

Eligibility (a rider is left out, with the reason, when any fails): on shift, not on a break, a fix no
older than the stale limit, no job hold, not suspended, fewer than the maximum active jobs, within the
radius of the pickup (straight-line estimate), required papers valid, not already declined or timed out
for this order, and, once cash on delivery exists, under the cash cap. An order whose business has no
pin cannot be auto-assigned ("pickup location missing"); a manager can still assign it by hand."""
import logging
from datetime import datetime, timedelta
from decimal import Decimal

from django.db import transaction
from django.utils import timezone

from field.services import haversine_m
from notifications.services import notify_staff
from orders import locks
from orders.models import DeliveryAssignment, Order
from routing import service as routing_service

from . import board, config, services
from .models import DeliveryEvent, DeliverySettings, Offer, QueueHold, Rider, ShiftSession

logger = logging.getLogger(__name__)


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
    if order.ready_not_before is not None and order.ready_not_before > start:
        start = order.ready_not_before  # a vendor was closed at purchase: the promise runs from their opening
    minutes = limits.promise_express_min if express else limits.promise_standard_min
    return start + timedelta(minutes=minutes)


IN_HOUSE_ONLY = "Re-assigned: AshantiHub's own riders only"
REDELIVERY_UNPAID = "Waiting for the customer to pay the re-delivery fee"
REDELIVERY_IN_HOUSE = "Re-delivery: AshantiHub's own riders only"
# The queue row says "first", not "only": the job goes to AshantiHub's riders first and to a third-party rider only when
# none is available (Director ruling 2). The two "only" texts above stay for the ranking's left-out reasons.
IN_HOUSE_FIRST = "Re-assigned: AshantiHub's own riders first"
REDELIVERY_IN_HOUSE_FIRST = "Re-delivery: AshantiHub's own riders first"
PICKUP_MISSING = "Pickup location missing"


def redelivery_hold(order):
    """For the queue (unlocked reads): "unpaid" while a customer-unavailable failure waits for the re-delivery fee,
    "in_house" while a paid or assigned re-delivery limits the job to AshantiHub's riders, else None
    (delivery.redelivery; services.assign enforces it under the locks)."""
    from . import redelivery

    if not redelivery.gate_applies(order):
        return None
    held = DeliveryAssignment.objects.filter(order_id=order.pk).first()
    current = redelivery.open_row(order)
    if redelivery.customer_unavailable(held):
        return "in_house" if current is not None and current.status == current.PAID else "unpaid"
    return "in_house" if current is not None and current.status == current.ASSIGNED else None


def assign_limit(order):
    """For the queue screen (unlocked read, no availability worked out per row): {"code", "label"} when the job waits for
    the customer's re-delivery fee or goes to AshantiHub's own riders first, else None."""
    hold = redelivery_hold(order)
    if hold == "unpaid":
        return {"code": "redelivery_fee_unpaid", "label": REDELIVERY_UNPAID}
    if hold == "in_house":
        return {"code": "redelivery_in_house_first", "label": REDELIVERY_IN_HOUSE_FIRST}
    if services.is_reassignment(getattr(order, "delivery_assignment", None)):
        return {"code": "in_house_first", "label": IN_HOUSE_FIRST}
    return None


def _riders(*, in_house_only=False):
    rows = Rider.objects.select_related("staff", "home_zone").filter(staff__is_active=True, staff__invite_token__isnull=True)
    if in_house_only:
        rows = rows.filter(employment=Rider.ASHANTIHUB)
    return list(rows)


def _context(order, rules, now):
    """What the eligibility rules read once per order: open shifts, active jobs per rider, who declined or timed out on
    this order, and the pickup point."""
    plat, plng, _, _ = services.dispatch_point(order)
    active = {}
    for row in DeliveryAssignment.objects.filter(status__in=DeliveryAssignment.ACTIVE_STATUSES).values_list("dispatch_id", flat=True):
        active[row] = active.get(row, 0) + 1
    return {
        "plat": plat, "plng": plng, "active": active, "stale_after": timedelta(seconds=int(rules["stale_s"])),
        "shifts": {s.rider_id: s for s in ShiftSession.objects.filter(ended_at__isnull=True)},
        "refused": set(Offer.objects.filter(order=order, status__in=(Offer.DECLINED, Offer.EXPIRED)).values_list("rider_id", flat=True)),
    }


def _rider_reason(rider, ctx, rules, now):
    """Why `rider` cannot take a job now (their own state), or None."""
    staff = rider.staff
    shift = ctx["shifts"].get(rider.pk)
    if staff.is_suspended:
        return "Suspended"
    if shift is None:
        return "Not on shift"
    if shift.on_break:
        return "On a break"
    if rider.job_hold:
        return "Stopped from new jobs"
    if shift.last_fix_at is None or now - shift.last_fix_at > ctx["stale_after"]:
        return "Location is stale"
    if ctx["active"].get(staff.pk, 0) >= int(rules["max_active_jobs"]):
        return f"Already has {ctx['active'].get(staff.pk, 0)} jobs"
    if services.required_documents_missing(rider):
        return "A required paper is missing or expired"
    if cod_over_cap(rider, rules):
        return "Holds cash over the cap"
    return None


def _order_reason(rider, ctx, rules):
    """(why `rider` cannot take this order, km): they declined or timed out on it, its pickup has no pin, or it is
    beyond the radius (straight-line estimate). Call only for a rider with an open shift."""
    if rider.pk in ctx["refused"]:
        return "Declined or timed out on this order", None
    if ctx["plat"] is None:
        return PICKUP_MISSING, None
    shift = ctx["shifts"][rider.pk]
    km = round(haversine_m(shift.last_lat, shift.last_lng, ctx["plat"], ctx["plng"]) * services.ROAD_FACTOR / 1000, 2)
    if km > float(rules["radius_km"]):
        return f"{km:.1f} km away (limit {float(rules['radius_km']):g} km)", km
    return None, km


def _in_house_free(riders, ctx, rules, now):
    """True when one of AshantiHub's own riders passes every rule for this order. A pickup with no pin cannot be measured,
    so there the distance rule is left out (an on-shift in-house rider counts, as a manager's hand assignment would)."""
    for rider in riders:
        if rider.employment != Rider.ASHANTIHUB or _rider_reason(rider, ctx, rules, now) is not None:
            continue
        if _order_reason(rider, ctx, rules)[0] in (None, PICKUP_MISSING):
            return True
    return False


def in_house_available(order, rules=None, now=None):
    """Director ruling 2 (2026-10-20): is an AshantiHub (in-house) rider available for `order` right now? On shift, not on
    a break, a fresh location, no job hold, not suspended, under the active-job limit, papers valid, under the cash cap,
    not having declined or timed out on this order, and within the radius of its pickup (left out when the pickup has no
    pin). While one is, a re-assigned delivery goes to in-house riders only; when none is, a third-party rider may take it
    (services.reassignment_refused)."""
    rules = rules or config.effective_rules()
    now = now or timezone.now()
    return _in_house_free(_riders(in_house_only=True), _context(order, rules, now), rules, now)


def rank(order, rules=None, now=None):
    """{"eligible": [...best first], "left_out": [...], "pickup_located": bool, "rules": ..., "distance_basis": ...,
    "third_party_fallback": bool}. Every rider distance here (``km``, the radius check, the distance score) is the
    straight-line estimate, so the payload says so in ``distance_basis`` whatever OSRM is doing; road legs arrive with
    stage 2. ``third_party_fallback`` is true for a re-assigned order (or a paid re-delivery's second trip) no in-house rider
    is available for, so third-party riders are ranked too (Director ruling 2)."""
    rules = rules or config.effective_rules()
    now = now or timezone.now()
    ctx = _context(order, rules, now)
    riders = _riders()
    today = timezone.localdate(now)
    jobs_today = {}
    last_done = {}
    for staff_id, assigned_at, delivered_at in DeliveryAssignment.objects.filter(assigned_at__date=today).values_list("dispatch_id", "assigned_at", "delivered_at"):
        jobs_today[staff_id] = jobs_today.get(staff_id, 0) + 1
        if delivered_at and (staff_id not in last_done or delivered_at > last_done[staff_id]):
            last_done[staff_id] = delivered_at
    # An order whose job a rider had accepted or taken further (in the queue: a failed attempt) is re-assigned, and a
    # re-assigned delivery goes to AshantiHub's own riders while one is available (services.assign; Plan 7F-E Task 6,
    # Director ruling 2). The rider who held it may still be given it again: that is not a re-assignment.
    held = getattr(order, "delivery_assignment", None)
    hold = redelivery_hold(order)
    in_house_first = hold == "in_house" or (hold is None and services.is_reassignment(held))
    fallback = in_house_first and not _in_house_free(riders, ctx, rules, now)
    eligible, left_out = [], []
    for rider in riders:
        staff = rider.staff
        km = None
        if hold == "unpaid":                 # nobody can take it until the customer pays (services.assign refuses)
            reason = REDELIVERY_UNPAID
        else:
            reason = _rider_reason(rider, ctx, rules, now)
            if reason is None and hold == "in_house" and not fallback and rider.employment != Rider.ASHANTIHUB:
                reason = REDELIVERY_IN_HOUSE
            elif reason is None and not fallback and services.third_party_reassignment(held, rider):
                reason = IN_HOUSE_ONLY
            if reason is None:
                reason, km = _order_reason(rider, ctx, rules)
        if reason:
            left_out.append({"rider_id": rider.pk, "full_name": staff.full_name, "reason": reason})
            continue
        shift = ctx["shifts"][rider.pk]
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
            "vehicle_type": rider.vehicle_type, "active_jobs": ctx["active"].get(staff.pk, 0),
        })
    eligible.sort(key=lambda r: (-r["total"], r["km"] if r["km"] is not None else 1e9, r["rider_id"]))
    return {
        "eligible": eligible, "left_out": left_out, "pickup_located": ctx["plat"] is not None,
        "rules": {k: str(v) for k, v in rules.items()}, "distance_basis": routing_service.BASIS_ESTIMATE,
        "third_party_fallback": fallback,
    }


def cod_over_cap(rider, rules):
    """Cash held from cash-on-delivery jobs at or over the cap stops new jobs (always false while no job carries cash)."""
    from . import cash

    return cash.cod_offered() and cash.held(rider.staff_id, rider.pk) >= Decimal(str(rules["cash_cap"]))


def live_offer(order):
    return Offer.objects.filter(order=order, status=Offer.OFFERED).select_related("rider__staff").first()


def make_offer(order, rider, *, source, by=None, score=None, rules=None, now=None):
    """Offer the order to `rider`, withdrawing any live offer. A re-assigned order (services.reassignment_refused) is
    offered to AshantiHub's own riders while one is available (Director ruling 2): a third-party rider is refused here
    (409 redelivery_in_house_only) before anything changes, so a manager's offer does not stall waiting for an accept
    that services.assign would refuse. services.assign checks again at the accept."""
    if services.reassignment_refused(DeliveryAssignment.objects.filter(order_id=order.pk).first(), rider, order, now):
        raise services.in_house_only_error()
    hold = redelivery_hold(order)
    if hold == "unpaid":
        from .redelivery import FEE_UNPAID

        raise services.DeliveryError(FEE_UNPAID, 409, "redelivery_fee_unpaid")
    if hold == "in_house" and rider.employment != Rider.ASHANTIHUB and in_house_available(order, rules, now):
        raise services.in_house_only_error()
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
        offer = Offer.objects.select_for_update(of=("self", "order")).select_related("order", "rider__staff").get(pk=offer_id, rider__staff=staff)
        now = timezone.now()
        if offer.status != Offer.OFFERED:
            raise services.DeliveryError("This offer is no longer open.", 409, "offer_closed")
        if offer.expires_at <= now:
            offer.status, offer.responded_at = Offer.EXPIRED, now
            offer.save(update_fields=["status", "responded_at"])
            raise services.DeliveryError("This offer timed out.", 409, "offer_expired")
        order = locks.lock_order(offer.order_id)
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
        order = locks.lock_order(order.pk)
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
        if held_for_manager(order) or redelivery_hold(order) == "unpaid":
            continue                    # every shop skipped it, or the customer has not paid the re-delivery fee yet
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


def release_deferred(now=None):
    """How many orders held until their vendor opened are now due and still waiting for a rider, logged for the beat
    record. It offers nothing: ``run_engine`` runs every 10 seconds and already offers due orders (board.waiting_orders
    stops hiding them the moment ready_not_before passes), and a second pass here would race it. Idempotent: a count."""
    now = now or timezone.now()
    due = board.waiting_orders().filter(ready_not_before__isnull=False, ready_not_before__lte=now).count()
    if due:
        logger.info("%s deferred order(s) are due and waiting for a rider", due)
    return due
