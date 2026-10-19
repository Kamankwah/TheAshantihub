# Wallet Rulings 7F-C: Owner's Round-2 Rulings on the 7C Build — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the owner's eight round-2 rulings (2026-10-19) to the code Plans 7A, 7E and 7C built: a business-initiated, scout-verified, maker-checker "business detail change request" replaces scout edits of name and contact; event cancellation exists and refunds every ticket from the organiser; a door scan never releases money; the authenticator can be set up with the OTP switch off; the top-up hold cannot be bypassed; the frontend copes with the three changed 7C contracts; and the 7C "fix before LEDGER is switched on" items close.

**Architecture:** Backend-heavy, all inside existing apps. The detail change request is a new model in `portfolio` plus a new approval kind `business.detail_change` in `portfolio/approval_kinds.py` (`requires_sudo=True`, `two_people=True`, the shape of `wallets/holder_details.py`), and it reuses `wallets.holder_details.restart_cooling`. The scout's visit reuses `field.VisitCheckIn` and `field.services.visit_target`. Event cancellation is a new `Event.CANCELLED` status plus `events/cancellation.py`, which refunds through `ledger.sales.refund` (so it is vendor-funded). Frontend work is small: fix existing callers, add one organiser button and one owner hook.

**Tech Stack:** Django/DRF, Celery beat, the `approvals`, `ledger`, `wallets`, `otp`, `portfolio`, `field`, `events` apps; React 18 + Vitest + MSW in `frontend/`.

**Spec:** `docs/superpowers/specs/2026-10-15-wallet-fees-security-design.md` §4, §8, §9 and gates (xxxiv), (xxxv), (xxxvi), (li) plus the 7C ledger (`.superpowers/sdd/2026-10-18-wallet-rulings-7c-release-withdrawals-otp/progress.md`). Builds on branch `feature/wallet-rulings-7c` (7A, 7E, 7C merged in that order; 7E before 7C because `events/0008` depends on `0007`). Rulings: memory `wallet-owner-decisions-2026-10-18` and the 2026-10-19 round-2 message.

**Overlap note:** The wallet frontend plans 2F/3F (`2026-10-19-wallet-frontend-3f-wallet-screens.md`) were looked for in the main checkout and on `docs/marketplace-rebrand-plans` / `docs/wallet-rulings-plans` and are not there yet. Task 9 touches only callers that exist today and builds none of their screens. If 3F lands first, drop whatever of Task 9 it already covers.

## Global Constraints

- Everything money-related stays behind `LEDGER_ENABLED` (`escrow.enabled()`); with it off, responses are exactly as before, except where a task says otherwise (the authenticator, the detail change request and the scout restriction are not ledger-gated: they protect sign-in and identity).
- A maker never decides their own request; kinds that move who-gets-paid are `requires_sudo=True, two_people=True`.
- No phone, email, account or MoMo number in a log line, activity body, notice, approval title or diff: use `accounts.phones.mask_phone`, `accounts.claims.mask_email`, `wallets.approval_kinds.mask_numbers`, `ApprovalKind.public_payload` (the pattern in `wallets/holder_details.py`). The request row itself keeps the new value unmasked because applying needs it.
- Backend tests use `docker compose run --rm web python manage.py test <labels>`; frontend tests run from `frontend/` (`cd frontend && npx vitest run <file>`).
- Pre-moderated `Review` fixture gotcha and the "tests mint staff tokens with `accounts.testing.staff_token(staff, sudo=True)`" rule from `backend/CLAUDE.md` apply.
- Event date edits stay allowed when sales exist (7C ruling); an edit never reopens a cancelled event.
- `frontend/CLAUDE.md`: no `useMutation`; `components/**` never imports `App.jsx`; inline `C`/`D` palette; the `apiClient` sudo handler is automatic.

## Rulings (record each in the SDD ledger as it is applied)

- **R1 (verification needs the password).** Already built in 7C T1 (`ledger.views.OrderVerificationView`, `views_bookings.BookingVerificationView` require sudo for outcome `matches`). `apiClient.send()` turns any `403 {code:"sudo_required"}` into one prompt and one retry for every caller, so no verification screen needs its own handling. There is no Support verification screen in `frontend/` today (grep for `awaiting-verification` and `/verification/` finds none): it belongs to the support-ledger frontend plan. This plan adds only a contract test (Task 9).
- **R2 (stuck PROCESSING settles only as paid).** Already built (`wallets/approval_kinds.py` `check()`); Task 12 makes spec §13 (xxxv)/(xxxvi) say so plainly and marks it owner-confirmed.
- **R3 (scouts cannot edit name or contact).** Protected fields = `full_name`, `login_phone`, `email` (one constant, `portfolio.proposals.PROTECTED_OWNER_FIELDS`). `business_name` and `business_contact_phone` stay scout-editable: the ruling lists "name or contact (login_phone, email)" and the instruction names the three owner columns; adding `business_name` later is a one-line change to that constant. **Owner to confirm (default: as built).** The business files the request itself; a scout is assigned to verify on the ground; a Super Admin or another `portfolio.manage` holder approves with the password; payout destinations then cool again (`payout_cooling_hours`). An unclaimed business (`needs_claim`) has no sign-in, so it cannot file; a registration typo is fixed by Operations through `PATCH business-owners/<id>/` (already maker-checker while the ledger is on). Cost if wrong: an unclaimed owner waits for Operations instead of their scout.
- **R4 (event cancellation).** A cancelled event refunds every unrefunded ticket in full, scanned or not, from the organiser's side (`ledger.sales.refund`, `refund_processing=True` because the organiser is at fault: the customer gets the processing charge back and AshantiHub bears it, `Dr provider fees`). After release the refund comes out of the organiser's Available and may take it negative, as every late refund already does. A customer-organised event has no ledger sale (`_ledger_sale` is None), so its tickets are marked refunded with today's REFUNDED `billing.Transaction` row and no wallet credit. Cost if wrong: AshantiHub carries processing charges on cancellations.
- **R5 (a door scan releases nothing, ever).** The 7C ruling "legacy ledger-off scans keep flipping escrow to RELEASED" is reversed. A ticket with no ledger sale stays `HELD` after a scan (scan still records `delivered_at` and `delivered_by_staff`). The smallest safe way out is the door that already exists: Accounting releases it by hand with `EscrowReleaseView` (`escrow.release` + sudo + a note). This plan makes such tickets findable (`?state=unreleased_legacy`, a summary count) and adds nothing automatic. Cost if wrong: organisers of pre-ledger events wait for Accounting; no money moves without a person.
- **R6 (authenticator offered with the switch off).** Setup, confirm and `available` no longer depend on `OTP_SIGNIN_ENFORCED`; setup still needs a step-up code (`force=True`), so `otp.views_step_up._codes_off` must stop saying "no code" for `AUTHENTICATOR_CHANGE`. Texted/emailed sign-in codes stay behind the switch.
- **R7 (top-up hold).** See Task 3: the hold follows value, not time of the last credit.
- **R8 (frontend contracts).** The only existing caller of a changed contract is `UsersPanel.jsx` (staff PATCH now answers 201 with an approval id); there is no frontend caller of `staff/withdrawals/<id>/fail/` or of the verification POST yet.

## Review Focus

- A scout proposing `{"login_phone": ...}`, `{"email": ...}` or `{"full_name": ...}` through `POST /api/portfolio/businesses/<id>/changes/` is refused for every business (claimed or not); `{"gps_address": ...}` and `{"business_name": ...}` still work. A pending `business.update` approval that already holds a protected field cannot be approved.
- The detail change request: the business cannot make itself verified, the verifying scout is never the business's registrar or account manager (`accounts.kyc.is_kyc_submitter`), the scout who verified is the approval's maker and never its decider, and approval needs sudo and a second person even for a Super Admin's own request.
- Event cancel twice is a no-op; a cancel interrupted halfway is finished by the sweep without refunding any ticket twice (`BookingRefund` source `ticket-<id>`); the release timer never touches a cancelled event; a Hubtel payment that succeeds after the cancel does not create tickets.
- A scan of any ticket never changes `escrow_status`; a ticket without a ledger sale is still released by Accounting's manual door.
- Customer sign-in with an enabled authenticator and `OTP_SIGNIN_ENFORCED=False` asks for the authenticator code (7C T6 rule now reachable).
- Staff PATCH of a customer/owner name or contact with the ledger on shows "sent for approval", not "saved".

---

### Task 1: Event cancelled status, the guards around it and the refund service

**Files:**
- Modify: `backend/events/models.py` (`Event.STATUS_CHOICES`, new fields), `backend/events/views.py` (`EventOwnerUpdateView.perform_update`, `EventApproveView.post`, `EventRenewView`, `EscrowReleaseView.post`), `backend/ledger/sales.py` (`release_due`), `backend/payments/services.py` (`_finalize_ticket_purchase`), `backend/events/management/commands/expire_events.py` (check only), `backend/marketplace/events.py` (status tabs ~L27, L109-115)
- Create: `backend/events/cancellation.py`, `backend/events/migrations/0009_event_cancelled.py`
- Test: `backend/events/tests/test_event_cancel_service.py`, `backend/ledger/tests/test_event_release_timer.py` (extend), `backend/payments/tests/test_ticket_after_cancel.py`

**Interfaces:**
- `Event.CANCELLED = "cancelled"` (9 characters, fits `max_length=10`); `Event.cancelled_at` (DateTime, null), `Event.cancel_reason` (CharField 300, blank), `Event.cancelled_by_staff` (FK `accounts.StaffUser`, SET_NULL, null, `related_name="+"`). A cancelled event is not `is_live`, drops out of `_live_events_queryset()` (it filters `status=APPROVED`), so ticket purchase 404s with no extra code.
- `events.cancellation.cancel_event(event, *, by, reason, now=None) -> CancelResult(event, tickets_refunded, tickets_left)`: locks the event row, sets `status=CANCELLED`, `cancelled_at`, `cancel_reason`, `cancelled_by_staff` (only when `by` is staff) in one transaction; a second call returns the same result without writing (idempotent). Then `refund_unrefunded(event, by, reason, now)`.
- `events.cancellation.refund_unrefunded(event, *, by, reason, now=None) -> int`: for each unrefunded ticket of the event, in its own `transaction.atomic()`: if `ledger.sales` has a sale for its `transaction_id` call `sales.refund(sale, to_pesewas(ticket.price), source=f"ticket-{ticket.pk}", by=by, refund_processing=True, note=reason)`, then `sales._ticket_refund_row(ticket)` and mark `refunded_at`, `refunded_by_staff`, `refund_reason` (the body of `sales.refund_ticket` without its "already delivered" refusal); else (no sale) only the REFUNDED `Transaction` row and the ticket marks. Returns how many tickets it refunded; a `RefundError` on one ticket is logged by type only, leaves that ticket for the sweep and continues.
- `ledger.sales.release_due` skips a ticket sale whose `candidate.event.status == Event.CANCELLED`, next to the existing `PENDING/REJECTED` skip.
- `payments.services._finalize_ticket_purchase` raises (rolling the payment back, as its docstring allows) when the ticket type's event is `CANCELLED`.
- `EventOwnerUpdateView.perform_update`, `EventApproveView.post`, `EventRenewView.post`: 409 `{"code": "event_cancelled"}` for a cancelled event. `EscrowReleaseView.post`: 409 for a ticket of a cancelled event.
- `marketplace/events.py`: cancelled events appear under the "ended" tab with their own label (read the file for the tab mapping before editing).

- [ ] **Step 1: Failing tests.** `test_cancel_sets_status_and_is_idempotent`, `test_cancel_refunds_every_unrefunded_ticket_to_buyers_wallet` (two buyers, one scanned ticket included), `test_refund_comes_out_of_organiser_pending_before_release`, `test_refund_after_release_may_take_available_negative`, `test_processing_charge_returned_and_borne_by_platform`, `test_customer_organised_event_marks_tickets_refunded_without_wallet`, `test_already_refunded_ticket_not_refunded_twice`, `test_interrupted_cancel_resumed_by_second_call` (patch the second ticket's refund to raise `RefundError`, then clear it), `test_cancelled_event_not_purchasable` (404), `test_release_due_skips_cancelled_event`, `test_edit_does_not_reopen_cancelled_event`, `test_approve_and_renew_refuse_cancelled_event`, `test_manual_release_refused_for_cancelled_event`, `test_hubtel_success_after_cancel_creates_no_ticket`.
- [ ] **Step 2: Run** `docker compose run --rm web python manage.py test events.tests.test_event_cancel_service ledger.tests.test_event_release_timer payments.tests.test_ticket_after_cancel` — Expected: FAIL (no `CANCELLED`, no module).
- [ ] **Step 3: Implement** the model fields, migration, `cancellation.py`, the guards above and the `release_due` skip. Lock order stays: ticket rows (via `sales.lock(sale)`), then the sale, then accounts; take the event row first and release it before refunding (the refunds run per ticket outside the event lock).
- [ ] **Step 4: Run** the labels from Step 2 plus `events ledger payments marketplace` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(events): cancelled status and full organiser-funded ticket refunds`

### Task 2: Cancel endpoints, notices, resume sweep and the organiser button

**Files:**
- Modify: `backend/events/views.py`, `backend/events/urls.py`, `backend/events/serializers.py` (expose `status="cancelled"`, `cancelled_at`, `cancel_reason` on the organiser's own event rows), `backend/ashantihub/settings.py` (beat entry beside `ledger.tasks.release_due_booking_sales`), `backend/ledger/tasks.py`, `frontend/components/EventSubmissionPanel.jsx`
- Create: `backend/events/cancel_notice.py`
- Test: `backend/events/tests/test_event_cancel_api.py`, `backend/events/tests/test_cancel_notice.py`, `backend/ledger/tests/test_cancel_sweep.py`, `frontend/EventSubmissionPanel.test.jsx` (extend)

**Interfaces:**
- `POST /api/events/mine/<pk>/cancel/` `{reason}` — `IsAuthenticated, IsEventOwner`; reason 5–300 chars (400 `reason_required`); 200 `{status, tickets_refunded, tickets_left}`; 409 `event_cancelled` is not used here (a repeat answers 200 with the same body).
- `POST /api/events/moderation/<pk>/cancel/` `{reason}` — `HasRolePermission("event.approve")` (Operations and Super Admin hold it), plus `RequiresSudo()` because it moves money out of the organiser's account. Records `event.cancelled` through `activity.services.record` (the middleware records it for staff).
- `events.cancel_notice.send(event, refunded_by_ticket)`: one in-app notice per distinct `purchased_by` ("“{event}” was cancelled. GH₵ {x} went back to your AshantiHub wallet." — wallet wording only when a wallet refund happened; otherwise "Support will refund you"), one summary to the organiser via `_notify_event_organizer`; text built through `mask_numbers(_plain(event.name))` like `events/scan_notice.py`; sent after commit; never raises.
- `ledger.tasks.finish_cancelled_event_refunds()` hourly (beat `crontab(minute=50)`): for every `Event.CANCELLED` with an unrefunded ticket call `cancellation.refund_unrefunded`; a no-op when nothing is left.
- Frontend: in `EventSubmissionPanel.jsx`'s event row actions (beside the existing Pay/Renew/Edit controls) a "Cancel event" button for an event with `status` `approved` or `pending`; a confirm step that says plainly "Every ticket is refunded in full from your account, including tickets already scanned. This cannot be undone." and a reason field; `apiPost('/api/events/mine/<id>/cancel/', {reason})` in a `try/catch` with `actionError`, then `refetch()`. A cancelled row shows a "Cancelled" chip and no other action. No ticket count is shown unless the API returned one.

- [ ] **Step 1: Failing tests:** backend `test_owner_cancel_200_and_refunds`, `test_other_business_cannot_cancel_404_or_403`, `test_staff_cancel_needs_sudo`, `test_staff_cancel_without_event_approve_403`, `test_reason_required`, `test_repeat_cancel_same_body`, `test_notice_one_per_buyer_and_one_to_organiser`, `test_notice_has_no_phone_number`, `test_sweep_finishes_interrupted_cancel`, `test_sweep_noop_when_all_refunded`; frontend `shows Cancel event for a live event`, `confirm names the full-refund consequence`, `posts reason and refetches`, `cancelled row has no actions`, `shows API error and keeps the row`.
- [ ] **Step 2: Run** `docker compose run --rm web python manage.py test events.tests.test_event_cancel_api events.tests.test_cancel_notice ledger.tests.test_cancel_sweep` and `cd frontend && npx vitest run EventSubmissionPanel.test.jsx` — Expected: FAIL.
- [ ] **Step 3: Implement** the two views (each calls `cancel_event` then `cancel_notice.send` after commit), URLs, serializer fields, the task and beat entry, and the button.
- [ ] **Step 4: Run** the same commands plus `events ledger` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(events): cancel an event from the organiser or Operations`

### Task 3: A door scan never releases; legacy tickets stay held and findable

**Files:**
- Modify: `backend/events/views.py` (`EventCheckinView.post`, `EscrowLedgerListView.filter_queryset`, `EscrowSummaryView.get`, the `EventCheckinView` docstring), `backend/ledger/sales.py` (`handed_over_at` stays; check the comment on a scan), `backend/events/serializers.py` (`TicketEscrowLedgerSerializer`: add `in_ledger` boolean)
- Test: `backend/events/tests/test_checkin_notice.py` (extend), `backend/events/tests/test_legacy_ticket_held.py`

**Interfaces:**
- In `EventCheckinView.post` remove the `if ticket.escrow_status == Ticket.HELD and sale is None:` branch entirely; the scan sets only `delivered_at`, `delivered_by_staff`, then `scan_notice.send(ticket, sale)` (None sale sends nothing, as now).
- `GET /api/events/tickets/escrow/?state=unreleased_legacy`: held, not refunded, and no `BookingSale` for `ticket.transaction_id` (use `~Exists(BookingSale.objects.filter(session__transaction_id=OuterRef("transaction_id")))`). `GET .../escrow/summary/` adds `legacy_held: {amount, count}` over the same filter. Both unchanged while no such ticket exists.
- Docstring of `EventCheckinView` and `EscrowReleaseView` state the rule: a scan is evidence only; a ticket outside the ledger is released by Accounting's manual door.

- [ ] **Step 1: Failing tests:** `test_scan_of_ledger_off_ticket_leaves_escrow_held`, `test_scan_of_pre_ledger_ticket_with_ledger_on_leaves_held`, `test_scan_still_records_delivered_at_and_staff`, `test_scan_of_ledger_sale_ticket_unchanged`, `test_accounting_manual_release_still_works_after_scan` (sudo, note), `test_state_unreleased_legacy_filter_lists_only_sale_less_held`, `test_summary_reports_legacy_held`, `test_rescan_still_refused`.
- [ ] **Step 2: Run** `docker compose run --rm web python manage.py test events.tests.test_checkin_notice events.tests.test_legacy_ticket_held` — Expected: FAIL (first test finds `released`).
- [ ] **Step 3: Implement** the removal, the filter, the summary field and the serializer flag.
- [ ] **Step 4: Run** `... test events ledger` — Expected: PASS; update any existing test that asserted the legacy flip (search `escrow_status` in `events/tests/test_ticket_checkin_contact.py`) and say so in the commit body.
- [ ] **Step 5: Commit** `fix(events): a door scan never releases money; legacy tickets wait for Accounting`

### Task 4: Top-up hold survives refund-after-spend; one withdrawable() formula

**Files:**
- Modify: `backend/wallets/services.py` (`held_topups`), `backend/wallets/withdrawals.py` (`withdrawable`, `request` ~L147)
- Test: `backend/wallets/tests/test_topup_hold.py` (extend)

**Interfaces:**
- `held_topups(holder, now=None) -> (held_pesewas, free_at)` keeps its signature but also takes `balance=None`: returns `min(held, balance)` when a balance is passed, so a partly spent held top-up no longer over-blocks (7C T3 minor), and uses the caller's `now` for the window edge only (`journal.created_at` is the credit time; do not compare against `timezone.now()` anywhere in this function).
- `withdrawals.request` calls `withdrawable(holder, now, balance)` once and reuses it for both the refusal test and the message; the inline `balance - held` arithmetic is removed (drift risk, 7C T3 minor).
- **The bypass, specified by tests before any fix.** The hold treats money as spent free-first (`balance - held`), so the cases below must hold. Write them first; the failing ones define the fix, the passing ones stay as regression tests: (a) top-up 10000 at t0, spend 10000 on a wallet-paid order at t0+1, refund 10000 at t0+10: withdrawable 0 until t0+60; (b) same but the refund arrives at t0+61: withdrawable 10000 (the window has ended; by design); (c) free 3000 + top-up 5000, spend 6000, refund 6000 inside the window: withdrawable 3000; (d) two top-ups 4 minutes apart, partial spend, `free_at` is the later one; (e) refund of a wallet-paid order credited as `booking_refund` or `order_refund` is not itself held but cannot exceed `balance - held`; (f) a refund issued while a withdrawal is PENDING (balance already reduced) does not free held money. If any of (a)(c)(e)(f) fails, fix `held_topups` to count as held the part of the in-window top-ups not yet covered by post-top-up debits that were free-funded, and record the exact failing case as a Ruling; if all pass, record in the ledger that the 7C minor reproduced as already safe and keep the tests.

- [ ] **Step 1: Failing tests:** `test_refund_after_spend_inside_hold_stays_held`, `test_refund_after_hold_ends_is_free`, `test_partly_spent_held_topup_does_not_overblock`, `test_two_topups_free_at_is_latest`, `test_refund_during_pending_withdrawal_does_not_free_hold`, `test_request_and_withdrawable_agree` (loop over amounts around the boundary).
- [ ] **Step 2: Run** `docker compose run --rm web python manage.py test wallets.tests.test_topup_hold` — Expected: FAIL for the over-block and agreement tests at least.
- [ ] **Step 3: Implement** the `balance` argument and the single formula; fix the bypass if Step 1 exposed one.
- [ ] **Step 4: Run** `... test wallets ledger` — Expected: PASS.
- [ ] **Step 5: Commit** `fix(wallets): top-up hold cannot be bypassed by refunds; one withdrawable formula`

### Task 5: The authenticator app is offered with OTP_SIGNIN_ENFORCED off

**Files:**
- Modify: `backend/otp/views_authenticator.py` (`AuthenticatorView.get`, `AuthenticatorSetupView.post`, `AuthenticatorConfirmView.post`, module docstring, `OFF`, `_off`), `backend/otp/views_step_up.py` (`_codes_off`), `backend/otp/flags.py` docstring
- Test: `backend/otp/tests/test_authenticator.py` (extend), `backend/otp/tests/test_step_up.py` (extend), `backend/otp/tests/test_sign_in_api.py` (extend)

**Interfaces:**
- `GET .../authenticator/` answers `"available": True` for every customer and owner; setup and confirm no longer return 409 `otp_off`. Setup still calls `step_up.require(request, AUTHENTICATOR_CHANGE, force=True)`.
- `_codes_off(account, action)`: for a customer or business owner and `action == AUTHENTICATOR_CHANGE`, always `False` (a code can be sent), so the step-up code needed for setup is issuable with every switch off. Staff behaviour unchanged.
- Sign-in with an enabled authenticator and the switch off already asks for it (`otp.signin._authenticator_owed`); the new tests prove the whole chain: setup with a step-up code, confirm, then the next sign-in answers `two_factor_required` and a correct app code signs in.

- [ ] **Step 1: Failing tests:** `test_setup_available_with_signin_switch_off`, `test_step_up_code_issued_for_authenticator_change_with_switches_off`, `test_confirm_with_switch_off_returns_recovery_codes`, `test_sign_in_asks_authenticator_after_setup_switch_off` (customer and owner), `test_no_authenticator_means_plain_sign_in_switch_off` (nobody is forced), `test_get_reports_available_true`.
- [ ] **Step 2: Run** `docker compose run --rm web python manage.py test otp.tests.test_authenticator otp.tests.test_step_up otp.tests.test_sign_in_api` — Expected: FAIL (409 `otp_off`).
- [ ] **Step 3: Implement** the three changes and the docstring/`OFF` cleanup (delete `OFF` and `_off` if nothing else uses them).
- [ ] **Step 4: Run** `... test otp accounts` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(otp): offer the authenticator app whatever the sign-in switch says`

### Task 6: Business detail change request — model and the business-facing endpoints

**Files:**
- Modify: `backend/portfolio/models.py`, `backend/portfolio/urls.py` (or `backend/accounts/urls.py` for the owner-facing path, beside `business-owners/me/payout/`), `backend/accounts/permissions.py` only if `IsBusinessOwner` is needed (it already exists in `accounts/views.py`), `backend/ashantihub/settings.py` (throttle scope if `settings.py` lists scopes)
- Create: `backend/portfolio/detail_changes.py`, `backend/portfolio/migrations/0002_businessdetailchangerequest.py`
- Test: `backend/portfolio/tests/test_detail_change_request.py`

**Interfaces:**
- `portfolio.models.BusinessDetailChangeRequest`: `business_owner` FK (CASCADE, related_name `detail_change_requests`), `field` (choices `full_name`, `login_phone`, `email`), `new_value` (CharField 254), `reason` (CharField 300), `status` (`requested`, `assigned`, `verified`, `not_verified`, `approved`, `rejected`, `withdrawn`; default `requested`), `requested_at`, `assigned_scout` FK (StaffUser, null, PROTECT, `related_name="+"`), `assigned_by` FK (null), `assigned_at`, `visit` FK to `field.VisitCheckIn` (null), `verified_at`, `verification_note` (CharField 500), `approval` FK to `approvals.ApprovalRequest` (null), `decided_at`. Constraint: one live (`requested|assigned|verified`) request per `(business_owner, field)`.
- `portfolio.detail_changes.PROTECTED_FIELDS = ("full_name", "login_phone", "email")` (imported by `proposals.py` in Task 9 as `PROTECTED_OWNER_FIELDS`).
- `detail_changes.clean(owner, field, value) -> str`: names via the 150-char text rule of `proposals._text`; `login_phone` through `accounts.phones.normalize_gh_phone`; `email` lower-cased and validated; refused when unchanged (400 `no_change`), when it belongs to another business, a customer-recovery clash or staff (`proposals.update_duplicate_errors` minus its `needs_claim` rule: reuse its phone/email duplicate checks), or when masked (`*`/`•`).
- `detail_changes.request_change(owner, field, value, reason, http_request=None) -> BusinessDetailChangeRequest`: 409 `change_pending` if a live one exists; 409 `not_claimed` if `owner.needs_claim`; notifies Operations (`notify_staff_role("portfolio.manage", ...)`) that a scout must be assigned. Never puts the new value in a notice or activity body; the activity event `business.detail_change_requested` carries the field name and a masked value only.
- `POST /api/accounts/business-owners/me/detail-changes/` `{field, new_value, reason}` (`IsBusinessOwner`; a step-up `step_up.CONTACT_CHANGE`-style token is required while the ledger is on: add `DETAIL_CHANGE = "detail_change"` to `otp.step_up.ACTIONS` and call `step_up.require(request, step_up.DETAIL_CHANGE)` inside the transaction; the owner views are in `accounts/views.py`); `GET` same path lists the owner's requests with `status`, `field`, the shown (masked) new value, `requested_at`, and the assigned scout's first name once assigned; `POST .../detail-changes/<id>/withdraw/` while `requested` or `assigned`.

- [ ] **Step 1: Failing tests:** `test_owner_files_request_201`, `test_unclaimed_owner_cannot_file_409`, `test_second_live_request_for_same_field_409`, `test_unchanged_value_400`, `test_value_belonging_to_another_business_refused`, `test_staff_phone_or_email_refused`, `test_masked_value_refused`, `test_step_up_required_when_ledger_on`, `test_list_shows_masked_value_only`, `test_withdraw_before_verification`, `test_activity_and_notice_hold_no_raw_contact`, `test_customer_and_staff_tokens_403`.
- [ ] **Step 2: Run** `docker compose run --rm web python manage.py test portfolio.tests.test_detail_change_request` — Expected: FAIL (no model).
- [ ] **Step 3: Implement** model, migration, `detail_changes.py` (`clean`, `request_change`, `withdraw`), the step-up action, views and URLs.
- [ ] **Step 4: Run** `... test portfolio accounts otp` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(portfolio): businesses request name and contact changes themselves`

### Task 7: Scout assignment and the on-site verification visit

**Files:**
- Modify: `backend/field/models.py` (`VisitCheckIn.CHANGE_VERIFICATION = "change_verification"` purpose, nullable FK `change_request` to `portfolio.BusinessDetailChangeRequest`), `backend/field/services.py` (`visit_target`, `check_in`), `backend/field/views.py` (`VisitTargetsView`, `VisitListCreateView` accept `change_request_id`), `backend/portfolio/detail_changes.py`, `backend/portfolio/views.py`, `backend/portfolio/urls.py`
- Create: `backend/field/migrations/0003_visit_change_request.py`
- Test: `backend/portfolio/tests/test_detail_change_assignment.py`, `backend/field/tests/test_change_verification_visit.py`

**Interfaces:**
- `POST /api/portfolio/detail-changes/<id>/assign/` `{scout}` — permission `scouts.assign` (the permission `accounts.views.ScoutAssignmentListCreateView` uses); the scout must have `scouts.verify`, role `scout`, active, and must not be `accounts.kyc.is_kyc_submitter(owner, scout)` (registrar, account manager, address corrector): 400 with the same wording as the assign door. Sets `assigned_scout`, `assigned_by`, `assigned_at`, `status=assigned`; the scout gets a task via `staff_tasks.services.create_task` (kind `Task.REVIEW` or the closest existing kind: read `staff_tasks.services.KIND_LABELS` first) due in 48 h. `GET /api/portfolio/detail-changes/?status=` lists requests for `scouts.assign` holders (Operations), and `GET /api/portfolio/detail-changes/mine/` lists the scout's assigned ones (`scouts.verify`).
- `field.services.visit_target(scout, ..., change_request_id=None)` returns `(owner, None, None)` plus the request when it is the scout's own `assigned` request and the scout holds `scouts.verify`, else 404 `not_found` (the existing "so a scout can't learn which other places exist" rule); `check_in(..., change_request_id=...)` sets `purpose=CHANGE_VERIFICATION`, measures distance to the business pin as for any visit, and stores the FK.
- `POST /api/portfolio/detail-changes/<id>/verify/` `{outcome: "verified"|"not_verified", note}` — the assigned scout only, requires a `DONE` or `OPEN`-checked-out `CHANGE_VERIFICATION` visit for this request taken inside the radius (`VisitCheckIn.outside_radius` false; an outside-radius visit answers 409 `outside_radius` and the scout must revisit), note 10–500 chars. `verified` sets `status=verified`, `verified_at`, `verification_note`, and submits the approval (Task 8) with the scout as maker; `not_verified` sets `status=not_verified`, notifies the owner and Operations, and ends the request (the business files a new one). The scout is shown the field name and the new value in full (they are verifying it on the ground); nothing is masked for them, nothing is logged unmasked.

- [ ] **Step 1: Failing tests:** `test_operations_assigns_independent_scout`, `test_registrar_or_account_manager_cannot_be_assigned`, `test_assign_requires_scouts_assign`, `test_scout_cannot_check_in_for_someone_elses_request` (404), `test_check_in_sets_purpose_and_request`, `test_verify_requires_visit_inside_radius`, `test_verify_without_visit_409`, `test_verify_by_other_scout_404`, `test_not_verified_ends_request_and_notifies`, `test_verified_submits_approval_with_scout_as_maker`, `test_scout_task_created_on_assign`.
- [ ] **Step 2: Run** `docker compose run --rm web python manage.py test portfolio.tests.test_detail_change_assignment field.tests.test_change_verification_visit` — Expected: FAIL.
- [ ] **Step 3: Implement** purpose, FK, migration, `visit_target`/`check_in` branch, assignment and verify views.
- [ ] **Step 4: Run** `... test field portfolio accounts` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(portfolio): a scout visits to verify a business's requested change`

### Task 8: Approval kind `business.detail_change`: sudo, two people, cooling

**Files:**
- Modify: `backend/portfolio/approval_kinds.py` (`KINDS`), `backend/portfolio/apps.py` (nothing if `KINDS` is iterated), `backend/portfolio/detail_changes.py`
- Test: `backend/portfolio/tests/test_detail_change_approval.py`

**Interfaces:**
- `ApprovalKind(key="business.detail_change", label="Business name or contact change", pool_permission="portfolio.manage", current_state=..., apply=..., validate=..., render_diff=..., consequences=..., public_payload=..., requires_sudo=True, two_people=True, response_hours=24, on_rejected=..., chain_note="One approval from another holder of portfolio.manage, or a Super Admin; never the scout who verified")`. Payload `{change_request_id, business_owner_id, field, new_value}`; target = the owner (`target_type` from `proposals._owner_target_type()`), so `accounts.kyc.is_kyc_submitter`'s "maker of any `business.kyc`/`business.update` request" rule is extended to this kind (add its key to the tuple in `accounts/kyc.py`).
- `current_state` returns `{"value": shown(field, value), "digest": holder_details.digest(owner, field)}` (keyed digest, not the raw value, as 7C T5); `validate` re-runs `detail_changes.clean` and requires the request still `verified`; `apply` (locks the owner row) re-checks the digest with `hmac.compare_digest`, writes the column, calls `wallets.holder_details.restart_cooling(owner, now)` so every live payout destination waits `payout_cooling_hours` again (all three fields restart cooling, spec (xxxiv)), sets request `status=approved`, `decided_at`, writes a `portfolio.AppliedChange` (summary "Changed your {field label}", masked) so the owner sees it and cannot be surprised, tells the owner and, for `login_phone`/`email`, the **old** contact (masked in the log, raw only in the delivery path as `otp.notices` does), and records `business.detail_changed` last (activity chain lock) with masked before/after.
- `on_rejected`: request `status=rejected`, owner told; the scout gets `returned_task` only if the approver returned (not rejected) it.
- A Super Admin's own request still waits for another person (`two_people`).

- [ ] **Step 1: Failing tests:** `test_approval_needs_sudo` (403 `sudo_required`), `test_scout_maker_cannot_approve_own`, `test_super_admin_request_waits_for_second_person`, `test_approve_writes_value_and_restarts_cooling`, `test_cooling_never_shortened`, `test_stale_when_owner_changed_value_meanwhile` (409), `test_apply_revalidates_duplicates`, `test_old_contact_notified_masked_in_log`, `test_applied_change_row_created`, `test_reject_marks_request_and_notifies_owner`, `test_activity_event_has_no_raw_contact`, `test_kyc_submitter_rule_includes_this_kind`.
- [ ] **Step 2: Run** `docker compose run --rm web python manage.py test portfolio.tests.test_detail_change_approval` — Expected: FAIL (unknown kind).
- [ ] **Step 3: Implement** the kind and `apply` helpers; extend `kyc.is_kyc_submitter`.
- [ ] **Step 4: Run** `... test portfolio approvals accounts wallets` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(portfolio): detail changes are approved by two people with the password`

### Task 9: Remove the scout's name/contact edit path (and finish the parked portfolio route)

**Files:**
- Modify: `backend/portfolio/proposals.py` (`EDITABLE_FIELDS`, `OWNER_FIELDS`, `clean_update_fields`, `update_duplicate_errors`, `validate_update`, `apply_update`, `OWNER_HAS_LOGIN`, `FIELD_LABELS`, `PROTECTED` message), `backend/portfolio/undo.py` (`_revert_update`, `_can_restore`), `backend/portfolio/registration.py` (read only: registration of a new business by a scout still sets the first name/phone), `frontend/components/admin/panels/ProposeChangeForm.jsx`, `backend/CLAUDE.md` (the "Scout changes" bullet)
- Test: `backend/portfolio/tests/test_proposals.py`, `test_change_kinds.py`, `test_owner_undo.py` (update), `backend/portfolio/tests/test_scout_cannot_edit_identity.py` (new), `frontend/components/admin/panels/__tests__/ProposeChangeForm.test.jsx` (find its real path with `ls`; extend)

**Interfaces:**
- `proposals.PROTECTED_OWNER_FIELDS = detail_changes.PROTECTED_FIELDS`. `EDITABLE_FIELDS` loses those three; `clean_update_fields` answers a per-field 400 with the new message `"Name and contact are changed by the business itself and checked by a scout visit. Ask the owner to request it in their dashboard."` for any of them, before any other check. `OWNER_FIELDS` is no longer used by `apply_update`; delete it and the owner-column branch (profile fields only).
- `validate_update` (run at approval) raises `ApprovalError` when the stored payload still holds a protected field, so an already-pending `business.update` created before this change can never apply; Operations sees "Cancelled: this change now needs the business's own request" (add the message to `update_diff`'s consumer via the approval error text).
- `undo._revert_update`: protected fields in an old `AppliedChange` are listed as skipped (the existing `skipped` list and its owner-facing wording), never written; the owner is told which were not reverted and that Support can help. All other fields undo exactly as before, including `gps_address` restoring its decision.
- `ProposeChangeForm.jsx`: the three inputs are removed from the form and a one-line note says "Name and contact are changed by the business itself." (the form diffs against the business it opened with, per `frontend/CLAUDE.md`).
- `backend/CLAUDE.md` "Scout changes" bullet: replace "`email` / `login_phone` are proposable only while the owner `needs_claim`" with the new rule and a pointer to `business.detail_change`.

- [ ] **Step 1: Failing tests:** backend `test_scout_cannot_propose_full_name`, `test_scout_cannot_propose_login_phone_even_unclaimed`, `test_scout_cannot_propose_email`, `test_scout_can_still_propose_gps_address_business_name_contact_phone_hours_pin`, `test_mixed_payload_with_one_protected_field_refused_whole`, `test_pending_old_update_with_protected_field_cannot_apply`, `test_undo_skips_protected_fields_and_restores_the_rest`, `test_registration_still_sets_initial_name_and_phone`; frontend `form no longer offers name or contact`, `note explains who changes them`, `other fields still diff and submit`.
- [ ] **Step 2: Run** `docker compose run --rm web python manage.py test portfolio.tests.test_scout_cannot_edit_identity` and `cd frontend && npx vitest run components/admin/panels/__tests__/ProposeChangeForm.test.jsx` — Expected: FAIL.
- [ ] **Step 3: Implement** the removals above; update the existing `test_proposals.py`/`test_change_kinds.py`/`test_owner_undo.py` assertions that expected the old behaviour, and say why in the commit body.
- [ ] **Step 4: Run** `... test portfolio field accounts` and the frontend file — Expected: PASS.
- [ ] **Step 5: Commit** `fix(portfolio): scouts can no longer change a business's name or contact`

### Task 10: Frontend: staff PATCH 201, sudo and two-person contracts; owner request hook

**Files:**
- Modify: `frontend/components/admin/panels/UsersPanel.jsx` (`save` ~L204, the edit form hint), `frontend/components/admin/panels/__tests__/UsersPanel.test.jsx`, `frontend/apiClient.test.js`, `frontend/mocks/handlers.js`, `frontend/components/dashboard/panels/ProfilePanel.jsx` (one small "Request a change" form, see below)
- Create: `frontend/hooks/useBusinessDetailChanges.js`, `frontend/hooks/__tests__/useBusinessDetailChanges.test.jsx`
- Test: the files above; `frontend/AuthModal.test.jsx` (extend)

**Interfaces:**
- **Staff PATCH 201.** `apiPatch` returns the parsed body; `UsersPanel.save` reads `res.approval_id`. When present: close the form, call `onChanged()`, and show a `role="status"` line "Sent for approval (request #N). The details change when another person approves." (and for `approval_ids.length > 1` "…(N requests)"). The fields that did not need approval were saved by the same call: say "Other changes were saved." only when `res` carries other changed keys the form sent (compare the form's non-protected keys). No approval id: the existing silent save. A `400 {code:"no_change"}` shows "That is already the current value." instead of the generic error (`err.body.code`).
- **Verification sudo (contract only).** `apiClient.test.js`: `retries a POST to /api/ledger/orders/7/verification/ once after sudo_required`, `surfaces the 403 when the prompt is cancelled`, `does not loop when the retry is 403 again`. No screen exists to wire; the test pins the shape the future Support screen relies on.
- **Withdrawal fail 201 (contract only).** `apiClient.test.js`: `a 201 {approval_id, status:"pending"} from staff/withdrawals/3/fail/ resolves to the body`, and a MSW default handler for `POST /api/wallet/staff/withdrawals/:id/fail/` in `mocks/handlers.js` answering that 201 (the real path is `/api/wallet/...` if `wallets/urls.py` is mounted there: read `ashantihub/urls.py` first). The staff wallet screen that sends it belongs to 3F.
- **Customer/owner second step with the switch off.** `AuthModal.test.jsx`: `a customer login answering two_factor_required shows the code step and signs in with the app code` and `an owner login likewise` (the `setTwoStep` branches at `App.jsx` ~L1210 already take any `two_factor_required` body; the tests prove it for non-staff accounts).
- **Owner hook.** `useBusinessDetailChanges()` — `useQuery(['business-detail-changes'], GET /api/accounts/business-owners/me/detail-changes/)` returning the plain array; the form in `ProfilePanel.jsx` (name, phone, email, one field at a time, reason) posts with `apiPost` in a `try/catch`, shows the status ("Waiting for a visit", "A scout will visit", "Checked, waiting for approval", "Done", "Not confirmed"), a withdraw button while `requested`/`assigned`, and handles `step_up_required` through the existing step-up prompt used by the payout form (read how `PayoutDetailUpdateView`'s caller does it in `ProfilePanel.jsx` and reuse it). It never shows the new value unmasked beyond what the owner just typed.

- [ ] **Step 1: Failing tests:** `UsersPanel.test.jsx` `shows sent-for-approval on a 201 with approval_id`, `plain save still says nothing special`, `no_change shows its own message`, `mixed PATCH reports the saved part`; the `apiClient` and `AuthModal` tests above; hook test `lists requests`, `posts a request and refetches`, `withdraws`; `ProfilePanel` `request form posts field, new_value and reason`, `status labels`.
- [ ] **Step 2: Run** `cd frontend && npx vitest run components/admin/panels/__tests__/UsersPanel.test.jsx apiClient.test.js AuthModal.test.jsx hooks/__tests__/useBusinessDetailChanges.test.jsx` — Expected: FAIL (contract tests may already pass: keep them, they are the point).
- [ ] **Step 3: Implement** the `UsersPanel` change, MSW handler, hook and the profile form. `StaffDashboard.test.jsx` and `BusinessDashboard.test.jsx` are contracts: run them and change nothing in them unless an assertion contradicts the new behaviour (then say why).
- [ ] **Step 4: Run** the four files above, then `cd frontend && npx vitest run StaffDashboard.test.jsx BusinessDashboard.test.jsx` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(frontend): handle the changed staff-edit contract; owner detail-change request`

### Task 11: Deferred 7C minors worth closing before the switch

**Files:**
- Modify: `backend/wallets/holder_details.py` (digest compare, notices), `backend/accounts/views.py` (`HolderDetailsGuard`, customer PATCH activity), `backend/wallets/approval_kinds.py` (`chain_note`, duplicate-pending lock), `backend/otp/service.py` (`note_failure`), `backend/otp/notices.py` (docstring), `backend/events/scan_notice.py` (UTC label), `backend/ledger/tests/test_manual_release_sudo.py`
- Test: `backend/wallets/tests/test_staff_destination_edit.py`, `test_withdrawal_resolution.py`, `backend/otp/tests/test_daily_cap.py`, `backend/events/tests/test_checkin_notice.py`, `backend/ledger/tests/test_manual_release_sudo.py` (all extended)

**Interfaces and assertions** (one fix and one test each; skip any that Steps 1–2 show already pass):
- `holder_details.apply` compares digests with `hmac.compare_digest` (test: stale refusal unchanged, one equal-digest pass).
- `holder_details.ask` takes the holder row `select_for_update()` before its `pending(...)` check, so two concurrent requests cannot both be filed (test with two sequential calls after a patched `pending` race: second is `change_pending`). Same lock before `withdrawal_resolution`'s duplicate-pending check.
- The holder is told when staff change a payout name or recovery contact: `holder_details.apply` sends, on commit, an in-app notice and, for a contact change, a message to the **old** contact through `otp.senders` ("Your {payout name|phone|email} on AshantiHub was changed by our staff. If this was not expected, contact Support."), no raw number in the log. Test: `test_holder_told_of_staff_change`, `test_old_contact_receives_notice_once`.
- Notices created inside an `atomic` block are created with `transaction.on_commit` (test: a rolled-back apply sends nothing).
- A customer PATCH that carries no protected field records the activity event once, not twice (test: one `ActivityEvent` row).
- `otp.service.note_failure`: lock when `failures >= cap`, not `== cap`, so lowering the cap mid-day locks the next failure with its event and notice (test: cap lowered from 20 to 10 at 12 failures; the 13th is refused and notices once).
- `withdrawal_resolution.chain_note` says "one approval from another holder of wallets.manage, or a Super Admin; two approvals above the co-sign limit" — read `approvals.rules` for the real co-sign threshold and quote its setting key, not a number (test: the rules screen payload contains the wording).
- `events/scan_notice.body_for`: times are labelled "UTC" (test updates the existing expected text). The release time in the notice is computed when sent; an event-date edit after the scan does not re-send (record in the docstring, no code).
- `ledger/tests/test_manual_release_sudo.py` gains `test_booking_release_due_manual_door_needs_sudo` (7C T1 gap).
- Not fixed here, recorded in the ledger as still open: staff authenticator guesses uncounted toward the daily cap (staff race, spec ~l.333), trusted-device bypass of the cap, provider asked twice per approval holding locks, scan-notice retry sweep, concurrency tests.

- [ ] **Step 1: Failing tests** as listed.
- [ ] **Step 2: Run** `docker compose run --rm web python manage.py test wallets.tests.test_staff_destination_edit wallets.tests.test_withdrawal_resolution otp.tests.test_daily_cap events.tests.test_checkin_notice ledger.tests.test_manual_release_sudo` — Expected: FAIL for the ones that are real gaps.
- [ ] **Step 3: Implement** each fix.
- [ ] **Step 4: Run** `... test wallets otp events ledger accounts approvals` — Expected: PASS (full suite last ran 1850 tests in about 540 s at 7C HEAD).
- [ ] **Step 5: Commit** `fix(wallets,otp): close the deferred 7C minors that matter before switch-on`

### Task 12: Update the spec gates and the ledger

**Files:**
- Modify: `docs/superpowers/specs/2026-10-15-wallet-fees-security-design.md` (gates (xxxiv), (xxxv), (xxxvi), (li) and the §9 authenticator text, §4 ticket text near l.158-168 and l.861), `docs/superpowers/plans/2026-10-19-wallet-rulings-7f-c-followups.md` (tick boxes), `backend/CLAUDE.md` (ledger bullet: a scan never releases; event cancellation; detail change request)
- No tests.

**Interfaces:** each gate gets a dated line "2026-10-19 owner ruling: …, built in 7F-C Task N".
- (xxxiv): the portfolio `business.update` route no longer carries name/contact (Task 9); name and contact changes are the business's own request, scout-verified, two-person, sudo, cooling restarted (Tasks 6-8); old-contact notice built (Task 11); staff-name door still open (state it, with owner question: should a third-party rider's staff name be editable by Operations at all while the ledger is on).
- (xxxv)/(xxxvi): owner-confirmed 2026-10-19 that a payout stuck at PROCESSING can be settled only as "paid" with evidence, never failed; delete the "owner should confirm" sentence; chain wording as Task 11.
- (li): hold built (7C T3), bypass tests and fix (Task 4).
- New lines: event cancellation (R4, Tasks 1-2); a scan never releases and legacy tickets wait for Accounting (R5, Task 3); authenticator offered with the switch off (R6, Task 5); frontend contracts (R1, R8, Task 10); owner confirmations still open: R3's field list (`business_name`), unclaimed-business path, processing charge on cancellation.
- The "fix before LEDGER is switched on" list in the SDD ledger (`.superpowers/sdd/2026-10-18-wallet-rulings-7c-release-withdrawals-otp/progress.md`) is updated: refund bypass (Task 4), frontend contracts (Task 10), parked portfolio route (Task 9) all closed.

- [ ] **Step 1: Edit** the spec and CLAUDE.md as above.
- [ ] **Step 2: Verify** with `grep -n "7F-C" docs/superpowers/specs/2026-10-15-wallet-fees-security-design.md` that every gate above carries its line.
- [ ] **Step 3: Commit** `docs(spec): record the 2026-10-19 rulings and what 7F-C built`

---

## Self-review

- Rulings 1-8 map to Tasks: R1 Task 10 (contract test; no screen exists), R2 Task 12, R3 Tasks 6-9, R4 Tasks 1-2, R5 Task 3, R6 Task 5, R7 Task 4, R8 Task 10; remnants and minors Tasks 9, 11, 12.
- Order: 1 before 2; 3, 4, 5 independent; 6 before 7 before 8 (8 submits the approval 7 calls: build 8's kind registration before 7's verify step runs its approval test, or stub `submit` in 7 and tighten in 8); 9 imports `PROTECTED_FIELDS` from 6; 10 needs 6 and 9; 11 and 12 last.
- Migrations: `events/0009`, `portfolio/0002`, `field/0003`; run `makemigrations --check` once at the end.
- Cost if the 3F plan lands first: drop the MSW handler and the staff-fail contract test from Task 10.
