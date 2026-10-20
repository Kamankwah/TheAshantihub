# Wallet Rulings 7B-3: Staff Hours Screen and Scheduled Tab Access — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Owner answers 2026-10-19 on the 7B-2 report: (1) build a staff screen to enter a business's weekly opening hours (replacing the `manage.py set_business_hours` command as the way to unblock hourless scout businesses); (3) make the Scheduled list reachable from the `orders.manage_delivery` panel as well, and show Send now only to users who can use it.

**Architecture:** Builds on 7B and 7B-2 (this branch). Backend: `BusinessHours` and the hours validation/serializer from 7B (`accounts/hours.py`), the claim path in `accounts/claims.py`, the `set_business_hours` command from 7B-2 (keep it), staff business endpoints and permissions (`businesses.manage_portfolio` / `portfolio.manage`, `accounts` staff views). Frontend: the staff business/portfolio panels and the delivery manager panels (`DeliveryManagerPanel`, the Scheduled tab).

**Spec:** docs/superpowers/specs/2026-10-15-wallet-fees-security-design.md (opening hours); plan 7B and 7B-2 in docs/superpowers/plans/.

## Global Constraints

- Staff set hours through the same validation as owners (opens before closes, no overnight, 7 days); a change is recorded in the activity log (who/when, old/new) and takes effect for new orders only.
- Only roles that may manage the business/portfolio (the existing permission used for staff edits of a business) can set hours; the owner's own edit path is unchanged.
- No fabricated data; frontend conventions in `frontend/CLAUDE.md`; staff nav in `components/admin/shell/navModel.js`.

## Review Focus

- A scout business with no hours that is blocked from claim becomes claimable right after staff set hours (end-to-end test).
- Staff cannot set hours through an owner-only endpoint and an owner cannot use the staff endpoint on another business.
- The Scheduled tab data/permissions: a user holding only `orders.manage_delivery` sees the list and can Send now; a user holding neither sees neither; a user with only a read permission sees the list without Send now.

---

### Task 1: Staff endpoint and screen to enter a business's hours

**Files:** Modify `backend/accounts/` (a staff endpoint `PUT /api/staff/businesses/<id>/hours/` next to the existing staff business views; reuse the 7B hours serializer), activity log; frontend: a "Opening hours" editor in the staff business detail panel (reuse the 7B weekly hours editor component), a "Hours not set" filter/badge in the staff businesses list; Test: `backend/accounts/tests/test_staff_hours.py`, frontend `__tests__`.

- [ ] **Step 1: Failing tests:** `test_staff_can_set_hours_for_an_hourless_business_and_it_is_logged`, `test_invalid_week_400_with_the_failing_day`, `test_permission_required`, `test_owner_endpoint_cannot_edit_another_business`, `test_blocked_scout_claim_becomes_claimable_after_staff_set_hours`, frontend `staff editor saves hours and shows the saved week`, `badge and filter list hourless businesses`.
- [ ] **Step 2: Run** — Expected: FAIL. **Step 3: Implement.**
- [ ] **Step 4: Run** `... test accounts` and `cd frontend && npx vitest run <paths>` — Expected: PASS. **Step 5: Commit** `feat(accounts): staff can enter a business's opening hours`.

### Task 2: Scheduled tab reachable from the manage-delivery panel; Send now only for those who can use it

**Files:** Modify the nav model and panels (`frontend/components/admin/shell/navModel.js`, `DeliveryManagerPanel`, the Scheduled panel), backend permission on the scheduled list endpoint to accept `orders.manage_delivery` as well as `delivery.manage` (read), send-early stays on the assign permission; hide Send now unless the user holds that permission; Test: backend `delivery/tests/test_scheduled_access.py`, frontend `navModel.test.js` + panel tests.

- [ ] **Step 1: Failing tests:** backend `test_manage_delivery_only_user_can_list_and_send_early`, `test_read_only_user_can_list_but_not_send_early_403`, `test_user_with_neither_gets_403`; frontend `scheduled tab appears for orders.manage_delivery`, `send now hidden without the permission`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** `... test delivery orders` + frontend — PASS. **Step 5: Commit** `feat(delivery): Scheduled list reachable from the manage-delivery panel`.

### Task 3: Record decisions

- [ ] Note in the spec's opening-hours gate: staff screen replaces the command; Scheduled access; commit `docs(wallet): hours staff screen and scheduled access`.
