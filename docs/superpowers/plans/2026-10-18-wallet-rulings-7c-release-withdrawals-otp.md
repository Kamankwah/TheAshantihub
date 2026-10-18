# Wallet Rulings 7C: Release, Withdrawals, Staff Edits and OTP Caps — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the owner's rulings on manual release, event door scans, top-up holds, stuck withdrawals, staff edits of payout details and OTP guessing.

**Architecture:** All changes extend existing modules: `ledger/escrow.py` and `events/views.py` (release), `wallets/withdrawals.py` and `wallets/views_staff.py` (withdrawals), `wallets/destinations.py` (payout details), `otp/service.py` (guess cap), using the `approvals` engine (`ApprovalKind(requires_sudo=True, …)`) for every maker-checker step and `settings_store` keys from Plan 7A T1.

**Tech Stack:** Django/DRF, Celery, existing `approvals` and `otp` apps.

**Spec:** `docs/superpowers/specs/2026-10-15-wallet-fees-security-design.md` §4, §8, §9 and gates (xxxv), (xxxvi), (li), the OTP owner questions. Rulings: memory `wallet-owner-decisions-2026-10-18`. Depends on Plan 7A T1 (settings keys).

## Global Constraints

- Automatic release by the system is unchanged and needs no password; only a **manual** release by staff requires `RequiresSudo` (password re-entry).
- A maker never approves their own request (existing approvals engine rule).
- Every failure of a withdrawal by hand ends in exactly one of: provider-confirmed paid, provider-confirmed failed, or an approved evidence request; none by one person alone.
- Customer texts never include another person's phone number or payout number (`mask_numbers`).
- Event date edits stay allowed when sales exist (owner ruling).

## Review Focus

- Staff A proposes "fail with evidence" and approves their own request: refused.
- Provider flips to PAID after a hand-fail was proposed but before approval: approval re-asks the provider and refuses.
- Top-up credited at 10:00 withdrawn at 10:59: refused with the time it frees up; at 11:00: allowed; a withdrawal larger than the non-held balance is refused though total balance covers it.
- Scan of a refunded or already-scanned ticket: no second release, no second text.
- Organiser scans a ticket for a customer who never came: customer's dispute is answered against the event company's account, not AshantiHub (see T2).
- 21st wrong OTP code in one Accra day with correct password: refused and the account stays locked until the next day even if the 15-minute window passed.

---

### Task 1: Manual release needs the password

**Files:**
- Modify: the manual release view(s) — `events.views.EscrowReleaseView` and the order/ledger release door in `ledger/views.py` (find POSTs that call `escrow.release*` from a staff request); add `RequiresSudo` to `get_permissions` as `wallets/views_staff.py:202` does
- Test: `backend/ledger/tests/test_manual_release_sudo.py`, `backend/events/tests/test_escrow_release_sudo.py`

**Interfaces:** Consumes `accounts.permissions.RequiresSudo`. Produces: manual release answers 403 `sudo_required` without a fresh password check; scheduler/verification-driven release paths unaffected.

- [ ] **Step 1: Failing tests:** `test_manual_release_without_sudo_is_403`, `test_manual_release_with_sudo_works`, `test_automatic_release_needs_no_sudo` (call `escrow.release_verified` directly).
- [ ] **Step 2: Run** — Expected: FAIL (first test returns 200).
- [ ] **Step 3: Add `RequiresSudo`** to each manual door.
- [ ] **Step 4: Run** `... test ledger events` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(ledger): manual release requires password re-entry`

### Task 2: Door scan releases event money and tells the customer

**Files:**
- Modify: `backend/events/views.py:981-1030` (`EventCheckinView`), `backend/ledger/sales.py` (booking-sale ticket handover/release rules around lines 118-150, 309-320), `backend/ledger/escrow.py` (release for a ticket sale), notifications (`notifications` app, SMS via the existing sender used by `wallets/vendor_texts.py`)
- Create: `backend/events/scan_notice.py`
- Test: `backend/events/tests/test_checkin_release.py`

**Interfaces:**
- Produces: `scan_notice.send(ticket) -> None` queues an SMS (and email when the holder has one) via the idempotent text queue keyed `ticket-scan-{ticket.pk}`: "Your ticket for {event} was scanned at the event at {time}. If this was not you, contact AshantiHub Support within {verification_overdue_hours} hours."
- Behaviour change: with the ledger on, a scan of a held ticket in a booking sale releases that ticket's share of the sale (same as the ledger-off path already does) in the scan transaction. Record `Ticket.delivered_by_staff` (existing) and the scanner id; the release stores a `liable_party="event_organiser"` note on the journal memo so a later dispute over a scanned ticket is refunded from the organiser's account (existing `refunds` path for vendor-funded refunds), not platform funds.

- [ ] **Step 1: Failing tests:** `test_scan_releases_ticket_share_with_ledger_on`, `test_scan_queues_one_notice`, `test_rescan_does_not_release_or_text_again`, `test_refunded_ticket_scan_refused`, `test_dispute_after_scan_refunds_from_organiser` (asserts journal lines debit the organiser's vendor account, platform account unchanged).
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.** Remove the `_ledger_sale(ticket) is None` guard (line ~1017) in favour of the ledger release; keep one transaction with the existing row lock; send the notice via `transaction.on_commit`.
- [ ] **Step 4: Run** `... test events ledger` — Expected: PASS (update the older tests that asserted "scan leaves it held").
- [ ] **Step 5: Commit** `feat(events,ledger): door scan releases ticket money and texts the customer`

### Task 3: Top-up hold before withdrawal

**Files:** Modify `backend/wallets/withdrawals.py:91-160` (`request`), `backend/wallets/services.py` (record top-up time on the credit); Test: `backend/wallets/tests/test_topup_hold.py`

**Interfaces:** Consumes `settings_store.current("wallet_topup_hold_minutes", now)`. Produces `withdrawals.withdrawable(holder, now) -> int` = wallet Available minus top-ups credited within the hold window (computed from `wallet_top_up` journals); `request()` refuses amounts above it with code `topup_held` and `body` including `free_at`; the wallet API's balance payload adds `held_topup_pesewas` and `topup_free_at`.

- [ ] **Step 1: Failing tests:** `test_withdraw_blocked_inside_hold`, `test_allowed_at_exact_hold_end`, `test_sale_proceeds_not_held`, `test_partial_withdraw_of_non_held_part_allowed`, `test_hold_follows_setting_change`.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement `withdrawable`** and use it in `request` beside the per-tx and daily limits.
- [ ] **Step 4: Run** `... test wallets` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(wallets): top-up money waits an hour before withdrawal`

### Task 4: Maker-checker to fail or settle a stuck withdrawal

**Files:**
- Modify: `backend/wallets/views_staff.py` (fail action, line ~182-270), `backend/wallets/approval_kinds.py` (create if absent; register in `WalletsConfig.ready`)
- Test: `backend/wallets/tests/test_withdrawal_resolution.py`

**Interfaces:**
- Produces: approval kind `wallets.withdrawal_resolution` (`requires_sudo=True`, `amount_of` = withdrawal amount, `validate` re-asks the provider) with payload `{withdrawal_id, outcome: "failed"|"paid", evidence: str}`. `POST staff/withdrawals/<id>/resolve/` submits it (replaces direct `fail/` for every amount; `fail/` now submits the request with outcome `failed`). Approving `failed` runs the existing fail logic (return held funds); approving `paid` posts the paid journal (existing `paid_key`) as if the webhook had arrived. `validate`/`apply` refuse when the provider now answers the opposite of the proposed outcome (409 `provider_changed`), and also when it answers PROCESSING for `failed`. This is the in-app way out for a payout stuck at PROCESSING: evidence (provider reference, statement note) is mandatory, 10+ characters.

- [ ] **Step 1: Failing tests:** `test_proposer_cannot_approve_own`, `test_second_staff_approves_and_funds_return`, `test_paid_outcome_posts_paid_journal_once`, `test_provider_says_paid_so_failed_refused`, `test_processing_forever_resolved_with_evidence_by_two_people`, `test_missing_evidence_400`, `test_not_stuck_refused`.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** kind + view; keep the provider-asked-first behaviour of the old fail door inside `validate`.
- [ ] **Step 4: Run** `... test wallets approvals` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(wallets): two-person resolution of stuck withdrawals`

### Task 5: Staff edits of payout contacts and names need maker-checker

**Files:** Modify `backend/wallets/destinations.py` and its staff door (staff edits at line ~129 and `names.py`); Test: `backend/wallets/tests/test_staff_destination_edit.py`

**Interfaces:** Produces approval kind `wallets.holder_details_edit` (`requires_sudo=True`) payload `{holder_type, holder_id, field: "recovery_contact"|"staff_name"|"payout_name", new_value}`; the staff door submits instead of writing; `apply` writes and logs the activity event with before/after masked. A holder's own edits (customer/vendor/rider changing their own destination) are unchanged (they already use the cooling period).

- [ ] **Step 1: Failing tests:** `test_staff_edit_creates_request_not_change`, `test_approval_applies_change_and_starts_cooling`, `test_self_approval_refused`, `test_holder_own_edit_unchanged`.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.** Approving a changed payout name restarts `payout_cooling_hours` as a new destination does.
- [ ] **Step 4: Run** `... test wallets` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(wallets): staff edits of payout details need a second approver`

### Task 6: OTP daily guess cap and authenticator without sign-in enforcement

**Files:** Modify `backend/otp/service.py` (`is_locked`, `failures`, ~100-140), `backend/accounts/views.py:~402` (sign-in authenticator stage), `backend/otp/flags.py`; Test: `backend/otp/tests/test_daily_cap.py`, `backend/accounts/tests/test_authenticator_without_enforcement.py`

**Interfaces:** `service.daily_failures(account, now) -> int` counts `OtpEvent.FAILED` since Accra midnight (also resetting after a staff `RECOVERED` event, like `failures`); `is_locked` returns True when `failures >= LOCK_LIMIT` **or** `daily_failures >= settings_store.current("otp_daily_failure_cap")`. Sign-in asks for the authenticator code whenever the account has one enabled, regardless of `OTP_SIGNIN_ENFORCED`; texted/emailed codes remain tied to the flag.

- [ ] **Step 1: Failing tests:** `test_locked_after_cap_even_after_window`, `test_cap_resets_next_accra_day`, `test_staff_recovery_resets_daily_count`, `test_authenticator_required_when_enabled_and_flag_off`, `test_no_authenticator_flag_off_no_code`.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** both changes; the lock notice (`otp.notices.account_locked`) fires once when the cap is first hit.
- [ ] **Step 4: Run** `... test otp accounts` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(otp): daily wrong-code cap; honour authenticator when sign-in OTP is off`
