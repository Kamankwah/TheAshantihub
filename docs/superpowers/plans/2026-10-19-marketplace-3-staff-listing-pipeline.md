# Marketplace Plan 3 — Staff Listing Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let scouts, Operations and Super Admin add prospects, register businesses and list products, services, events and stays on a client's behalf, with the owner confirming both the registration and the listings through a system-sent text link (7 days), a second person approving every staff-made listing, scout targets counting approved listings instead of renewals, and the Super Admin listings table showing paid and refunded counts.

**Architecture:** Staff-made listings become a `ListingDraft` (JSON payload, not a `Listing` row) that waits for an `OwnerConfirmation` (hashed token, 7-day expiry, texted by the system, never returned to staff). Owner confirmation submits a new maker-checked approval kind `listing.staff_create`, whose `apply` reuses the existing publish code from `portfolio/proposals.py` (`apply_listing_create`) and a new event branch. A business registered by staff gets the same owner confirmation, and `business.kyc` refuses approval until it is confirmed. Targets swap the `renewals` metric for `listings`, counted from `Listing.created_by_staff` / `Event.created_by_staff` rows that are published/approved. Purchase counts are computed per listing at read time from orders, service requests, bookings and tickets, with ledger refund rows used where they exist.

**Tech Stack:** Django 5.2 / DRF / Postgres (`backend/`), Celery (eager under tests), React flat layout with TanStack Query and inline `C`/`D` styling (`frontend/`), Vitest + MSW.

**Spec:** `docs/superpowers/specs/2026-10-19-marketplace-rebrand-design.md`, section "Plan 3 — Staff listing pipeline", Constraints (anti-goals: no staff member approving their own listing; no business listed without the client's confirmation), and "Decisions from the builder check" (owner confirmation link: the system texts it, the scout never sees it, the approver sees the number it went to). Roles come from `docs/superpowers/specs/2026-10-07-staff-platform-overview-design.md` section 2.

**Depends on (order: Plan 1, Plan 2, Plan 3, Plan 4):**
- **Plan 1:** the department/category tree (the staff listing form shows the full tree, as any listing business does); the pre-opening gate leaves staff and business accounts alone, so nothing here changes it. Plan 3 backend work (Tasks 1-9) does not need Plan 1; the listing form (Task 10) uses Plan 1's category endpoint.
- **Plan 2:** variants and media (9 images, 2 videos, YouTube links) appear in the staff listing form and in `ListingDraft.payload`; Task 10 mounts Plan 2's variant and media editors rather than building its own. If Plan 2 is not merged yet, Task 10 ships the existing fields (`ProposedListingSerializer` fields, 8 staged photos) and leaves a single `MEDIA_EDITOR` seam for Plan 2. Ashanti Direct (Plan 2) is a company-owned business: if Plan 2 flags it, drafts for it skip the owner text (Task 5 `needs_owner_text()`), but still go through maker-checker approval.
- **Plan 4:** none. The paid/refunded numbers are computed from orders, service requests, bookings and tickets, not from Plan 4 screens. Plan 4's "Sell on AshantiHub" tile (customer-started registration) is a different door and is not touched.

## Global Constraints

- **No direct business-to-customer contact; no fabricated data.** The owner confirmation text goes from AshantiHub to the owner of a business a staff member is onboarding, never to a shopper. Where the SMS provider is `simulated` the UI says "Not sent: texts are simulated" (as `wallets/vendor_texts.py` does); it never shows a "sent" state that did not happen.
- **The scout never sees the link.** No API response to any staff account carries the raw token, the link, or its hash. Staff see: masked number (`accounts.phones.mask_phone`), `sent_at`, `expires_at`, state. The raw token exists only in the SMS body and the owner's browser. Add `confirm_token`, `token` field names to `ashantihub/sentry.py` scrubber if a new local/field name is introduced (backend/CLAUDE.md claim-token rule).
- **The approver sees the number the link went to** (spec). Show it through the same masking and "Show full phone number" sudo reveal the KYC review already uses (`RevealOwnerPhoneView`, `portfolio-business-reveal-phone`), not a new raw-phone path (backend/CLAUDE.md: phones leave the server masked). Flag to the owner in the PR that "sees the number" is implemented as masked-with-sudo-reveal.
- **Maker never decides.** `approvals.services.approve()` already refuses the maker; `listing.staff_create` and the KYC door must also hold for a Super Admin maker (Task 3 closes the "Super Admin applies directly" path for this kind). The legacy moderation queue (`listings.moderate`) and the event queue must refuse the creator too (Task 7).
- **Moderated-queue contract** (backend/CLAUDE.md) for anything added to `listings/views.py` or `marketplace/`: `?status=` falls back to pending, approve and reject set `reviewed_by`/`reviewed_at`.
- **Phones:** write through `accounts.phones.normalize_gh_phone()`, match with `phone_key()` / `filter_by_phone()`.
- **Texts:** go through `otp.senders.send_sms`, body GSM-7 plain text per `wallets.vendor_texts.fits()` (use "GHS" never the cedi sign; at most 306 characters), counted by `otp.spend`, never an `OtpEvent`, `phone` local names already in the Sentry denylist. No provider call inside a transaction.
- **Targets history kept.** No `renewals` row is deleted or rewritten; `METRIC_CHOICES` keeps `renewals` so old rows stay valid.
- **Frontend:** no `useMutation`; `components/**` never imports `App.jsx`; inline `C`/`D` palette; reuse `ModerationQueueTabs`; read `DESIGN.md` first; staff menu entries only with their screen; Vitest from `frontend/`; `StaffDashboard.test.jsx` and `BusinessDashboard.test.jsx` change only for intentional behaviour, with the reason in the commit.
- **Backend tests:** `docker compose run --rm web python manage.py test <app>`; mint staff tokens with `accounts.testing.staff_token`; fixtures that create a `Review` set `status=Review.PUBLISHED`.
- **Staging only.** No production promotion without the owner's explicit instruction.

## Review Focus

1. Anything that lets a staff member (Super Admin included) approve what they made: the approvals engine's Super Admin direct-apply branch, the legacy `ModerationApproveView`, the SA listings "Approve" button, the event approval.
2. The confirmation token: stored hashed, single use, never in a response, log line, activity body or Sentry; resend revokes the old one; expired link cannot confirm; `activity_exempt` public view.
3. "Nothing goes live without it": no code path publishes a staff-made listing or verifies a staff-registered business with an unconfirmed owner.
4. Target counting: once, only when approved, attributed to the lister, in the day the approval happened; `renewals` data intact.
5. Paid/refunded counts: each of the four kinds uses the right source and refunds are never counted as unpaid.
6. Lock order for any new `select_for_update` (backend/CLAUDE.md approvals: approval row, target, activity chain).

---

### Task 0: The General Manager (GM) role

Owner ruling 2026-10-19: GM is a new staff role with a dashboard like Super Admin's, reports directly to the Super Admin, **can approve listings but cannot approve money items** (settings changes, withdrawals, refunds and any approval kind that moves or governs money).

**Files:**
- Modify: `backend/accounts/models.py` (`Role.GENERAL_MANAGER = "general_manager"`, 15 chars, fits `max_length=20`; add to `NAME_CHOICES`), `backend/approvals/rules.py` and `backend/approvals/registry.py` (a kind is `money=True` when it governs or moves money: `ledger.setting`, `ledger.fee_rules`, wallet withdrawal and refund kinds, rate-card kinds; GM is never in the approver chain of a `money` kind), `backend/accounts/permissions.py` (GM dashboard permissions: Super Admin's read views minus money-approval actions and minus Super Admin-only configuration), staff creation (`manager` must be a Super Admin for GM), `frontend/components/admin/shell/navModel.js` (a GM menu: Super Admin's menu without "Money rules" editing and approvals of money kinds; read-only money views are fine), `frontend/components/admin/AdminCommandCenter.jsx`
- Create: `backend/accounts/migrations/00NN_seed_general_manager_role.py` (role plus permissions: every Operations permission, `listings.approve_staffed`, listing moderation, read access to the Super Admin dashboards; no `ledger.setting`, wallet-approval or sudo-money permissions)
- Test: `backend/approvals/tests/test_gm_role.py`, `backend/accounts/tests/test_gm_role.py`, `frontend/components/admin/shell/__tests__/navModel.test.js`

**Interfaces:** `approvals.rules.approvers_for(kind, maker)` excludes GM for any kind with `money=True` and includes GM for listing and moderation kinds. A GM staff row requires `manager` to be a Super Admin; the Super Admin sees the GM in their reporting line.

- [ ] **Step 1: Failing tests:** `test_gm_can_approve_listing_kinds`, `test_gm_never_in_chain_for_money_kinds` (setting, fee rules, withdrawal resolution, refund), `test_gm_cannot_approve_own_listing_request`, `test_gm_requires_super_admin_manager`, `test_gm_cannot_edit_money_rules_or_approve_pending_setting` (403), frontend `GM menu hides money approvals and Money rules editing`.
- [ ] **Step 2: Run** `docker compose run --rm web python manage.py test approvals accounts` and `cd frontend && npm run test -- navModel` — Expected: FAIL.
- [ ] **Step 3: Implement** the role, the `money` flag on the listed kinds, the seed and the menu.
- [ ] **Step 4: Run** the same commands plus `... test portfolio staff` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(accounts): General Manager role that approves listings but no money items`

---

### Task 1: Targets backend — `listings` replaces `renewals`

**Files:**
- Modify: `backend/targets/models.py` (constants and choices), `backend/targets/services.py` (`LABELS`, `HOW`, `actual`), `backend/targets/management/commands/set_scout_targets.py` (help text, `--listings` arrives through `METRICS`), `backend/targets/views.py`, `backend/targets/report_provider.py`, `backend/operations/scoreboard.py`, `backend/realtime/publish.py` (comment and any `renewals` key), `backend/insights/sales.py` (only if it keys off targets metrics; its "renewals" is event renewals and stays)
- Create: `backend/targets/migrations/00NN_listings_metric.py` (choices alter only; no data change)
- Test: `backend/targets/tests/test_services.py`, `test_api.py`, `test_report_provider.py`, `backend/operations/tests/test_scoreboard.py`, `backend/operations/tests/test_report_provider.py`

**Interfaces:**
- `targets.models`: `LISTINGS = "listings"`; `METRICS = (REGISTRATIONS, VISITS, CALLS, LISTINGS)` (RENEWALS leaves `METRICS`); `LEGACY_METRICS = (RENEWALS,)`; `METRIC_CHOICES` lists all five so old rows stay valid.
- `targets.services.actual(staff, LISTINGS, start, end) -> int`: published `listings.Listing` with `created_by_staff=staff` and `reviewed_at` in `day_bounds(start, end)`, plus approved `events.Event` with `created_by_staff=staff` and `reviewed_at` in the same bounds (Event column arrives in Task 4; guard with the field so this task can land first, then the event branch is added in Task 7). `actual(staff, RENEWALS, ...)` keeps working (history reads).
- `LABELS[LISTINGS] = "Listings"`, `HOW[LISTINGS] = "Count when Operations approves a listing you made for a business"`.

- [ ] **Step 1: Write failing tests.**
  - `test_services.ListingsMetricTests.test_metrics_exclude_renewals_include_listings`: `METRICS == ("registrations","visits","calls","listings")`; `"renewals" in dict(METRIC_CHOICES)`.
  - `test_counts_only_approved_listing_made_by_scout`: three `Listing`s with `created_by_staff=scout`: PUBLISHED today, PENDING_REVIEW today, REJECTED today; `actual(...)==1`.
  - `test_counts_once_by_approval_day_not_creation_day`: created two days ago, `reviewed_at` today counts today and not on creation day.
  - `test_other_scouts_listing_and_owner_made_listing_not_counted`.
  - `test_historic_renewals_plan_row_survives`: a `TargetPlan(metric="renewals")` still saves; `period_summary` omits it.
  - `test_actual_renewals_still_computable_for_history`.
  - `test_api.test_limits_accept_listings_and_refuse_renewals`: `POST/PATCH` plans with `{"listings": 2}` is 200; `{"renewals": 1}` is 400 "renewals is not a measure." (via `plans.clean_values`).
  - `test_scoreboard` and `test_report_provider` fixtures swap renewals for listings; assert totals key `listings`.
- [ ] **Step 2:** `docker compose run --rm web python manage.py test targets operations` — see the new tests fail.
- [ ] **Step 3: Implement** the constants, `actual` branch, labels, command help (`--listings`), and replace each `RENEWALS`/"renewals" reference in views, report provider, scoreboard and realtime comment found by `grep -rn renewals backend/targets backend/operations backend/realtime`. `makemigrations targets` (choices only).
- [ ] **Step 4:** run `... test targets operations insights realtime` — pass.
- [ ] **Step 5: Commit** `feat(targets): count approved listings instead of renewals`.

---

### Task 2: Targets frontend — Listings replaces Renewals

**Files:**
- Modify: `frontend/components/admin/panels/OpsTargetsPanel.jsx` (`METRICS`), `TargetLimitsPanel.jsx` (`LABEL`, description line 22: "Listings a scout gets approved"), `ScoutTodayPanel.jsx` (footnote line 84 "Listings count when Operations approves them."; the `next_renewal` / `overdue` copy at lines 180-186 is about subscription renewal near-completions, keep only if the backend still sends them, otherwise remove with the test), `OpsScoutsPanel.jsx`, `StaffProfilePanel.jsx`, `hooks/useOpsPeople.js` (comment), `mocks/handlers.js`
- Test: `frontend/components/admin/panels/__tests__/TargetsPanel.test.jsx`, `OpsTargetsPanel.test.jsx`, `ScoutTodayPanel.test.jsx`, `OpsScoutsPanel.test.jsx`, `OperationsOverviewPanel.test.jsx`, `SettingsScreens.test.jsx`, `ReportsPanel.test.jsx`, `components/admin/stepin/__tests__/StepIn.test.jsx`, `components/admin/__tests__/OperationsPeople.test.jsx`

**Interfaces:** metric key `listings`, label "Listings"; no UI offers `renewals`.

- [ ] **Step 1:** Update test fixtures and add assertions: `OpsTargetsPanel` shows a "Listings" input and no "Renewals"; `ScoutTodayPanel` renders a Listings row with `done/target`; `TargetLimitsPanel` row text.
- [ ] **Step 2:** `cd frontend && npx vitest run components/admin/panels/__tests__/OpsTargetsPanel.test.jsx components/admin/panels/__tests__/ScoutTodayPanel.test.jsx` — fail.
- [ ] **Step 3: Implement** the label swaps and MSW handler payloads.
- [ ] **Step 4:** run the whole list above plus `npx vitest run components/admin` — pass.
- [ ] **Step 5: Commit** `feat(staff-ui): listings target replaces renewals`.

---

### Task 3: Permission and a maker-checked approval flag

**Files:**
- Modify: `backend/approvals/registry.py` (`ApprovalKind.maker_checked: bool = False`), `backend/approvals/services.py` (`_submit`: the Super Admin direct-apply branch is skipped when `kind.maker_checked`; the request is staged like any other), `backend/approvals/rules.py` (`default_chain`/`approvers_for` must put a Super Admin maker's request in front of Operations, GM and other Super Admins, never the maker)
- Create: `backend/accounts/migrations/00NN_seed_listing_staging_permissions.py` (permissions `listings.stage` — "Register businesses, add prospects and draft listings for a client", and `listings.approve_staffed` — "Approve listings staff made for a client"); roles: `listings.stage` to scout, operations, super_admin; `listings.approve_staffed` to operations, super_admin and (Task 0) general_manager
- Test: `backend/approvals/tests/test_engine.py`, new `backend/approvals/tests/test_maker_checked.py`

**Interfaces:**
- `ApprovalKind(maker_checked=True)`: `submit()` by any maker leaves status `pending`.
- **GM:** the role is built in Task 0 (owner ruling 2026-10-19). `listings.approve_staffed` is granted to Operations, Super Admin and General Manager; GM is excluded from every `money` approval kind.

- [ ] **Step 1: Failing tests.**
  - `test_super_admin_maker_of_maker_checked_kind_is_pending_not_applied` (a test kind registered with `maker_checked=True` and unregistered afterwards, as `approvals/tests/kinds.py` does).
  - `test_super_admin_maker_cannot_approve_own`: `approve(...)` raises the existing maker error.
  - `test_other_super_admin_can_approve_super_admin_made_request`.
  - `test_non_maker_checked_kind_still_applies_directly` (regression).
  - `test_permission_seed`: operations and super_admin hold `listings.approve_staffed`; scout does not; scout holds `listings.stage`.
- [ ] **Step 2:** `docker compose run --rm web python manage.py test approvals accounts` — fail.
- [ ] **Step 3: Implement** the flag, the `_submit` branch (keep the `ApprovalRequest` insert, `_enter_stage`, `_notify_approvers`, `record("approval.requested")` path), the migration.
- [ ] **Step 4:** run `... test approvals accounts portfolio` — pass.
- [ ] **Step 5: Commit** `feat(approvals): maker-checked kinds never apply directly, even for Super Admin`.

---

### Task 4: Draft and confirmation models, and the confirmation service

**Files:**
- Create: `backend/portfolio/confirmations.py`, `backend/portfolio/migrations/00NN_listing_drafts_confirmations.py`, `backend/portfolio/tests/test_confirmations.py`
- Modify: `backend/portfolio/models.py` (two models), `backend/events/models.py` (`Event.created_by_staff` FK to `accounts.StaffUser`, null, `related_name="events_created_for_owners"`; migration in `backend/events/migrations/`), `backend/portfolio/tasks.py` (hourly `notify_lapsed_confirmations`), `backend/ashantihub/sentry.py` (token field names)
- Modify: `backend/accounts/models.py` only if a registration-confirmed marker is needed (see below); prefer `OwnerConfirmation` rows for registration so `BusinessOwner` is untouched.

**Interfaces:**
- `portfolio.models.ListingDraft`: `business_owner` FK, `kind` in `product|service|event|stay`, `payload` JSON (the `ProposedListingSerializer` fields plus Plan 2 `variants`/`media` keys), `main_photo_id`/`photo_ids` inside payload, `created_by` FK StaffUser, `confirmation` FK `OwnerConfirmation` (null), `status` in `draft|awaiting_owner|owner_confirmed|owner_declined|withdrawn|submitted`, `approval` FK `approvals.ApprovalRequest` null, `created_at`, `updated_at`. A draft whose confirmation `expires_at < now` and is unconfirmed **reads as `lapsed`** (derived, like promotions' "expired"; the task only notifies).
- `portfolio.models.OwnerConfirmation`: `business_owner` FK, `scope` in `registration|listings`, `token_hash` unique (SHA-256 via `accounts.claims.hash_token`), `sent_to` (normalized phone), `sent_at`, `send_state` in `queued|sent|failed|simulated|no_phone`, `expires_at` (`now + timedelta(days=7)`), `confirmed_at`, `declined_at`, `revoked_at`, `created_by` FK StaffUser, `resend_count`.
- `confirmations.request_confirmation(owner, staff, *, drafts=(), registration=False) -> OwnerConfirmation`: one link per call covering the registration (if unconfirmed and `registration=True`) and the given drafts; revokes older open links for the owner (locks the owner row first, as `claims._issue`); texts after commit with a lambda that logs its own errors; body e.g. `"AshantiHub: <staff first name> asks you to confirm <n> item(s) for <business>. Open <link>. Valid 7 days."` must pass `vendor_texts.fits()`.
- `confirmations.resend(confirmation_or_draft_ids, staff)`: allowed when the link lapsed, was revoked or failed; at most 3 per draft per day; refuses `owner_confirmed`/`submitted`.
- `confirmations.state_of(draft) -> {"state", "sent_to_masked", "sent_at", "expires_at", "send_note"}`; never includes token or hash.
- `confirmations.owner_view(raw) / confirm(raw, request) / decline(raw, reason, request)`: look up by hash; `expired`/`used`/`invalid` use the `ClaimError`-style codes; `confirm` marks drafts `owner_confirmed` and registration confirmed in one transaction, then hands each draft to `submit_draft(draft)` (Task 7).
- `confirmations.registration_confirmed(owner) -> bool`: any `OwnerConfirmation(scope=registration, confirmed_at not null)`, or `owner.registration_channel != "scout"` and registrar is not staff (online registrants confirm by their own OTP, unchanged), or owner registered before this release (grandfathered: `registered_by` set and `created_at < release_cutoff` constant, so existing businesses are not blocked).

- [ ] **Step 1: Failing tests** (`test_confirmations.py`):
  - `test_link_valid_seven_days`: confirm at day 6 ok; at 7 days + 1 s answers `expired`.
  - `test_token_stored_hashed_and_never_returned`: `OwnerConfirmation.token_hash != raw`; serialized `state_of` has no `token`/`link` keys; the raw token appears only in `otp.senders.sms_outbox[-1].body`.
  - `test_text_goes_to_owner_login_phone_normalized` and `test_body_fits_gsm7_and_306`.
  - `test_resend_revokes_old_link_and_old_token_fails_used`.
  - `test_lapsed_draft_reads_lapsed_then_resend_revives_it`.
  - `test_single_use_second_confirm_fails_used`.
  - `test_confirm_moves_drafts_to_owner_confirmed_and_registration_confirmed`.
  - `test_decline_marks_owner_declined_and_notifies_creator`.
  - `test_simulated_provider_sets_send_state_simulated` (no pretend "sent").
  - `test_resend_rate_limit_three_per_day`.
  - `test_registration_confirmed_grandfathers_existing_owner`.
- [ ] **Step 2:** `docker compose run --rm web python manage.py test portfolio.tests.test_confirmations` — fail.
- [ ] **Step 3: Implement** models, migrations, service, hourly task registration in the existing Celery beat schedule (find where `portfolio/tasks.py` jobs are scheduled), Sentry names.
- [ ] **Step 4:** `... test portfolio events` — pass.
- [ ] **Step 5: Commit** `feat(portfolio): listing drafts and owner confirmation by text link`.

---

### Task 5: Staff endpoints — prospects, registration, drafts

**Files:**
- Modify: `backend/portfolio/views.py`, `backend/portfolio/urls.py`, `backend/portfolio/registration.py` (`register_business`: accept an Operations or Super Admin registrar; `location_set_by` already handles non-scouts; assign no account manager unless the registrar holds `portfolio.manage` as today), `backend/portfolio/proposals.py` (`_require_account_manager` stays for scouts; Operations/Super Admin with `portfolio.manage` bypass it for drafts), `backend/field/views.py` + `backend/field/urls.py` + `backend/field/prospects.py` (Operations/Super Admin can add prospects for a named scout or unassigned; `Prospect.scout` is `PROTECT` and required, so Operations adds on behalf of the scout it picks, defaulting to itself only if it holds the scout role; no schema change), `backend/accounts/permissions.py` if a helper `can_stage_for_clients(user)` is wanted
- Create: `backend/portfolio/drafts.py` (create/update/withdraw/list), `backend/portfolio/tests/test_staff_drafts.py`
- Test: `backend/portfolio/tests/test_register_by_operations.py`, `backend/field/tests/` (prospect tests; find the existing prospect test module and extend it)

**Interfaces:**
- `POST /api/portfolio/register/` unchanged contract; now allowed for roles holding `businesses.register` (scout, operations; super_admin via its permissions). After creating the owner it calls `confirmations.request_confirmation(owner, registrar, registration=True)` in the same request (after commit send) and the response carries `confirmation: {state, sent_to_masked, expires_at}` (never a token).
- `POST /api/portfolio/businesses/<id>/drafts/` (permission `listings.stage`; body = listing fields + `kind`) -> `ListingDraft`; validation reuses `portfolio.proposals.check_listing`/`ProposedListingSerializer`, event kind validates with the events serializer rules (find in `events/serializers.py`).
- `GET /api/portfolio/businesses/<id>/drafts/` list with `confirmation` state; `PATCH .../drafts/<id>/` (only while `draft` or `lapsed`); `DELETE` = withdraw; `POST .../drafts/send/` body `{draft_ids:[...]}` -> `request_confirmation`; `POST .../drafts/<id>/resend/`.
- Scope: scouts only for businesses they manage (existing `_require_account_manager`); Operations/Super Admin for any business (`listings.stage` plus `portfolio.manage` or Super Admin).
- `needs_owner_text(owner) -> bool` in `confirmations.py`: True always for now; Plan 2's Ashanti Direct flag turns it False for that business (one-line seam).

- [ ] **Step 1: Failing tests.**
  - `test_operations_can_register_business_and_owner_text_is_sent` (outbox has one text to the owner phone; response has no `token`).
  - `test_super_admin_can_register_business`; `test_support_cannot` (403).
  - `test_scout_cannot_draft_for_business_they_do_not_manage` (403/404 per existing helper); `test_operations_can_draft_for_any_business`.
  - `test_draft_per_kind_validates`: product, service, stay (accommodation category with `units_total`), event each create a draft; an invalid price is 400.
  - `test_editing_draft_after_send_invalidates_confirmation`: PATCH while `awaiting_owner` returns to `draft` and revokes the link (the owner confirms what they saw).
  - `test_draft_response_never_contains_link_or_token`.
  - `test_operations_adds_prospect_for_scout` and `test_prospect_phone_dedupe_still_applies`.
  - `test_every_write_recorded_in_activity_without_phone` (activity body holds no full number).
- [ ] **Step 2:** `docker compose run --rm web python manage.py test portfolio field` — fail.
- [ ] **Step 3: Implement** views, urls, services; reuse `activity.services.record` for `listing_draft.created|sent|withdrawn`.
- [ ] **Step 4:** run `... test portfolio field accounts` — pass.
- [ ] **Step 5: Commit** `feat(portfolio): staff can register, add prospects and draft listings for clients`.

---

### Task 6: Public owner confirmation endpoints, and the KYC gate

**Files:**
- Modify: `backend/portfolio/urls.py` or `backend/accounts/urls.py` (public routes; follow where `claim` lives), `backend/portfolio/approval_kinds.py` (`_kyc_validate`: refuse when `not confirmations.registration_confirmed(owner)` with the message "The owner has not confirmed this registration yet."; `_kyc_diff`/`_kyc_consequences`: add rows "Owner confirmation: Confirmed <date> / Waiting, text sent to <masked number> on <date>, expires <date>"), `backend/accounts/kyc.py` (`approve_owner` guard so the plain KYC queue obeys the same gate; extend `address_decision_missing`-style helper `confirmation_missing`), `backend/portfolio/serializers.py` (review sheet fields)
- Create: `backend/portfolio/views_confirm.py`
- Test: `backend/portfolio/tests/test_confirm_views.py`, `backend/accounts/tests/` KYC approve tests (extend the module that covers `approve_owner`)

**Interfaces:**
- `GET /api/portfolio/confirm/?token=` (public, `AllowAny`, `activity_exempt = True`, throttled): `{business_name, owner_name_first, registration: bool, items: [{kind, name, price}], expires_at}`; never other businesses' data, no phone, no email.
- `POST /api/portfolio/confirm/` body `{token}` -> confirms; `POST /api/portfolio/confirm/decline/` body `{token, reason?}`. Each records its own activity event (`business.registration_confirmed`, `listing_draft.owner_confirmed`, `listing_draft.owner_declined`) with no token or phone.
- KYC gate: both doors (`business.kyc` approval and the KYC queue) answer 409 `confirmation_missing` until confirmed. The registrar can never be the one who confirms (the link only works by token, and staff have no token).

- [ ] **Step 1: Failing tests.**
  - `test_preview_shows_items_without_phone_or_email`.
  - `test_confirm_ok_then_replay_is_used`; `test_expired_is_expired_with_resend_hint`; `test_garbage_token_invalid`.
  - `test_confirm_throttled_after_n_bad_tokens`.
  - `test_kyc_approval_blocked_until_registration_confirmed` (both `approvals.approve` and the KYC queue view): 409; after `confirm` it succeeds.
  - `test_kyc_review_shows_masked_number_and_state` (approver sees `ne***` masked via `mask_phone`, plus waiting/confirmed and the expiry).
  - `test_registration_confirmation_does_not_verify_kyc` (confirmed owner still `pending` KYC).
  - `test_activity_events_contain_no_token`.
- [ ] **Step 2:** `docker compose run --rm web python manage.py test portfolio accounts` — fail.
- [ ] **Step 3: Implement.** Reuse `ClaimError` shape for refusals; throttle with an existing scoped DRF throttle used by the claim view.
- [ ] **Step 4:** run `... test portfolio accounts approvals` — pass.
- [ ] **Step 5: Commit** `feat(portfolio): owner confirms registration and listings from a texted link`.

---

### Task 7: Listing approval kind `listing.staff_create`, and maker-checker on the old doors

**Files:**
- Create: `backend/portfolio/staff_listing_kind.py` (kind callbacks), `backend/portfolio/tests/test_staff_listing_approval.py`
- Modify: `backend/portfolio/approval_kinds.py` (register `LISTING_STAFF_CREATE` in `KINDS`), `backend/portfolio/proposals.py` (factor the publish body of `apply_listing_create` into a shared `publish_listing(owner, listing_data, photos, *, maker, decided_by)` so both kinds use it), `backend/listings/views.py` (`ModerationApproveView`, `ModerationRejectView`: 403 `own_listing` when `listing.created_by_staff_id == request.user.id`), `backend/events/views.py` (event approve: same guard on `Event.created_by_staff`), `backend/marketplace/listings.py` only if it has its own approve (the SA panel posts to `/api/listings/moderation/<id>/approve/`, so it is covered)
- Test: `backend/listings/tests/test_listing_moderation.py`, `backend/events/tests/test_event_moderation.py` (add cases)

**Interfaces:**
- `LISTING_STAFF_CREATE = ApprovalKind(key="listing.staff_create", label="Listing made for a client", pool_permission="listings.approve_staffed", maker_checked=True, response_hours=24, current_state=..., apply=..., validate=..., render_diff=..., consequences=..., on_rejected=portfolio.approval_kinds.returned_task)`.
- `submit_draft(draft)`: called by `confirmations.confirm`; `approvals.services.submit(draft.created_by, "listing.staff_create", target_type="portfolio.listingdraft", target_id=draft.pk, title=..., payload={"draft_id": ...})`; sets `draft.status="submitted"`, `draft.approval=...`.
- `validate`: owner KYC verified, owner confirmation present (`draft.status == "owner_confirmed"`), subscription live and within its limit (reuse `validate_listing_create` checks), photos unused; fails with `ApprovalError`.
- `apply`: kinds product/service/stay publish a `Listing` (`status=PUBLISHED`, `created_by_staff=maker`, `reviewed_by=decided_by`, `reviewed_at=now`) through `publish_listing`; kind event creates an `Event` (`status=approved`, `submitted_by_business=owner`, `created_by_staff=maker`, `approved_by`/`reviewed_by` = decider, `reviewed_at=now`), unpaid: the owner still pays the visibility window as any event does (note in the PR for the owner). Plan 2 `variants`/`media` keys in the payload are applied by Plan 2's helper `apply_listing_extras(listing, payload)` if present.
- `render_diff`: includes "Owner confirmed <date>", "Text sent to <masked number>" and "Listed by <staff> (Scout|Operations|Super Admin)" rows. `consequences`: "It counts toward <first name>'s listings today." for scouts.
- Approvers: any holder of `listings.approve_staffed`, never the maker (engine rule), including when the maker is Operations or Super Admin.

- [ ] **Step 1: Failing tests.**
  - `test_scout_draft_confirmed_by_owner_creates_pending_approval_not_listing` (no `Listing` row exists yet).
  - `test_operations_approves_scout_listing_publishes_with_created_by_staff`.
  - `test_super_admin_made_listing_waits_for_someone_else`; `test_operations_made_listing_cannot_be_approved_by_that_operations_user`.
  - `test_unconfirmed_draft_cannot_be_approved` (validate refuses).
  - `test_lapsed_confirmation_blocks_submit`.
  - `test_event_draft_apply_creates_approved_unpaid_event`; `test_stay_draft_creates_accommodation_listing`.
  - `test_legacy_moderation_approve_refuses_own_listing_403`; `test_event_approve_refuses_own_event`.
  - `test_reject_returns_task_to_maker` (`on_rejected`).
  - `test_stale_approval_409_when_owner_suspended` (engine stale guard through `current_state`).
- [ ] **Step 2:** `docker compose run --rm web python manage.py test portfolio listings events approvals` — fail.
- [ ] **Step 3: Implement**; wire event branch into `targets.services.actual(LISTINGS)` (Task 1 left a guard).
- [ ] **Step 4:** run `... test portfolio listings events approvals targets` — pass.
- [ ] **Step 5: Commit** `feat(portfolio): staff-made listings publish only after owner confirmation and a second person's approval`.

---

### Task 8: Pipeline backend — a listings step for prospects

**Files:**
- Modify: `backend/field/prospects.py`, `backend/field/serializers.py`, `backend/field/views.py` (list payload), `backend/field/models.py` only if a stage cannot be derived (it can: no schema change)
- Test: `backend/field/tests/` (the prospect list test module)

**Interfaces:** each prospect row gains `pipeline: {stage, listings: {drafts, awaiting_owner, lapsed, pending_approval, live}}` where `stage` is derived: `prospect` (not registered), `registered` (linked `registered_business`), `awaiting_owner` (registration unconfirmed), `confirmed` (registration confirmed), `listing` (at least one draft/listing for the business by this scout), `live` (at least one of this scout's listings published). Status counts in the response (`counts`) gain `registered` is untouched; add `listings_live_this_month` beside `signed_up_this_month`.

- [ ] **Step 1: Failing tests:** `test_prospect_row_has_pipeline_stage_for_each_state`; `test_listing_counts_only_this_scouts_drafts`; `test_listings_live_this_month_counts_approved_this_month_only`; `test_no_queries_explosion` (assert query count with 20 prospects is constant, `assertNumQueries` upper bound).
- [ ] **Step 2:** `docker compose run --rm web python manage.py test field` — fail.
- [ ] **Step 3: Implement** with annotations/prefetch, not per-row queries.
- [ ] **Step 4:** pass.
- [ ] **Step 5: Commit** `feat(field): prospect pipeline reports the listings step`.

---

### Task 9: Super Admin listings table — paid and refunded counts

**Files:**
- Create: `backend/marketplace/sales_counts.py`, `backend/marketplace/tests/test_sales_counts.py`
- Modify: `backend/marketplace/listings.py` (`item()` adds `paid_count`, `refunded_count`; CSV export gets two columns), `backend/marketplace/events.py` (same two numbers per event), `backend/marketplace/views` none new
- Test: `backend/marketplace/tests/test_listings.py`, `test_events.py`

**Interfaces:** `sales_counts.for_listings(listing_ids) -> {id: (paid, refunded)}` and `sales_counts.for_events(event_ids)`; both are bulk (a few grouped queries per page, never per row). Definitions, written in the module docstring and shown in the column tooltip:
- **Product:** paid = distinct `orders.Order` with `status` paid, or cancelled after a successful payment, containing an `OrderItem` for the listing (read how `orders/` and `payments/` mark payment, since `Order` has no `paid_at`; confirm against `payments.CheckoutSession` success rows before choosing); refunded = those orders with an `ledger.OrderRefund` row (ledger on) or, when the ledger is off, cancelled-after-paid orders. `quantity` is not summed: one purchase = one count.
- **Service:** paid = `services.ServiceRequest` with `paid_at` not null; refunded = a `ledger.BookingRefund` on its `ledger.BookingSale`, else status `cancelled` after `paid_at`.
- **Stay:** paid = `bookings.Booking` with `paid_at` not null; refunded = `BookingRefund` on its sale, else `cancelled_at` set with `paid_at` set.
- **Event:** paid = `events.Ticket` rows of the event's ticket types (each ticket counts once); refunded = tickets with `refunded_at` set or a `BookingRefund` with source `ticket-<id>`.
- Rule: refunded is a subset of paid; a refunded purchase still counts in paid. Listings with no purchases return `0`/`0` (a real zero, not hidden).

- [ ] **Step 1: Failing tests** (one per kind plus edges): `test_product_paid_counts_orders_not_units`; `test_product_cancelled_before_payment_not_paid`; `test_product_whole_refund_counted_in_both`; `test_service_request_paid_and_refunded`; `test_stay_booking_cancelled_after_pay_is_refunded`; `test_event_tickets_paid_and_refunded_at_ticket_level`; `test_ledger_off_falls_back_to_cancel_markers`; `test_listing_row_has_two_numbers_and_query_count_bounded`; `test_csv_export_has_columns`; `test_refunded_never_exceeds_paid`.
- [ ] **Step 2:** `docker compose run --rm web python manage.py test marketplace` — fail.
- [ ] **Step 3: Implement** grouped `Count(distinct=True)` queries keyed by id list; add to the two `item()` functions.
- [ ] **Step 4:** run `... test marketplace orders services bookings events` — pass.
- [ ] **Step 5: Commit** `feat(marketplace): paid and refunded counts on the listings and events tables`.

---

### Task 10: Staff listing and registration screens (frontend)

**Files:**
- Create: `frontend/components/admin/panels/ClientListingsPanel.jsx` (drafts for one business: list, create, edit, send, resend, withdraw, with confirmation state), `frontend/components/admin/panels/ClientListingForm.jsx` (kind picker: Product, Service, Event, Stay; fields per kind; mounts Plan 2's variant and media editors and Plan 1's category tree picker, with a single `MEDIA_EDITOR` seam if those are absent), `frontend/hooks/useClientDrafts.js` (`useClientDrafts(businessId)`, plain array)
- Modify: `frontend/components/admin/shell/navModel.js` (a "Client listings" item only for scout, operations, super_admin in `ROLE_MENUS`; screen arrives in this task), `frontend/components/admin/AdminCommandCenter.jsx` (route), the existing business detail panel in the portfolio flow (button "List for this business"), the register screen (see below)
- Modify: the Register screen component used by `ScoutBottomBar`'s Register slot and `AdminCommandCenter`'s `onRegister`; Operations and Super Admin menus gain Register and Prospects entries
- Test: `frontend/components/admin/panels/__tests__/ClientListingsPanel.test.jsx`, `ClientListingForm.test.jsx`, `frontend/components/admin/shell/__tests__/navModel.test.js`

**Interfaces:** panel reads `GET /api/portfolio/businesses/<id>/drafts/`; handlers use plain `apiPost`/`apiPatch`/`apiDelete` with `actionError`, `refetch()` (no `useMutation`). Confirmation line per draft: "Text sent to 024 ••• 1234 on 19 Oct, expires 26 Oct" / "Not sent: texts are simulated" / "Link expired — Resend". No link, no copy-link button, no WhatsApp. A "Send for owner confirmation" button covers all unsent drafts of that business in one text.

- [ ] **Step 1: Failing tests.**
  - `ClientListingForm`: choosing Event shows event date and tickets fields; Stay shows units and nightly price; Product shows warranty/expiry/returns questions.
  - Panel: awaiting draft shows masked number and expiry; lapsed draft shows Resend; after owner-confirmed it shows "Waiting for approval"; no element contains `token`, `link` or `http`.
  - Panel for Operations shows the same drafts and a Register entry exists in the Operations and Super Admin menus (navModel test), scout menu unchanged apart from the new item.
  - Resend failure shows `actionError`.
- [ ] **Step 2:** `cd frontend && npx vitest run components/admin/panels/__tests__/ClientListingsPanel.test.jsx components/admin/panels/__tests__/ClientListingForm.test.jsx components/admin/shell/__tests__/navModel.test.js` — fail.
- [ ] **Step 3: Implement** with `D`/`panelStyles`, 44 px targets, phone layout (breakpoints from `hooks/useBreakpoint.js`), then run `node scripts/staff-layout-audit.js` for overflow.
- [ ] **Step 4:** run those plus `npx vitest run components/admin` and `StaffDashboard.test.jsx` — pass (state the reason if the contract test changes).
- [ ] **Step 5: Commit** `feat(staff-ui): list products, services, events and stays for a client`.

---

### Task 11: Prospects pipeline step, owner confirmation page, approver and Super Admin views (frontend)

**Files:**
- Modify: `frontend/components/admin/panels/ProspectsPanel.jsx` (a per-prospect step row from `pipeline`: Prospect, Registered, Owner confirmed, Listings, Live; header line gains "N listings live in <month>"), `frontend/hooks/useProspects.js`, `frontend/components/admin/panels/SaListingsPanel.jsx` (two new columns "Paid" and "Refunded" with a tooltip stating what each counts; export header), the approvals review sheet that renders `render_diff` rows (shows the masked number and a "Show full phone number" action that reuses `portfolio-business-reveal-phone`), `frontend/App.jsx` (route `/business/confirm`, and exclude `confirm` from the `/business/:id` match exactly as `claim` is excluded)
- Create: `frontend/components/OwnerConfirmPage.jsx` (public: shows business and the items, Confirm and "This is not right" buttons, honest expired/used messages, no sign-in, no password), `frontend/hooks/useOwnerConfirmation.js`
- Test: `frontend/components/admin/panels/__tests__/ProspectsPanel.test.jsx`, `SaListingsPanel` test (find under `__tests__/`; the SA listings test lives in `frontend/StaffDashboard.test.jsx` or a panel test — extend whichever asserts the table), `frontend/components/__tests__/OwnerConfirmPage.test.jsx`

**Interfaces:** `OwnerConfirmPage` calls `GET/POST /api/portfolio/confirm/` and `/decline/`; token read from `?token=` only, kept in component state, not storage; reuse `lib/withoutStaleSignIn.js` (an expired stored sign-in must not block this public page). Copy states: expired -> "This link has expired. Ask your AshantiHub contact to send a new one." Paid/refunded show `0` as `0`, loading as a skeleton, never a dash that implies data.

- [ ] **Step 1: Failing tests.**
  - ProspectsPanel: a prospect with `pipeline.stage="listing"` marks steps through Listings; header shows "3 listings live in October"; unchanged filters still work (existing assertions keep passing).
  - SaListingsPanel: rows show Paid and Refunded numbers from the payload; a row with `0/0` renders `0` and `0`.
  - OwnerConfirmPage: valid token lists items and Confirm posts the token; expired shows the expired message; used shows used; Decline asks for an optional reason; no phone, email or password field present.
  - Approval sheet: renders "Text sent to" row masked; reveal click calls the reveal endpoint.
- [ ] **Step 2:** `cd frontend && npx vitest run components/admin/panels/__tests__/ProspectsPanel.test.jsx components/__tests__/OwnerConfirmPage.test.jsx` — fail.
- [ ] **Step 3: Implement** (MSW handlers in `mocks/handlers.js` for the new endpoints, with the `http://localhost:8000` base).
- [ ] **Step 4:** run those plus `npx vitest run` from `frontend/` — pass; `npm run build`.
- [ ] **Step 5: Commit** `feat: pipeline listings step, owner confirmation page, paid and refunded columns`.

---

### Task 12: Docs, guards and full verification

**Files:**
- Modify: `backend/CLAUDE.md` (new contract bullets: staff-made listings = `ListingDraft` + `OwnerConfirmation` + `listing.staff_create` (maker_checked, Super Admin never applies directly); the confirmation token and masked-number rule; `registration_confirmed` gate on both KYC doors; targets `listings` metric and legacy `renewals`; the paid/refunded definitions), `frontend/CLAUDE.md` (the `/business/confirm` page exclusion from `/business/:id`; `OwnerConfirmPage` keeps the token in state only), `docs/IMPLEMENTATION_INSTRUCTIONS.md` (mark Plan 3 state), `docs/superpowers/specs/2026-10-19-marketplace-rebrand-design.md` (note "GM" resolved as permission `listings.approve_staffed`, pending the owner's naming)
- Test: backend `docker compose run --rm web python manage.py test targets approvals portfolio field listings events marketplace accounts operations realtime`; frontend `cd frontend && npx vitest run`

- [ ] **Step 1:** Add a guard test `backend/portfolio/tests/test_no_link_leak.py`: walk every staff-facing portfolio/marketplace/approvals serializer response for a staged confirmation and assert no value contains the raw token or a URL with `token=`.
- [ ] **Step 2:** Run it — it should already pass; if not, fix the leak.
- [ ] **Step 3:** Update the docs above.
- [ ] **Step 4:** Run the full backend app list and the full frontend suite; fix regressions only if caused by this plan.
- [ ] **Step 5: Commit** `docs: staff listing pipeline contracts`. Stop after the staging deploy request; do not promote to production without the owner's explicit instruction.

---

## Open questions for the owner (record in the PR, do not block the build)

1. **GM:** decided 2026-10-19 — a new General Manager role (Task 0): Super Admin-like dashboard, reports to the Super Admin, approves listings, never money items.
2. **"Approver sees the number":** implemented as the masked number plus the audited full-number reveal the KYC review already has, per the masked-phones rule.
3. **Staff-listed events:** decided 2026-10-19 — approved events still need the organizer's visibility payment, as events do today.
4. **Target limits:** no min/max seeded for `listings`; Operations targets use the default cap of 1000 a day until Super Admin sets limits.
