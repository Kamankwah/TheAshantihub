# Staff Platform — Overview Design

**Date:** 2026-10-07
**Status:** Approved in conversation 2026-10-07 (scope, roles, build order). Phases 1–2 have their
own specs; phases 3–7 are captured here as decisions + research and get their own specs before
they are built.
**Visual design:** the "AshantiHub Staff Dashboards" design canvas (claude.ai artifact
`Xfzd46Ru5DMyDMiSM1pbcd`) — platform map, one screen per role, shared report, Staff profile,
delivery pricing. Numbers on it are illustrative.
**Screen designs — APPROVED by the owner 2026-10-08:** one canvas per role, every menu screen,
each opening with an approval sheet (claude.ai/artifact/<id>): Scout `CaAo7HnnkqH2Ew1wrLr1q1`,
Operations `TYmvvv4FYrxbmkdD7TK8V2`, Support `5xUjKAQXuFZ1XtrsmX4KV6`, Accounting
`WaCHB48XnDNNnin1r4xZbq`, Marketing `RheksK8bBTJx3kzVCmaK6L`, Delivery Manager
`SsYTfMDRZghU2Wh3gUDKGW`, Dispatch `GfNFNr8Uhs5rUbX2tvHw7L`, Super Admin (People & Operations)
`VV9uqqLed1JxZ4hpo5fHMe`, Super Admin (Money, Insights & Settings) `812gaBaYWk6zcK12m8Ciot`.
Each phase builds its screens to these designs (in the app's inline-`D` style); their numbers
are illustrative, and the product rules in §4 override anything a screen shows.
**Phase specs:** `2026-10-07-staff-foundations-design.md` (phase 1),
`2026-10-07-scouts-operations-design.md` (phase 2).

## 1. Goal

Turn every staff role's dashboard at `theashantihub.com/staff` from a handful of moderation tabs
into a complete, professional workspace: role-specific side menus, live data and live updates,
approvals routed to the right senior person, every staff action on a tamper-evident record, and
End-of-Day / Week / Month reports for every role, exportable to Excel, CSV and PDF.

Success means each role can do its whole working day inside its dashboard, everything they do is
visible to the people above them, and every number on every screen comes from the database. The
existing product rules still hold: businesses are never contacted directly by customers, and
nothing in the UI is fabricated — anything that needs an outside service AshantiHub doesn't have
yet (real Hubtel payments, an SMS or WhatsApp provider) says "not connected" instead.

## 2. Roles and reporting lines

| Role | Reports to | Invites | Job in one line |
|---|---|---|---|
| Super Admin | — | any role | Owns the platform; final approval on money, pay, prices and policy |
| Operations (renamed from Admin) | Super Admin | Scouts, Support | Onboarding, trust and service: KYC, moderation, fraud and returns; manages the scout and support teams |
| Scout | Operations lead | — | Registers businesses in the field, then manages them as their account manager |
| Support | Operations lead | — | Help desk for customers and businesses, call log, reviews, dispute intake |
| Delivery Manager | Super Admin | Dispatch | Live delivery operations, rider fleet, disputes and returns, COD cash, delivery pricing |
| Dispatch | Delivery Manager | — | Rider/driver: accepts jobs, checks in at pickup and drop-off, delivers with a code |
| Accounting | Super Admin | — | Ledger, payouts, commissions, payroll (PAYE, SSNIT), tax schedules, reconciliation |
| Marketing | Super Admin | — | Campaigns (SMS, WhatsApp, email, in-app), flash sales, coupons, banners, featured listings |

Reporting lines are data (`StaffUser.manager`), not code, so a line can move later (for example
Delivery under Operations) without a release.

## 3. Build order (decided)

| Phase | Scope | Spec |
|---|---|---|
| 0 | Real Sign out → `/staff`; staff-only `/staff`; view-only marketplace for staff sessions | Built: PR #134 (`feature/staff-signout-view-only`) |
| 1 | Foundations: Django 5.2 LTS, live updates (Channels + Redis), Operations rename, reporting lines, team invites, activity log, approvals engine, report engine, call log + tasks, alert-gap fix, session safety, 2-step sign-in for Super Admin | `2026-10-07-staff-foundations-design.md` |
| 2 | Scouts + Operations | `2026-10-07-scouts-operations-design.md` |
| 3 | Delivery Manager + Dispatch | to write — decisions in §5.1 |
| 4 | Support help desk + call log | to write — decisions in §5.2 |
| 5 | Accounting & payroll | to write — decisions in §5.3 |
| 6 | Marketing | to write — decisions in §5.4 |
| 7 | Super Admin console | grows with each phase; finished last — decisions in §5.5 |

Each phase gets its own spec → implementation plan → build → staging check. Production promotion
only on the user's explicit instruction (root `CLAUDE.md` golden rule).

## 4. Cross-cutting decisions (all phases)

| Topic | Decision |
|---|---|
| Staff on the marketplace | View-only. A staff session can browse but never buy, sell, book, review, register a business or create a listing/service; one shared message: "Staff accounts can't shop or sell. Sign out first." (phase 0) |
| Sign out | Always visible; lands on `/staff` with the staff sign-in open (phase 0) |
| Live updates | WebSockets via Django Channels + Redis (user chose this over SSE/polling) |
| Approvals | One engine and one inbox; the maker can never approve their own request (server-enforced); staged changes; escalation timers |
| Record of actions | Append-only, hash-chained activity log of every staff action |
| Reports | Day / week / month for every role: system numbers locked, narrative written by the person; Draft → Submitted → Acknowledged / Returned; CSV, Excel, PDF |
| Call log | Shared by Scout, Support, Operations (riders' calls logged automatically in phase 3) |
| Cash | Scouts never collect cash. Riders' cash-on-delivery is the only staff-held cash (phase 3 controls) |
| Delivery fee VAT | No VAT charged on delivery fees (user decision). Tax treatment is a per-charge-type setting so it can change without code |
| Payments | Still simulated until Hubtel goes live (`docs/HUBTEL_INTEGRATION.md`); ledger and payouts record approved instructions, no money moves |

## 5. Later phases — decisions and research so far

Research was done 2026-10-07 with web sources; ⚠ marks facts not confirmed from a primary source.

### 5.1 Delivery Manager + Dispatch (phase 3)

**Decided**
- **Delivery fee** is computed by the system from a rate card; nobody types a fee for an order.
  The Delivery Manager proposes the rate card (customer rates and rider pay), Accounting sees the
  margin, Super Admin approves. Each order stores the fee and its breakdown, fixed at checkout and
  paid with the items. (`Order` has no delivery-fee field today.)
- **Fee formula (Uber-style base + distance):** base fee + per-km × road distance of the whole
  route (every pickup, then the customer), with a minimum fee, a fee per extra pickup, vehicle
  multipliers (car, van), an express multiplier, an optional busy-hours multiplier; rounded up to
  the nearest GH₵0.50. Rider pay = per job + per km + waiting per minute after 10 minutes.
- **Distance** from a self-hosted OSRM router on the Ghana OpenStreetMap extract (free; about
  110 MB); fallback straight-line × a configurable factor.
- **Arrival check-ins:** Accepted → Arrived at pickup → Picked up (rider types the 4-digit pickup
  code shown on the business's order; optional package photo) → Arrived at customer (10-minute
  wait timer) → Delivered (rider types the customer's 4-digit code); or Can't deliver (reason
  list). The app offers each button within 150 m of the stop; a tap outside is allowed but
  flagged; every tap is time- and location-stamped and appears live on the manager's map, the
  business's order and the customer's tracking page. Alerts in-app and Web Push now, SMS later.
- **Rider ↔ customer:** riders may call the customer's delivery phone from the job (logged).
  Businesses never see customer numbers.
- **Auto-assignment** by proximity and urgency, offer with a timeout then cascade, force-assign
  and alert the manager when time is short (algorithm below).
- Delivery Manager invites riders/drivers (team invite).

**Research**
- A web app (PWA) only gets location while its screen is open: `watchPosition` stops when the
  app is backgrounded on Android and iOS; there is no background geolocation API. Design: an
  "On shift" screen with a Screen Wake Lock, pings every ~15 s / 50 m on a job and 60 s idle,
  the map shows each fix's age and greys a rider "stale" after 120 s. True background tracking
  needs the native app (`docs/MOBILE_APP_SCOPE.md`) or a Capacitor wrapper.
- Web Push: Android via FCM (send `Urgency: high`); iOS 16.4+ only for Home-Screen apps and
  every push must show a notification. Push is a wake-up; offers also show on the shift screen.
- Auto-assign v1: queue by slack (deadline − now − est. pickup − est. drop); eligible riders on
  shift with a fix ≤120 s old, right vehicle, <2 active jobs, COD float under the cap, ≤5 km;
  take the 10 nearest by straight line, get road ETAs; score =
  `ETA_pickup_min + 5·active + 10·(1−accept_30d) + 5·(1−ontime_30d) + vehicle_penalty`
  (weights tunable); offer 45 s, cascade; after 3 declines or slack <10 min force-assign and
  alert; batch only same-store orders with drop-offs within 2 km and no deadline breached.
- Disputes/returns taxonomy: customer unreachable, not received, damaged, wrong/missing item,
  return; evidence = codes, GPS stamps, photos, call log, wait timer. COD: daily reconciliation
  of delivered COD orders vs cash remitted; a per-rider cash cap blocks new COD jobs until they
  remit. Fraud signals: impossible travel speed, repeated "not received" on one rider–customer
  pair, one device per rider account.
- Riders' documents: Ghana Card, driver's licence (class A motorbike, B car), vehicle
  registration and roadworthy (6 months for commercial vehicles), insurance; expiry auto-suspends.
  Commercial motorbike ("okada") legalisation passed Parliament Dec 2025; the commercial rider's
  licence under L.I. 2519 ⚠ — keep it an optional "pending" field until DVLA confirms.
- Menus: Delivery Manager — Live operations, Dispatch queue, Active deliveries, Disputes & returns,
  Riders & drivers, Documents, Vehicles, Invite a rider, Shifts, Zones, Cash on delivery, Rider
  payouts, Reports, Auto-assign rules, Delivery time limits, Delivery pricing. Rider — Shift,
  Jobs, Earnings, Cash, Menu (documents & vehicle, profile, reports).

### 5.2 Support help desk (phase 4)

**Recommendation (decide at phase 4): rebuild Libredesk's features natively; do not run
Libredesk.** Libredesk (Go 1.25 + Vue 3 + Postgres + Redis, WebSockets) is licensed **AGPL-3.0**:
any modification must be offered as source to every user, including chat-widget users. Its API
creates conversations only for email inboxes and needs a contact email, while AshantiHub accounts
are phone-first; it has no notion of a business or listing, which the "Support about a business"
rule needs. Use it as a feature reference only — clean room, no copied code, SQL or strings.

Native P1: structured business/listing link on each conversation (today only a free-text "Re:"
subject), close/reopen/snooze (no endpoint can change status today), priority, assignee, reply
author (staff replies record no author today), internal notes contract-tested never to reach
customers, tags, canned replies, saved views, trigram search, three-pane inbox, call log. P2:
response-time targets with business hours, round-robin assignment with capacity, CSAT, honest
reports, contact form folded into the inbox. P3: email channel, automation rules, webhooks.
Also fix: guest threads are labelled "Business Owner" in `MessagingPanel.jsx`; `sender_type` has an
undocumented `guest` value. Support reports to an Operations lead.

### 5.3 Accounting & payroll (phase 5)

**Decided:** maker-checker on every outflow (Accountant prepares, Super Admin approves; two
approvers above a threshold); commissions accrue in phase 2 and are paid through Accounting;
no VAT on delivery fees; tax rates stored by effective date.

**Research (store every rate with its effective date):**
- PAYE, resident, monthly, from 1 Sep 2026 (Income Tax (Amendment) Act 2026, Act 1178): first
  GH₵588 0%, next 80 at 5%, next 100 at 10%, next 2,900 at 17.5%, next 16,000 at 25%, next 30,332
  at 30%, above 50,000 at 35%. Jan–Aug 2026 tax-free band GH₵490/month ⚠. Non-resident 25% flat.
  Bonus 5% up to 15% of annual basic, excess at graduated rates. Junior-staff overtime 5%/10%.
  DT 107 + DT 107A by the 15th of the following month.
  Sources: https://gra.gov.gh/domestic-tax/tax-types/paye/ ;
  https://gra.gov.gh/wp-content/uploads/2026/09/Amendments-To-The-Income-Tax-2015-Act-896_Updated-1.pdf
- Pensions (Act 766): employer 13% + employee 5.5% = 18.5% of basic salary; Tier 1 (SSNIT) 13.5%
  including 2.5% to NHIA, Tier 2 5%; due by the 14th; SSNIT penalty 3% per month. 2026 insurable
  earnings GH₵587.80–69,000 per month. Employee SSNIT is deducted before PAYE. Tier 3 relief up
  to 16.5% of basic. Sources: https://www.ssnit.org.gh/faqs/ ;
  https://www.ssnit.org.gh/wp-content/uploads/2026/01/Public-Notice-Min-Max-Insurable.pdf
- Commission: an employee's commission goes through PAYE; an independent agent's commission
  has 10% withholding tax (individual services 7.5%; DT 110 within 15 days).
  https://gra.gov.gh/domestic-tax/tax-types/withholding-tax/ . **Scouts' status (employee vs
  agent) needs an accountant / GRA private ruling before phase 5.**
- VAT from 1 Jan 2026 (VAT Act 2025, Act 1151): VAT 15% + NHIL 2.5% + GETFund 2.5% (20%
  effective), levies now input-claimable; COVID-19 levy and flat-rate scheme abolished; goods
  registration threshold GH₵750k. Platform fees (commission, subscriptions, promotions) are
  likely standard-rated ⚠ — accountant to confirm. https://gra.gov.gh/domestic-tax/tax-types/vat/
- Ledger: double entry, integer pesewas, balanced entries enforced in Postgres, idempotency keys,
  append-only (corrections by reversal), hash chain verified nightly with the day's seal sent
  off-server; daily three-way reconciliation (ledger vs Hubtel settlement vs bank/MoMo);
  payout-account changes start a 72 h cooling-off and notify old and new contacts; period close;
  anomaly alerts. Holding sellers' money may need a licence under the Payment Systems and
  Services Act (Act 987) ⚠ — lawyer, or Hubtel split settlement.
- Menu: Money desk · Ledger (journal, chart of accounts, trial balance) · Money in (collections,
  escrow) · Money out (payout runs, seller settlements, rider payouts, refunds) · People (payroll,
  commissions, pay profiles) · Tax (PAYE DT 107A, SSNIT & Tier 2, WHT, VAT/NHIL/GETFund) ·
  Controls (reconciliation, period close, audit chain, alerts) · Plans & pricing · Reports.

### 5.4 Marketing (phase 6)

- SMS providers: Hubtel (GH₵0.033 pay-as-you-go; same business account as payments, separate
  keys ⚠), Arkesel (GH₵0.022–0.031, delivery webhooks, also WhatsApp), mNotify (BMS). Sender
  names ≤11 characters, approved by the networks through the provider; **MTN blocks unregistered
  sender IDs since 8 Jul 2026, ~2 weeks to register — start early.** Alphanumeric senders are
  one-way, so opt-out is a link.
- WhatsApp Cloud API (Meta rate card from 1 Oct 2026, "Rest of Africa"): marketing USD 0.0225,
  utility/authentication 0.004; templates reviewed by Meta; 24 h service window; sending tiers
  250 → 2K → 10K → 100K; Meta silently caps marketing messages per person; no BSP required;
  opt-in must name AshantiHub.
- Law: Data Protection Act 2012 (Act 843) s.40 prior consent for direct marketing; Electronic
  Transactions Act (Act 772) s.50 opt-out in every message; NCA code: opt-in only, keep consent
  proof (date, time, wording, identity) while sending plus 2 years. Policy: send 08:00–19:00
  Mon–Sat, per-person frequency cap, separate unticked marketing opt-in.
- Consent ledger per contact × channel × purpose (append-only), send log with provider message id
  and delivery status. Every message under AshantiHub's sender, never a business's number.
- v1 menu: Overview · Campaigns (one composer for SMS, WhatsApp, email, in-app) · Calendar ·
  Templates · Segments · Consent & opt-outs · Flash sales · Coupons · Banners · Featured listings ·
  Moderation (hero, events, promotions) · Analytics · Settings (sender IDs & providers, quiet
  hours & limits, categories) · Reports. Campaigns above a budget threshold need Super Admin.
  Defer auctions, loyalty, A/B tests, referral programs.

### 5.5 Super Admin console (phase 7, grows each phase)

Menu (agreed): Home (Command center, My approvals) · People (Staff directory, Teams & reporting
lines, Invites, Roles & permissions, Sessions & devices, Leave & holidays) · Teams — step in
(Operations & scouts, Support, Delivery & dispatch, Marketing, Accounting) · Marketplace
(Businesses, Customers, Listings & services, Orders & deliveries, Events & tickets, Disputes &
returns) · Money (Revenue & sales, Payouts & payroll, Commissions, Refunds, Reconciliation) ·
Insights (Analytics, Growth funnel, Reports hub, Scheduled exports) · Security & audit (Audit log,
Sign-in history, Fraud & anomaly alerts, Data exports log) · Communication (Notification center,
Staff announcements) · Settings (Approval rules & timers, Commission policy, Delivery pricing,
Plans & prices, Target limits, Tax tables, Categories & zones, Integrations, System health).

**Staff profile** for any staffer: live status, performance vs targets, today's activity, report
record, access and devices, pay and commission; actions: view as them (read-only, logged, never a
session swap), change manager or role, permissions, sign out all devices, suspend.
2-step sign-in (authenticator app) for Super Admin ships in phase 1.

## 6. Open items

1. Scouts' employment status (employee vs commission agent) — accountant / GRA ruling, before
   phase 5.
2. VAT treatment of platform fees other than delivery — accountant, before phase 5.
3. Act 987 licensing for holding seller funds — lawyer, before real payouts.
4. SMS sender-ID registration with Hubtel — start before phase 6.
