# Wallet Rulings 7B-2: Hours for Scout Onboarding, Early-Send Override, Scheduled List — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the three open points of the 7B build with the owner's answers of 2026-10-19: scout-onboarded businesses must enter hours; managers can send a rider early to a held order; managers get a Scheduled list of held orders. Existing live shops without hours are NOT blocked (they keep the "Hours not set" prompt and the platform window).

**Architecture:** Builds on plan 7B (`docs/superpowers/plans/2026-10-18-wallet-rulings-7b-opening-hours.md`, branch feature/wallet-rulings-7b-r): `BusinessHours`, `hours.next_open`, `Order.ready_not_before`, the 7B hold in dispatch (`AssignDispatchView`/`services.assign` answer 409 while an order is held), `scheduled_count` in the dispatch queue/board payload, and `accounts/claims.py` (the scout-onboarded claim path, currently not gated on hours; `report_missing_hours` lists such businesses).

**Tech Stack:** Django/DRF (`accounts`, `delivery`, `orders`), React (staff dispatch/delivery panels).

**Spec:** docs/superpowers/specs/2026-10-15-wallet-fees-security-design.md (§ opening hours, owner ruling 2026-10-18); owner answers 2026-10-19 recorded in memory `wallet-owner-decisions-2026-10-18`.

## Global Constraints

- A shop already live without hours is never blocked or hidden; it shows "Hours not set" and dispatch uses the platform window.
- A held order is released early only by a person with the dispatch/delivery-manager permission, with a reason of 3+ characters, recorded in the activity log with who/when/why; the order's customer-facing "delivery starts" time is updated and the customer is told.
- No fabricated data in the UI; frontend conventions in `frontend/CLAUDE.md` (plain `apiPost`, no `useMutation`, hooks own data).

## Review Focus

- A scout claim/onboarding that submits without hours: refused with the same `hours_required` 400 as registration; an existing hourless business that is later claimed through the scout path is refused until hours are added.
- Early send on an order whose vendor is still closed: allowed with a reason; on an order that is not held: 409; twice: second call is a no-op.
- A cancelled or refunded held order cannot be sent early.
- The Scheduled list shows only held (`ready_not_before` in the future) paid orders, soonest first, paginated; it never lists unpaid orders.

---

### Task 1: Scout-onboarded businesses must enter hours

**Files:** Modify `backend/accounts/claims.py` (the scout-onboarded claim/registration submit), the scout onboarding frontend form (find via `grep -rn "hours_required\|BusinessHours" frontend/`), `report_missing_hours` command if it should drop claimed businesses with hours; Test: `backend/accounts/tests/test_claims_hours.py`, frontend test beside the form.

- [ ] **Step 1: Failing tests:** `test_scout_claim_without_hours_is_400_hours_required`, `test_scout_claim_with_hours_creates_businesshours`, `test_existing_hourless_live_business_is_not_blocked_from_dashboard` (regression), frontend `scout form requires the weekly hours editor before submit`.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** reusing the 7B hours validation and editor component; no backfill.
- [ ] **Step 4: Run** `... test accounts` and `cd frontend && npx vitest run <form test>` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(accounts): scout-onboarded businesses must enter opening hours`

### Task 2: Managers can send a rider early to a held order

**Files:** Modify `backend/delivery/services.py` (`assign`), `backend/delivery/views*.py` (`AssignDispatchView` and a new `ReleaseHeldOrderView`), `backend/orders` notify path, activity log; Test: `backend/delivery/tests/test_early_send.py`; frontend: the manager's assign UI (find via `grep -rn "assign" frontend/components/admin/panels/delivery`).

**Interfaces:** `POST /api/delivery/orders/<id>/send-early/ {reason}` (permission: the existing assign/manager permission) sets `Order.ready_not_before = now`, logs `delivery.early_send`, notifies the customer ("Your order is being sent now"), then the normal assign works; `services.assign` keeps its 409 while held.

- [ ] **Step 1: Failing tests:** `test_send_early_releases_a_held_order_and_logs_who_and_why`, `test_reason_under_3_chars_400`, `test_not_held_order_409`, `test_second_call_is_noop`, `test_cancelled_or_refunded_order_refused`, `test_assign_after_send_early_works`, `test_requires_the_manager_permission`; frontend `shows Send now with a reason box on a held order`.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** with the order row lock in the canonical order other write paths use.
- [ ] **Step 4: Run** `... test delivery orders` and the frontend test — Expected: PASS.
- [ ] **Step 5: Commit** `feat(delivery): managers can send a rider early to a held order`

### Task 3: Scheduled list of held orders

**Files:** Modify `backend/delivery/` queue/board views (the payload that carries `scheduled_count`), add `GET /api/delivery/scheduled/` paginated; frontend manager panel tab "Scheduled"; Test: `backend/delivery/tests/test_scheduled_list.py`, frontend `__tests__`.

- [ ] **Step 1: Failing tests:** `test_lists_only_paid_held_orders_soonest_first`, `test_released_and_unpaid_orders_not_listed`, `test_paginated_and_matches_scheduled_count`, `test_requires_manager_permission`; frontend `Scheduled tab lists orders with the vendor's next opening and a Send now button`.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** the endpoint and tab (reuse Task 2's Send now).
- [ ] **Step 4: Run** the suites and `npm run build` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(delivery): Scheduled list of held orders`

### Task 4: Spec note

- [ ] **Step 1:** Record the three owner answers in the spec's opening-hours gate (`docs/superpowers/specs/2026-10-15-wallet-fees-security-design.md`). **Step 2: Commit** `docs(wallet): opening-hours follow-up rulings`.
