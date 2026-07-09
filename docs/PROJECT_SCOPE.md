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
- Payments: **Hubtel** (Mobile Money + cards) — Phase 2
- AI: **Anthropic Claude API** for concierge search + business auto-reply — Phase 3
- Hosting: **Cloud VPS** (Docker Compose, mid-tier, ~$50-85/mo) — chosen for cost efficiency over managed PaaS
- Mobile app: out of scope for this document; planned as a separate phase/spec after the web platform stabilizes

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

- ✅ **Week 1 MVP:** Real auth, real business/listing data, self-serve business signup with admin approval, simple in-app messaging, credit scoring v1 (non-payment signals), dashboards wired to live data
- **Phase 2:** Hubtel payments integration
- **Phase 3:** Real-time messaging upgrade (Channels/Redis) + AI concierge and auto-reply (Claude API)
- **Phase 4:** Credit scoring enriched with real payment/transaction history
- **Phase 5:** DevOps hardening — security review, monitoring, backups, load testing
- **Future (separate spec):** Mobile app

WhatsApp remains a simple `wa.me` deep-link handoff throughout (no backend integration, no AI on that channel) — this was an explicit scope decision to avoid WhatsApp Business Platform cost/complexity.

---

## 5. Week 1 Sprint Plan — "No More Mock Data" MVP

**Pace:** 16 hrs/day × 7 days ≈ 112 hours, solo developer, zero schedule slack.

| Day   | Focus                                                                                                                                                                                                                                                                                                                                         | Output                                                                                                  |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| **1** | Django + DRF + Postgres scaffold, Docker Compose dev environment, `User` model (phone + email), JWT auth skeleton                                                                                                                                                                                                                             | Backend boots, migrations run, empty API live                                                           |
| **2** | Phone OTP (SMS via Hubtel SMS or Africa's Talking) + email/password auth flows                                                                                                                                                                                                                                                                | Real signup/login replaces the dormant `authModal` no-op                                                |
| **3** | `Business` & `Listing` models; migrate `CATEGORIES`/`LISTINGS` structure into Postgres; image upload (local disk); self-serve business signup API                                                                                                                                                                                             | Mock listing data fully retired from the codebase                                                       |
| **4** | Admin approval queue wired into `AdminDashboard`; frontend marketplace switched from mock arrays to real API calls; search/filter against real data                                                                                                                                                                                           | Admin can approve/reject real business submissions                                                      |
| **5** | Simple polling-based in-app inbox (replaces `showMessaging` mock); reviews/ratings persisted to DB                                                                                                                                                                                                                                            | Buyers and businesses can exchange real messages                                                        |
| **6** | Credit scoring v1 (listing completeness, response rate/time, review ratings, verification status, account age — **explicitly no payment history yet**); `BusinessDashboard`/`CreditDashboard`/`PaymentDashboard` wired to live data (`PaymentDashboard` shows ledger structure with a "Hubtel integration — Phase 2" state, not fake numbers) | All four dashboards render real data; credit score UI clearly labels which factors are live vs. pending |
| **7** | Production deploy (Docker Compose, Nginx, Certbot) to VPS; end-to-end QA; bug-fix buffer; client demo prep                                                                                                                                                                                                                                    | Live, mock-data-free MVP on a real URL                                                                  |

**Explicit exclusions from Week 1 (confirmed, moved to Phase 2+):** Hubtel payment processing, mobile app, real-time chat, AI concierge/auto-reply, payment-based credit signals.

**Risks called out in advance:**

- **SMS/OTP provider onboarding** (Hubtel SMS or Africa's Talking account approval) is outside developer control and is the single most likely thing to slip the schedule.
- **Zero slack.** This plan assumes no major blockers; any one surfacing (provider approval delay, VPS/DNS propagation issues, scope creep from the client mid-week) pushes the demo date.
- **Sixteen-hour days are not sustainable past this sprint.** Recommend returning to a normal pace for Phase 2 onward to avoid burnout-driven quality drop.

---

## 6. Phase 2+ Roadmap

Assuming a return to a sustainable full-time pace (~8 hrs/day) after the Week 1 crunch:

| Phase                                       | Scope                                                                                                                                          | Est. duration          |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| **2 — Payments**                            | Hubtel integration: checkout initiation, webhook/callback handling, transaction ledger, receipts                                               | 2-3 weeks              |
| **3 — Real-time + AI messaging**            | Django Channels/Redis upgrade; Claude API concierge (conversational listing discovery) and auto-reply assistant (covers offline businesses)    | 3-4 weeks              |
| **4 — Credit scoring v2**                   | Incorporate real payment/transaction history into the scoring model; refine `SCORE_FACTORS` weighting; lending-partner integration touchpoints | 1-2 weeks              |
| **5 — DevOps hardening & launch readiness** | Security review, automated backups (restic/off-site), monitoring (e.g. Uptime Kuma/Sentry), basic load testing, production runbook             | 1-2 weeks              |
| **Future — Mobile app**                     | Separate discovery/spec/brainstorming cycle once the web platform and API are stable                                                           | TBD, own project scope |

**Total Phase 2-5 estimate:** roughly **7-11 weeks** at a sustainable full-time pace (proportionally longer if part-time).

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
| Hubtel payment processing            | Transaction-fee based (Phase 2 — confirm rate card during integration)                                                                    |
| Claude API (AI concierge/auto-reply) | Usage-based; recommend a cheaper model tier for high-volume auto-replies and a stronger tier for the concierge, with a monthly budget cap |
| Off-site backups                     | ~$30-50/mo (S3-compatible storage, low volume at this stage)                                                                              |

---

## 9. Summary

Week 1 delivers a real, mock-data-free MVP: real users, real businesses, real listings, real (if payment-blind) credit scoring, all live on a production VPS. Phases 2-5 bring payments, AI-assisted real-time messaging, and a fully-informed credit score online over the following 7-11 weeks at a sustainable pace. Mobile app development is intentionally deferred to its own scoping cycle rather than bolted onto this timeline.
