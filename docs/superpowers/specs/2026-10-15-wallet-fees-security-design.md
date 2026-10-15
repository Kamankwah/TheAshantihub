# Wallets, Escrow, Platform Fees, Stock Offers and OTP Security — Design

**Status:** Approved 2026-10-15. Stage 1 plan: docs/superpowers/plans/2026-10-15-ledger-fees-foundation.md.
**Scope:** One system, built in the order given in §11. Stage 1 implemented on branch
feature/ledger-stage1 (see section 13); later stages not started.
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
| Rider balance | Third-party rider | Withdrawable share (90%) |
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
   commission and net recorded. A reversed delivery reverses its share of the reserve.

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
effective time. Super admin may edit directly in an emergency (logged).

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

### 4.2 Services, events and stays (owner decision 2026-10-15)

Same as products: the service is done, the event has taken place or the stay has begun, the customer confirms (or Support records it on the call), and a Support verification call releases the money; a mismatch raises a 72-hour dispute. What counts as "handed over" for each kind (provider marks the service done, event date passed or ticket scanned, check-in) is settled in Plan 1b. The ledger records only product orders until then.

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

Per-delivery earnings shown to the rider; reserve and daily commission per §2.2 and §3.3. Company
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
  the sign-in OTP.
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
- (iv) **Legacy vendor-shop store pickups** can never be marked collected once the ledger is on (the desk handles AshantiHub-office pickups), so their money would stay in Pending. A rollout/process decision for the owner.
- (v) **Mismatch dispute.** The dispute created by `verification.record` sets `raised_by=customer` although it is staff-logged (the convention in `disputes/models.py` is `raised_by` null plus `logged_by`), and it neither notifies the customer nor tasks the account managers. Decide before Support uses it at volume.

### Stage 3 carry-forward

- Cancelled paid orders keep their `OrderFeeSnapshot` counted against the lifetime cap and their money in Vendor Pending / Delivery payable. Stage 3 must reverse them (`OrderFeeSnapshot.reversed_at`) and refund.

- Release pays every unreleased snapshot, so a refund resolution (skipped-stop "refund these lines only", or money-back) followed by "matches" would pay the vendor in full. Stage 3 must reverse those snapshots (`OrderFeeSnapshot.reversed_at`), or release must leave out disputed lines.
- The money-releasing POST has no password re-check (`RequiresSudo`). Owner question: should it?
- The waived delivery fee never reaches the ledger.

### Stage 2 (OTP) reconciliation (2026-10-16)

Found while writing the Stage 2 plan (`docs/superpowers/plans/2026-10-16-otp-security.md`, §0):

- **O1 Where it lives.** A new `otp` app; rows name `(account_type, account_id)` because the three account kinds are separate tables. Staff keep their authenticator in `accounts.two_factor`; customers and business owners get `otp.AccountAuthenticator`.
- **O2 Sign-up.** The account row is created first; registration answers a code challenge instead of a token, and the token comes after the code. Customers and vendors who never confirmed a contact confirm once at their next sign-in. For staff the emailed invite link is the check.
- **O3 Policy numbers** (customer gap 30 days, SMS alert 500/day) live on `staffsecurity.SecurityPolicy`, changed by a Super Admin with the password re-entered, not through the money-settings maker-checker.
- **O4 Step-up.** Customers and vendors confirm with a texted or emailed code (an authenticator code is not accepted for step-up); staff keep password re-entry (`RequiresSudo`). Applied now to payout details, adding a recovery email/phone, and authenticator changes. There is no change-password or change-primary-contact endpoint yet; `password_change` and `withdrawal` are defined for when they exist (Stage 3).
- **O5 SMS.** The Hubtel SMS client in `marketing/providers/hubtel_sms.py` (unverified against a live account) is reused through `OTP_SMS_PROVIDER=hubtel`; the default `simulated` sends nothing.
- **O6 Not yet moved.** The customer secondary-contact codes (`accounts.serializers.CustomerSecondary*`) still keep their code in clear and return `demo_code` for SMS; moving them onto the OTP service changes their API and is a follow-up.
- **O7 Audit.** OTP events go to `otp.OtpEvent`, not the hash-chained activity log (high volume, customer-side, and the lock and the hourly limits are counted from it). Staff wrong codes also reach the sign-in history; policy changes and staff-assisted recovery also reach the activity log.
