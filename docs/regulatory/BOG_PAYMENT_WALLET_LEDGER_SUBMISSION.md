# AshantiHub — Payments, Wallet & Ledger Engine
## Description of Proposed Operations, for Bank of Ghana Review

**Status:** DRAFT v0.1 for AshantiHub internal review. Not yet submitted.
**Prepared for:** Bank of Ghana, Payment Systems Department (via Hubtel's licensing requirement)
**Prepared by:** [[Company legal name]] ("AshantiHub")
**Date:** [[date of submission]]

> Items in `[[double brackets]]` are facts only AshantiHub management can supply. Sections marked
> **PROPOSED** describe a design that is not built. Section 4 states what is live today. Nothing
> in this document should be presented to BOG as operating unless Section 4 says so.

---

## 1. Purpose of this document

AshantiHub intends to add a transaction-handling layer to its marketplace: customer wallets,
vendor settlement accounts, escrow-style holding of buyer payments until a transaction completes,
platform-fee collection, and payouts to vendors and delivery riders. Hubtel has advised that
access to the required collection and disbursement capabilities depends on a letter from the
Bank of Ghana.

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
| Payment partner | Hubtel [[Hubtel entity name; agreement/reference number; licence category as Hubtel states it]] |
| Settlement bank | [[bank name, if any]] |

## 3. The marketplace in brief

- **Customers** browse and buy from businesses on AshantiHub (web app today; mobile app planned).
- **Businesses ("vendors")** are verified by AshantiHub before they can sell. Verification
  includes identity and business KYC, and a field visit by AshantiHub staff to confirm address
  and legitimacy.
- **Delivery** is done either by AshantiHub's own salaried riders or, in future, by independent
  third-party dispatch riders.
- **AshantiHub staff** operate the platform under role-based access (Super Admin, Operations,
  Accountant, Support, Delivery, Scout, Marketing). Money-related changes require Super Admin
  approval.
- **Anti-fraud rule:** customers and vendors cannot contact each other directly. All
  communication goes through AshantiHub Support, which reduces off-platform payment and
  impersonation fraud.

## 4. Current state (what is live today)

Stated plainly so BOG is not misled:

- Customer payments in the live product are **simulated**. No real customer funds are processed
  or held by AshantiHub today.
- An integration with Hubtel's hosted Checkout exists in code, **has never been run against a
  live or sandbox Hubtel account**, and is switched off. It will not be enabled without Hubtel
  credentials and, we understand, BOG clearance.
- No wallet, escrow or payout feature exists yet. This document describes what we propose to
  build.
- Existing controls that carry over: KYC and field verification of vendors, role-based staff
  permissions with server-side enforcement, staff two-factor authentication and session
  controls, a dispute-handling workflow, fraud flagging, and an audit trail for staff actions.

## 5. PROPOSED: the payment, wallet and ledger engine

### 5.1 Operating model (the central question for BOG)

AshantiHub proposes that it **does not itself hold customer or vendor funds**.

- All money movement (collection from customers, holding, and payout) is performed by the
  licensed partner, Hubtel, [[or: a licensed settlement bank. Confirm with Hubtel which
  structure their licence supports]], in an account designated for this purpose.
- AshantiHub runs a **ledger**: an internal record of who is owed what out of the funds held by
  the partner. The ledger instructs the partner; it is not itself a store of value.
- AshantiHub's own revenue (platform fees) is moved to AshantiHub's operating account only after
  the underlying transaction completes.

**Question for BOG (Q1):** Is this arrangement, where AshantiHub keeps a record of entitlements
and instructs a licensed partner holding the funds, permissible without AshantiHub holding its
own payment-service or e-money licence? If not, which licence category applies?

### 5.2 Accounts in the ledger

| Account | Holder | Meaning |
|---|---|---|
| Customer wallet | Customer | Balance the customer has topped up or received as refunds. Can pay for orders or be withdrawn |
| Escrow (per order) | Held with partner | Customer's payment for an order, held until the order completes |
| Vendor Pending | Vendor | Visible to vendor: sale amount awaiting completion. Not withdrawable |
| Vendor Available | Vendor | Released after completion and fee deduction. Withdrawable |
| Platform Fee | AshantiHub | Fees earned, settled to AshantiHub's account after completion |
| Dispatch earnings | Third-party rider | Per-delivery delivery fees earned. Withdrawable net of platform commission |

AshantiHub-employed riders have no wallet. They are paid through company payroll.

### 5.3 Money flows

1. **Pay.** Customer pays by mobile money directly, or from their wallet.
2. **Hold.** The full amount sits in escrow with the partner. The vendor sees the sale as
   *Vendor Pending*.
3. **Complete.** The order is delivered and confirmed, or the service/booking/event is
   fulfilled. Disputes pause release (Section 5.7).
4. **Disburse**, in this order: (a) AshantiHub platform fee, plus the delivery fee when
   AshantiHub's own rider delivered; (b) vendor, receiving the total less platform fee and
   delivery fee, into *Vendor Available*; (c) third-party rider's delivery fee, if applicable.
5. **Withdraw.** Vendors, customers and third-party riders withdraw to a verified mobile money
   number or bank account.

### 5.4 Customer wallet

- **Top-up** from the customer's saved mobile money number.
- **Refunds** return to the customer wallet.
- **Withdrawal** only to a mobile money number or bank account that has been verified in the
  customer's own name.
- [[Decision needed: maximum wallet balance, single-transaction limit and daily limit. BOG
  guidance on tiered KYC limits for stored-value accounts is requested; see Q2.]]

**Question for BOG (Q2):** Does a customer wallet funded by top-up and usable only on
AshantiHub constitute e-money requiring a licence, even where the funds are held by the licensed
partner? If so, may it operate under the partner's licence, and what balance and transaction
limits apply?

### 5.5 Platform fee (vendor-borne)

Replaces the previous subscription model. Charged to vendors only. It is not shown to the
customer at checkout.

| Purchase value (GHS) | Fee for products |
|---|---|
| 100.00 and below | 1% |
| 100.01 to 500.99 | GHS 5.00 flat |
| 501.00 and above | 2% |

Rates for events and services are set separately. Super Admin or Accounts can edit all tiers.
In a multi-vendor cart, each vendor is charged a fee on their own portion. A per-vendor daily
cap applies, GHS 100.00 initially. The cap is editable by Super Admin, and blank means no cap.
It resets at 00:00:00 daily. Each vendor receives an SMS for every fee charged and sees all
transactions and fees on a dashboard.

[[Management to confirm: whether tier thresholds apply per vendor-portion or per whole cart, and
whether the cap is per calendar day in GMT.]]

### 5.6 Third-party dispatch

Independent riders see their per-delivery earnings. AshantiHub charges them a commission of 10%
(editable by Super Admin or Accounts) on the day's earnings, deducted at end of day. The
commission is not withdrawable by the rider. They may withdraw the remainder.

### 5.7 Disputes, refunds and reversals

- A buyer may raise a dispute before release. Release of the vendor's funds is held while the
  dispute is open.
- Staff resolve disputes through the existing dispute workflow. A settlement that moves money
  requires an Accountant action and Super Admin approval.
- Refunds go to the customer wallet. The customer may then withdraw to a verified account.
- Every ledger entry is immutable. Corrections are made by reversing entries, never by editing.

### 5.8 Controls

| Area | Control |
|---|---|
| Ledger integrity | Double-entry; every movement balances to zero; append-only entries; idempotency keys on every provider call and webhook |
| Reconciliation | Daily automated reconciliation of the ledger against the partner's statement; breaks raised to Accounts [[reconciliation SLA to be agreed]] |
| Segregation of duties | No single staff member can create, approve and release a payout; large payouts require Super Admin approval |
| Authentication | Staff two-factor authentication; customer and vendor withdrawals require OTP confirmation |
| Withdrawal safety | Destination account must be verified in the account holder's name; a cooling-off period applies after a payout destination is added or changed [[length to be set]] |
| Fraud | Existing fraud-flag workflow; velocity and amount limits; hold-and-review of unusual patterns |
| AML/CFT | KYC on all vendors and riders (existing); customer KYC tiers tied to wallet limits; transaction monitoring and suspicious-transaction reporting to the Financial Intelligence Centre via the designated compliance officer [[name]] |
| Audit | Full audit trail of staff actions and fee-rule changes, with who, when and previous value |
| Data protection | [[Data Protection Commission registration number]]; payment credentials are never stored by AshantiHub; provider secrets are held server-side only |
| Business continuity | [[backup, recovery and incident-response summary]] |

### 5.9 Reporting

Accounts can produce transaction, escrow, fee and payout reports. AshantiHub will provide BOG
with whatever periodic returns the authorised category requires.

## 6. Parties and responsibilities

| Party | Role |
|---|---|
| Customer | Pays, receives refunds, holds wallet balance |
| Vendor | Sells, receives settlement net of fee |
| Third-party rider | Delivers, receives delivery fee net of commission |
| AshantiHub | Operates marketplace and ledger, instructs partner, earns platform fee and rider commission |
| Hubtel | Collects, holds and disburses funds under its licence [[confirm scope with Hubtel]] |
| Settlement bank | [[if applicable]] |

## 7. Questions for the Bank of Ghana

1. **Q1.** Is the ledger-plus-licensed-partner model in 5.1 permissible without an AshantiHub
   licence? If not, which licence or authorisation is required?
2. **Q2.** Does the customer wallet (5.4) count as e-money, and under whose licence may it run?
   What limits apply?
3. **Q3.** Is holding buyer payments in escrow until completion (5.3) acceptable under the
   partner's licence, or does it need separate authorisation?
4. **Q4.** Does paying out third-party riders after deducting a commission (5.6) change the
   classification of the activity?
5. **Q5.** What KYC tiers, reporting and capital or settlement-account requirements apply to the
   authorised category?
6. **Q6.** Can AshantiHub begin a limited pilot (for example capped values, a named number of
   vendors) while any licence is processed?

## 8. Appendices to attach

- A. Certificate of incorporation, Form 3, TIN, directors' IDs [[to gather]]
- B. Hubtel correspondence and agreement [[to gather]]
- C. Transaction flow diagram (Section 5.3) [[to be drawn]]
- D. Screenshots of the existing app: vendor KYC, disputes, staff controls [[to capture]]
- E. AML/CFT policy and compliance officer appointment [[to prepare]]
- F. Terms & Conditions and Privacy Policy for customers and vendors [[confirm current versions]]
- G. Business-continuity and information-security summary [[to prepare]]
