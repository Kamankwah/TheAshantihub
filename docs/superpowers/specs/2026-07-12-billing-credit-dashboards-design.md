# Design: Billing/Credit Stub Backends + Wire Remaining Dashboards

**Date:** 2026-07-12
**Status:** Approved
**Sub-project:** Second of three sub-projects retrofitted from a single ungoverned working-tree session (2026-07-12) into the repo's normal spec/plan/worktree/PR pipeline — see `docs/superpowers/plans/2026-07-12-billing-credit-dashboards-plan.md` for the retrofit context. Follows `docs/superpowers/specs/2026-07-12-staff-url-routing-design.md` in the chain (branched after that sub-project merged).

## 1. Background & scope

`BusinessDashboard`, `PaymentDashboard`, and `CreditDashboard` (`frontend/App.jsx`) were the last major mock-data surfaces in the app — everything else (`StaffDashboard`, auth) had already been wired to real backend data in earlier sub-projects. Unlike `StaffDashboard`'s wiring, the backend had **zero** models for transactions, subscriptions, or credit scores; only `listings/mine/*` and `accounts/business-owners/me/profile/` (business-owner self-service) already existed and were reusable as-is.

**Explicit scoping decision (confirmed with the user):** build minimal *stub* backends — real Django models/endpoints, but naive/placeholder logic — rather than either (a) leaving Payment/Credit as mock, or (b) building the actual Hubtel integration (`docs/HUBTEL_INTEGRATION.md`) or the real Phase-3 credit-scoring engine (`docs/PROJECT_SCOPE.md` §6) now. Both of those remain separate, larger, future initiatives.

**In scope:** `billing` app (`SubscriptionPlan`, `Subscription`, `Transaction`), `credit` app (`CreditScore`, naive scoring formula), wiring `BusinessDashboard`'s Overview/Listings & Prices/Subscription tabs and all of `PaymentDashboard`/`CreditDashboard` to real data.

**Out of scope:** real Hubtel payment processing (`MoMoPayment`/`MoMoModal` stay simulated — only the *result* of a simulated success gets persisted), the real Phase-3 credit-scoring engine, `BusinessDashboard`'s Enquiries tab and `MessagingCenter` (both stay on mock data — real-time/AI messaging is a separate, larger Phase-2 initiative unrelated in scope to this stub-backend work).

## 2. Backend

### 2.1 `billing` app

- `SubscriptionPlan` — tier/name, monthly/annual price, features, `is_recommended`. Seeded via migration (`0002_seed_subscription_plans.py`) to match the frontend's pre-existing hardcoded plan amounts.
- `Subscription` — `business_owner` FK (one-to-one-ish via upsert), `plan` FK, `billing_cycle`, `status`, `current_period_start`/`end`.
- `Transaction` — `business_owner` FK, `amount`, `purpose`, `status`, `reference` (unique, client-generated `txnRef` from `MoMoPayment`), `created_at`.
- Permissions: `IsBusinessOwner` (reused from `accounts`) scopes all `/me/`-style endpoints to the caller's own records, mirroring `listings`' `IsListingOwner` pattern. A staff-only aggregate view (`GET /api/billing/transactions/`) is gated by the existing `transactions.report` RBAC permission (accountant/super_admin roles) — available but not currently consumed by any dashboard in this pass.

### 2.2 `credit` app

- `CreditScore` — `business_owner` FK, `score` (300–1000), `grade`/`grade_label` (bands mirroring the frontend's pre-existing `getScoreColor`/`getScoreGrade`, `App.jsx:52-70`), `loan_eligible` (`score >= 600`), `factors` (JSON: `listings_published`, `account_tenure_months`, `kyc_verified`, `payout_verified` — each a `{value, score_pct, weight}`), `computed_at`.
- Compute-on-read: `GET /api/credit/scores/me/` recomputes and persists on every call via `credit/scoring.py`, a naive/placeholder formula built only from data that's cheaply available today (published listing count, account tenure, KYC status, payout verification) — explicitly commented in code as not the real Phase-3 engine, and deliberately **not** the frontend's old mock `SCORE_FACTORS` shape (rating/reviews/response-rate/payment-history), none of which exist in the backend.
- A staff-only aggregate list (`GET /api/credit/scores/`) exists behind the `analytics.view` RBAC permission, unused by any dashboard in this pass (same rationale as `billing`'s staff endpoint).

### 2.3 Endpoint contract

| Endpoint | Auth | Notes |
| --- | --- | --- |
| `GET /api/billing/plans/` | `AllowAny` | List of seeded `SubscriptionPlan`s |
| `GET`/`POST /api/billing/subscriptions/me/` | Business owner, own record | `GET` returns `{}` (not `null`) when none exists yet — DRF's `JSONRenderer` would otherwise emit a zero-length body for `None`, breaking `response.json()`. `POST` upserts (`{"plan": "basic"\|"standard"\|"premium", "billing_cycle": "monthly"\|"annual"}`) |
| `GET`/`POST /api/billing/transactions/mine/` | Business owner, own records | Newest first; `POST` body `{"amount", "purpose", "reference", "status"?}`, `status` defaults `"success"` |
| `GET /api/billing/transactions/` | Staff, `transactions.report` | Paginated, aggregate — not consumed in this pass |
| `GET /api/credit/scores/me/` | Business owner, own score | Compute-on-read |
| `GET /api/credit/scores/` | Staff, `analytics.view` | Aggregate — not consumed in this pass |

## 3. Frontend

Six new `useQuery` hooks (`frontend/hooks/`), following `useStaffRoster.js`'s pattern exactly (`useQuery` + `apiFetch`): `useMyListings`, `useBusinessProfile`, `useSubscriptionPlans`, `useMySubscription`, `useMyTransactions`, `useMyCreditScore`. A new `apiPatch` helper was added to `apiClient.js` (mirroring `apiPost`) since listing/profile edits need `PATCH`.

**Mutation pattern:** the codebase has no `useMutation` hooks anywhere (checked `StaffDashboard`'s already-wired panels) — mutations are plain `apiPost`/`apiPatch` calls inline in the consuming component's event handler, `try/catch`, local `actionError` state, `refetch()` on success. This pass follows that existing convention rather than introducing `useMutation`.

### 3.1 `BusinessDashboard` (`frontend/App.jsx`)

- Overview/Listings & Prices tabs wired to `useMyListings`/`useBusinessProfile`; edit/save now calls the update mutation instead of local `setListings`. Listing edits are disabled once `status==="published"` (backend rejects those edits) — added a real "Submit for Review" action for draft/rejected listings instead.
- Subscription tab wired to `useSubscriptionPlans`/`useMySubscription`; `MoMoPayment`'s `onSuccess` now calls the subscribe/change-plan mutation, persisting the plan via the real backend (payment itself stays simulated).
- Overview stats: the old `mockBusinessProfile`'s Views/Bookings/Avg Rating had no backend equivalent anywhere — replaced with real listing-status counts (Published/Pending Review/Draft) rather than left as unbacked mock numbers.
- Enquiries tab: **unchanged**, stays on `mockEnquiries` — explicitly out of scope.

### 3.2 `PaymentDashboard` (`frontend/App.jsx`)

- Wired to `useMyTransactions`, replacing hardcoded mock transaction data.
- Both real `MoMoPayment` usages in the app (`BusinessDashboard`'s Subscription tab, `PaymentDashboard`'s own Subscribe tab) fire the create-transaction mutation on simulated success.
- **Dropped the Invoices tab** and `InvoiceModal`/`MOCK_INVOICES` entirely — no backend `Invoice` model exists, and there's no such model in scope for a stub pass; leaving invoice UI backed by nothing would be worse than removing it.
- **Dropped** "Revenue by Network" and "Active Subscribers"/"MRR" aggregate tiles — `Transaction` has no per-network field, and there is no cross-business aggregate in scope; replaced with real per-owner stats (Total Paid, Pending, Failed, Successful count) and a real "Payments Needing Follow-up" list (the signed-in owner's own non-success transactions, not a multi-business admin view).
- `MoMoModal` (used by `Card` for customer→business booking payments — a different payment concept than a business owner's own subscription/fee `Transaction`) was **deliberately not** wired to the transaction-creation endpoint — wiring it would be semantically wrong (it represents a different party paying) and would 403 against `IsBusinessOwner`-gated endpoints for its typical (customer) caller.

### 3.3 `CreditDashboard` (`frontend/App.jsx`)

- The backend only exposes the signed-in owner's own score (no aggregate). The old multi-business browsing UI (score-cards grid, business-selector dropdown, "Businesses Scored"/"Loan Eligible"/"Avg Score"/"Total Loan Pool" aggregate tiles) was replaced with a single-score view (`ScoreGauge` + the real `factors` breakdown from the API).
- Loan-application form's business selector was removed (nothing to select between); max loan is derived client-side from the score-band table (`maxLoanForScore`) since the backend doesn't compute one.
- `LENDING_PARTNERS` stays a static frontend-only list (no backend model, explicitly out of scope). `MOCK_CREDIT_BUSINESSES`/`SCORE_FACTORS` are left in the file only because `CreditCategoryView` — a separate, pre-existing, currently-unreachable component — still references them; not touched.

## 4. Testing

- Backend: Django `TestCase` per app (`backend/billing/tests/`, `backend/credit/tests/`), covering permission boundaries (can't see another business owner's data), CRUD/read paths, and the naive credit-score computation.
- Frontend: Vitest + MSW, one test file per new hook (`frontend/hooks/__tests__/`), plus `apiPatch` coverage in `apiClient.test.js`.

## 5. Open questions

None — the stub-vs-full-build scoping question was resolved with the user before implementation (see plan doc); the CreditDashboard multi-business simplification was flagged and is a direct, necessary consequence of the "own score only" backend scoping decision, not a new open question.
