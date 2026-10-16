# Wallets, Escrow, Platform Fees, Stock Offers and OTP Security — Design

**Status:** Approved 2026-10-15. Stage 1 plan: docs/superpowers/plans/2026-10-15-ledger-fees-foundation.md. Stage 2 (OTP, backend) plan: docs/superpowers/plans/2026-10-16-otp-security.md. Stage 3 plans: docs/superpowers/plans/2026-10-16-wallets-payments-3a.md (wallet payments and refunds) and docs/superpowers/plans/2026-10-16-withdrawals-3b.md (payout destinations, withdrawals, reconciliation). Plan 1b (services, events and stays): docs/superpowers/plans/2026-10-16-ledger-services-events-stays-1b.md. Stage 4 (vendor dashboard and texts, backend) plan: docs/superpowers/plans/2026-10-16-vendor-side-sms-4.md.
**Scope:** One system, built in the order given in §11. Stage 1 (ledger) with Plan 1b (services, events and stays),
Stage 2 (OTP, backend), Stage 3 (wallets, payments, refunds, withdrawals and reconciliation, backend) and Stage 4 backend
(the vendor money API and business texts, Plan 4) are implemented behind switches that default off (branches
feature/ledger-stage1, feature/ledger-services-1b, feature/otp-security, feature/wallets and feature/vendor-side-4; see
section 13); later stages are specs only.
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

Same as products: the service is done, the event has taken place or the stay has begun, the customer confirms (or Support records it on the call), and a Support verification call releases the money; a mismatch raises a 72-hour dispute. What counts as "handed over" for each kind (provider marks the service done, event date passed or ticket scanned, check-in) is settled in Plan 1b (§13 B4): the business marks the service done, the guest checks in, a ticket is scanned or
the event's date passes. Plan 1b counts the 72 hours from that hand-over, not from purchase as §4.1 does for products;
that reading is provisional until the owner confirms it (gate (lvii)).

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
  When `ledger/sales.py` lands the test also needs a cross-category case: an order payment and a booking payment for the same business racing the shared lifetime cap.
- (iv) **Legacy vendor-shop store pickups** can never be marked collected once the ledger is on (the desk handles AshantiHub-office pickups), so their money would stay in Pending. A rollout/process decision for the owner.
- (v) **Mismatch dispute.** The dispute created by `verification.record` sets `raised_by=customer` although it is staff-logged (the convention in `disputes/models.py` is `raised_by` null plus `logged_by`), and it neither notifies the customer nor tasks the account managers. Decide before Support uses it at volume.

### Stage 3 carry-forward

- **Done in Stage 3a (W4, W6).** Cancelled paid orders kept their `OrderFeeSnapshot` counted against the lifetime cap
  and their money in Vendor Pending / Delivery payable: Support's cancel and the uncollected-pickup job now refund the
  order whole to the wallet and reverse its snapshots.
- **Done in Stage 3a (W4).** Release paid every unreleased snapshot, so a refund resolution followed by "matches" would
  have paid the vendor in full: refunds now raise each snapshot's refunded base and fee (reversed when whole), release
  pays only what is left, a skipped stop's case refunds that shop's lines only, and release waits while a delivery-case
  refund is pending the Super Admin's approval.
- The money-releasing POST has no password re-check (`RequiresSudo`). Owner question: should it? (Still open.)
- **Done in Stage 3a (W5).** The waived delivery fee never reached the ledger: the business's promo cost is now taken
  from its Available at release and given back on a whole refund.

### Stage 2 (OTP) reconciliation (2026-10-16)

Found while writing the Stage 2 plan (`docs/superpowers/plans/2026-10-16-otp-security.md`, §0):

- **O1 Where it lives.** A new `otp` app; rows name `(account_type, account_id)` because the three account kinds are separate tables. Staff keep their authenticator in `accounts.two_factor`; customers and business owners get `otp.AccountAuthenticator`.
- **O2 Sign-up.** The account row is created first; registration answers a code challenge instead of a token, and the token comes after the code. Customers and vendors who never confirmed a contact confirm once at their next sign-in. For staff the emailed invite link is the check.
- **O3 Policy numbers** (customer gap 30 days, SMS alert 500/day) live on `staffsecurity.SecurityPolicy`, changed by a Super Admin with the password re-entered, not through the money-settings maker-checker.
- **O4 Step-up.** Customers and vendors confirm with a texted or emailed code (an authenticator code is not accepted for step-up); staff keep password re-entry (`RequiresSudo`). Applied now to payout details, adding a recovery email/phone, and authenticator changes. There is no change-password or change-primary-contact endpoint yet; `password_change` and `withdrawal` are defined for when they exist (Stage 3).
- **O5 SMS.** The Hubtel SMS client in `marketing/providers/hubtel_sms.py` (unverified against a live account) is reused through `OTP_SMS_PROVIDER=hubtel`; the default `simulated` sends nothing.
- **O6 Not yet moved.** The customer secondary-contact codes (`accounts.serializers.CustomerSecondary*`) still keep their code in clear and return `demo_code` for SMS; moving them onto the OTP service changes their API and is a follow-up. Until then a secondary phone is never a code channel (`otp.identity.contacts()` ignores it, however `secondary_phone_verified` reads); a verified secondary email still is (its code is emailed).
- **O7 Audit.** OTP events go to `otp.OtpEvent`, not the hash-chained activity log (high volume, customer-side, and the lock and the hourly limits are counted from it). Staff wrong codes also reach the sign-in history; policy changes and staff-assisted recovery also reach the activity log.

### Before the OTP switches are turned on (Plan 2F)

`OTP_SIGNIN_ENFORCED`, `OTP_STEP_UP_ENFORCED` and `OTP_SIGNUP_VERIFICATION_ENFORCED` all default off and must stay off until every item below is done.

- **Frontend screens (Plan 2F):** code entry (a customer or vendor login answers `two_factor_required` + `mfa_token`; the code goes to `/api/otp/sign-in/verify/`, not the staff two-factor URL); a trusted-device checkbox and keeping `device_token` (customers only); step-up prompts (on `step_up_required`, one retry carrying `X-Step-Up-Token`; the step-up endpoints answer `409 otp_off` while no switch asks for a code); 2FA settings for customers and vendors. The code-entry screen must also handle `two_factor_required` answered by `/api/otp/sign-in/verify/` itself (a correct SIGN_UP code does not skip an enabled authenticator) and resend `trust_device` with the authenticator step, handle `409 no_channel` (nothing on file: contact Support) and `400 channel_unavailable` (offer the other way).
- **A real SMS provider:** Hubtel SMS credentials and an Approved Sender ID, then `OTP_SMS_PROVIDER=hubtel` (the default `simulated` sends nothing).
- **Hubtel SMS client unverified:** `marketing/providers/hubtel_sms.py` has never sent through a live account; prove one real OTP text first.
- **Existing accounts with only a foreign phone (or no usable contact):** they get `409 no_channel` and cannot sign in; Support must add an email first (the operational path is not built).
- **Last contact removed by a staff edit is not re-checked:** a profile or staff edit can leave an account with no usable contact; re-validate before enforcing.
- **Owner question, long-horizon guessing:** the 15-minute lock still lets someone holding the password try ~20 wrong codes an hour indefinitely; decide a daily cap before enabling.
- **Owner question:** should an opted-in authenticator be honoured even when `OTP_SIGNIN_ENFORCED` is off?
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
- (xvi) **Owner question: the Accountant's dispute-resolve door can refund an undecided delivery case** when the ledger
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
  customer with no usable contact (`no_channel`) cannot add one. Every must-fix in "Before the OTP
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
- (xxxv) **Owner question: a second approver (maker-checker) for failing a stuck withdrawal by hand** is undecided (plan
  B6). Today `wallets.manage` plus sudo and a password suffice, after the provider is asked.
- (xxxvi) **Amount cases and the staff fail action.** A CONFIRMED amount case is treated like a dismissed one. Staff fail
  is REFUSED (409 `provider_processing`) while the provider says PROCESSING or answers any unmapped status; an
  unreachable provider answers 503 and changes nothing. A payout the provider keeps reporting as PROCESSING, or with a
  different amount, therefore cannot be ended in the app: a maker-checker "settle as paid / fail with provider evidence"
  action is required before switch-on. Owner to confirm.
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
- (li) **Owner question: top-up money can be withdrawn immediately,** so a MoMo collection reversal after a withdrawal
  could cost AshantiHub money. Consider a hold period on newly topped-up funds.
- (lii) **Migrations 0003 and 0004 of `wallets` could be folded into one before any deploy** (nothing is deployed yet;
  the 0003 file is root-owned, so fold it with the right permissions).
- (liii) **Parked:** the daily/per-withdrawal limit check can race with a concurrent proposal and ignores future-dated rows.

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
- **B4 Handed over (§4.2).** A service the business marked done; a stay checked in; tickets once one of the purchase is
  scanned or the event's date has passed. Receipt is confirmed by Support on the call, or by a ticket scanned at the
  door. Provisional, owner to confirm (gate (lvii)): for bookings the 72-hour window runs from hand-over, not from purchase as §4.1 says for products.
- **B5 Release and disputes.** As products: Support's "matches" releases at once; "does not match" opens a dispute
  logged the disputes way (`raised_by` null, `logged_by` the staff member), linked on the sale, which alone blocks
  release.
- **B6 Ticket escrow flags.** With the ledger on, a ticket's held/released flag follows its sale: a scan no longer
  releases it, release releases the purchase's tickets, the manual release and hold answer `409 ledger_on`, and the
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
- (lvii) **The 72-hour window for bookings runs from hand-over,** not from purchase, because a booking can be paid weeks
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
- (lxxiii) **Nothing lists sales not yet handed over.** `POST bookings/<sale id>/cancel/` takes a sale id, but Support's
  queue shows only handed-over bookings. Plan 1F needs a lookup (by customer, business or booking) before the cancel
  screen can find a sale.
- (lxxiv) **No dispute path after release.** Once a booking's money is released a mismatch can no longer be logged
  through the call (`record_verification` refuses), and customers raise disputes only on orders. Owner to decide how a
  complaint after release is handled and recovered from the business's Available.
- (lxxv) **Cross-reference to (lxvi):** a Hubtel success for a cancelled PENDING booking is not recorded; the fix there
  covers it.
- (lxxvi) **Wallet-paid services, stays and tickets are also excluded from Collections.** The
  `insights/accounting.py` `WALLET_NOT_RECORDED` note is now titled "Paid from a wallet" and says so, and
  `_wallet_in_use`'s docstring names them. Done in Plan 1b; kept here so the Collections screen copy is checked.
- (lxxvii) **`ServicesPanel.jsx` (about lines 77-78) sends the raw number input** as the quote price. The always-on price
  check (gate (lxvii)) answers 400 `price`, which the panel shows as a generic error: the frontend must surface it
  before this ships to production.

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
  outbox screen; booking sales (Plan 1b) not yet covered in rows and texts.
- **V13 Fee transparency.** Approved tiers in force and the next approved change with its start (never a waiting
  proposal), `charged` for products (and services and events once `ledger.BookingSale` exists), the fee base explained,
  the cap used and left, a server quote.
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
- (lxxxi) **Owner question: texts on refunds, a negative Available, withdrawals, or a low balance.** The spec names none,
  so none is sent (3b's in-app withdrawal notices stay).
- (lxxxii) **Businesses whose login phone is not a confirmed Ghana mobile get no texts** (`no_phone`, in-app copy kept, the
  texts screen says why). A phone is confirmed when a code sent to it was accepted (`otp.VerifiedContact`). This is stricter than
  today's lock notices, which text every contact on the account (the open must-fix above: lock notices should be
  VerifiedContact-only too); registration neither normalises nor verifies phones, so a business that never signed in with a
  code gets none. There is no staff list of them yet; Support should check before switch-on.
- (lxxxiii) **Booking sales are not covered.** Once Plan 1b records bookings: add them as a second row source
  (`kind: "booking"`) to `vendor.sale_groups` / `rows` / `statement`, their `booking_*` journal kinds to `vendor.FOLD`,
  and booking paid / release texts to `vendor_texts`. (`vendor.charged_categories()` already marks services and events
  charged as soon as `ledger.BookingSale` exists, so the fee page is truthful at once, ahead of the rows.) Until then a booking's
  money is in Pending but not in the sale rows (Pending no longer equals the waiting rows) and lands in the daily
  summary's `other` column. Do it before the ledger is on if Plan 1b ships.
- (lxxxiv) **Retention.** `VendorText` rows (amounts and order numbers only) are kept indefinitely; decide a purge beside
  `otp.retention`.
- (lxxxv) **Frontend (Plan 4F):** the overview with the cap meter, sales with filters, the daily summary, the export,
  the fee page and the texts settings.
- (lxxxvi) **At-least-once texts.** A worker that dies between the claim and the provider's answer leaves the text to be
  tried again after 10 minutes; with a real provider the business may get it twice.
- (lxxxvii) **Owner question: a suspended business still gets money texts** (its money still moves).
- (lxxxviii) **Owner question: the digest loop has no cap or time budget.** `queue_digests` visits every opted-in business in
  one run, one at a time; at a large number of opted-in businesses the 07:00 run could take long. Decide a batch size or
  a time budget before switch-on.
- (lxxxix) **A missed 07:00 run is not caught up.** The job digests "yesterday" only; if the worker or beat is down at
  07:00 that day's digest is never sent (a manual `queue_digests(day)` can send it).
- (xc) **Until Plan 1b merges, the fee page shows services and events as "not charged yet"** (`charged: false`); it
  follows `ledger.BookingSale` on its own once that exists.
- (xci) **A dedicated `texts` Celery queue and worker before real SMS goes live.** Business texts share the default
  queue with other jobs; a slow provider can hold a worker for up to the send budget (75 s) per run. A circuit breaker
  (3 failures in a row opens it for 120 s, across workers) and the beat entry's 280 s expiry limit the harm, but route
  `wallets.tasks.send_vendor_text` and `send_due_vendor_texts` to their own queue and worker first.
