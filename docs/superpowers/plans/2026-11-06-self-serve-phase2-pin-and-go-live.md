# Self-serve Phase 2: shop pin at registration, email confirmation, go-live Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A business registers, shares its shop pin, confirms its email and can submit listings without any staff decision on the business; location is shown as a tier (Located / Verified / Wrong), not a gate.

**Architecture:** A new `accounts/golive.py` answers "may this business submit listings?" from facts (confirmed email, pin, business type, terms). `kyc_status` keeps its meaning (address decision, promo and offer eligibility); `identity_status` keeps gating payouts. Only the listing submit gate and the approval gate stop reading `kyc_status`. The existing pin machinery (`accounts/location_capture.py`, `me/location/`, `LocationPicker.jsx`) is reused, extended with a hand-placed ("manual") pin.

**Tech Stack:** Django/DRF, Postgres, React (Vite, Vitest), Expo/React Native (jest), `openlocationcode` (Plus Codes).

**Spec:** `docs/superpowers/specs/2026-11-05-self-serve-onboarding-design.md` §4, §5, §9a (this plan is its Phase 2). Phase 1 (`docs/superpowers/plans/2026-11-05-self-serve-phase1-subscriptions-off-lenient-gps.md`) must be merged first.

## Global Constraints

- Production is never deployed without the owner's explicit word; stage on `api-test` first (deploy skill).
- Run Vitest from `frontend/`; backend via `docker compose run --rm web python manage.py test <app>` (service is `web`).
- Pin rules stay as built: accuracy <= `MAX_ACCURACY_M` (100) for a device fix, inside the Ashanti box (`accounts.gps.ASHANTI_LAT/ASHANTI_LNG`), KYC-rejected businesses refused, rate-limited by scope `owner_location`.
- A confirmation link is a bearer token: `secrets.token_urlsafe(32)`, only its SHA-256 stored, URL fragment `<FRONTEND_BASE_URL>/confirm-email#token=<raw>`, single use, 48 hours, newer link revokes older, at most 5 sends per business per Accra day (429 `too_many_links`), public endpoints POST-only with the token in the body, `activity_exempt`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store`. No response other than the email carries the raw token.
- Mail sender is `no-reply@theashantihub.com` only (`accounts/emails._send`).
- No fabricated data: a self-placed pin reads "Location shared by the owner"; "Verified location" appears only after `address_verified` with a pin.
- Money stays safe: payout is still gated by `identity_status` (`wallets/destinations.py`); do not touch it.
- `kyc_status` readers other than the two in Task 3 (promo waivers, flash sales, offers, staff-made drafts, insights) are unchanged on purpose.
- Owner-facing copy: plain, says what to do next; never "KYC".

## Review Focus

- Owner has no email (older rows have `email=None`): go-live blocker `email_missing`, dashboard asks for one; never a 500.
- Email changes after confirming: the old confirmation no longer counts (VerifiedContact is matched on the normalised destination).
- Confirmation link used twice, expired, revoked by a newer one, or token garbage: 410/400 with the codes in Task 1, never a 500, never reveals whether an email exists.
- Existing KYC-verified businesses (25 on production) stay live and unchanged with no email confirmation and no new step.
- Pin placed by hand far from a GPS fix, outside Ashanti, or with an accuracy of 4000 m: manual accepted only inside the box; outside refused.
- Two businesses pinned within 25 m (shared market building): flagged for staff, never blocked.
- Old mobile or cached web bundles meet the new `shop_location` step value: mobile is testing-only (not in stores); web bundles are rebuilt on deploy.

---

### Task 1: Email confirmation backend

**Files:**
- Create: `backend/accounts/email_confirmation.py`, `backend/accounts/migrations/0078_emailconfirmationtoken.py` (use the next free number), `backend/accounts/tests/test_email_confirmation.py`
- Modify: `backend/accounts/models.py` (new model), `backend/accounts/emails.py`, `backend/accounts/urls.py`, `backend/accounts/views.py` (`BusinessOwnerRegisterView.create` sends the first email after commit), `backend/ashantihub/settings.py` (throttle scopes), `backend/ashantihub/sentry.py` (denylist `token`-named locals if not covered)

**Interfaces:**
- Produces: `class EmailConfirmationToken(models.Model)`: `business_owner` FK (related_name `email_confirmations`), `email` CharField(254, the normalised address it was sent to), `token_hash` CharField(64, unique), `created_at`, `expires_at`, `used_at` null, `revoked_at` null.
- Produces: `email_confirmation.send(owner) -> None` (raises `ClaimError(code="too_many_links", status_code=429)` past 5/day; raises `ClaimError(code="no_email", status_code=400)` when `owner.email` is empty), `email_confirmation.confirm(raw: str) -> BusinessOwner` (raises `ClaimError` with codes `invalid` 400, `used` 410, `expired` 410, `revoked` 410), `email_confirmation.is_confirmed(owner) -> bool` (a `otp.VerifiedContact(account_type="business_owner", account_id=owner.pk, channel="email", destination=<lower-cased owner.email>)` exists).
- Produces: `emails.send_email_confirmation_email(email: str, link: str) -> None`.
- Produces endpoints: `POST /api/accounts/business-owners/me/email-confirmation/` (owner auth; 204; scope `email_confirmation_send` 10/min) and `POST /api/accounts/email-confirmation/confirm/` (public; body `{"token"}`; 200 `{"email_confirmed": true}`; scope `email_confirmation_confirm` 20/min).

- [ ] **Step 1: Write failing tests** in `test_email_confirmation.py`: `test_send_stores_only_hash_and_mails_fragment_link` (outbox body contains `/confirm-email#token=`, DB has no raw token), `test_confirm_creates_verified_contact`, `test_confirm_twice_is_410_used`, `test_expired_is_410`, `test_newer_link_revokes_older_410_revoked`, `test_sixth_send_in_an_accra_day_is_429`, `test_owner_without_email_gets_400_no_email`, `test_changed_email_unconfirms` (confirm, change `owner.email`, `is_confirmed` is False), `test_garbage_token_is_400_invalid`, `test_responses_never_carry_token_or_hash`, `test_confirm_endpoint_sets_no_store_and_no_referrer_headers`.
- [ ] **Step 2: Run** `docker compose run --rm web python manage.py test accounts.tests.test_email_confirmation` — Expected: FAIL (module missing).
- [ ] **Step 3: Implement** model, migration, module, emails function and the two views, following `accounts/location_capture.py` for token, hash, day-limit and header handling (it is the house pattern). Body of the email: says to open the link to confirm, that it expires in 48 hours, and to ignore if not expected.
- [ ] **Step 4: Registration sends the first email** — in `BusinessOwnerRegisterView.create`, after the owner exists and only when `owner.email`, `transaction.on_commit(lambda: email_confirmation.send(owner), robust=True)`; a send failure never fails registration. Add test `test_registration_with_email_sends_one_confirmation` (use `captureOnCommitCallbacks(execute=True)`).
- [ ] **Step 5: Run** the app tests `... test accounts` — Expected: all pass; `makemigrations --check --dry-run` clean.
- [ ] **Step 6: Commit** `feat(accounts): email confirmation link for business owners`.

### Task 2: Go-live rule

**Files:**
- Create: `backend/accounts/golive.py`, `backend/accounts/tests/test_golive.py`
- Modify: `backend/accounts/serializers.py` (the owner "me" payload), `backend/accounts/models.py` (`compute_registration_step`)

**Interfaces:**
- Consumes: `email_confirmation.is_confirmed`, `location_capture.has_pin(profile)`.
- Produces: `golive.blockers(owner) -> list[str]` of codes in this order: `email_missing`, `email_unconfirmed`, `no_pin`, `no_business_kind`, `terms_missing`; empty means live. `golive.is_live(owner) -> bool`. An owner is live without further checks when `owner.is_company`, or `owner.kyc_status == VERIFIED` (grandfathered: these were approved under the old rule), or `registration_channel == SCOUT` and `kyc_status == VERIFIED`. `golive.MESSAGES: dict[str, str]` owner-facing sentence per code.
- Produces: owner payload fields `go_live: {"live": bool, "blockers": [{"code", "message"}]}`.
- Changes `compute_registration_step` for the self channel (order): `business_info` (needs only `business_contact_phone`; the Ghana Post code is now optional) → `shop_location` (no pin) → `plan_selection` (the business-type step, unchanged name) → `terms` → `complete`. `payment_info` no longer appears in the self chain (still reachable from Profile and Settings). KYC-verified, rejected, company and scout branches are unchanged.

- [ ] **Step 1: Write failing tests**: one per blocker, `test_kyc_verified_owner_is_live_with_no_email`, `test_company_owner_is_live`, `test_blockers_order`, `test_registration_step_sequence_for_a_new_owner` (`business_info`, `shop_location`, `plan_selection`, `terms`, `complete`), `test_payment_info_never_returned_for_self_channel`, `test_rejected_owner_still_complete`, `test_scout_registered_chain_unchanged`.
- [ ] **Step 2: Run** `... test accounts.tests.test_golive` — Expected: FAIL.
- [ ] **Step 3: Implement** `golive.py` and the `compute_registration_step` change; update every existing test that asserted `payment_info` for a self-registered owner (`grep -rn payment_info backend/*/tests`) to the new order, noting each in the commit message.
- [ ] **Step 4: Run** `... test accounts portfolio` — Expected: pass.
- [ ] **Step 5: Commit** `feat(accounts): go-live rule and the shop-location registration step`.

### Task 3: Listings stop waiting on `kyc_status`

**Files:**
- Modify: `backend/listings/views.py:886` (submit for review) and `:1073` (`ModerationApproveView`), `backend/listings/moderation_checks.py:71-75` (`_kyc_check`)
- Test: `backend/listings/tests/test_golive_gate.py`

**Interfaces:**
- Consumes: `golive.is_live`, `golive.blockers`, `golive.MESSAGES`.
- Produces: submit by a not-live owner answers 403 `{"code": "not_live", "blockers": [{"code","message"}]}` and leaves the listing a draft; staff approve of a listing whose owner `is_live` succeeds regardless of `kyc_status`; `_kyc_check` is renamed `_live_check`, id `"live"`, title "Business ready to list", PASS when live else FAIL with the first blocker's message.

- [ ] **Step 1: Write failing tests**: `test_unconfirmed_owner_cannot_submit` (403 `not_live`, status still draft), `test_confirmed_pinned_owner_submits_to_pending_review`, `test_staff_can_approve_when_owner_live_but_kyc_pending`, `test_staff_cannot_approve_when_owner_not_live` (400 with the blocker message), `test_moderation_checks_show_live_check_not_kyc`.
- [ ] **Step 2: Run** `... test listings.tests.test_golive_gate` — Expected: FAIL.
- [ ] **Step 3: Implement** the three edits. Update existing listing fixtures that rely on `kyc_status=VERIFIED` only if they now fail (a verified owner is grandfathered live, so most do not).
- [ ] **Step 4: Run** `... test listings accounts marketing catalogue` — Expected: pass.
- [ ] **Step 5: Commit** `fix(listings): a business that is live may list without a KYC decision`.

Note for the owner: until Phase 3, every submitted listing is still approved by staff. This task removes the business-level wait, not the listing-level one.

### Task 4: Hand-placed pin, landmark, Plus Code, tier, close-pin flag

**Files:**
- Create: `backend/accounts/location_tier.py`, `backend/accounts/pluscode.py`, `backend/accounts/migrations/0079_profile_landmark.py`, `backend/accounts/tests/test_location_tier.py`
- Modify: `backend/accounts/location_capture.py` (`FixSerializer`, `_apply_fix`, `own_state`), `backend/accounts/models.py` (`BusinessOwnerProfile.landmark`), `backend/requirements.txt` (`openlocationcode`), the public business serializer in `listings/serializers.py:187-193` (add `location_tier`)

**Interfaces:**
- Produces: `FixSerializer` gains `manual = BooleanField(required=False, default=False)`; a manual pin skips the accuracy ceiling but still must be inside the Ashanti box and is stored with `location_is_manual=True`, `location_accuracy_m` null; a device fix stores `location_is_manual=False`. `BusinessOwnerProfile.landmark = CharField(max_length=200, blank=True, default="")`, set through `POST me/location/` (`landmark` optional, trimmed, 200 max).
- Produces: `pluscode.encode(lat: Decimal, lng: Decimal) -> str` (10-digit global code, wraps `openlocationcode.encode`), not stored.
- Produces: `location_tier.tier(profile) -> "none" | "located" | "verified" | "wrong"`: `wrong` when `address_verified_at` and not `address_verified`; `verified` when `address_verified` and a pin; `located` when a pin; else `none`. `location_tier.LABELS = {"located": "Location shared by the owner", "verified": "Verified location", "wrong": "Location needs re-sharing", "none": ""}`.
- Produces: `own_state` adds `plus_code`, `landmark`, `tier`, `tier_label`, `is_manual`.
- Behaviour: after a capture, any other business within 25 m raises `fraud.services.raise_flag` with `dedupe_key=f"pin-near-{min_id}-{max_id}"` (flag only; the capture succeeds).

- [ ] **Step 1: Write failing tests**: `test_manual_pin_inside_ashanti_accepted_with_no_accuracy`, `test_manual_pin_outside_ashanti_refused`, `test_device_fix_over_100m_still_refused`, `test_landmark_saved_and_trimmed`, `test_plus_code_for_known_point` (Kumasi centre 6.6885, -1.6244 encodes to the value `openlocationcode.encode` returns; assert 11 characters including `+`), `test_tier_values_for_each_case`, `test_second_business_within_25m_raises_one_flag_and_still_saves`, `test_business_100m_away_raises_no_flag`, `test_public_listing_owner_payload_has_location_tier`.
- [ ] **Step 2: Run** `... test accounts.tests.test_location_tier` — Expected: FAIL.
- [ ] **Step 3: Implement** with a bounding-box prefilter then haversine for the 25 m check (one indexed-range query, no per-row Python loop over all businesses).
- [ ] **Step 4: Run** `... test accounts fraud listings` and `makemigrations --check --dry-run` — Expected: pass, clean.
- [ ] **Step 5: Commit** `feat(accounts): hand-placed pin, landmark, Plus Code and location tier`.

### Task 5: Address-verification queue holds live but unvisited businesses

**Files:**
- Test only: `backend/accounts/tests/test_address_queue_golive.py`

- [ ] **Step 1: Write tests** pinning that a live, email-confirmed business with `tier == "located"` and no decision appears in `GET address-verification/` (default pending), and that a KYC-rejected one does not. This is the "scout queue": the existing queue already is it (spec §4.3), so no code is expected.
- [ ] **Step 2: Run**; if a test fails, fix the queue filter in `accounts/address_verification.py` minimally and say so in the commit.
- [ ] **Step 3: Commit** `test(accounts): the address queue is the scout queue`.

### Task 6: Web — pin step, confirm-email page, dashboard banner

**Files:**
- Create: `frontend/components/ShopLocationStep.jsx`, `frontend/components/ConfirmEmailPage.jsx`, `frontend/components/EmailConfirmBanner.jsx`, tests beside each (`frontend/ShopLocationStep.test.jsx`, `frontend/ConfirmEmailPage.test.jsx`, `frontend/EmailConfirmBanner.test.jsx`)
- Modify: `frontend/components/BusinessRegistrationFlow.jsx` (add `shop_location` to step lists at lines 49, 196, 225, 252, 290; remove the required Ghana Post attribute and make `payment_info` not appear in the self chain), `frontend/App.jsx` (route `/confirm-email` beside `/share-location`, lines 100, 2399, 2420), `frontend/BusinessRegistrationFlow.test.jsx`, the owner dashboard header where `go_live` is available, `frontend/mocks/handlers.js`

**Interfaces:**
- `ShopLocationStep({ onDone })`: "Use my current location" (browser geolocation, sends `{lat,lng,accuracy_m}`), then the existing `LocationPicker` to drag the pin (sends `{lat,lng,manual:true}`), a landmark text input, shows the returned `plus_code` and the sentence "This is where riders will collect. You can fix it later." Calls `POST /api/accounts/me/location/`; on 400 shows the server's message (too coarse says what to do); on success `auth.refreshUser()` then `onDone()`.
- `ConfirmEmailPage`: reads `#token=` from `window.location.hash`, strips it from the address bar, POSTs `{token}` to `/api/accounts/email-confirmation/confirm/`, shows success or the plain reason for 410/400 with a "send me a new link" button when signed in.
- `EmailConfirmBanner({ goLive })`: renders only when `goLive.blockers` has `email_unconfirmed` or `email_missing`; "Confirm your email to publish listings" plus a Resend button (`POST me/email-confirmation/`, shows "Sent to <email>" using the address the owner typed, never a server echo).
- Ghana Post input in `business_info` becomes optional with hint "Optional. We use your shop pin."; its lenient normaliser from Phase 1 stays.

- [ ] **Step 1: Write failing tests**: pin step success advances and calls refresh; too-coarse error text shown; manual drag sends `manual:true`; confirm page success, used (410), expired, no-token states; banner hidden when live, shown with each blocker, resend shows sent text; registration flow goes `business_info → shop_location → plan_selection` and never shows the Ghana Post field as required.
- [ ] **Step 2: Run** from `frontend/`: `npx vitest run ShopLocationStep ConfirmEmailPage EmailConfirmBanner BusinessRegistrationFlow` — Expected: FAIL.
- [ ] **Step 3: Implement** with the inline `C` palette (read `DESIGN.md` first), no `useMutation`, never importing `App.jsx` from `components/**`.
- [ ] **Step 4: Run** `npx vitest run` and `npm run build` from `frontend/` — Expected: only the known dark-mode home timeout may fail; build exit 0.
- [ ] **Step 5: Commit** `feat(frontend): shop pin step, email confirmation page and banner`.

### Task 7: Mobile — pin step and email banner

**Files:**
- Create: `mobile/src/app/(auth)/shop-location.tsx` (match the folder holding the other registration steps, see `mobile/src/lib/routing.ts`), `mobile/src/features/business/EmailConfirmBanner.tsx`, tests beside them
- Modify: `mobile/src/lib/registrationApi.ts` (`RegistrationStep` union gains `"shop_location"`; `stepRoute` maps it; add `saveShopLocation(input: {lat:number,lng:number,accuracy_m?:number,manual?:boolean,landmark?:string})` and `resendEmailConfirmation()`), `mobile/src/app/business/home.tsx` (banner)

**Interfaces:** `expo-location` is already a dependency (`~58.0.20`); request foreground permission, `getCurrentPositionAsync({accuracy: Location.Accuracy.High})`, send `accuracy_m` from `coords.accuracy`; a draggable `MapView` marker (the map component already used by the rider job map) sends `manual:true`.

- [ ] **Step 1: Write failing tests**: `stepRoute("shop_location")` returns the new route; saving a device fix posts the right body; permission denied shows "Allow location, or place the pin on the map"; banner visibility mirrors the web rules.
- [ ] **Step 2: Run** `cd mobile && npx jest registrationApi shop-location EmailConfirmBanner` — Expected: FAIL, then pass after Step 3.
- [ ] **Step 3: Implement**; run `npx tsc --noEmit` and the full `npx jest` — Expected: tsc clean, all pass.
- [ ] **Step 4: Commit** `feat(mobile): shop pin step and email confirmation banner`.

### Task 8: Minimal auto-publish at submit (owner decision 1, behind a switch)

**Files:**
- Create: `backend/listings/autopublish.py`, `backend/listings/tests/test_autopublish.py`
- Modify: `backend/listings/views.py:886` (the submit-for-review door), `backend/ashantihub/settings.py` (`LISTING_AUTO_PUBLISH_ENABLED = env.bool(..., default=False)`, `LISTING_PROHIBITED_TERMS = env.list(..., default=[])`, `UNVERIFIED_DAILY_LISTING_LIMIT = env.int(..., default=20)`)

**Interfaces:**
- Consumes: `golive.is_live` (Task 2), `listings.moderation_checks.contact_details_in` (no-direct-contact rule), `location_tier.tier` (Task 4), `fraud.services.raise_flag(...)` (read its signature; use `dedupe_key=f"first-listing-{owner.pk}"`).
- Produces: `autopublish.evaluate(listing) -> Verdict` where `Verdict(outcome: "pass"|"fix"|"hold", reasons: list[str])`. Checks, in order: main photo is at least 800x800 px (Pillow, on the stored original); name 3+ characters; description 40+ characters; price above zero; category valid for the owner's `business_kind`; no contact details in name or description (`fix`); no `LISTING_PROHIBITED_TERMS` word in name or description (`hold`); owner not Verified-location and already 20 listings submitted today (Accra day) (`hold`). Every `fix` reason is one plain sentence saying what to change.
- Behaviour at submit when `LISTING_AUTO_PUBLISH_ENABLED` and owner `is_live`: `pass` publishes at once (status PUBLISHED, `reviewed_by` null, owner notified "listing_approved"), `fix` keeps the listing a draft and answers 400 `{"code": "needs_fixes", "reasons": [...]}`, `hold` goes to PENDING_REVIEW as today. The first published listing of a business also raises one low-priority fraud flag (spot check) and never blocks. With the switch off, behaviour is exactly as before.

- [ ] **Step 1: Write failing tests**: each `fix` reason on its own (small photo, short name, short description, zero price, wrong-kind category, phone number in description); `pass` publishes and notifies; prohibited term holds (pending_review, no 400); the 21st listing of the day by a Located (not Verified) business holds while a Verified-location business is unaffected; first published listing raises exactly one flag and the second raises none; switch off leaves the listing pending_review; not-live owner still 403 `not_live`; a photo-less listing is a `fix`, never a 500; a corrupt image file is a `fix`, never a 500.
- [ ] **Step 2: Run** `docker compose run --rm web python manage.py test listings.tests.test_autopublish` — Expected: FAIL.
- [ ] **Step 3: Implement** `autopublish.py` and wire the submit door; all pure checks live in `autopublish.py`, the view only applies the verdict.
- [ ] **Step 4: Run** `... test listings accounts fraud` — Expected: pass.
- [ ] **Step 5: Commit** `feat(listings): publish a clean listing at once, behind a switch`.

### Task 9: Wrong location hides listings after 7 days (owner decision 5, behind a switch)

**Files:**
- Modify: `backend/listings/visibility.py` (`hidden_business_q`), `backend/ashantihub/settings.py` (`WRONG_LOCATION_HIDE_ENABLED = env.bool(..., default=False)`, `WRONG_LOCATION_HIDE_DAYS = env.int(..., default=7)`)
- Create: `backend/accounts/management/commands/list_wrong_location_businesses.py` (read-only dry run printing business id, name, days since the decision), `backend/listings/tests/test_wrong_location_hidden.py`

**Interfaces:**
- Consumes: `location_tier.tier(profile) == "wrong"` meaning `address_verified_at` set and `address_verified` false (Task 4).
- Produces: while `WRONG_LOCATION_HIDE_ENABLED`, `hidden_business_q(prefix)` also matches a business whose profile has `address_verified_at <= now - WRONG_LOCATION_HIDE_DAYS` days and `address_verified=False`; a new pin clears the decision (existing `clear_address_decision`), so re-sharing un-hides it with no extra code. Open orders are not touched (the filter only affects public browse and add-to-cart).

- [ ] **Step 1: Write failing tests**: decision 6 days old is visible; 8 days old is hidden from public listing, search and add-to-cart; re-sharing a pin makes it visible again; switch off hides nothing; a business with no decision or a verified one is never hidden; the dry-run command lists exactly the businesses the filter would hide.
- [ ] **Step 2: Run** `... test listings.tests.test_wrong_location_hidden` — Expected: FAIL.
- [ ] **Step 3: Implement.** The prefix handling must match the existing `hidden_business_q` contract (prefix ends in `__`, empty for BusinessOwner itself).
- [ ] **Step 4: Run** `... test listings accounts cart storefront` — Expected: pass.
- [ ] **Step 5: Commit** `feat(listings): hide a business 7 days after its location is marked wrong, behind a switch`.

### Task 10: Docs, staging proof

**Files:**
- Modify: `backend/CLAUDE.md` (one bullet: go-live rule, email token rules, `kyc_status` readers left alone and why), root `CLAUDE.md` (Product rules: delivery relaxation is Phase 4, not here), `docs/superpowers/specs/2026-11-05-self-serve-onboarding-design.md` (Phase 2 as built)

- [ ] **Step 1: Update docs** as above.
- [ ] **Step 2: Whole-branch checks** from the repo root: backend full suite, `makemigrations --check --dry-run`, `frontend` vitest + build, `mobile` jest + tsc. Record counts in the commit.
- [ ] **Step 3: Merge to `righteoushack`, PR to `main`, deploy staging** (deploy skill). Staging proof, by hand with a real inbox: register a new business → receive the email → confirm → pin on a phone → create and submit a listing → staff approves it with `kyc_status` still pending. Check an existing KYC-verified staging business still lists and shows no banner.
- [ ] **Step 4: Stop.** Production waits for the owner.
