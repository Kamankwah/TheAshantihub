# Self-serve Phase 4: pins in checkout and dispatch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every door-to-door order carries a trusted customer pin and every pickup stop uses the business's shop pin, so a rider is one tap from navigation to both.

**Architecture:** Coordinates are the source of truth; the Ghana Post code is an optional label. Checkout accepts a pin or a valid code (plus landmark), snapshots both stops' coordinates on the order at payment, and the rider payloads carry `navigate` links built from coordinates. The delivery fee already comes from pin-to-pin road distance (`routing.service`), unchanged.

**Tech Stack:** Django/DRF, React, Expo/React Native.

**Spec:** `docs/superpowers/specs/2026-11-05-self-serve-onboarding-design.md` §4.5, §9a "Pin changes" and "Customer pin". Requires Phase 2 (`docs/superpowers/plans/2026-11-06-self-serve-phase2-pin-and-go-live.md`) merged: the business pin and tier exist.

## Global Constraints

- Production only on the owner's explicit word; staging first.
- Settled rule changed here, to be recorded in root `CLAUDE.md`: door-to-door needs **a pin or a valid Ashanti Ghana Post code, plus a landmark**; store pickup needs neither.
- Pin rules: inside the service area (`routing.region.in_service_area`), finite numbers, accuracy recorded; a customer pin outside the Ashanti box is refused with `out_of_area` (message already in `routing.region.OUT_OF_AREA_MESSAGE`).
- The fee is computed on the server at checkout from the stored pin; moving the pin afterwards changes nothing. An order snapshots pickup and drop-off pins at payment; a later change never re-routes a live delivery.
- Distances shown to users come from `routing.service` only (backend/CLAUDE.md); never `distance_estimate_km`.
- Customer phone is never added to a rider or dispatch payload.
- Navigate links are plain URLs built from coordinates: `https://www.google.com/maps/dir/?api=1&destination=<lat>,<lng>`; no key, no network call.
- No fabricated data: a stop with no pin shows "No pin: call Dispatch", never a guessed point.

## Review Focus

- Customer sends a code but no pin while `DELIVERY_FEE_ENABLED` is on and a rate card is live: still refused `pin_required` (a fee cannot be worked out without a pin); with fees off a code alone is enough.
- Customer sends a pin with no code: accepted; `delivery_gps_address` stored blank; every serializer tolerates blank (older orders already do).
- Lat/lng sent as strings, NaN, `inf`, swapped, or `0,0`: field-keyed 400, never a 500.
- Pickup stop: business with a pin but a listing with its own `lat/lng` (today's source): listing coordinates win only if set deliberately; otherwise the business pin; neither: stop is "no pin".
- Business moves its pin while an order is paid and undelivered: the live delivery keeps the snapshot.
- A rider reports "pin wrong": opens a Support case once per order and stop (idempotent), customer phone never in it.

---

### Task 1: Checkout accepts a pin or a code

**Files:**
- Modify: `backend/orders/views.py:150-182` (door-to-door validation), `backend/accounts/views.py` (the `CustomerAddress` save path that enforces `gps_address`), `backend/accounts/models.py:835` (`CustomerAddress.gps_address` gains `blank=True`; migration), `backend/accounts/serializers.py` (address serializer)
- Test: `backend/orders/tests/test_checkout_pin_or_code.py`, `backend/accounts/tests/test_customer_address_pin.py`

**Interfaces:**
- Produces: `orders.delivery_point.clean(request_data) -> DeliveryPoint` with `DeliveryPoint(gps_address: str, landmark: str, lat: float|None, lng: float|None)`; raises `DRFValidationError` keyed by field. Rules: landmark required (1..200); at least one of {valid Ashanti code via `accounts.gps.validate_ashanti_gps`, a finite lat/lng pair inside `ASHANTI_LAT/ASHANTI_LNG`}; error key when neither is `delivery_gps_address` with message "Share your location on the map or enter your Ghana Post address."; lat without lng (or the reverse) is a `delivery_lat` error; `delivery.rates.pin_required` still applies afterwards.

- [ ] **Step 1: Write failing tests**: code+landmark (no pin, fees off) 201; pin+landmark (no code) 201 with blank code stored; neither 400 keyed `delivery_gps_address`; pin only with fees on and a rate card still works (a pin satisfies `pin_required`); code only with fees on and a card 400 `delivery_lat`; strings, NaN, `inf`, `"abc"`, lat only, `0,0` each 400 field-keyed; pin outside the service area 400 `out_of_area`; store pickup unchanged; `CustomerAddress` can be saved with a pin and no code, and still with a code and no pin, and with neither is 400.
- [ ] **Step 2: Run** `docker compose run --rm web python manage.py test orders.tests.test_checkout_pin_or_code accounts.tests.test_customer_address_pin` — Expected: FAIL.
- [ ] **Step 3: Implement** `orders/delivery_point.py` and call it from `OrderCheckoutView` in place of the inline block; keep the order of checks (cheap validation before any routing call).
- [ ] **Step 4: Run** `... test orders accounts cart delivery` — Expected: pass; update existing tests that asserted the code is always required.
- [ ] **Step 5: Commit** `feat(orders): door-to-door needs a pin or a Ghana Post code, plus a landmark`.

### Task 2: Pickup stops use the business pin; orders snapshot both pins

**Files:**
- Create: `backend/orders/pins.py`, `backend/orders/migrations/00NN_order_pin_snapshot.py`, `backend/orders/tests/test_pin_snapshot.py`
- Modify: `backend/orders/models.py` (snapshot fields), `backend/orders/serializers.py:323-360` (`DispatchDeliverySerializer.get_pickups`), the checkout path that creates the order (stamps the snapshot), `backend/delivery/` stop code that reads listing coordinates

**Interfaces:**
- Produces: `pins.pickup_point(listing) -> tuple[float, float] | None`: the listing's own `lat/lng` when both are set, else the owner profile's `lat/lng`, else `None`.
- Produces: `Order.pickup_pins` JSONField default `list` (stamped at payment: `[{"business_owner": id, "lat": float, "lng": float}]`, only businesses with a pin); `Order.delivery_lat/lng` already exist and are the drop-off snapshot.
- `get_pickups` reads the snapshot first, falling back to `pins.pickup_point` for orders paid before this release; a stop with no point returns `"lat": None, "lng": None, "pin_status": "missing"`, otherwise `"pin_status": "set"`.

- [ ] **Step 1: Write failing tests**: pickup uses business pin when listing has none; listing coordinates win when set; no pin gives `pin_status: "missing"`; snapshot stamped at payment; business moves its pin after payment and the serializer still returns the old point; an order paid before the migration (empty snapshot) falls back to live pins; two businesses in one order give two stops.
- [ ] **Step 2: Run** `... test orders.tests.test_pin_snapshot` — Expected: FAIL.
- [ ] **Step 3: Implement**; the snapshot is written in the same transaction as the payment finalisation (find it via `payments.services` `FAILURE_HANDLERS` neighbours; do not add a new lock order, follow `orders/locks.py`).
- [ ] **Step 4: Run** `... test orders delivery routing ledger.tests.test_lock_order` — Expected: pass.
- [ ] **Step 5: Commit** `feat(orders): pickup stops use the shop pin and an order keeps its pins`.

### Task 3: Navigate links and "pin wrong" report in the rider payload

**Files:**
- Create: `backend/delivery/navigate.py`, `backend/delivery/tests/test_navigate.py`
- Modify: `backend/orders/serializers.py` (`DispatchDeliverySerializer`: each pickup and the drop-off gain `navigate_url`), the rider job view that exposes it (`backend/delivery/views_fleet.py` neighbours), `backend/delivery/` new endpoint `POST /api/delivery/rider/jobs/<id>/pin-wrong/`, `backend/support/` case creation helper (find the helper `orders.support` uses to open a case)

**Interfaces:**
- Produces: `navigate.url(lat: float|None, lng: float|None) -> str|None` returning the Google Maps directions URL from the Global Constraints or `None` when either is missing.
- Produces: `POST .../pin-wrong/` body `{"stop": "pickup:<business_owner_id>" | "dropoff", "note": str<=300}`; opens one Support case per (order, stop) (a repeat answers 200 with the same case id); the case body holds the stop, the note and the pin, never the customer's phone; only the assigned rider may call it (403 otherwise).

- [ ] **Step 1: Write failing tests**: URL for a point; `None` for missing; payload carries `navigate_url` per stop; pin-wrong creates one case, is idempotent, rejects a non-assigned rider, case body has no phone digits of the customer, note over 300 is 400.
- [ ] **Step 2: Run** `... test delivery.tests.test_navigate` — Expected: FAIL.
- [ ] **Step 3: Implement** and add the activity event through the existing rider-write pattern.
- [ ] **Step 4: Run** `... test delivery orders support` — Expected: pass.
- [ ] **Step 5: Commit** `feat(delivery): navigate links and a pin-wrong report for riders`.

### Task 4: Web checkout and address book

**Files:**
- Modify: `frontend/components/shop/CheckoutPage.jsx`, `frontend/components/account/AddressForm.jsx`, `frontend/components/account/OrdersPanel.jsx`, `frontend/mocks/handlers.js`, their tests
- Reuse: `frontend/components/LocationPicker.jsx`

**Interfaces:** the door-to-door form shows, in order: "Use my location" / map pin (`LocationPicker`), Ghana Post address (optional, label "Optional if you shared your pin"), landmark (required). It submits `delivery_lat`, `delivery_lng` when a pin exists and `delivery_gps_address` when typed. Copy: "We work out the delivery fee at checkout from your pin" (no delivery dates, per CLAUDE.md). Field errors from Task 1 show under their fields.

- [ ] **Step 1: Write failing tests**: pin alone allows submit; code alone allows submit; neither disables submit with the message; server field error shown; landmark still required.
- [ ] **Step 2: Run** from `frontend/`: `npx vitest run CheckoutPage AddressForm OrdersPanel` — Expected: FAIL.
- [ ] **Step 3: Implement** per `DESIGN.md`, inline `C` palette.
- [ ] **Step 4: Run** `npx vitest run` and `npm run build` — Expected: green except the known dark-mode home timeout.
- [ ] **Step 5: Commit** `feat(frontend): checkout accepts a pin or a Ghana Post address`.

### Task 5: Mobile checkout and rider screens

**Files:**
- Modify: `mobile/src/app/checkout.tsx` (form at line 43: add `lat`, `lng`; pin from `expo-location` and the draggable map marker), the rider job screen under `mobile/src/app/manage/order/[id].tsx` and the rider map component (a "Navigate" button per stop using `Linking.openURL(navigate_url)`, a "Pin wrong" action posting Task 3's endpoint, "No pin: call Dispatch" when `pin_status === "missing"`), mobile API types, tests

- [ ] **Step 1: Write failing tests**: checkout submit body has `delivery_lat/lng` when pinned; no code and a pin passes validation; Navigate button opens the URL; missing pin shows the message and hides Navigate; Pin wrong posts the stop id.
- [ ] **Step 2: Run** `cd mobile && npx jest checkout rider` — Expected: FAIL, pass after Step 3.
- [ ] **Step 3: Implement**, then `npx tsc --noEmit` and the full `npx jest`.
- [ ] **Step 4: Commit** `feat(mobile): pin checkout and rider navigation`.

### Task 6: Docs and staging proof

**Files:**
- Modify: root `CLAUDE.md` (Shopper delivery limits paragraph: pin or code plus landmark), `backend/CLAUDE.md` (Shopper pages: replace "GhanaPost + landmark are enforced" bullet with `orders.delivery_point`, snapshot, pin-wrong), spec Phase 4 as built

- [ ] **Step 1: Update docs.**
- [ ] **Step 2: Whole-branch checks** (backend full suite, `makemigrations --check --dry-run`, frontend vitest + build, mobile jest + tsc); record counts.
- [ ] **Step 3: Merge to `righteoushack`, PR to `main`, deploy staging.** Staging proof: place a door-to-door order with a pin and no code, see the rider payload with both navigate links on a phone, open Google Maps from each, move the business pin and confirm the live delivery keeps its stop, file a pin-wrong report.
- [ ] **Step 4: Stop.** Production waits for the owner.
