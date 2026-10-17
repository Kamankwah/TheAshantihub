# AshantiHub — Payments, Wallet & Ledger Engine
## Description of Proposed Operations, for Bank of Ghana Review

**Status:** DRAFT v0.2 for AshantiHub internal review. Not yet submitted. Aligned 2026-10-16 with
`docs/superpowers/specs/2026-10-15-wallet-fees-security-design.md` (the wallet spec).
**Prepared for:** Bank of Ghana, Payment Systems Department (via the payment service provider's licensing requirement)
**Prepared by:** [[Company legal name]] ("AshantiHub")
**Date:** [[date of submission]]

> Items in `[[double brackets]]` are facts only AshantiHub management can supply. Section 4
> states exactly what is built, what is live, and what is not. Nothing in this document should be
> presented to BOG as operating unless Section 4 says so. Companion cover letter:
> `bog-payment-systems-letter.html`.

---

## 1. Purpose of this document

AshantiHub intends to add a transaction-handling layer to its marketplace: customer wallets,
vendor wallets, escrow-style holding of buyer payments until a transaction is verified, platform-fee
collection, and payouts to vendors and third-party delivery riders. We understand that access
to the required collection and disbursement capabilities of a licensed payment service provider
(the "Provider") depends on a letter from the Bank of Ghana.

This document describes the nature of those activities so that BOG can advise (a) whether the
activities require a licence or authorisation, (b) in which category, and (c) what conditions
apply. We would rather be told the correct structure than assume one.

## 2. Who we are

| | |
|---|---|
| Legal entity | [[registered name, RGD registration number, TIN]] |
| Registered address | [[address]] |
| Directors / beneficial owners | [[names, shareholding]] |
| Nature of business | Online marketplace connecting Ghanaian customers with verified local businesses (products, services, events, accommodation) in the Ashanti Region, with optional delivery |
| Primary contact for BOG | [[name, role, phone, email]] |
| Existing licences or registrations | [[e.g. Data Protection Commission registration, if held]] |
| Payment partner | Licensed payment service provider (the "Provider") [[Provider's legal name; agreement/reference number; licence category as the Provider states it]] |
| Settlement bank | [[bank name, if any]] |

## 3. The marketplace in brief

- **Customers** browse and buy from businesses on AshantiHub (web app today; mobile app planned).
- **Businesses ("vendors")** are verified by AshantiHub before they can sell. Verification
  includes identity and business KYC, and a field visit by AshantiHub staff to confirm address
  and legitimacy.
- **Delivery** is done either by AshantiHub's own salaried riders or by independent third-party
  dispatch riders. Customers may instead collect a store-pickup order at the AshantiHub office.
- **AshantiHub staff** operate the platform under role-based access (Super Admin, Operations,
  Accountant, Support, Delivery, Scout, Marketing, Pickup Desk). Money-related settings are
  changed through a maker-checker flow (Section 5.8).
- **Anti-fraud rule:** customers and vendors cannot contact each other directly. All
  communication goes through AshantiHub Support, which reduces off-platform payment and
  impersonation fraud.

## 4. Current state (what is built, and what is live)

Stated plainly so BOG is not misled:

- **No real money is processed or held today.** Customer payments in the live product are
  **simulated**. All wallet and ledger features sit behind feature switches that are **off**, and
  the payment provider is a simulated implementation.
- **Built, tested, switched off** (on simulated rails):
  - the double-entry ledger and the fee engine, with governed settings and fee snapshots on each
    paid order;
  - mandatory one-time-password (OTP) security, step-up tokens for sensitive actions, optional
    authenticator-app 2FA, and staff-assisted account recovery;
  - customer and vendor wallets, payments and refunds, including the refund-after-release path.
- **In development, not merged:** withdrawals and payout destinations (name matching, OTP
  confirmation, cooling period, limits).
- **Not built:** vendor SMS and statement pages, the third-party rider wallet and daily
  commission, the multi-seller catalogue, and the live payment-provider switch.
- **Ledger coverage:** the ledger currently records **product orders only**. Services, events and
  stays follow the same release model (Section 5.3) but are not yet ledger-backed.
- **Provider integration:** an integration with a hosted-checkout payment provider exists in code, **has never been run
  against a live or sandbox provider account** [[confirm still true at submission]], and is switched
  off. It will not be enabled without Provider credentials and, we understand, BOG clearance.
- **Existing controls that carry over:** KYC and field verification of vendors, role-based staff
  permissions with server-side enforcement, staff two-factor authentication and session
  controls, a dispute-handling workflow, fraud flagging, and an audit trail for staff actions.

Our rollout order places OTP security **before** any wallet goes live, and the live Provider switch
last, gated on credentials and regulatory clearance.

## 5. The payment, wallet and ledger engine

### 5.1 Operating model (the central question for BOG)

AshantiHub proposes that it **does not itself hold customer or vendor funds**.

- All money movement (collection from customers, holding, and payout) is performed by the
  licensed partner, the Provider, [[or: a licensed settlement bank. Confirm with the Provider which
  structure their licence supports]], in an account designated for this purpose.
- AshantiHub runs a **ledger**: an internal record of who is entitled to what out of the funds
  held by the partner. The ledger instructs the partner; it is not itself a store of value.
- Amounts are held as integer pesewas. Balances are never edited; they derive from immutable
  journal entries.
- AshantiHub's own revenue (platform fees) is recognised only when the underlying order is
  released.

**Question for BOG (Q1):** Is this arrangement, where AshantiHub keeps a record of entitlements
and instructs a licensed partner holding the funds, permissible without AshantiHub holding its
own payment-service or e-money licence? If not, which licence category applies?

### 5.2 Accounts in the ledger

| Account | Visible to | Meaning |
|---|---|---|
| Customer wallet | Customer | Top-ups and refunds; spendable on AshantiHub or withdrawable |
| Vendor Pending | Vendor | Sale amount for a paid order awaiting verification; not withdrawable |
| Vendor Available | Vendor | Released money; withdrawable; may go negative after a late refund |
| Delivery payable | Internal | An order's delivery fee until paid out |
| Rider balance | Third-party rider | Withdrawable share of delivery earnings (90%) |
| Rider commission reserve | Internal; rider read-only | 10% reserve, not withdrawable |
| Platform fee, delivery and commission income | AshantiHub | Platform earnings |
| Provider clearing, provider fees | Internal | The partner side of every cash movement |
| Withdrawal in transit | Internal | Instructed payouts not yet confirmed |

There is no separate per-order escrow account in the ledger: on payment, the same entry
allocates the customer's money straight into each vendor's Pending and into Delivery payable.
The money itself stays with the partner throughout. AshantiHub-employed riders have no wallet;
they are paid through company payroll.

### 5.3 Money flows

1. **Pay.** Customer pays by mobile money through the Provider's checkout, or from their wallet. The
   full amount is held by the partner. The ledger allocates each vendor's item subtotal to that
   vendor's *Pending* and the delivery fee to *Delivery payable*.
2. **Hand over.** A rider marks the delivery done, or (store pickup) the Pickup Desk marks it
   collected within 24 hours of purchase.
3. **Confirm receipt.** The customer confirms, or an AshantiHub Support officer records the
   customer's confirmation during the verification call.
4. **Verification call.** A Support officer calls the customer to check the product matches what
   was bought. The result is one of:
   - *Matches*: money is released at once (step 5).
   - *Does not match*: a dispute is raised, due within **72 hours of purchase**. Nothing is
     released. If it ends in the customer's favour the customer is refunded; otherwise Support
     records the positive result and money is released.
   - *Could not reach*: recorded; the order stays on Support's list and is flagged overdue 72
     hours after purchase. **Nothing releases on its own.**
   An open dispute always blocks release.
5. **Release** (one atomic ledger entry): (a) platform fee per vendor, and the delivery fee when
   AshantiHub's own rider delivered, to platform income; (b) vendor *Available* = item subtotal
   less platform fee; (c) for a third-party rider, 90% of the delivery fee to *Rider balance* and
   10% to the commission reserve.
6. **Withdraw.** Vendors, customers and third-party riders withdraw to a verified mobile money
   number or bank account (Section 5.9). The amount moves to *in transit*, is instructed through
   the partner, completes on confirmation, and reverses automatically on failure.

No timer releases a vendor's money. Services, events and stays follow the same model once the
ledger covers them: the service is done, the event has taken place or the stay has begun, the
customer confirms (or Support records it), and a verification call releases the money.

### 5.4 Customer wallet

- **Top-up** from the customer's attached mobile money number, via the partner's collection.
- **Pay** directly by mobile money or from the wallet.
- **Refunds** are credited to the wallet.
- **Withdrawal** only to a mobile money number or bank account verified in the customer's own
  name, with OTP confirmation.
- **Charges, passed through at cost:** the customer pays the partner's *collection charge*
  (shown as "payment processing"); none applies to payments from the wallet. The collection
  charge is not refunded except for platform or vendor error. The user bears any withdrawal
  charge.
- [[Decision needed: maximum wallet balance, single-transaction limit and daily limit. BOG
  guidance on tiered KYC limits for stored-value accounts is requested; see Q2.]]

**Question for BOG (Q2):** Does a customer wallet funded by top-up and usable only on
AshantiHub constitute e-money requiring a licence, even where the funds are held by the licensed
partner? If so, may it operate under the partner's licence, and what balance and transaction
limits apply?

### 5.5 Platform fee (vendor-borne)

Replaces the previous subscription model. Charged to vendors only; **never shown to the
customer**, who sees items, delivery and, for mobile money or top-up, a "payment processing" line.

- **Fee base:** the vendor's item subtotal after seller-funded discounts, **excluding delivery**.
  Coupons are funded by AshantiHub and are never charged to the vendor.
- **Products, seeded schedule:**

| Vendor's item subtotal (GHS) | Fee |
|---|---|
| 0.00 – 99.99 | 1% |
| 100.00 – 499.99 | GHS 5.00 flat |
| 500.00 – 49,999.99 | 1% |
| 50,000.00 and above | GHS 500.00 flat |

- Fees are rounded to the nearest pesewa, half up. In a multi-vendor cart each vendor is charged
  on their own portion.
- **Services and events** have their own editable tables, currently seeded as copies of the
  product table. [[Values to be set by management before launch.]] Stays and bookings count as
  services.
- **Lifetime cap per vendor:** cumulative across categories, editable by Super Admin; blank
  means no cap. The fee that crosses the cap is charged only up to the remainder.
- **Snapshot:** the rule version, base, computed fee and remaining cap are recorded on each paid
  order, so later changes never alter an order already paid.
- Vendors are told by SMS of each paid order (reference, item subtotal, platform fee, amount
  due) and again on release, and see all transactions and fees on a dashboard. *(Not yet built;
  see Section 4.)*

### 5.6 Third-party dispatch

Independent riders see their per-delivery earnings. AshantiHub retains a **10% commission
reserve on every delivery credit** (editable through the governed-settings flow): 90% is
withdrawable immediately and 10% sits in the reserve. At end of day the reserve is posted to
commission income, with a true-up if the rate changed that day; a reversed delivery reverses its
share. The rider sees the day's gross, commission and net. *(Not yet built; see Section 4.)*

### 5.7 Disputes, refunds and reversals

- **Before release:** escrow-backed amounts return to the customer wallet.
- **After release:** the refund debits the vendor's *Available* balance (which may go negative
  and is recovered from future sales; a negative balance blocks withdrawal), the platform fee is
  returned in proportion, and the customer wallet is credited.
- A dispute blocks release while open and is settled within 72 hours of purchase. Settlements
  that move money use the existing dispute workflow with accountant action and Super Admin
  approval.
- Every ledger entry is immutable. Corrections are made by reversing entries, never by editing.

### 5.8 Controls

| Area | Control |
|---|---|
| Ledger integrity | Double-entry; every movement balances; append-only entries; integer pesewas; unique idempotency key on every entry and provider call; atomic posting with account locking |
| Provider webhooks | Signature-verified, idempotent on the provider reference, amount-verified against the amount requested, logged raw before processing, monotonic in status. The browser's redirect state is never a source of truth |
| Reconciliation | Nightly automated comparison of the ledger with the partner's statement; differences flagged to Accounts [[reconciliation SLA to be agreed]] |
| Governed settings | Fee tables, the cap, the rider commission rate, verification and pickup windows, withdrawal limits and the cooling period are changed by a maker-checker flow: Accounting proposes, Super Admin approves; each change logs who, when, old and new values and applies only to later orders. Super Admin may edit directly in an emergency, also logged |
| Segregation of duties | Accounting cannot approve its own proposals; payout-affecting settlement of disputes needs two roles |
| OTP | One OTP service (SMS or email): 6 digits, stored hashed, 5-minute expiry, limited attempts, resend cooldown, rate limits per user, phone and IP; no account-existence leaks |
| When OTP is required | At sign-up; before sensitive actions (withdrawal, payout destination, phone/email/password change) through single-purpose, short-lived step-up tokens bound to the action; at every sign-in for staff and vendors; for customers on a new device or after a gap (default 30 days, editable) |
| Authenticator-app 2FA | Optional for anyone, with recovery codes; replaces the sign-in OTP when enabled. Staff-assisted recovery is Super Admin only, with a maker who can never decide their own request |
| Payout safety | Destination account name must match the user's verified name (customer profile or vendor KYC) and be confirmed by OTP; new or changed destinations cannot receive money for a cooling period (default 24 hours, editable); daily and per-transaction limits are editable; vendors may withdraw only to a destination matching their registered business or owner name |
| Fraud | Existing fraud-flag workflow; velocity and amount limits; hold-and-review of unusual patterns [[confirm detail]] |
| AML/CFT | KYC on all vendors and riders (existing); transaction monitoring and suspicious-transaction reporting to the Financial Intelligence Centre via the designated compliance officer [[name]]; customer KYC tiers tied to wallet limits [[to be decided with BOG guidance]] |
| Audit | Full audit trail of staff actions, setting changes and OTP events |
| Data protection | [[Data Protection Commission registration number]]; payment credentials are never stored by AshantiHub; provider secrets are held server-side only |
| Business continuity | [[backup, recovery and incident-response summary]] |

### 5.9 Payout destinations

A destination is *verified* when the account name returned by the network or bank matches the
user's verified name and the owner confirms by OTP. It then observes the cooling period before it
can receive money. Withdrawals are charged to the user at the partner's cost.

### 5.10 Reporting

Accounts can produce transaction, fee and payout reports. AshantiHub will provide BOG with
whatever periodic returns the authorised category requires.

## 6. Parties and responsibilities

| Party | Role |
|---|---|
| Customer | Pays, receives refunds, holds wallet balance |
| Vendor | Sells, receives settlement net of platform fee |
| Third-party rider | Delivers, receives delivery fee net of the commission reserve |
| AshantiHub | Operates marketplace and ledger, instructs partner, verifies orders by call, earns platform fee and rider commission |
| Provider | Collects, holds and disburses funds under its licence [[confirm scope with the Provider]] |
| Settlement bank | [[if applicable]] |

## 7. Questions for the Bank of Ghana

1. **Q1.** Is the ledger-plus-licensed-partner model in 5.1 permissible without an AshantiHub
   licence? If not, which licence or authorisation is required?
2. **Q2.** Does the customer wallet (5.4) count as e-money, and under whose licence may it run?
   What limits apply?
3. **Q3.** Is holding buyer payments with the partner until a human verification call confirms
   the order (5.3) acceptable under the partner's licence, or does it need separate
   authorisation?
4. **Q4.** Does paying out third-party riders after retaining a commission reserve (5.6) change
   the classification of the activity?
5. **Q5.** What KYC tiers, reporting and capital or settlement-account requirements apply to the
   authorised category?
6. **Q6.** Can AshantiHub begin a limited pilot (for example capped values, a named number of
   vendors) while any licence is processed?

## 8. Appendices to attach

- A. Certificate of incorporation, Form 3, TIN, directors' IDs [[to gather]]
- B. Provider correspondence and agreement [[to gather]]
- C. Transaction flow diagram: Figure 1 of the cover letter (`bog-payment-systems-letter.html`)
- D. Screenshots of the existing app: vendor KYC, disputes, staff controls [[to capture]]
- E. AML/CFT policy and compliance officer appointment [[to prepare]]
- F. Terms & Conditions and Privacy Policy for customers and vendors [[confirm current versions]]
- G. Business-continuity and information-security summary [[to prepare]]
