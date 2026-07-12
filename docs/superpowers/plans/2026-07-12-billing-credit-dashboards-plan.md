# Billing/Credit Stub Backends + Dashboard Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the last mock-data dashboards (`BusinessDashboard`, `PaymentDashboard`, `CreditDashboard`) with real (if minimal/stub) backend data, per `docs/superpowers/specs/2026-07-12-billing-credit-dashboards-design.md`.

**Retrofit note:** this plan documents work that was actually implemented in a single ungoverned session on 2026-07-12 (directly in the working tree, no worktree/spec/PR) alongside two sibling sub-projects (`/staff` URL routing, and Hero/Navbar componentization). See `docs/superpowers/plans/2026-07-12-staff-url-routing-plan.md` for the full retrofit context and why this work is split into three sequential, chained worktree branches rather than one. This is the second: `worktree-billing-credit-dashboards`, branched from `righteoushack` after `worktree-staff-url-routing` merged (PR #13).

**Architecture:** Two new minimal Django apps (`backend/billing/`, `backend/credit/`) reusing existing RBAC/ownership permission patterns from `accounts`/`listings`. Six new frontend `useQuery` hooks following the existing `useStaffRoster.js` convention. See design doc §2–3 for full detail.

**Tech Stack:** Django 5.0 / DRF 3.15, React 19 / `@tanstack/react-query` — no new dependencies on either side.

## Global Constraints

- No real Hubtel integration, no real Phase-3 credit-scoring engine — both explicitly out of scope, flagged in code comments where relevant (`backend/credit/scoring.py`).
- No messaging/Enquiries wiring — `mockEnquiries`/`MOCK_CONVERSATIONS` stay mock.
- No `useMutation` — mutations follow the existing plain `apiPost`/`apiPatch` + `try/catch` + `refetch()` pattern already used by `StaffDashboard`'s panels.
- `MoMoModal` (customer→business payments) is a different concept from `Transaction` (business owner's own payments) and is not wired to the new endpoints.

## File Structure

```
backend/
  billing/                              # new app
    models.py                           # SubscriptionPlan, Subscription, Transaction
    serializers.py, views.py, urls.py
    migrations/0001_initial.py, 0002_seed_subscription_plans.py
    tests/test_subscriptions.py, test_transactions.py
  credit/                                # new app
    models.py                           # CreditScore
    scoring.py                          # naive placeholder formula
    serializers.py, views.py, urls.py
    migrations/0001_initial.py
    tests/test_credit_score.py
  ashantihub/settings.py                # modified: billing, credit added to INSTALLED_APPS
  ashantihub/urls.py                    # modified: api/billing/, api/credit/ includes

frontend/
  hooks/
    useMyListings.js, useBusinessProfile.js, useSubscriptionPlans.js,
    useMySubscription.js, useMyTransactions.js, useMyCreditScore.js   # new
    __tests__/<same names>.test.jsx                                   # new
  apiClient.js                          # modified: apiPatch helper
  apiClient.test.js                     # modified: apiPatch coverage
  App.jsx                               # modified: BusinessDashboard/PaymentDashboard/
                                         # CreditDashboard rewritten; mock arrays removed
CLAUDE.md                               # modified: backend apps, hooks, hardcoded-data
                                         # paragraphs updated
```

## Tasks

- [x] Build `billing` app: `SubscriptionPlan`/`Subscription`/`Transaction` models, migrations (incl. plan-seeding), serializers, views (owner-scoped `/me/` endpoints + staff aggregate), urls.
- [x] Build `credit` app: `CreditScore` model, naive `scoring.py` formula, serializers, views (owner-scoped compute-on-read + staff aggregate), urls.
- [x] Register both apps in `settings.py`/`urls.py`.
- [x] Add `apiPatch` to `apiClient.js` + test coverage.
- [x] Add six new hooks + their tests.
- [x] Wire `BusinessDashboard`'s Overview/Listings & Prices tabs to `useMyListings`/`useBusinessProfile`; add real "Submit for Review" action; replace unbacked Views/Bookings/Avg Rating stats with real listing-status counts.
- [x] Wire `BusinessDashboard`'s Subscription tab to `useSubscriptionPlans`/`useMySubscription`; `MoMoPayment` success persists the plan.
- [x] Wire `PaymentDashboard` to `useMyTransactions`; drop Invoices tab/`InvoiceModal`/`MOCK_INVOICES`; drop unbacked "Revenue by Network"/"Active Subscribers" tiles, replace with real per-owner stats.
- [x] Wire `CreditDashboard` to `useMyCreditScore`; simplify from multi-business browsing UI to single-owner score view (backend has no aggregate endpoint).
- [x] Update `CLAUDE.md`.
- [x] Verify: `cd frontend && npm run build && npm run test` (87/87, up from the 72-test baseline after `/staff` routing — 15 new tests across 6 new hook files + `apiPatch` coverage).
- [x] Verify: `docker compose run --rm web python manage.py test` (157/157, all passing; migrations check clean via `makemigrations --check --dry-run`).
- [ ] Write retroactive spec+plan docs (this plan + its sibling design doc) — done as part of this same task.
- [ ] Commit, push `worktree-billing-credit-dashboards`, open PR into `righteoushack`.
- [ ] Run `code-review` on the PR before merge.
- [ ] Merge into `righteoushack`.

## Verification

- `cd frontend && npm run build` — clean build.
- `cd frontend && npm run test` — 87/87 passing.
- `docker compose run --rm web python manage.py test` — 157/157 passing (note: the worktree needs its own `backend/.env` and `docker-compose.override.yml` copied in, since both are gitignored local config not present in a fresh `git worktree add` checkout; also needs a distinct host port for `db` if another compose stack is already running against the default remapped port).
- Manual trace-through (per design doc §3): business-owner login → `BusinessDashboard` → edit a listing → Subscription tab → simulate a payment → `PaymentDashboard` shows the new transaction → `CreditDashboard` shows a real (if low/naive) score.
