# Delivery Maps for Every Party Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put an OpenStreetMap map, with road route and arrival time, in front of each party: the Delivery Manager (dispatch queue, job drawer, zone drawing), the Dispatch role (own deliveries), the Vendor (rider approaching) and the Customer (rider after pickup).

**Architecture:** One backend module, `delivery/tracking.py`, builds a map payload per audience from data that already exists (order stops, the rider's open `ShiftSession` last fix, `routing.service.leg(..., geometry=True)`). Four thin endpoints expose it, each scoped to what its audience may see. One shared React `TrackMap` component draws markers plus a route line; `ZoneDrawMap` adds Leaflet Draw for zones. Screens poll every 15 s (routing legs are cached 60 s, so many viewers cost one OSRM call).

**Tech Stack:** Django/DRF, `routing.service`, React, react-leaflet 5, leaflet-draw 1.0.4 (new), Vitest/MSW.

**Spec:** `docs/superpowers/specs/2026-10-13-delivery-routing-dispatch-design.md` (sections 3 and 6). Builds on `docs/superpowers/plans/2026-10-13-delivery-routing-foundation.md` (done, on staging).

## Global Constraints

- Distances and times come only from `routing.service` (never haversine in new code). Every figure carries its `basis` ("road route" or "straight-line estimate x 1.3") and the screen shows it. A `geometry` of `None` means draw no route line, never a fake straight line.
- Rider positions come only from the open `ShiftSession` (`last_lat`, `last_lng`, `last_fix_at`). No fix, no pin; never 0,0. A fix older than `rules["stale_s"]` (from `config.effective_rules()`) is returned with `stale: true`.
- Privacy (spec section 3, 6): customer sees the rider only after pickup (status `picked_up` or `at_customer`), as first name and vehicle type only, never phone, never the rider's staff id. Business sees the rider only while status is `assigned`, `accepted` or `at_pickup`, and never the customer's address, pin or phone. Neither audience ever receives a pickup or drop code except the customer's existing `delivery_code`.
- Tiles: public OpenStreetMap, with the attribution string already used in `RiderMap.jsx`. The tile provider decision stays open in the spec.
- Frontend: inline `C`/`D` palette, no `useMutation`, `components/**` never imports `App.jsx` (the customer card is a component rendered from App). Leaflet does not render under jsdom: new Leaflet files are stubbed in `frontend/test/setup.js` like `RiderMap.jsx`, and verified by hand in a browser.
- Backend tests: `docker compose run --rm -e POSTGRES_HOST=db web python manage.py test <app>`. Frontend tests: run Vitest from `frontend/`.
- Out of scope: realtime push of positions (polling for now), heatmap, busy-area alerts, Web Push, pickup code flow changes, any pricing change.

## Review Focus

- A customer asking for another customer's order tracking must get 404, not an empty 200 (isolation test).
- A business owner whose listing is not on the order must get 404; one whose listing is on it must never see `delivery_lat`, `delivery_lng`, address, or `drop` in any key of the payload (assert on the serialized JSON text).
- Rider with no shift, no fix, or a stale fix: map still renders the stops, the rider is absent or marked stale, no exception.
- OSRM down: payload still returns, `basis` is the estimate label, `route` is `null`, ETA present.
- Order with no delivery coordinates (free-text address): drop pin absent, screen says so, no crash on `fitBounds` with zero points.
- Zone drawing: a saved ring must be closed or auto-closed, have at least 3 distinct points, and use `[lng, lat]` order (the existing `DeliveryZone.boundary` format). Deleting the shape saves `null`.

---

### Task 1: Tracking payload builder

**Files:**
- Create: `backend/delivery/tracking.py`
- Test: `backend/delivery/tests/test_tracking.py`

**Interfaces:**
- Consumes: `services.pickup_stop(order) -> (lat, lng, name)`, `services.drop_stop(order) -> (lat, lng)`, `services.open_shift(rider)`, `routing.service.leg(origin, dest, geometry=True) -> {distance_km, duration_s, basis, geometry}`, `config.effective_rules()["stale_s"]`, `DeliveryAssignment.status`.
- Produces (all return plain dicts, JSON-safe):
  - `rider_fix(assignment, now=None) -> {"lat","lng","age_s","stale"} | None` (None when no rider, no shift or no fix)
  - `line(geometry) -> list[[lat,lng]] | None` (swaps GeoJSON `[lng,lat]`; `None`/empty gives `None`)
  - `next_stop(assignment) -> "pickup" | "drop" | None` (`pickup` for assigned/accepted/at_pickup, `drop` for picked_up/at_customer, else None)
  - `manager_job_map(assignment, now=None) -> {"stage","pickup":{lat,lng,name}|None,"drop":{lat,lng}|None,"rider":{...fix, "name","vehicle_type"}|None,"leg":{"to":"pickup|drop","distance_km","duration_s","basis"}|None,"route":[[lat,lng],...]|None}`
  - `customer_map(assignment, now=None)` and `business_map(assignment, owner, now=None)` per the privacy constraints above.
  - `queue_map(order, now=None) -> {"pickup","drop","trip":{distance_km,duration_s,basis}|None,"route","riders":[{"rider_id","name","lat","lng","age_s","stale","eligible","reason","minutes_to_pickup","distance_km","basis"}]}` — riders are those on shift with a fix, capped at the 30 nearest by straight-line, road times from one `routing.service.legs_from` call; `eligible`/`reason` come from `dispatching.rank(order)` (`eligible` and `left_out` lists).

- [ ] **Step 1: Write failing tests** covering: `line` swaps order and returns None for `None`/`[]`; `rider_fix` None without a shift, `stale` True past `stale_s`; `next_stop` per status; `customer_map` has `rider` None for `accepted` and a first-name-only rider for `picked_up`, and the serialized JSON contains neither the rider's last name nor phone; `business_map` for `picked_up` has `rider` None and for `at_pickup` has none of the keys `drop`, `delivery_lat`, `delivery_lng`, `delivery_address` (check `json.dumps(payload)` for the order's address string); `queue_map` marks a rider with a declined offer `eligible: False` with the engine's reason; OSRM stubbed to raise `OsrmUnavailable` still returns payloads with the estimate `basis` and `route` None. Use `unittest.mock.patch("delivery.tracking.routing_service.leg")` for road cases. Reuse the existing fixtures in `delivery/tests/` (see `test_dispatching.py` for an order, rider and open shift).
- [ ] **Step 2: Run, expect FAIL** (`ImportError: delivery.tracking`).
- [ ] **Step 3: Implement `tracking.py`.** Core shape:

```python
"""Map payloads for each audience. Positions come only from the rider's open shift; distances only from
routing.service. Each builder returns exactly what its audience may see and nothing else."""
from django.utils import timezone
from orders.models import DeliveryAssignment as DA
from routing import service as routing_service
from . import config, dispatching, services

TO_PICKUP = (DA.ASSIGNED, DA.ACCEPTED, DA.AT_PICKUP)
TO_DROP = (DA.PICKED_UP, DA.AT_CUSTOMER)


def line(geometry):
    return [[lat, lng] for lng, lat in geometry] if geometry else None


def next_stop(a):
    return "pickup" if a.status in TO_PICKUP else "drop" if a.status in TO_DROP else None


def rider_fix(a, now=None):
    rider = getattr(a.dispatch, "rider", None) if a.dispatch_id else None
    shift = services.open_shift(rider) if rider else None
    if not shift or shift.last_lat is None or shift.last_fix_at is None:
        return None
    now = now or timezone.now()
    age = int((now - shift.last_fix_at).total_seconds())
    return {"lat": shift.last_lat, "lng": shift.last_lng, "age_s": age,
            "stale": age > int(config.effective_rules()["stale_s"])}
```

Build the audience functions on those helpers: compute `target = pickup or drop` per `next_stop`, call `routing_service.leg((fix.lat, fix.lng), (tlat, tlng), geometry=True)` only when the rider fix and target both exist, and set `leg`/`route` from it (`route = line(leg["geometry"])`; strip `geometry` from `leg`). `customer_map` returns `{"stage", "drop", "rider", "leg", "route"}` with `rider` and `leg`/`route` only for `TO_DROP`; its rider is `{"first_name", "vehicle_type", lat, lng, age_s, stale}` (first name = `full_name.split()[0]`). `business_map(a, owner)` returns `{"stage","pickup","rider","leg","route"}` where `pickup` is the owner's own pin (via `services.business_pin(owner)`), rider only for `TO_PICKUP`, and no key that mentions the customer. `manager_job_map` returns everything (names allowed for staff).
- [ ] **Step 4: Run tests, expect PASS.**
- [ ] **Step 5: Commit** — `feat(delivery): map payloads per audience (manager, customer, business)`.

---

### Task 2: Manager and Dispatch endpoints

**Files:**
- Modify: `backend/delivery/views_queue.py` (add `QueueMapView`), `backend/delivery/views_live.py` (add `JobMapView`), `backend/delivery/urls.py`, `backend/orders/views.py` (add `DispatchMapView`), `backend/orders/urls.py`
- Test: `backend/delivery/tests/test_tracking_views.py`

**Interfaces:**
- Consumes: Task 1 builders.
- Produces: `GET /api/delivery/queue/<order_id>/map/` (`ManageView`, order must be in `board.waiting_orders()` else 404, returns `queue_map`); `GET /api/delivery/jobs/<pk>/map/` (`ManageView`, returns `manager_job_map`); `GET /api/orders/dispatch/<pk>/map/` (`HasRolePermission("delivery.dispatch")`, assignment must have `dispatch=request.user` else 404, returns `manager_job_map`).

- [ ] **Step 1: Write failing tests:** a manager with the delivery permission gets 200 with the expected keys for a waiting order and for an assigned job; an unauthenticated and a customer user get 401/403; a dispatch user gets 200 for their own assignment and 404 for another dispatcher's; a non-waiting order on the queue map gives 404.
- [ ] **Step 2: Run, expect FAIL (404 on the new URLs).**
- [ ] **Step 3: Implement** the three views (each is `Response(tracking.<builder>(obj))` after the scoped `get_object_or_404`) and register `queue/<int:order_id>/map/`, `jobs/<int:pk>/map/`, `dispatch/<int:pk>/map/` with names `delivery-queue-map`, `delivery-job-map`, `orders-dispatch-map`. Prefetch like `JobDetailView` does to avoid N+1.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `feat(delivery): manager and dispatch map endpoints`.

---

### Task 3: Customer and vendor tracking endpoints

**Files:**
- Modify: `backend/orders/views.py` (add `OrderTrackingView`, `OwnerOrderTrackingView`), `backend/orders/urls.py`
- Test: `backend/orders/tests/test_tracking_privacy.py`

**Interfaces:**
- Consumes: `tracking.customer_map`, `tracking.business_map`. Mirror the permission and queryset scoping of `OrderDetailView` (customer's own orders) and `OwnerOrderListView` (orders with a line item whose listing belongs to the owner); read both first.
- Produces: `GET /api/orders/<pk>/tracking/` → `customer_map` or `{"stage": "not_assigned"}` when the order has no assignment; `GET /api/orders/owner/<pk>/tracking/` → `business_map` likewise. Names `order-tracking`, `owner-order-tracking`.

- [ ] **Step 1: Write failing privacy tests** for every Review Focus bullet that concerns these endpoints: other customer gets 404; owner not on the order gets 404; owner on the order never sees the address string, `delivery_lat`, `delivery_lng` or `drop` anywhere in `response.content.decode()`; customer response before pickup has `rider` null; after pickup has `first_name` but the content contains neither the rider's surname nor phone nor `staff_id`; no assignment gives `{"stage": "not_assigned"}`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement the views and URLs.**
- [ ] **Step 4: Run `python manage.py test orders delivery`, expect PASS.**
- [ ] **Step 5: Commit** — `feat(orders): privacy-scoped tracking for customers and vendors`.

---

### Task 4: Shared map components and hooks

**Files:**
- Create: `frontend/components/maps/TrackMap.jsx`, `frontend/components/maps/EtaLine.jsx`, `frontend/hooks/useTracking.js`
- Modify: `frontend/test/setup.js` (stub `TrackMap.jsx`, same style as the `RiderMap.jsx` stub, rendering one button per marker)
- Test: `frontend/components/maps/__tests__/EtaLine.test.jsx`, `frontend/hooks/__tests__/useTracking.test.jsx`

**Interfaces:**
- Produces:
  - `<TrackMap markers route height label onSelect />` — `markers: [{id, kind: "pickup"|"drop"|"rider"|"candidate"|"stale", lat, lng, label}]`; `route: [[lat,lng],...] | null`. Draws `CircleMarker`s (gold pickup `#D4A017`, green drop `#006400`, dark rider `#2C1810`, white candidate, dashed ring when stale), a `Polyline` when `route` has 2+ points, fits bounds to every marker and the route, renders an honest empty box ("No map coordinates for this delivery yet.") when there are no markers. Follow `RiderMap.jsx` for tile layer and `Fit`.
  - `<EtaLine leg stale />` — text like "About 7 min · 3.2 km · road route" using `leg.duration_s`, `leg.distance_km`, `leg.basis`; when `stale` adds "Last location 4 min ago"; renders nothing for a null leg.
  - Hooks (react-query, `refetchInterval: 15000`, `refetchIntervalInBackground: false`): `useQueueMap(orderId)`, `useJobMap(jobId)`, `useDispatchMap(jobId)`, `useOrderTracking(orderId, {enabled})`, `useOwnerOrderTracking(orderId, {enabled})`, hitting the four endpoints from Tasks 2-3. Follow the shape of `hooks/useDelivery.js` (`useQueueRanking`).

- [ ] **Step 1: Write failing tests:** `EtaLine` renders minutes/km/basis, the stale suffix, and nothing for null; `useTracking` hooks request the right URLs (MSW handler per endpoint added to `frontend/mocks/handlers.js` with a realistic payload).
- [ ] **Step 2: Run from `frontend/`: `npx vitest run components/maps hooks/__tests__/useTracking.test.jsx`, expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect PASS; then the full `npx vitest run` to confirm the new setup stub breaks nothing.**
- [ ] **Step 5: Commit** — `feat(frontend): shared TrackMap, EtaLine and tracking hooks`.

---

### Task 5: Delivery Manager maps (dispatch queue and job drawer)

**Files:**
- Modify: `frontend/components/admin/panels/delivery/DispatchQueuePanel.jsx`, `frontend/components/admin/panels/delivery/ActiveDeliveriesPanel.jsx`
- Test: `frontend/components/admin/panels/delivery/__tests__/DeliveryMaps.test.jsx`

**Interfaces:**
- Consumes: `useQueueMap`, `useJobMap`, `TrackMap`, `EtaLine`.
- Produces: in the queue's ranking drawer, above the table, a map with pickup, drop, route and one marker per rider (eligible ones solid, left-out ones white with the reason in the tooltip); a legend line naming the basis. Clicking a candidate marker highlights its row in the ranking table. The active-job drawer gets a map with stops, rider and the leg to the next stop plus `EtaLine`.

- [ ] **Step 1: Write failing tests:** the drawer renders the stubbed map with a pickup and drop marker and a rider button; a rider with `eligible: false` shows its reason; with `route: null` and an estimate basis the screen text contains "straight-line estimate"; with no pickup coordinates it shows the empty-state text.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `feat(frontend): maps in the dispatch queue and job drawer`.

---

### Task 6: Zone drawing with Leaflet Draw

**Files:**
- Create: `frontend/components/maps/ZoneDrawMap.jsx`
- Modify: `frontend/package.json` and lockfile (`npm install leaflet-draw@1.0.4`), `frontend/components/admin/panels/delivery/DeliveryZonesPanel.jsx`, `frontend/test/setup.js` (stub `ZoneDrawMap.jsx`: a button "draw triangle" calling `onChange` with a fixed ring, and one "clear" button calling `onChange(null)`)
- Test: `frontend/components/admin/panels/delivery/__tests__/DeliveryZonesDraw.test.jsx`, `frontend/components/maps/zoneRing.test.js`

**Interfaces:**
- Produces: `ringFromLatLngs(latlngs) -> [[lng,lat],...] closed` and `latLngsFromRing(ring) -> [[lat,lng],...]` (pure helpers in `frontend/components/maps/zoneRing.js`, unit-tested: closes an open ring, drops fewer than 3 distinct points to `null`, swaps order). `<ZoneDrawMap ring others onChange height />` — map centred on Kumasi `[6.6885, -1.6244]` zoom 11 when empty; draws `ring` as an editable polygon; `others` (other zones' rings) as thin grey outlines; Leaflet Draw toolbar with polygon draw, edit and delete only (no marker, circle, rectangle or polyline).
- Known pitfall: leaflet-draw 1.0.4 throws `type is not defined` when computing a polygon's readable area; construct the control with `draw: { polygon: { showArea: false } }`.
- In `ZoneCard`, edit mode shows the map; saving sends `PATCH /api/delivery/zones/<id>/ {name, boundary: ring}` exactly as today. The coordinate text box stays inside a "Edit coordinates as text" disclosure for people who prefer it, and the map and text stay in sync through the ring state.

- [ ] **Step 1: Write failing tests:** the `zoneRing` helpers (closing, swapping, degenerate input); in the panel, drawing via the stub then Save sends the ring in `[lng, lat]` order, and clear sends `boundary: null`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Install the dependency and implement.** Import `leaflet-draw` and `leaflet-draw/dist/leaflet.draw.css` inside `ZoneDrawMap.jsx` only.
- [ ] **Step 4: Run from `frontend/`: the new tests, then `npm run build`, expect both to succeed.**
- [ ] **Step 5: Commit** — `feat(frontend): draw delivery zones on a map with Leaflet Draw`.

---

### Task 7: Dispatch role, Vendor and Customer maps

**Files:**
- Modify: `frontend/components/admin/panels/DispatchPanel.jsx`, `frontend/components/dashboard/panels/DeliveriesPanel.jsx`, `frontend/App.jsx` (render only; the card at about line 2159)
- Create: `frontend/components/OrderTrackingMap.jsx` (customer; wraps `useOrderTracking` + `TrackMap` + `EtaLine`)
- Modify: `frontend/components/DeliveryRouteMap.jsx` (accept an optional `route` and `rider`; draw `route` when given, keep the existing straight guide line otherwise)
- Test: `frontend/components/__tests__/OrderTrackingMap.test.jsx`, additions to `frontend/components/dashboard/panels/DeliveriesPanel.test.jsx` and the Dispatch panel's existing test

**Interfaces:**
- Dispatch role: "Show route map" uses `useDispatchMap(delivery.id)` and passes `route` and the rider's own fix into `DeliveryRouteMap`.
- Vendor: on an order row with status `assigned`/`accepted`/`at_pickup`, a "Rider on the way" disclosure shows `TrackMap` with the shop pin and the rider, and `EtaLine`; hidden entirely (not an empty box) otherwise. Copy never mentions the customer's address.
- Customer: on the order card, while the delivery is assigned, show text only before pickup ("Finding a rider" when no assignment, "A rider is heading to the shop" otherwise); from pickup show `OrderTrackingMap` with the live rider, the drop pin and the ETA. The delivery code display is unchanged. No call or message button to the rider.

- [ ] **Step 1: Write failing tests:** customer card shows no map and no rider before pickup, and a map with a first name after pickup; vendor row hides the map after pickup and shows no address text; Dispatch panel passes a route (assert the stub receives it).
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the full `npx vitest run` and `npm run build`, expect PASS.**
- [ ] **Step 5: Commit** — `feat(frontend): maps for dispatch, vendors and customers`.

---

### Task 8: Docs, staging deploy and hand check

**Files:**
- Modify: `docs/superpowers/specs/2026-10-13-delivery-routing-dispatch-design.md` (mark which section 3 and 6 items are built, and note the polling-for-now deviation), `frontend/CLAUDE.md` only if a new convention appeared.

- [ ] **Step 1:** Run the whole backend suite and `makemigrations --check --dry-run` (expect no model changes), the whole frontend suite and `npm run build`.
- [ ] **Step 2:** Merge to `righteoushack`, push, merge to `main` per the `deploy` skill, deploy **staging only** (`/opt/ashantihub-staging`). Production waits for an explicit instruction.
- [ ] **Step 3:** In a real browser on test.theashantihub.com with the demo data: the queue drawer map with the pickup, drop and route; draw a zone, save, reload and see it; the vendor view before and after pickup; the customer card before and after pickup. Seed a shift fix for a staging rider with a one-off `manage.py shell` call to see a rider on the map; remove it afterwards. Record what was checked, and what could not be.
- [ ] **Step 4: Commit the doc updates** — `docs: delivery maps built, polling noted`.
