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
HEALTH_KEY = "routing:healthy"


def _enabled():
    return bool((getattr(settings, "OSRM_URL", "") or "").strip())


def _down():
    """True while OSRM is known to be unreachable (the cached health flag is False): callers skip the network."""
    return cache.get(HEALTH_KEY) is False


def _mark_down():
    cache.set(HEALTH_KEY, False, STATUS_TTL_S)


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
    if _down():
        return _estimate(origin, dest)
    try:
        row = client.route(origin, dest)
        out = _road(row, row["geometry"] if geometry else None)
    except client.OsrmError as exc:
        if isinstance(exc, client.OsrmUnavailable):
            _mark_down()
        logger.info("OSRM could not route this leg (%s); using the straight-line estimate.", exc)
        return _estimate(origin, dest)  # not cached: OSRM may be back in seconds
    except Exception:
        logger.exception("OSRM leg failed unexpectedly; using the straight-line estimate.")
        return _estimate(origin, dest)
    cache.set(key, out, LEG_TTL_S)
    return out


def legs_from(origins, dest):
    origins = list(origins)
    if not origins:
        return []
    if not _enabled():
        return [_estimate(o, dest) for o in origins]
    if _down():
        return [_estimate(o, dest) for o in origins]
    try:
        rows = client.table(origins, dest)
        return [_road(row) if row else _estimate(o, dest) for o, row in zip(origins, rows)]
    except client.OsrmError as exc:
        if isinstance(exc, client.OsrmUnavailable):
            _mark_down()
        logger.info("OSRM table failed (%s); using straight-line estimates.", exc)
        return [_estimate(o, dest) for o in origins]
    except Exception:
        logger.exception("OSRM table failed unexpectedly; using straight-line estimates.")
        return [_estimate(o, dest) for o in origins]


def status():
    configured = _enabled()
    base = {"factor": delivery_services.ROAD_FACTOR, "configured": configured}
    if not configured:
        return {"mode": "straight_line_estimate", "healthy": False, **base}
    healthy = cache.get(HEALTH_KEY)
    if healthy is None:
        try:
            healthy = bool(client.health())
        except Exception:
            logger.exception("OSRM health check failed unexpectedly; treating OSRM as unhealthy.")
            healthy = False
        cache.set(HEALTH_KEY, healthy, STATUS_TTL_S)
    return {"mode": "road" if healthy else "straight_line_estimate", "healthy": bool(healthy), **base}
