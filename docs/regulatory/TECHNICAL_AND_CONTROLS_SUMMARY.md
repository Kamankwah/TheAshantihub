# AshantiHub — Wallet and Ledger: Technical and Controls Summary

**Enclosure 3 to the request letter to the Bank of Ghana, Payment Systems Department**
**Status:** DRAFT v0.1 for AshantiHub internal review. Not yet submitted.
**Prepared by:** [[Company legal name]] ("AshantiHub")
**Date:** [[date of submission]]
**Describes the system as built at 16 October 2026.** Nothing described here is deployed to
production or handles real money. Section 12 lists what is not yet built or not yet decided.

> Items in `[[double brackets]]` are facts only AshantiHub management can supply. Companion
> documents: the request letter (with the flow chart of funds), the *Description of Proposed
> Operations*, and the *Terms of Service and Wallet Terms*.

---

## 1. Purpose and scope

This document describes how the AshantiHub wallet and ledger is designed, how money is recorded
and moved, and the controls that protect customers, vendors and the platform. It is written so
that a technical reviewer can test our claims, and it states plainly where the design is
incomplete.

**In scope:** the double-entry ledger, the payment-provider interface, order payment, release,
refunds, wallets, payout destinations, withdrawals, the fee engine, identity and one-time-password
(OTP) security, staff controls, reconciliation, and audit.

**Out of scope:** the marketplace catalogue, search, delivery routing and marketing, except where
they touch money.

**Central design principle:** AshantiHub does not hold customer or vendor funds. A licensed
payment service provider (the "Provider") collects, holds and disburses all money. AshantiHub keeps
a ledger of who is entitled to what and instructs the Provider. The ledger is a record; it is not a
store of value.

## 2. System overview

| Layer | Technology and role |
|---|---|
| Application | Django and Django REST Framework (Python) API; React web front end |
| Database | PostgreSQL, the system of record for the ledger and all state |
| Background work | Celery workers and a scheduler (beat) with Redis, for nightly reconciliation, payout status polling and the hourly uncollected-pickup job |
| Web tier | Synchronous gunicorn behind nginx; a separate real-time service handles WebSocket updates only |
| Hosting | [[hosting provider and data-centre location, to be confirmed]] |
| Payment provider | Behind a single interface with two implementations: **simulated** (default) and a live Provider implementation (not yet connected for payouts; see Section 12) |

The money code lives in three Django apps: `ledger` (accounts, journal, fees, release, refunds),
`wallets` (payout destinations, withdrawals, reconciliation) and `payments` (checkout sessions,
webhooks, the provider interface). Identity and OTP security live in `accounts` and `otp`.

### 2.1 Feature switches

Every money feature is behind a switch that defaults to **off**: the ledger switch, the three OTP
enforcement switches, and the subscription freeze. Without the live Provider credentials the
system runs on simulated rails and moves no real money. The ledger switch is one-way by design:
once on, it must not be turned off, because refunds would then be skipped silently.

## 3. The ledger

### 3.1 Principles

- **Double entry.** Every movement is a journal entry made of balanced debit and credit lines. An
  entry that does not balance to zero is rejected.
- **Append-only and immutable.** Entries are never edited or deleted. A correction is a new,
  reversing entry. An account's balance is a cache that only the posting routine changes, in the same
  database transaction that writes the journal lines, so it can always be re-derived from the entries.
- **Integer money.** Amounts are whole pesewas. There are no floating-point amounts anywhere in the
  money path.
- **Idempotent.** Every entry carries a unique idempotency key tied to its order, payment or
  withdrawal. Replaying a payment confirmation, a webhook or a job cannot post twice.
- **Atomic and locked.** Each posting runs in one database transaction. It locks, in a fixed order
  (the order row, then the fee snapshots, then the ledger accounts in primary-key order), every
  account it touches. The fixed order prevents deadlocks between a payment, a release, a refund and
  a cancellation on the same order.
- **Traceable.** Each entry links to its order, payment, refund or withdrawal and records who or
  what caused it.

### 3.2 Accounts

| Account | Visible to | Meaning |
|---|---|---|
| Customer wallet | Customer | Top-ups and refunds; spendable on AshantiHub or withdrawable |
| Vendor Pending | Vendor | Sale amount for a paid order awaiting verification; not withdrawable |
| Vendor Available | Vendor | Released money; withdrawable; may go negative after a late refund |
| Delivery payable | Internal | An order's delivery fee until paid out |
| Rider balance | Third-party rider | Withdrawable share of delivery earnings (90%) |
| Rider commission reserve | Internal; rider read-only | 10% reserve, not withdrawable until posted to income at end of day |
| Platform fee, delivery and commission income | AshantiHub | Platform earnings |
| Provider clearing and provider fees | Internal | The Provider's side of every cash movement |
| Withdrawal in transit | Internal | Instructed payouts not yet confirmed |

Customer-wallet, vendor and rider balances are claims on money that sits with the Provider. They
are not deposits held by AshantiHub.

### 3.3 Worked example

A customer buys GHS 200.00 of goods from one vendor and pays GHS 15.00 delivery, by mobile money.

1. **Payment** (one entry): Dr Provider clearing 215.00; Cr Vendor Pending 200.00; Cr Delivery
   payable 15.00. A separate "payment processing" charge paid by the customer on top is kept on the
   checkout session; the ledger records only the net.
2. **Release** (after the verification call, Section 6): the fee for a GHS 200.00 subtotal is GHS
   5.00. One atomic entry: Dr Vendor Pending 200.00; Cr Vendor Available 195.00; Cr Platform fee
   income 5.00. For delivery by an AshantiHub rider: Dr Delivery payable 15.00; Cr Delivery income
   15.00. For a third-party rider: Cr Rider balance 13.50 and Cr Rider commission reserve 1.50.
3. **Withdrawal** of GHS 195.00 by the vendor: Dr Vendor Available 195.00; Cr Withdrawal in transit
   195.00. On the Provider's confirmation: Dr Withdrawal in transit; Cr Provider clearing. On
   failure, the amount is returned to Vendor Available.

## 4. Payment provider interface

The Provider is called through one interface so that the ledger never depends on a particular
vendor. The operations are: **collect** (hosted checkout), **handle webhook**, **look up an account
name**, **payout**, **status** and **statement**.

### 4.1 Webhook and payment handling

- Webhooks are **signature-verified**, **idempotent** on the Provider's reference, and
  **amount-verified** against the amount AshantiHub requested. A mismatch is not credited.
- Each webhook is **logged raw before processing**. Status changes are **monotonic**: a payment
  cannot move backwards from paid to pending.
- The browser's redirect state is **never** a source of truth. Only the verified webhook (or a
  server-side status query) marks a payment paid.
- A success report that names no amount does not credit a top-up and does not settle a payout.
- Payment credentials (card numbers, PINs) are never seen or stored by AshantiHub; checkout is
  hosted by the Provider.

### 4.2 Provider charges

The customer pays the Provider's collection charge, shown as "payment processing", on top of the
order. There is no charge when paying from the wallet. The collection charge is not refunded
except where AshantiHub, the rider or the business was at fault. The user bears any withdrawal
charge, which is deducted from the amount sent.

## 5. Fee engine

- **Fee base:** the vendor's item subtotal after seller-funded discounts, **excluding delivery**.
  Coupons are funded by AshantiHub and never charged to the vendor. The delivery fee is never borne
  by the vendor.
- **Rules:** per-category tables of bands, each a percentage or a flat amount, rounded to the
  nearest pesewa (half up). Products are seeded at 1% to GHS 99.99, GHS 5.00 flat from GHS 100.00
  to 499.99, 1% from GHS 500.00 to 49,999.99, and GHS 500.00 flat from GHS 50,000.00. Services and
  events have their own tables [[values to be set]].
- **Lifetime cap per vendor,** cumulative across categories and editable by Super Admin. The fee
  that crosses the cap is charged only up to the remainder.
- **Snapshot:** the rule version, base, computed fee and remaining cap are written onto the order
  at payment. Release reads the snapshot, so a later rule change can never alter an order already
  paid.
- Fees are **not shown to the customer**.

## 6. Order lifecycle, release and disputes

No timer releases a vendor's money. For a product order:

1. **Handed over:** the rider marks the delivery done, or the Pickup Desk marks a store pickup
   collected (within 24 hours of purchase).
2. **Receipt confirmed:** by the customer, or recorded by Support during the verification call.
3. **Verification call:** a Support officer calls the customer to check the product matches what
   was bought, and records one of: *matches* (money is released at once), *does not match* (a
   dispute is raised, due within 72 hours of purchase, and nothing is released), or *could not
   reach* (recorded; the order stays on Support's list and is flagged overdue 72 hours after
   purchase; nothing releases on its own).
4. An **open dispute blocks release**.

**Refunds** go to the customer wallet. Before release, the escrow-backed amount returns to the
customer. After release, the refund debits the vendor's Available balance (which may go negative
and is recovered from future sales) and returns the platform fee in proportion. The delivery fee
returns only with a whole-order refund. A refund is recorded once per order and source, so a
dispute and its related delivery case can never refund the same order twice. Support's cancel of a
paid order, an uncollected pickup after the window, a dispute resolved with a refund amount, and an
approved delivery-case refund all use this one refund path.

Services, events and stays follow the same release model. The ledger currently records **product
orders only**; the other categories are not yet ledger-backed.

## 7. Wallets, payout destinations and withdrawals

### 7.1 Customer and vendor wallets

A customer tops up through the Provider's hosted checkout and may pay for an order from the wallet
(the wallet must cover the whole order; there is no split payment). Refunds credit the wallet.
Vendors see **Pending** and **Available** balances.

### 7.2 Payout destinations

A destination (mobile money number or bank account) can receive money only when all of these hold:

- the account **name returned by the network or bank matches** the user's verified name, compared
  as a set of words (a customer's profile name; for a vendor, the KYC-verified owner or business
  name);
- the owner **confirms by one-time code** (step-up);
- a **cooling period** has passed since it was added (default 24 hours, minimum 1, governed).

A destination is never edited: a change is a removal and a new addition, which restarts the cooling
period. Every addition and removal notifies the holder. Numbers are stored unmasked but sent to
staff and logs only masked.

### 7.3 Withdrawals

- The amount moves to *withdrawal in transit* in the request's own database transaction, and is
  **sent once** (claimed under a row lock). A withdrawal is returned instead of sent if the holder
  has since been suspended or the destination removed.
- **Limits** per withdrawal and per day, per holder account, are governed settings. A negative
  vendor Available balance blocks withdrawal.
- Results are applied by one idempotent routine that is **monotonic** and **amount-checked against
  the amount the Provider itself reports**. A report for a withdrawal never sent, a "paid" report
  after the money was returned, or a "failed" report after it was paid each **open a fraud case
  and post nothing**.
- The Provider's own message text is never stored or shown to users.
- Staff may fail a stuck withdrawal only after asking the Provider, never while the Provider says
  it is still processing, and never with an open amount case. The holder sees a fixed reason, not
  the staff member's note.

## 8. Identity, access and operational controls

### 8.1 One-time passwords and step-up

- One OTP service (SMS or email): 6 digits, **stored hashed**, 5-minute expiry, limited attempts,
  resend cooldown, rate limits per user, phone and IP, and no account-existence leaks.
- **Required** at sign-up; at every sign-in for staff and vendors; for customers on a new device or
  after a gap (default 30 days, editable); and before sensitive actions.
- **Step-up tokens** are single-purpose, short-lived and bound to one action (withdrawal, adding a
  payout destination, adding a recovery contact). With the ledger on, destinations and withdrawals
  always require a code.
- **Authenticator-app 2FA** is optional for everyone, with recovery codes. Staff-assisted account
  recovery is limited to Super Admin, and the person who requests it can never approve it.
- Trusted-device records, attempt locks, an audit log of OTP events, and an SMS-spend alert.

### 8.2 Staff roles and approvals

- Role-based access, enforced on the server, for Super Admin, Operations, Accountant, Support,
  Delivery, Scout, Marketing and Pickup Desk. The Pickup Desk sees no customer phone numbers.
- **Maker-checker** governs money settings: fee tables, the cap, the rider commission rate, release
  and pickup windows, withdrawal limits and the cooling period. Accounting proposes, Super Admin
  approves, a change applies only to later orders, and each is logged with who, when, old value and
  new value. Super Admin may edit directly in an emergency; the edit is logged.
- Sensitive staff actions require password re-entry. A settlement that moves money needs an
  accountant action and Super Admin approval.

### 8.3 Audit

Staff actions go to a hash-chained activity log. OTP events are recorded separately (full phone
numbers, emails and IPs kept for 400 days, masked in any staff view). Ledger entries themselves are
the permanent record of every money movement.

## 9. Reconciliation and monitoring

- **Nightly reconciliation** compares the ledger with the Provider's statement by Provider
  reference. It is read-only, asks the Provider outside any database transaction, and checks
  *withdrawal in transit* against open withdrawals even when no statement is available.
- A difference opens a **fraud case** for Accounts; one case per day while it is open. A skipped
  check is never recorded as a matched run.
- A 5-minute poll settles open withdrawals the Provider has finished.
- Customers and vendors are told of every change that affects their money (in-app, with SMS or
  email for sensitive events).
- Errors in payment handling are reported to our error-tracking service [[alerting rules to be
  confirmed before go-live; see Section 12]].

## 10. Data protection and security

- Registered under the Data Protection Act, 2012 (Act 843): [[Data Protection Commission
  registration number]].
- Provider secrets are held server-side only. Claim, step-up and device tokens and OTP codes are stored
  hashed. Traffic is encrypted in transit.
- Personal data in money flows is minimised and masked in staff screens and logs; staff notes have
  long digit runs masked before storage.
- [[Backup, recovery, retention and incident-response summary, to be supplied by management.]]

## 11. Testing and change control

Money paths are covered by automated tests, including posting balance, idempotent replay, fee-band
boundaries and the cap, refund arithmetic, withdrawal state transitions, and reconciliation
outcomes. Every change passes independent code review before it is merged. Production deployment
needs an explicit instruction from the business owner; nothing in this document is deployed to
production.

## 12. Known limitations and conditions before go-live

We list these so the Bank has an accurate picture. None is reachable while the feature switches
stay off, and **no switch will be turned on until each item is closed or accepted in writing by
management**, and until we have the Bank's guidance.

| # | Area | Limitation | Intended resolution |
|---|---|---|---|
| 1 | Live Provider | Payouts, withdrawal status, account-name lookup and the statement are built against the interface and tested on simulated rails only. The live connection for these is not yet built, so on live rails withdrawals and name checks answer "unavailable" | Build and test the live integration in Provider sandbox before any real money |
| 2 | Wallet limits | No cap on wallet balance is implemented; limits exist only for withdrawals | Set balance and transaction limits to the Bank's guidance |
| 3 | Top-up funds | Money topped up can be withdrawn immediately, so a mobile-money reversal after a withdrawal could cost AshantiHub | Decide a hold period on newly topped-up funds |
| 4 | Customer names | A customer's profile name is self-declared and can be changed, so name matching for customers is weaker than for KYC-verified vendors | Require a code for a name change and restart cooling on a rename, or introduce customer KYC |
| 5 | OTP rollout | Front-end screens for the code and step-up flows, and a live SMS provider, are not yet complete; several OTP hardening items (notice send limits, secondary-email confirmation throttling, phone normalisation) are open | Finish before any OTP or ledger switch is enabled |
| 6 | Failure alerting | A payment confirmation that fails to post would be retried by the Provider but is not yet alerted on | Wire alerting before the ledger is enabled |
| 7 | Staff changes to contacts | Some staff edits to a customer's contacts or matched name need only a permission, not a second person | Require sudo and maker-checker, notify the old contacts, and restart cooling |
| 8 | Stuck withdrawals | A payout the Provider keeps reporting as processing cannot be ended in the app | Add a maker-checker "settle with Provider evidence" action |
| 9 | Reconciliation | A missed night is not caught up automatically | Add a catch-up run |
| 10 | Scope | Ledger covers product orders only; vendor SMS and statements, rider wallet and the multi-seller catalogue are not built | Build in later stages |
| 11 | Pickup | With the ledger on, every store pickup must be collected at the AshantiHub office, or it is refunded after the window | Make checkout and vendor screens say so before go-live |

## 13. Governed settings

| Setting | Controlled by |
|---|---|
| Fee tables per category; lifetime fee cap | Maker-checker (Accounting proposes, Super Admin approves) |
| Rider commission rate | Maker-checker |
| Verification-overdue window (72 h) and pickup window (24 h) | Maker-checker |
| Withdrawal limits (per withdrawal, per day) | Maker-checker |
| Payout cooling period (default 24 h) | Maker-checker |
| OTP policy numbers (customer gap, SMS alert threshold) | Super Admin with password re-entry |
