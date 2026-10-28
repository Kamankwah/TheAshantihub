# Wallets, Escrow, Platform Fees, Stock Offers and OTP Security — Design

**Status:** Approved 2026-10-15. Stage 1 plan: docs/superpowers/plans/2026-10-15-ledger-fees-foundation.md. Stage 2 (OTP, backend) plan: docs/superpowers/plans/2026-10-16-otp-security.md. Stage 3 plans: docs/superpowers/plans/2026-10-16-wallets-payments-3a.md (wallet payments and refunds) and docs/superpowers/plans/2026-10-16-withdrawals-3b.md (payout destinations, withdrawals, reconciliation). Plan 1b (services, events and stays): docs/superpowers/plans/2026-10-16-ledger-services-events-stays-1b.md. Stage 4 (vendor dashboard and texts, backend) plan: docs/superpowers/plans/2026-10-16-vendor-side-sms-4.md. Stage 5 (third-party dispatch, backend) plan: docs/superpowers/plans/2026-10-16-dispatch-wallets-5.md. Stage 6 (catalogue, offers and stock alerts, backend) plan: docs/superpowers/plans/2026-10-16-catalogue-offers-stock-6.md.
**Scope:** One system, built in the order given in §11. Stage 1 (ledger) with Plan 1b (services, events and stays),
Stage 2 (OTP, backend), Stage 3 (wallets, payments, refunds, withdrawals and reconciliation, backend), Stage 4 backend
(the vendor money API and business texts, Plan 4) and Stage 5 (third-party rider wallets and daily commission, backend)
are implemented behind switches that default off (branches feature/ledger-stage1, feature/ledger-services-1b,
feature/otp-security, feature/wallets, feature/vendor-side-4 and feature/dispatch-wallets-5; see section 13); Stage 6
backend (catalogue entries, offers, other sellers, stock cover and low-stock alerts; branch
feature/catalogue-offers-6) is implemented behind three switches that default off: `STOCK_ALERTS_ENABLED` (the alerts),
`SOLD_OUT_HIDDEN_ENABLED` (sold-out hiding) and `CATALOGUE_MATCHER_ENABLED` (the barcode matcher: the nightly job and
approve's on-commit run); later stages are specs only.
**Basis:** The owner's brief, plus the decisions in §1, reconciled with the existing code in §13.

## 1. Decisions (settled in brainstorming)

| # | Topic | Decision |
|---|---|---|
| 1 | Who holds money | Hubtel (or a bank) holds all funds. AshantiHub keeps the **ledger** and instructs payouts. Built behind a provider interface on **simulated rails** until credentials and regulatory clearance exist. |
| 2 | Fee cap | Per vendor, **lifetime**, cumulative across categories. Blank = no cap. The fee that crosses the cap is charged only up to the remainder. |
| 3 | Fee base | Vendor's item subtotal **after discounts, excluding delivery**. |
| 4 | Delivery | Customer pays delivery **on top** of items. One delivery fee per order, never split across vendors, never borne by the vendor. Goes wholly to the rider (third party) or AshantiHub (company rider). |
| 5 | Rider commission | **10% reserve held on every delivery credit** to a third-party rider; the other 90% is withdrawable immediately. Reserve is posted to platform income at end of day, with a true-up if the rate changed that day. |
| 6 | Refund after release | **Amended 2026-10-15:** there is no timed hold-back (see row 17). A refund approved after release debits vendor Available (may go negative, recovered from future sales); platform fee is returned in proportion. |
| 7 | Stock sourcing | **Amazon-style separate offers.** No auto-gathering and no price tolerance. Customer chooses to add other sellers' offers. |
| 8 | Offer grouping | **Hybrid.** Branded/barcoded products attach to a staff-approved catalogue entry; unbranded/local goods stand alone; services, events and stays are never grouped. |
| 9 | "Completed" | **Amended 2026-10-15:** for products, completion is a person's verification, not a timer (row 17, §4). Services, events and stays are to be specified. |
| 10 | Security | OTP (SMS or email) **mandatory for everyone**; authenticator-app 2FA **optional**. Risk-based timing (§9). |
| 11 | Category rates | One editable tier table per category (products, services, events), services and events seeded from product tiers. Stays/bookings count as services. |
| 12 | Subscriptions | Hidden and frozen behind a switch; existing paid businesses keep access until term end; plan-based limits lifted for all; no refunds. |
| 13 | Payout destinations | Name-matched to verified name, OTP-confirmed, editable cooling period for new/changed destinations, editable limits. |
| 14 | Provider charges | Customers pay the **collection charge** (shown as "payment processing"); vendors and riders bear their own **withdrawal charges**. Pass-through at cost; none for wallet payments; collection charge not refunded except on platform/vendor error. |
| 15 | Low stock | Per-offer threshold with sales-based default (<7 days cover), fallback 5 units; alert once on crossing; sold-out alert at zero; zero-stock offers hidden. |
| 17 | Release of vendor money (products) | **Owner decision 2026-10-15.** Vendor money is not held for long. Once the product reaches the customer and both the rider and the customer have confirmed, a **Support staff member calls the customer** to check it matches what was bought. A positive result releases the money at once. Otherwise a dispute is raised and settled within **72 hours of purchase**. |
| 18 | Store pickup | **Owner decision 2026-10-15.** Collected at the AshantiHub office within **24 hours** of purchase. Confirmed by AshantiHub staff in a **new Pickup Desk role**. |
| 19 | Opening hours: follow-up rulings | **Owner decisions 2026-10-19**, following the opening-hours ruling of 2026-10-18. (1) A **scout-onboarded business must enter opening hours at registration** (the same `hours_required` 400). Live shops that already have no hours are **not blocked**: they show "Hours not set" and dispatch uses the platform window. A hourless unclaimed scout business **cannot be claimed** until staff add hours. (2) A delivery/dispatch manager (`delivery.manage`) can **send a rider early** to a held order, giving a reason of 3+ characters: `POST /api/delivery/orders/<id>/send-early/` sets `ready_not_before` to now, logs `delivery.early_send` with who, when and why, and tells the customer "Your order is being sent now". A second call, or an order that is not held, answers 409 `not_held`; a cancelled or refunded order is refused with 409 `not_sendable`. (3) Managers get a **Scheduled** list of held paid orders, `GET /api/delivery/scheduled/` (paginated, soonest first, matching `scheduled_count`), with a **Send now** button. **Further answers 2026-10-19.** (a) A **staff screen replaces the `set_business_hours` command** as the way to enter hours for hourless scout businesses: `PUT /api/portfolio/businesses/<id>/hours/`, permission `businesses.manage_portfolio` or `portfolio.manage` (account manager, Operations, Super Admin; Support cannot), same validation as owners, logged as `business.hours_set` with old and new values. Staff lists get a "Hours not set" badge and filter. The command stays as a fallback. (b) The Scheduled list is readable by `delivery.manage` or `orders.manage_delivery` holders, who also get a Scheduled nav item; **Send now** (send-early) stays on `delivery.manage` and is hidden from read-only users. (c) The owner will deal with live hourless claims himself. |
| 16 | Governance | Super admin or accounts propose, the other approves; logged; applies only to later orders; super admin emergency edit, logged. |

## 2. Ledger core

**Principle.** Balances are never edited. Every movement is an immutable **journal entry** of
balanced debit/credit lines with a unique idempotency key and a link to its order or payment.
Balances derive from entries. Amounts are **integer pesewas** (no floats). Posting is atomic and
locks the accounts involved. A nightly reconciliation compares the ledger to the provider
statement and flags differences.

### 2.1 Accounts

| Account | Visible to | Meaning |
|---|---|---|
| Customer wallet | Customer | Top-ups and refunds; spendable or withdrawable |
| Order escrow | Internal | Customer payment held until the order is finalized |
| Vendor Pending | Vendor | Sale amount awaiting completion; not withdrawable |
| Vendor Available | Vendor | Released money; withdrawable; may go negative after a late refund |
| Delivery payable | Internal | The order's delivery fee until paid out |
| Rider balance | Third-party rider | Withdrawable share (90%); may go negative after a refund takes a delivery back |
| Rider commission reserve | Internal/rider (read-only) | 10% reserve, not withdrawable |
| Platform fee / delivery / commission income | AshantiHub | Platform earnings |
| Provider clearing, provider fees | Internal | The Hubtel side of every cash movement |
| Withdrawal in transit | Internal | Instructed payouts not yet confirmed |

### 2.2 Order flow

1. **Pay** (MoMo or wallet). Full amount into the order's escrow. The same entry allocates it:
   each vendor's item subtotal to that vendor's Pending; the delivery fee to Delivery payable.
2. **Release** (§4.1): when Support's verification call is positive, **one atomic release entry**,
   posted in the owner's order: (a) platform fee per vendor (cap applied) and, for a company rider, the
   delivery fee, to platform income; (b) vendor Available = subtotal − fee; (c) third-party rider:
   90% to Rider balance, 10% to the reserve.
3. **Refund before release.** Escrow-backed amounts return to the customer wallet.
4. **Refund after release.** Debit vendor Available (may go negative), return the platform fee in
   proportion, credit the customer wallet.
5. **Withdrawal.** Amount moves to in-transit, is instructed via the provider, completes on
   confirmation, and reverses automatically on failure. The user bears the withdrawal charge.
6. **End of day (third-party riders).** Reserve posted to commission income; day's gross,
   commission and net recorded. (A refund never reverses a rider's delivery pay: once any pickup is done the delivery fee belongs to the rider, plan 7F-D; the `reversed_at` columns are unused.)

Company riders have no wallet; their pay stays with payroll.

### 2.3 Provider interface

`collect`, `payout`, `status`, `handle_webhook`. Two implementations: **simulated** (default) and
**Hubtel** (gated, §11). Webhooks are signature-verified, idempotent on the provider reference,
amount-verified against the amount requested, logged raw before processing, and monotonic in
status. The frontend's redirect state is never a source of truth.

## 3. Fee engine

### 3.1 Rule tables

Database rows, one rule set per category (products, services, events), each a list of bands
(lower bound, upper bound, percentage or flat amount). Rounding: nearest pesewa, half up.

Seeded for **products**:

| Vendor's item subtotal after discounts | Fee |
|---|---|
| GHS 0.00 – 99.99 | 1% |
| 100.00 – 499.99 | GHS 5.00 flat |
| 500.00 – 49,999.99 | 1% |
| 50,000.00 and above | GHS 500.00 flat |

Services and events are seeded as copies, to be changed before launch. There is one
intentional jump at GHS 100.00: the fee on 99.99 is GHS 1.00 (1%, rounded) and on 100.00 is
GHS 5.00. The 500.00 boundary is continuous (1% of 500.00 = GHS 5.00).

### 3.2 Computation

1. Split the cart by vendor; the fee base is the vendor's discounted item subtotal per line
   category (a vendor with a product and a service line is priced per category table).
2. Look up the band for the base.
3. Apply the lifetime cap last: charge = min(computed, cap − fees already charged to that vendor).
   Blank cap = no cap.
4. **Snapshot** onto the order line at payment: rule version, base, computed fee, cap remaining.
   Release reads the snapshot, so later edits never alter a paid order.

Platform fees are **never shown to the customer**. The customer sees items, delivery and, for
MoMo/top-up, a "payment processing" line.

### 3.3 Governed settings

Fee tables, the cap, the rider commission rate, the verification-overdue and pickup windows, withdrawal
limits and the cooling period share one flow: super admin or accounts propose, the other
approves; each change logs who/when/old/new and takes effect only for orders paid after its
effective time. Super admin may edit directly in an emergency (logged). Added 2026-10-18 (plan 7A Task 1): `wallet_topup_hold_minutes` (60, minimum 60; minutes before top-up money is withdrawable),
`otp_daily_failure_cap` (20; wrong sign-in or step-up codes per account per day), `vendor_low_balance_pesewas` (10,000; Available at or below this triggers the low-balance text),
`digest_batch_size` (200; businesses per digest batch) and `digest_time_budget_seconds` (600; longest one digest batch may run), the three low-stock numbers
`low_stock_cover_days` (7), `low_stock_fallback_units` (5) and `stock_cover_window_days` (28), and also: `service_auto_accept_hours` (48),
`stay_issue_window_hours` (24) and `event_release_delay_hours` (48) for the booking milestones (§4.2); the verification-overdue
window now covers products only. Added 2026-10-19 (plan 7F-D Task 3): `rider_withdrawals_per_day` (3; 1 to 20; riders' withdrawals per Accra day, on top of the amount limits). Added 2026-10-19 (plan 7F-E Task 7): `redelivery_fee_pesewas` (1500, a placeholder GH₵ 15.00 to be confirmed by the owner; 0 to 20000; the fee the customer pays for a re-delivery, gate (cxxx)).

### 3.4 Subscriptions

A single switch hides all plan purchase/renewal UI and API paths. Existing paid businesses keep
access to term end and are not billed again; plan-based limits are lifted for everyone. Code and
data are retained so the feature can return.

## 4. Completion and release

### 4.1 Products: release follows a verification call (amended 2026-10-15)

No timer releases a vendor's money. For a product order:

1. **Handed over.** A rider marks the delivery done, or (store pickup) the Pickup Desk marks it collected.
2. **Receipt confirmed.** The customer confirms it themselves, or Support records the customer's confirmation during the call (so a customer who never taps "confirm" cannot strand the vendor).
3. **Support verification call.** A Support staff member calls the customer to check the product matches the description. They record one of:
   - **Matches** → the money is released at once, in the order of §2.2 step 2.
   - **Does not match** → a dispute is raised, due within **72 hours of purchase**. Nothing is released. When it ends (resolved or rejected), Support records the positive result to release, or the customer is refunded (Stage 3).
   - **Could not reach** → recorded; the order stays on Support's list and is flagged overdue 72 hours after purchase. Nothing releases on its own.
4. An **open dispute** blocks release.

### 4.2 Services, events and stays (owner decision 2026-10-15; amended 2026-10-18)

**Amended 2026-10-18.** The owner adopted the marketplace "milestone" model: money for these three kinds is released by a
timer on the kind's own milestone, with no Support call needed (Support's verification call stays available as an early
release). Products are unchanged (§4.1: Support's call, 72 hours from purchase).

| Kind | Money releases | Setting (default) |
|---|---|---|
| Service | when the customer accepts in the app, or automatically this long after the business marks it done | `service_auto_accept_hours` (48) |
| Stay | this long after the scheduled check-in time (14:00 Accra), whether or not the guest arrived | `stay_issue_window_hours` (24) |
| Event tickets | this long after the end of the event's day (an event carries no end time); a door scan only tells the customer and records evidence, the organiser is liable for its scans | `event_release_delay_hours` (48) |

2026-10-19 owner ruling, event cancellation: an event can be cancelled by its organiser (`POST events/mine/<id>/cancel/`,
reason of 5-300 characters, refused once the event date has passed) or by Operations (`events/moderation/<id>/cancel/`,
sudo). Every ticket is refunded in full, price plus the processing charge. The ticket price comes out of the
organiser's Pending or Available (Available may go negative after release); AshantiHub bears only the processing
charge (Dr provider fees). A cancelled event takes no new sales, renewals or edits, buyers and the organiser are told,
and an hourly job (beat, minute 50) finishes any refund left over. Built in 7F-C Tasks 1-2. 2026-10-19 owner ruling, door scans: a scan
never releases money, with the ledger on or off; a ticket with no `BookingSale` (a legacy ticket) stays held until
Accounting releases it by hand, and the scan only records evidence and tells the customer. Built in 7F-C Task 3.

An open dispute stops the timer until it closes. A customer can report a problem before release (it opens a dispute and
tells Support). Before the milestone a cancel follows the vendor's cancellation policy, snapshotted on the sale at payment:
flexible (full refund until 24 h before the start), moderate (full until 5 days, 50% until 24 h), strict (50% until 7
days, none after). A service has no start time, so the customer cancels it in full until the business marks it done;
tickets default to no refunds after purchase except a cancelled event, with an optional refund window per event. Sales
paid before the policies existed keep Support-only cancellation. After the milestone it is a dispute, not a cancel.
`verification_overdue_hours` (72) now applies to products only.

Built in Plan 7E (docs/superpowers/plans/2026-10-18-wallet-rulings-7e-milestone-release-and-cancellation-policies.md).
Customer screens: Plan 7G (docs/superpowers/plans/2026-10-20-wallet-rulings-7g-customer-booking-buttons.md).

### 4.3 Store pickup and the Pickup Desk

A store-pickup order is collected at the AshantiHub office within 24 hours of purchase (editable). A new staff role, **Pickup Desk**, sees the queue (without customers' phone numbers) and marks an order collected. Collection stands in for the rider and the customer's confirmation; Support's call still follows. An order not collected inside the window is flagged overdue; refunding it to the customer's wallet is Stage 3. Only a Super Admin invites this role.

## 5. Customer wallet and payments

- **Top-up** from an attached MoMo number (provider collection); customer bears the collection charge.
- **Pay** directly by MoMo or from the wallet (no charge from wallet).
- **Refunds** credit the wallet; the collection charge is not refunded except on platform/vendor error.
- **Withdrawal** to a verified MoMo number or bank account (§8), user bears the withdrawal charge.

## 6. Vendor wallets

- Two views, **Pending** and **Available**, as in §2.
- **Withdrawal** to verified destinations; negative Available blocks withdrawal until recovered.
- **SMS** on every paid order, per vendor: reference, item subtotal, platform fee, amount due;
  second SMS on release. Optional daily digest; in-app copy always kept; SMS failure never blocks
  payment (queued, retried).
- **Transactions page:** ledger-backed statement (date, order, gross, platform fee shown
  separately, amount, status Pending/Available/Withdrawn/Refunded), filters, cap used and
  remaining, export.

## 7. Third-party dispatch

Per-delivery earnings shown to the rider; reserve and daily commission per §2.2 and §3.3. The delivery fee belongs to the rider once any pickup is done (gate (xciii)); riders are capped at `rider_withdrawals_per_day` withdrawals a day (gate (xcviii)). Round 3 (2026-10-19): a delivery re-assigned before completion pays the first rider nothing and is done by AshantiHub's own riders only (gate (cxxviii)); a re-delivery the customer pays for is gate (cxxix); a refund never returns a coupon-reduced fee beyond what the customer actually paid (gate (cxxv)). Company
riders: wallet disabled by role.

## 8. Payout destinations

A destination is verified when the account name from the network/bank matches the user's
verified name (customer profile or vendor KYC) and the owner confirms by OTP. New or changed
destinations cannot receive money for an editable cooling period (default 24 h). Vendors may only
withdraw to a destination matching their registered business or owner name. Daily and
per-transaction limits are editable.

## 9. OTP and 2FA

- **One OTP service** (SMS or email at user's choice): 6 digits, stored hashed, 5-minute expiry,
  limited attempts, resend cooldown, rate limits per user, phone and IP. No account-existence leaks.
- **Mandatory OTP:** at sign-up (verify contact); before sensitive actions (withdrawal, payout
  destination, phone/email/password change) via single-purpose, short-lived **step-up tokens**
  bound to the action; at **every sign-in for staff and vendors**; for customers on a **new
  device or after a gap** (editable, default 30 days).
- **Authenticator-app 2FA:** optional for anyone, with recovery codes; when enabled it replaces
  the sign-in OTP. 2026-10-19 owner ruling: the authenticator app is offered (setup, confirm, and sign-in asking for
  it) whatever `OTP_SIGNIN_ENFORCED` says; with the switches off a step-up code for `authenticator_change` can be
  texted or emailed so a customer or owner can set it up. Built in 7F-C Task 5.
- Trusted-device records, lockouts, an audit log of OTP events, an SMS-spend alert, and recovery
  via the other channel or an approved staff-assisted request.

## 10. Stock offers and alerts

- Every vendor listing is an **offer** (own price, quantity). Branded/barcoded products may attach
  to a staff-approved **catalogue entry**; unbranded goods stand alone; services/events/stays are
  never grouped.
- Featured offer = lowest price among in-stock, verified vendors; ties go to the nearest vendor.
  "Other sellers" and a shortfall prompt let the customer add more; nothing is added without them.
- Each offer is its own cart line (own fee, pickup, ledger entries); one order-level delivery fee.
- **Stock reservation** at checkout start for a short window, released if payment does not
  complete; decremented on confirmed payment; restored on pre-release refund/cancel. Zero stock
  hides the offer.
- **Low-stock alerts:** per §1 row 15; dashboard "needs restocking" list; SMS/email by preference.

## 11. Rollout order

1. Ledger, fee engine, governed settings, simulated provider, subscription freeze.
2. OTP and security (**must precede any wallet going live**).
3. Customer wallet, payments, refunds, withdrawals.
4. Vendor dashboard and SMS.
5. Third-party rider wallet and daily commission.
6. Catalogue and offers, stock reservation, alerts.
7. **Hubtel live switch**, gated on credentials and regulatory clearance. Nothing before this
   moves real money.

## 12. Risks and open items

- **Regulatory:** customer balances, withdrawals and escrow likely fall under payment-service or
  e-money rules in Ghana. Real money stays off until the route with Hubtel/the regulator is settled.
- **Not yet reconciled with the codebase.** The plan's first task: survey existing payments,
  billing/subscription, commission, cart, delivery and accounts/2FA code, and adapt this design to
  it, recording any deviation here.
- **Provider economics:** the platform fee (1% on small sales) may not cover provider charges
  absorbed by AshantiHub on payouts it initiates; review once real rates are known.
- **Numbers owed by the owner:** services and events tier values, the verification-overdue (72 h)
  and pickup (24 h) windows, cooling period, withdrawal limits, SMS digest thresholds.
- **Mixed-category vendor cart and cap:** the cap is cumulative across categories (§1 row 2).

## 13. Reconciliation with the code (2026-10-15)

Found while writing the Stage 1 plan (`docs/superpowers/plans/2026-10-15-ledger-fees-foundation.md`, §0):

- **D1 Fee base.** Coupon discounts are AshantiHub-funded and leave `OrderItem.line_total` untouched; flash-sale prices are seller-funded and already in `line_total`. The fee base is Σ `line_total` per vendor and category. The coupon is a platform subsidy, never charged to the vendor.
- **D2 No order-escrow account.** The payment journal allocates directly into Vendor Pending and Delivery payable (equivalent, one fewer pass-through).
- **D3 Governance.** Accounting proposes and Super Admin approves (existing maker-checker); Super Admin may apply directly (logged). Accounting does not approve.
- **D5 Subscriptions.** Listing creation and the registration `plan_selection` step currently depend on a subscription. The freeze switch (`SUBSCRIPTIONS_ENABLED`) must stay on until the frontend registration change ships.
- **D6 Release.** Owner decision (2026-10-15): no timed hold-back. Release follows Support's verification call (§4).
- **D7 Scope.** Stage 1 covers product orders only; services, events and stays follow in Plan 1b.
- **D8 Store pickup.** Collected at the AshantiHub office within 24 hours, confirmed by a new Pickup Desk role (§4.3).

### Before SUBSCRIPTIONS_ENABLED is turned off (Plan 1F)

Follow-ups found in review; none is reachable while the switch stays on.

- (a) `billing.clock.subscription_state` still derives "overdue" from `current_period_end` when the clock is stopped. That makes `marketing/featured.py` add a `subscription_overdue` blocker (so `book()` refuses and `public_listings()` drops paid promotions) and shows owners a renew banner they cannot use.
- (b) `_hero_days_for` (`listings/views.py`) returns 0 for an owner with no subscription, so approved hero media expires at once.
- (c) `listings/moderation_checks.py` shows FAIL "No subscription." on hero and promotion review.
- (d) Businesses already paused stay hidden (`listings/visibility.py`) with no way to renew.
- (e) Drafts can be created before `business_kind` is set.
- (f) The registration UI must use `POST /api/billing/business-kind/` instead of plan selection.

### Before LEDGER_ENABLED is turned on

Follow-ups found in the final review; none is reachable while the flag stays off.

- (i) **Hubtel webhook failure mode.** If `record_order_payment` raises inside `payments.views.HubtelWebhookView`, the customer has paid but the order stays PENDING, the `WebhookEvent` row stays `processed=False` with no note, and Hubtel retries forever. Wire Sentry/alerting and write a `processing_note` before turning the ledger on with `PAYMENTS_PROVIDER=hubtel`.
- (ii) **Queues.** `awaiting()` and `pickup_queue()` are unpaginated, `awaiting()` does per-order queries, and `pickup_queue()` is not gated by the ledger flag, so every historical paid store-pickup order (no FulfilmentCheck) would show as overdue to the desk. Add pagination and a go-live cut-off before Plan 1F ships the desk screen.
- (iii) **Concurrency test.** Add a threaded `TransactionTestCase` covering the payment/release lock graph and the lifetime-cap race.
  When `ledger/sales.py` lands the test also needs a cross-category case: an order payment and a booking payment for the same business racing the shared lifetime cap.
- (iv) **Legacy vendor-shop store pickups** can never be marked collected once the ledger is on (the desk handles AshantiHub-office pickups), so their money would stay in Pending. A rollout/process decision for the owner.
- (v) **Mismatch dispute.** The dispute created by `verification.record` sets `raised_by=customer` although it is staff-logged (the convention in `disputes/models.py` is `raised_by` null plus `logged_by`), and it neither notifies the customer nor tasks the account managers. Decide before Support uses it at volume.
- (vi) **Round 3 (2026-10-19, plan 7F-E).** The Task 2 race tests (`ledger.tests.test_lock_order` and `PickupRaceTests`) pass 20 times in a row, run alone and serially.
- (vii) **A coupon whole-refund journal balances (R1, gate (cxxv)):** pay the order with a coupon, pick up, refund whole, and check the journal and the customer, rider and subsidy balances.
- (viii) **A re-delivery fee journal balances and reconciles (gate (cxxix)):** pay a re-delivery by wallet and by mobile money, complete it, and check the journals and that `wallets/reconciliation.LEDGER_KINDS` (which lists `CheckoutSession.REDELIVERY_FEE`) matches the provider lines.

### Stage 3 carry-forward

- **Done in Stage 3a (W4, W6).** Cancelled paid orders kept their `OrderFeeSnapshot` counted against the lifetime cap
  and their money in Vendor Pending / Delivery payable: Support's cancel and the uncollected-pickup job now refund the
  order whole to the wallet and reverse its snapshots.
- **Done in Stage 3a (W4).** Release paid every unreleased snapshot, so a refund resolution followed by "matches" would
  have paid the vendor in full: refunds now raise each snapshot's refunded base and fee (reversed when whole), release
  pays only what is left, a skipped stop's case refunds that shop's lines only, and release waits while a delivery-case
  refund is pending the Super Admin's approval.
- The money-releasing POST has no password re-check (`RequiresSudo`). **DECIDED 2026-10-18:** the system releases automatically; a manual release needs a password re-check (plan 7C Task 1). Original text, superseded: Owner question: should it? (Still open.)
- **Done in Stage 3a (W5).** The waived delivery fee never reached the ledger: the business's promo cost is now taken
  from its Available at release and given back on a whole refund.

### Stage 2 (OTP) reconciliation (2026-10-16)

Found while writing the Stage 2 plan (`docs/superpowers/plans/2026-10-16-otp-security.md`, §0):

- **O1 Where it lives.** A new `otp` app; rows name `(account_type, account_id)` because the three account kinds are separate tables. Staff keep their authenticator in `accounts.two_factor`; customers and business owners get `otp.AccountAuthenticator`.
- **O2 Sign-up.** The account row is created first; registration answers a code challenge instead of a token, and the token comes after the code. Customers and vendors who never confirmed a contact confirm once at their next sign-in. For staff the emailed invite link is the check.
- **O3 Policy numbers** (customer gap 30 days, SMS alert 500/day) live on `staffsecurity.SecurityPolicy`, changed by a Super Admin with the password re-entered, not through the money-settings maker-checker.
- **O4 Step-up.** Customers and vendors confirm with a texted or emailed code (an authenticator code is not accepted for step-up); staff keep password re-entry (`RequiresSudo`), except third-party riders, who confirm withdrawals and payout destinations with a texted or emailed code like customers (Plan 5). Applied now to payout details, adding a recovery email/phone, and authenticator changes. There is no change-password or change-primary-contact endpoint yet; `password_change` and `withdrawal` are defined for when they exist (Stage 3).
- **O5 SMS.** While `OTP_SMS_PROVIDER=simulated` an SMS code send answers `channel_unavailable` (no text is claimed sent). The Hubtel SMS client in `marketing/providers/hubtel_sms.py` (unverified against a live account) is reused through `OTP_SMS_PROVIDER=hubtel`; the default `simulated` sends nothing.
- **O6 Not yet moved.** The customer secondary-contact codes (`accounts.serializers.CustomerSecondary*`) still keep their code in clear and return `demo_code` for SMS; moving them onto the OTP service changes their API and is a follow-up. Until then a secondary phone is never a code channel (`otp.identity.contacts()` ignores it, however `secondary_phone_verified` reads); a verified secondary email still is (its code is emailed).
- **O7 Audit.** OTP events go to `otp.OtpEvent`, not the hash-chained activity log (high volume, customer-side, and the lock and the hourly limits are counted from it). Staff wrong codes also reach the sign-in history; policy changes and staff-assisted recovery also reach the activity log.

### Before the OTP switches are turned on (Plan 2F)

`OTP_SIGNIN_ENFORCED`, `OTP_STEP_UP_ENFORCED` and `OTP_SIGNUP_VERIFICATION_ENFORCED` all default off and must stay off until every item below is done.

- **DONE 2026-10-20, Frontend screens (Plan 2F, built; switches still off):** the sign-in/sign-up code screen (`components/OtpSignIn.jsx`, shown by `AuthModal` and `BusinessRegistrationFlow`; a customer or vendor `two_factor_required` goes to `/api/otp/sign-in/verify/`, a staff one stays on the staff endpoint; handles an authenticator owed after a sign-up code, `no_channel` and `channel_unavailable`); the trusted-device checkbox and the customers-only `ashantihub.deviceToken` (`hooks/useAuth.js`, `lib/otp.js`); the step-up retry in `apiClient.js` with `StepUpPrompt` mounted once in `main.jsx` (one retry carrying `X-Step-Up-Token`); the security cards in `components/security/` (customer `SettingsTab`, business `ProfilePanel`); Super Admin's two OTP numbers, Support's recovery request form and the text-spend label in the staff panels. The backend always answers `available: true` for the authenticator (7F-C), so the UI's `available: false` branch is defensive only. **Texts while simulated (final review R12):** while `OTP_SMS_PROVIDER=simulated`, an SMS code send (sign-in or step-up) answers `400 channel_unavailable` ("Texts aren't being sent yet. Choose email instead.") and sends and logs no text, so no screen claims one was sent; the step-up / authenticator set-up for a phone-only account therefore waits for Hubtel SMS. **Still owed before any switch:** the staging walkthrough with all three switches on against a real backend (customer sign-in on a new device -> chooser -> code -> trusted device ticked -> second sign-in skips the code; owner every time; staff without an authenticator gets the code screen; sign-up confirm screen; authenticator set-up and sign-in with an app code and a recovery code; change payout details and see the prompt and the retry; add a recovery email/phone with the ledger on (step-up prompt appears, retry succeeds); Remove all devices; Support request -> Super Admin approval; 360px width with no horizontal scroll on the code screen and prompt; `TwoFactorSetup`'s palette on customer and business surfaces; Android/iOS real-device PWA checks as for the staff PWA). The walkthrough reads codes from emailed codes (the console mail backend) or from real Hubtel texts; texted codes are refused while `simulated`. Known limits, not 2F's to fix: the text-spend notice wording in `backend/otp/spend.py` points at a code log and text balance that have no screen; the trusted-device checkbox cannot show the day count before sign-in; the device list has no "this device" marker until the backend returns one; a staff-visible OTP code log and masked OtpEvent view is still a gate; a foreign-phone-only account gets `no_channel` with no operational path.
- **A real SMS provider:** Hubtel SMS credentials and an Approved Sender ID, then `OTP_SMS_PROVIDER=hubtel` (the default `simulated` sends nothing).
- **Hubtel SMS client unverified:** `marketing/providers/hubtel_sms.py` has never sent through a live account; prove one real OTP text first.
- **Existing accounts with only a foreign phone (or no usable contact):** they get `409 no_channel` and cannot sign in; Support must add an email first (the operational path is not built).
- **Last contact removed by a staff edit is not re-checked:** a profile or staff edit can leave an account with no usable contact; re-validate before enforcing.
- **DECIDED 2026-10-18, long-horizon guessing:** a daily wrong-code cap is set before enabling, governed as `otp_daily_failure_cap` (default 20, range 5-200; setting in plan 7A Task 1, enforcement in plan 7C Task 6). Original text: the 15-minute lock still lets someone holding the password try ~20 wrong codes an hour indefinitely; decide a daily cap before enabling.
- **DECIDED 2026-10-18:** yes, an opted-in authenticator is honoured even when `OTP_SIGNIN_ENFORCED` is off (plan 7C Task 6). Original text: should an opted-in authenticator be honoured even when `OTP_SIGNIN_ENFORCED` is off?
- **Devices trusted before authenticator setup keep skipping it** (up to the customer gap); offer "sign out other devices" (revoke trusted devices) when an authenticator is turned on.
- **Per-IP hourly limit 60 is a guess** (carrier NAT); tune it with real traffic data.
- **Phones are not normalised at registration**, so several accounts can name one number and share its 20-codes-an-hour ceiling; normalise registration phones (and lower-case emails).
- **`OtpEvent` keeps full phone numbers, emails and IPs for 400 days:** any staff view of it must mask them (`otp.identity.hint`).
- **Password-reset tokens are stored raw:** hash `PasswordResetToken.token` for both uses (password reset and `otp.recovery`), as claim, step-up and device tokens already are.
- **Lock and recovery-code notices bypass the send limits (must fix before ANY switch):** `otp/notices.py` `_send` texts/emails every contact on the account with no hourly or per-destination limit and no per-IP count, and the lock fires for any purpose including SIGN_UP. An attacker can register accounts naming a victim's phone (typed in different spellings, because registration does not normalise phones) plus the attacker's own email, lock each with 5 wrong codes, and make AshantiHub text the victim once an hour per account at AshantiHub's SMS cost. Fix: check the 20/hour per-destination ceiling in `_send` (record a refused send), and send lock notices only to destinations that are in `VerifiedContact`.
- **Normalise phones at registration and enforce uniqueness on the normalised value:** the 20/hour global per-destination ceiling can still be used up by several accounts naming one number, and the shared `try_later` leaks, by counting sends before refusal, roughly how many codes the number got in the last hour.
- **The customer secondary-email confirmation view is unthrottled, unlimited and compares its code in clear** (`CustomerSecondaryEmailConfirmView`, `accounts/views.py`): because a verified secondary email is a sign-in channel, add a throttle scope, an attempt limit and a constant-time compare (or move it onto the OTP service, spec O6) before any switch is on.
- **Staff authenticator failure path has the same check-then-act race as the customer path** (`accounts.two_factor` / `StaffLoginTwoFactorView`): it is live today because staff two-factor does not depend on the OTP switches. Apply the same per-account advisory-lock pattern.
- **Minor races accepted for now:** two failing resends that both hang past 60 s can leave the challenge with a never-delivered code (an immediate resend recovers it); `verify` can compare against a stale read for the few milliseconds a resend rotates (only the previously delivered code is accepted); the typed code is held in the local `raw_code` of `verify`/`_check` (add to `EXTRA_DENYLIST`); `guessing()` has no `lock_timeout`.


### Stage 3 (wallets and payments) reconciliation (2026-10-16)

Found while writing the Stage 3 plans (`docs/superpowers/plans/2026-10-16-wallets-payments-3a.md` and
`docs/superpowers/plans/2026-10-16-withdrawals-3b.md`, §0 of each):

- **W1 Provider interface.** `collect` stays `payments.services.process_payment` and `handle_webhook` stays
  `payments.views.HubtelWebhookView` (both already branch simulated/Hubtel and log, verify, de-duplicate and
  amount-check). `payments/providers.py` adds the charges, the account-name lookup, `payout` and `status` (and, in 3b,
  the statement the reconciliation reads). `payments/hubtel_client.py` has no payout, status or name-lookup call, so
  the Hubtel provider raises `NotConnected` for them until Plan 7.
- **W2 Collection charge.** Paid on top by the customer for MoMo payments and top-ups ("payment processing"), kept on
  `CheckoutSession.processing_fee`; the ledger records only the net. Simulated charges are 0 unless set (no real rate is
  known). When AshantiHub gives it back (its own or a vendor's error) it bears it: Dr provider fees. A partial refund
  gives back only its share of the charge (half up); the refund that empties the order gives back what is left of it.
- **W3 Paying from the wallet.** `payment_method` (`momo` default, `wallet`) on checkout; the payment journal debits
  the customer's wallet instead of provider clearing; a wallet must cover the whole order.
- **W4 Refunds.** Always to the wallet, per fee snapshot (`refunded_base_pesewas`, `refunded_fee_pesewas`, and
  `reversed_at` when whole), recorded as `ledger.OrderRefund` (one per order and source). Release pays only what is
  left and never a cancelled order. The delivery fee comes back only with the whole order, and a coupon goes back to
  AshantiHub only on the refund that empties the order.
- **W5 Waived delivery fee.** The business's free-delivery promo cost (`marketing.WaivedFeeCharge`) is taken from its
  Available at release and given back on a whole refund.
- **W6 Wiring.** Support's cancel of a paid order, an uncollected pickup after the window (hourly job), a dispute
  resolved with a refund amount, and an approved delivery-case refund all refund through `ledger.refunds`. A dispute
  and its delivery-case approval share one source key, so it is never refunded twice.
- **W7 Lock order.** Order row, then fee snapshots, then ledger accounts in primary-key order, taken up front
  (`ledger.posting.lock`). A transaction that posts twice (release then the promo charge; a whole refund then the promo
  return) locks the accounts of both postings in its one up-front pass.
- **W8 Decided in the 3a plan, for the owner to confirm (its A1-A11).** A top-up goes through the provider's hosted
  checkout (no stored "attached" MoMo number yet, §5); a wallet payment must cover the whole order (no split wallet +
  MoMo); an uncollected pickup is refunded automatically by an hourly job; the processing charge is refunded only when
  staff record AshantiHub, rider or business fault, and a partial refund gives back only its share of it; with the
  ledger on, order and top-up sessions carry `metadata["ledger"]` (a `provider="wallet"` session moved no provider
  money, so reconciliation must skip it).

### Before LEDGER_ENABLED is turned on — Stage 3 additions

- (vi) **Simulated rails let anyone top up for free.** Never turn the ledger on in production before Plan 7 (Hubtel
  live) and the regulatory route (§12); on staging it is safe.
- (vii) **Top-ups share the Hubtel webhook failure mode (i).** A finalizer that raises leaves a paid top-up
  uncredited with `processed=False`; the 3b reconciliation reports it as `missing_in_ledger`, but alerting is still owed.
- (viii) **The hourly uncollected-pickup job refunds every ledger-recorded store-pickup order the Pickup Desk has not
  marked collected within `pickup_window_hours`.** Item (iv) therefore stops being "money stays in Pending": a customer
  who collected at a vendor's own shop is refunded in full and the vendor is never paid. Before the ledger is turned on,
  every store pickup must be collected at the AshantiHub office desk (checkout and vendor screens must say so), or the
  job must stay off.
- (ix) **The transaction report double-counts wallet money.** `billing.TransactionReportView` sums every
  `billing.Transaction`: a top-up and the order paid from it are both SUCCESS rows, and wallet refunds create no
  REFUNDED row. Exclude `checkout_sessions__provider="wallet"` from its cash totals and count wallet refunds
  (ledger `OrderRefund`) before the ledger is turned on. The same gap hits the refund totals:
  `insights/sales.refunds_total` counts only `Dispute.refund_amount` and event tickets, so wallet refunds from Support's
  cancel and the pickup job (`OrderRefund`, sources `cancel` and `pickup_expired`) never appear in them (a dispute's own
  `OrderRefund` must not be counted twice). And `insights/accounting.py` ~80 ("Where the money goes ... not held in
  escrow") is wrong once the ledger is on: product-order money then sits in Vendor Pending and Delivery payable.
- (x) **The switch is one-way.** With it off, refunds are skipped silently: a paid order cancelled while it is off keeps
  its money in Vendor Pending with no later refund path. Never turn it off once on.
- (xi) **A Hubtel success webhook for an order Support already cancelled revives it to PAID** (`_finalize_order_checkout`
  only checks for PAID) and now posts its payment to the ledger; refuse finalisation of a cancelled order first.
- (xii) **Delivery-case approval text is wrong for pre-ledger orders.** Its "consequences" text says the money "returns
  to the customer's AshantiHub wallet at once" even for an order paid before the ledger was on (nothing moves then):
  branch on the order-pay journal (`delivery/config.py` ~348-352).
- (xiii) **Stale "no money moves" copy with the ledger on:** `delivery/views_cases.py` ~145 and `orders/support.py`
  `payments_note()` ~76-81.
- (xv) **A Hubtel FAILURE webhook after Support cancelled a PENDING order restocks a second time**
  (`_fail_order_checkout`, `payments/services.py` ~73-77). Fix beside (xi), which is the success-webhook twin.
  The same function also takes its locks in a different order from Support's cancel: `_fail_order_checkout` locks the
  listings unsorted, then the promo charge row, then the order last, while the cancel locks the order, the listings (in
  primary-key order), then the promo charge row. A failure webhook and a cancel on the same PENDING order can therefore
  deadlock (Postgres aborts one). Lock the order first, then listings sorted by primary key, then the charge row, as the
  cancel does, when (xi) is fixed.
- (xvi) **DECIDED 2026-10-18:** accepted as proposed: the Accountant's refund door stays as it is (no build). Original text: **Owner question: the Accountant's dispute-resolve door can refund an undecided delivery case** when the ledger
  is on, so money moves without the Delivery Manager's decision or the Super Admin's approval. Also, dispute and
  delivery wallet refunds send the customer no notice.
- (xvii) **Checkout locks listings in cart order, not primary-key order** (`orders/views.py` ~160), so a checkout can
  deadlock against the cancel or pickup-expiry job (Postgres aborts one; no corruption). Sort the listings in checkout.
- (xviii) **`refunds.check` duplicates `refund_order`'s rules**, and two pending delivery cases on one order both pass
  the decision-time check; the second approval then fails and needs a manual reject.
  Support's cancel and the pickup job do not check `escrow.has_pending_refund` either: a delivery-case approval still
  pending on an order they then refund whole can never be approved (`RefundError` leaves it pending) and needs a manual
  reject. Have both refuse, or reject the pending request, before refunding.
- (xix) **Release edge cases.** A delivered free-delivery order with every item refunded and a zero delivery fee never
  releases: its `WaivedFeeCharge` stays OWED. `refund_order`'s nothing-left guard reverses and returns the promo even if
  delivery was made (rare: cancel is blocked after delivery).
- (xx) **Stage 3a minor parked items.** `posting.post()`'s `MAY_GO_NEGATIVE` exempts `VENDOR_AVAILABLE` in every posting
  (3b withdrawals must keep their own check under lock). No database check constraints on the refund fields. The
  processing-charge share is per-refund half-up, not cumulative. No top-up throttle. The Hubtel checkout call happens
  inside the DB transaction (Plan 7). The top-up finalizer relies on the webhook's amount check; a top-up success
  webhook with no amount must not credit (it now fails closed on a credit/amount mismatch).
- (xxi) **Assumptions for owner confirmation are A1-A11 in the 3a plan:** collection charge 0 on simulated rails, no
  wallet cap, no split payment, the partial-refund and processing-charge policy, immediate refund on cancel, and the
  24-hour pickup-expiry job. As item (viii) says, that job refunds every ledger-recorded store pickup (vendor-shop
  pickups included) not marked collected by the Pickup Desk within the window, so before the ledger is on every store
  pickup must be collected at the AshantiHub office desk.
- (xxii) **Re-dispatch after a refund (the rest of the whole-refund fix).** A whole refund now cancels an order not
  yet handed over and the board, pickup desk and pickup queue refuse a wholly refunded order, but two deeper gaps remain.
  `delivery/stops.py` `reopen_for_new_rider(all_skipped=True)` reopens every stop, including a shop whose lines were
  already refunded through a skipped-stop case. And `refunds.check` / `refund_apply` do not refuse lines whose stop is
  now COLLECTED or whose order has since been delivered, so a refund approved after a re-dispatch can pay for goods the
  customer received. Make both consult the stop and delivery state before the ledger is turned on.
- (xxiii) **`_cancel_if_not_handed_over` (whole refund via dispute / delivery approval) does not withdraw a live rider
  assignment as Support's `_cancel` does:** an ASSIGNED/ACCEPTED/AT_PICKUP rider job and its dispatch offers stay live and,
  because rider `deliver`/`legacy_deliver` lock only the assignment and check no order status, the goods can still go out
  against a cancelled, refunded order (also a small race where a delivery commits between the refund's read and its
  commit; Support cancel has the same pre-existing exposure). Before the ledger is on: withdraw not-yet-picked-up
  assignments and expire open offers in the helper, and make rider delivery steps refuse a CANCELLED order (decide what
  to do for an order already in transit).

### Stage 3b (payout destinations, withdrawals, reconciliation) reconciliation (2026-10-16)

Found while writing `docs/superpowers/plans/2026-10-16-withdrawals-3b.md` (§0 there); W1–W8 are above.

- **W9 Payout destinations.** The provider looks up the name on the account (before the transaction that spends the
  code: no provider call runs inside a transaction); it must match the holder's verified name (customer profile name;
  KYC-verified vendor's owner or business name) as a set of words, and the holder confirms with a step-up code. A
  customer's profile name is self-declared and can be changed without a code, so for customers this falls short of
  §8's "verified name" (a deviation; see (xxix)). Usable after `payout_cooling_hours` (governed, default 24, at least 1);
  never edited (a change is remove + add); every add and remove sends the holder an in-app notice; numbers stored
  unmasked and sent only through `mask_but_last`. `BusinessOwnerProfile.payout_*` are untouched; a vendor may copy
  them into a new destination.
- **W10 Withdrawals.** Held in withdrawal in transit in the request's transaction, sent once (claimed under a row lock;
  a held one is returned instead of sent once its holder is suspended or its destination removed), ended by
  `wallets.payouts.apply_result` (idempotent; monotonic; amount-checked against the amount the provider itself reports;
  a report for a withdrawal never sent, a "paid" report after the money was returned and a "failed" report after it
  was paid each open a fraud case and post nothing). The provider's own message is never stored or shown. The holder's
  charge comes out of the amount sent. Limits per withdrawal and per day (per holder account) are governed settings; a
  negative vendor Available blocks withdrawal. Staff may fail a stuck one only after asking the provider, never with an
  open amount case, and the holder sees AshantiHub's fixed reason, not the staff member's note.
- **W11 Step-up while the OTP switches are off.** With the ledger on, destinations and withdrawals always ask for a code
  (`force=True`), and adding a customer recovery email or phone needs a step-up code too (`force=escrow.enabled()`),
  so a stolen session cannot add its own code channel. The step-up endpoints send codes for those three actions.
- **W12 Reconciliation.** Nightly, by provider reference, read-only; skips what the ledger was not asked to record;
  checks in transit against the open withdrawals even without a statement; asks the provider outside any transaction;
  a difference opens one fraud case per day.

### Before LEDGER_ENABLED is turned on — Stage 3b additions

- (xxiv) **Wallet and recovery-contact step-up is forced while the ledger is on,** so the Plan 2F frontend must handle
  `step_up_required` on the add-recovery-contact screens (they answer 403 with the ledger on until it does), and a
  customer with no usable contact (`no_channel`) cannot add one. The add-secondary-email/phone calls (`useAuth`) are plain `apiPost`s, so the Plan 2F `apiClient.js` step-up mechanism is expected to cover them; proven by the "add recovery contact (ledger on)" step of the Plan 2F walkthrough (list above). Every must-fix in "Before the OTP
  switches are turned on" (notice send limits, a real SMS provider, the secondary-email confirmation) must be done
  before the ledger is on.
- (xxv) **Hubtel payouts, status and name lookups are not connected:** with `PAYMENTS_PROVIDER=hubtel`, adding a
  destination answers `name_check_unavailable`, withdrawals `payouts_unavailable`, and the reconciliation has no
  statement (`unavailable`, or `mismatched` only when in transit differs) until Plan 7.
- (xxvi) **Provider float.** When AshantiHub funds coupons, payouts can exceed collections; a confirmed payout still posts
  and provider clearing may read below zero. Fund the float before go-live and watch the nightly run.
- (xxvii) **Payout reports must carry an amount before Plan 7:** a Hubtel SUCCEEDED report (webhook or status) with no
  amount must not be applied (fail closed, like the top-up rule in (xx)). `wallets.payouts.apply_result` now enforces
  this: a SUCCEEDED report that names no amount is not settled unless the withdrawal's provider is `simulated` (the
  simulated status answers none); it opens a `withdrawal-amount-<ref>` case instead. Plan 7's Hubtel client must still
  return the amount it paid.
- (xxvii-b) **Hubtel's status client must tell "unreachable" from "not wired":** raise `NotConnected` only when the call is not built yet; a timeout, 5xx or any other failure after a request must raise a different exception. Staff failing a stuck withdrawal treat `NotConnected` as "check was done by hand" but answer 503 `provider_unreachable` (changing nothing) for anything else.
- (xxviii) **Destination changes are told in-app only:** before the ledger is on, a payout destination added or removed
  should also be texted or emailed to the contacts on file.
- (xxix) **Customer names are not verified:** before the ledger is on, either require a step-up code for a `full_name`
  change while the ledger is on and restart the cooling period of every live destination on a rename, or decide
  customer KYC (§8).
- (xxx) **Item (vii)'s safety net needs a statement:** the reconciliation reports a paid but uncredited top-up only where
  the provider gives a statement; with `PAYMENTS_PROVIDER=hubtel` no run has one until Plan 7 (only the in-transit
  check runs), so (vii)'s alerting is the only guard. Item (xx)'s withdrawal check is done
  (`wallets.withdrawals.request` refuses a negative Available and checks the balance under `posting.lock`).
- (xxxi) **Stale "not built" copy once the ledger is on:** `core/later_phase.py` ~47 ("Sellers are not paid through
  AshantiHub yet"), `insights/accounting.py` ~182 ("Needs reconciliation, which does not exist yet") and ~179 ("none is
  kept"; `wallets.PayoutDestination` is now that record). Branch them on `LEDGER_ENABLED` (same class as (xiii)).
- (xxxii) **The registered payout details keep an unforced step-up:** `PATCH business-owners/me/payout/`
  (`accounts.views.PayoutDetailUpdateView`) calls `step_up.require` without `force`, so with the ledger on and the OTP
  switches off a session can change them with no code. A `from_profile` copy into a payout destination is still
  name-checked, code-confirmed and cooled, but anything else that pays from those details (a manual staff payout) is
  exposed. 3b leaves it because registration's payment step uses the same PATCH and cannot answer a step-up yet; force
  it (`force=escrow.enabled()`) once registration can, before the ledger is on.
- (xxxiii) **Recovery emails verified while the ledger was off remain step-up code channels once it is on**
  (`otp/identity.py` ~66, `otp/service.py` ~191). Before switch-on, re-confirm pre-switch recovery emails under step-up or
  exclude secondary emails from wallet-action channels, and notify the primary contacts whenever a recovery email is added.
- (xxxiv) **Staff can change a customer's or owner's contacts and the matched name without a second person:**
  `PATCH accounts/customers/<id>/` and `business-owners/<id>/` (`accounts/views.py` ~720-758) need only `users.manage`,
  no sudo, and send no notice; the portfolio `business.update` approval can change a KYC-verified owner's name with no
  re-KYC. While the ledger is on these need sudo and maker-checker, the old contacts must be notified, and a contact or
  name change must restart the cooling period or block withdrawals.
  **Built (7C Task 5):** while the ledger is on, those two PATCH doors need sudo and submit `wallets.holder_details_edit`
  (two_people; one approval from another `users.manage` holder or a Super Admin applies it). Applying revalidates, restarts
  `payout_cooling_hours` on the holder's destinations and logs the change masked; a stale check uses a keyed digest. Not
  built: notices to the old contacts, the portfolio `business.update` route (parked), and a staff-name edit door.
  2026-10-19 owner ruling: a scout can no longer change a business's name or contact at all; the business files the
  change itself, a scout visits to verify it, and two staff approve it with the password, restarting the cooling
  period; built in 7F-C Tasks 6-9 (`portfolio.detail_changes`, `business.detail_change`; the portfolio
  `business.update` route no longer carries `full_name`, `login_phone` or `email`, Task 9). Notices to the old
  contact are built in 7F-C Task 11 (the holder is told, in the app and at the old contact, of a staff edit or an
  applied request). Applying a new sign-in contact also revokes the owner's trusted devices; JWTs already issued
  stay valid (stateless, no revocation mechanism). The staff-name door is still open (a third-party rider's
  `StaffUser` name is not a payout holder edit and tells nobody). Owner question: should Operations be able to edit a
  third-party rider's staff name at all while the ledger is on?
- (xxxv) **DECIDED 2026-10-18:** a second approver (maker-checker) is required to fail a stuck withdrawal, for any amount (built by plan 7C Task 4, approval kind `wallets.withdrawal_resolution`). Original text, superseded: **Owner question: a second approver (maker-checker) for failing a stuck withdrawal by hand** is undecided (plan
  B6). Today `wallets.manage` plus sudo and a password suffice, after the provider is asked.
  2026-10-19 owner ruling: confirmed; a payout stuck at PROCESSING can be settled only as "paid" with evidence,
  never failed. Chain wording (the note naming how many approvals are needed above the co-sign limit) corrected in 7F-C
  Task 11.
- (xxxvi) **Amount cases and the staff fail action.** A CONFIRMED amount case is treated like a dismissed one. Staff fail
  is REFUSED (409 `provider_processing`) while the provider says PROCESSING or answers any unmapped status; an
  unreachable provider answers 503 and changes nothing. A payout the provider keeps reporting as PROCESSING, or with a
  different amount, therefore cannot be ended in the app: a maker-checker "settle as paid / fail with provider evidence"
  action is required before switch-on.
  **DECIDED 2026-10-18:** the maker-checker "settle as paid / fail with provider evidence" action is the way out for a payout stuck at processing, with mandatory evidence (built by plan 7C Task 4); the staff fail door submits it rather than failing directly.
  **Built (7C Task 4):** `wallets.withdrawal_resolution`
  (two_people, sudo; `POST staff/withdrawals/<id>/resolve/`, and the fail door asks with outcome failed). The provider is
  asked again at approval: PROCESSING (or unmapped) blocks "failed" (409 `provider_processing`); "paid" with evidence is
  allowed; a provider not wired to report (NotConnected) lets the evidence stand; an opposite final answer is 409
  `provider_changed`.
  2026-10-19 owner ruling: a payout stuck at PROCESSING can be settled only as "paid" with evidence, never failed
  (owner confirmed; the earlier "owner should confirm" question is closed). The chain note now quotes the
  approval setting `cosign_threshold` (7F-C Task 11). The holder's row lock is taken before the duplicate-pending
  check there (7F-C Task 11).
- (xxxvii) **The simulated statement is built from AshantiHub's own records,** so reconciliation can only prove sessions
  and journals agree. Plan 7 must supply: a Hubtel status client that raises a distinct "unreachable" exception (see
  (xxvii-b)), real `find()`, `pending_payouts()` and `statement()` implementations, and a flag on any reference that
  appears on the statement but is unknown to AshantiHub.
- (xxxviii) **Reconciliation catch-up and case cadence.** A missed night (beat down at 02:30) is not caught up; add a
  catch-up run. One fraud case per day exists only while it is OPEN; a closed case reopens as a new one.
- (xxxix) **The 5-minute payout poll stops settling when the ledger switch is off.** Decide to keep settling open
  withdrawals regardless of the switch, so money in transit is never stranded by switching the ledger off.
- (xl) **Masking in staff notes:** digit runs of 6 or more in a staff note are masked before storage.
- (xli) **`mask_but_last` keeps 5 digits;** consider 4 for MoMo numbers.
- (xlii) **Throttle buckets are keyed by user pk** across customers and owners (project-wide), so a customer and an owner
  never share a bucket only because their pks differ in kind; review before go-live.
- (xliii) **Money-settings approval screen wording** for the withdrawal settings (per-withdrawal and daily limits,
  `payout_cooling_hours`) needs owner review.
- (xliv) **Name oracle.** One valid step-up code allows repeated account-name lookups within its 5-minute life, capped
  only by the throttle. Consider a per-holder mismatch counter before Plan 7 makes lookups paid.
- (xlv) **Hand-failed withdrawals and a late "paid" (before switch-on).** Staff cannot fail a withdrawal the provider
  says is still PROCESSING (409 `provider_processing`), but once failed by hand nothing asks the provider again, and the
  returned money can be withdrawn at once (the same holds for ANY FAILED return, not only staff-failed). Before switch-on: count any returned (FAILED) withdrawal toward that day's limit or
  hold the returned amount briefly; keep asking the provider about failed withdrawals for N days so a late "paid"
  raises the case quickly; refuse new withdrawals for a holder while a late-paid case is open. Until Plan 7 a late
  "paid" is caught only by a webhook or the next night's reconciliation.
- (xlvi) **Name-check stopwords.** Generic words (LTD, VENTURES, ENTERPRISE, GHANA, THE, CO) count toward the two-word
  floor of the name match; add a stopword list in `wallets/names.py` before switch-on.
- (xlvii) **Reconciliation drops one difference when `find()` fails** (a clearing journal with no provider reference);
  record it as its own difference instead.
- (xlviii) **A recovery email requested while the ledger is off and confirmed after switch-on** becomes a code channel
  without a step-up. Void unconfirmed recovery-contact requests at switch-on.
- (xlix) **`NETWORKS` has no VODAFONE to Telecel alias** for older `payout_momo_network` rows, so `from_profile` refuses
  them; add the alias.
- (l) **Test and plan-text notes.** The nested-dict/frame scrubber test is weak, and the contact-change happy path does
  not assert the token was spent. Plan text B6, E5 and the line near 428 is stale; this spec is correct.
- (li) **DECIDED 2026-10-18:** top-up money is withdrawable only after a hold of 1 hour, held in the governed setting `wallet_topup_hold_minutes` (default 60, minimum 60); setting in plan 7A Task 1, hold built by plan 7C Task 3. Original text, superseded: **Owner question: top-up money can be withdrawn immediately,** so a MoMo collection reversal after a withdrawal
  could cost AshantiHub money. Consider a hold period on newly topped-up funds.
  **Built (7C Task 3):** `wallet_topup_hold_minutes` holds newly topped-up money. 2026-10-19: the refund-after-spend
  bypass was tested (7F-C Task 4) and found not to exist in the old code; the tests are kept as regressions, the
  held amount is capped by the balance, and `withdrawable` and `request` now share one formula.
- (lii) **Migrations 0003 and 0004 of `wallets` could be folded into one before any deploy** (nothing is deployed yet;
  the 0003 file is root-owned, so fold it with the right permissions).
- (liii) **Parked:** the daily/per-withdrawal limit check can race with a concurrent proposal and ignores future-dated rows.

### Before LEDGER_ENABLED is turned on — Plan 3F (wallet screens)

- **DONE 2026-10-21, Frontend screens (Plan 3F, built; ledger still off):** `components/wallet/` (top-up with the server's processing line, balance, statement with filter chips, payout destinations with the cooling-hours line, withdraw form with the server's charge and you-receive, withdrawal history, payment-method picker), the picker and processing quote at checkout (`CartDrawer`, `MoMoPayment` without the made-up 1.5% when a quote is given), the vendor "Money" tab (`VendorPayouts`, one tab for money and payouts) and the staff Wallets, Withdrawals (two-person resolution through `resolve/`) and Reconciliation panels. The cross-screen rules (no tel/WhatsApp, no card fields, no bare long digit runs, tabular amounts, no gold on an amount, no "1.5%", no NaN/undefined) are held by `WalletNoInventionSweep.test.jsx`; the 7C T5 request kinds are shown to list in Approvals by `kind_label` (`ApprovalsWalletKinds.test.jsx`). Staff cannot edit payout details from any current screen, so no screen creates a `wallets.holder_details_edit` request.
- **Gate checks recorded 2026-10-21:** (a) gate (xxiv): `requestSecondaryEmail`/`requestSecondaryPhone` and their confirm calls (`hooks/useAuth.js`) are plain `apiPost`s, so `apiClient.js`'s one step-up retry covers them, but no component calls them yet (no recovery-contact screen exists), so it was read, not run: the walkthrough step "add recovery contact (ledger on)" stays owed, and a screen that adds a contact is Plan 2F's follow-up. (b) gate (xxxii): registration's payout step (`submitPayoutInfo`) still uses the unforced `PATCH business-owners/me/payout/`; left as is, forcing it needs a step-up in registration first. (c) gate (xvi): dispute and delivery refunds send no customer notice; needs a backend notification, the statement row is the notice. (d) gates (xiii) and (xxxi): the "no money moves" copy in `RefundsPanel.jsx` (`SimulatedBanner`) and `LaterPhasePanels.jsx` is **not changed here** and still says so with the ledger on; branch both on the ledger.
- **Owed before the switch (not performed in 3F, ruling R22):** each new screen at 360, 768 and 1280 px for horizontal overflow and `DESIGN.md` conformance; the staff panels against `scripts/staff-layout-audit.js` (needs a preview on 4173 and the API on 8110); one real-phone pass of the step-up prompt over the withdraw form; a staging run of top-up, pay from wallet, add a number, withdraw, and a stuck-withdrawal resolution by two staff accounts on the simulated provider (`SIMULATED_PAYOUT_OUTCOME=pending`). The backend suite (`wallets orders`) is the controller's.
- **Switch-on checklist additions:** Plan 4 Tasks 14-15 shipped (the customer wallet tabs; until then the wallet components have no customer page, F5); the stale copy in (d) branched on the ledger; the owed manual checks above done.
- **Open items found during the build:** Plan 4F must put its Money sub-tabs inside 3F's single `money` tab (R1, Director ruling "Money and Payouts in one tab"; 4F's G1 and its Step 0 grep for "payouts" need editing) — done by 4F (Task 7). Plan 4 must pass `orderHref` to `TransactionsList` (R6: no default, an order link renders only when the caller supplies one; no `/my-account/orders/{id}` route exists). Rider endpoints also answer `id_required` and `daily_count_limit` (Plan 5F's screens must word them). The backend sends no `topup_hold_minutes`, so the top-up screen carries no "withdrawable after N hours" line (R2); add it when the field exists. Gate (xvi) refund notices as in (c).
- **3F follow-ups, closed by plan 4F Task 3:** the reconciliation mismatch notice now links to the staff tab id `reconciliation` (it linked to `wallets-reconciliation`, so no Open button showed), and `CartDrawer`'s total and the MoMo processing quote include the server's delivery fee when `DELIVERY_FEE_ENABLED` is on and promotions are off (`delivery-preview` answers `delivery`; `delivery.rates.cart_delivery_quote`).

### Before LEDGER_ENABLED is turned on — Plan 5F (rider and dispatch money screens)

- **BUILT 2026-10-28 (5F, ledger still off):** the rider's wallet (balance, commission held, deliveries, days, statement, payout numbers and withdrawals with the daily count line) mounted from 3F's components on `RIDER_WALLET_BASE`, behind the Earnings tab; the Delivery Manager's "works for" control; the Accountant's Rider payouts (wallets, daily commission, withdrawals, one rider's wallet); refund figures and the whole-order refund on the delivery-case screen; Re-deliveries (Super Admin and Pickup Desk) and Free delivery in the Super Admin's Marketplace group (Director ruling 8); the dispatch queue says "own riders first" (Task 10); payroll lists only in-house trips and the re-delivery fees owed to in-house riders (Task 11). Gate (xci) is built; (cxxv), (cxxix) and (cxxxi) are updated above. 3F's parked R24 (paged wallet rows keyed by holder) is closed by Task 6.
- **Six additive backend reads (5F, Director G3; no permission or write changed):** (a) rider summary count fields and `balance_note`; (b) `holder_type` filter on staff withdrawals; (c) refund figures, kept fee, free-delivery funder, whole-refund flag and ledger-aware money copy on the delivery case; (d) `redeliverable` / `redelivery_fee` / `not_redeliverable_reason` on the re-delivery list; (e) `assign_limit` on queue rows; (f) re-delivery fees owed on the payroll reads.
- **Verification record (2026-10-28, 5F closeout):** no-invention sweep `RiderMoneyNoInventionSweep.test.jsx` 8/8 (every element showing a GH₵ figure is tabular and not gold, including amounts quoted inside sentences). Full frontend suite under heavy load: 319 files, 2868 tests, with 10 files and 15 tests failing in that run (App.routing manifest link, BusinessDashboard hours prompt, StaffDashboard x5, darkModeSmoke /faq, CartDrawer.wallet pending read, AdminCommandCenter fraud link gate, OverviewPanel, RegisterBusinessPanel, ReportsPanel, StepIn x2); re-run of those files together passed 8 of 10, and the two left (StaffDashboard "Analytics panel real counts", AdminCommandCenter "reconciliation fraud link gate") pass alone (load flakes, none in 5F files). `npm run build` passes. Backend `wallets delivery ledger orders disputes` (one run, `DB=ashantihub17`, `--parallel 1 --noinput`): 1578 tests, OK.
- **Gate checks, read in the code (listed, not changed):** (xii) `delivery/config.py` `refund_consequences` still says the money "returns ... at once" whenever the ledger is on, even for an order paid before it was on; (xcvi) the Accounting dashboard still lacks the rider liability and commission-income lines (5F's daily commission is per day only); (xcii) rider identity still rests on one person; `acct-rider-payouts` keeps the stale shell text ("No rider rate exists ...") but it is now only the ledger-off fallback.
- **Owed before switch-on (not run in the 5F build: no browser, phone or staging):** (1) rider withdrawal events show the amount: open "My activity" as a rider and the staff Activity screen and confirm "GH₵ ..." as sent; (2) AshantiHub-funded promos (7F-E Task 5) create and approve end to end and Operations sees the approval in Approvals; (3) every new screen at 360, 768 and 1280 px (`scripts/staff-layout-audit.js` for the staff panels); (4) the rider wallet on a real phone with the step-up code prompt over a withdrawal; (5) the staging walkthrough with the ledger on and the simulated provider: make a rider third-party (Delivery Manager proposes, Super Admin approves), deliver and release an order and check the earning, add a number after the Ghana Card is approved, withdraw three times and see the fourth refused with the reset time, run the 00:20 commission job and see the Accountant's daily commission, open a coupon delivery case and refund it whole, ask for a re-delivery as the Pickup Desk, pay it as the customer, see the queue chip and the payroll line after completion, repeat with no AshantiHub rider on shift so a third-party rider makes the second trip and see "Re-delivery paid to you" in that rider's wallet and no payroll line, and open Free delivery and Re-deliveries from the Super Admin's Marketplace group.
- **Build-time rulings to recheck:** the Pickup Desk finds Re-deliveries in the default "System" group until Plan 1F gives it a Desk menu; the Super Admin's Marketplace group order needs re-checking once 1F merges. The no-invention sweep for these screens is `components/admin/panels/rider/__tests__/RiderMoneyNoInventionSweep.test.jsx`.

### 7F-C follow-ups (2026-10-19)

Built in `docs/superpowers/plans/2026-10-19-wallet-rulings-7f-c-followups.md` (branch feature/wallet-rulings-7c):

- (7F-C-a) **Frontend contracts (rulings R1, R8; 7F-C Task 10).** The staff-edit screen reads `approval_id` from a 201
  (the change waits for a second person), staff sudo and the fail-with-evidence 201 are contract-tested, and the owner
  profile has a "request a name or contact change" form (`DetailChangeRequest`). **Not built:** a step-up prompt, and
  no staff screens exist yet for Operations to assign a scout to a detail-change request, for a scout to check in for
  a `change_verification` visit and record the outcome, or for staff to cancel an event (the endpoints exist). The
  owner form is live and not tied to the ledger switch, so filed requests sit at REQUESTED until those screens exist;
  with the ledger on the owner cannot file at all (no step-up prompt UI). Owner question: hide the owner form until
  the staff screens exist?
- (7F-C-b) **Owner questions still open after 7F-C** (record the answer here and close):
  1. R3's field list: the owner may request `full_name`, `login_phone` and `email`; `business_name` was left out.
     Should it be added?
  2. The unclaimed-business path: an unclaimed owner cannot file a request (409); a scout's hand-over claim still sets
     an unclaimed owner's email once (`accounts/claims.py`). What is the rule?
  3. The processing charge on an event cancellation: the ticket price is refunded out of the organiser's
     Pending or Available (Available may go negative), and AshantiHub bears the processing charge. Is that the right
     split?
  4. An organiser cannot cancel after the event date has passed (Task 2 ruling). Should Operations alone be able to?
  5. A new sign-in contact revokes trusted devices but not already-issued JWTs (stateless). Build token revocation?
  6. An applied detail change has no owner undo. Should one exist (and for how long)?
  7. The frontend has no step-up prompt, so with the ledger on (step-up always forced) an owner cannot file a detail
     change from the form until the wallet frontend (Plan 3F) lands.
  8. A Hubtel payment confirmed after the event was cancelled is marked FAILED (`metadata.not_applied =
     "event_cancelled"`, webhook answers 200) with no ticket and no staff queue; the customer's money is refunded by
     hand from the webhook note. Add a queue?
  9. The staff-name door is open (see (xxxiv)).
  10. Filing a detail change sends nothing to the current contact (the old contact is told only after apply), and
      with the ledger and OTP switches off no step-up is needed, so a stolen session meets only the scout visit. Tell
      the current contact at filing?
  11. The Operations member who assigned the scout is not excluded from deciding the approval, so one Operations
      person plus a scout they picked can complete a change.
  12. The maker scout can cancel the approval alone.
  13. A staff-approved `holder_details` contact change does not end trusted devices, while `detail_change` does.
- (7F-C-c) **Still open from 7C, not fixed in 7F-C:** staff authenticator guesses are not counted toward the daily
  cap (the race of l.333) and a trusted-device sign-in bypasses it; the provider is asked twice per withdrawal
  approval while locks are held; the scan-notice retry sweep; real concurrency tests (the lock-order tests assert query
  order and captured on-commit callbacks); renewal after a cancel is unrefunded. Done: a partly refunded sale no longer loops in the cancel
  sweep (the refund is capped at min(price, room), Task 2).
- (7F-C-d) **Open before the switch is turned on:** (a) a ticket sold while the ledger was on and cancelled after it
  is switched off is refunded outside the ledger (`events.cancellation._sale_of` returns None when off): its money
  stays in organiser Pending and the buyer is told Support will refund; the fix is to find the sale regardless of the
  switch and leave the ticket for the sweep while off (this also covers the `in_ledger` / `unreleased_legacy` filters
  ignoring `LEDGER_ENABLED`). (b) A failing approvals hook is swallowed (`approvals/services.py` ~274-283), which can
  leave a detail-change request VERIFIED forever with no staff action to close it. (c) `ledger.sales.record_verification`
  "matches" has no cancelled-event guard. (d) Tickets released under the old scan rule on an event cancelled now:
  AshantiHub refunds the buyer by hand while the organiser keeps the payout.

### Stage 5 (third-party dispatch) reconciliation (2026-10-16)

Found while writing `docs/superpowers/plans/2026-10-16-dispatch-wallets-5.md` (§0 there):

- **S5-1 Third-party flag.** The code had no rider company or employment concept. `delivery.Rider` gains `employment`
  (`ashantihub`, the default for every existing rider, or `third_party`), a free-text `company_name` and
  `third_party_since`. No rider-company table: each rider is paid personally (§2.1, §8), so nothing keys on the company.
- **S5-2 Who sets it.** The `delivery.rider_employment` approval: the Delivery Manager (`delivery.fleet`) proposes, a Super
  Admin approves with the password (their own change applies at once, and needs the password too). Nobody changes their own
  employment (`403 own_rider`), and only a Dispatch rider can be made third-party (`409 not_a_rider`). Switching back to AshantiHub's own is refused while
  the rider holds money, has a withdrawal on its way or a delivered order waiting for Support's call.
- **S5-3 When a rider is paid.** At release only (Support's positive call, §4.1), in the release's transaction, for a
  door-to-door order the rider delivered after becoming third-party. The whole fee AshantiHub took at release (the
  customer's delivery fee plus a fee the business covered with its free-delivery promo) moves from platform delivery
  income to the rider (`order-rider-<order>`): 90% to Rider balance, 10% to the reserve. The rate-card `rider_pay` stays a
  payroll record for AshantiHub's own riders.
- **S5-4 Rate.** The existing `rider_commission_bp` (default 1000) as it stood when the order was paid (§3.3), kept on the
  earning, so the end-of-day posting needs no true-up (§1 row 5).
- **S5-5 End of day.** At 00:20 Accra each rider's reserve of every earlier day still held goes to platform commission
  income, with the day's deliveries, gross, commission and net recorded; a missed night is caught up.
- **S5-6 Refunds.** Before release a whole refund returns the delivery fee to the customer and the rider is never paid.
  After release a partial refund leaves the rider paid; a whole refund takes the earning back first (the rider's balance
  may go below zero and then blocks withdrawals; the reserve is taken back, or the commission once posted).
- **S5-7 Wallet.** A rider's accounts are held by their staff account; the Stage 3b destinations and withdrawals serve them
  (`holder_type` "staff") with the rider's staff name as the verified name once an approved, in-date Ghana Card is on
  file, the same limits and cooling, and step-up codes (third-party riders, unlike office staff, may ask for
  `withdrawal` and `payout_destination` codes). AshantiHub's own riders get `409 wallet_disabled`.
- **S5-8 Reconciliation.** Unchanged: rider money touches provider clearing only through the withdrawal journals the
  nightly run already compares.
- **S5-9 History.** `delivery.RiderEmploymentPeriod` rows (opened when a rider becomes third-party, closed when switched
  back) decide who a delivery's money belongs to by its time, so payroll and the wallet never depend on the current flag.
- **Owner note.** A delivered order that Support never releases blocks switching its rider back to AshantiHub's own
  forever; there is no way out yet (a Support release or a refund is the only exit).
- **Decision (Task 6).** A third-party rider cannot be moved off the Dispatch role or deactivated while still third-party
  (409 `third_party_rider`, `delivery.employment.block_leaving`, under the rider row's lock): switch them back to
  AshantiHub's own first, which checks their money. So no wallet is left that nobody can open.
- **Owner note (Task 6).** A rider's withdrawal activity events carry the amount and are readable by Operations and line
  managers who lack `wallets.view`; decide whether to log only the reference. `rider/earnings/` still shows the rate card
  for a third-party rider; the frontend must branch on `rider/me` `wallet`.
- **Owner note.** A whole refund after a rider has been switched back to AshantiHub's own can leave a negative wallet
  balance that nothing collects yet.
- **S5-10 Payroll overlap.** Payroll leaves out only the in-period deliveries whose order has an `order-pay-<id>` journal
  (what a release can pay), so with the ledger off, or for orders paid before it was switched on, payroll still pays them.
  Switching back is also refused while the rider has a delivery in progress.
- **S5-11 Review notes (Task 2).** Until Plan 5 Task 4, a whole refund after release takes the delivery fee from shared
  platform delivery income, not from the rider who was paid it; from Task 4 the earning is taken back from the rider
  first. (A rider moved off the Dispatch role is refused, Task 6.) Rider earnings never touch provider clearing (R13).
- **S5-12 Self-dealing (Task 5 review).** A third-party rider who is also given `wallets.manage` is refused (403
  `own_withdrawal`) when failing their own withdrawal, before the provider is asked and again under the row lock. Owner
  question, same family, not yet closed: a rider holding `fraud.manage` could dismiss or confirm the amount case on their
  own withdrawal (`fraud.views.FraudFlagConfirmView`, `FraudFlagDismissView`), and a rider holding `orders.verify` could
  release their own deliveries (`ledger.views.OrderVerificationView`); consider refusing self-dealing in those views too.
  A Ghana Card with no expiry date does not count as verified (`delivery.employment.id_verified`); rider upload and the
  Delivery Manager's approval now require the expiry date for that paper.

### Before LEDGER_ENABLED is turned on — Stage 5 additions

- (xci) **BUILT by Plan 5F (2026-10-28), switches still off; see "Before LEDGER_ENABLED is turned on — Plan 5F".** **Frontend (Plan 5F).** The rider app's wallet: the balance; the reserve as "AshantiHub's commission, taken after
  midnight"; earnings per delivery with their status; each day's gross, commission and net; the statement; payout
  destinations and withdrawals with the step-up prompt; `409 wallet_disabled` for AshantiHub's own riders and
  `409 id_required` until the Ghana Card is approved. The Delivery Manager's "works for" control on the rider profile (it
  raises an approval; `409 rider_money_open` lists what is open). The Accountant's rider wallets, rider withdrawals and
  daily commission screens, and one rider's wallet (now with their withdrawals). `rider/earnings/` still shows the rate
  card; the frontend branches on `rider/me.wallet`.
- (xcii) **Rider identity rests on one person.** A third-party rider's verified name (staff `full_name`) and code channel
  (staff `phone` / `email`) are typed by whoever invited them, usually the Delivery Manager, who also approves their Ghana
  Card; nothing compares the card's name with `full_name`. (No staff-edit endpoint exists today: `staff.manage` has
  manager, permissions, suspend, deactivate and invite, not rename or change phone.) Before switch-on: record the card's
  name at review and match it, and have a second person (or the Super Admin's employment approval) confirm both the name
  and the contacts. Any future staff-edit endpoint that changes a third-party rider's name or contacts must restart
  destination cooling and notify the old contacts, as (xxix) and (xxxiv) ask for customers and owners. A Ghana Card with
  no expiry date does not count as verified (`delivery.employment.id_verified`), and the upload and the approval require
  the expiry date.
  Also (Task 5 review, spec S5-12): a rider holding `wallets.manage`, `fraud.manage` or `orders.verify` could settle their
  own money; only the withdrawal fail is refused so far (403 `own_withdrawal`). List `FraudFlagConfirmView` /
  `FraudFlagDismissView` (`fraud.manage`) and `OrderVerificationView` (`orders.verify`: a rider releasing their own
  deliveries) as owner questions: refuse self-dealing there too, or never give those permissions to a rider's role.
  DECIDED 2026-10-18: a rider's withdrawal activity events show the amount (built by plan 7D Task 2; the payout number stays masked). Original text: Owner question (Task 6): a rider's withdrawal activity events carry the amount and are readable by Operations and line
  managers who lack `wallets.view`; decide whether to log only the reference. Owner question: `staff_row` returns the
  withdrawal's `provider_reference` to every `wallets.view` holder, riders' withdrawals included.
- (xciii-open) **CLOSED by plan 7F-E Task 2 (2026-10-19, round 3):** `orders/locks.py` is the one canonical lock order; the race is covered by `ledger/tests/test_lock_order.py` (see (cxxvi)). Original text, kept as history: **OPEN lock-order item (final review of plan 7F-D):** a rider's pickup locks the DeliveryAssignment row and then saves the order row (`DeliveryAssignment.sync_order`), while `refunds.refund_order` locks the order row then the assignment row. The two can deadlock (Postgres aborts one; no money is lost, the request fails and is retried). Not fixed: the delivery write paths that lock an assignment then save the order are many (`delivery/views_rider.py`, `delivery/views_live.py`, `delivery/services.py`, `orders/views.py`); the fix is to lock the Order row first on each.
- (xciii) **DECIDED 2026-10-19 (round 2), supersedes 2026-10-18:** the delivery fee belongs to the rider once any pickup is done; goods refunds never return it, and with no pickup a whole refund returns it to the customer. The rider is paid through the usual 90/10 split. A promo-covered fee is paid by the promo's owner (a business promo is debited from the business, an AshantiHub promo from the promo subsidy account). A coupon shortfall is covered by AshantiHub (7D ruling 5 kept). `OrderRefund.delivery_kept_pesewas` replaces `rider_pesewas`. For multi-stop jobs "any pickup" replaces 7D ruling 7, and the 7D final-review note on the promo-funded rider pay gap is closed. The vendor sales view and the paid text count only business-funded promos. Built by plan 7F-D Tasks 1-2. Open questions: (a) an in-house rider who picked up: the fee is kept as platform income (assumed). (b) A failed delivery re-assigned to a second rider: the fee is paid once, to the rider on the assignment when it is settled (the current `assignment.dispatch_id`, see (d)), never twice. (c) A staff-created AshantiHub-funded free-delivery promo (the field exists, there is no screen). (d) A failed delivery re-assigned to a second rider: `stops.reopen_for_new_rider` clears every stop's `collected_at` while a single-stop `picked_up_at` survives, so the earned-fee evidence can disappear for multi-stop jobs and the payee is the current rider (pre-existing at release). Superseded text (2026-10-18): a third-party rider whose delivery was picked up (`picked_up_at` set) before a whole refund is paid, net of the rider commission split (90% of the delivery fee to the rider, 10% commission), and the remainder, including the 10% commission, goes to the customer; a rider who was only assigned (no pickup) gets nothing. If a coupon leaves the customer less than the rider share, the customer's credit floors at 0 and AshantiHub bears the shortfall. `OrderRefund.rider_pesewas` records the share, the posting is keyed `rider-refund-{order.pk}` (idempotent), and pay waits for Support's decision on the refund. Built by plan 7D Task 1. Original text, superseded: **Owner question: a rider is paid nothing for a delivery whose order is refunded whole,** before release (the fee
  goes back to the customer, W4) or after it (the earning is taken back and the balance may go below zero), even when the
  business was at fault and the rider did the work. The alternative is for AshantiHub to pay the rider from its own
  income in those cases. (See also (c): the same wait applies to an unreachable customer, who never pays the rider.)
  **Failure mode to decide:** after the day's commission was posted, a whole refund takes the commission back out of
  platform commission income; if that account holds less than the reserve (it can, as it is also spent down by other
  refunds), the ledger refuses the posting and with it the whole refund. Either allow the commission-income account
  to go negative for that one posting (`allow_negative`, as the rider's balance does), or gate the refund and tell
  Support. Not built.
  **DECIDED 2026-10-19, closed by plan 7F-D ((xciii)): the promo's owner pays the rider when the delivery was done; nothing moves otherwise. Original question (found in final review, 2026-10-18):** before release, Delivery payable holds only the fee the customer paid; a delivery fee covered by the free-delivery promo is taken from the business only at release, so on a pre-release refund after pickup the rider gets nothing (`backend/ledger/riders.py` `refund_trip`, since deleted, returned None when `delivery_pesewas == 0`). With delivery fees off by default ((xcvii)) this is the common case today. Who funds rider pay for a promo-covered fee on a refund: the business, AshantiHub, or nobody? Not built; decision needed.
  **Round 3 (2026-10-19):** (a) CLOSED, an in-house rider who picked up leaves the fee as platform income (owner: yes). (b) and (d) CLOSED by R3/R4 (gates (cxxviii), (cxxix)): the first rider is unpaid when a delivery is re-assigned before completion and the pickup rule is evaluated on the current leg; the first rider keeps the fee when the trip was completed and the customer was away. (c) CLOSED by plan 7F-E Tasks 4-5 (gate (cxxiv)). Coupon shortfall refinement: stays: a whole refund pays the rider in full when the coupon left the customer less than the fee, AshantiHub covering the gap from the subsidy; changed: R1 (gate (cxxv)).
- (xciv) **A rider switched back to AshantiHub's own can still owe money later.** The switch is refused while money is
  open. (Superseded by (xciii): a refund no longer reverses a rider's earning, so this can no longer arise from a refund.) Originally, a whole refund after release of an older third-party delivery reversed its earning (it works on the
  earning, not on the current flag), leaving a negative balance on a closed wallet with no way to recover it in the app
  (payroll deduction or write-off is a process decision; the rider's account stays listed to `wallets.view` staff, though
  their own read answers `409 wallet_disabled`).
  A third-party rider cannot leave Dispatch or be deactivated while third-party (`employment.block_leaving`, 409
  `third_party_rider`), so deactivation of a rider with money is blocked until they are switched back, and that check
  refuses a switch back while money is open. What remains: a re-role or deactivation done outside that path (a direct
  database change, or a future endpoint that forgets `block_leaving`) would leave the `RiderEmploymentPeriod` open and
  the wallet unreachable, and **suspending** a third-party rider (also a paper-expiry auto-suspension) strands their
  wallet, as a suspended staff member can neither sign in nor withdraw until reinstated. Before switch-on, flag a
  suspension with money open, or provide a maker-checker staff payout to a verified destination. Revoking
  `delivery.dispatch` from a third-party rider individually is refused (409 `third_party_rider`, `StaffPermissionsView`),
  but **editing the Dispatch role's permissions** (people role editor) still removes it for every rider and strands every
  third-party wallet; refuse that edit while any third-party rider exists, before switch-on. `block_leaving` and
  `delivery_in_progress` apply with the ledger off too (a third-party rider cannot be re-roled or deactivated even then).
  A flagged rider gets `409 otp_off` for step-up codes with the ledger off. The Ghana Card expiry date is required at upload
  and approval only while the ledger is on; `id_verified` (the money gate) always needs it, so cards approved before
  switch-on without one must be re-reviewed.
  Round 3 (2026-10-19): re-deliveries are done by in-house riders (gate (cxxix)), so this note is unaffected; a rider switched to in-house is still refused while money is open.
- (xcv) **The end-of-day commission job is a no-op while the ledger is off** (like (xxxix)). The switch is one-way ((x)),
  so a reserve is stranded only if the ledger is switched off, which it must never be. A missed night is caught up by the
  next run (built).
- (xcvi) **Accounting screens do not show rider money yet.** `insights/accounting.py` and the Accountant's dashboard count
  neither platform commission income nor AshantiHub's liability to riders (Σ rider balance + Σ rider reserve); add both.
  The pay screens built for payroll (`delivery/views_rules.py` `RiderEarnedView` at `payouts/`, the rider app's
  `rider/earnings/`) show rate-card pay with "no money has moved", which is not what a third-party rider is paid.
  **Built in Task 6:** deliveries made while the rider was third-party (`delivered_at` inside one of their
  `RiderEmploymentPeriod` rows, past ones too) are excluded from `RiderEarnedView`, `RiderEarningsLinesView` and the
  payroll figures (`employment.payroll_jobs`, tested), so Accounting cannot pay a third-party rider twice (wallet plus
  payroll). What stays open is the Accounting dashboard's liability and commission lines.
- (xcvii) **Delivery fees are off (`DELIVERY_FEE_ENABLED`, default off).** Until they are charged most orders carry no
  delivery fee, and a third-party rider earns only fees a business covered with its free-delivery promo. Third-party
  riders need delivery fees on (owner decision 2026-10-13).
- (xcviii) **DECIDED 2026-10-19:** riders share the governed amount limits and are additionally capped at `rider_withdrawals_per_day` (default 3) withdrawals per Accra day; refusal code `daily_count_limit` with `resets_at`; built by plan 7F-D Task 3. Original text: **Owner question: rider withdrawal limits.** Riders share the customers' and vendors' governed limits
  (GH₵ 5,000 per withdrawal, GH₵ 10,000 a day, 24-hour cooling); separate rider limits would need new settings.
- (xcix) **DECIDED 2026-10-18:** `Rider.company_name` stays free text; company records only if a real company signs (no build). Original text: **Owner question: rider companies.** `Rider.company_name` is free text. If a rider company itself is to be
  contracted, invoiced or paid (instead of each rider), a company record and company payouts are a new plan.
- (c) **DECIDED 2026-10-18:** rider pay on a refund after pickup waits for Support's call on the refund (plan 7D Task 1); the normal-delivery wait for the verification call is unchanged, and the new rider-event amounts are plan 7D Task 2. Original text: **Owner question: rider pay waits for Support's verification call (RA12).** A third-party rider is credited only
  when Support records "matches" (spec §2.2 step 2(c), §4.1), so their pay can wait up to 72 hours, or indefinitely when
  the customer cannot be reached: "could not reach" releases nothing, nothing releases on its own, and so an unreachable
  customer never pays the rider. Their switch back to AshantiHub's own is blocked meanwhile (R3, `deliveries`). Decide
  whether the delivery fee should be released to the rider at delivery (or after the customer's own confirmation)
  separately from the vendor's money. The spec's "90% withdrawable immediately" holds from release, not from delivery.
- **Note (Plan 5 final review): throttle buckets are shared across account types.** The OTP / step-up throttles key on the bare pk, so a
  Customer, an Owner and a StaffUser with the same pk share a bucket; key on `otp.identity.ref` (type, pk) later. Not a
  money risk, a nuisance (one lock can block another type's codes).
### Stage 6 (catalogue, offers and stock alerts, backend) reconciliation (2026-10-16)

Found while writing `docs/superpowers/plans/2026-10-16-catalogue-offers-stock-6.md` (§0 there; its C1–C18). The items
below are numbered K1–K8 so they do not clash with those. "Stock offers and alerts" is §10 of this spec.

- **K1 The offer is the Listing.** A listing already is the priced, stocked, carted and ordered unit (`CartItem`,
  `OrderItem` with PROTECT, the fee snapshots, the stock reserved at checkout), so it stays the offer and gains an
  optional `catalogue_product` (null = stands alone: unbranded goods, services, stays, and every listing made before
  Stage 6) and a `barcode`. No listing, cart or checkout response changes shape; the owner listing forms gain `barcode`.
- **K2 Catalogue entries** (`catalogue.CatalogueProduct`: brand, name, normalised name, barcode) are made only when staff
  approve a business's grouping request; a barcode belongs to one entry, and an entry needs a brand or a barcode.
- **K3 Barcodes** are compared as 14-digit GTINs with the check digit verified (an 8-digit code starting 0 or 1 that
  checks as a UPC-E is read as its UPC-A); a store's own code (GS1
  restricted-circulation prefixes) may sit on a listing but never groups. Names are compared normalised, exact only.
- **K4 Grouping** is asked for by the business on its own product or food listing (services, stays and events never)
  and decided by staff with `listings.moderate` through the moderated-queue contract; only staff ungroup. The barcode
  matcher (`manage.py propose_catalogue_matches`, and every newly approved barcoded entry) only files requests; nothing
  is grouped automatically.
- **K5 Other sellers** (`GET /api/catalogue/listings/<id>/other-sellers/`) lists the live offers of the same entry,
  cheapest (or most available) first, with the featured offer of §10; no contact details. A sold-out offer (counted goods at 0)
  drops out of search and related lists once `SOLD_OUT_HIDDEN_ENABLED` is on (default off); its own page stays reachable. Businesses may look a product up (`/api/catalogue/products/`),
  read-only.
- **K6 Days of cover** = stock ÷ the sales rate over a governed window (default 28 days), counted over the days the offer
  was on sale. Low: the business's own line if set, else fewer than 7 days of cover, else (no sales) 5 units or fewer;
  sold out at 0. The three numbers are governed settings (`ledger.setting`: Accounting proposes, Super Admin approves).
- **K7 Alerts** are told once per crossing (a conditional update per offer), re-armed only by a restock, one in-app
  notice per business per hourly run and kind, behind `STOCK_ALERTS_ENABLED` (default off). Texts and emails "by
  preference" (§10) wait for Stage 4's outbox.
- **K8 Not changed:** the stock reservation at checkout (a correctness core). The timed release of an abandoned Hubtel
  checkout's reservation ("for a short window", §10) is a gate item before Plan 7.

### Before stock alerts are switched on and the catalogue screens ship (Stage 6)

`STOCK_ALERTS_ENABLED`, `SOLD_OUT_HIDDEN_ENABLED` and `CATALOGUE_MATCHER_ENABLED` all default off. The catalogue
endpoints answer as soon as this is deployed, but nothing is grouped until staff approve a request, the matcher files
nothing until `CATALOGUE_MATCHER_ENABLED` is on, and sold-out listings leave search (§10) only once
`SOLD_OUT_HIDDEN_ENABLED` is on (gate (cx)); the order to switch them on is in (cxxi).

- (ci) **Frontend (Plan 6F).** The listing form's barcode field (show the 14-digit key without its leading zeros) and
  "group with a catalogue product" (look it up at `/api/catalogue/products/`, ask, see the request, withdraw it);
  "Needs restocking" and the per-offer line (replace the hard-coded `stock_quantity <= 3` badge in
  `frontend/components/dashboard/panels/OwnerListingCard.jsx` with the server's `low` / `sold_out`); the product page's
  "Other sellers" panel with the featured offer and the shortfall prompt (each offer added by the customer, never
  automatically); the staff catalogue queue and ungroup action (add a `catalogue` row to `realtime`
  `QUEUE_INVALIDATIONS` so it refreshes live, and a staff `catalogue` tab: the `catalogue_needs_review` notices link to
  it); the business's lookup screen (product search and the sourcing offers return `truncated: true` when the cap of
  20 products or 50 offers cut the list: say so and ask for a narrower search). Until then no business can ask and nothing is grouped. Also for 6F: each Other
  sellers "add" must respect the cart guard (`cart.guard.blocked_reason`: 4 shops, 2 food places, 3 km; the API does not
  say whether the customer's cart can take an offer); a sold-out listing's own page still lets a customer add it (the
  cart does not check stock; checkout answers "Only 0 left"), so the product page should disable Add at 0; the staff
  Marketplace screen counts a sold-out listing as live (`marketplace/listings.py:59`) while customers cannot find it;
  promos are on, and Other sellers and the featured offer order by `price_amount`, not `marketing.checkout`'s live
  flash-sale price, so "cheapest first" can be wrong during a flash sale: order by the price the customer would pay
  before the panel ships. The shortfall prompt invites carts holding several offers of one product, which raises the
  odds of the pre-existing checkout lock-order deadlock (spec (xvii)): fix that first.
- (cii) **Texts and emails "by preference" (§10).** Stock alerts are in-app only. Once Stage 4's outbox
  (`wallets.vendor_texts.queue`, `VendorPreference`) is on `righteoushack`, queue a stock text from
  `catalogue.alerts.tell` (a new `VendorText` kind, a key per offer and alert time, a GSM-7 body naming offers only),
  honour the business's preference, and decide email.
- (ciii) **The reservation window (§10 "for a short window").** An abandoned Hubtel checkout (no webhook ever arrives)
  keeps its stock reserved for good: only `_fail_order_checkout` gives it back. It also makes the offer look low or
  sold out to the alerts and hides it from search. Add a timed release of PENDING order sessions (with the lock order of
  (xv) and (xvii)) before Plan 7 turns Hubtel on.
- (civ) **Owner stock writes do not lock the listing row (pre-existing).** `ListingRestockView` reads and saves
  `stock_quantity` without `select_for_update`, so a restock racing a checkout can lose the checkout's decrement (an
  oversell) or the restock. Before Stage 6 the owner edit forms (`ListingManageView`, `OwnerListingUpdateView`) saved
  every column, so any PATCH, even a price change, wrote back the stock it had read; Stage 6 saves only the sent fields
  (`listings.serializers.save_sent_fields`), but a PATCH that sends `stock_quantity` still races. Lock the row for the
  read-modify-write; the alerts' re-arm rule reads the same number.
- (cv) **Resolved by Plan M1B: the public responses no longer carry the business contact phone (owner and staff keep it).** Original note: **The public listing serializer still carried `contact_phone` (pre-existing).** `PublicListingSerializer`
  exposes the listing's `contact_phone` to anyone, against "businesses cannot be contacted directly". The catalogue rows
  leave it out; decide whether to drop it from the public shape (check the frontend first). The same serializer also exposes
  `business_owner.full_name` (`BusinessOwnerMiniSerializer`): the owner's personal name on every public listing detail.
  The offer rows show the business name only; decide about the owner's name with the same check.
- (cvi) **The first switch-on tells every offer already low,** one notice per business and kind. Run it once on staging
  with realistic data and read the notices before production.
- (cvii) **Catalogue entries cannot be edited, merged or retired.** A duplicate entry for one unbarcoded product, or a
  typo in an entry's name, can only be worked around by ungrouping and asking again. A barcoded listing can also join a
  brand-only entry that staff named, and a later approval for the same barcode then makes a second, barcoded entry,
  splitting one product in two. Add a staff edit and merge (with the activity log) before grouping is used at volume.
- (cviii) **Grouping is one person's decision.** One `listings.moderate` holder groups or ungroups a business's
  listing with no second check. Revisit if grouping ever affects fees, ranking or promotions.
- (cix) **Hourly cost.** The job measures every counted, published product each hour (one sales query and one bulk
  insert per 500 offers). Watch its duration on System health; if it grows, measure only offers whose stock changed or
  that sold since the last run. A restock followed by a sell-down within the same hour is never told, because a run
  re-arms an offer only when it sees it not low and above the stock it was told at; consider re-arming in
  `ListingRestockView`.
- (cx) **Sold-out hiding is off until the screens say how to use it.** Turn `SOLD_OUT_HIDDEN_ENABLED` on with the Plan
  6F screens, which must tell a business to leave the count empty if it does not count stock: with the switch on, a
  made-to-order product kept at 0 disappears from search. Counted goods only; a service or stay at 0 is never hidden. Also, with the switch on, a sold-out listing with a running
  paid Promotion drops out of search while the promotion keeps running (and keeps being charged for); decide whether to
  pause, extend or warn before it goes on.
- (cxi) **DECIDED 2026-10-18:** the stock-alert defaults (7 days, 5 units, 28 days) and the G1-G12 assumptions are accepted as proposed (no build). Original text: **Owner questions (G1–G12 in the plan):** the 7-day, 5-unit and 28-day defaults and their edges (fewer than 7
  days; 5 or fewer units) and the single-sale edge of the units fallback (G1), staff-only ungrouping (owner-confirmed on
  2026-10-16: a business also cannot withdraw a barcode match AshantiHub filed), whether the matcher should also file
  exact brand-and-name matches for branded listings without a barcode (they are grouped today only if their business
  asks), businesses seeing each other's prices and counts, the featured-offer tie rule, sold-out hiding.
- (cxii) **A lost notice is not retried.** If the in-app notice fails to save while its state moved
  (`notifications.services` never raises), that crossing is not told again until the next restock. A run that dies
  part-way is not this case: the run is one transaction, so the next run tells those offers. Acceptable in-app;
  revisit with texts (cii).
- (cxiii) **An owner's barcode edit can race a staff approve.** The owner listing update saves the barcode without
  taking the lock `attach.approve` holds (request row, then listing row). Lock the listing in the owner update and
  revalidate the barcode (store code, grouped listing, duplicate) after the lock, so an approve in flight cannot group a
  listing whose barcode has just changed.
- (cxiv) **Lock order and the residual deadlock window.** `approve` and `re_review` lock the request row, then the
  listing row; `reject` locks only the request; `detach` locks its approved request rows first, then the listing (the
  same order, so none of them can deadlock). `propose` and the barcode matcher lock the listing and then only insert a
  new request row. A lost race is caught (IntegrityError on the one-pending constraint; the matcher also skips on
  OperationalError), but `propose` for a business's own request can still raise an `OperationalError` (a lock wait or
  deadlock lost to another transaction): handle it there and answer a retryable error instead of a 500.
- (cxv) **Staff actions do not refresh live (realtime).** The catalogue approve, reject and detach actions are not in
  `QUEUE_INVALIDATIONS`, so a second staff member's queue does not update until it is reloaded. Add them with the staff
  `catalogue` tab in Plan 6F (see (ci)).
- (cxvi) **No price floor on `Listing.price_amount`.** A zero or negative price is excluded from the offers (they need a
  price above 0) but the listing still sells. Add a validation floor to the listing forms and model, and check existing
  rows, before offers are ranked by price at volume.
- (cxvii) **Unverified sellers are shown, marked `verified: false`.** Other-sellers rows include businesses whose KYC is
  not verified, honestly marked; the featured offer prefers verified ones. Owner confirmation is needed on whether
  unverified sellers should be shown at all, shown lower, or hidden.
- (cxviii) **Detach writes two audit events.** `attach.detach` records the generic moderation event and the explicit
  catalogue record, so the activity log shows an ungroup twice. Harmless; collapse them when the staff screen reads the
  log.
- (cxix) **A restock above the alerted stock that is still low does not re-arm.** Restocking from 1 to 4 (line 5) leaves
  the low alert told at 1 and unarmed: an offer is re-armed only once it is no longer low. Re-arm in `ListingRestockView`
  (and the owner edit that sets `stock_quantity`) when stock rises above the alerted stock.
- (cxx) **The matcher on approve runs synchronously.** `approve` queues the barcode matcher with
  `transaction.on_commit`, which runs inline in the staff request. Move it to a Celery job (as the nightly
  `propose_matches`) once an approved barcode can match many listings.
- (cxxi) **Three switches, all default off, switched on in this order.** `CATALOGUE_MATCHER_ENABLED` (gates both the
  nightly job and approve's on-commit run; files requests only), then `STOCK_ALERTS_ENABLED`, then
  `SOLD_OUT_HIDDEN_ENABLED` (last, with the Plan 6F screens, see (cx)). `STOCK_ALERTS_ENABLED` needs the Plan 6F "Needs
  restocking" panel first (the low-stock notice only says "Open your listings to restock" because the screen it would
  name does not exist yet) and (cvi) rehearsed on staging.
- (cxxii) **State rows are inserted before the run's transaction.** `catalogue.alerts.run` creates a `StockAlertState`
  row for each new offer in autocommit first, so the run's one transaction only updates state rows (a mass insert with a
  foreign key to `listings_listing` would key-share-lock those listings until commit, against checkout's `FOR UPDATE`).
  A run that dies leaves empty state rows behind; they are inert and the next run uses them.
- (cxxiii) **A listing must be published to be grouped.** `propose`, `approve` and `re_review` answer 409
  `not_published` for a draft, pending or rejected listing (one unpublished after it asked cannot be approved until it is
  published again).
### Stage 1b (services, events and stays) reconciliation (2026-10-16)

Found while writing `docs/superpowers/plans/2026-10-16-ledger-services-events-stays-1b.md` (§0 there; its S1–S18; the items below are numbered B1–B10 so they do not clash with those):

- **B1 Where it lives.** One `ledger.BookingSale` per paid service request, stay or ticket purchase (its subject, its fee
  snapshot, Support's call) and `ledger.BookingRefund` per sale and source, in `ledger/sales.py`; Support at
  `/api/ledger/bookings/`. `OrderFeeSnapshot`, `FulfilmentCheck` and `OrderRefund` are unchanged (their order FK is
  required). Event listing fees (`EVENT_PAY`, `EVENT_RENEW`) are platform revenue, out of scope like subscriptions.
- **B2 Fees.** Services and stays use the services table, tickets the events table (§1 row 11), both already seeded as
  copies of the product tiers. The base is the server's price (agreed price, stay total, unit price × quantity), which
  must equal what was paid less the processing charge. The lifetime cap counts booking sales and order snapshots
  together (`fees.charged_to_date`), read after the business's Pending account is locked.
- **B3 Journals.** `booking-pay-<session reference>`, `booking-release-<sale>`, `booking-refund-<sale>-<source>`; the
  nightly reconciliation expects `booking-pay-` for the three kinds when the session is marked `metadata["ledger"]`.
- **B4 Handed over (§4.2).** (Since 7F-C Task 3 a scan releases nothing; a cancelled event's tickets are refunded in
  full, Tasks 1-2.) A service the business marked done; a stay checked in; tickets once one of the purchase is
  scanned or the event's date has passed. Receipt is confirmed by Support on the call, or by a ticket scanned at the
  door. Provisional, owner to confirm (gate (lvii)): for bookings the 72-hour window runs from hand-over, not from purchase as §4.1 says for products.
- **B5 Release and disputes.** As products: Support's "matches" releases at once; "does not match" opens a dispute
  logged the disputes way (`raised_by` null, `logged_by` the staff member), linked on the sale, which alone blocks
  release.
- **B6 Ticket escrow flags.** With the ledger on, a ticket's held/released flag follows its sale: a scan no longer
  releases it (nor does it with the ledger off: legacy tickets wait for Accounting, 7F-C Task 3), release releases the purchase's tickets, the manual release and hold answer `409 ledger_on`, and the
  Accountant's ticket refund pays the ticket's price to the wallet.
- **B7 Paying.** The three pay endpoints take `payment_method` and carry "payment processing" on MoMo while the ledger is
  on, like order checkout; a wallet must cover the whole booking. Tickets for customer-organised events stay outside the
  ledger (gate (liv)).
- **B8 Refunds and cancellations.** To the wallet only; before release out of Pending, after release out of Available
  with the fee back in proportion; the processing charge only on fault. The refund that empties a sale reverses it and
  cancels a booking not yet handed over. A customer's cancel of a paid stay before check-in, and Support's cancel of any
  booking not yet handed over, refund it whole. No-shows are not handled (gate (lv)).
- **B9 Lock order.** Service request or stay row (tickets: the purchase's tickets in primary-key order), then the sale,
  then accounts in one sorted pass; the hand-over steps lock their own row.
- **B10 Price check.** A service request's price must be above GH₵ 0.00 with at most two decimals.

### Before LEDGER_ENABLED is turned on — Stage 1b additions

- (liv) **Customer-organised paid events are outside the ledger.** Tickets for an event a customer (not a business)
  submitted are paid by MoMo only and never recorded; only the old ticket escrow flags track their money. Decide before
  switch-on: require paid-event organisers to register as a business, or refuse paid ticket types on customer-submitted
  events.
- (lv) **No-shows are not handled.** A stay whose guest never checks in, a service the business never marks done, and
  tickets for an event that never took place (its date passes, so it counts as handed over) keep their money in Pending
  until Support cancels or records the call. Owner to decide a rule.
- (lvi) **Support calls every ticket purchase** before release, even when a ticket was scanned at the door; at a large
  event that is many calls. Owner question: should a scan release without a call? A door scan is forgeable by the organiser (the paid business holds the ticket codes), so a scan
  shown as `customer_confirmed: true` in Support's queue must not invite a "matches" without reaching the customer.
  Related: ticket hand-over follows the live, organiser-editable `Event.event_date` (`EventOwnerUpdateView`), so moving
  the date drops or adds purchases to Support's queue. Owner question: refuse date edits on events that have ledger sales?
- (lvii) **DECIDED 2026-10-18: bookings release on their own milestone (§4.2), not on a 72-hour window.** Original text, superseded: **The 72-hour window for bookings runs from hand-over,** not from purchase, because a booking can be paid weeks
  before it happens. Owner to confirm.
- (lviii) **Cancellation policy.** A customer's cancel of a paid stay before check-in and Support's cancel of a booking
  not yet handed over refund it in full, with no deadline or fee (the processing charge stays with the provider). Owner
  to decide.
- (lix) **A service request paid twice** (two Hubtel checkouts started for one accepted request, both paid; or a Hubtel
  checkout and a wallet payment on the same request) records only the first; the second is never recorded (no sale, no
  journal; the provider holds the money, or the wallet was debited) and the reconciliation reports a Hubtel one
  `missing_in_ledger`. Refuse a second checkout or payment while one is open, or refund the duplicate, before switch-on.
- (lx) **Booking finalizers share the webhook failure mode (i)/(vii):** a finalizer that raises (a paid amount that is not
  the price) leaves a paid booking unrecorded with `processed=False`.
- (lxi) **Reports.** `billing.TransactionReportView` (ix) also counts wallet-paid bookings as cash, and
  `insights/sales.refunds_total` does not count `BookingRefund`. Ticket refunds still write their old REFUNDED
  `billing.Transaction` as well; do not count them twice when (ix) is fixed. Whole refunds through a dispute, and the
  last-ticket refund that empties a purchase, mark tickets refunded without per-ticket REFUNDED `Transaction` rows
  (reporting only).
- (lxii) **Stale copy with the ledger on:** `events.views.EscrowSummaryView` `not_recorded` ("Order and booking money is
  not held in escrow yet", "No release-after-delivery rule is built") and the ticket escrow screen, whose flags now
  follow the booking sale. Branch them on `LEDGER_ENABLED`.
- (lxiii) **Booking disputes logged by hand** (not through the verification call) are not linked to the sale and do not
  block its release; customers raise disputes only on orders. The mismatch dispute neither notifies the customer nor
  tasks anyone ((v)), and a dispute's wallet refund sends no notice ((xvi)). The dispute rows carry no booking link
  (`order` and `raised_by` are null; only the description names the booking), so the disputes screens cannot open the
  booking or the customer.
- (lxiv) **Frontend (Plan 1F):** Support's booking queue, the call and the cancel; `payment_method` and
  `payment_processing` on the three pay screens; the accept screen must show the price error.
- (lxv) **The ticket purchase's 201 is still a list,** so it carries no `payment_processing`; the screen must quote the
  charge first (`GET /api/wallet/processing/?amount=`).
- (lxvi) **A Hubtel success webhook for a stay the customer cancelled while its checkout was open is never recorded or
  refunded.** The customer may cancel a PENDING booking; if they then pay at Hubtel, `_finalize_booking` returns early
  (the booking is no longer PENDING), so the money is collected with no `BookingSale`, no journal and no refund (the
  reconciliation reports `missing_in_ledger` once a statement exists). Before Plan 7: refuse the customer's cancel of a
  PENDING booking whose checkout session is still PENDING, or have `_finalize_booking` record such a payment and refund it
  whole to the wallet. Fix beside (xi), its order twin.
- (lxvii) **The `ServicesPanel` shows a generic error for the new price validation.** `ServiceRequestRespondView` now
  answers 400 `{"price": "Enter a price in GH₵ above 0.00, like 150.00."}`, but the frontend does not surface the
  `price` error. This ships as soon as Plan 1b merges, with the ledger on or off: surface it before merging.
  *Surfaced by plan 4F Task 12: `ServicesPanel` shows the server's `price` message.*
- (lxviii) **The switch-on runbook must drain open Hubtel sessions.** A service, stay or ticket session started while
  the ledger was off carries no charge and no `metadata["ledger"]` mark; if it is paid after switch-on its finalizer
  records it at the full price with no processing charge, and reconciliation skips it. Let every open session resolve
  or expire before turning the switch on.
- (lxix) **A price near GH₵ 99,999,999.99 plus the processing charge overflows `CheckoutSession.amount`
  (`max_digits=10`) and answers 500.** `clean_price` allows 8 integer digits. The same overflow applies to a stay's
  `total_price` (12 digits) and to a ticket purchase (price × quantity). Cap those prices (or widen the column) so the
  amount with its charge always fits.
- (lxx) **The Hubtel checkout call is made while the service request row is locked** (`ServiceRequestPayView` holds
  `select_for_update` across `booking_pay.pay`), like the order and top-up flows ((xx)): a slow Hubtel call holds
  the row. Plan 7.
- (lxxi) **Ticket `quantity_sold` is not restored when tickets are cancelled or refunded,** so those seats cannot be
  sold again (Support's cancel, the Accountant's per-ticket refund and a whole refund all leave it). Owner to decide
  whether a refunded seat goes back on sale.
- (lxxii) **SA4: a customer's stay cancel has no date bound.** It is refused only after check-in, so a guest who stayed
  but whose owner never tapped check-in can cancel after check-out and take the refund from the business's Pending.
  Owner to decide a cut-off (for example the check-in date), or have Support's cancel be the only path then.
  Update (7E, 7G): the customer cancel is now bounded by the release milestone, and the 7G screens offer it only while
  the server says `can_cancel`; the check-in-date cut-off question above is otherwise unchanged.
- (lxxiii) **Nothing lists sales not yet handed over.** `POST bookings/<sale id>/cancel/` takes a sale id, but Support's
  queue shows only handed-over bookings. Plan 1F needs a lookup (by customer, business or booking) before the cancel
  screen can find a sale.
- (lxxiv) **No dispute path after release.** Once a booking's money is released a mismatch can no longer be logged
  through the call (`record_verification` refuses), and customers raise disputes only on orders. Owner to decide how a
  complaint after release is handled and recovered from the business's Available.
  Update (7G): the customer screens send a released booking's complaint to Contact AshantiHub Support; recovery from
  the business's Available is still open.
- (lxxv) **Cross-reference to (lxvi):** a Hubtel success for a cancelled PENDING booking is not recorded; the fix there
  covers it.
- (lxxvi) **Wallet-paid services, stays and tickets are also excluded from Collections.** The
  `insights/accounting.py` `WALLET_NOT_RECORDED` note is now titled "Paid from a wallet" and says so, and
  `_wallet_in_use`'s docstring names them. Done in Plan 1b; kept here so the Collections screen copy is checked.
- (lxxvii) **`ServicesPanel.jsx` (about lines 77-78) sends the raw number input** as the quote price. The always-on price
  check (gate (lxvii)) answers 400 `price`, which the panel shows as a generic error: the frontend must surface it
  before this ships to production. *Surfaced by plan 4F Task 12 (the same change closes (lxvii)).*

### Stage 4 (vendor dashboard and texts, backend) reconciliation (2026-10-16)

Found while writing `docs/superpowers/plans/2026-10-16-vendor-side-sms-4.md` (§0 there; its V1–V16):

- **V1 Sections.** The vendor dashboard and texts are §6; §9 contributes its SMS-spend alert.
- **V2 Where it lives.** `wallets/vendor.py` (read model), `wallets/vendor_texts.py` (text outbox), `/api/wallet/vendor/`;
  `wallets.VendorText` and `wallets.VendorPreference`. Hooks: `orders.alerts` (paid) and `escrow.release_verified` (release).
- **V3 Figures.** Sale rows from the business's own fee snapshots and owed promo; the daily summary from journal lines on
  its own Pending and Available; balances from the accounts. Never today's fee rules.
- **V4 Status.** `awaiting_call` (labelled waiting for delivery or collection, waiting for Support's call, or on hold while
  a dispute is open or a delivery-case refund waits for approval), `released`, `refunded`; the export says Pending /
  Available / Refunded and Withdrawn / in progress / Returned for withdrawals.
- **V5-V6 Privacy and who sees fees.** No customer name, phone or address in any vendor row, summary, export or text; the
  export has no free text. Fees are shown to business owners only (a customer, whatever their id, and staff get 403).
- **V7-V9 Texts.** One per paid order and business, per release and business, per digest day; queued inside the money
  transaction (never raises), sent after commit through `otp.senders`, leased, tried at most 5 times (retries after 5 min,
  15 min, 1 h, 4 h), `no_phone` when the login phone is not a confirmed Ghana mobile (`otp.VerifiedContact`). Never an
  `OtpEvent` (the code send limits count those); counted by the `otp.spend` alert, which now watches all SMS spend and
  gives the code count and the business-text count separately. GSM-7 plain text with "GHS", at most 306 characters. No
  throttle or quiet hours.
- **V10 In-app copy.** The paid order's "New order" notice carries the fee and amount due; release and digest copies are
  `vendor_money` notices. Kept when a text fails.
- **V11 Digest.** Opt-in per business, 07:00 Accra for the day before, only when money moved.
- **V12, V15 Not built.** No low-balance, negative-Available, refund or withdrawal text (the spec names none); no staff
  outbox screen; Plan 1b's booking sales are in the balances and the fee cap but not in the sale rows, statement, daily
  columns or texts (gate (lxxxiii)).
- **V13 Fee transparency.** Approved tiers in force and the next approved change with its start (never a waiting
  proposal), `charged` true for products, services and events (Plan 1b charges booking sales), the fee base explained,
  the cap used and left (booking fees included, `fees.charged_to_date`), a server quote.
- **V14 Export.** A synchronous CSV of sales and withdrawals, at most 366 days, no free text.
- **V16 Ledger off.** Every vendor endpoint answers `409 ledger_off`; nothing is texted; the digest job is a no-op.

### Before LEDGER_ENABLED is turned on — Stage 4 additions

- (lxxviii) **Business texts need a real SMS provider.** They go through `otp.senders` (`OTP_SMS_PROVIDER`): with
  `simulated` nothing is sent and the texts screen says "Not sent: texts are simulated"; the Hubtel SMS client is
  unverified (the OTP gate items apply).
- (lxxix) **Text cost and the spend alert.** Every paid order texts each business in it, and every release texts it
  again (two texts per business per order, plus opted-in digests). The daily SMS-spend alert (`otp_sms_daily_alert`,
  default 500) now counts these with the code texts; set it from the expected order volume. Nothing is ever blocked. The
  alert fires once a day: on a day business texts reach the threshold first, a later surge of code requests raises no second
  alert. Before switch-on, decide a separate code-only threshold (or a second alert) for §9's abuse signal. A two-part text
  (a promo, or a release with a promo, up to 306 characters) counts as one text in the alert; count parts if cost matters.
- (lxxx) **Sender ID and content.** Hubtel needs an Approved Sender ID; confirm whether transactional texts need
  template approval with the networks.
- (lxxxi) **DECIDED 2026-10-18:** businesses are texted on refunds, a negative Available, withdrawals (requested, paid, failed) and a low balance (Available at or below the governed `vendor_low_balance_pesewas`, default GH₵ 100); at most one balance text per kind per day. Built by plan 7D Task 3 (setting in plan 7A Task 1). Original text, superseded: **Owner question: texts on refunds, a negative Available, withdrawals, or a low balance.** The spec names none,
  so none is sent (3b's in-app withdrawal notices stay).
- (lxxxii) **Businesses whose login phone is not a confirmed Ghana mobile get no texts** (`no_phone`, in-app copy kept, the
  texts screen says why). A phone is confirmed when a code sent to it was accepted (`otp.VerifiedContact`). This is stricter than
  today's lock notices, which text every contact on the account (the open must-fix above: lock notices should be
  VerifiedContact-only too); registration neither normalises nor verifies phones, so a business that never signed in with a
  code gets none. There is no staff list of them yet; Support should check before switch-on.
- (lxxxiii) **The vendor money screens do not show booking sales yet: fix before the ledger is on.** Plan 1b records
  service, stay and ticket sales (`ledger.BookingSale`), so from the day the ledger is on a booking's money sits in the
  business's Pending and then Available, and its fee counts toward the lifetime cap (`fees.charged_to_date`), and the fee
  page marks services and events `charged`. But the vendor sale rows, the overview's `awaiting_call` count, the
  statement export and the paid / release texts come from `OrderFeeSnapshot` only, and the `booking_payment`,
  `booking_release` and `booking_refund` journal lines land in the daily summary's `other` column. So Pending and
  Available include money the business cannot find in any row, and a booking sale is never texted. A follow-up (Plan 4F
  or a Plan 4b) must add `BookingSale` as a second row source (`kind: "booking"`) to `vendor.sale_groups` / `rows` /
  `statement` and the `awaiting_call` count, the three booking kinds to `vendor.FOLD`, and booking paid / release texts
  to `vendor_texts`, before `LEDGER_ENABLED` is turned on.
  *Closed by plan 4F Tasks 1, 2 and 4: booking rows (`vendor/bookings/`), the overview's `awaiting_call` count, the three
  booking `FOLD` kinds in the daily summary and one statement row per booking sale, and booking paid / released / on-hold
  texts (`vendor_texts.booking_paid`, `booking_released`, `booking_on_hold`, called from `ledger.sales`; reference and
  amounts only, no customer detail). The screens that show them are built (see (lxxxv)).*
- (lxxxiv) **Retention.** `VendorText` rows (amounts and order numbers only) are kept indefinitely; decide a purge beside
  `otp.retention`.
- (lxxxv) **Frontend (Plan 4F):** the overview with the cap meter, sales with filters, the daily summary, the export,
  the fee page and the texts settings. *Built by plan 4F (ledger still off): the owner-only `components/dashboard/money/`
  folder inside 3F's single Money tab, with Payouts as a sub-tab, held by `MoneyNoInventionSweep.test.jsx`. The manual
  checks at 360, 768 and 1280 px and the live-backend walkthrough are owed to the staging smoke before the switch.*
- (lxxxvi) **At-least-once texts.** A worker that dies between the claim and the provider's answer leaves the text to be
  tried again after 10 minutes; with a real provider the business may get it twice.
- (lxxxvii) **DECIDED 2026-10-18:** a suspended business gets no money texts: its queued texts are dropped (never sent, not backfilled when it is reinstated); in-app notices are kept. Built by plan 7D Task 3. Original text, superseded: **Owner question: a suspended business still gets money texts** (its money still moves).
- (lxxxviii) **DECIDED 2026-10-18:** the digest loop is batched (`digest_batch_size`, default 200) with a time budget (`digest_time_budget_seconds`, default 600), resuming from a cursor, and a catch-up job at 10:00 Accra sends a missed 07:00 run (which also resolves (lxxxix)); suspended businesses are skipped. Built by plan 7D Task 4 (settings in plan 7A Task 1). Original text, superseded: **Owner question: the digest loop has no cap or time budget.** `queue_digests` visits every opted-in business in
  one run, one at a time; at a large number of opted-in businesses the 07:00 run could take long. Decide a batch size or
  a time budget before switch-on.
- (lxxxix) **DECIDED 2026-10-18:** digest batching, a time budget and a catch-up of a missed run (built by plan 7D Task 4, with (lxxxviii)). Original text, superseded: **A missed 07:00 run is not caught up.** The job digests "yesterday" only; if the worker or beat is down at
  07:00 that day's digest is never sent (a manual `queue_digests(day)` can send it).
- (xc) **A dedicated `texts` Celery queue and worker before real SMS goes live.** Business texts share the default
  queue with other jobs; a slow provider can hold a worker for up to the send budget (75 s) per run. A circuit breaker
  (3 failures in a row opens it for 120 s, across workers) and the beat entry's 280 s expiry limit the harm, but route
  `wallets.tasks.send_vendor_text` and `send_due_vendor_texts` to their own queue and worker first.
- (cxxiv) **Ruling R2 (owner, round 3 follow-up): AshantiHub-funded free-delivery promos.** Marketing creates them (new
  permission `delivery_promo.fund`, held by Marketing and Super Admin); every one needs approval from Operations or a Super
  Admin through the approvals engine (kind `marketing.delivery_promo_funding`, pool permission `delivery_promo.approve`
  seeded to `operations` and `super_admin`, chain pool then Super Admin, password again to approve); the maker never
  approves their own, a Super Admin's own applies at once, and there is no threshold shortcut. A required budget cap
  bounds the spend: `live_waivers` stops waiving once the owed charges reach the cap (derived, not a status change). The
  cap was SOFT here (an unlocked count of OWED charges, so concurrent checkouts could overshoot it by about one fee each,
  and the last order waived a full fee even when less of the cap was left); **it is HARD since gate (cxxxi)(5)**. A promo covers one named business's items.
  Coupons, campaigns, banners and the send policy stay Super Admin only; the owner-submitted promo review by
  `site_promo.manage` staff is business-funded only. Also: a blocked business (KYC not verified) answers 403 on the platform
  endpoint, as `create_for_staff` does (not 400); spend counts OWED charges only; a cap above the co-sign threshold
  (`approvals/rules.py`) on a staged request needs two approvals (approver plus co-signer), as any large request does;
  and Marketing, who lacks `users.view`, finds a business through a read-only search endpoint gated by
  `delivery_promo.fund` that returns the business id and name only (`delivery-promos/business-search/`). Built by plan 7F-E
  Tasks 4-5; closes (xciii)(c).

- (cxxv) **Ruling R1 (owner, round 3): a refund never gives back more than the customer paid (plan 7F-E Task 1).** When a
  coupon leaves the customer less than the delivery fee, a partial refund is capped so the held fee is never taken from the
  customer's credit: `refunds.Left.partial = max(0, N - done.customer - fee_held)`, shared by `refund_order` and `check`, and a scoped
  refund with no amount takes the smaller of the shop items and `partial`. Reconciliation with 7F-D: **stays** (7D ruling 5,
  (xciii)): when the customer paid less than the fee kept (N < kept), a whole refund gives the customer's credit 0, the rider
  is still paid in full, and AshantiHub covers the gap from the promo subsidy (`_post` credits `subsidy - shortfall`);
  **changes**: (a) a partial or scoped refund can no longer hand back customer money the fee needs; (b) the fee is reserved
  from the first refund, before any pickup exists; (c) processing money is no longer eaten by the kept fee; (d) the staff
  "can still be refunded" figure is the real credit. In the data, `OrderRefund.amount_pesewas` is now the real credit and never
  includes the kept fee, so `wallet_pesewas = amount_pesewas + processing_pesewas`, and the old floor at 0 and the `unfunded`
  figure are gone. `OrderRefund.subsidy_pesewas` still records the whole coupon share closed off (so
  `left()` reaches 0). Staff see "can still be refunded" (`refundable`) on the dispute and the order screen. Known limits:
  `OrderRefund` rows written under the old rule (staging test data only) read `wallet_pesewas` too high by the kept fee;
  when the order total N is at or below the fee F after a pickup, `refundable` is 0 and every door refuses an amount of 0, so
  dispute resolution (unscoped only) and the delivery-case refund ask for that whole refund with an explicit `whole_refund`
  flag and no amount (7F-E fix wave: `refunds.whole_at_zero_refusal` / `check_whole`; ledger on, payment recorded, not already
  refunded whole, `refundable` 0; the approval re-checks at apply). It runs `refund_order(order, None)`: the rider is paid in
  full, the vendor's money, the Delivery payable and the subsidy (D - (F - N)) are reversed, the customer's credit is 0
  (`Dispute.refund_amount` 0.00) and the order is cancelled. The dispute payload's `order_whole_refund_at_zero` drives a
  checkbox in the staff DisputesPanel; the delivery-case screen now has the control (built by 5F Task 8: the whole-refund checkbox, "Can still be refunded", the kept fee and who funded a free delivery).
- (cxxvi) **CLOSED (xciii-open): one canonical lock order (plan 7F-E Task 2).** `orders/locks.py` holds it: the approval or
  dispute row, the Order row, its OrderFeeSnapshot rows (by pk), its DeliveryAssignment row, the order's open Redelivery row
  (level 4b, Task 7), the PickupStop rows, the Rider row (`of=("self",)`), every ledger Account in one sorted pass
  (`posting.lock`), then the activity-chain lock. A DeliveryAssignment row is locked only through `lock_assignment` (needs the
  order from `lock_order`, else `LockOrderError`) or `lock_job` / `lock_job_or_404`; `ledger/tests/test_lock_order.py` fails if
  any other module locks the assignment, and holds the three race tests (rider pickup, legacy dispatch pickup, re-assign
  against a whole refund). Note: `delivery.dispatching.Offer` rows are not named in the order (a pre-existing theoretical
  Offer-to-Order cycle; `accept_offer` and `force_assign` call `lock_order`).
- (cxxvii) **Support's cancel keeps the pickup evidence (plan 7F-E Task 3).** After a pickup, `orders.support._cancel` keeps
  the assignment row (status FAILED, `order_cancelled`, `failed_at`) so the rider is still paid and the fee is not returned;
  with no pickup the row is deleted as before. The DeliveryEvent step for the note is `CANT_DELIVER` ("Order cancelled by
  Support after pickup"), since no cancel step exists and a new one needs a choices migration. `_cancel` locks the order, the fee
  snapshots, then the assignment (gate (cxxvi)).
- (cxxviii) **Ruling R3 (owner, round 3): re-assignment (plan 7F-E Task 6).** A re-assignment is a job that is accepted or
  further along, or has failed, and is given to a different rider; a swap of a still-`assigned` job is ordinary dispatch.
  A re-assigned delivery is done by AshantiHub's own riders only (409 `redelivery_in_house_only`: "A re-assigned delivery is
  done by AshantiHub's own riders."), enforced in `assign`, in the dispatch ranking (reason "Re-assigned: AshantiHub's own
  riders only") and in a manager's manual offer. The 7F-D pickup rule is refined (see its Global Constraints): it is evaluated
  on the current leg. A pickup counts only when `collected_by` / `picked_up_by` is the assignment's current rider, or is null on
  rows older than this change; every reset of the job clears `picked_up_at` / `picked_up_by` and the reopened stops'
  `collected_at` / `collected_by` (history stays in the append-only `DeliveryEvent` rows). So a refund after re-assignment and
  before the new rider's pickup returns the fee to the customer; after the new rider's pickup the fee is kept as platform income
  (the rider is in-house); completion pays the current rider; the first rider gets nothing. A failed job given again to the
  same rider is allowed and starts a new leg. `Rider.employment` is read without a rider lock in `assign` (a rider lock there
  would invert gate (cxxvi); release pays the completer anyway), so an employment switch racing an assign could let a
  third-party rider through, and the money gate at release still holds. Owner awareness: the in-house-only rule is not a
  money rule and is not behind `LEDGER_ENABLED`, so it applies in production on deploy even with the ledger off: a failed or
  accepted job cannot be given to a third-party rider, and if no in-house rider is on shift the job stalls. Mid-route swap: stops the first rider collected stay
  done and count for no one; if the second rider skips all the rest, the pickup stamp names the earlier stop's collector, not
  the manager who skipped; a null stamp (older row) counts for whoever is on the job, which matters only for an in-flight swap
  during the deploy.
- (cxxix) **Ruling R4 (owner, round 3): re-delivery at the customer's request (plan 7F-E Task 7).** A `Redelivery` row (one
  open request per order; statuses `awaiting_payment`, `paid`, `assigned`, `completed`, `cancelled`, `refunded`) is opened by
  staff holding `orders.redeliver` (Support, Pickup Desk, Super Admin). "Customer not available" is case (b):
  `CUSTOMER_UNAVAILABLE_REASONS = ("no_answer",)` with `arrived_drop_at` set; any other failure reason is case (a), where the
  first trip's fee is handled by the pickup rule. In case (b) the first rider keeps the original fee: the payee is
  `Redelivery.first_rider` tested at `first_leg_ended_at`, the fee is earned once a request exists, an in-house first rider
  leaves it as platform income, and a third-party first rider is paid once at release or at a whole refund's settle. The
  re-delivery fee is paid by the customer, from the wallet or by mobile money (the provider's processing charge goes on top
  via `booking_pay.pay`), in the Account `redelivery_payable` (per order); the fee is not in `Order.total_amount`, so R1 and
  `refunds.left` are untouched. The second rider is in-house and has no wallet: the fee is booked to platform delivery income
  at completion and the amount owed to that rider for payroll outside the app is recorded on the `Redelivery` row (rider, fee,
  completed time); the payroll screens now list the fees owed to in-house riders (built by 5F Tasks 9 and 11). Refunds: a whole refund before the second rider's pickup returns the fee,
  after it settles it; partial refunds never touch it; cancel is allowed while awaiting payment and while paid but not
  assigned (a paid fee returns to the customer's wallet) and refused once assigned (409 `redelivery_not_cancellable`); a second
  trip that fails after the rider collected the goods settles the fee and marks the request completed, so an attempt 2 can be
  opened (the customer pays again); a GH₵ 0.00 fee marks the request paid at once with no journal; a payment arriving for a
  request no longer waiting is credited to the customer's wallet (journal `redelivery-stray-<ref>`). Journals: pay, settle,
  refund, stray; reconciliation reads the session's `metadata.journal_key`. Errors: 409 `not_redeliverable`, `redelivery_open`,
  `redelivery_fee_unpaid`, `redelivery_in_house_only`, `redelivery_not_cancellable`, `nothing_to_pay`, `ledger_off`. With the
  ledger off the POST endpoints answer 409 `ledger_off`, the list answers empty, and `assign` is unchanged; the assign gate
  applies only to orders paid through the ledger (`redelivery.ledger_paid`) or with an open request, so orders paid before the
  ledger was on are never held. The Super Admin holds `orders.redeliver` but has API access only (the Support panel is for the
  `support` role). Lock order gains level 4b (gate (cxxvi)). Known limits: repeated mobile-money clicks open new sessions (a late
  duplicate is credited to the wallet); a shop-scoped refund that refunds every item does not close a paid request.
- (cxxx) **Ruling R5 (owner, round 3): the re-delivery fee is a governed setting (plan 7F-E Task 7).**
  `redelivery_fee_pesewas`, default 1500 (GH₵ 15.00, **a placeholder to be confirmed by the owner**), bounds 0 to 20000, changed
  by Super Admin with sudo, and copied onto the request when it is opened so a later change never reprices an open one. It is
  not on the `RateCard` and works while `DELIVERY_FEE_ENABLED` is off. Listed in §3.3. Who changes it: see gate (cxxxi)(1).
- (cxxxi) **Director rulings (2026-10-20), branch `fix/director-rulings-1`.** The owner delegated these decisions.
  (1) The re-delivery fee is changed by Operations as well as the Super Admin: permission `redelivery_fee.manage`
  (Operations, Super Admin) and approval kind `ledger.redelivery_fee` (same payload, checks, apply and audit as
  `ledger.setting`; pool `redelivery_fee.manage`, chain pool then Super Admin, sudo to approve, never the maker; a Super
  Admin's own applies at once). Every change of that one key goes through this kind, whoever proposes it; an Operations
  lead reads only that setting on `GET /api/ledger/settings/` and gets 403 for any other key. Operations has a "Re-delivery
  fee" screen under Settings. Default GH₵ 15.00, bounds GH₵ 0 to 200, unchanged.
  (2) A re-assigned delivery (gate (cxxviii)) goes to AshantiHub's own riders while one is available
  (`delivery.dispatching.in_house_available`: on shift, not on a break, fresh fix, no job hold, not suspended, under the
  active-job limit, papers valid, under the cash cap, not declined on the order, within the pickup radius, the radius
  skipped when the pickup has no pin); when none is, a third-party rider may take it. The fallback is noted on the
  "assigned" `DeliveryEvent` and recorded as activity `delivery.reassigned_third_party` (after commit); the ranking reports
  `third_party_fallback` and the dispatch queue says so. The rider who completes the trip is paid (release pays the
  current rider; the first leg counts for no one). This closes the stall noted in (cxxviii). The second trip of a paid
  re-delivery at the customer's request (gate (cxxix)) follows the same rule (in-house first, a third-party fallback
  only when none is available, logged the same way), and its fee goes to the rider who completes that trip: an in-house
  rider through payroll (the Redelivery row; `owed_through_payroll`, `paid_through: "payroll"`), a third-party rider
  through the wallet, posted in the settle's transaction as `redelivery-rider-<id>` (kind `rider_redelivery_earning`:
  Dr platform delivery income / Cr Rider balance net + Cr Rider reserve at the `rider_commission_bp` in force when the
  customer paid the fee) with a `RiderEarning` whose `redelivery` is set (`order` null; exactly one of the two, a check
  constraint), which the end-of-day commission job posts like a delivery earning. Paid when the trip is done (delivered,
  failed after the pickup, or a whole refund after that pickup), not at the order's release: the fee is outside the
  order's escrow. Never twice (one earning per re-delivery, journal idempotent on its key), never both wallet and payroll,
  and the first rider's original-fee earning (`RiderEarning.order`) is separate. A whole refund locks the second-trip
  rider's row before the original fee rider's.
  (3) "Customer not available" (gate (cxxix)) is `CUSTOMER_UNAVAILABLE_REASONS = ("no_answer", "refused")`, both with
  `arrived_drop_at` set: a refusal reported before the rider reached the address is still a plain re-assignment.
  (4) Support may set any business's opening hours (permission `businesses.set_hours`, Support and Super Admin; same staff
  endpoint and rules, recorded as `business.hours_set`), from the Support business profile. Send now
  (`delivery/orders/<id>/send-early/`) takes `orders.manage_delivery` as well as `delivery.manage`; the reason stays
  required and recorded (`delivery.early_send`). The Scheduled list is in the Super Admin (Marketplace) and Operations
  (Service) menus.
  (5) The budget cap of an AshantiHub-funded free-delivery promo is HARD: checkout decides the waiver under the promo's row
  lock (`waivers.covering_waiver(..., fee=, lock=True)`, waivers in id order after the listing locks), counting the owed
  charges after the lock, and waives a fee only when it fits in what is left (else the customer pays the fee). The cart
  quote applies the same fit without a lock. Covered by `marketing/tests/test_platform_waivers.PlatformCapRaceTests`
  (threaded, run on its own).

### Before LEDGER_ENABLED / SUBSCRIPTIONS_ENABLED change — Plan 1F (fees, verification, pickup screens)

- **DONE 2026-10-28, Frontend screens (Plan 1F, built; both switches unchanged):** the Pickup Desk's overview is the desk (`PickupDeskPanel`, also the Super Admin's `pickup-desk` item), Support's `VerificationCallsPanel` (orders, bookings and a Cancel a booking tab, with `CallOutcomeForm`), the Super Admin's Verification calls and Pickup desk items after Scheduled orders, the Accountant's Money rules under More tools, the registration "business type" step, the dashboard with no plan UI when no plan is offered, and the pay screens (service, tickets, stay) through `useBookingPayment` with the server's processing charge. Query-key roots `ledger-verification`, `ledger-pickup`, `stay-quote`.
- **Built gates and items:** (b) hero days; (f) registration uses `POST /api/billing/business-kind/`; gate (ii) (paginated queues, desk lists only ledger-recorded orders); gate (viii), screens (checkout, the customer's order, the business's order card say store pickup is collected at the AshantiHub office); (lxii) the Accountant's ticket screen follows the ledger; (lxiv) and (lxxiii) Support's booking queue, call and cancel; (lxv) the ticket purchase quotes the processing charge; (lxvii)/(lxxvii) the accept screen shows the server's price error and sends a decimal string; (xxxii) built: `PayoutDetailUpdateView` forces the payout step-up while the ledger is on (commit a6e70cb6), checked in Task 9 Step 6 now that 2F is merged.
- **Director rulings recorded as built here:** 4 (homepage-banner days for a business with no plan = 7, maximum still 30), 5 (a one-time collection code; the office address is a Super Admin setting, "address to be confirmed" while blank, never invented) and 8 (Verification calls and Pickup desk in the Super Admin's Marketplace group).
- **Facts of the collection code (Task 2):** made at payment, checked with `compare_digest`; the fifth wrong code answers 423 `code_locked` and tells Support once; a second collect of a collected order answers 409 "already collected"; the customer's order view shows the pickup note only when the server sent a `collection_code`; it is in no staff payload and no log. The Accountant reaches Money rules under More tools.
- **Still open (backend, must be done before `SUBSCRIPTIONS_ENABLED` is turned off):** (a) the overdue clock with the switch off, (c) the "No subscription." moderation check, (d) paused businesses staying hidden, (e) drafts before `business_kind`.
- **Not in 1F:** gate (lxxxiii) booking sales on the vendor money screens and their texts (Plan 4F Tasks 1, 2 and 4); the 7E customer side (a stay or ticket "Report a problem", the customer's ticket-purchase cancel), which is Plan 7G.
- **Verification run 2026-10-28:** `LedgerScreensSweep.test.jsx` (no `wa.me`, no `tel:` on the desk or the cancel tab, no business phone value, no collection code, no `NaN`/`undefined`, every GH₵ amount inside a `[data-amount]` element, money in tabular figures and never gold). Before the final-review fixes: full Vitest 2849/2851 passed, the 2 failures being load timeouts that pass alone (StaffDashboard analytics and the AdminCommandCenter "reconciliation fraud link gate"), `npm run build` OK, backend (`ledger core listings orders bookings events accounts realtime insights`) Ran 2149 tests, OK. After the final-review fix wave: full Vitest 315 files, 2860/2860 passed; `npm run build` OK; backend `ledger core bookings` Ran 689 tests, OK.
- **Final-review rulings (1F):** the pickup-lock notice to Support links to `support-order-status` (a locked, never-collected order is not on the verification list) and names the order number in its body, never the code; the hand-over door `PickupCollectedView` is deliberately not gated by the ledger flag (it needs the order's code, which only a ledger-paid order has), so only the queue answers `409 ledger_off`; checkout promises a collection code only when the wallet answered "on".
- **Still open (wording):** before `SUBSCRIPTIONS_ENABLED` is turned off, the PaymentsPanel and reminder "renews" wording, which shows when no plans are offered, must change (`SubscriptionPanel` already says "runs until").
- **Owed on staging before the switches are turned on (not performed in 1F):** with `LEDGER_ENABLED=1`, a store-pickup order paid with its code on the customer's order, the desk refusing a wrong code and handing over with the right one, five wrong codes locking it; the address blank ("to be confirmed") then set by a Super Admin; Support's call "Matches" with the password; a booking call; a booking cancel; a service paid by wallet and by MoMo; tickets for a business event and for a customer event; a stay. With `SUBSCRIPTIONS_ENABLED=0`: the business-type step, the dashboard with no plan UI, and an approved hero for a business with no plan running 7 days. Each new staff screen (the Super Admin's two items included) at 360, 768 and 1280 px, and `node scripts/staff-layout-audit.js` (needs a preview build and the API on 8110 with seeded staff).
- **Found while building 1F:** (1) the new staff queues have no nav badge, because the server sends no count for them. (2) Plan 4F Task 12 makes the same `ServicesPanel` `call()` change and creates the same `ServicesPanel.test.jsx`: a merge conflict is expected. (3) The `AdminCommandCenter` "reconciliation fraud link gate" test times out at 5 s on the base commit under load (pre-existing).
