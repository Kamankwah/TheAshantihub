# Wallet Rulings 7E: Milestone Release (Services, Stays, Tickets) and Cancellation Policies — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single "72 hours after hand-over, then Support's call" rule for services, stays and event tickets with the marketplace model the owner chose: a release milestone per kind (Fiverr-style acceptance for services, Airbnb-style check-in window for stays, Eventbrite-style after-event release for tickets) and vendor-chosen cancellation policies for refunds.

**Architecture:** `ledger/sales.py` already has `BookingSale` (kinds service/stay/tickets), `handed_over_at`, `customer_confirmed`, `has_open_dispute` and `BookingRefund`. This plan adds one function, `sales.release_at(sale)`, per kind; an hourly job releases due, undisputed sales; a customer "accept" door releases a service early; and `CancellationPolicy` drives refund amounts before the milestone. Products are untouched (they keep Support's verification call and `verification_overdue_hours`).

**Tech Stack:** Django/DRF (`ledger`, `bookings`, `services`, `events`), Celery beat, React customer and business dashboards.

**Spec:** `docs/superpowers/specs/2026-10-15-wallet-fees-security-design.md` §4.2 (amended by this plan). Rulings: memory `wallet-owner-decisions-2026-10-18` (owner adopted the milestone model 2026-10-18; service auto-accept = event release delay = 2 days). Depends on Plan 7A T1 (settings) and replaces 7C T2's timer with `sales.release_at` for tickets (implement `release_at` once, here; 7C T2 calls it).

## Global Constraints

- Defaults: `service_auto_accept_hours` 48, `stay_issue_window_hours` 24, `event_release_delay_hours` 48 (all Super Admin editable, Plan 7A).
- Release milestone per kind: **service** = vendor marks done (`service_request.completed_at`) + auto-accept hours, or the customer's explicit accept, whichever is first; **stay** = scheduled check-in time (`booking.check_in` date at the listing's check-in time, default 14:00 Accra) + issue window; **tickets** = event end + release delay.
- An open dispute on the sale (`has_open_dispute`) blocks release until settled; a customer problem report inside the window opens a dispute (existing `disputes` flow).
- A refund before the milestone follows the cancellation policy; after the milestone it is a dispute, not a cancel.
- Policy applied is **snapshotted on the sale at payment**; later vendor edits never change a sale already paid.
- Support's verification call remains available as an early release for these kinds but is no longer required.
- No fabricated data in the UI: the customer sees the exact release/acceptance time and the policy text before paying.

## Review Focus

- Customer accepts a service at hour 47 vs the timer firing at hour 48: released once, never twice (idempotent posting key).
- Service marked done, then the vendor edits the price or marks undone: release time stays tied to `completed_at` at the time; undoing before acceptance clears the clock.
- Stay cancelled exactly at the policy cut-off instant (flexible: 24h before check-in): the boundary favours the guest.
- Guest never arrives (no-show): host is released at check-in + window under the policy (no refund after check-in time).
- Stay with check-in date changed after booking: milestone follows the new date only if the guest agreed (booking edit flow); otherwise old date.
- Event postponed or cancelled: handled in 7C T2; policy refund does not apply to a cancelled event (full refund).
- Sale with an open dispute when the timer fires: skipped, released later when the dispute closes in the vendor's favour.
- Policy-less legacy listings: default `flexible`, applied from the migration date only to new sales.

---

### Task 1: `release_at` per kind and the hourly release job

**Files:**
- Modify: `backend/ledger/sales.py` (`handed_over_at`, `customer_confirmed`, overdue logic at ~272), `backend/ledger/views_bookings.py:42`, `backend/ledger/verification.py:83,109` (stop using `verification_overdue_hours` for these kinds), `backend/ledger/tasks.py`
- Test: `backend/ledger/tests/test_release_at.py`

**Interfaces:**
- Produces: `sales.release_at(sale) -> datetime | None` (None until the milestone exists, e.g. service not yet marked done); `sales.customer_accepted(sale) -> bool` (field below); `sales.release_due(now=None) -> int` releasing every sale with `release_at <= now`, not released, not reversed, no open dispute, via the existing release path (`escrow` booking release) keyed idempotently; Celery beat `ledger.release_due_booking_sales` hourly.
- `BookingSale.customer_accepted_at` DateTimeField(null) added with migration.

- [ ] **Step 1: Failing tests:** one per Review Focus line for release timing: `test_service_releases_48h_after_done`, `test_service_not_released_before_done`, `test_undone_service_clears_clock`, `test_accept_then_timer_releases_once`, `test_stay_releases_24h_after_check_in_time`, `test_no_show_stay_releases_after_window`, `test_ticket_release_matches_7c`, `test_open_dispute_blocks_timer`, `test_settings_change_applies_to_unreleased_sales`.
- [ ] **Step 2: Run** `... test ledger.tests.test_release_at` — Expected: FAIL.
- [ ] **Step 3: Implement** `release_at` reading the Plan 7A settings; the job calls the existing release function inside its row lock.
- [ ] **Step 4: Run** `... test ledger events bookings services` — Expected: PASS (update tests that expected the 72h/Support-call rule for these kinds).
- [ ] **Step 5: Commit** `feat(ledger): release services, stays and tickets on their own milestone`

### Task 2: Customer accepts a service, or reports a problem

**Files:**
- Modify: `backend/services/views.py` (customer endpoints; locate the service-request detail view), `backend/disputes/` (open from a sale), `frontend` customer order/booking view
- Test: `backend/services/tests/test_accept.py`, frontend `__tests__`

**Interfaces:** `POST /api/services/requests/<id>/accept/` (customer only; only after `completed_at`; sets `customer_accepted_at`, releases at once, idempotent); `POST .../report-problem/ {reason}` opens a dispute on the sale (reuses `sale.dispute`) and notifies Support; both answered 409 after release. Stay and ticket sales get `report-problem` only, within their windows.

- [ ] **Step 1: Failing tests:** `test_accept_releases_once`, `test_accept_before_done_409`, `test_other_customer_403`, `test_report_opens_dispute_and_blocks_timer`, `test_report_after_release_409`; frontend: `shows Accept and Report buttons with the auto-accept time`, `hides them after release`.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** doors and UI; copy states the exact auto-accept time ("Accepts automatically on Fri 14:05 unless you report a problem").
- [ ] **Step 4: Run** backend and `cd frontend && npm run test` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(services): customer accepts or reports a delivered service`

### Task 3: Cancellation policies

**Files:**
- Create: `backend/ledger/cancellation.py`, migration adding `CancellationPolicy` choice fields
- Modify: `backend/bookings/models.py` and `backend/services/models.py` (listing-level `cancellation_policy`), `BookingSale` (`policy_snapshot` JSON), `ledger/sales.py` payment creation, `ledger/sales.py:cancel`
- Test: `backend/ledger/tests/test_cancellation_policy.py`

**Interfaces:**
- Produces: policies as data in `cancellation.POLICIES`: `flexible` (full refund until 24 h before start), `moderate` (full until 5 days before, 50% until 24 h before), `strict` (50% until 7 days before, none after); `cancellation.refund_share(policy, start, at) -> int` basis points (10000 = whole); `sales.cancel_by_customer(sale, now) -> BookingRefund` refunding `base * share` plus its proportional fee back via the existing refund path. Boundary instant favours the customer. Snapshot stored on the sale when paid. Tickets use the organiser's stated policy default `no refunds after purchase except cancelled event` (policy `none`, plus an optional `until_days_before` for organisers who offer refunds).
- Customer door: `POST /api/bookings/<id>/cancel/` (customer) using the sale's snapshot.

- [ ] **Step 1: Failing tests:** `test_flexible_boundary_favours_guest`, `test_moderate_two_tiers`, `test_strict_half_then_none`, `test_snapshot_survives_policy_edit`, `test_refund_conserves_money_with_fee_share`, `test_cancel_after_milestone_409_dispute_instead`.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement**; default new listings to `flexible`; legacy sales have no snapshot and keep Support-only cancellation.
- [ ] **Step 4: Run** `... test ledger bookings services` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(ledger): vendor-chosen cancellation policies with snapshotted refunds`

### Task 4: Policy and timing shown before paying; vendor picks the policy

**Files:** Modify business listing forms (`AddListingForm.jsx` and service/stay/event editors) for policy choice, and the checkout/booking confirm screens; Test: matching frontend `__tests__`.

- [ ] **Step 1: Failing tests:** `listing form requires a policy for stays and services`, `checkout shows policy summary and release timing`, `no policy shown for products`.
- [ ] **Step 2: Run** `cd frontend && npm run test -- ListingForm` — Expected: FAIL.
- [ ] **Step 3: Implement** policy select with the plain-language rule under each option; checkout line "Free cancellation until <time>".
- [ ] **Step 4: Run** tests + `npm run build` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(frontend): choose and show cancellation policies`

### Task 5: Spec amendment

**Files:** Modify spec §4.2 and §13 gate (lvii): replace "72 h from hand-over" with the milestone table above and mark (lvii) decided 2026-10-18; list the three new settings in §3.3.

- [ ] **Step 1:** Edit; no code. **Step 2:** `git diff --stat` shows only the spec. **Step 3: Commit** `docs(wallet): milestone release replaces the 72-hour window for bookings`
