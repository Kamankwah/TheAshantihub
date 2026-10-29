# Implementation Instructions — Master Index

**Status:** This is the literal "instruction set" tying together every planning doc produced in this pass. Nothing described here has been built in code yet, except the tooling/config listed in `docs/TOOLING_SETUP.md` §5 and the `docs/PROJECT_SCOPE.md` restructure.

## 1. Document map

| Doc | Covers | Owner agent |
| --- | --- | --- |
| `docs/PROJECT_SCOPE.md` | Full phased roadmap (Phase 1 backend+auth+Hubtel, Phase 2 real-time+AI, Phase 3 credit v2, Phase 4 DevOps hardening) | `backend-architect` (overall), `payments-integration-engineer` (§5b) |
| `docs/HUBTEL_INTEGRATION.md` | Hubtel technical integration spec — Checkout API, webhooks, security | `payments-integration-engineer` |
| `docs/MOBILE_APP_SCOPE.md` | React Native (iOS + Android) app, separate repo, phased against the backend roadmap | `mobile-engineer` |
| `docs/TOOLING_SETUP.md` | Agents/skills/plugins/MCP servers for this project | n/a (meta) |
| `docs/FRONTEND_MODERNIZATION.md` | Hero/Navbar redesign, componentization, palette extension, React 19 upgrade | `frontend-engineer` |
| `docs/PWA_STAFF_DASHBOARD.md` | Service worker fix, staff-scoped installable PWA | `frontend-engineer` |
| `docs/BUSINESS_EVENTS_ROADMAP.md` | Business tab redesign (hero media approval, sidebar/grid, PDP, cart/checkout, promotion/boost) + net-new Events platform, phased | `backend-architect` + `frontend-engineer` |
| `docs/UI_MODERNIZATION_ROADMAP.md` | TypeScript/Tailwind/shadcn tooling (incremental adoption), real client-side routing, customer-facing dark/light theme toggle, WhatsApp removal, Business tab restructuring, admin-editable footer, CTA band redesign | `frontend-engineer` + `backend-architect` |
| `CLAUDE.md` | Baseline architecture description (kept accurate as code changes land) | n/a (meta) |

## 2. Sequencing across all docs

```
Tooling setup (docs/TOOLING_SETUP.md)          — done this pass, keys pending
        │
        ▼
Phase 1 backend + Hubtel (docs/PROJECT_SCOPE.md §5a/§5b, docs/HUBTEL_INTEGRATION.md)
        │                                    │
        │ (frontend can proceed in parallel) │ (mobile Phase 2 blocked on this)
        ▼                                    ▼
Frontend modernization (docs/FRONTEND_MODERNIZATION.md)      Mobile app (docs/MOBILE_APP_SCOPE.md)
        │
        ▼
PWA staff dashboard (docs/PWA_STAFF_DASHBOARD.md)
        │
        ▼
Phase 2-4: real-time+AI, credit scoring v2, DevOps hardening (docs/PROJECT_SCOPE.md §6)
```

- Frontend modernization has **no hard dependency** on the backend — it can start immediately, in parallel with Phase 1 backend work, same as the original prototype was built mock-data-first.
- PWA staff-dashboard work should sequence after the React 19 bump (`docs/FRONTEND_MODERNIZATION.md` §6) to avoid verifying service-worker behavior twice against two React versions.
- Mobile Phase 1 (browse/auth) can start early against mock data; Mobile Phase 2 (payments) is hard-blocked on Hubtel being live in production.
- Credit scoring v2 (Phase 3) is unblocked immediately after Phase 1 now that Hubtel data exists from day one — it no longer needs a separate payments phase to complete first.
- `docs/BUSINESS_EVENTS_ROADMAP.md`'s six phases (Business tab redesign + Events platform) are not yet placed on this diagram — they depend on Phase 1 backend (`listings`/`accounts`/`billing` models must already exist) and are additive to, not blocking, the rest of this sequencing. Earliest reasonable start is after Phase 1 backend + frontend modernization both exist, since Phase 3 of that roadmap redesigns the same Business tab this pass's frontend modernization work leaves alone.

## 3. Cross-cutting items not owned by any single doc above

### Environment / secrets management
- Convention: `.env` files, never committed, consumed by Docker Compose in production (`docs/PROJECT_SCOPE.md` §7).
- `.claude/settings.local.json` already allow-lists a set of read-only/low-risk commands (`npm run *`, `npm install *`, `git add *`, DNS/HTTP checks for theashantihub.com, Vercel MCP tools) — extend this list as new safe, repeated commands emerge, don't broaden it speculatively.
- New secrets introduced by this pass (`HUBTEL_CLIENT_ID`/`SECRET`/etc., 21st.dev `API_KEY`, Postgres connection string) all follow the same placeholder-then-fill pattern documented in `docs/TOOLING_SETUP.md` and `docs/HUBTEL_INTEGRATION.md` §5 — never commit a real value for any of them.

### CI/CD
- Current state: Vercel handles the frontend build/deploy (`vercel.json`, SPA rewrite + security headers) — this stays as-is for the web frontend.
- Phase 1 backend adds a second CI/CD path: GitHub Actions building the Django backend and deploying over SSH to the VPS (`docs/PROJECT_SCOPE.md` §7) — this is new infrastructure, not an extension of the existing Vercel pipeline, because the backend isn't a static/edge deployment target.
- Mobile app CI/CD (EAS Build/Submit via GitHub Actions) is a third, independent pipeline — see `docs/MOBILE_APP_SCOPE.md` §6.

### Testing strategy
- Current state: **zero tests in the repo** — no test files, no ESLint/Prettier config, no test script in `package.json` (`CLAUDE.md` "Commands" section). This has been true since the prototype stage and hasn't been addressed by this planning pass.
- Recommended starting point, in priority order, once real code work begins:
  1. Backend: Django's built-in test framework for auth, listing CRUD, and — critically — the Hubtel webhook handler (`docs/HUBTEL_INTEGRATION.md` §4 is exactly the kind of logic that needs unit coverage for idempotency/signature-verification edge cases before it touches real money).
  2. Frontend: no framework recommendation made here — revisit once `components/` extraction (`docs/FRONTEND_MODERNIZATION.md` §2) gives the codebase actual unit boundaries to test; testing a 3,600-line single-file monolith is lower-value than testing extracted components.
  3. Mobile: Jest + Maestro per `docs/MOBILE_APP_SCOPE.md` §6, from the start of that project rather than retrofitted later.

### Monitoring / observability
- Deferred to Phase 4 (formerly Phase 5) per `docs/PROJECT_SCOPE.md` §6 — Sentry for error tracking, uptime checks. This planning pass does not pull that forward; flagged here only so it isn't forgotten, not because it's changing.

## 4. What is explicitly NOT done in this pass

- No `App.jsx` code changes (Hero, Navbar, palette, React 19 bump — all spec only).
- No Django/DRF backend scaffolded.
- No React Native project created.
- No real Hubtel API calls wired up — `MoMoPayment`/`MoMoModal` are still fully simulated.
- No service worker registration fix applied — `sw.js` is still dead code.
- MCP servers (`magic`, `postgres`) still have placeholder credentials — not functional until the user fills them in.
- `figma` plugin is enabled in config but the interactive OAuth authorization step has not been run (requires the user).
- No `ashantihub-conventions` project skill authored (recommended, not built).

## 5. What triggers each next step

| Next step | Trigger |
| --- | --- |
| Frontend modernization implementation | User approval to start editing `App.jsx` per `docs/FRONTEND_MODERNIZATION.md` |
| Phase 1 backend scaffold | User confirms Django/DRF as final choice and provides/approves VPS + DB provisioning |
| Hubtel integration | Phase 1 backend exists + Hubtel merchant account approved (sandbox credentials at minimum) |
| PWA staff dashboard | Frontend modernization's React 19 bump lands + Option A/B scoping decision (`docs/PWA_STAFF_DASHBOARD.md` §4) made with the user |
| Mobile app | Separate repo created; Mobile Phase 1 can start immediately, Phase 2 waits on live Hubtel |
| MCP servers going live | User supplies 21st.dev API key and (once provisioned) the Postgres connection string |

## 6. Ledger plan stages

Stage 1 (`docs/superpowers/plans/2026-10-15-ledger-fees-foundation.md`, spec `docs/superpowers/specs/2026-10-15-wallet-fees-security-design.md`) is built. Later stages:

| Plan | Scope |
| --- | --- |
| **1F** Frontend | Accounting fee/settings screens; Support "awaiting verification" screen; Pickup Desk dashboard and navigation; registration "business type" step replacing "pick a plan"; hide plan UI when the plans list is empty. Must ship before `SUBSCRIPTIONS_ENABLED` is turned off. **Built (docs/superpowers/plans/2026-10-20-wallet-frontend-1f-fees-verification-pickup.md; switches unchanged).** Remains: the subscriptions-off backend gates (a), (c), (d), (e); booking sales on the vendor money screens (Plan 4F); the 7E customer side (Plan 7G); nav badges for the new queues (no server count); the manual checks at 360/768/1280 px and on staging (spec §13, Plan 1F). |
| **1b** | Ledger recording and release for services, events/tickets and bookings. Backend: docs/superpowers/plans/2026-10-16-ledger-services-events-stays-1b.md, built, behind `LEDGER_ENABLED` (default off); Support's booking queue screen is Plan 1F. |
| **2** OTP and security | One OTP service, step-up tokens, trusted devices, customer and vendor 2FA. Must precede any wallet going live. Backend: docs/superpowers/plans/2026-10-16-otp-security.md, behind three switches that default off; the screens (Plan 2F) are built, switches still off; the staging walkthrough is owed before any switch. |
| **3** Wallets and payments | Customer wallet, top-up, refunds, withdrawals, payout destinations, provider interface and simulated provider, reconciliation. Needs Plan 2. Backend: 3a docs/superpowers/plans/2026-10-16-wallets-payments-3a.md (provider interface, top-up, paying from the wallet, refunds) then 3b docs/superpowers/plans/2026-10-16-withdrawals-3b.md (payout destinations, withdrawals, reconciliation), both built, behind `LEDGER_ENABLED` (default off). **The screens (Plan 3F) are built** (frontend only, ledger off): `components/wallet/` (top-up, balance, statement, payout destinations, withdraw form and history, payment-method picker, vendor "Money" tab), the checkout picker in `CartDrawer`, and the staff Wallets, Withdrawals and Reconciliation panels. Still to build: Plan 4 Tasks 14-15 (the customer wallet tabs that mount these parts), Plan 5F (rider screens). The switch-on checklist and owed manual checks are in the spec's 3F section. |
| **4** Vendor dashboard and SMS | Statements, per-order SMS, digest, cap meter. Backend: docs/superpowers/plans/2026-10-16-vendor-side-sms-4.md (overview with the cap, per-sale rows, daily summary, statement export, fee transparency, paid/release texts and the optional digest), built on Plan 1b, behind `LEDGER_ENABLED` (default off); the screens are Plan 4F, **built** (owner-only `components/dashboard/money/` inside the single Money tab: overview, payouts, sales, daily, statement, fees, texts). Booking sales (services, stays, tickets) are on the vendor money API (`vendor/bookings/`, daily, statement) and text the business (spec gate (lxxxiii) closed); 4F also fixed the reconciliation notice link and the cart total's delivery fee. All behind `LEDGER_ENABLED` (default off); the manual width checks and live walkthrough are owed to the staging smoke. |
| **5** Third-party dispatch | `Rider` employment flag, rider wallet, 90/10 split on release, end-of-day commission job. Backend: docs/superpowers/plans/2026-10-16-dispatch-wallets-5.md, built behind `LEDGER_ENABLED` (default off); the screens are Plan 5F. |
| **3** Wallets and payments | Customer wallet, top-up, refunds, withdrawals, payout destinations, provider interface and simulated provider, reconciliation. Needs Plan 2. Backend: 3a docs/superpowers/plans/2026-10-16-wallets-payments-3a.md (provider interface, top-up, paying from the wallet, refunds) then 3b docs/superpowers/plans/2026-10-16-withdrawals-3b.md (payout destinations, withdrawals, reconciliation), both built, behind `LEDGER_ENABLED` (default off). **The screens (Plan 3F) are built** (frontend only, ledger off): `components/wallet/` (top-up, balance, statement, payout destinations, withdraw form and history, payment-method picker, vendor "Money" tab), the checkout picker in `CartDrawer`, and the staff Wallets, Withdrawals and Reconciliation panels. Still to build: Plan 4 Tasks 14-15 (the customer wallet tabs that mount these parts), Plan 4F (vendor money screens, inside 3F's single "Money" tab). Plan 5F (rider screens) is built; see row 5. The switch-on checklist and owed manual checks are in the spec's 3F section. |
| **4** Vendor dashboard and SMS | Statements, per-order SMS, digest, cap meter. Backend: docs/superpowers/plans/2026-10-16-vendor-side-sms-4.md (overview with the cap, per-sale rows, daily summary, statement export, fee transparency, paid/release texts and the optional digest), built on Plan 1b, behind `LEDGER_ENABLED` (default off); the screens are Plan 4F. Rows, statement, daily columns and texts cover product orders only: booking sales must be added before the ledger is on (spec gate (lxxxiii)). |
| **5** Third-party dispatch | `Rider` employment flag, rider wallet, 90/10 split on release, end-of-day commission job. Backend: docs/superpowers/plans/2026-10-16-dispatch-wallets-5.md, built behind `LEDGER_ENABLED` (default off); the screens are Plan 5F, **built 2026-10-28** (rider wallet, Delivery Manager works-for, Accountant rider money, delivery-case refunds, Re-deliveries, queue and payroll lines), screens owed their browser, phone and staging checks before switch-on (see the spec's Plan 5F note). |
| **6** Offers and stock | Catalogue entries, offers, "other sellers", stock reservation upgrade, low-stock alerts. Backend: docs/superpowers/plans/2026-10-16-catalogue-offers-stock-6.md, built (grouping by staff approval, other sellers, the business's product lookup, days of cover, alerts behind `STOCK_ALERTS_ENABLED`, sold-out hiding behind `SOLD_OUT_HIDDEN_ENABLED` and the barcode matcher behind `CATALOGUE_MATCHER_ENABLED`, all three default off); the reservation upgrade is a gate before Plan 7 (spec §13 (ciii)); the screens are Plan 6F. |
| **7** Hubtel live switch | Credentials, webhook verification against sandbox, regulatory clearance. |
| **7G** Customer booking buttons | Built (customer screens for Plan 7E, plan docs/superpowers/plans/2026-10-20-wallet-rulings-7g-customer-booking-buttons.md): a `money` block on the customer's own booking, service-request and ticket lists, `GET /api/ledger/bookings/<sale id>/cancel-quote/`, and `components/bookings/` (`BookingMoneyBar`, `CancelBookingDialog`, `ReportProblemForm`) plus the extended `ServiceAcceptBar` on the three Account tabs. The server's cancel refusals now say "Report a problem instead." (or, after release, to contact AshantiHub Support) in place of "Open a dispute instead." Not deployed; must ship before `LEDGER_ENABLED` is turned on for customers. Owed: visual check at 360/768/1280 px with the ledger on, on staging (ruling R4); per-sale query cost of the money block (prefetch refunds, read settings once) before `LEDGER_ENABLED` is on. |

## 7. Marketplace rebrand

Plan 1 (opening and storefront: `docs/superpowers/plans/2026-10-19-marketplace-1-opening-storefront.md`, spec `docs/superpowers/specs/2026-10-19-marketplace-rebrand-design.md`) is built on branch `feature/marketplace-1-storefront` and **not deployed**. The whole opening gate sits behind `MARKETPLACE_GATE_ENABLED` (default off): until it is set there is no countdown, no purchase block and no opening texts. Plan 3 (staff listing pipeline: `docs/superpowers/plans/2026-10-19-marketplace-3-staff-listing-pipeline.md`) is built on branch `feature/marketplace-3-staff-pipeline` and **not deployed**, with no switch of its own: staff drafts, the owner confirmation link (a text, so it needs the SMS provider), the `registration_confirmed` KYC gate, the `listings` target metric, the prospect pipeline, the GM role and the paid/refunded columns are live as soon as it ships. Refund counts read ledger rows only while `LEDGER_ENABLED` is on. **Precondition for any environment: live Hubtel SMS must be on (`OTP_SMS_PROVIDER=hubtel`) before staff-registered businesses can reach KYC there**: the owner-confirmation gate is always on and simulated texts confirm nothing. On staging with simulated texts, the management command `owner_confirmation_link <business_owner_id> --staff <email>` prints a fresh link (it refuses on a live provider). Open for the owner: the approver sees the owner's number masked with the audited reveal, not raw; no `listings` target limits are seeded. Plan 2 (business listing tools: variants, pending revisions, media and video, discounts, drop/discontinue, seller pages, Ashanti Direct) is **built** on branch `feature/marketplace-2-business-tools` and **not deployed**, pending staging (owner checklist in the PR body; needs a `web` and `worker` rebuild for ffmpeg and a re-applied Hestia API template for the 110m body size). Plan 3 is built (above); Plan 4 (shopper pages: product page, cart, checkout, payment verification, account hub and wallet tabs) is **built** on branch `feature/marketplace-4-shopper-pages` and **not deployed**; the browser width checks and the real-phone gallery gesture check are owner actions on staging. Plans after 4 are not started.
