# TheAshantiHub — Project Scope & Timeline

**Date:** 2026-07-08
**Prepared for:** addo.kwabena26@gmail.com (Ashanithub)
**Prepared by:** Simon Peter Kuunim-Marbell Full Stack Engineer (solo, full-time / 16 hrs-per-day sprint pace for Week 1)

---

## 1. Executive Overview

TheAshantiHub currently exists as a **front-end-only prototype**: a single-page React application with a polished, Ghanaian-themed UI covering a business marketplace, admin dashboard, business dashboard, payments dashboard, and a credit-scoring dashboard. None of it is backed by a real system — every listing, transaction, credit score, and user is hardcoded mock data living in one 3,600-line file, and there is no server, database, authentication, or payment processing behind it.

This document scopes the work to turn that prototype into a real, working product: what exists today, what has to be built, in what order, on what stack, and on what timeline — including a compressed **Week 1 sprint** to get a mock-data-free MVP in front of the client, followed by a phased roadmap to bring payments, AI-assisted messaging, and enriched credit scoring online.

**Headline decisions:**

- Backend: **Django + Django REST Framework**, PostgreSQL, Django Channels (later phase)
- Frontend: **React 19 + Typescript + Vite SPA**, `replaced by real API calls refer to docs/FRONTEND_MODERNIZATION.md for modernization plan`
- Payments: **Hubtel** (Mobile Money + cards) — **Phase 1** (pulled forward from the original Phase 2 slot; see [§6a](#6a-revision-note-hubtel-moved-into-phase-1) and `docs/HUBTEL_INTEGRATION.md` for the technical spec)
- AI: **Anthropic Claude API** for concierge search + business auto-reply — Phase 2
- Hosting: **Cloud VPS** (Docker Compose, mid-tier, ~$50-85/mo) — chosen for cost efficiency over managed PaaS
- Mobile app: out of scope for this document; full implementation scope now lives in `docs/MOBILE_APP_SCOPE.md`, sequenced after Phase 1 (needs the live backend/auth/Hubtel API to consume)

---

## 2. Current Implementation (As-Is)

| Area                      | Current state                                                                                                                                |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend                  | React 18 + Vite, no router — navigation via local `useState` flags (`page`, `isAdmin`, `showBizDash`, etc.) in `App.jsx`                     |
| Backend                   | **None.** No server, no API, no database                                                                                                     |
| Data                      | Hardcoded in-file: `CATEGORIES`, `LISTINGS`, `MOCK_CREDIT_BUSINESSES`, `LENDING_PARTNERS`, `SCORE_FACTORS`                                   |
| Auth                      | Not implemented — `authModal`/`user` state exists and gates features, but no modal renders and signup/login no-ops                           |
| Messaging                 | No in-app messaging; contact is `wa.me` deep links only (`handleWA`)                                                                         |
| Payments                  | `PaymentDashboard` renders against mock data only; no processor integrated                                                                   |
| Credit scoring            | `CreditDashboard`/`ScoreGauge` compute against `MOCK_CREDIT_BUSINESSES`; no real signals                                                     |
| Admin/Business dashboards | Full UI exists (`AdminDashboard`, `BusinessDashboard`), fed entirely by mock data; `isAdmin` toggled by a hidden 5-click gesture on the logo |
| Analytics                 | In-memory event array (`Analytics.track`) — does not persist or send anywhere                                                                |
| Hosting                   | Static Vercel deployment (SPA rewrite + security headers), no backend to host                                                                |

**Gap in one sentence:** everything the UI _shows_ exists; nothing it _depends on_ is real.

---

## 3. Target Architecture

| Layer               | Choice                                                                                                            | Rationale                                                                                                    |
| ------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Backend framework   | Django + Django REST Framework                                                                                    | Batteries-included (auth, admin, ORM, migrations), fast to build a solid API solo                            |
| Database            | PostgreSQL                                                                                                        | Django's native production DB; handles relational data (users, listings, bookings, messages, scores) cleanly |
| Real-time messaging | Django Channels + Redis (Phase 3)                                                                                 | Needed once AI auto-reply/concierge requires live chat; deferred past Week 1 to control scope                |
| Auth                | Phone number + OTP (primary) and email + password (fallback)                                                      | Matches how Ghanaian users already authenticate with Mobile Money; email as a fallback channel               |
| Payments            | Hubtel (Mobile Money + card aggregator)                                                                           | Ghana-market fit, avoids direct telco integration complexity                                                 |
| AI                  | Anthropic Claude API                                                                                              | Concierge (conversational listing discovery) + auto-reply (covers businesses when offline)                   |
| Media storage       | VPS local disk (Docker volume) + scheduled off-site backup                                                        | Zero extra monthly cost; sufficient at launch scale                                                          |
| Frontend            | React 19/ Typescript/ Vite SPA, retained                                                                          | Replace mock arrays/state with real API calls; no framework rewrite                                          |
| Hosting             | Single Cloud VPS, mid-tier (~$50-80/mo)                                                                           | Chosen for cost efficiency per client preference                                                             |
| Deployment          | Docker Compose (Django+Gunicorn, Postgres, Nginx+Certbot) + GitHub Actions (build & SSH deploy on push to `main`) | Full control, no extra managed-PaaS layer, industry-standard, low ongoing cost                               |

---

## 4. Feature Scope

All mock data is being removed. Full platform scope, delivered in phases:

- **Phase 1:** Real auth, real business/listing data, self-serve business signup with admin approval, simple in-app messaging, credit scoring v1 (non-payment signals), dashboards wired to live data, **plus real Hubtel payments integration** (checkout, webhook handling, transaction ledger — see `docs/HUBTEL_INTEGRATION.md`)
- **Phase 2:** Real-time messaging upgrade (Channels/Redis) + AI concierge and auto-reply (Claude API)
- **Phase 3:** Credit scoring enriched with real payment/transaction history (now unblocked immediately after Phase 1 since Hubtel data already exists)
- **Phase 4:** DevOps hardening — security review, monitoring, backups, load testing
- **Parallel/after Phase 1 (separate spec):** Mobile app — see `docs/MOBILE_APP_SCOPE.md`

WhatsApp remains a simple `wa.me` deep-link handoff throughout (no backend integration, no AI on that channel) — this was an explicit scope decision to avoid WhatsApp Business Platform cost/complexity.

---

## 5. Phase 1 Build Plan — "No More Mock Data" + Real Payments

Phase 1 now has two parts: the original Week 1 mock-data-removal sprint (Days 1-7, unchanged), followed by a Hubtel integration stretch (Days 8-13) that used to be Phase 2. Full technical detail for the Hubtel work is in `docs/HUBTEL_INTEGRATION.md`; this section only carries scheduling/scope.

### 5a. Week 1 — Mock Data Removal Sprint

**Pace:** 16 hrs/day × 7 days ≈ 112 hours, solo developer, zero schedule slack.

| Day   | Focus                                                                                                                                                                                                                                                                                                                                         | Output                                                                                                  |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| **1** | Django + DRF + Postgres scaffold, Docker Compose dev environment, `User` model (phone + email), JWT auth skeleton                                                                                                                                                                                                                             | Backend boots, migrations run, empty API live                                                           |
| **2** | Phone OTP (SMS via Hubtel SMS or Africa's Talking) + email/password auth flows                                                                                                                                                                                                                                                                | Real signup/login replaces the dormant `authModal` no-op                                                |
| **3** | `Business` & `Listing` models; migrate `CATEGORIES`/`LISTINGS` structure into Postgres; image upload (local disk); self-serve business signup API                                                                                                                                                                                             | Mock listing data fully retired from the codebase                                                       |
| **4** | Admin approval queue wired into `AdminDashboard`; frontend marketplace switched from mock arrays to real API calls; search/filter against real data                                                                                                                                                                                           | Admin can approve/reject real business submissions                                                      |
| **5** | Simple polling-based in-app inbox (replaces `showMessaging` mock); reviews/ratings persisted to DB                                                                                                                                                                                                                                            | Buyers and businesses can exchange real messages                                                        |
| **6** | Credit scoring v1 (listing completeness, response rate/time, review ratings, verification status, account age — **explicitly no payment history yet**); `BusinessDashboard`/`CreditDashboard`/`PaymentDashboard` wired to live data (`PaymentDashboard` shows ledger structure with a "Hubtel integration — Days 8-13" state, not fake numbers) | All four dashboards render real data; credit score UI clearly labels which factors are live vs. pending |
| **7** | Production deploy (Docker Compose, Nginx, Certbot) to VPS; end-to-end QA; bug-fix buffer; client demo prep                                                                                                                                                                                                                                    | Live, mock-data-free MVP on a real URL                                                                  |

**Explicit exclusions from Week 1 (confirmed, moved to Days 8-13 or later phases):** Hubtel payment processing (→ Days 8-13 below), mobile app, real-time chat, AI concierge/auto-reply, payment-based credit signals.

**Risks called out in advance:**

- **SMS/OTP provider onboarding** (Hubtel SMS or Africa's Talking account approval) is outside developer control and is the single most likely thing to slip the schedule.
- **Zero slack.** This plan assumes no major blockers; any one surfacing (provider approval delay, VPS/DNS propagation issues, scope creep from the client mid-week) pushes the demo date.
- **Sixteen-hour days are not sustainable past this sprint.** Recommend returning to a normal pace for Days 8-13 onward to avoid burnout-driven quality drop.

### 5b. Days 8-13 — Hubtel Payments Integration

**Pace:** normal full-time (~8 hrs/day), not a 16-hr crunch — see risk note above. Full technical detail in `docs/HUBTEL_INTEGRATION.md`.

| Day | Focus | Output |
| --- | --- | --- |
| **8** | Hubtel merchant account application (if not already approved) and sandbox credential setup; webhook endpoint scaffold behind HTTPS | Sandbox credentials live, empty webhook endpoint reachable |
| **9** | Checkout API integration — `MoMoPayment` (`App.jsx:638-923`) swaps its simulated `setTimeout` flow for a real Hubtel Checkout redirect/poll | Real checkout flow works end-to-end in sandbox |
| **10** | Webhook handler: signature verification, idempotency key handling, retry/replay safety | Payment status updates arrive server-side, not client-trusted |
| **11** | `PaymentDashboard` (`App.jsx:925`) transaction table backed by real webhook-updated records, replacing `MOCK_TRANSACTIONS` | Admin sees live transaction ledger |
| **12** | `MoMoModal` (`App.jsx:1816-1900`) swapped to the same real checkout flow; reconciliation pass across MTN MoMo / Vodafone Cash / AirtelTigo Money | Both payment entry points are real, all three networks tested in sandbox |
| **13** | Production credential cutover, go-live QA, buffer | Hubtel payments live in production |

**Explicit note:** merchant account approval turnaround is outside developer control (same class of risk as SMS/OTP onboarding above) — if Hubtel approval is still pending when Day 8 arrives, this block slips as a unit; do not start Day 9 work against production credentials that don't exist yet.

---

## 6. Phase 2-4 Roadmap

Assuming a return to a sustainable full-time pace (~8 hrs/day) after the Phase 1 crunch (Days 1-13):

| Phase                                       | Scope                                                                                                                                          | Est. duration          |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| **2 — Real-time + AI messaging**            | Django Channels/Redis upgrade; Claude API concierge (conversational listing discovery) and auto-reply assistant (covers offline businesses)    | 3-4 weeks              |
| **3 — Credit scoring v2**                   | Incorporate real payment/transaction history (now available from Phase 1 Hubtel data) into the scoring model; refine `SCORE_FACTORS` weighting; lending-partner integration touchpoints | 1-2 weeks              |
| **4 — DevOps hardening & launch readiness** | Security review, automated backups (restic/off-site), monitoring (e.g. Uptime Kuma/Sentry), basic load testing, production runbook             | 1-2 weeks              |
| **Parallel/after Phase 1 — Mobile app**     | React Native (iOS + Android) build against the now-live backend/Hubtel API — see `docs/MOBILE_APP_SCOPE.md` for the full phased spec           | Own timeline, see spec |

**Total Phase 2-4 estimate:** roughly **5-8 weeks** at a sustainable full-time pace (proportionally longer if part-time) — shorter than the original 7-11 week Phase 2-5 estimate because payments moved into Phase 1.

### 6a. Revision note: Hubtel moved into Phase 1

This roadmap originally scoped Hubtel payments as Phase 2 (2-3 weeks, after the Week 1 MVP sprint). Per updated direction, Hubtel is now Phase 1 scope (Days 8-13, §5b above) so that a real payment ledger exists from the first production release rather than a second phase — this also unblocks Phase 3 credit-scoring-v2 immediately instead of waiting on a separate payments phase to land first.

---

## 7. DevOps & Deployment

- **Environment:** Single Cloud VPS, mid-tier sizing (~$50-80/mo — e.g. 4-8 vCPU / 8-16GB RAM tier)
- **Stack on the VPS (via Docker Compose):**
  - `web`: Gunicorn serving Django/DRF (Daphne/Uvicorn added in Phase 3 for Channels)
  - `db`: PostgreSQL
  - `redis`: added in Phase 3 for Channels
  - `nginx`: reverse proxy + static/media file serving + TLS via Certbot
- **CI/CD:** GitHub Actions — build on push to `main`, deploy over SSH, restart Compose stack
- **Backups:** Scheduled dump of Postgres + media volume, shipped off-site (e.g. restic to Backblaze B2/S3-compatible target) — added as part of Phase 5 hardening, though a basic cron backup should exist from Week 1 onward given real user data starts accumulating immediately
- **Secrets:** Environment variables via `.env` (not committed), consumed by Docker Compose
- **Monitoring:** Deferred to Phase 5 (Sentry for error tracking, uptime checks) — acceptable gap for a Week 1 MVP, not acceptable to carry into a real launch

---

## 8. Cost Considerations (Ongoing, Post-Launch)

| Item                                 | Estimate                                                                                                                                  |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| VPS hosting                          | $50-80/mo                                                                                                                                 |
| Domain + TLS                         | Domain done(theashintihumb.co); TLS via Certbot                                                                                           |
| SMS OTP                              | Per-message cost via Hubtel SMS/Africa's Talking (usage-dependent)                                                                        |
| Hubtel payment processing            | Transaction-fee based (Phase 1, Days 8-13 — confirm rate card during integration)                                                                    |
| Claude API (AI concierge/auto-reply) | Usage-based; recommend a cheaper model tier for high-volume auto-replies and a stronger tier for the concierge, with a monthly budget cap |
| Off-site backups                     | ~$30-50/mo (S3-compatible storage, low volume at this stage)                                                                              |

---

## 9. Summary

Phase 1 (Days 1-13) delivers a real, mock-data-free MVP with **real Hubtel payments already live**: real users, real businesses, real listings, a working transaction ledger, and payment-blind credit scoring v1, all on a production VPS. Phases 2-4 bring AI-assisted real-time messaging, a fully payment-informed credit score, and DevOps hardening online over the following 5-8 weeks at a sustainable pace. The mobile app has its own full implementation scope in `docs/MOBILE_APP_SCOPE.md` and can start in parallel with or immediately after Phase 1, since it depends on the same backend/auth/Hubtel API rather than on Phases 2-4.
