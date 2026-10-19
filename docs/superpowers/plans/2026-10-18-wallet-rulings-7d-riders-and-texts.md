# Wallet Rulings 7D: Rider Pay on Refunds, Rider Event Amounts and Vendor Texts — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pay a third-party rider for a trip made before a refund, show amounts in rider withdrawal events, extend vendor money texts, make the digest batch-safe, and record every ruling in the spec.

**Architecture:** Rider crediting lives in `ledger/riders.py` (`credit_delivery`, `reverse_earning`) and refunds in `ledger/refunds.py` (`refund_order`, `_delivery_made`); vendor texts in `wallets/vendor_texts.py`. Settings from Plan 7A T1.

**Tech Stack:** Django, Celery beat.

**Spec:** `docs/superpowers/specs/2026-10-15-wallet-fees-security-design.md` §6, §7, gates (xciii), (xcix), (c), (lxxxi), (lxxxvii)–(lxxxix). Rulings: memory `wallet-owner-decisions-2026-10-18`. Depends on Plan 7A T1.

## Global Constraints

- "A trip" = the rider **picked up** the goods and was delivering (pickup with delivery). A rider merely assigned earns nothing. Rider pay still waits for Support's verification call (gate (c)); a refund before release pays the rider from the delivery fee at refund time, since the call will never happen.
- The rider's share on refund = the delivery fee the rider earns under the existing 90/10 split (`ledger.riders.split`); the remainder of the delivery fee goes back to the customer with the refund.
- A suspended business (`BusinessOwner.is_suspended`) gets no money texts; in-app notifications are unaffected.
- Texts use the idempotent queue keys (`queue(owner, kind, key, body, …)`) so a retry never doubles a text.

## Review Focus

- Whole refund before pickup: rider (assigned only) paid 0, customer gets the whole delivery fee back.
- Whole refund after pickup, before delivery completes: rider paid, remainder to customer.
- Refund after release: existing `reverse_earning` behaviour unchanged.
- Partial refund of goods only: delivery fee untouched, rider unaffected.
- Business suspended between order and release: no release text; unsuspended later: no backfilled flood.
- Digest run killed at 07:00 and restarted at 09:00: each business gets exactly one digest for the day.

---

### Task 1: Pay the rider for a trip made before a refund

**Files:** Modify `backend/ledger/refunds.py` (`_delivery_made`, `_post`, ~200-310), `backend/ledger/riders.py` (add `credit_on_refund`); Test: `backend/ledger/tests/test_rider_refund_pay.py`

**Interfaces:**
- Produces: `riders.rider_picked_up(order) -> bool` (true once the delivery job shows pickup done — read `delivery` job status fields); `riders.credit_on_refund(order, now) -> int` (pesewas paid; 0 when not third-party or not picked up), called from `refund_order` for a **whole** refund before release, inside the refund transaction and keyed `rider-refund-{order.pk}` (idempotent). The customer's refund excludes the rider share.

- [ ] **Step 1: Failing tests:** the four Review Focus refund cases plus `test_credit_is_idempotent_on_retry` and `test_in_house_rider_not_credited`.
- [ ] **Step 2: Run** `... test ledger.tests.test_rider_refund_pay` — Expected: FAIL.
- [ ] **Step 3: Implement**; reuse `riders.accounts_of`/`split`; conserve money (journal balances).
- [ ] **Step 4: Run** `... test ledger delivery` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(ledger): pay a third-party rider for a trip made before a refund`

### Task 2: Rider withdrawal events show the amount

**Files:** Modify the activity-event writer for rider withdrawals (grep `activity` calls in `wallets/views_rider_wallet.py` / `withdrawals.py`) and `wallets/views_staff.py` `staff_row`; Test: `backend/wallets/tests/test_rider_events_amount.py`

- [ ] **Step 1: Failing test:** `test_rider_withdrawal_event_carries_amount` (event detail contains the GH₵ amount) and `test_staff_without_wallets_view_can_read_event_amount_per_policy` (Operations and line managers see it, per owner "it should show the amount").
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Add the amount** to the event payload; never include the payout number (`mask_numbers`).
- [ ] **Step 4: Run** `... test wallets activity` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(wallets): rider withdrawal events show the amount`

### Task 3: More vendor texts; none to suspended businesses

**Files:** Modify `backend/wallets/vendor_texts.py` (add builders/triggers beside `order_released`), call sites in `ledger/refunds.py` (refund), `wallets/withdrawals.py` (requested/paid/failed), `ledger/posting.py` hook or the vendor-balance code (negative or low Available); Test: `backend/wallets/tests/test_vendor_texts_more.py`

**Interfaces:** Produces `vendor_texts.refund_text(order, owner, amount)`, `vendor_texts.withdrawal_text(withdrawal, state)`, `vendor_texts.balance_text(owner, available, kind)` with `kind in {"negative","low"}`; each enqueued through `queue()` with keys `refund-{order}-{owner}`, `withdrawal-{id}-{state}`, `balance-{owner}-{kind}-{accra_day}` (at most one balance text per kind per day). Low = Available ≤ `vendor_low_balance_pesewas`. Every builder first returns early when `owner.is_suspended`.

- [ ] **Step 1: Failing tests:** `test_refund_text_queued_once`, `test_withdrawal_states_each_text_once`, `test_negative_balance_text_once_per_day`, `test_low_balance_threshold_setting`, `test_suspended_owner_gets_no_text_but_in_app_notice_kept`.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** with copy under the 160-char `fits()` limit and no payout numbers.
- [ ] **Step 4: Run** `... test wallets` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(wallets): vendor texts for refunds, withdrawals and balance warnings`

### Task 4: Digest batching, time budget and catch-up

**Files:** Modify `backend/wallets/vendor_texts.py:385` (`queue_digests`), `backend/wallets/tasks.py`; Test: `backend/wallets/tests/test_digest_batches.py`

**Interfaces:** `queue_digests(day, now=None, *, after_pk=0, batch=None, deadline=None) -> int | None` processes at most `digest_batch_size` businesses (ordered by pk, after `after_pk`) or until `digest_time_budget_seconds` passes, and returns the last pk if more remain, else None; the Celery task re-enqueues itself with that cursor. A new beat task `catch_up_digests` at 10:00 Accra calls it for "yesterday" (idempotent via `digest_key`), covering a missed 07:00 run. Suspended owners skipped.

- [ ] **Step 1: Failing tests:** `test_batches_cover_everyone_exactly_once`, `test_deadline_stops_and_cursor_resumes`, `test_catch_up_sends_missed_day_once`, `test_rerun_adds_nothing`.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** and register the beat entry in `ashantihub/settings.py` next to the 07:00 job.
- [ ] **Step 4: Run** `... test wallets` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(wallets): batch the daily digest and catch up a missed run`

### Task 5: Record the rulings in the spec and gates

**Files:** Modify `docs/superpowers/specs/2026-10-15-wallet-fees-security-design.md` (§13 gates (xvi), (xxxv), (xxxvi), (li), (lvii), (xciii), (xcix), (c), (lxxxi), (lxxxvii), (lxxxviii), (cxi) and the OTP questions): mark each "Decided 2026-10-18" with the ruling and the plan/task that builds it; add the new settings to §3.3; CLAUDE.md untouched.

- [ ] **Step 1:** Edit the gate lines; no code.
- [ ] **Step 2:** `git diff --stat` shows only the spec changed.
- [ ] **Step 3: Commit** `docs(wallet): record owner rulings of 2026-10-18 against the gates`
