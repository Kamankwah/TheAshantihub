# Design: Login/Session (Backend + Frontend)

**Date:** 2026-07-11
**Status:** Approved
**Sub-project:** First of the dashboards/RBAC initiative that follows on from `2026-07-09-roles-registration-kyc-design.md` and `2026-07-09-listing-model-design.md`. Unblocks the staff dashboard shell, business owner dashboard rewire, and customer dashboard sub-projects, none of which can be built without real login. `docs/IMPLEMENTATION_INSTRUCTIONS.md` is stale and does not reflect this sequencing; not updated as part of this spec.

## 1. Background & scope

`Customer`, `BusinessOwner`, and `StaffUser` accounts, RBAC (`Role`/`Permission`), and a JWT-based multi-account authentication scheme (`accounts.authentication.issue_token` / `MultiAccountJWTAuthentication`) already exist and are exercised in tests. Despite that, **no production code path ever calls `issue_token`** — a grep across `backend/` shows it used only in test files. Concretely:

- `CustomerRegisterView`, `BusinessOwnerRegisterView`, and `StaffActivateView` create/activate accounts but return no token — a brand-new signup cannot authenticate afterward.
- There is no login endpoint of any kind — a returning user of any account type has no way to sign back in.
- The frontend's `authModal`/`user` state (`App.jsx:2897-2898`) is vestigial: no modal component renders from it, and signup/login buttons no-op, as already documented in `CLAUDE.md`.

This spec closes both gaps: it adds login endpoints for all three account types, makes registration/activation return a usable token, and builds the frontend auth UI (`AuthModal`, `useAuth`) that finally gives `authModal` a real implementation.

**In scope:** login endpoints (customer, business owner, staff), token issuance on registration/activation, frontend login + signup UI (customer and business owner signup forms), token storage/attachment/expiry handling on the frontend.

**Out of scope:** refresh tokens / token blacklist / revocation (flagged for Phase 4 security hardening), staff-specific routing or a public staff entry point (deferred to the future staff-dashboard-shell sub-project per `docs/PWA_STAFF_DASHBOARD.md` §4's routing decision), phone OTP delivery (no OTP field exists on any account model today — login is password-based only, matching what's actually built), password reset/forgot-password flows, any of the three role dashboards themselves.

## 2. Backend

### 2.1 Login endpoints

Three separate endpoints, not one unified endpoint — phone/email uniqueness is enforced only *within* each account table, so a single "try all three tables" login could hit an identifier present in two account types with no principled way to disambiguate.

| Endpoint | Identifier | Notes |
| --- | --- | --- |
| `POST /api/accounts/customers/login/` | `Customer.phone` or `Customer.email` | mirrors `customers/register/` |
| `POST /api/accounts/business-owners/login/` | `BusinessOwner.login_phone` or `.email` | mirrors `business-owners/register/` |
| `POST /api/accounts/staff/login/` | `StaffUser.email` only | `StaffUser.phone` has no `unique=True`, so it can't reliably resolve one account |

Request body: `{"identifier": "...", "password": "..."}`. Each view: `permission_classes = [AllowAny]`, `throttle_scope = "login"`.

Behavior:
- Look up the account by identifier (phone-or-email for customer/business-owner, email-only for staff).
- `django.contrib.auth.hashers.check_password(password, account.password_hash)`.
- On any failure (identifier not found, or password mismatch) — return the **same** `400 {"detail": "Invalid credentials"}` response. Do not distinguish "unknown identifier" from "wrong password" in the response, to avoid account enumeration.
- On success — `200 {"token": issue_token(account, account_type), "account_type": account_type, "id": account.id}`, same shape `me/` already returns, plus `token`.
- No `kyc_status` gating on business-owner login — per `2026-07-09-roles-registration-kyc-design.md` §5, owners can log in and edit their profile while `pending`/`rejected`; only listing publication and payouts are gated, not login itself.

### 2.2 Registration/activation now issue tokens

- `CustomerRegisterView` — on successful create, response gains `token` via `issue_token(customer, "customer")`.
- `BusinessOwnerRegisterView` — same, `issue_token(owner, "business_owner")`.
- `StaffActivateView` — response changes from `{"status": "activated"}` to `{"status": "activated", "token": issue_token(staff, "staff")}`.

Implementation note: `generics.CreateAPIView` doesn't naturally expose a hook for adding fields to the response without overriding `create()`; the registration views override `create()` to call `super().create()` then merge `token` into `response.data` — kept minimal, no serializer restructuring.

### 2.3 Throttling

New `"login"` scope added to `DEFAULT_THROTTLE_RATES` in `settings.py`, `5/min`, consistent with the existing `customer_register`/`business_owner_register`/`staff_activate` entries (`settings.py:76-80`). All three login views share this one scope (not three separate scopes) since they're the same class of risk (credential-stuffing) regardless of account type.

### 2.4 Token lifetime & logout

- `ACCESS_TOKEN_LIFETIME` stays at the existing 12h (`settings.py:84`) — unchanged in this pass.
- No refresh token, no blacklist. A token cannot be revoked before it expires. This is an explicit, named limitation — not silently glossed over — and is flagged for Phase 4 (`docs/PROJECT_SCOPE.md` §6 DevOps/security hardening) rather than solved here, since refresh-token rotation + a blacklist store is materially more infrastructure than this sub-project's scope.
- Logout is client-side only: clear the stored token. There is nothing server-side to invalidate.

## 3. Frontend

### 3.1 `apiClient.js`

- Reads a token from `localStorage` (key: `ashantihub.auth`, storing `{token, account_type, id}` as JSON).
- Attaches `Authorization: Bearer <token>` to every request when a token is present.
- On any `401` response, clears the stored token and resets in-memory auth state (silent logout) — centralized in the client rather than duplicated in every hook that might hit an expired token.

`localStorage` (not `sessionStorage`, not cookies) because: the product's low-friction, WhatsApp-first feel implies "stay logged in" is the expected default, not a session that dies on tab close; and `MultiAccountJWTAuthentication` (`accounts/authentication.py:24-48`) expects a `Bearer` header, not a cookie, so there's no CSRF-handling change needed on the Django side either way.

### 3.2 `useAuth` hook

New file, `frontend/hooks/useAuth.js`, following the existing hook conventions (`useCategories`, `useZones`, `useListings`). Exposes:
- `user` — hydrated from `localStorage` on mount, re-validated once against `GET /api/accounts/me/` (existing endpoint) to catch an already-expired token before it's trusted.
- `login(accountType, identifier, password)` — calls the matching login endpoint, persists the result to `localStorage`.
- `logout()` — clears `localStorage`, resets `user`.
- `registerCustomer(fields)` / `registerBusinessOwner(fields)` — call the existing registration endpoints, persist the returned token exactly like `login()` does (registration now logs the user in per §2.2).

This hook replaces the `authModal`/`user` `useState` pair in `App.jsx:2897-2898`; `AshantiHub` consumes `useAuth()` instead of local state.

### 3.3 `AuthModal` component

New component, finally giving the `authModal` state something to render (closing the gap `CLAUDE.md` currently documents as a no-op):

- **Sign in** tab: identifier + password, account-type selector (Customer / Business Owner) so the modal knows which of the two login endpoints to call.
- **Sign up** tab, split by account type:
  - **Customer**: full name, phone-or-email, password. Minimal-friction per `2026-07-09-roles-registration-kyc-design.md` §3.1 — no KYC, account active immediately.
  - **Business Owner**: the full `BusinessOwnerRegistrationSerializer` shape — full name, login phone, email, password, Ghana Card number + front/back image upload, GPS address, business contact phone, `is_formal` toggle that reveals business registration certificate upload + TIN when on, payout details (bank and/or momo, with a `default_payout_method` choice when both are filled). This is the single largest chunk of new frontend surface in this sub-project, since none of this UI exists today.
- No staff sign-up tab — staff accounts are invite-only per the existing design (§3.3 of the roles/KYC spec), unchanged here.

### 3.4 Staff login entry point

No new public entry point. The app has zero URL routing today (`docs/PWA_STAFF_DASHBOARD.md` §4), and deciding whether to introduce routing for a real `/staff` URL is explicitly deferred to the future staff-dashboard-shell sub-project. For now, staff reach the same `AuthModal` (with account type pre-set to staff, no sign-up tab shown) via the existing hidden 5-click-logo gesture (`handleLogoClick`) — a deliberate temporary bridge, not a change to that mechanism's discoverability.

## 4. Testing

### 4.1 Backend (Django `TestCase`, per-app, matching existing convention)

- Login success for each of the three account types.
- Login failure: unknown identifier and wrong password return the identical response body/status (enumeration resistance).
- Throttling: 6th login attempt within a minute from the same IP returns 429.
- Registration response includes a `token` that authenticates successfully against `/me/`.
- Staff activation response includes a `token` that authenticates successfully against `/me/`.
- Business-owner login succeeds regardless of `kyc_status` (pending/verified/rejected all log in).

### 4.2 Frontend (Vitest + MSW, matching `frontend/hooks/__tests__` convention)

- `useAuth` mocks the three login/register endpoints; verifies `login`/`registerCustomer`/`registerBusinessOwner` persist to `localStorage` and populate `user`.
- `logout()` clears `localStorage` and resets `user`.
- A mocked `401` from any endpoint clears stored auth state.
- `AuthModal` — tab switching, account-type-conditional field rendering (`is_formal` toggle behavior), form submission wired to the right mutation.

## 5. Edge cases & error handling

- Identifier collision across account types (e.g., same phone registered as both a `Customer` and a `BusinessOwner`, which nothing currently prevents) — not a login-time ambiguity because each login endpoint only ever queries its own table; the same phone number simply resolves to two independent accounts depending on which endpoint is called. Not addressed further here; flagged as pre-existing model behavior, not introduced by this spec.
- Expired token used against any authenticated endpoint — `MultiAccountJWTAuthentication` already raises `AuthenticationFailed` (`authentication.py:35-36`); the frontend's `401` handler (§3.1) is what turns that into a silent logout rather than a visible error.
- Business owner or customer submits a sign-up form twice quickly (double-click) — the `5/min` throttle scope on registration endpoints already covers this; no additional debouncing added here beyond what the existing `docs/superpowers/plans/2026-07-10-rate-limiting-file-validation-plan.md` work put in place.

## 6. Open questions

None — all decisions in this spec were confirmed during brainstorming (2026-07-11).
