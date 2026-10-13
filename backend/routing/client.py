"""The only code that talks to OSRM. Points are (lat, lng); OSRM wants lng,lat, converted here and nowhere else.
Every failure (unconfigured, network, timeout, NoRoute) is an OsrmError so callers have one thing to catch."""
import json
import urllib.error
import urllib.request

from django.conf import settings


class OsrmError(Exception):
    pass


class OsrmUnavailable(OsrmError):
    """OSRM could not be reached (network, timeout, connection refused, 5xx). Not raised for NoRoute or a malformed
    answer: those mean OSRM is up. The service uses this one to stop calling a down server for a while."""


def _http_get_json(url, timeout):
    with urllib.request.urlopen(url, timeout=timeout) as response:  # noqa: S310 - the URL is our own OSRM_URL setting
        return json.loads(response.read().decode("utf-8"))


def _base():
    base = (getattr(settings, "OSRM_URL", "") or "").rstrip("/")
    if not base:
        raise OsrmError("OSRM is not configured.")
    return base


def _coord(point):
    lat, lng = point
    return f"{lng:g},{lat:g}"


def _get(path):
    url = f"{_base()}{path}"
    try:
        body = _http_get_json(url, float(getattr(settings, "OSRM_TIMEOUT_S", 2.0)))
    except urllib.error.HTTPError as exc:
        # OSRM answers NoRoute / InvalidQuery with a 4xx and a JSON body: it is up, so this is a plain OsrmError.
        if exc.code >= 500:
            raise OsrmUnavailable(str(exc)) from exc
        raise OsrmError(str(exc)) from exc
    except (OSError, TimeoutError) as exc:  # URLError, socket timeout, refused or reset connection
        raise OsrmUnavailable(str(exc)) from exc
    except Exception as exc:  # bad JSON and anything else: one error type for callers
        raise OsrmError(str(exc)) from exc
    if not isinstance(body, dict):
        raise OsrmError("Malformed OSRM response.")
    if body.get("code") != "Ok":
        raise OsrmError(str(body.get("message") or body.get("code") or "OSRM error"))
    return body


def route(origin, dest):
    body = _get(f"/route/v1/driving/{_coord(origin)};{_coord(dest)}?overview=full&geometries=geojson")
    routes = body.get("routes") or []
    if not routes:
        raise OsrmError("No route.")
    first = routes[0]
    try:
        return {
            "distance_m": float(first["distance"]),
            "duration_s": float(first["duration"]),
            "geometry": (first.get("geometry") or {}).get("coordinates", []),
        }
    except (KeyError, TypeError, ValueError, AttributeError) as exc:
        raise OsrmError("Malformed OSRM response.") from exc


def table(origins, dest):
    """One result per origin ({"distance_m", "duration_s"} or None when that origin cannot reach dest)."""
    origins = list(origins)
    if not origins:
        return []
    coords = ";".join([_coord(o) for o in origins] + [_coord(dest)])
    sources = ";".join(str(i) for i in range(len(origins)))
    body = _get(f"/table/v1/driving/{coords}?sources={sources}&destinations={len(origins)}&annotations=duration,distance")
    durations, distances = body.get("durations") or [], body.get("distances") or []
    if not isinstance(durations, list) or not isinstance(distances, list):
        raise OsrmError("Malformed OSRM response.")
    out = []
    for i in range(len(origins)):
        try:
            d, m = durations[i][0], distances[i][0]
        except (IndexError, TypeError):
            d = m = None
        out.append(None if d is None or m is None else {"distance_m": float(m), "duration_s": float(d)})
    return out


def health():
    try:
        _get("/nearest/v1/driving/-1.6244,6.6885")
        return True
    except OsrmError:
        return False
