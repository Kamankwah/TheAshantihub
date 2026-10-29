"""Delivery fee and rider pay worked out from a rate card. Pure functions plus two snapshot helpers.
Distances come from ``routing.service.leg`` (road route, or a straight-line estimate scaled by
``services.ROAD_FACTOR`` when no road service answers); every result carries ``distance_basis`` so the screens can say so."""
import math
from decimal import ROUND_HALF_UP, Decimal

from routing import service as routing_service

from . import config, services

CENT = Decimal("0.01")
BASIS = "straight-line estimate x 1.3"
BASIS_TYPED = "distance you typed"  # try-a-route with a manager-entered km: no route was measured


def _d(value):
    return Decimal(str(value))


def round_up(amount, step):
    step = _d(step)
    if step <= 0:
        return amount.quantize(CENT, ROUND_HALF_UP)
    return (Decimal(math.ceil(amount / step)) * step).quantize(CENT)


def customer_fee(card, km, *, vehicle="motorbike", express=False, extra_pickups=0, detour_km=0, basis=BASIS):
    km = _d(km)
    lines = [("Base", _d(card.customer_base)), (f"Distance {km} km", _d(card.customer_per_km) * km)]
    if extra_pickups:
        lines.append((f"{extra_pickups} extra pickup(s)", _d(card.extra_pickup) * extra_pickups))
    detour = _d(detour_km)
    if detour > 0:
        lines.append((f"Detour {detour} km", _d(card.customer_per_km) * detour))
    subtotal = sum((amount for _, amount in lines), Decimal("0"))
    multiplier = _d((card.vehicle_multipliers or {}).get(vehicle, "1"))
    if multiplier != 1:
        lines.append((f"{vehicle} x{multiplier}", subtotal * multiplier - subtotal))
        subtotal *= multiplier
    if express and _d(card.express_multiplier) != 1:
        lines.append((f"Express x{card.express_multiplier}", subtotal * _d(card.express_multiplier) - subtotal))
        subtotal *= _d(card.express_multiplier)
    minimum = _d(card.customer_min_fee)
    if subtotal < minimum:
        lines.append(("Minimum fee", minimum - subtotal))
        subtotal = minimum
    total = round_up(subtotal, card.round_up_to)
    return {"total": str(total), "lines": [{"label": l, "amount": str(a.quantize(CENT, ROUND_HALF_UP))} for l, a in lines], "distance_km": str(km), "distance_basis": basis}


def rider_pay(card, km, *, wait_minutes=0, hold_wait=False, basis=BASIS):
    km = _d(km)
    lines = [("Per job", _d(card.rider_per_job)), (f"Distance {km} km", _d(card.rider_per_km) * km)]
    extra = max(0, int(wait_minutes) - card.wait_after_min)
    if extra and not hold_wait:
        lines.append((f"Waiting {extra} min", _d(card.wait_per_min) * extra))
    total = sum((a for _, a in lines), Decimal("0")).quantize(CENT, ROUND_HALF_UP)
    return {"total": str(total), "lines": [{"label": l, "amount": str(a.quantize(CENT, ROUND_HALF_UP))} for l, a in lines], "wait_pay_held": bool(hold_wait and max(0, int(wait_minutes) - card.wait_after_min)), "distance_km": str(km), "distance_basis": basis}


def route_km(order):
    """(km, basis) for pickup to drop, or (None, None) when either point is unknown. The pickup is the job's saved first
    stop when it has an assignment (so a job from before multi-stop delivery measures from the shop the rider actually
    visited), else the plan's first shop. Rider pay for the extra shop legs is an open owner decision: this still
    measures first shop to drop only."""
    from . import stops

    assignment = getattr(order, "delivery_assignment", None)
    rows = stops.stops_of(assignment) if assignment is not None else []
    if rows and rows[0].lat is not None:
        plat, plng = rows[0].lat, rows[0].lng
    else:
        plat, plng, _ = services.pickup_stop(order)
    dlat, dlng = services.drop_stop(order)
    if plat is None or dlat is None:
        return None, None
    leg = routing_service.leg((plat, plng), (dlat, dlng))
    return leg["distance_km"], leg["basis"]


def snapshot_rider_pay(assignment):
    """On delivery, record what the rider is owed for the job from the card in force (a record of the sum
    only: nothing is paid). Leaves it empty when there is no live card or the route cannot be measured."""
    card = config.live(config.RateCard)
    km, basis = route_km(assignment.order)
    if card is None or km is None:
        return
    wait = 0
    if assignment.arrived_drop_at and assignment.delivered_at:
        wait = int((assignment.delivered_at - assignment.arrived_drop_at).total_seconds() // 60)
    result = rider_pay(card, km, wait_minutes=wait, hold_wait=assignment.wait_pay_held, basis=basis)
    assignment.rider_pay = _d(result["total"])
    assignment.rider_pay_breakdown = {**result, "rate_card_version": card.version}
    assignment.save(update_fields=["rider_pay", "rider_pay_breakdown"])


def detour_over_km(total_km, direct_km, limit_pct):
    """Road km the planned route runs beyond the detour allowance (direct x (1 + limit%)); 0 within it or when unknown."""
    if total_km is None or direct_km is None:
        return Decimal("0")
    over = _d(total_km) - _d(direct_km) * (1 + _d(limit_pct) / 100)
    return max(Decimal("0"), over).quantize(CENT, ROUND_HALF_UP)


def checkout_fee(items, delivery_lat, delivery_lng, *, express=False, plan=None):
    """Fee for a door-to-door checkout, or None (no live card, or the first pickup to the drop cannot be measured). Base
    and distance are on the road km from the first planned shop to the drop, plus extra_pickup for every further shop,
    plus the km beyond the card's detour allowance at the per-km rate (spec 2026-10-14 section 4); fee["route"] says how
    it was planned. The caller adds it to the total only when settings.DELIVERY_FEE_ENABLED is on."""
    from . import stops

    card = config.live(config.RateCard)
    if card is None or not items:
        return None
    plan = plan if plan is not None else stops.plan_for_lines(items, delivery_lat, delivery_lng)
    if plan is None or plan["direct_km"] is None:
        return None
    detour = detour_over_km(plan["total_km"], plan["direct_km"], card.detour_limit_pct) if plan["planned"] else Decimal("0")
    fee = customer_fee(card, plan["direct_km"], express=express, extra_pickups=len(plan["owner_ids"]) - 1, detour_km=detour,
                       basis=plan["basis"] or BASIS)
    fee["route"] = {
        "stops": len(plan["owner_ids"]), "planned": plan["planned"], "total_km": plan["total_km"], "direct_km": plan["direct_km"],
        "detour_pct": plan["detour_pct"], "limit_pct": card.detour_limit_pct, "detour_charged_km": str(detour), "basis": plan["basis"],
    }
    return card, fee


PIN_REQUIRED_MESSAGE = "Pin your door on the map so we can work out the delivery fee."


def pin_required(lat, lng):
    """True when a door-to-door checkout has no map pin although a fee would be worked out from one: the fee switch is on,
    a rate card is in force and no delivery point was sent. With the switch off, or no card, checkout adds no fee and a
    free-text address is enough. Not the same as the cart's fee_status "needs_location": that is also answered for a
    pinned door when no fee can be measured (a first shop with no location), and such an order is accepted."""
    from django.conf import settings

    if not settings.DELIVERY_FEE_ENABLED or (lat not in (None, "") and lng not in (None, "")):
        return False
    return config.live(config.RateCard) is not None


def cart_delivery_quote(items, delivery_method, lat, lng, now=None):
    """What the cart shows for delivery, mirroring checkout: None unless fees are on and the customer chose
    door-to-door. `fee` is the amount that will be charged ("0.00" when waived) and is null until a delivery
    point lets the fee be measured; `waived_fee` is what the promo took off, when known. `mixed_note` is set when
    a free-delivery promo exists for part of the cart but the cart spans businesses."""
    from django.conf import settings
    from django.utils import timezone

    from marketing import waivers
    from marketing.promos import money
    from orders.models import Order
    from routing import region

    if not settings.DELIVERY_FEE_ENABLED or delivery_method != Order.DOOR_TO_DOOR or not items:
        return None
    now = now or timezone.now()
    if lat not in (None, "") and lng not in (None, "") and not region.in_service_area(lat, lng):
        return {"fee": None, "fee_status": "out_of_area", "waived": False, "waiver_name": None, "waived_fee": None, "mixed_note": None, "message": region.OUT_OF_AREA_MESSAGE}
    listings = [i.listing for i in items]
    quoted = checkout_fee(items, lat, lng)
    # The same promo checkout would apply: an AshantiHub-funded one only while the fee fits in its cap (no lock here).
    waiver = waivers.covering_waiver(listings, now, fee=quoted[1]["total"] if quoted else None)
    original = money(quoted[1]["total"]) if quoted else None
    # "ok": a fee was measured. "no_rate_card": none is in force, so checkout adds NO delivery fee.
    # "needs_location": no usable delivery point, so checkout adds no fee until one is chosen.
    fee_status = "ok" if quoted else ("no_rate_card" if config.live(config.RateCard) is None else "needs_location")
    out = {"fee": original, "fee_status": fee_status, "waived": waiver is not None, "waiver_name": waiver.name if waiver else None, "waived_fee": None, "mixed_note": None}
    out["lines"] = quoted[1]["lines"] if quoted else None
    out["route"] = quoted[1].get("route") if quoted else None
    if waiver is not None:
        out["fee"], out["waived_fee"] = ("0.00", original) if original is not None else (None, None)
    elif waivers.mixed_business(listings) and any(waivers.live_waivers(o, now) for o in {l.business_owner_id for l in listings}):
        out["mixed_note"] = "Free delivery only applies when everything in your order is from the same business."
    return out
