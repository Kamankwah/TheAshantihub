"""Delivery fee and rider pay worked out from a rate card. Pure functions plus two snapshot helpers.
Distances come from ``routing.service.leg`` (road route, or a straight-line estimate scaled by
``services.ROAD_FACTOR`` when no road service answers); every result carries ``distance_basis`` so the screens can say so."""
import math
from decimal import ROUND_HALF_UP, Decimal

from routing import service as routing_service

from . import config, services

CENT = Decimal("0.01")
BASIS = "straight-line estimate x 1.3"


def _d(value):
    return Decimal(str(value))


def round_up(amount, step):
    step = _d(step)
    if step <= 0:
        return amount.quantize(CENT, ROUND_HALF_UP)
    return (Decimal(math.ceil(amount / step)) * step).quantize(CENT)


def customer_fee(card, km, *, vehicle="motorbike", express=False, extra_pickups=0, basis=BASIS):
    km = _d(km)
    lines = [("Base", _d(card.customer_base)), (f"Distance {km} km", _d(card.customer_per_km) * km)]
    if extra_pickups:
        lines.append((f"{extra_pickups} extra pickup(s)", _d(card.extra_pickup) * extra_pickups))
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
    """(km, basis) for pickup to drop, or (None, None) when either point is unknown."""
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


def checkout_fee(items, delivery_lat, delivery_lng, *, express=False):
    """Fee for a door-to-door checkout, or None (no live card, or the route cannot be measured). The caller adds
    it to the total only when settings.DELIVERY_FEE_ENABLED is on."""
    card = config.live(config.RateCard)
    if card is None or not items:
        return None
    first = sorted(items, key=lambda i: i.pk)[0].listing
    pickup = services.valid_point(first.lat, first.lng)
    drop = services.valid_point(delivery_lat, delivery_lng)
    if pickup is None or drop is None:
        return None
    leg = routing_service.leg(pickup, drop)
    fee = customer_fee(card, leg["distance_km"], express=express, basis=leg["basis"])
    return card, fee
