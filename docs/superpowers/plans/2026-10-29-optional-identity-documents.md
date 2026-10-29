# Optional identity documents and the verified check mark — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a business register with no Ghana Card, certificate or TIN; KYC then rests on the Ghana Post address, and a separate staff-approved identity status drives the verified check mark.

**Architecture:** Add an identity status to `BusinessOwnerProfile` beside the unchanged `kyc_status`. All "identity is proven" readers (public mark, verified filter, featured offers, credit factor, payout-name matching) move to it; all "approved to list" readers stay on `kyc_status`. Identity is submitted from the dashboard (or registration) and decided in the existing KYC queue through new `accounts.kyc` functions.

**Tech Stack:** Django/DRF + Postgres (tests: `docker compose run --rm web python manage.py test <label>`), React/Vite + Vitest (run from `frontend/`).

**Spec:** `docs/superpowers/specs/2026-10-29-optional-identity-documents-design.md`

## Global Constraints

- Customers are untouched: no customer Ghana Card field, flow or mark.
- Still required at registration: business details, contact phone, Ghana Post address in the Ashanti Region (`validate_ashanti_gps`).
- Certificate and TIN are never mandatory (registration or the mark). The Ghana Card number and **both** photos are required for the mark.
- A blank `ghana_card_number` is stored as `NULL`, never `""` (column is `unique`).
- The public listing seller keeps `kyc_status` and adds an identity boolean; no Ghana Card number or photo may appear in any public response.
- Follow `backend/CLAUDE.md` (moderated-queue contract, `is_kyc_submitter` never decides, activity events) and `frontend/CLAUDE.md` (no `useMutation`, inline `C`/`D` palettes, `components/**` never imports `App.jsx`, dark-mode tokens, read `DESIGN.md`).
- Tests first. Commit trailers on every commit: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_014z841QypeCF6wWb7h1WSRr`.
- Staging only; never promote to production without the user's explicit word (`deploy` skill).

## Review Focus

1. Two document-less businesses register back to back (a stored `""` would collide on the unique card number).
2. A partial upload (number and front photo, no back photo) must not become pending or verified.
3. An owner resubmitting while identity is `pending` or `verified` must not overwrite reviewed documents.
4. The registrar, account manager or any `is_kyc_submitter` approving that business's identity is refused (403), like KYC.
5. A KYC-verified business with no identity can publish but shows no mark in the listing detail, card, featured offer or "verified only" filter; a business that was KYC-verified before the migration still shows it.
6. No Ghana Card number or photo in any public response.

(Each line has its test in the task that owns the code: 1 → Task 2, 2/3 → Task 5, 4 → Task 6, 5 → Tasks 1 and 7, 6 → Task 7.)

---

### Task 1: Identity fields, property and migration with backfill

**Files:**
- Modify: `backend/accounts/models.py` (`BusinessOwnerProfile`, `BusinessOwner`)
- Create: `backend/accounts/migrations/0062_identity_status.py` (use the next free number)
- Test: `backend/accounts/tests/test_identity_status.py`

**Interfaces:**
- Produces on `BusinessOwnerProfile`: constants `IDENTITY_NOT_SUBMITTED="not_submitted"`, `IDENTITY_PENDING="pending"`, `IDENTITY_VERIFIED="verified"`, `IDENTITY_REJECTED="rejected"`; fields `identity_status` (CharField 14, default not_submitted), `identity_rejection_reason` (CharField 500, null), `identity_submitted_at`, `identity_reviewed_at` (DateTime, null), `identity_reviewed_by` (FK `StaffUser`, SET_NULL, null, `related_name="identity_reviewed_profiles"`); method `has_identity_documents() -> bool` (card number and both photos present).
- Produces on `BusinessOwner`: property `identity_verified -> bool` (profile exists and status verified).
- Produces in the migration module: `backfill_identity(apps, schema_editor)`.

- [ ] **Step 1: Write failing tests** in `test_identity_status.py`: `test_identity_verified_is_false_without_profile`, `test_has_identity_documents_needs_number_and_both_photos` (number + front only → False), `test_backfill_verifies_every_kyc_verified_owner_even_without_a_card`, `test_backfill_marks_pending_owner_with_full_card_as_identity_pending`, `test_backfill_leaves_pending_owner_without_back_photo_not_submitted`, `test_backfill_leaves_rejected_owner_not_submitted`, `test_backfill_turns_blank_card_number_into_null`. Load the function with `importlib.import_module("accounts.migrations.0062_identity_status").backfill_identity` and call it with `django.apps.apps`.
- [ ] **Step 2: Run** `docker compose run --rm web python manage.py test accounts.tests.test_identity_status` — expect failures (attributes missing).
- [ ] **Step 3: Add the fields, `has_identity_documents`, `identity_verified`; generate the schema migration with `makemigrations accounts -n identity_status`, then add a `RunPython(backfill_identity, migrations.RunPython.noop)` per spec section 5.** The backfill uses `apps.get_model`, not imports.
- [ ] **Step 4: Run the test label again** — expect PASS; also `python manage.py makemigrations --check`.
- [ ] **Step 5: Commit** `feat(accounts): identity status on the business profile, with backfill`.

### Task 2: Documents optional on the owner path

**Files:**
- Modify: `backend/accounts/serializers.py` (`BusinessOwnerProfileUpdateSerializer.validate`, new `validate_ghana_card_number`), `backend/accounts/models.py` (`compute_registration_step`)
- Test: `backend/accounts/tests/test_business_owner_profile_update.py`, `test_scout_registration_step.py`, `test_business_owner_models.py` (update the tests that assert the documents are required: `test_blank_ghana_card_number_is_rejected`, the certificate/TIN-required ones, and the registration-step expectations)

**Interfaces:**
- Produces: `validate_ghana_card_number(self, value) -> str | None` returns `None` for blank/whitespace; `compute_registration_step()` leaves `business_info` once `gps_address` and `business_contact_phone` exist.

- [ ] **Step 1: Write failing tests**: `test_profile_saves_without_any_document`, `test_two_businesses_without_card_numbers_both_save` (the unique-collision case), `test_blank_card_number_is_stored_as_null`, `test_formal_business_saves_without_certificate_or_tin`, `test_missing_gps_address_is_still_rejected`, `test_non_ashanti_gps_is_still_rejected`, `test_registration_step_skips_documents` (profile with gps + contact phone, no card → next step is `plan_selection`/`payment_info`, not `business_info`).
- [ ] **Step 2: Run** the three test modules — expect the new tests to fail.
- [ ] **Step 3: Remove the card-number, certificate and TIN requirements from `validate`; keep the GPS check and the verified-profile lock; drop the document test from `compute_registration_step`.** Edit the older tests that asserted the removed rules to assert the new behavior.
- [ ] **Step 4: Run the modules** — expect PASS.
- [ ] **Step 5: Commit** `feat(accounts): Ghana Card, certificate and TIN are optional at registration`.

### Task 3: Scout registration: card photo optional, "registered" tick

**Files:**
- Modify: `backend/portfolio/serializers.py` (`ScoutRegistrationSerializer`), `backend/portfolio/registration.py` (profile creation near the `ghana_card_front_image=` line and the replaced-photo handling near the `signboard_photo`/`ghana_card_front` loop), `backend/portfolio/checks.py` only if a missing card number breaks `exact_duplicates`
- Test: `backend/portfolio/tests/test_registration.py`, `test_checks.py`

**Interfaces:**
- Produces: `ScoutRegistrationSerializer.ghana_card_front` becomes `required=False`; new `is_formal = serializers.BooleanField(required=False, default=False)`, stored on the profile.

- [ ] **Step 1: Write failing tests**: `test_scout_registers_without_ghana_card_photo_or_number`, `test_registered_tick_is_stored_without_certificate_or_tin` (`is_formal=true`, profile `is_formal` True, `tin` None), `test_two_scout_registrations_without_card_numbers_do_not_collide`, `test_duplicate_check_ignores_missing_card_number`; update tests that expected `ghana_card_front` required.
- [ ] **Step 2: Run** `portfolio.tests.test_registration portfolio.tests.test_checks` — expect failures.
- [ ] **Step 3: Implement** the serializer change, persist `is_formal`, store no photo/`NULL` number when absent, and skip the replaced-photo cleanup for absent files.
- [ ] **Step 4: Run both modules** — PASS.
- [ ] **Step 5: Commit** `feat(portfolio): scouts can register without card photos and tick registered`.

### Task 4: Address decision required for every business

**Files:**
- Modify: `backend/accounts/kyc.py` (`address_decision_missing`)
- Test: `backend/accounts/tests/test_kyc_service.py`, `test_kyc_workflow.py`, `test_kyc_moderation_queue.py` (update expectations)

- [ ] **Step 1: Write failing tests**: `test_self_registered_owner_needs_address_decision_before_approval` (approve → `KycError` with `ADDRESS_FIRST`), `test_self_registered_owner_approves_after_address_decision`, `test_approval_needs_no_ghana_card` (profile with no documents + address decision → verified).
- [ ] **Step 2: Run** the three modules — expect the new tests to fail and some old ones to need the address decision in their setup.
- [ ] **Step 3: Make `address_decision_missing(owner)` return True whenever `profile.address_verified_at` is None (missing profile counts as missing)**, keeping the existing signature. Fix old tests' setup by recording an address decision.
- [ ] **Step 4: Run the modules** — PASS.
- [ ] **Step 5: Commit** `feat(kyc): every business needs a recorded address decision before approval`.

### Task 5: Identity submission service and owner endpoint

**Files:**
- Modify: `backend/accounts/kyc.py`, `backend/accounts/serializers.py`, `backend/accounts/views.py` (`BusinessOwnerProfileUpdateView`, `me`), `backend/accounts/urls.py`
- Test: `backend/accounts/tests/test_identity_submission.py`

**Interfaces:**
- Consumes: Task 1 fields.
- Produces: `kyc.submit_identity(profile) -> bool` (sets `pending` and `identity_submitted_at`, clears the rejection reason, only when status is `not_submitted`/`rejected` and `has_identity_documents()`; returns whether it changed; idempotent); `IdentitySubmissionSerializer` (`ghana_card_number`, `ghana_card_front_image`, `ghana_card_back_image` required; `business_reg_certificate`, `tin`, `is_formal` optional); `GET`/`POST /api/accounts/business-owners/me/identity/` (`IsBusinessOwner`, multipart, name `business-owner-identity`) answering `{identity_status, identity_rejection_reason, identity_submitted_at, is_formal, has_certificate, has_tin}` and never the number or files; `me` and the profile PATCH response gain `identity_status`/`identity_rejection_reason`; the profile PATCH calls `submit_identity` after saving.

- [ ] **Step 1: Write failing tests**: `test_post_with_number_and_both_photos_becomes_pending`, `test_post_without_back_photo_is_400_and_stays_not_submitted`, `test_certificate_and_tin_are_optional`, `test_resubmit_after_rejection_becomes_pending_and_clears_reason`, `test_post_while_pending_is_409`, `test_post_while_verified_is_409_and_documents_unchanged`, `test_works_while_kyc_pending_and_while_kyc_verified`, `test_get_never_returns_card_number_or_photo_urls`, `test_duplicate_card_number_is_400_generic_message`, `test_profile_patch_with_full_card_makes_identity_pending`, `test_profile_patch_with_partial_card_stays_not_submitted`, `test_me_exposes_identity_status`, `test_customer_and_staff_get_403`.
- [ ] **Step 2: Run** `accounts.tests.test_identity_submission` — FAIL.
- [ ] **Step 3: Implement** the service, serializer (reuse `validate_image_content_type`/`validate_document_content_type`; blank number → error here), view, URL, and the two exposure changes. Duplicate card number answers one generic message (no hint who holds it).
- [ ] **Step 4: Run the module plus `accounts.tests.test_me_endpoint` and `test_business_owner_profile_update`** — PASS.
- [ ] **Step 5: Commit** `feat(accounts): owners submit identity documents for the verified mark`.

### Task 6: Staff identity queue and decisions

**Files:**
- Modify: `backend/accounts/kyc.py`, `backend/accounts/serializers.py` (`BusinessOwnerProfileKYCDetailSerializer`, `BusinessOwnerKYCSerializer`), `backend/accounts/views.py`, `backend/accounts/urls.py`, notification kinds if the registry validates them (see `kyc_approved`)
- Test: `backend/accounts/tests/test_identity_review.py`

**Interfaces:**
- Consumes: Task 5 `submit_identity`, `kyc._locked_owner`, `kyc.KycError`.
- Produces: `kyc.approve_identity(owner_id, staff, *, http_request=None) -> BusinessOwner`, `kyc.reject_identity(owner_id, staff, reason, *, http_request=None) -> BusinessOwner`, `kyc.reopen_identity(owner_id, staff, *, http_request=None) -> BusinessOwner` (rejected → pending; clears reason and reviewer pair, per the moderated-queue contract); constant `kyc.IDENTITY_NOT_PENDING`; endpoints `GET kyc/identity/pending/?status=pending|approved|rejected` (unknown → pending; pending oldest by `identity_submitted_at`, history by `-identity_reviewed_at`), `POST kyc/<pk>/identity/approve/`, `.../reject/` (`reason` required), `.../re-review/`, all `kyc.approve`; KYC list/detail rows gain `identity_status`; detail `profile` gains `identity_status`, `identity_rejection_reason`, `identity_submitted_at`.

- [ ] **Step 1: Write failing tests**: `test_approve_sets_verified_reviewer_and_notifies_owner`, `test_reject_requires_reason_and_notifies`, `test_cannot_decide_when_not_pending`, `test_registrar_cannot_approve_identity_403`, `test_account_manager_cannot_approve_identity_403`, `test_decision_records_activity_event`, `test_unknown_status_param_falls_back_to_pending`, `test_queue_orders_pending_oldest_first`, `test_reopen_only_from_rejected`, `test_identity_decision_does_not_change_kyc_status`, `test_kyc_approval_does_not_change_identity_status`, `test_requires_kyc_approve_permission`.
- [ ] **Step 2: Run** `accounts.tests.test_identity_review` — FAIL.
- [ ] **Step 3: Implement** under the lock rules of `approve_owner` (owner row via `_locked_owner`, `record()` last). Approval notice: title "You're verified!", body that products now show the verified check mark; rejection notice carries the reason.
- [ ] **Step 4: Run the module plus `test_kyc_detail`, `test_kyc_moderation_queue`** — PASS.
- [ ] **Step 5: Commit** `feat(kyc): staff review of identity documents`.

### Task 7: Public marks read identity

**Files:**
- Modify: `backend/listings/serializers.py` (`BusinessOwnerMiniSerializer`), `backend/listings/views.py` (the `verified` filter, owner `select_related`), `backend/catalogue/offers.py` (`featured`, `offer_row`), `backend/marketplace/events.py` (`organiser`), `backend/messaging/context.py` (`_business`)
- Test: `backend/listings/tests/test_listing_crud.py` (or the module testing the `verified` filter), `backend/catalogue/tests/` (offers), `backend/messaging/tests/test_desk.py`, new `backend/accounts/tests/test_identity_public_marks.py`

**Interfaces:**
- Consumes: `BusinessOwner.identity_verified`.
- Produces: `BusinessOwnerMiniSerializer` fields `["id","full_name","kyc_status","identity_verified"]`; `?verified=true` filters on `business_owner__profile__identity_status="verified"`; offers' `verified`/`featured`, event organiser `verified` and the support desk's business `verified` read identity. Querysets that read it use `select_related("business_owner__profile")` (or the existing profile join).

- [ ] **Step 1: Write failing tests**: `test_kyc_verified_business_without_identity_has_identity_verified_false`, `test_business_with_verified_identity_has_true`, `test_verified_filter_returns_only_identity_verified_listings`, `test_kyc_verified_unverified_identity_listing_still_publishes` (moderation approve returns 200), `test_featured_offer_skips_business_without_identity`, `test_offer_row_verified_follows_identity`, `test_event_organiser_verified_follows_identity`, `test_pre_migration_verified_business_keeps_mark` (backfill then public read True), `test_public_listing_response_has_no_ghana_card_fields` (JSON string contains neither `ghana_card` nor `business_reg`), plus a query-count assertion for the listing list.
- [ ] **Step 2: Run** those modules — FAIL.
- [ ] **Step 3: Implement** the five reader switches. `ModerationApproveView` and `_kyc_check` stay on `kyc_status`.
- [ ] **Step 4: Run** the modules plus `listings` and `catalogue` full labels — PASS.
- [ ] **Step 5: Commit** `feat: the verified mark follows approved identity documents`.

### Task 8: Credit score and payout names read identity

**Files:**
- Modify: `backend/credit/scoring.py` (`compute_naive_credit_score`), `backend/wallets/names.py` (`verified_names`)
- Test: `backend/credit/tests/test_credit_score.py`, `backend/wallets/tests/` (the destination-name tests)

**Interfaces:**
- Consumes: `BusinessOwner.identity_verified`.
- Produces: `kyc_verified` factor true only for identity verified (key name unchanged for API stability); `verified_names(owner)` returns `[]` unless `identity_verified`.

- [ ] **Step 1: Write failing tests**: `test_kyc_verified_without_identity_gets_no_kyc_factor`, `test_identity_verified_gets_kyc_factor`, `test_business_without_identity_has_no_verified_names`, `test_identity_verified_business_matches_owner_and_business_name`, `test_existing_destinations_are_untouched` (only new additions blocked). `test_destination_refusal_for_unverified_identity_tells_the_owner_to_get_verified` (the refusal in `wallets/destinations.py` names the "Get verified" step in plain words, since the wallet screen shows the API message).
- [ ] **Step 2: Run** `credit` and `wallets` tests — FAIL.
- [ ] **Step 3: Implement** the two switches.
- [ ] **Step 4: Run** `credit`, `wallets` full labels — PASS.
- [ ] **Step 5: Commit** `feat: credit score and payout names follow approved identity`.

### Task 9: Owner registration form

**Files:**
- Modify: `frontend/components/BusinessRegistrationFlow.jsx` (the `business_info` step: remove `required` from the card number, both photos, certificate, TIN; remove the card-number check in `submit`; the formal choice becomes a "This business is registered" tick with the certificate and TIN as optional inputs, hint "You can add these later")
- Test: `frontend/BusinessRegistrationFlow.test.jsx`

**Interfaces:** the PATCH body sends only the fields the owner filled (omit empty files; send `is_formal`).

- [ ] **Step 1: Write failing tests**: `submits the business step with no Ghana Card, certificate or TIN`, `still requires the Ghana Post address`, `shows the registered tick and optional certificate/TIN inputs only when ticked`, `does not send empty file fields`.
- [ ] **Step 2: Run** `cd frontend && npx vitest run BusinessRegistrationFlow.test.jsx` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the file — PASS.
- [ ] **Step 5: Commit** `feat(frontend): Ghana Card and certificate are optional when registering`.

### Task 10: Scout registration form

**Files:**
- Modify: `frontend/components/admin/panels/RegisterBusinessPanel.jsx` (card front photo no longer required; add a "Business says it is registered" tick posting `is_formal`, no certificate/TIN inputs)
- Test: `frontend/components/admin/panels/__tests__/RegisterBusinessPanel.test.jsx`, `RegisterFromProspect.test.jsx`

- [ ] **Step 1: Write failing tests**: `scout can submit without the card photo`, `registered tick posts is_formal`, `no certificate or TIN inputs`.
- [ ] **Step 2: Run** both files — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** both files — PASS.
- [ ] **Step 5: Commit** `feat(frontend): scouts can skip the card photos and tick registered`.

### Task 11: "Get verified" on the business dashboard

**Files:**
- Create: `frontend/hooks/useMyIdentity.js` (GET `/api/accounts/business-owners/me/identity/`, key `['my-identity']`), `frontend/components/dashboard/panels/IdentityPanel.jsx`
- Modify: `frontend/components/dashboard/panels/ProfilePanel.jsx` (render `<IdentityPanel />`; replace the "message Support to update your Ghana Card" wording and the "✓ KYC Verified" label so it speaks of the address)
- Test: `frontend/components/dashboard/panels/__tests__/IdentityPanel.test.jsx`, MSW handlers in `frontend/mocks/handlers.js`

**Interfaces:** `IdentityPanel()` owns its hook; submits with `apiPost` (multipart) in a handler with local `actionError` and `refetch()`, no `useMutation`.

- [ ] **Step 1: Write failing tests**: `not submitted shows the form with the Ghana Card number and both photo inputs, certificate and TIN marked optional`, `submit is blocked until number and both photos are chosen`, `pending shows "in review" and no form`, `rejected shows the reason and the form again`, `verified shows the mark and no form`, `shows the API error`, `never renders the card number back`.
- [ ] **Step 2: Run** `npx vitest run IdentityPanel` — FAIL.
- [ ] **Step 3: Implement** with `D` tokens, honest copy ("Upload your Ghana Card to earn the verified check mark on your products").
- [ ] **Step 4: Run** the file and `ProfilePanel`'s tests — PASS.
- [ ] **Step 5: Commit** `feat(frontend): business dashboard "Get verified" for the check mark`.

### Task 12: Staff identity review

**Files:**
- Create: `frontend/hooks/useIdentityQueue.js` (`useIdentityQueue({status, enabled})`, key `['identity-queue', status]`)
- Modify: `frontend/components/admin/panels/KYCQueuePanel.jsx` (an "Identity" tab beside the address queue, same Pending/Approved/Rejected states), `frontend/components/admin/panels/BusinessKycReview.jsx` (show documents only when present, a plain "No documents provided" otherwise; identity Approve/Reject-with-reason buttons for a pending identity, gated like the existing buttons by `canRecordAddress`-style viewer-decides flag)
- Test: `frontend/components/admin/panels/__tests__/` (KYC queue and review tests), MSW handlers

- [ ] **Step 1: Write failing tests**: `identity tab lists pending identity submissions`, `review sheet shows card and certificate when present and a plain empty line when not`, `approving identity posts to kyc/<id>/identity/approve/ and refetches`, `rejecting needs a reason`, `address approve button does not depend on documents`.
- [ ] **Step 2: Run** the KYC panel tests — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the KYC panel tests — PASS.
- [ ] **Step 5: Commit** `feat(frontend): staff review identity documents in the KYC queue`.

### Task 13: Public check mark and honest copy

**Files:**
- Create: `frontend/components/VerifiedMark.jsx` (small inline-styled "✓ Verified" using theme tokens)
- Modify: `frontend/components/ListingDetailPage.jsx` (beside `SellerRatingBadge`, `item.business_owner?.identity_verified`), `frontend/App.jsx` (`Card`, same flag; render nothing otherwise, no "unverified" label), `frontend/components/Hero.jsx` ("Every listing checked against Ghana Card" → a true line), `frontend/components/dashboard/theme.js` (kyc_verified description), `frontend/components/dashboard/panels/CreditPanel.jsx` (the KYC tip), `frontend/components/FeaturedRow.jsx` (comment only if stale)
- Test: `frontend/components/__tests__/VerifiedMark.test.jsx`, the listing detail/Card tests, `AboutFaqSection.test.jsx` if it asserts the old copy, `CreditPanel.test.jsx`

- [ ] **Step 1: Write failing tests**: `VerifiedMark renders for identity_verified true and nothing for false/undefined`, `listing detail shows the mark only for identity_verified sellers`, `card shows the mark only for identity_verified sellers`, `no unverified label anywhere`, `Hero no longer claims every listing is checked against a Ghana Card`.
- [ ] **Step 2: Run** those files — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the files plus `darkModeLiterals.test.js` and `theme.test.jsx` — PASS.
- [ ] **Step 5: Commit** `feat(frontend): verified check mark on products follows approved identity`.

### Task 14: Docs and full verification

**Files:**
- Modify: `backend/CLAUDE.md` (KYC note: KYC = address, identity status separate and what reads which, address decision for every business, `submit_identity`/`approve_identity`), spec status line to "Implemented"
- No test file.

- [ ] **Step 1: Edit `backend/CLAUDE.md` and the spec status.**
- [ ] **Step 2: Run the full backend suite** `docker compose run --rm web python manage.py test` — expect OK; report any failure with its output.
- [ ] **Step 3: Run the full frontend suite** `cd frontend && npm run test` — expect all pass (mass `[MSW]` failures mean a local `.env`; see CLAUDE.md).
- [ ] **Step 4: Run `docker compose run --rm web python manage.py makemigrations --check`** — expect "No changes detected".
- [ ] **Step 5: Commit** `docs: KYC rests on the address; identity status drives the verified mark`. Stop here: the staging deploy follows the `deploy` skill when the user asks.
