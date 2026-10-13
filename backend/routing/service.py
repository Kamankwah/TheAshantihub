"""Road distance and time for the rest of the app. Never raises: when OSRM is off, down, slow or cannot route a
pair, the answer is the straight-line estimate and `basis` says so, so a screen can label it honestly."""
import logging

from django.conf import settings
from django.core.cache import cache

from delivery import services as delivery_services
from . import client

logger = logging.getLogger(__name__)

BASIS_ROAD = "road route"
BASIS_ESTIMATE = "straight-line estimate x 1.3"
FALLBACK_KMH = 25            # typical Kumasi urban speed, used only for the estimate's duration
LEG_TTL_S = 60               # many viewers of one leg cost one OSRM call
STATUS_TTL_S = 30


def _enabled():
    return bool((getattr(settings, "OSRM_URL", "") or "").strip())


def _key(origin, dest, geometry):
    return "routing:leg:%.5f,%.5f:%.5f,%.5f:%d" % (origin[0], origin[1], dest[0], dest[1], int(geometry))


def _estimate(origin, dest):
    km = delivery_services.distance_estimate_km(origin[0], origin[1], dest[0], dest[1])
    return {"distance_km": km, "duration_s": int(round(km / FALLBACK_KMH * 3600)), "basis": BASIS_ESTIMATE, "geometry": None}


def _road(row, geometry=None):
    return {
        "distance_km": round(row["distance_m"] / 1000, 2), "duration_s": int(round(row["duration_s"])),
        "basis": BASIS_ROAD, "geometry": geometry,
    }


def leg(origin, dest, *, geometry=False):
    if not _enabled():
        return _estimate(origin, dest)
    key = _key(origin, dest, geometry)
    cached = cache.get(key)
    if cached is not None:
        return cached
    try:
        row = client.route(origin, dest)
        out = _road(row, row["geometry"] if geometry else None)
    except Exception:
        logger.warning("OSRM leg failed; using the straight-line estimate.", exc_info=True)
        return _estimate(origin, dest)  # not cached: OSRM may be back in seconds
    cache.set(key, out, LEG_TTL_S)
    return out


def legs_from(origins, dest):
    origins = list(origins)
    if not origins:
        return []
    if not _enabled():
        return [_estimate(o, dest) for o in origins]
    try:
        rows = client.table(origins, dest)
        return [_road(row) if row else _estimate(o, dest) for o, row in zip(origins, rows)]
    except Exception:
        logger.warning("OSRM table failed; using straight-line estimates.", exc_info=True)
        return [_estimate(o, dest) for o in origins]


def status():
    if not _enabled():
        return {"mode": "straight_line_estimate", "factor": delivery_services.ROAD_FACTOR, "healthy": False}
    healthy = cache.get("routing:healthy")
    if healthy is None:
        try:
            healthy = bool(client.health())
        except Exception:
            logger.warning("OSRM health check failed; treating OSRM as unhealthy.", exc_info=True)
            healthy = False
        cache.set("routing:healthy", healthy, STATUS_TTL_S)
    return {"mode": "road" if healthy else "straight_line_estimate", "factor": delivery_services.ROAD_FACTOR, "healthy": bool(healthy)}
