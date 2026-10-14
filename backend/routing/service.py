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


TABLE_MAX_ORIGINS = 100     # origins sent to OSRM in one legs_between call (URL length, the server's table limit)


def legs_between(origins, dests):
    """rows[i][j] = the leg from origins[i] to dests[j] ({"distance_km", "duration_s", "basis", "geometry": None}), all
    from ONE OSRM table call. Never raises: OSRM off, down or refusing gives the labelled estimate, and a pair OSRM cannot
    route is estimated on its own (each cell carries its basis). Only the first TABLE_MAX_ORIGINS origins go to OSRM;
    the rest are estimated, so callers pass the ones that matter most first."""
    origins = [(float(o[0]), float(o[1])) for o in origins]
    dests = [(float(d[0]), float(d[1])) for d in dests]

    def estimated(rows):
        return [[_estimate(o, d) for d in dests] for o in rows]

    if not origins or not dests:
        return [[] for _ in origins]
    if not _enabled() or _down():
        return estimated(origins)
    routed, rest = origins[:TABLE_MAX_ORIGINS], origins[TABLE_MAX_ORIGINS:]
    try:
        rows = client.table_between(routed, dests)
    except client.OsrmError as exc:
        if isinstance(exc, client.OsrmUnavailable):
            _mark_down()
        logger.info("OSRM table failed (%s); using straight-line estimates.", exc)
        return estimated(origins)
    except Exception:
        logger.exception("OSRM table failed unexpectedly; using straight-line estimates.")
        return estimated(origins)
    out = []
    for i, o in enumerate(routed):
        row = rows[i] if i < len(rows) else []
        out.append([_road(row[j]) if j < len(row) and row[j] else _estimate(o, d) for j, d in enumerate(dests)])
    return out + estimated(rest)


def matrix(points):
    """Road km between every pair of points (km[i][j] from i to j, 0 on the diagonal) and one basis for the whole table.
    Never raises: OSRM off or down gives the straight-line estimate; a pair OSRM cannot route is estimated, and then the
    whole table is labelled an estimate, so a plan built on it never claims road distances."""
    points = [(float(p[0]), float(p[1])) for p in points]

    def estimated():
        return {"km": [[0.0 if i == j else _estimate(a, b)["distance_km"] for j, b in enumerate(points)] for i, a in enumerate(points)],
                "basis": BASIS_ESTIMATE}

    if len(points) < 2 or not _enabled() or _down():
        return estimated()
    try:
        rows = client.matrix(points)
    except client.OsrmError as exc:
        if isinstance(exc, client.OsrmUnavailable):
            _mark_down()
        logger.info("OSRM table failed (%s); using straight-line estimates.", exc)
        return estimated()
    except Exception:
        logger.exception("OSRM table failed unexpectedly; using straight-line estimates.")
        return estimated()
    basis, km = BASIS_ROAD, []
    for i, a in enumerate(points):
        row = []
        for j, b in enumerate(points):
            cell = rows[i][j] if i < len(rows) and j < len(rows[i]) else None
            if i == j:
                row.append(0.0)
            elif cell is None:
                row.append(_estimate(a, b)["distance_km"])
                basis = BASIS_ESTIMATE
            else:
                row.append(round(cell["distance_m"] / 1000, 2))
        km.append(row)
    return {"km": km, "basis": basis}


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
