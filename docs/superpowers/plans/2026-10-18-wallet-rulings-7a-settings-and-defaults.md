# Wallet Rulings 7A: Governed Settings, Suggested Defaults and the Super Admin Page — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every number the owner left open becomes a governed setting with a suggested default, editable by a Super Admin from one "Money rules" page.

**Architecture:** The backend already has `ledger/settings_store.py` (`DEFINITIONS`, `current`, `clean`), the `ledger.setting` and `ledger.fee_rules` approval kinds, and `GET/POST /api/ledger/settings/` plus `GET/POST /api/ledger/fees/` (`ledger/views.py`). Nothing in `frontend/` calls them yet. This plan adds the missing definitions, seeds suggested fee tiers and a delivery rate card, and builds the page.

**Tech Stack:** Django/DRF (`ledger`, `delivery`), React (flat `frontend/`, inline `C` palette, plain `apiPost`/`apiGet` in handlers, no `useMutation`).

**Spec:** `docs/superpowers/specs/2026-10-15-wallet-fees-security-design.md` (§3.3 governed settings, §12 numbers owed). Owner rulings: memory `wallet-owner-decisions-2026-10-18`.

## Global Constraints

- Money is integer pesewas; basis points: 100 = 1%.
- A setting is read only through `settings_store.current(key, at)`; written only by the `ledger.setting` approval `apply`. A Super Admin's own change applies directly, anyone else's is queued for a Super Admin (existing `_submit` behaviour). Do not add a second write path.
- Fee rule sets are never edited; a change is a new `FeeRuleSet` with a later `effective_from`.
- Cooling period never below 1 hour (existing minimum); top-up hold never below 60 minutes (owner: "at least 1 hour").
- No fabricated data in the UI: a setting with no row shows its built-in default labelled "default", not as if someone set it.
- Run Vitest from `frontend/`; backend `docker compose run --rm web python manage.py test <app>`.

## Review Focus

- A pending change for a key blocks a second one (409) — the page must show the pending request, not an error toast only.
- Daily limit below per-withdrawal limit is refused (`check_limits`) — the page shows that message beside the field.
- Fee ladder with a gap or overlap is refused (`fees.validate_bands`) — the editor shows the message and queues nothing.
- A setting changed with a future `effective_from` shows both the value now and the scheduled one.
- Seeding the rate card twice creates one live card, not two (`one_live_rate_card` constraint).

---

### Task 1: New governed settings

**Files:**
- Modify: `backend/ledger/settings_store.py` (add to `DEFINITIONS`)
- Modify: `backend/ledger/approval_kinds.py:150-165` (route new keys' pool, as `WALLET_SETTING_KEYS` does)
- Test: `backend/ledger/tests/test_settings_store.py`

**Interfaces:**
- Produces (keys, all integers, default / min / max):
  `wallet_topup_hold_minutes` 60 / 60 / 10080 — minutes a top-up stays unwithdrawable (read by 7C T3);
  `vendor_low_balance_pesewas` 10_000 / 0 / 10**10 — Available at or below this triggers the low-balance text (read by 7D T3);
  `digest_batch_size` 200 / 10 / 5000 and `digest_time_budget_seconds` 600 / 30 / 3600 (read by 7D T4);
  `otp_daily_failure_cap` 20 / 5 / 200 — wrong codes per account per Accra day (read by 7C T6);
  `service_auto_accept_hours` 48 / 1 / 720 — hours after a vendor marks a service delivered before it is accepted automatically (7E);
  `stay_issue_window_hours` 24 / 1 / 168 — hours after check-in time in which a guest can report a problem; money releases when it ends (7E);
  `event_release_delay_hours` 48 / 1 / 720 — hours after an event ends before ticket money releases (7C T2).
  `verification_overdue_hours` (72) now applies to **products only**; relabel its `Definition` text accordingly and stop reading it for services, stays and tickets (7E T1 switches those callers: `ledger/sales.py:272`, `ledger/views_bookings.py:42`, `ledger/verification.py:83,109`).

- [ ] **Step 1: Write failing tests** `test_new_keys_have_defaults_and_bounds`: for each key assert `current(key) == default`, `clean(key, min-1)` raises `SettingError`, `clean(key, max+1)` raises, `clean(key, "60")` returns 60. `test_topup_hold_cannot_go_below_sixty`: `clean("wallet_topup_hold_minutes", 59)` raises.
- [ ] **Step 2: Run** `... test ledger.tests.test_settings_store` — Expected: FAIL (`Unknown money setting`).
- [ ] **Step 3: Add the five `Definition`s**; add them to the wallet-pool tuple in `approval_kinds.py` so approval routing matches the other wallet settings.
- [ ] **Step 4: Run again** — Expected: PASS; also `... test ledger` all green.
- [ ] **Step 5: Commit** `feat(ledger): governed settings for top-up hold, low balance, digest batching, OTP daily cap`

### Task 2: Suggested fee tiers and a default delivery rate card

**Files:**
- Create: `backend/ledger/migrations/0005_suggested_service_event_fees.py` (use the next free number)
- Create: `backend/delivery/management/commands/seed_default_rate_card.py`
- Test: `backend/ledger/tests/test_seed_fees.py`, `backend/delivery/tests/test_seed_rate_card.py`

**Interfaces:**
- Produces: new `FeeRuleSet` rows for `service` and `event` with `effective_from` = migration time, `approval_id=None`, `created_by=None`. Suggested tiers (owner approved "suggest a figure"; Super Admin edits them later):
  - service: 0–49,999 → 200 bp (2%); 50,000–499,999 → 150 bp; 500,000+ → 100 bp.
  - event (tickets): 0–9,999 → 300 bp; 10,000–99,999 → 250 bp; 100,000+ → 200 bp.
  Products keep the existing seeded ladder.
- Produces: `manage.py seed_default_rate_card` creating one **live** `delivery.RateCard`, GH₵: customer_base 5.00, customer_per_km 1.50, customer_min_fee 8.00, rider_per_job 4.00, rider_per_km 1.00; other fields model defaults. No-op if a live card exists. Run on staging only after the owner sees the figures; `DELIVERY_FEE_ENABLED` stays as is.

- [ ] **Step 1: Failing tests.** `test_service_fee_ladder`: after migrate, `fees.quote("service", 30_000, cap=None, already_charged=0).charged == 600`; `quote("service", 100_000...) == 1500`; `quote("event", 5_000...) == 150`; `quote("product", ...)` unchanged from the old ladder. `test_seed_command_is_idempotent`: run twice, `RateCard.objects.filter(status="live").count() == 1`.
- [ ] **Step 2: Run both** — Expected: FAIL.
- [ ] **Step 3: Write the migration** (RunPython with reverse deleting only rows it created) and the command (skip when a live card exists; respect `ConfigVersion` fields — read `delivery/models.py` `ConfigVersion` for required status/effective fields).
- [ ] **Step 4: Run tests + `makemigrations --check`** — Expected: PASS, no drift.
- [ ] **Step 5: Commit** `feat(ledger,delivery): suggested service/event fee tiers and default rate card seed`

### Task 3: "Money rules" page for Super Admin

**Files:**
- Create: `frontend/components/admin/panels/MoneyRulesPanel.jsx`, `frontend/hooks/useMoneyRules.js`
- Modify: the Super Admin panel registry (find where `AuditChainPanel` / `ApprovalRulesPanel` are registered and add "Money rules" with the permission `wallets.manage`/`ledger` view the API already checks — read `ledger/views.py` `VIEW`/`MANAGE`)
- Test: `frontend/components/admin/panels/__tests__/MoneyRulesPanel.test.jsx`, extend `frontend/mocks/handlers.js` with `GET/POST /api/ledger/settings/` and `/api/ledger/fees/`

**Interfaces:**
- Consumes: `GET /api/ledger/settings/` → `{settings:[{key,label,value,nullable,minimum,maximum}], pending, history}`; `POST` `{key,value,effective_from?,note?}`; `GET/POST /api/ledger/fees/` (`{category, bands:[{lower,upper,percent_bp,flat}], effective_from, note}`).
- Produces: `useMoneyRules()` returning `{settings, pending, history, fees, refetch}`.

- [ ] **Step 1: Failing tests.** `renders every setting with its label and value`; `edit queues a POST with key and value and shows pending row`; `a 409 shows "already waiting for approval" beside the field`; `fee editor refuses a gap and shows the server message`; `shows the built-in default flagged "default" when history is empty`.
- [ ] **Step 2: Run** `cd frontend && npm run test -- MoneyRulesPanel` — Expected: FAIL (module missing).
- [ ] **Step 3: Implement** grouped sections (Fees, Windows and holds, Withdrawal limits, Rider, Texts, Stock, Security) by key prefix; a fee-tier editor per category showing bands in GH₵ (convert pesewas↔cedis at the edge only); handler pattern per `frontend/CLAUDE.md`. Note the existing delivery rate card has its own editor (`delivery/ConfigScreen.jsx`): link to it, do not duplicate.
- [ ] **Step 4: Run** the new tests and `npm run build` — Expected: PASS, build clean.
- [ ] **Step 5: Commit** `feat(frontend): Super Admin Money rules page`
