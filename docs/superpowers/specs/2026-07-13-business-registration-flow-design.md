# Staged Business Registration Flow — Design

## Goal

Replace the current single-page/single-modal business owner signup (one giant
form collecting personal info, full KYC identity, and payout details in one
atomic submit) with a 4-stage flow, each stage a real page (not a modal):

1. **Personal Information** — name, phone, email, password. Creates the
   account and logs the user in immediately, same as customer signup does
   today.
2. **Business Information** — Ghana Card identity/KYC data.
3. **Payment Account Information** — payout details (bank and/or mobile
   money).
4. **Declaration of Terms and Conditions** — accept the business agreement.

A business owner can sign in and out mid-flow and always resumes exactly
where they left off — they cannot use the site as a business owner until all
4 stages are complete. Once complete, they land directly on
`BusinessDashboard`, which shows every tab grayed out behind a single
"pending approval" status screen until staff approve their KYC.

This is entirely separate from customer signup, which is unchanged: a
customer creates an account with the same four personal-info fields, is
logged in immediately, and anything else (there is currently nothing else
persistable — see the `AccountPanel` work from the prior session) is filled
in later via their own Account panel, never blocking anything.

## Non-goals

- Creating an actual marketplace `Listing` (business name, category,
  description, price) is **not** part of this flow. That remains a separate,
  later action in `BusinessDashboard`'s existing "Listings & Prices" tab,
  unchanged.
- Real legal-review Terms & Conditions copy — this spec includes clearly
  placeholder business-agreement text (listing rules, payout terms, KYC
  accuracy, suspension conditions) that can be swapped for real copy later
  without changing the flow.
- Editable customer profile/settings — out of scope, was already addressed
  as "not currently backed by any API" in the prior session's work.
- Any change to staff-side KYC review (`KYCPendingQueueView`,
  `KYCApproveView`, `KYCRejectView`, `KYCQueuePanel`) — the approve/reject
  actions and their effect on `kyc_status` are unchanged; this flow only
  changes how a business owner *arrives* at "pending" and what happens if
  they're rejected.

## Current state (context)

- `BusinessOwner` (auth/identity/KYC status) and `BusinessOwnerProfile`
  (KYC identity fields + payout fields), 1:1, in `backend/accounts/models.py`.
  Today, `BusinessOwnerProfile`'s KYC fields (`ghana_card_number`,
  `ghana_card_front_image`, `ghana_card_back_image`, `gps_address`,
  `business_contact_phone`) and `default_payout_method` are **not**
  nullable — a `BusinessOwner` cannot exist without a fully-populated
  profile today, because `BusinessOwnerRegistrationSerializer.create()`
  creates both in one shot from one giant request.
- `BusinessOwnerProfileUpdateView` (`PATCH
  /api/accounts/business-owners/me/profile/`) already exists and already
  does almost exactly what Stage 2 needs: its serializer already treats
  every KYC field as optional (built for partial updates), already
  refuses edits once `kyc_status == "verified"`, and **already resets a
  rejected application back to `"pending"` on any successful update** —
  this is already the resubmit-after-rejection behavior this spec needs.
  It is currently unreachable for a fresh signup only because no profile
  row exists yet to PATCH against.
- `PayoutDetailUpdateView` (`PATCH
  /api/accounts/business-owners/me/payout/`) already exists and already
  does exactly what Stage 3 needs (partial payout updates, validates the
  chosen `default_payout_method` has matching details).
- `GET /api/accounts/me/` today returns only `account_type`, `id`,
  `full_name` (plus `role`/`permissions` for staff). It does not return
  `kyc_status`, `kyc_rejection_reason`, or anything about profile
  completeness.
- `BusinessDashboard` (`frontend/App.jsx`) has no approval-status gating
  today — all 4 tabs (Overview / Listings & Prices / Enquiries /
  Subscription) are always fully usable regardless of `kyc_status`.
- The "Register Your Business" buttons (About page, Business page CTA)
  already call `setPage("register")`, but no `page==="register"` block
  exists in `AshantiHub`'s render — clicking them today is a dead no-op.
  Similarly, the Footer's "Business Agreement" link sets `legalDoc` state
  that nothing ever reads. Both are pre-existing dead stubs this design
  brings to life, not regressions introduced here.
- `AuthModal`'s signup mode currently has an account-type toggle
  ("I'm a Customer" / "I'm a Business Owner") that shows a giant
  single-shot business form inline in the modal. Login mode's
  Customer/Business Owner/Staff toggle is unrelated and unchanged.

## Backend design

### Model changes (one migration)

`backend/accounts/models.py`, `BusinessOwnerProfile`:

- `ghana_card_number`: add `null=True, blank=True` (keep `unique=True` —
  Postgres allows multiple `NULL`s under a unique constraint, so this is
  safe).
- `ghana_card_front_image`, `ghana_card_back_image`: add `null=True,
  blank=True`.
- `gps_address`, `business_contact_phone`: add `null=True, blank=True`.
- `default_payout_method`: add `null=True, blank=True`.
- New field: `terms_accepted_at = models.DateTimeField(null=True,
  blank=True)`.

No other model changes. `business_reg_certificate`/`tin` are already
nullable. `is_formal` already defaults to `False`.

### Registration-step computation (no stored step field)

A `BusinessOwner` model method, `compute_registration_step(self)`, in
`backend/accounts/models.py`, returns one of: `"business_info"`,
`"payment_info"`, `"terms"`, `"complete"`.

```python
def compute_registration_step(self):
    if self.kyc_status in (self.VERIFIED, self.REJECTED):
        return "complete"
    profile = self.profile
    if not (profile.ghana_card_number and profile.gps_address
            and profile.business_contact_phone
            and profile.ghana_card_front_image
            and profile.ghana_card_back_image):
        return "business_info"
    if profile.is_formal and not (profile.business_reg_certificate and profile.tin):
        return "business_info"
    if not profile.default_payout_method:
        return "payment_info"
    if (profile.default_payout_method == BusinessOwnerProfile.MOMO
            and not profile.payout_momo_number):
        return "payment_info"
    if (profile.default_payout_method == BusinessOwnerProfile.BANK
            and not profile.payout_bank_account_number):
        return "payment_info"
    if not profile.terms_accepted_at:
        return "terms"
    return "complete"
```

Key property: **`"complete"` means "don't force the wizard" — it does not
mean "approved."** It covers both a freshly-finished registration
(`kyc_status` still `"pending"`, everything filled in) and any
already-reviewed owner (`verified` or `rejected`). `BusinessDashboard`
separately branches on `kyc_status` to decide what to actually show (see
below). This split keeps "should I force the wizard?" and "what does the
dashboard show?" as two independent questions.

Legacy/backward-compat note: this is why `verified`/`rejected` short-circuit
to `"complete"` regardless of field state — an owner reviewed under the old
one-shot flow (or any current dev data) is never retroactively forced
through the new wizard just because a field the new flow added
(`terms_accepted_at`) happens to be empty. No data migration/backfill is
needed.

### API changes

1. **`POST /api/accounts/business-owners/register/`** (existing URL,
   shrunk serializer) — Stage 1.
   `BusinessOwnerRegistrationSerializer` shrinks to fields `["id",
   "full_name", "login_phone", "email", "password", "kyc_status"]` — same
   shape as `CustomerRegistrationSerializer`. `create()` creates the
   `BusinessOwner` and an empty `BusinessOwnerProfile(business_owner=owner)`
   (all-null, relying on the new nullable defaults) in the same call.
   Response unchanged: `{id, full_name, login_phone, kyc_status}` plus the
   issued token via the same `CustomerRegisterView`-style wrapper.
   No longer accepts or requires any KYC/payout field — sending them is
   simply ignored (they don't exist as serializer fields anymore).

2. **`PATCH /api/accounts/business-owners/me/profile/`** (existing, no
   backend change) — Stage 2. Frontend sends `ghana_card_number` +
   `ghana_card_front_image` + `ghana_card_back_image` (multipart, since
   files) + `gps_address` + `business_contact_phone` + `is_formal` (+
   `business_reg_certificate` + `tin` if formal).

3. **`PATCH /api/accounts/business-owners/me/payout/`** (existing, no
   backend change) — Stage 3. Frontend sends whichever payout fields match
   `default_payout_method`.

4. **`POST /api/accounts/business-owners/me/terms/`** (new) — Stage 4.
   `TermsAcceptView(APIView)`, `permission_classes = [IsBusinessOwner]`.
   Validates `compute_registration_step(request.user) == "terms"` (i.e.
   business info and payment info are already complete) — 400 with a clear
   message otherwise, so the wizard can't be raced/skipped by a direct API
   call. On success, sets `profile.terms_accepted_at = timezone.now()`,
   saves, returns `{registration_step: "complete"}`.

5. **`GET /api/accounts/me/`** (existing, extended). For
   `account_type == "business_owner"`, additionally returns:
   `kyc_status`, `kyc_rejection_reason`, `registration_step` (from the
   helper above).

### Reused as-is (no change)

- `KYCPendingQueueView` / `KYCDetailView` / `KYCApproveView` /
  `KYCRejectView` — staff-side review is untouched.
- `IsBusinessOwner` permission class — untouched.

## Frontend design

### `BusinessRegistrationFlow` component (new,
`frontend/components/BusinessRegistrationFlow.jsx`)

One component owning an internal `step` state
(`"personal_info" | "business_info" | "payment_info" | "terms"`), not four
separate `AshantiHub` page values — these stages are one sequential flow,
not independently-navigable destinations, matching how `BusinessDashboard`
is one component with internal tabs rather than four pages.

- Own minimal header (logo + step indicator, e.g. "Step 2 of 4: Business
  Information", + a "Sign Out" escape hatch calling `auth.logout()`) —
  same convention as `BusinessDashboard`/`StaffDashboard`'s dedicated
  header bars replacing the normal `Navbar`, since this is a focused,
  distraction-free flow.
- `personal_info` step: full-page version of the form currently inside
  `AuthModal`'s business-signup branch (name, phone, email, password),
  calling the shrunk `auth.registerBusinessOwner()`. Only shown when
  `user` is `null` (not logged in yet). On success, advances local `step`
  to `"business_info"` — no page navigation needed, `user` is now set from
  the App-level auth state.
- `business_info` step: Ghana Card number + front/back image uploads, GPS
  address, business contact phone, "formally registered" checkbox +
  conditional certificate/TIN — the exact field set currently in
  `AuthModal`'s `bizFields`, moved here. Submits via a new
  `auth.submitBusinessInfo(fields)` (multipart, PATCHes
  `.../me/profile/`). On success, advances to `"payment_info"`.
- `payment_info` step: the payout fields currently in `bizFields`
  (bank + momo details, default method). Submits via new
  `auth.submitPayoutInfo(fields)` (JSON, PATCHes `.../me/payout/`). On
  success, advances to `"terms"`.
- `terms` step: placeholder Business Agreement copy (see below) + a
  required "I agree" checkbox + submit. Calls new
  `auth.acceptBusinessTerms()` (POSTs `.../me/terms/`). On success, calls
  `auth.refreshUser()` (new — re-fetches `/api/accounts/me/` and updates
  `useAuth`'s `user` state so `registration_step` becomes `"complete"`
  app-wide), then calls the `setShowBizDash(true)` callback passed down
  from `AshantiHub` so the user lands directly on `BusinessDashboard`
  (now showing the pending-approval status screen).

Rejected-resubmit entry: `BusinessDashboard`'s rejected-status screen (see
below) can also mount `BusinessRegistrationFlow` directly at
`business_info` (pre-filled from the existing profile data, fetched via
the already-existing `useBusinessProfile` hook) — same component, same
step, just a different entry point and starting step.

### Entry points into the flow

1. **Direct navigation**: the existing (currently dead) "Register Your
   Business" buttons on the About page and Business page CTA already call
   `setPage("register")`. Add `{page==="register" && !isBusinessOwnerMidFlow
   && <BusinessRegistrationFlow user={user} auth={auth} .../>}` to
   `AshantiHub`'s render, alongside the other page blocks. Handles a
   brand-new, logged-out visitor starting fresh at `personal_info`.
2. **Forced resume gate**: a new early-return in `AshantiHub`, checked
   right after the existing `isLoading` gate and before the normal
   marketplace UI (same pattern as `isAdmin`/`showBizDash`/`showPayments`):
   ```js
   if (user?.accountType === "business_owner" && user.registrationStep
       && user.registrationStep !== "complete") {
     return <BusinessRegistrationFlow user={user} auth={auth}
       initialStep={user.registrationStep} setShowBizDash={setShowBizDash} />;
   }
   ```
   This fires regardless of `page`, `isAdmin`, or any other UI state —
   satisfies "always resume the registration flow" from anywhere in the
   app, including a fresh sign-in after closing the tab mid-flow.

`user` (the mapped object in `AshantiHub`) gains two new fields:
`registrationStep: auth.user?.registration_step`,
`kycStatus: auth.user?.kyc_status`,
`kycRejectionReason: auth.user?.kyc_rejection_reason`.

### `AuthModal` changes

Signup mode drops the "I'm a Customer" / "I'm a Business Owner" toggle
entirely — signup becomes customer-only (matching "the user when they
create an account logs in automatically... unlike the business
registration" from the confirmed distinction). The business-owner signup
form currently inline in `AuthModal` is deleted from there; its fields
move into `BusinessRegistrationFlow`'s `personal_info`/`business_info`/
`payment_info` steps as described above. Login mode's
Customer/Business Owner/Staff toggle is unchanged — logging in as an
existing (possibly mid-registration) business owner still goes through
`AuthModal` exactly as today, and the forced resume gate takes over from
there.

### `useAuth.js` changes

- `registerBusinessOwner(fields)`: simplify from `FormData`/multipart to
  plain JSON `apiPost`, matching `registerCustomer` — Stage 1 has no file
  uploads anymore.
- New `submitBusinessInfo(fields)`: `apiPatchForm` (multipart, for the
  image uploads) to `.../me/profile/`.
- New `submitPayoutInfo(fields)`: `apiPatch` (JSON) to `.../me/payout/`.
- New `acceptBusinessTerms()`: `apiPost` (empty body) to `.../me/terms/`.
- New `refreshUser()`: re-runs the `/api/accounts/me/` fetch and calls
  `setUser` with the merged result (same shape as the mount-time effect),
  so the app picks up the new `registration_step` without a full reload.
  (`apiPatchForm` doesn't exist yet in `apiClient.js` — needs adding,
  mirroring the existing `apiPostForm`.)

### `BusinessDashboard` gating

New gate at the top of the render, before the tab content switch:

- `kyc_status !== "verified"`: tab bar stays visible but every tab
  `<button>` gets `disabled` + grayed styling; the content area below
  renders one status card instead of tab content:
  - `kyc_status === "pending"`: "Your application is under review" +
    submission context, no action.
  - `kyc_status === "rejected"`: shows `kyc_rejection_reason` + a
    "Fix and Resubmit" button that mounts `BusinessRegistrationFlow` at
    `business_info`, pre-filled via `useBusinessProfile`.
- `kyc_status === "verified"`: unchanged, normal tab behavior (today's
  code path, untouched).

### Terms & Conditions placeholder copy

Plain-text business-agreement-style content covering: what a listing must
represent (accuracy, ownership), WhatsApp-contact conduct expectations,
payout terms (payout method accuracy, AshantiHub's commission/fee model —
generic placeholder language, not real figures), KYC accuracy
(misrepresentation grounds for suspension), and account
suspension/termination conditions. Written once as a constant in
`BusinessRegistrationFlow.jsx`, clearly swappable later.

## Data flow — happy path

1. Visitor clicks "Register Your Business" → `page="register"` →
   `BusinessRegistrationFlow` mounts, `user` is `null` → shows
   `personal_info`.
2. Submits name/phone/email/password → `registerBusinessOwner()` →
   account created, token stored, `useAuth`'s `user` becomes non-null
   (`registration_step: "business_info"` from the very next `/me/`
   shape, though the component advances locally without waiting on a
   refetch) → step becomes `business_info`.
3. Submits Ghana Card + GPS + contact phone (+ cert/TIN if formal) →
   `submitBusinessInfo()` → step becomes `payment_info`.
4. Submits payout details → `submitPayoutInfo()` → step becomes `terms`.
5. Accepts terms → `acceptBusinessTerms()` → `refreshUser()` →
   `setShowBizDash(true)` → `BusinessDashboard` renders, `kyc_status`
   is `"pending"` → single "under review" status screen, tabs grayed.
6. Staff approve via the existing `KYCApproveView` → `kyc_status`
   becomes `"verified"` → next time the owner's `/me/` is fetched
   (sign-in, or a future refresh), `BusinessDashboard` shows the normal
   tabs.

## Data flow — resume after closing the tab

1. Owner completed `personal_info` + `business_info`, closed the tab.
2. Later, signs in via `AuthModal` (Business Owner login) → `auth.login()`
   → `useAuth.user` populated, including `registration_step:
   "payment_info"` from `/me/`.
3. `AshantiHub`'s forced resume gate fires (regardless of `page`) →
   `BusinessRegistrationFlow` mounts with `initialStep="payment_info"` →
   owner continues from exactly there.

## Data flow — rejection

1. Owner completes all 4 stages, `kyc_status` is `"pending"`.
2. Staff reject via `KYCRejectView` with a reason → `kyc_status`
   becomes `"rejected"`, `kyc_rejection_reason` set.
3. Owner signs in → `registration_step` computes to `"complete"`
   (rejected short-circuits) → forced resume gate does **not** fire →
   normal app loads. Clicking into their dashboard (`setShowBizDash`)
   shows the rejected status card with the reason.
4. Owner clicks "Fix and Resubmit" → `BusinessRegistrationFlow` mounts at
   `business_info`, pre-filled → submits → `BusinessOwnerProfileUpdateView`
   (existing, unchanged) resets `kyc_status` to `"pending"` automatically
   → owner continues through `payment_info`/`terms` only if those are
   still incomplete (they likely aren't, since the reset only touches
   `kyc_status`/`kyc_rejection_reason`, not the other fields) — in the
   common case `compute_registration_step` returns `"complete"` again
   immediately after the business-info fix, landing them back on the
   dashboard's pending screen without re-doing payment/terms.

## Error handling

- Each stage's submit shows the existing app convention: a local
  `actionError`-style message on failure, form stays filled in, user can
  retry (matching `BusinessDashboard.saveEdit`'s existing pattern).
- `TermsAcceptView` returning 400 (stages out of order) is a defensive
  guard, not an expected user-facing path — the wizard's own step
  sequencing prevents reaching `terms` early through normal use.
- File upload failures (bad content type) surface the same validation
  error text the existing `validate_image_content_type`/
  `validate_document_content_type` validators already produce.

## Testing plan

**Backend:**
- Migration applies cleanly; a `BusinessOwner` can be created with no
  profile data.
- `compute_registration_step` unit tests across all 4 states plus the
  verified/rejected short-circuit.
- `POST business-owners/register/` no longer requires/accepts KYC fields.
- `PATCH .../me/profile/` against a freshly-created empty profile
  succeeds (previously only reachable against a fully-populated one).
- New `POST .../me/terms/`: success path, and the 400 guard when business
  or payment info is incomplete.
- `GET /api/accounts/me/` returns the three new fields for business
  owners only.

**Frontend:**
- `BusinessRegistrationFlow`: each step renders its form, submits, and
  advances to the next `step` on success; error path keeps the form
  filled in.
- Resume gate: a business owner user object with
  `registrationStep !== "complete"` forces `BusinessRegistrationFlow`
  regardless of `page`/other state.
- `BusinessDashboard`: three gate states (verified → normal tabs,
  pending → status card + disabled tabs, rejected → status card with
  reason + resubmit button).
- `AuthModal`: signup mode no longer offers a business-owner option;
  login mode's toggle is unchanged.
