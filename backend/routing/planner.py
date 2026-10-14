"""The order one rider collects a delivery's shops in (spec 2026-10-14, section 2): brute force over every order with
the food shops last (at most MAX_STOPS shops, so at most 720 orders), from one distance table, ending at the delivery
point. Distances come from routing.service, which never raises: with OSRM down the table is the labelled estimate."""
from itertools import permutations

from . import service

MAX_STOPS = 6


def detour_pct(total_km, direct_km):
    """How much longer the planned route is than going straight from its first shop, in percent; None when either is
    unknown or the first shop is at the delivery point (nothing to compare with)."""
    if total_km is None or direct_km is None or direct_km <= 0:
        return None
    return round((total_km - direct_km) / direct_km * 100, 1)


def plan_route(shops, drop):
    """shops: [{"key", "lat", "lng", "food"}] (1..MAX_STOPS, every one located); drop: (lat, lng). Returns the shortest
    route through every shop, non-food shops first, ending at the drop: {"order", "total_km", "direct_km" (first shop to
    the drop), "legs_km", "basis"}. Ties go to the shops given first."""
    if not shops or len(shops) > MAX_STOPS:
        raise ValueError(f"plan_route needs 1 to {MAX_STOPS} shops, got {len(shops)}.")
    drop = (float(drop[0]), float(drop[1]))
    if len(shops) == 1:
        leg = service.leg((float(shops[0]["lat"]), float(shops[0]["lng"])), drop)
        km = round(float(leg["distance_km"]), 2)
        return {"order": [shops[0]["key"]], "total_km": km, "direct_km": km, "legs_km": [km], "basis": leg["basis"]}
    table = service.matrix([(float(s["lat"]), float(s["lng"])) for s in shops] + [drop])
    km, h = table["km"], len(shops)
    plain = [i for i, s in enumerate(shops) if not s.get("food")]
    food = [i for i, s in enumerate(shops) if s.get("food")]
    best = None
    for head in permutations(plain):
        for tail in permutations(food):
            seq = head + tail
            total = sum(km[a][b] for a, b in zip(seq, seq[1:])) + km[seq[-1]][h]
            candidate = (round(total, 6), seq)
            if best is None or candidate < best:
                best = candidate
    seq = best[1]
    legs = [km[a][b] for a, b in zip(seq, seq[1:])] + [km[seq[-1]][h]]
    return {
        "order": [shops[i]["key"] for i in seq], "total_km": round(sum(legs), 2), "direct_km": round(km[seq[0]][h], 2),
        "legs_km": [round(x, 2) for x in legs], "basis": table["basis"],
    }
