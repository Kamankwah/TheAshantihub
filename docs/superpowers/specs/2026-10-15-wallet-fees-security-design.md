# Wallets, Escrow, Platform Fees, Stock Offers and OTP Security — Design

**Status:** Approved 2026-10-15. Stage 1 plan: docs/superpowers/plans/2026-10-15-ledger-fees-foundation.md. Stage 2 (OTP, backend) plan: docs/superpowers/plans/2026-10-16-otp-security.md. Stage 3 plans: docs/superpowers/plans/2026-10-16-wallets-payments-3a.md (wallet payments and refunds) and docs/superpowers/plans/2026-10-16-withdrawals-3b.md (payout destinations, withdrawals, reconciliation). Stage 5 (third-party dispatch, backend) plan: docs/superpowers/plans/2026-10-16-dispatch-wallets-5.md.
**Scope:** One system, built in the order given in §11. Stage 1 (ledger), Stage 2 (OTP, backend), Stage 3 (wallets,
payments, refunds, withdrawals and reconciliation, backend) and Stage 5 (third-party rider wallets and daily commission,
backend) are implemented behind switches that default off (branches feature/ledger-stage1, feature/otp-security,
feature/wallets and feature/dispatch-wallets-5; see section 13); later stages are specs only.
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
  platform delivery income, not from the rider who was paid it. (A rider moved off the Dispatch role is now refused, Task 6.) Rider earnings never touch provider clearing (R13).
- **S5-12 Self-dealing (Task 5 review).** A third-party rider who is also given `wallets.manage` is refused (403
  `own_withdrawal`) when failing their own withdrawal, before the provider is asked and again under the row lock. Owner
  question, same family, not yet closed: a rider holding `fraud.manage` could dismiss or confirm the amount case on their
  own withdrawal (`fraud.views.FraudFlagConfirmView`, `FraudFlagDismissView`), and a rider holding `orders.verify` could
  release their own deliveries (`ledger.views.OrderVerificationView`); consider refusing self-dealing in those views too.
  A Ghana Card with no expiry date does not count as verified (`delivery.employment.id_verified`); rider upload and the
  Delivery Manager's approval now require the expiry date for that paper.

### Before LEDGER_ENABLED is turned on — Stage 5 additions

- (xci) **Frontend (Plan 5F).** The rider app's wallet: the balance; the reserve as "AshantiHub's commission, taken after
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
  Owner question (Task 6): a rider's withdrawal activity events carry the amount and are readable by Operations and line
  managers who lack `wallets.view`; decide whether to log only the reference. Owner question: `staff_row` returns the
  withdrawal's `provider_reference` to every `wallets.view` holder, riders' withdrawals included.
- (xciii) **Owner question: a rider is paid nothing for a delivery whose order is refunded whole,** before release (the fee
  goes back to the customer, W4) or after it (the earning is taken back and the balance may go below zero), even when the
  business was at fault and the rider did the work. The alternative is for AshantiHub to pay the rider from its own
  income in those cases. (See also (c): the same wait applies to an unreachable customer, who never pays the rider.)
  **Failure mode to decide:** after the day's commission was posted, a whole refund takes the commission back out of
  platform commission income; if that account holds less than the reserve (it can, as it is also spent down by other
  refunds), the ledger refuses the posting and with it the whole refund. Either allow the commission-income account
  to go negative for that one posting (`allow_negative`, as the rider's balance does), or gate the refund and tell
  Support. Not built.
- (xciv) **A rider switched back to AshantiHub's own can still owe money later.** The switch is refused while money is
  open, but a whole refund after release of an older third-party delivery still reverses its earning (it works on the
  earning, not on the current flag), leaving a negative balance on a closed wallet with no way to recover it in the app
  (payroll deduction or write-off is a process decision; the rider's account stays listed to `wallets.view` staff, though
  their own read answers `409 wallet_disabled`).
  A third-party rider cannot leave Dispatch or be deactivated while third-party (`employment.block_leaving`, 409
  `third_party_rider`), so deactivation of a rider with money is blocked until they are switched back, and that check
  refuses a switch back while money is open. What remains: a re-role or deactivation done outside that path (a direct
  database change, or a future endpoint that forgets `block_leaving`) would leave the `RiderEmploymentPeriod` open and
  the wallet unreachable, and **suspending** a third-party rider (also a paper-expiry auto-suspension) strands their
  wallet, as a suspended staff member can neither sign in nor withdraw until reinstated. Before switch-on, flag a
  suspension with money open, or provide a maker-checker staff payout to a verified destination.
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
- (xcviii) **Owner question: rider withdrawal limits.** Riders share the customers' and vendors' governed limits
  (GH₵ 5,000 per withdrawal, GH₵ 10,000 a day, 24-hour cooling); separate rider limits would need new settings.
- (xcix) **Owner question: rider companies.** `Rider.company_name` is free text. If a rider company itself is to be
  contracted, invoiced or paid (instead of each rider), a company record and company payouts are a new plan.
- (c) **Owner question: rider pay waits for Support's verification call (RA12).** A third-party rider is credited only
  when Support records "matches" (spec §2.2 step 2(c), §4.1), so their pay can wait up to 72 hours, or indefinitely when
  the customer cannot be reached: "could not reach" releases nothing, nothing releases on its own, and so an unreachable
  customer never pays the rider. Their switch back to AshantiHub's own is blocked meanwhile (R3, `deliveries`). Decide
  whether the delivery fee should be released to the rider at delivery (or after the customer's own confirmation)
  separately from the vendor's money. The spec's "90% withdrawable immediately" holds from release, not from delivery.
