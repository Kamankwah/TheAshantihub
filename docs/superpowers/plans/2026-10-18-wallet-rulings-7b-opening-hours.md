# Wallet Rulings 7B: Business Opening Hours and After-Hours Delivery — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every business records structured weekly opening and closing times; an order placed when a vendor is closed is held for delivery until that vendor's next opening.

**Architecture:** Replace the free-text `BusinessOwner.opening_hours` (`accounts/models.py:485`) with a `BusinessHours` table (one row per weekday), keep the old text as a legacy display until migrated. A pure function `next_open(owner, at)` decides the earliest ready time; checkout stamps `Order.ready_not_before`; dispatch and the rider job list ignore an order before then. Platform hours (`delivery/config.py` `LIMIT_DEFAULTS` `opens_at`/`closes_at`, 07:00–20:00) remain the fallback while a business has no hours.

**Tech Stack:** Django/DRF (`accounts`, `orders`, `delivery`), React business dashboard and registration flow.

**Spec:** owner ruling 2026-10-18 (memory `wallet-owner-decisions-2026-10-18`): "vendors/businesses always put their opening and closing time … purchases outside their closing time will have delivery done the following day or next business opening day." Time zone: Africa/Accra (UTC+0, no DST).

## Global Constraints

- All hours are stored as local clock times in Africa/Accra; compare in Accra time.
- Multi-vendor cart: the order is ready at the **latest** `next_open` among its vendors (one rider run, multi-stop).
- Services, events and stays are bookings, not deliveries: hours do not defer them.
- Customer is told before paying ("Delivery from Tue 08:00") — no surprise after payment.
- No fabricated data: a business with no hours set shows "Hours not set" and uses the platform fallback silently only for dispatch, never displayed as its own hours.

## Review Focus

- Order placed at 19:59 vs 20:00 on a closing time of 20:00 (boundary: closed at exactly closing time).
- Business closed all day on a weekday (e.g. Sunday): next open is Monday.
- Business with every day closed: registration/save refused ("open at least one day").
- Overnight hours (opens 18:00, closes 02:00): refused in v1 with a clear message, not silently wrong.
- Multi-vendor cart where one vendor is open and one closed.
- Vendor edits hours after an order is placed: the placed order keeps its stamped `ready_not_before`.

---

### Task 1: BusinessHours model and pure scheduling

**Files:**
- Create: `backend/accounts/hours.py`, migration `backend/accounts/migrations/NNNN_business_hours.py`
- Modify: `backend/accounts/models.py` (add `BusinessHours`)
- Test: `backend/accounts/tests/test_hours.py`

**Interfaces:**
- Produces: `BusinessHours(business_owner FK, weekday 0-6, opens TimeField null, closes TimeField null, closed bool)` unique on (owner, weekday).
  `hours.set_week(owner, days: list[{weekday, closed, opens, closes}]) -> None` raises `HoursError` unless all 7 weekdays present, each open day has `opens < closes`, at least one day open.
  `hours.is_open(owner, at) -> bool`; `hours.next_open(owner, at) -> datetime` (returns `at` when open now; Accra tz-aware); `hours.has_hours(owner) -> bool`.

- [ ] **Step 1: Failing tests** for each Review Focus boundary: `test_closed_at_exact_closing_time`, `test_closed_sunday_rolls_to_monday`, `test_all_days_closed_refused`, `test_overnight_refused`, `test_open_returns_same_instant`, `test_no_hours_uses_platform_fallback` (`next_open` uses `delivery.config` limits).
- [ ] **Step 2: Run** `... test accounts.tests.test_hours` — Expected: FAIL.
- [ ] **Step 3: Implement** model, migration and `hours.py`.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat(accounts): structured business opening hours and next_open`

### Task 2: Collect hours (API, registration, dashboard) and migrate old text

**Files:**
- Modify: business serializers/views in `accounts` (find the BusinessOwner profile endpoint), `frontend/BusinessRegistrationFlow` and the business dashboard profile tab
- Create: `backend/accounts/management/commands/report_missing_hours.py`
- Test: `backend/accounts/tests/test_hours_api.py`, `frontend/BusinessRegistrationFlow.test.jsx` additions

**Interfaces:**
- Produces: `GET/PUT /api/accounts/business/hours/` (owner only) body `{days:[{weekday,closed,opens,closes}]}`; registration cannot submit for approval without hours (400 `hours_required`); a listing of an existing business without hours stays visible but the dashboard shows a blocking-style prompt; `report_missing_hours` prints businesses lacking hours so Support can chase.

- [ ] **Step 1: Failing tests:** `test_put_hours_saves_and_returns`, `test_put_invalid_returns_400_with_message`, `test_registration_requires_hours`, `test_other_owner_cannot_edit`; frontend: `registration blocks Next until hours entered`, `dashboard shows "Hours not set" prompt`.
- [ ] **Step 2: Run** backend then `cd frontend && npm run test -- BusinessRegistrationFlow` — Expected: FAIL.
- [ ] **Step 3: Implement** endpoints and UI (seven rows, "Closed" toggle, copy-Monday-to-weekdays shortcut). Leave `opening_hours` text readable but stop writing it.
- [ ] **Step 4: Run** both suites — Expected: PASS.
- [ ] **Step 5: Commit** `feat: businesses must enter weekly opening hours`

### Task 3: Stamp orders and hold delivery until opening

**Files:**
- Modify: `backend/orders/models.py` (+ migration `ready_not_before` DateTimeField null), checkout creation in `orders/` (locate where the paid order is created), `delivery/` dispatch candidate selection and the rider job list, cart/checkout quote response
- Test: `backend/orders/tests/test_after_hours.py`, `backend/delivery/tests/test_after_hours_dispatch.py`

**Interfaces:**
- Consumes: `hours.next_open(owner, at)`.
- Produces: `Order.ready_not_before` (null = ready now); checkout quote returns `delivery_from` ISO time and `deferred: bool`; dispatch skips orders with `ready_not_before > now`; a beat task `release_deferred_orders` (every 5 min) triggers dispatch for orders whose time has arrived.

- [ ] **Step 1: Failing tests:** `test_order_after_closing_is_stamped_next_open`, `test_multi_vendor_uses_latest_open`, `test_open_order_not_stamped`, `test_dispatch_ignores_deferred_order`, `test_deferred_order_dispatches_after_time`, `test_vendor_hours_edit_does_not_move_placed_order`, `test_quote_reports_delivery_from`.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.** Pickup-in-store orders are not deferred (customer collects within the pickup window; the pickup clock starts at `ready_not_before` if set — add to `ledger/verification.py` pickup window start, with a test `test_pickup_window_starts_at_opening`).
- [ ] **Step 4: Run** `... test orders delivery ledger` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(orders,delivery): hold delivery until the vendor next opens`

### Task 4: Customer-facing notice

**Files:** Modify `frontend/components/CartDrawer.jsx` and the order confirmation/tracking view; Test: matching `__tests__`.

- [ ] **Step 1: Failing tests:** `cart shows "Delivery from <day time>" when deferred`, `no notice when open`, `tracking shows scheduled start`.
- [ ] **Step 2: Run** `cd frontend && npm run test -- CartDrawer` — Expected: FAIL.
- [ ] **Step 3: Implement** the line using `delivery_from`; copy: "Shop is closed now. Delivery starts <Tue 08:00>."
- [ ] **Step 4: Run** tests + `npm run build` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(frontend): after-hours delivery notice`
