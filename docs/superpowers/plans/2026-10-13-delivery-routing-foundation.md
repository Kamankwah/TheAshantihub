# Delivery Routing Foundation (Stage 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Real road distances and arrival times (self-hosted OSRM, Ashanti Region) behind one `routing` module, used by the delivery fee, rider pay, manager screens and checkout, with a labelled straight-line fallback and a service-area check.

**Architecture:** A new Django package `backend/routing/` is the only code that talks to OSRM over HTTP. `routing.service` returns a uniform leg result (`distance_km`, `duration_s`, `basis`, optional `geometry`) and falls back to the existing straight-line x 1.3 estimate whenever OSRM is unconfigured, down, slow or cannot route. `delivery.rates`, `delivery.board`, `delivery.views_queue` and checkout call `routing.service` instead of `services.distance_estimate_km`. OSRM runs as one more container in the compose stack, built from the Geofabrik Ghana extract clipped to the Ashanti Region by a host script.

**Tech Stack:** Django 5 / DRF, `urllib` (no new Python dependency), Django cache, OSRM `osrm-backend` image with `osmium-tool` for clipping, Docker Compose, React (inline `C` palette), Vitest.

**Spec:** `docs/superpowers/specs/2026-10-13-delivery-routing-dispatch-design.md` (section 1 and the stage-1 rollout item). Stages 2 (dispatch engine), 3 (rider app and Web Push) and 4 (customer/business tracking, heatmap, Leaflet Draw) get their own plans after stage 1 is verified on staging.

## Global Constraints

- Backend commands run through compose, service `web`: `docker compose run --rm web python manage.py <cmd>`. Run tests serially (no `--parallel`).
- Frontend: run Vitest from `frontend/` (`npx vitest run <file>`); inline `style={{}}` off the `C` palette; no `useMutation`; no new colours.
- No fabricated data in the UI: an estimate is always labelled "estimate"; a road figure is labelled "road route".
- OSRM wants coordinates as **longitude,latitude**; this codebase stores `lat`, `lng`. Only `routing/client.py` converts.
- `ROAD_FACTOR = 1.3` and the straight-line fallback stay as the labelled fallback (`delivery.services.distance_estimate_km`).
- Never call a real OSRM or any network service from a test; tests patch `routing.client._http_get_json`.
- Commit trailer on every commit: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Do not push, merge or deploy; do not flip environment flags (`DELIVERY_FEE_ENABLED`, `MARKETING_PROMOS_ENABLED`).
- Service area is the Ashanti Region (v1: an approximate bounding polygon, see Task 3 and the spec's open items).

## Review Focus

- OSRM answers `NoRoute` / `NoSegment` for a point it cannot snap (a field, a river): the caller must get the labelled estimate, never an exception or a zero distance. (Task 2)
- OSRM is slow or hangs: the call is cut off at `OSRM_TIMEOUT_S` and falls back; a checkout never waits longer than that. (Task 1, Task 2)
- Latitude and longitude swapped by a caller (a point at lat 1.0, lng 6.0 is in the Gulf of Guinea, not Kumasi): the region check refuses it rather than routing it. (Task 3)
- A delivery point with no coordinates (free-text address) must not be refused by the area check; today's behaviour (no fee until a point is chosen) stays. (Task 5)
- `table()` with zero origins or one unroutable origin returns per-origin results with `None` for the unroutable one, not a crash or a shifted list. (Task 2)

---

## File Structure

| File | Responsibility |
|---|---|
| `backend/routing/__init__.py`, `apps.py` | Package and AppConfig |
| `backend/routing/client.py` | The only HTTP code: `route()`, `table()`, `health()`; raises `OsrmError` |
| `backend/routing/service.py` | Fallback, labelling, caching: `leg()`, `legs_from()`, `status()` |
| `backend/routing/region.py` | Service-area polygon and `in_service_area(lat, lng)` |
| `backend/routing/tests/` | `test_client.py`, `test_service.py`, `test_region.py` |
| `backend/delivery/rates.py` | Modified: `route_km` / `checkout_fee` use `routing.service.leg`; basis carried through |
| `backend/delivery/board.py`, `views_queue.py` | Modified: report routing mode from `routing.service.status()` |
| `backend/orders/views.py`, `backend/marketing/views_promos.py` | Modified: refuse / report out-of-area delivery points |
| `infra/compose/docker-compose.yml`, `infra/scripts/build-osrm-data.sh`, `infra/cron/ashantihub.cron`, `backend/.env.example`, `infra/README.md` | OSRM container, data build, monthly refresh, env docs |
| `frontend/components/admin/panels/delivery/{RulesPanels,DispatchQueuePanel}.jsx` | Modified: text follows the real routing mode |

---

### Task 1: OSRM client

**Files:**
- Create: `backend/routing/__init__.py`, `backend/routing/apps.py`, `backend/routing/client.py`, `backend/routing/tests/__init__.py`, `backend/routing/tests/test_client.py`
- Modify: `backend/ashantihub/settings.py` (INSTALLED_APPS, new settings next to the other integration settings near line 316)

**Interfaces:**
- Produces: `routing.client.OsrmError(Exception)`; `route(origin, dest) -> dict` with `distance_m: float`, `duration_s: float`, `geometry: list[[lng, lat]]`; `table(origins, dest) -> list[dict|None]` one per origin, each `{"distance_m": float, "duration_s": float}`; `health() -> bool`; `_http_get_json(url, timeout) -> dict` (the single patchable network seam). Points are `(lat, lng)` tuples. `settings.OSRM_URL` (str, blank = routing off), `settings.OSRM_TIMEOUT_S` (float, default 2.0).

- [ ] **Step 1: Write the failing tests**

```python
# backend/routing/tests/test_client.py
from unittest import mock

from django.test import SimpleTestCase, override_settings

from routing import client


@override_settings(OSRM_URL="http://osrm:5000", OSRM_TIMEOUT_S=2.0)
class RouteTests(SimpleTestCase):
    def test_route_converts_lat_lng_to_lng_lat_and_parses(self):
        body = {"code": "Ok", "routes": [{"distance": 5321.4, "duration": 612.0, "geometry": {"coordinates": [[-1.62, 6.69], [-1.60, 6.70]]}}]}
        with mock.patch("routing.client._http_get_json", return_value=body) as get:
            out = client.route((6.69, -1.62), (6.70, -1.60))
        url = get.call_args[0][0]
        self.assertIn("/route/v1/driving/-1.62,6.69;-1.6,6.7", url)
        self.assertIn("overview=full", url)
        self.assertEqual(out["distance_m"], 5321.4)
        self.assertEqual(out["duration_s"], 612.0)
        self.assertEqual(out["geometry"], [[-1.62, 6.69], [-1.60, 6.70]])

    def test_no_route_raises(self):
        with mock.patch("routing.client._http_get_json", return_value={"code": "NoRoute", "message": "x"}):
            with self.assertRaises(client.OsrmError):
                client.route((6.69, -1.62), (6.70, -1.60))

    def test_network_failure_raises_osrm_error(self):
        with mock.patch("routing.client._http_get_json", side_effect=OSError("boom")):
            with self.assertRaises(client.OsrmError):
                client.route((6.69, -1.62), (6.70, -1.60))

    @override_settings(OSRM_URL="")
    def test_blank_url_raises_without_calling_network(self):
        with mock.patch("routing.client._http_get_json") as get:
            with self.assertRaises(client.OsrmError):
                client.route((6.69, -1.62), (6.70, -1.60))
        get.assert_not_called()


@override_settings(OSRM_URL="http://osrm:5000", OSRM_TIMEOUT_S=2.0)
class TableTests(SimpleTestCase):
    def test_table_returns_one_result_per_origin_and_none_for_unroutable(self):
        body = {"code": "Ok", "durations": [[300.0], [None], [90.0]], "distances": [[2500.0], [None], [700.0]]}
        origins = [(6.69, -1.62), (6.70, -1.61), (6.71, -1.60)]
        with mock.patch("routing.client._http_get_json", return_value=body) as get:
            out = client.table(origins, (6.72, -1.59))
        url = get.call_args[0][0]
        self.assertIn("/table/v1/driving/-1.62,6.69;-1.61,6.7;-1.6,6.71;-1.59,6.72", url)
        self.assertIn("sources=0;1;2", url)
        self.assertIn("destinations=3", url)
        self.assertEqual(out, [{"distance_m": 2500.0, "duration_s": 300.0}, None, {"distance_m": 700.0, "duration_s": 90.0}])

    def test_table_with_no_origins_makes_no_call(self):
        with mock.patch("routing.client._http_get_json") as get:
            self.assertEqual(client.table([], (6.72, -1.59)), [])
        get.assert_not_called()


@override_settings(OSRM_URL="http://osrm:5000")
class HealthTests(SimpleTestCase):
    def test_health_true_when_nearest_answers_ok(self):
        with mock.patch("routing.client._http_get_json", return_value={"code": "Ok"}):
            self.assertTrue(client.health())

    def test_health_false_on_error(self):
        with mock.patch("routing.client._http_get_json", side_effect=OSError("down")):
            self.assertFalse(client.health())

    @override_settings(OSRM_URL="")
    def test_health_false_when_unconfigured(self):
        self.assertFalse(client.health())
```

- [ ] **Step 2: Run to verify failure**

Run: `docker compose run --rm web python manage.py test routing.tests.test_client -v 2`
Expected: ImportError / `No module named routing`.

- [ ] **Step 3: Write the implementation**

```python
# backend/routing/__init__.py
```

```python
# backend/routing/apps.py
from django.apps import AppConfig


class RoutingConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "routing"
```

```python
# backend/routing/client.py
"""The only code that talks to OSRM. Points are (lat, lng); OSRM wants lng,lat, converted here and nowhere else.
Every failure (unconfigured, network, timeout, NoRoute) is an OsrmError so callers have one thing to catch."""
import json
import urllib.request

from django.conf import settings


class OsrmError(Exception):
    pass


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
    except Exception as exc:  # network, timeout, bad JSON: one error type for callers
        raise OsrmError(str(exc)) from exc
    if not isinstance(body, dict) or body.get("code") != "Ok":
        raise OsrmError(str((body or {}).get("message") or (body or {}).get("code") or "OSRM error"))
    return body


def route(origin, dest):
    body = _get(f"/route/v1/driving/{_coord(origin)};{_coord(dest)}?overview=full&geometries=geojson")
    routes = body.get("routes") or []
    if not routes:
        raise OsrmError("No route.")
    first = routes[0]
    return {
        "distance_m": float(first["distance"]),
        "duration_s": float(first["duration"]),
        "geometry": (first.get("geometry") or {}).get("coordinates", []),
    }


def table(origins, dest):
    """One result per origin ({"distance_m", "duration_s"} or None when that origin cannot reach dest)."""
    origins = list(origins)
    if not origins:
        return []
    coords = ";".join([_coord(o) for o in origins] + [_coord(dest)])
    sources = ";".join(str(i) for i in range(len(origins)))
    body = _get(f"/table/v1/driving/{coords}?sources={sources}&destinations={len(origins)}&annotations=duration,distance")
    durations, distances = body.get("durations") or [], body.get("distances") or []
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
```

Modify `backend/ashantihub/settings.py`: add `"routing",` to `INSTALLED_APPS` (after `"delivery"`), and next to the Hubtel block add:

```python
# Road routing (docs/superpowers/specs/2026-10-13-delivery-routing-dispatch-design.md). Blank OSRM_URL means
# routing is off and every distance is the labelled straight-line estimate.
OSRM_URL = env("OSRM_URL", default="")
OSRM_TIMEOUT_S = env.float("OSRM_TIMEOUT_S", default=2.0)
```

- [ ] **Step 4: Run to verify pass**

Run: `docker compose run --rm web python manage.py test routing.tests.test_client -v 2`
Expected: 9 tests OK.

- [ ] **Step 5: Commit**

```bash
git add backend/routing backend/ashantihub/settings.py
git commit -m "feat(routing): OSRM client behind one patchable network seam"
```

---

### Task 2: Routing service (fallback, labelling, cache)

**Files:**
- Create: `backend/routing/service.py`, `backend/routing/tests/test_service.py`

**Interfaces:**
- Consumes: `routing.client.route/table/health/OsrmError`; `delivery.services.distance_estimate_km`, `delivery.services.ROAD_FACTOR`, `field.services.haversine_m`.
- Produces: constants `BASIS_ROAD = "road route"`, `BASIS_ESTIMATE = "straight-line estimate x 1.3"`; `leg(origin, dest, *, geometry=False) -> dict` `{"distance_km": float, "duration_s": int, "basis": str, "geometry": list|None}`; `legs_from(origins, dest) -> list[dict]` same shape per origin (never `None`; unroutable origins get the estimate); `status() -> dict` `{"mode": "road"|"straight_line_estimate", "factor": float, "healthy": bool}`; `FALLBACK_KMH = 25`.

- [ ] **Step 1: Write the failing tests**

```python
# backend/routing/tests/test_service.py
from unittest import mock

from django.core.cache import cache
from django.test import SimpleTestCase, override_settings

from routing import client, service

KUMASI = (6.6885, -1.6244)
NEARBY = (6.7000, -1.6000)


class LegTests(SimpleTestCase):
    def setUp(self):
        cache.clear()

    @override_settings(OSRM_URL="http://osrm:5000")
    def test_road_result_is_labelled_road(self):
        with mock.patch("routing.client.route", return_value={"distance_m": 5400.0, "duration_s": 700.0, "geometry": [[-1.62, 6.68]]}):
            out = service.leg(KUMASI, NEARBY, geometry=True)
        self.assertEqual(out["basis"], service.BASIS_ROAD)
        self.assertEqual(out["distance_km"], 5.4)
        self.assertEqual(out["duration_s"], 700)
        self.assertEqual(out["geometry"], [[-1.62, 6.68]])

    @override_settings(OSRM_URL="http://osrm:5000")
    def test_geometry_omitted_unless_asked(self):
        with mock.patch("routing.client.route", return_value={"distance_m": 5400.0, "duration_s": 700.0, "geometry": [[1, 2]]}):
            self.assertIsNone(service.leg(KUMASI, NEARBY)["geometry"])

    @override_settings(OSRM_URL="http://osrm:5000")
    def test_no_route_falls_back_to_labelled_estimate(self):
        with mock.patch("routing.client.route", side_effect=client.OsrmError("NoRoute")):
            out = service.leg(KUMASI, NEARBY)
        self.assertEqual(out["basis"], service.BASIS_ESTIMATE)
        self.assertGreater(out["distance_km"], 0)
        self.assertGreater(out["duration_s"], 0)
        self.assertIsNone(out["geometry"])

    @override_settings(OSRM_URL="")
    def test_unconfigured_never_touches_the_client(self):
        with mock.patch("routing.client.route") as route:
            out = service.leg(KUMASI, NEARBY)
        route.assert_not_called()
        self.assertEqual(out["basis"], service.BASIS_ESTIMATE)

    @override_settings(OSRM_URL="http://osrm:5000")
    def test_repeat_call_is_served_from_cache(self):
        with mock.patch("routing.client.route", return_value={"distance_m": 1000.0, "duration_s": 100.0, "geometry": []}) as route:
            service.leg(KUMASI, NEARBY)
            service.leg(KUMASI, NEARBY)
        self.assertEqual(route.call_count, 1)

    @override_settings(OSRM_URL="http://osrm:5000")
    def test_estimate_duration_uses_fallback_speed(self):
        with mock.patch("routing.client.route", side_effect=client.OsrmError("down")):
            out = service.leg(KUMASI, NEARBY)
        self.assertAlmostEqual(out["duration_s"], out["distance_km"] / service.FALLBACK_KMH * 3600, delta=1)


class LegsFromTests(SimpleTestCase):
    def setUp(self):
        cache.clear()

    @override_settings(OSRM_URL="http://osrm:5000")
    def test_unroutable_origin_gets_estimate_and_order_is_kept(self):
        rows = [{"distance_m": 2500.0, "duration_s": 300.0}, None]
        with mock.patch("routing.client.table", return_value=rows):
            out = service.legs_from([KUMASI, (6.71, -1.61)], NEARBY)
        self.assertEqual([o["basis"] for o in out], [service.BASIS_ROAD, service.BASIS_ESTIMATE])
        self.assertEqual(out[0]["distance_km"], 2.5)

    @override_settings(OSRM_URL="http://osrm:5000")
    def test_table_failure_makes_every_origin_an_estimate(self):
        with mock.patch("routing.client.table", side_effect=client.OsrmError("down")):
            out = service.legs_from([KUMASI, (6.71, -1.61)], NEARBY)
        self.assertEqual({o["basis"] for o in out}, {service.BASIS_ESTIMATE})
        self.assertEqual(len(out), 2)

    def test_no_origins(self):
        self.assertEqual(service.legs_from([], NEARBY), [])


class StatusTests(SimpleTestCase):
    @override_settings(OSRM_URL="")
    def test_off(self):
        self.assertEqual(service.status()["mode"], "straight_line_estimate")

    @override_settings(OSRM_URL="http://osrm:5000")
    def test_road_when_healthy_estimate_when_not(self):
        cache.clear()
        with mock.patch("routing.client.health", return_value=True):
            self.assertEqual(service.status()["mode"], "road")
        cache.clear()
        with mock.patch("routing.client.health", return_value=False):
            s = service.status()
        self.assertEqual(s["mode"], "straight_line_estimate")
        self.assertFalse(s["healthy"])
```

- [ ] **Step 2: Run to verify failure**

Run: `docker compose run --rm web python manage.py test routing.tests.test_service -v 2`
Expected: ImportError on `routing.service`.

- [ ] **Step 3: Write the implementation**

```python
# backend/routing/service.py
"""Road distance and time for the rest of the app. Never raises: when OSRM is off, down, slow or cannot route a
pair, the answer is the straight-line estimate and `basis` says so, so a screen can label it honestly."""
from django.conf import settings
from django.core.cache import cache

from delivery import services as delivery_services
from . import client

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
    except client.OsrmError:
        return _estimate(origin, dest)  # not cached: OSRM may be back in seconds
    out = _road(row, row["geometry"] if geometry else None)
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
    except client.OsrmError:
        return [_estimate(o, dest) for o in origins]
    return [_road(row) if row else _estimate(o, dest) for o, row in zip(origins, rows)]


def status():
    if not _enabled():
        return {"mode": "straight_line_estimate", "factor": delivery_services.ROAD_FACTOR, "healthy": False}
    healthy = cache.get("routing:healthy")
    if healthy is None:
        healthy = client.health()
        cache.set("routing:healthy", healthy, STATUS_TTL_S)
    return {"mode": "road" if healthy else "straight_line_estimate", "factor": delivery_services.ROAD_FACTOR, "healthy": bool(healthy)}
```

- [ ] **Step 4: Run to verify pass**

Run: `docker compose run --rm web python manage.py test routing -v 2`
Expected: all routing tests OK (client + service).

- [ ] **Step 5: Commit**

```bash
git add backend/routing/service.py backend/routing/tests/test_service.py
git commit -m "feat(routing): leg/table service with labelled fallback and caching"
```

---

### Task 3: Service-area check

**Files:**
- Create: `backend/routing/region.py`, `backend/routing/tests/test_region.py`

**Interfaces:**
- Consumes: `delivery.services.point_in_ring(lat, lng, ring)` (ring is `[[lng, lat], ...]`), `delivery.services.valid_point`.
- Produces: `ASHANTI_RING: list[[lng, lat]]`; `in_service_area(lat, lng) -> bool` (False for invalid points); `OUT_OF_AREA_MESSAGE: str`.

- [ ] **Step 1: Write the failing tests**

```python
# backend/routing/tests/test_region.py
from django.test import SimpleTestCase

from routing import region


class ServiceAreaTests(SimpleTestCase):
    def test_kumasi_is_inside(self):
        self.assertTrue(region.in_service_area(6.6885, -1.6244))

    def test_obuasi_and_konongo_are_inside(self):
        self.assertTrue(region.in_service_area(6.2000, -1.6667))
        self.assertTrue(region.in_service_area(6.6167, -1.2167))

    def test_accra_and_tamale_are_outside(self):
        self.assertFalse(region.in_service_area(5.6037, -0.1870))
        self.assertFalse(region.in_service_area(9.4034, -0.8424))

    def test_swapped_coordinates_are_outside(self):
        self.assertFalse(region.in_service_area(-1.6244, 6.6885))

    def test_invalid_and_null_island_are_outside(self):
        self.assertFalse(region.in_service_area(None, None))
        self.assertFalse(region.in_service_area(0, 0))
        self.assertFalse(region.in_service_area("abc", 1))
```

- [ ] **Step 2: Run to verify failure**

Run: `docker compose run --rm web python manage.py test routing.tests.test_region -v 2`
Expected: ImportError on `routing.region`.

- [ ] **Step 3: Write the implementation**

```python
# backend/routing/region.py
"""Where we deliver: the whole Ashanti Region. v1 uses an approximate bounding polygon (it also admits a thin strip
of neighbouring districts); replace ASHANTI_RING with the OpenStreetMap administrative boundary when available
(spec open item). Ring points are [lng, lat], the format delivery.services.point_in_ring reads."""
from delivery import services

ASHANTI_RING = [[-2.80, 5.80], [-0.60, 5.80], [-0.60, 7.50], [-2.80, 7.50]]
OUT_OF_AREA_MESSAGE = "We only deliver within the Ashanti Region for now."


def in_service_area(lat, lng):
    point = services.valid_point(lat, lng)
    if point is None:
        return False
    return services.point_in_ring(point[0], point[1], ASHANTI_RING)
```

- [ ] **Step 4: Run to verify pass**

Run: `docker compose run --rm web python manage.py test routing.tests.test_region -v 2`
Expected: 5 tests OK.

- [ ] **Step 5: Commit**

```bash
git add backend/routing/region.py backend/routing/tests/test_region.py
git commit -m "feat(routing): Ashanti Region service-area check"
```

---

### Task 4: Fee and rider pay use road distance

**Files:**
- Modify: `backend/delivery/rates.py` (lines 10, 21-42, 44-52, 55-60, 83-92), `backend/delivery/views_rules.py:95`
- Test: `backend/delivery/tests/test_routing_rates.py` (create)

**Interfaces:**
- Consumes: `routing.service.leg(origin, dest) -> {"distance_km", "duration_s", "basis", "geometry"}`.
- Produces: `rates.customer_fee(card, km, *, basis=BASIS, ...)` and `rates.rider_pay(card, km, *, basis=BASIS, ...)` put `basis` into `distance_basis`; `rates.route_km(order)` returns `(km, basis)` or `(None, None)`; `checkout_fee` stores the basis in the fee breakdown. Existing callers keep working because `basis` defaults to the estimate label.

- [ ] **Step 1: Write the failing test**

```python
# backend/delivery/tests/test_routing_rates.py
from decimal import Decimal
from unittest import mock

from django.test import SimpleTestCase

from delivery import rates
from routing import service as routing_service


class Card:
    customer_base, customer_per_km, customer_min_fee = "5.00", "1.50", "6.00"
    extra_pickup, express_multiplier, round_up_to = "0", "1", "0.50"
    vehicle_multipliers = {}
    rider_per_job, rider_per_km, wait_after_min, wait_per_min = "3.00", "0.80", 10, "0.20"


class BasisTests(SimpleTestCase):
    def test_fee_carries_the_basis_it_was_given(self):
        out = rates.customer_fee(Card, 4.2, basis=routing_service.BASIS_ROAD)
        self.assertEqual(out["distance_basis"], "road route")

    def test_fee_defaults_to_the_estimate_label(self):
        self.assertEqual(rates.customer_fee(Card, 4.2)["distance_basis"], rates.BASIS)

    def test_rider_pay_carries_the_basis(self):
        out = rates.rider_pay(Card, 4.2, basis="road route")
        self.assertEqual(out["distance_basis"], "road route")
        self.assertEqual(Decimal(out["total"]), Decimal("6.36"))

    def test_route_km_returns_km_and_basis_from_routing(self):
        order = mock.Mock()
        with mock.patch("delivery.rates.services.pickup_stop", return_value=(6.69, -1.62, "Shop")), \
             mock.patch("delivery.rates.services.drop_stop", return_value=(6.70, -1.60)), \
             mock.patch("delivery.rates.routing_service.leg", return_value={"distance_km": 5.4, "basis": "road route"}):
            self.assertEqual(rates.route_km(order), (5.4, "road route"))

    def test_route_km_none_when_a_point_is_missing(self):
        with mock.patch("delivery.rates.services.pickup_stop", return_value=(None, None, "Shop")), \
             mock.patch("delivery.rates.services.drop_stop", return_value=(6.70, -1.60)):
            self.assertEqual(rates.route_km(mock.Mock()), (None, None))
```

- [ ] **Step 2: Run to verify failure**

Run: `docker compose run --rm web python manage.py test delivery.tests.test_routing_rates -v 2`
Expected: FAIL (`customer_fee() got an unexpected keyword argument 'basis'`).

- [ ] **Step 3: Implement**

In `backend/delivery/rates.py`:

1. Add the import `from routing import service as routing_service` beside `from . import config, services`.
2. Change signatures and the returned `distance_basis`:

```python
def customer_fee(card, km, *, vehicle="motorbike", express=False, extra_pickups=0, basis=BASIS):
    ...  # body unchanged except the final return: "distance_basis": basis

def rider_pay(card, km, *, wait_minutes=0, hold_wait=False, basis=BASIS):
    ...  # body unchanged except the final return: "distance_basis": basis
```

3. Replace `route_km` and update its two callers:

```python
def route_km(order):
    """(km, basis) for pickup to drop, or (None, None) when either point is unknown."""
    plat, plng, _ = services.pickup_stop(order)
    dlat, dlng = services.drop_stop(order)
    if plat is None or dlat is None:
        return None, None
    leg = routing_service.leg((plat, plng), (dlat, dlng))
    return leg["distance_km"], leg["basis"]
```

In `snapshot_rider_pay`: `km, basis = route_km(assignment.order)`; `if card is None or km is None: return`; pass `basis=basis` to `rider_pay`.

4. In `checkout_fee` replace the `km = services.distance_estimate_km(...)` and `fee = customer_fee(card, km, express=express)` lines with:

```python
    leg = routing_service.leg(pickup, drop)
    fee = customer_fee(card, leg["distance_km"], express=express, basis=leg["basis"])
```

5. In `backend/delivery/views_rules.py` line 95 find where `route_km` result is used (grep `route_km` in that file; if it uses the single return value, unpack `(km, basis)` and pass `basis` into `customer_fee`/`rider_pay`, and set `"distance_basis": basis`). Keep `rates.BASIS` as the default only.

- [ ] **Step 4: Run to verify pass**

Run: `docker compose run --rm web python manage.py test delivery.tests.test_routing_rates delivery orders -v 1`
Expected: new tests OK; existing delivery and orders suites still pass (fix any test that unpacked the old single-value `route_km`).

- [ ] **Step 5: Commit**

```bash
git add backend/delivery backend/routing
git commit -m "feat(delivery): fee and rider pay use road distance with a labelled fallback"
```

---

### Task 5: Out-of-area delivery points are refused

**Files:**
- Modify: `backend/orders/views.py` (insert after the address/phone check, before `with db_transaction.atomic():`, around line 78), `backend/marketing/views_promos.py` (`_delivery_quote`, around line 427-437)
- Test: `backend/orders/tests/test_service_area.py` (create)

**Interfaces:**
- Consumes: `routing.region.in_service_area`, `routing.region.OUT_OF_AREA_MESSAGE`.
- Produces: checkout answers `400 {"detail": OUT_OF_AREA_MESSAGE, "code": "out_of_area"}` for a door-to-door order whose supplied coordinates are outside the area; the cart quote's `delivery` block gets `fee_status: "out_of_area"` and `fee: null`. A door-to-door order with **no** coordinates is unchanged.

- [ ] **Step 1: Write the failing test**

Model it on the existing checkout tests in `backend/orders/tests/` (copy their customer, listing and cart fixtures; grep `OrderCheckoutView` or `orders/checkout` in that folder to find the helper):

```python
# backend/orders/tests/test_service_area.py
# Use the same setUp helpers as the nearest existing checkout test (customer login, a cart with one listing).
class ServiceAreaCheckoutTests(CheckoutTestBase):  # replace with the real base class found in that folder
    def _post(self, **extra):
        body = {"delivery_method": "door_to_door", "delivery_address": "12 Test St", "delivery_phone": "0240000000", **extra}
        return self.client.post("/api/orders/checkout/", body, format="json")

    def test_point_outside_ashanti_is_refused(self):
        resp = self._post(delivery_lat=5.6037, delivery_lng=-0.1870)  # Accra
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.data["code"], "out_of_area")
        self.assertEqual(Order.objects.count(), 0)

    def test_point_inside_ashanti_checks_out(self):
        resp = self._post(delivery_lat=6.6885, delivery_lng=-1.6244)
        self.assertIn(resp.status_code, (200, 201))

    def test_free_text_address_without_coordinates_is_not_refused(self):
        resp = self._post()
        self.assertIn(resp.status_code, (200, 201))

    def test_store_pickup_ignores_coordinates(self):
        resp = self.client.post("/api/orders/checkout/", {"delivery_method": "store_pickup", "delivery_lat": 5.6, "delivery_lng": -0.18}, format="json")
        self.assertIn(resp.status_code, (200, 201))
```

- [ ] **Step 2: Run to verify failure**

Run: `docker compose run --rm web python manage.py test orders.tests.test_service_area -v 2`
Expected: `test_point_outside_ashanti_is_refused` FAILS (order is created).

- [ ] **Step 3: Implement**

In `backend/orders/views.py`, after the address/phone check and before `with db_transaction.atomic():`:

```python
        if delivery_method == Order.DOOR_TO_DOOR:
            from routing import region

            lat, lng = request.data.get("delivery_lat"), request.data.get("delivery_lng")
            if lat not in (None, "") and lng not in (None, "") and not region.in_service_area(lat, lng):
                return Response({"detail": region.OUT_OF_AREA_MESSAGE, "code": "out_of_area"}, status=status.HTTP_400_BAD_REQUEST)
```

In `backend/marketing/views_promos.py` `_delivery_quote`, after the early `return None` guard and before the waiver lookup:

```python
    from routing import region

    lat, lng = request.data.get("delivery_lat"), request.data.get("delivery_lng")
    if lat not in (None, "") and lng not in (None, "") and not region.in_service_area(lat, lng):
        return {"fee": None, "fee_status": "out_of_area", "waived": False, "waiver_name": None, "waived_fee": None, "mixed_note": None, "message": region.OUT_OF_AREA_MESSAGE}
```

- [ ] **Step 4: Run to verify pass**

Run: `docker compose run --rm web python manage.py test orders marketing -v 1`
Expected: new tests OK; existing orders and marketing suites pass.

- [ ] **Step 5: Commit**

```bash
git add backend/orders backend/marketing
git commit -m "feat(orders): refuse door-to-door delivery points outside the Ashanti Region"
```

---

### Task 6: Manager screens report the real routing mode

**Files:**
- Modify: `backend/delivery/board.py:181`, `backend/delivery/views_queue.py:59,149-159`, `backend/delivery/dispatching.py:90` (leave the engine's ranking for stage 2; only labels change here)
- Test: `backend/delivery/tests/test_routing_status.py` (create)

**Interfaces:**
- Consumes: `routing.service.status() -> {"mode", "factor", "healthy"}`, `routing.service.leg`.
- Produces: the `routing` block in the board and queue payloads is `{"mode": "road"|"straight_line_estimate", "factor": float, "healthy": bool, "note": str}`; queue `to_pickup_km`/`trip_km` come from `routing.service.leg` and `distance_basis` is the leg's basis.

- [ ] **Step 1: Write the failing test**

```python
# backend/delivery/tests/test_routing_status.py
from unittest import mock

from django.test import SimpleTestCase

from delivery import board


class RoutingBlockTests(SimpleTestCase):
    def test_board_routing_block_reflects_status(self):
        with mock.patch("delivery.board.routing_service.status", return_value={"mode": "road", "factor": 1.3, "healthy": True}):
            block = board.routing_block()
        self.assertEqual(block["mode"], "road")
        self.assertIn("road", block["note"].lower())

    def test_estimate_mode_note_says_estimate(self):
        with mock.patch("delivery.board.routing_service.status", return_value={"mode": "straight_line_estimate", "factor": 1.3, "healthy": False}):
            block = board.routing_block()
        self.assertEqual(block["mode"], "straight_line_estimate")
        self.assertIn("estimate", block["note"].lower())
```

- [ ] **Step 2: Run to verify failure**

Run: `docker compose run --rm web python manage.py test delivery.tests.test_routing_status -v 2`
Expected: AttributeError (`board` has no `routing_block`).

- [ ] **Step 3: Implement**

In `backend/delivery/board.py` add `from routing import service as routing_service` and:

```python
def routing_block():
    s = routing_service.status()
    if s["mode"] == "road":
        note = "Distances and times are road routes."
    else:
        note = "Straight-line estimate. The road route service is not answering, so distances and times are estimates."
    return {**s, "note": note}
```

Replace the hardcoded dict at line 181 (`"routing": {...}`) with `"routing": routing_block()`. In `backend/delivery/views_queue.py` import `from .board import routing_block` (or `routing_service`), replace the dict at line 59 with `routing_block()`, and replace lines 149-150 with:

```python
    from routing import service as routing_service

    leg_to_pickup = routing_service.leg((shift.last_lat, shift.last_lng), (plat, plng)) if shift and shift.last_lat is not None and plat is not None else None
    leg_trip = routing_service.leg((plat, plng), (dlat, dlng)) if plat is not None and dlat is not None else None
    to_pickup = leg_to_pickup["distance_km"] if leg_to_pickup else None
    trip = leg_trip["distance_km"] if leg_trip else None
    basis = (leg_trip or leg_to_pickup or {}).get("basis", "straight-line estimate x 1.3")
```

and in the response at line 159 set `"distance_basis": basis` instead of the string literal. Update `docs` strings only as needed to keep existing tests green.

- [ ] **Step 4: Run to verify pass**

Run: `docker compose run --rm web python manage.py test delivery -v 1`
Expected: new tests OK; existing delivery suite passes (adjust any test that asserted the old fixed `"straight_line_estimate"` block only if routing is configured in that test).

- [ ] **Step 5: Commit**

```bash
git add backend/delivery
git commit -m "feat(delivery): board and queue report the real routing mode and basis"
```

---

### Task 7: Screens say road or estimate from the data

**Files:**
- Modify: `frontend/components/admin/panels/delivery/RulesPanels.jsx:14,147,182`, `frontend/components/admin/panels/delivery/DispatchQueuePanel.jsx:66,151`
- Test: add cases to the existing tests in `frontend/components/admin/panels/delivery/__tests__/` (the files that already render these two panels; grep `Distance basis` and `straight-line estimate` there)

**Interfaces:**
- Consumes: payload `routing: {mode, note}` and `distance_basis` from Tasks 4 and 6.
- Produces: no hardcoded "a road route service is not connected" text remains; the copy comes from `data.routing.note` / `data.distance_basis`.

- [ ] **Step 1: Write the failing tests**

In the existing tests for these panels (reuse their `wrap`/MSW setup), add:

```jsx
it('shows the road-route note when the server reports road mode', async () => {
  server.use(http.get('http://localhost:8000/api/delivery/queue/', () => HttpResponse.json({ ...queueFixture, routing: { mode: 'road', factor: 1.3, healthy: true, note: 'Distances and times are road routes.' } })))
  wrap(<DispatchQueuePanel auth={dm} />)
  expect(await screen.findByText(/road routes/i)).toBeInTheDocument()
  expect(screen.queryByText(/not connected/i)).toBeNull()
})

it('still says estimate when the server reports the fallback', async () => {
  server.use(http.get('http://localhost:8000/api/delivery/queue/', () => HttpResponse.json({ ...queueFixture, routing: { mode: 'straight_line_estimate', factor: 1.3, healthy: false, note: 'Straight-line estimate. The road route service is not answering, so distances and times are estimates.' } })))
  wrap(<DispatchQueuePanel auth={dm} />)
  expect(await screen.findByText(/estimates/i)).toBeInTheDocument()
})
```

(Use the real endpoint path and fixture names already in that test file.)

- [ ] **Step 2: Run to verify failure**

Run (from `frontend/`): `npx vitest run components/admin/panels/delivery/__tests__ -t "road-route note"`
Expected: FAIL (the panel prints the hardcoded "not connected" line).

- [ ] **Step 3: Implement**

In `DispatchQueuePanel.jsx` replace the line-151 text with `{data.routing.note}` and line 66 with a sentence that follows `data.routing.mode`: road mode reads "Distances are road routes."; otherwise "Distances are a straight-line estimate times {data.routing.factor}." Keep the weights sentence. In `RulesPanels.jsx` replace the comment at line 14 and line 182 `Distance basis: {data.distance_basis}. A road route service is not connected.` with `Distance basis: {data.distance_basis}.` (the basis string already says road route or estimate), and leave line 147 as is (it already prints `distance_basis`). The unit label "km (estimate)" on line 24 changes to "km".

- [ ] **Step 4: Run to verify pass**

Run (from `frontend/`): `npx vitest run components/admin/panels/delivery`
Expected: all delivery panel tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/admin/panels/delivery
git commit -m "feat(delivery): screens read road or estimate from the routing data"
```

---

### Task 8: OSRM container, data build, refresh and docs

**Files:**
- Create: `infra/scripts/build-osrm-data.sh`
- Modify: `infra/compose/docker-compose.yml` (new `osrm` service and volume; `web`, `realtime`, `worker` get `OSRM_URL`), `infra/cron/ashantihub.cron`, `backend/.env.example`, `infra/README.md`, `backend/CLAUDE.md`
- Test: shell self-check in the script (`--check`), no unit test

**Interfaces:**
- Consumes: Geofabrik `https://download.geofabrik.de/africa/ghana-latest.osm.pbf`.
- Produces: a named volume `osrm-data` holding `ashanti.osrm*` files; service `osrm` listening on `5000` inside the compose network; `OSRM_URL=http://osrm:5000` for `web`, `realtime`, `worker` (set in the environment's `backend/.env`, not committed).

- [ ] **Step 1: Write the build script**

```bash
#!/usr/bin/env bash
# Build the OSRM routing data for the Ashanti Region and (re)start the osrm container.
# Usage: build-osrm-data.sh <compose-project> <compose-file>      (run from cron monthly, or by hand)
set -euo pipefail
PROJECT="${1:?compose project, e.g. ashantihub}"
COMPOSE_FILE="${2:?path to infra/compose/docker-compose.yml}"
VOLUME="${PROJECT}_osrm-data"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
# Ashanti Region bounding box: lng_min,lat_min,lng_max,lat_max (matches routing/region.py ASHANTI_RING).
BBOX="-2.80,5.80,-0.60,7.50"

curl -fsSL -o "$WORK/ghana.osm.pbf" https://download.geofabrik.de/africa/ghana-latest.osm.pbf
docker run --rm -v "$WORK:/data" iboates/osmium:latest extract --bbox "$BBOX" /data/ghana.osm.pbf -o /data/ashanti.osm.pbf --overwrite
docker volume create "$VOLUME" >/dev/null
OSRM_IMAGE="ghcr.io/project-osrm/osrm-backend:v5.27.1"
docker run --rm -v "$WORK:/in" -v "$VOLUME:/data" "$OSRM_IMAGE" sh -c \
  "cp /in/ashanti.osm.pbf /data/ashanti.osm.pbf && osrm-extract -p /opt/car.lua /data/ashanti.osm.pbf && osrm-partition /data/ashanti.osrm && osrm-customize /data/ashanti.osrm"
docker compose -p "$PROJECT" -f "$COMPOSE_FILE" up -d osrm
echo "OSRM data built and osrm restarted for $PROJECT"
```

`chmod +x infra/scripts/build-osrm-data.sh`. Run `bash -n infra/scripts/build-osrm-data.sh` (syntax check); expected: no output.

- [ ] **Step 2: Add the compose service**

In `infra/compose/docker-compose.yml`, add under `services:` (after `beat`) and `osrm-data:` under `volumes:`:

```yaml
  # Road routing for delivery distances and ETAs. Data is built by infra/scripts/build-osrm-data.sh;
  # until the first build the container exits and the app uses the labelled straight-line estimate.
  osrm:
    image: ghcr.io/project-osrm/osrm-backend:v5.27.1
    restart: unless-stopped
    command: ["osrm-routed", "--algorithm", "mld", "--max-table-size", "200", "/data/ashanti.osrm"]
    volumes:
      - osrm-data:/data:ro
    logging: *default-logging
```

```yaml
volumes:
  pgdata:
  osrm-data:
```

(The `osrm` service publishes no host port: only containers on the compose network reach it.)

- [ ] **Step 3: Cron, env and docs**

- `infra/cron/ashantihub.cron`: add `0 3 1 * * root /opt/ashantihub/infra/scripts/build-osrm-data.sh ashantihub /opt/ashantihub/infra/compose/docker-compose.yml >> /var/log/ashantihub-osrm.log 2>&1` (match the file's existing user/format; staging does not get this line, build it by hand once).
- `backend/.env.example`: add `OSRM_URL=` (blank = routing off) and `OSRM_TIMEOUT_S=2.0` with a one-line comment.
- `infra/README.md`: add a section "Road routing (OSRM)" with: first build on each environment (`bash infra/scripts/build-osrm-data.sh <project> <compose file>`), then set `OSRM_URL=http://osrm:5000` in that checkout's `backend/.env` and restart `web realtime worker beat`; the fallback behaviour; the monthly cron.
- `backend/CLAUDE.md`: add a bullet "**Distances come from `routing.service`.** Never call `delivery.services.distance_estimate_km` for a figure shown to a user; use `routing.service.leg`/`legs_from`, which return the road route or the labelled estimate (`basis`). Only `routing/client.py` talks to OSRM and converts lat/lng to lng/lat. The service area is `routing.region.in_service_area`."

- [ ] **Step 4: Verify**

Run: `docker compose -f infra/compose/docker-compose.yml config -q` (needs the env the file expects; if it complains about `APP_IMAGE`/ports, run with `APP_IMAGE=x REALTIME_PORT=8100 APP_PORT=8000` set) — expected: no error. Run `docker compose run --rm web python manage.py test routing delivery orders marketing` — expected: all pass. Run `docker compose run --rm web python manage.py makemigrations --check --dry-run` — expected: "No changes detected". Run the full Vitest suite from `frontend/` and `npm run build`.

- [ ] **Step 5: Commit**

```bash
git add infra backend/.env.example backend/CLAUDE.md
git commit -m "feat(infra): OSRM container, Ashanti data build script, monthly refresh and docs"
```

---

## Verification on staging (after merge, not part of the tasks)

1. Deploy to staging (`deploy` skill). Run `bash /opt/ashantihub-staging/infra/scripts/build-osrm-data.sh ashantihub-staging /opt/ashantihub-staging/infra/compose/docker-compose.yml`.
2. Set `OSRM_URL=http://osrm:5000` in `/opt/ashantihub-staging/backend/.env`, restart `web realtime worker beat`.
3. As Delivery Manager open Delivery pricing "Try a route" and the Dispatch queue: the basis reads "road route" and the routing note says road routes. Stop the `osrm` container: the same screens fall back to "estimate" within about 30 seconds.
4. Check a checkout with a delivery point in Accra is refused and one in Kumasi is accepted.

## Self-review notes

- **Spec coverage (stage 1):** OSRM container and data build (Task 8); `routing` module with `route`, `table`, health (Tasks 1-2); fallback and labelling (Task 2, 6, 7); ETA durations returned by `leg`/`legs_from` (Task 2; learned correction and per-leg storage are stage 2 because they need dispatch legs); service-area refusal (Tasks 3, 5); real distances on cart/fee/manager screens (Tasks 4-7); manager alert on OSRM down is the visible fallback note plus the status block (Task 6). Per-leg order fields, size classes, business prep time and pickup locations belong to stages 2-4 and are deliberately not in this plan.
- **Type consistency:** `leg()` and `legs_from()` return `{"distance_km", "duration_s", "basis", "geometry"}` everywhere; `route_km` returns `(km, basis)` and both callers are updated; `status()` returns `{"mode", "factor", "healthy"}` and `board.routing_block()` adds `note`.
- **Known gaps to confirm during execution:** Task 5's test base class and fixtures must be copied from the existing checkout tests; Task 4 step 3.5 requires reading `views_rules.py` around line 95 for the `route_km` call.
