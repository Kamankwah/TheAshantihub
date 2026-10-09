# Staff Platform Phase 2 — Scouts + Operations Design

**Date:** 2026-10-07
**Status:** Design approved in conversation 2026-10-07 (Section 2). Plan 2A implemented (S1–S4, S7, S9, S12 and their screens); plan 2B (S5, S6, S8, S10 service views, S13, the rest of S11) to follow.
**Parent:** `2026-10-07-staff-platform-overview-design.md`
**Depends on:** `2026-10-07-staff-foundations-design.md` (activity log, approvals engine, report
engine, call log + tasks, team invites, live updates)

## 1. Goal

Scouts stop being one-off address verifiers and become **field account managers**: they find and
register businesses, are automatically assigned to manage them, help them get fully onto the app
(photos, products, services, business details), follow up on subscription payments and
deliveries, work to daily targets that roll up to week and month, log every call and visit, earn
commission, and report daily. Operations (renamed from Admin) creates and leads the scout and
support teams, sets targets, approves what scouts submit, manages scouts' businesses at a higher
level, and resolves service, fraud and return issues — while keeping today's moderation work.

### Decisions already made (with the user)

| Question | Decision |
|---|---|
| When a registration counts | At **KYC approval**: counts toward the scout's target and earns the registration commission |
| Extra commission | A bonus once the business has **paid for 3 months** of subscription in total (user changed from "3 payments" at spec review) — rewards proper follow-up |
| Commission safety | 90-day hold; reversed if the business proves fake or duplicate (Claude's addition, accepted) |
| Owner's login when a scout registers | **Both:** hand-over on the scout's phone when the owner is present; a link otherwise (email now, SMS once a provider is connected) |
| Scout changes to a business | Go to the scout's Operations lead; new products also count as moderated by that approval; the owner is notified and can object (reverts) |
| Cash | Scouts never collect cash; owners pay in the app |
| Overdue subscription | Day 0 overdue + scout task; days 1–14 live with a renew banner; **day 15 listings hidden** (not deleted) until paid; reversible on payment |
| Support | Reports to an Operations lead (team invite from Operations) |

### Scope

**In scope:** scout registration on behalf of a business, owner hand-over/claim, duplicate and
self-dealing checks, portfolios and health, scout-proposed changes, visits with location, prospects,
follow-up tasks, targets and limits, holidays and leave, subscription overdue/pause, commission
records (accrual, hold, reversal, statements), fraud flags, Operations' workspace, Scout and
Operations report providers, scout and Operations screens.

**Out of scope:** paying commission out and posting it to a ledger (phase 5 — phase 2 produces
approved, payable records and statements); SMS sending (phase 6 — the SMS claim link waits);
structured business links on support conversations (phase 4 — Operations' support view uses what
exists today); delivery check-ins (phase 3); offline writes.

### Current state this changes

- Business owners can only self-register (`BusinessOwnerRegisterView`, AllowAny). No staff path.
- `ScoutAssignment` (`backend/accounts/models.py:313`) is a one-off verification visit with the
  report inline. It stays for KYC address checks; portfolio management is new.
- `BusinessOwnerProfile` has only a Ghana Post `gps_address` string — no coordinates.
- `Subscription` has `current_period_end` but no overdue, grace or pause state; `inactive` is
  never set; expiry is only checked when an owner creates a listing.
- Listing and photo writes are owner-only (`IsListingOwner`, `IsBusinessOwner`).

## 2. Design

### S1 — Scout registers a business

- **Wizard (phone-first):** owner's full name and phone; business name, kind and category; Ghana
  Post address; a **map pin** taken from the scout's location at the visit (lat, lng, accuracy)
  and adjustable on a map; signboard photo; owner's Ghana Card photo (front); optional owner email;
  optional first products. Draft kept on the device until submit (no offline submit).
- **Creates:** a `BusinessOwner` with `kyc_status = pending`, `registration_channel = scout`,
  `registered_by = scout`, `account_manager = scout`, an **unusable password**, and a KYC
  approval request (`business.kyc`) assigned to the scout's Operations lead.
- **Duplicates:**
  - **Block** if `login_phone`, payout MoMo number or `gps_address` already belongs to a
    business: "Already registered — ask Operations".
  - **Flag** (allowed, shown on the KYC request) if a business with a trigram-similar name
    (≥ 0.6) has a pin within 50 m.
  - **Self-dealing flag** if the owner phone or MoMo number matches any staff member's phone.
- **Location:** `BusinessOwnerProfile` gains `lat`, `lng`, `location_accuracy_m`,
  `location_set_by` (owner / scout / operations), `location_set_at`. If accuracy is worse than
  100 m the wizard warns and asks to wait for a better fix or place the pin by hand (recorded as
  manual).

### S2 — Owner login: hand-over and claim link

- **Hand-over (owner present):** after submit the scout taps "Hand to owner". The screen switches
  to an owner-only view: business summary, terms of use, "Set your password" (twice) and optional
  email. It posts to `POST /api/accounts/business-owners/claim/` with a **hand-over token**
  (single use, 30 min, bound to that scout session and that business). The password never enters
  the scout's app state; no owner session is created on the scout's device; the view returns to
  the scout when done.
- **Claim link (owner absent):** `claim_token` (stored hashed, 7 days, resendable by the scout or
  Operations) sent by email when the owner gave one; by SMS once phase 6 connects a provider.
  Opens `/business/claim?token=…` with the same owner view.
- **Consent record:** terms version, accepted-at, channel (hand-over / link), device and IP —
  because a staff member started the account.
- Until claimed the business shows "Owner hasn't set a login yet" to the scout and Operations;
  everything else (KYC, listings via the scout) proceeds.

### S3 — Portfolio and business health

- `BusinessOwner.account_manager` (scout, nullable) and `registered_by` (scout, nullable).
  `AccountManagerAssignment(business_owner, scout, assigned_by, started_at, ended_at, reason)`
  keeps the history. Self-registered businesses can be assigned to a scout by Operations.
- **Health** (rule-based, computed on read, snapshotted nightly for reports):

| Rating | Any of |
|---|---|
| At risk | subscription paused; no listing live; no order in 60 days (once KYC is 30+ days old); a confirmed fraud flag |
| Needs attention | subscription overdue; fewer than 3 listings live; no order in 30 days; an open dispute or return; no scout contact (call or visit) in 30 days |
| Healthy | none of the above |

- The scout sees their portfolio; Operations sees all portfolios and can **reassign** businesses
  between scouts (records an assignment and an activity event; the new scout is notified).

### S4 — Scout-proposed changes (approvals engine kinds)

| Kind | What the scout submits | Applied on approval | Approver |
|---|---|---|---|
| `business.kyc` | the registration (S1) | runs the existing KYC approve logic (the KYC queue still works and resolves the request too) | scout's Ops lead → any Operations → Super Admin |
| `business.update` | changed fields of `BusinessOwner` / `BusinessOwnerProfile` (name, phone, address, hours, pin, description; payout details are **not** editable by scouts) | fields set; phone change re-runs the duplicate check | same chain |
| `listing.create` | a new product or service as the business (`Listing.created_by_staff = scout`) | listing published — this approval **is** its moderation (Operations holds `listings.moderate`) | same chain |
| `listing.photos` | photos for an existing listing | photos attached | same chain |

- **Owner notified** on apply ("Your account manager Kwame added 4 photos"), with **"This wasn't
  me / undo"** for 7 days: reverts using the request's `before` snapshot, raises a fraud flag for
  Operations, and records it.
- Object rule: a scout can submit only for businesses where they are `account_manager`.

### S5 — Visits, prospects and follow-ups

- `VisitCheckIn`: `scout`, `business_owner` (or `prospect`), `purpose` (prospecting,
  registration, onboarding & photos, subscription follow-up, delivery follow-up, info update,
  verification), `checked_in_at`, `lat`, `lng`, `accuracy_m`, `distance_m` (from the business
  pin), `outside_radius` (> 100 m), `checked_out_at` (+ location), `notes`. Photos taken during
  a visit are stored with server time and the device location at capture. Location is read only
  at check-in, check-out and photo capture — never tracked between.
- `Prospect`: name, phone, area, pin, `status` (new / interested / follow up / registered / not
  interested), `next_follow_up_at` (creates a Task). Registering a prospect links it.
- **Follow-up tasks** (foundations `Task`) created automatically for: subscription overdue (day 0,
  reminders day 7 and 13); a delivery problem on a portfolio business (delivery dispute or failed
  delivery; full feed arrives with phase 3); a returned approval; a call or prospect follow-up date.
- Scouts see their businesses' orders and delivery statuses read-only and can **flag a delivery
  problem**, which notifies the Delivery Manager and creates a task for them.
- Existing `ScoutAssignment` verification visits remain and appear in the scout's list; a
  verification check-in can be done by any scout Operations assigns.

### S6 — Targets, calendar and leave

- **Measures:** registrations (KYC approvals of businesses the scout registered), visits
  (check-ins with a check-out; outside-radius ones count but are shown), calls (logged by the
  scout), renewals (successful subscription payments by businesses the scout managed at payment
  time).
- `TargetPlan(staff, metric, daily_value, effective_from, set_by)` — the daily target for a date
  is the plan value in force if it is a working day for that scout, else 0.
- **Working days:** per scout, default **Monday–Saturday** (user decision; configurable per
  scout). `PublicHoliday(date, name)` stores the **observed** date, maintained by Super Admin.
  `Leave(staff, start, end, kind, recorded_by)` recorded by the scout's Operations lead.
- Week and month targets = sum of the days; **team target = sum of the team's scouts**.
- `TargetLimit(metric, min_daily, max_daily)` set by Super Admin. Operations changes within the
  limits apply immediately (recorded); a change that lowers a scout's current-month total after
  the 1st is an approval (`targets.cut`) to Super Admin.
- Actuals are computed from source records, never typed; the Scout's Today screen, the Operations
  scoreboard and reports read the same service.

### S7 — Subscription overdue, grace and pause

- `Subscription` gains `overdue_since` and `paused_at`. An hourly job:
  - `current_period_end` passed and unpaid → `overdue_since = period_end` → notify owner, task to
    the account manager (or Operations if none).
  - 14 full days after `overdue_since` (the start of day 15) → `paused_at = now`; the business's listings and events are
    hidden from public browse (same mechanism as `is_suspended`) — not deleted, not unpublished.
  - A successful subscription payment clears both immediately; listings reappear.
- Trials end into the same clock. Owner sees a banner in their dashboard during grace ("Renew by
  21 Oct to keep your listings visible") and a notice when paused. In-app + email now; SMS later.
- Status for screens: active / overdue (day n of 14) / paused.
- **Switched off for now (user decision 2026-10-09):** the pause runs only while
  `SUBSCRIPTION_PAUSE_ENABLED` is on (env, default off), because an in-app wallet will renew
  automatically later. While off, the clock still marks overdue, reminds on days 7 and 13 and tasks
  the account manager, but nothing is paused or hidden, and no notice, banner or screen counts down
  to a pause ("Your subscription ended on {date}. Renew to keep your plan.").

### S8 — Commission records

- `CommissionPolicy(kind, amount, effective_from, proposed_by, approved_by)` — kinds
  `registration` and `three_paid_months_bonus`. Accounting proposes, Super Admin approves
  (`commission.policy` approval kind). **No amounts are hard-coded.**
- `CommissionAccrual(staff, business_owner, kind, amount, policy, earned_at, hold_until, status,
  reversed_reason, source_type/id)`; unique per (business_owner, kind):
  - **Registration:** created when KYC is approved for a business with `registered_by` set; to
    the registering scout.
  - **Three-paid-months bonus:** created by the successful subscription payment that brings the
    business's **total paid months to 3 or more** (user decision: count paid months, so 3 monthly
    payments, one 3-month payment, or a 6- or 12-month payment all qualify; trial time never
    counts); to the scout who is `account_manager` at that moment.
  - `hold_until = earned_at + 90 days`; status on hold → payable (daily job) → in batch → paid
    (phase 5) or **reversed**.
  - **Reversal:** a confirmed fraud flag of kind fake/duplicate on the business within the hold
    reverses its accruals; after payout, phase 5 nets a clawback against future commission.
- Scouts see a statement (earned, on hold until, payable, paid, reversed); Accounting and Super
  Admin see all, with export. Paying out is phase 5.

### S9 — Fraud flags

`FraudFlag(kind, target, detail, raised_by (system/staff), status open/confirmed/dismissed,
resolved_by, resolution_note)`. Raised automatically by S1 (duplicate, self-dealing), S4 (owner
"wasn't me"), and S5 (repeated outside-radius check-ins: 3 in 7 days); raised by hand by
Operations or Support. Confirming a fake/duplicate business offers suspension and reverses
commission. Operations owns the queue; Super Admin sees it.

### S10 — Operations' visibility

- **Scouts:** all scouts (every team) read-only; act on their own team.
- **Activity visibility** (`activity.view_domains` for Operations, by actor role): everything
  done by scouts, support, dispatch and marketing; from Accounting only verbs starting
  `commission` or `payout` (who/when/amount, never account numbers); from the Delivery Manager
  only verbs starting `delivery.dispute`, `order-assign-dispatch` or `order-delivery-status`.
- **Service issues for portfolio businesses:** contact messages, disputes and returns via the
  order's business, and conversations where the business owner is the participant. Customer
  conversations *about* a business aren't linked structurally until phase 4 — the screen says so.
- **Delivery:** delivery assignments and disputes for any business (read), with fraud/return
  actions limited to flagging and the existing `orders.manage_delivery` status updates.

### S11 — Screens

**Scout (phone-first, bottom bar):** Today · Businesses · Register · Calls · Menu.
- *Today:* today's targets with week/month totals; Check in; Register; due follow-ups; commission
  summary (as on the design canvas).
- *Businesses:* portfolio with health filter → business page (details, listings, photos,
  subscription state, orders and deliveries, calls, visits, pending changes; actions: propose a
  change, add a product, add photos, log a call, check in, flag a delivery problem, resend claim
  link).
- *Register:* the wizard and hand-over.
- *Calls:* log and list (foundations).
- *Menu:* Prospects · Visits · Tasks · Targets (day/week/month) · Commission · Team leaderboard
  (activations this month, within the team) · Reports · Profile · Sign out.

**Operations (side menu):** Overview · Approvals · People (Scouts, Support team, Invite, Targets,
Leave & calendar) · Businesses (All portfolios, At risk, Subscriptions due) · Moderation (KYC
queue, Listings, Hero & events, Reviews — existing panels) · Service (Support issues, Deliveries &
returns, Fraud cases) · Activity (Staff activity, Visit map — today's check-ins on Leaflet) ·
Reports (Mine, My team) · Settings (Zones, Site settings, Contact messages).
- *Overview KPIs:* team registrations today vs target; activations this month (KYC approved +
  first listing live); approvals waiting and the oldest's age; scouts checked in vs working today;
  at-risk businesses; open service issues. Scout progress table, approvals waiting, live activity,
  issues on the team's businesses (as on the canvas).
- *Targets editor:* scouts × measures grid, within limits, effective date, preview of week/month
  and team totals.

### S12 — Permissions

New: `businesses.register` (Scout, Operations), `businesses.manage_portfolio` (Scout — own
portfolio only, object-checked), `portfolio.manage` (Operations — reassign, all portfolios),
`targets.manage` (Operations — own team; Super Admin all), `targets.limits` (Super Admin),
`calendar.manage` (Super Admin — holidays), `leave.record` (Operations — own team),
`commission.view_own` (Scout), `commission.view_all` (Accounting, Super Admin),
`commission.policy` (Accounting proposes, Super Admin approves), `fraud.manage` (Operations,
Super Admin), `fraud.flag` (Support, Operations). Plus the foundations permissions. Super Admin
holds all (existing invariant test).

### S13 — Reports

Scout provider: targets vs actual for each measure, visits (flagged count), calls by outcome,
registrations submitted / approved / returned, approvals pending, follow-ups done / missed,
portfolio health counts, commission earned in the period. Operations provider: team totals vs
target, per-scout table, approvals decided and median time to decide, at-risk count change,
service issues opened/closed, fraud flags, reports acknowledged/returned.

## 3. Errors and edge cases

- Scout leaves: deactivation is blocked until Operations reassigns their portfolio; their
  on-hold registration commissions still release to them unless reversed (policy: earned is
  earned). Bonus goes to the account manager when the 3rd paid month is reached, so it follows the portfolio.
- Owner objects after apply: revert may fail if the target changed again; then the flag stays
  open for Operations to resolve by hand.
- Location denied by the browser: check-in can't complete; the scout sees how to enable it. A
  manual pin at registration is allowed and marked manual.
- Duplicate found after approval (e.g. a later registration matches): fraud flag on both; no
  automatic action.
- Payment arrives during pause: unpause in the same transaction as the payment's finalisation.

## 4. Testing

- Registration: blocks exact duplicates, flags near ones and self-dealing; creates the KYC request
  for the scout's lead; unusable password until claim.
- Hand-over: token single-use, 30 min, bound to scout and business; password never returned or
  logged; consent recorded; claim link expiry and resend.
- Approvals kinds: each applies atomically; scouts can't submit for businesses they don't manage;
  owner undo reverts and flags.
- Targets: holidays and leave give 0; working-days config; week/month/team sums; limit enforcement;
  mid-month cut needs Super Admin.
- Overdue: day 0 task and notice, day 15 pause hides listings, payment unpauses; trial expiry.
- Commission: one accrual per business per kind (idempotent on retries); paid-months counting
  excludes trials; hold release; reversal on confirmed fraud; bonus goes to the manager at the time.
- Permissions: scout object scope; Operations acts only on own team but reads all scouts.
- Frontend: wizard, hand-over (no password in scout state after submit), Today screen, Operations
  overview and targets editor, StaffDashboard contract updates where nav changes.

## 5. Rollout

Behind the phase 1 foundations on staging. Seed one Operations lead with the existing staging
scout account and a few demo businesses (fictional, `example.com`, as the staging demo data
already does). Verify on a real phone: registration wizard with location, hand-over, check-in
radius, Today screen. Production only on the user's say-so. Update `docs/STAFF_ROLES.md` (Scout
and Operations duties, permissions, separation of duties) when it lands.

## 6. Review outcome (2026-10-07)

Spec approved by the user with two changes, both applied above: scouts' default working days
include **Saturday**, and the bonus counts **paid months** (≥ 3), not payments. Health thresholds
(3 listings, 30/60 days) accepted as starting values; commission amounts come from Commission
policy (no defaults in code).
