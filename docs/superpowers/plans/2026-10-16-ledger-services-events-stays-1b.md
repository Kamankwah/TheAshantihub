# Services, Events and Stays in the Ledger — Implementation Plan (Stage 1b)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record every paid service request, stay booking and event-ticket purchase in the ledger exactly like a product order — the business's money held in Vendor Pending with a fee snapshotted from its own category table and counted against the one lifetime cap, released only on Support's positive verification call after the booking reached the customer, refunded only to the customer's AshantiHub wallet (cancellations, disputes, ticket refunds) — all behind `LEDGER_ENABLED` (default off), on simulated rails.

**Architecture:** One new model, `ledger.BookingSale` (one per paid booking: its subject, its fee snapshot, and Support's call), plus `ledger.BookingRefund`, and one new module `ledger/sales.py` that does for bookings what `escrow.py`, `verification.py` and `refunds.py` do for orders. The three payment finalizers in `payments/services.py` record the sale; a small `payments/booking_pay.py` gives the three pay endpoints the order checkout's "payment processing" line, the wallet option and the reconciliation mark. Support gets its own booking queue under `/api/ledger/bookings/`. The order code (`OrderFeeSnapshot`, `FulfilmentCheck`, `OrderRefund`, whose order FK is required) is not touched.

**Tech Stack:** Django 5.2, DRF, Postgres, Celery (eager under tests), the repo's `ledger`, `payments`, `wallets`, `services`, `bookings`, `events`, `disputes`, `notifications` apps.

**Spec:** `docs/superpowers/specs/2026-10-15-wallet-fees-security-design.md` — §1 rows 2, 3, 8, 9, 11, 14, 17; §2.2 steps 1–4; §3.1 (services and events seeded as copies), §3.2; §4.2 (services, events and stays, "settled in Plan 1b"); §5; §11; §13 D7, W1–W12, "Before LEDGER_ENABLED is turned on" (all three lists) and "Stage 3 carry-forward". Deviations found while reconciling it with the code are in §0 below; Task 1 records them in the spec.

**Depends on:** Stage 1 (ledger), Stage 2 (OTP), Stage 3a (wallets, payments, refunds) and Stage 3b (destinations, withdrawals, reconciliation), all on this branch (`feature/ledger-services-1b`, from `origin/righteoushack`). Uses from them: `ledger.posting` (`post`, `lock`, `account_for`, `balance_of`, `InsufficientFunds`, `PostingError`), `ledger.fees` (`quote`, `rule_set_in_force`, `charged_to_date`), `ledger.settings_store.current`, `ledger.escrow.enabled`, `ledger.refunds` (`RefundError`, `fee_share`), `ledger.verification.VerificationError`, `payments.providers.get_provider`, `payments.services.process_payment(..., processing_fee=, wallet=)`, `CheckoutSession.WALLET`, `wallets.reconciliation`, `wallets.services.LABELS` / `line_row`. **Plan 4** (vendor side and SMS) is planned separately; any part of it that reads or texts booking sales (`ledger.BookingSale`, `ledger.sales`, the booking journal kinds) must start only after this plan's last task.

**Commits:** every commit step ends with the two attribution trailers shown (`git commit ... --trailer ...`, git 2.32 or later). An executing session that was given its own attribution lines uses those instead.

## 0. Decisions and reconciliation with the code

How these bookings take payment today (surveyed 2026-10-16):

- **Services** (`services.ServiceRequest`): the customer requests, the business accepts with an `agreed_price`, the customer pays `POST /api/services/requests/<id>/pay/` → `process_payment(kind=SERVICE_REQUEST)` → `_finalize_service_request` (accepted → in_progress, `paid_at`). The business marks it done (`complete/`). There is no cancel path after payment. The accept view saves `price` from the body unchecked (a negative or three-decimal price is accepted).
- **Stays** (`bookings.Booking`): `POST /api/bookings/` creates the booking and pays in one call (`process_payment(kind=BOOKING)` → `_finalize_booking`: pending → confirmed). The customer may cancel a pending or confirmed booking (`cancel/`) and gets nothing back; the business checks the guest in and out.
- **Event tickets** (`events.Ticket`): `POST /api/events/<id>/tickets/purchase/` reserves `quantity_sold` under the ticket-type lock and pays (`process_payment(kind=TICKET_PURCHASE)` → `_finalize_ticket_purchase` creates the tickets on `session.transaction`). Ticket "escrow" is only flags (`escrow_status` held/released): a scan at the door flips it to released, the Accountant may release, hold or refund (a negative `billing.Transaction`); no money moves. An event can be organised by a **customer** (`Event.submitted_by_customer`), not only a business.
- **Event listing fees** (`EVENT_PAY`, `EVENT_RENEW`) are what an organiser pays AshantiHub to be listed: platform revenue, not a sale to a customer. Out of scope, like subscriptions.
- None of the three has a deposit, a coupon or a delivery fee. Each is one business and one customer.

| # | Question | Decision | Why (grounded in the code) |
|---|---|---|---|
| S1 | Where it lives | `ledger.BookingSale` (one row per paid service request, stay or ticket purchase) holds the subject, the fee snapshot and Support's call; `ledger.BookingRefund` one row per (sale, source). `ledger/sales.py` holds payment, hand-over, verification, release, refunds and cancel. Support's screens are `ledger/views_bookings.py` at `/api/ledger/bookings/`. The pay helper is `payments/booking_pay.py`. | `OrderFeeSnapshot`, `FulfilmentCheck` and `OrderRefund` all have a required FK to `orders.Order`; widening them would touch every Stage 1/3 path (release, refunds, Support's list) for no gain. A booking has exactly one business and one category, so its snapshot fits on the sale row. |
| S2 | Fee category and base | Services and stays use the **services** table, tickets the **events** table (spec §1 row 11), whatever category the listing or event sits in. Both tables already exist (ledger migration 0004 seeded them as copies of the product tiers). The base is what the server priced: `ServiceRequest.agreed_price`, `Booking.total_price`, or the ticket `unit_price` × `quantity` on the session; it must equal what the customer paid less the processing charge, else `PostingError` and nothing is written. GH₵ 0.00 bookings record nothing. | Spec §3.2. There is no coupon or delivery on a booking, so base = paid − processing (spec §1 row 3 holds trivially). |
| S3 | Lifetime cap | `fees.charged_to_date` sums order snapshots **and** booking sales (charged − refunded fee, not reversed). A booking payment locks the business's Pending account before reading it, as `escrow.record_order_payment` does, so a product and a booking payment at once never both see the same remainder. | Spec §1 row 2 ("cumulative across categories"); §13 (iii) asked for the cap race test, which Task 2 adds across categories. |
| S4 | Journals | `booking-pay-<session reference>` (kind `booking_payment`: Dr provider clearing — or customer wallet — Cr vendor Pending); `booking-release-<sale>` (`booking_release`: Dr Pending, Cr platform fee income, Cr vendor Available); `booking-refund-<sale>-<source>` (`booking_refund`). `reference_type="ledger.bookingsale"`. | The pay key names the session so the nightly reconciliation can expect it from the session alone (a payment whose sale was never written still has a key to miss). |
| S5 | "Handed over" (spec §4.2 leaves it to this plan) | Service: the business marked it done (`completed_at`). Stay: the guest checked in (`checked_in_at`). Tickets: the first scan of any ticket of the purchase, or else the event's date once it has passed. Derived from those existing stamps; no new hook. | §4.2: "the service is done, the event has taken place or the stay has begun". |
| S6 | Receipt confirmed | Support records it on the call (`customer_confirmed_by_phone`), or a ticket of the purchase was scanned at the door. No customer "confirm" endpoint here (the frontend plan may add one). | §4.2 "the customer confirms (or Support records it on the call)"; Support calls every booking anyway before release. |
| S7 | The 72-hour clock | For bookings it runs from **hand-over**, not from purchase: Support's "due by", the overdue flag and a mismatch dispute's `answer_due_at` are hand-over + `verification_overdue_hours`. | A service, stay or event can be paid weeks before it happens; "72 hours of purchase" would already be over at hand-over. Provisional: owner to confirm (SA5; spec gate (lvii)). |
| S8 | Verification and release | The same three outcomes as products (`matches` → release at once, fee first; `does_not_match` → a `Dispute`; `unreachable` → recorded). The dispute is logged the disputes way — `order` null, `raised_by` null, `logged_by` the staff member (unlike the product path, spec (v)) — and linked on the sale; only that dispute blocks release. | `Dispute` has only an order FK; customers raise disputes only against orders. |
| S9 | Tickets' escrow flags | With the ledger on and a sale behind the ticket: a scan no longer flips `escrow_status` to released; release flips the purchase's unrefunded tickets; the manual release and hold answer `409 ledger_on`; the Accountant's ticket refund pays the ticket's price to the wallet (source `ticket-<id>`) and still writes its REFUNDED `billing.Transaction`. Without a sale (ledger off, or a customer-organised event) everything is as today. | Otherwise the Accountant's ticket screen would show money "released" that the ledger still holds in Pending, and a manual release would bypass Support's call (owner rule 17). |
| S10 | Customer-organised events | Tickets for an event `submitted_by_customer` are **not recorded** (no business to hold money for): MoMo only (`409 wallet_not_accepted` for the wallet), no processing charge, no reconciliation mark. | `BookingSale.business_owner` and vendor wallets are businesses only. Owner to decide (SA7; gate (liv)). |
| S11 | Paying | The three pay endpoints take `payment_method` (`momo` default, `wallet`) and, while the ledger is on, carry the provider's collection charge on top of MoMo ("payment processing") and mark the session `metadata["ledger"]`, exactly like order checkout. A wallet must cover the whole booking, else `409 insufficient_funds` and nothing is kept (no booking, no reservation, the request stays accepted). The service-request payment becomes one transaction. The ticket purchase's 201 stays a list of tickets (it carries no `payment_processing`; its redirect answer does). | Spec §5, §1 row 14; 3a W2/W3. `process_payment` refused the wallet for anything but orders. |
| S12 | Refunds | Always to the wallet, one `BookingRefund` per sale and source. Before release out of Pending (the fee on it is never charged); after release out of Available (may go negative) with the fee returned in proportion (cumulative, half up: `refunds.fee_share`). The processing charge only on fault (`refund_processing`), its share on a partial refund. The refund that empties a sale reverses it (frees the cap) and cancels a booking not yet handed over: a service in progress → cancelled, a stay not checked in → cancelled (nights freed), tickets not scanned → refunded. | 3a W4/D6/D7 rules, with one snapshot per sale. |
| S13 | Cancellations and disputes | A customer's cancel of a paid stay before check-in refunds it whole at once. Support may cancel any booking not yet handed over (`POST /api/ledger/bookings/<id>/cancel/`, `orders.support_update`, like Support's order cancel): whole refund, no processing charge back. A booking already handed over is a dispute, not a cancel (409). `DisputeResolveView` refunds a booking dispute through `sales.refund` with the same `dispute-<id>` source rule. | Support's order cancel (3a A7) is the model. A paid service request has no cancel path at all today. |
| S14 | No-shows | Not handled: the spec decides nothing. A stay never checked in, a service never marked done, tickets for an event that never happened keep their money in Pending until Support cancels or verifies. | The brief: "no-show handling only if the spec decides it". Owner question (SA6; gate (lv)). |
| S15 | Lock order | The service request or stay booking row (tickets: the purchase's ticket rows in primary-key order), then the sale row, then the ledger accounts in one sorted pass (`posting.lock`). `sales.lock(sale)` takes the first two; the hand-over steps (service done, check-in, ticket scan) now lock their own row, so a refund and a hand-over never cross. | 3a W7 extended. Without the row locks, a check-in read before a cancel commits could re-open a cancelled, refunded stay. |
| S16 | Price check | A service request's `price` must be digits with at most two decimals and above GH₵ 0.00 (`400 {"price": ...}`), ledger on or off. | S2's equality check needs a sane price; a negative `agreed_price` would otherwise be paid as a negative checkout. |
| S17 | Ledger off | Nothing is recorded, no session is marked, the three pay endpoints (for a request that sends no `payment_method`; like order checkout, an unknown method answers 400 and `wallet` 409 `ledger_off` either way), the cancel, the ticket check-in and escrow views and dispute resolution answer exactly as today; the service accept's price check (S16) applies either way; `/api/ledger/bookings/*` answers `409 {"code": "ledger_off"}`. | Spec §11; every Stage 1–3 switch-off rule. |
| S18 | Reconciliation and statements | `wallets.reconciliation` expects `booking-pay-<reference>` for the three kinds when the session is marked; the holder statement labels `booking_payment` / `booking_release` / `booking_refund` and gives the sale id as `booking`. | 3b E10 skipped these kinds only because the ledger did not record them. |

## Global Constraints

- Everything in Plan 3a's and 3b's Global Constraints applies: integer pesewas converted only through `ledger.money`; a balance changes only inside `ledger.posting.post`; `LEDGER_ENABLED` (default off) gates everything; simulated rails only; nothing moves real money.
- New journal keys and kinds: `booking-pay-<session reference>` (`booking_payment`), `booking-release-<sale id>` (`booking_release`), `booking-refund-<sale id>-<source>` (`booking_refund`); `reference_type="ledger.bookingsale"`, `reference_id` the sale id. Refund sources: `cancel`, `dispute-<id>`, `ticket-<id>`.
- **Lock order:** subject row (service request / stay booking; tickets: the purchase's tickets in primary-key order) → the sale row → ledger accounts in primary-key order, taken in one pass with `posting.lock(...)` before any balance-based decision, inside `transaction.atomic()`. Every booking money step after payment goes through `sales.lock(sale)` first (dispute resolution takes the dispute row before it, as for orders).
- **No timer releases a business's money:** release happens only in `sales.record_verification` on `matches`, after hand-over and the customer's confirmation, with no open dispute.
- Refunds go **only** to the customer's AshantiHub wallet. Vendor Available may go negative after a late refund; no other holder balance may go below zero.
- Platform fees are never shown to customers; a customer sees the price and "payment processing".
- The customer's phone appears only on the `orders.verify`-gated booking queue (as on the products queue).
- Fee categories: services and stays `FeeRuleSet.SERVICE`, tickets `FeeRuleSet.EVENT`; no new fee seed (ledger 0004 already seeded both).
- Tests: Django `TestCase` / `APIClient`; `@override_settings(LEDGER_ENABLED=True)`; staff tokens through `accounts.testing.staff_token(staff, sudo=...)`; customers and owners through `accounts.authentication.issue_token(account, "customer" | "business_owner")`; `cache.clear()` in `setUp`; time travel by back-dating rows with `.update(...)` (never journals: they are append-only); threaded `TransactionTestCase` with `serialized_rollback = True` only for the cap race, the ticket-refund race and the same-moment races (two taps on Pay; a check-in against a cancel).
- Commands, from `/home/righteoushack/projects/TheAshantihub/.worktrees/wallets`: `docker compose -p svc1 run --rm web python manage.py test <label> --noinput`. Never run two docker commands at once.
- Migrations (check with `ls backend/ledger/migrations`): today's ledger leaf is `0007_order_refunds`. This plan adds one generated migration, `ledger/0008_booking_sales.py` (Task 1). No accounts migration (`orders.verify`, `orders.support_update`, `escrow.refund`, `disputes.resolve_financial` already exist).
- Style: module docstrings, no type annotations, tests in `<app>/tests/`, plain words in user-facing messages, GH₵ in API messages.

## Review Focus

1. **The lifetime cap across categories, at the same moment** — a product order and a service for one business paid at once, with GH₵ 6.00 of cap left and GH₵ 5.00 due on each: together they charge exactly GH₵ 6.00. Pinned in Task 2 (`CapRaceTests.test_review_focus_a_product_and_a_service_paid_at_once_never_pass_the_cap`) and Task 2 (`test_review_focus_the_lifetime_cap_is_shared_with_product_orders`).
2. **A payment confirmed twice, or for the wrong amount** — Hubtel retrying the success callback records one sale and one journal; a paid amount that is not the price writes nothing. Pinned in Task 3 (`test_review_focus_a_confirmation_that_arrives_twice_records_once`), Task 2 (`test_recording_twice_keeps_one_sale_and_one_journal`) and Task 2 (`test_review_focus_a_payment_that_does_not_match_the_price_writes_nothing`).
3. **Release at the wrong moment** — refused before hand-over, without the customer's confirmation, while a mismatch dispute is open, after a whole refund; a refund then "matches" pays only the rest. Pinned in Task 5 (`test_a_service_is_released_once_done_and_confirmed_fee_first`, `test_review_focus_a_mismatch_opens_a_dispute_due_72_hours_after_hand_over_and_releases_nothing`) and Task 7 (`test_review_focus_a_refund_then_matches_pays_only_the_rest`, `test_review_focus_a_wholly_refunded_booking_is_never_released_and_leaves_supports_list`).
4. **Refund arithmetic** — the same source refunds once; more than is left writes nothing; fee given back in three parts adds up to the fee taken (1.67 + 1.66 + 1.67); a late refund may drive Available below zero. Pinned in Task 7 (`test_review_focus_the_same_source_refunds_once_and_more_than_is_left_writes_nothing`, `test_review_focus_fee_given_back_in_parts_adds_up_to_the_fee_taken`, `test_a_refund_after_release_may_drive_available_below_zero`).
5. **A wallet that covers only part of a booking** — refused with `409 insufficient_funds`; no booking, no session, no ticket reservation, no sale survives, the service request stays accepted, the wallet untouched. Pinned in Task 4 (`test_review_focus_a_wallet_that_covers_only_part_pays_nothing_and_keeps_nothing`).
6. **A hand-over racing a refund** — two ticket refunds from one purchase at once both land (no deadlock); a check-in and a cancel of one stay at once never both land, because both lock the booking row. Pinned in Task 8 (`TicketRefundRaceTests.test_review_focus_two_ticket_refunds_from_one_purchase_at_once_both_land`, `SameMomentRaceTests.test_review_focus_a_check_in_and_a_cancel_at_once_never_both_land`, and the sequential `test_review_focus_a_cancelled_stay_cannot_be_checked_in`).
7. **A service accepted at a negative or fractional price** — refused at accept (400), so it can never be paid. Pinned in Task 3 (`test_review_focus_a_service_price_must_be_above_zero_with_two_decimals_at_most`).
8. **Switches-off regression** — with the ledger off the three pay endpoints, the customer's stay cancel and the ticket views answer as today and open no account; the booking screens say `ledger_off`. Pinned in Task 3 (`test_review_focus_with_the_ledger_off_paying_is_exactly_as_before`), Task 6 (`test_review_focus_with_the_ledger_off_the_booking_screens_say_so`) and Task 8 (`test_review_focus_with_the_ledger_off_a_cancelled_stay_moves_no_money`).
9. **Two taps on Pay** — a service request paid from the wallet twice at once records one payment: one SUCCESS session, one sale, one debit; the second tap answers 400. Pinned in Task 8 (`SameMomentRaceTests.test_review_focus_two_taps_on_pay_charge_a_service_request_once`).

## Assumptions made (decided here, cheap to change — for the owner to confirm)

- **SA1** Services and stays share the services fee table; tickets use the events table. Both start as copies of the product tiers; the owner sets their real values before launch (spec §12).
- **SA2** Handed over = the business marks the service done; the guest is checked in; a ticket of the purchase is scanned, or the event's date has passed.
- **SA3** Support calls the customer for every booking before release — once per ticket purchase, not per ticket — even when a ticket was scanned (the scan counts as the customer's confirmation, not as the call).
- **SA4** A customer's cancel of a paid stay before check-in is a full refund to the wallet at once, with no deadline or fee; Support may cancel any booking not yet handed over with a full refund. The processing charge stays with the provider (the customer asked).
- **SA5** For bookings, the 72-hour verification window runs from hand-over, not from purchase. This is a provisional assumption the spec does not state (§4.1 says "of purchase" for products; §4.2 fixes the length, not the start); it awaits the owner (gate (lvii)).
- **SA6** No-shows are not handled automatically; their money stays in Pending until Support acts.
- **SA7** Paid tickets for an event a customer organised stay outside the ledger (MoMo only) until the owner decides whether organisers must register as a business.
- **SA8** Bookings pay like orders: "payment processing" on top of MoMo; a wallet must cover the whole price.
- **SA9** The Accountant's ticket refund gives the ticket's price back to the wallet (not the processing charge) and is refused for a scanned ticket, as today.

## File Structure

Create:
- `backend/ledger/sales.py` — booking sales: payment (Task 2), hand-over, verification, release, Support's queue (Tasks 5–6), refunds and cancel (Tasks 7–8)
- `backend/ledger/views_bookings.py` — Support's booking queue, the call, the cancel (Tasks 6, 8)
- `backend/ledger/migrations/0008_booking_sales.py` (generated, Task 1)
- `backend/payments/booking_pay.py` — paying a booking like an order (Tasks 3–4)
- `backend/ledger/tests/booking_helpers.py` (fixtures), `test_booking_models.py`, `test_booking_payment.py`, `test_booking_wiring.py`, `test_booking_wallet.py`, `test_booking_release.py`, `test_booking_verification_api.py`, `test_booking_refunds.py`, `test_booking_refund_wiring.py`

Modify:
- `backend/ledger/models.py` (`BookingSale`, `BookingRefund`), `backend/ledger/fees.py` (`charged_to_date`), `backend/ledger/urls.py`
- `backend/payments/services.py` (three finalizers, the wallet guard)
- `backend/services/views.py` (price check, pay, complete), `backend/bookings/views.py` (create, cancel, check-in), `backend/events/views.py` (purchase, check-in, escrow release/hold/refund)
- `backend/disputes/views.py` (resolve)
- `backend/wallets/reconciliation.py`, `backend/wallets/services.py`
- `backend/CLAUDE.md`, `CLAUDE.md`, `docs/IMPLEMENTATION_INSTRUCTIONS.md`, `docs/superpowers/specs/2026-10-15-wallet-fees-security-design.md`

API added or changed:

| Method + path | Who | Body → answer |
|---|---|---|
| `POST /api/services/requests/<id>/respond/` | owner | accept: `price` must be digits, at most two decimals, above 0 → else `400 {"price": "Enter a price in GH₵ above 0.00, like 150.00."}` (ledger on or off) |
| `POST /api/services/requests/<id>/pay/` | customer | + optional `payment_method` (`momo`, `wallet`). Ledger on: body + `payment_method`, `payment_processing`. `409 insufficient_funds` / `ledger_off`, `400 payment_method` |
| `POST /api/bookings/` | customer | + optional `payment_method`; ledger on: body + `payment_method`, `payment_processing`; same refusals |
| `POST /api/events/<id>/tickets/purchase/` | customer | + optional `payment_method`; 201 still a list; `409 wallet_not_accepted` (customer-organised event), `insufficient_funds`, `ledger_off` |
| `POST /api/bookings/<id>/cancel/` | customer | ledger on and paid: refunded whole to the wallet, body + `wallet_refund` |
| `POST /api/events/<id>/tickets/checkin/` | organiser, staff | ledger on: the ticket stays `held` (released by Support's call) |
| `POST /api/events/tickets/<id>/escrow/release/`, `hold/` | `escrow.release` | ledger on, ticket in a sale: `409 {"code": "ledger_on"}` |
| `POST /api/events/tickets/<id>/escrow/refund/` | `escrow.refund` + password | ledger on, ticket in a sale: its price to the wallet, body + `wallet_refund` |
| `POST /api/disputes/<id>/resolve/` | unchanged | a booking's mismatch dispute with `refund_amount`: refunded to the wallet, body + `wallet_refund` |
| `GET /api/ledger/bookings/awaiting-verification/` | `orders.verify` | paginated `{sale_id, kind, label, what, paid_at, handed_over_at, due_by, overdue, business, customer_name, customer_phone, amount, customer_confirmed, outcome, outcome_note, dispute_id}` |
| `POST /api/ledger/bookings/<id>/verification/` | `orders.verify` | `{outcome, note?, customer_confirmed_by_phone?}` → `{sale, outcome, dispute_id, released}`; 400/409 `{detail}` |
| `POST /api/ledger/bookings/<id>/cancel/` | `orders.support_update` | `{reason}` → `{sale, refunded}`; 409 `{detail}` once handed over, released or refunded |

---

### Task 1: The booking-sale models, the cap across categories, and the spec addendum

**Files:**
- Modify: `backend/ledger/models.py` (append), `backend/ledger/fees.py` (`charged_to_date`, the models import), `docs/superpowers/specs/2026-10-15-wallet-fees-security-design.md` (append)
- Create: `backend/ledger/migrations/0008_booking_sales.py` (generated), `backend/ledger/tests/test_booking_models.py`

**Interfaces:**
- Consumes: `ledger.models.FeeRuleSet`, `FulfilmentCheck.OUTCOME_CHOICES`, `Journal`.
- Produces:
  - model `ledger.BookingSale` with constants `SERVICE = "service"`, `STAY = "stay"`, `TICKETS = "tickets"`; fields `kind`, `session` (OneToOne `payments.CheckoutSession`, `related_name="booking_sale"`), `service_request` (OneToOne, null, `related_name="sale"`), `booking` (OneToOne, null, `related_name="sale"`), `event` (FK, null, `related_name="ticket_sales"`), `customer`, `business_owner` (`related_name="booking_sales"`), `category`, `rule_set`, `base_pesewas`, `computed_pesewas`, `charged_pesewas`, `cap_pesewas`, `refunded_base_pesewas`, `refunded_fee_pesewas`, `paid_at`, `released_at`, `reversed_at`, `phone_confirmed_at`, `outcome`, `outcome_note`, `outcome_at`, `outcome_by`, `dispute`, `created_at`; method `label() -> str` ("service request #12", "stay booking #4", "tickets for event #3")
  - model `ledger.BookingRefund(sale, source, whole, released, amount_pesewas, fee_pesewas, processing_pesewas, journal, created_by, note, created_at)`, unique on `(sale, source)`, `related_name="refunds"` on the sale
  - `fees.charged_to_date(owner)` = Σ (charged − refunded fee) over order snapshots **and** booking sales not reversed

- [ ] **Step 1: Write the failing test** — `backend/ledger/tests/test_booking_models.py`

```python
"""Booking sales in the ledger (Plan 1b, Task 1): one subject per sale, of its own kind, and the lifetime cap counted
across products, services, stays and events (spec §1 row 2)."""
from datetime import timedelta
from decimal import Decimal

from django.db import IntegrityError, transaction
from django.test import TestCase
from django.utils import timezone

from accounts.models import BusinessOwner, Customer
from bookings.models import Booking
from ledger import fees, posting
from ledger.models import Account, BookingRefund, BookingSale, FeeRuleSet, OrderFeeSnapshot
from listings.models import Category, Listing, Zone
from orders.models import Order
from payments.models import CheckoutSession
from services.models import ServiceRequest


class BookingSaleModelTests(TestCase):
    def setUp(self):
        self.customer = Customer.objects.create(full_name="Ama", phone="+233200770101", password_hash="x")
        self.owner = BusinessOwner.objects.create(full_name="Kwame", login_phone="+233207770101", password_hash="x")
        category = Category.objects.create(slug="cleaning-1b-models", label="Cleaning", kind="service")
        self.listing = Listing.objects.create(
            business_owner=self.owner, category=category, zone=Zone.objects.get(name="Manhyia"), name="Home Cleaning",
            description="D.", contact_phone=self.owner.login_phone, price_amount=Decimal("200.00"), status=Listing.PUBLISHED,
        )

    def service_request(self):
        return ServiceRequest.objects.create(
            customer=self.customer, listing=self.listing, business_owner=self.owner, message="M.",
            agreed_price=Decimal("200.00"), status=ServiceRequest.IN_PROGRESS,
        )

    def booking(self):
        today = timezone.localdate()
        return Booking.objects.create(
            customer=self.customer, listing=self.listing, business_owner=self.owner, check_in=today,
            check_out=today + timedelta(days=1), nightly_rate=Decimal("200.00"), total_price=Decimal("200.00"),
        )

    def sale(self, kind=BookingSale.SERVICE, charged=500, **subject):
        session = CheckoutSession.objects.create(
            customer=self.customer, kind=CheckoutSession.SERVICE_REQUEST, amount=Decimal("200.00"), purpose="Service",
        )
        return BookingSale.objects.create(
            kind=kind, session=session, customer=self.customer, business_owner=self.owner, category=FeeRuleSet.SERVICE,
            rule_set=fees.rule_set_in_force(FeeRuleSet.SERVICE), base_pesewas=20000, computed_pesewas=charged,
            charged_pesewas=charged, paid_at=timezone.now(), **subject,
        )

    def test_a_sale_names_the_one_subject_its_kind_names(self):
        sale = self.sale(service_request=self.service_request())
        self.assertEqual(sale.label(), f"service request #{sale.service_request_id}")
        with self.assertRaises(IntegrityError), transaction.atomic():
            self.sale(kind=BookingSale.STAY, service_request=self.service_request())          # a stay names a booking
        with self.assertRaises(IntegrityError), transaction.atomic():
            self.sale(kind=BookingSale.STAY, booking=self.booking(), service_request=self.service_request())
        stay = self.sale(kind=BookingSale.STAY, booking=self.booking())
        self.assertEqual(stay.label(), f"stay booking #{stay.booking_id}")

    def test_a_refund_never_exceeds_the_base(self):
        sale = self.sale(service_request=self.service_request())
        with self.assertRaises(IntegrityError), transaction.atomic():
            BookingSale.objects.filter(pk=sale.pk).update(refunded_base_pesewas=20001)

    def test_one_refund_per_sale_and_source(self):
        sale = self.sale(service_request=self.service_request())

        def journal(key):
            return posting.post(key=key, kind="test_refund", lines=[
                posting.debit(posting.account_for(Account.PROVIDER_CLEARING), 100),
                posting.credit(posting.account_for(Account.CUSTOMER_WALLET, self.customer), 100),
            ])

        BookingRefund.objects.create(sale=sale, source="cancel", amount_pesewas=100, journal=journal("test-booking-refund-1"))
        with self.assertRaises(IntegrityError), transaction.atomic():
            BookingRefund.objects.create(sale=sale, source="cancel", amount_pesewas=100, journal=journal("test-booking-refund-2"))

    def test_review_focus_the_lifetime_cap_counts_every_category(self):
        order = Order.objects.create(customer=self.customer, status=Order.PAID, total_amount=Decimal("100.00"))
        OrderFeeSnapshot.objects.create(
            order=order, business_owner=self.owner, category=FeeRuleSet.PRODUCT,
            rule_set=fees.rule_set_in_force(FeeRuleSet.PRODUCT), base_pesewas=10000, computed_pesewas=500, charged_pesewas=500,
        )
        self.sale(charged=500, service_request=self.service_request())
        partly = self.sale(charged=500, service_request=self.service_request())
        BookingSale.objects.filter(pk=partly.pk).update(refunded_base_pesewas=8000, refunded_fee_pesewas=200)
        gone = self.sale(charged=500, service_request=self.service_request())
        BookingSale.objects.filter(pk=gone.pk).update(refunded_base_pesewas=20000, refunded_fee_pesewas=500, reversed_at=timezone.now())
        self.assertEqual(fees.charged_to_date(self.owner), 500 + 500 + 300)
        other = BusinessOwner.objects.create(full_name="Esi", login_phone="+233207770102", password_hash="x")
        self.assertEqual(fees.charged_to_date(other), 0)
```

- [ ] **Step 2: Run it to see it fail**

Run: `docker compose -p svc1 run --rm web python manage.py test ledger.tests.test_booking_models --noinput`
Expected: ERROR — `ImportError: cannot import name 'BookingRefund' from 'ledger.models'`.

- [ ] **Step 3: Add the models** — append to `backend/ledger/models.py`

```python


class BookingSale(models.Model):
    """A paid service request, stay booking or event-ticket purchase in the ledger (Plan 1b; spec §4.2): one customer,
    one business and one fee category. The platform fee is fixed on the row at payment (spec §3.2 step 4), so later rule
    or cap edits never change it; `refunded_*` and `reversed_at` work as on OrderFeeSnapshot, and Support's verification
    call is recorded here as FulfilmentCheck records it for an order. Exactly one subject is set, the one its kind
    names: the service request, the stay booking, or (tickets) the event; a purchase's tickets are those on its
    session's transaction (Ticket.transaction). Written only by ledger.sales."""

    SERVICE, STAY, TICKETS = "service", "stay", "tickets"
    KIND_CHOICES = [(SERVICE, "Service"), (STAY, "Stay"), (TICKETS, "Event tickets")]

    kind = models.CharField(max_length=8, choices=KIND_CHOICES)
    session = models.OneToOneField("payments.CheckoutSession", on_delete=models.PROTECT, related_name="booking_sale")
    service_request = models.OneToOneField(
        "services.ServiceRequest", null=True, blank=True, on_delete=models.PROTECT, related_name="sale",
    )
    booking = models.OneToOneField("bookings.Booking", null=True, blank=True, on_delete=models.PROTECT, related_name="sale")
    event = models.ForeignKey("events.Event", null=True, blank=True, on_delete=models.PROTECT, related_name="ticket_sales")
    customer = models.ForeignKey("accounts.Customer", on_delete=models.PROTECT, related_name="booking_sales")
    business_owner = models.ForeignKey("accounts.BusinessOwner", on_delete=models.PROTECT, related_name="booking_sales")
    category = models.CharField(max_length=10, choices=FeeRuleSet.CATEGORY_CHOICES)
    rule_set = models.ForeignKey(FeeRuleSet, on_delete=models.PROTECT, related_name="+")
    base_pesewas = models.BigIntegerField()
    computed_pesewas = models.BigIntegerField()
    charged_pesewas = models.BigIntegerField()
    cap_pesewas = models.BigIntegerField(null=True, blank=True)
    refunded_base_pesewas = models.BigIntegerField(default=0)
    refunded_fee_pesewas = models.BigIntegerField(default=0)
    paid_at = models.DateTimeField()
    released_at = models.DateTimeField(null=True, blank=True)
    reversed_at = models.DateTimeField(null=True, blank=True)
    phone_confirmed_at = models.DateTimeField(null=True, blank=True)
    outcome = models.CharField(max_length=14, choices=FulfilmentCheck.OUTCOME_CHOICES, blank=True, default="")
    outcome_note = models.CharField(max_length=500, blank=True, default="")
    outcome_at = models.DateTimeField(null=True, blank=True)
    outcome_by = models.ForeignKey("accounts.StaffUser", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    dispute = models.ForeignKey("disputes.Dispute", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["paid_at", "id"]
        indexes = [
            models.Index(fields=["business_owner", "reversed_at"]),
            models.Index(fields=["released_at", "reversed_at"]),
        ]
        constraints = [
            models.CheckConstraint(
                condition=(
                    models.Q(kind="service", service_request__isnull=False, booking__isnull=True, event__isnull=True)
                    | models.Q(kind="stay", service_request__isnull=True, booking__isnull=False, event__isnull=True)
                    | models.Q(kind="tickets", service_request__isnull=True, booking__isnull=True, event__isnull=False)
                ),
                name="ledger_booking_sale_one_subject_of_its_kind",
            ),
            models.CheckConstraint(
                condition=models.Q(refunded_base_pesewas__lte=models.F("base_pesewas")),
                name="ledger_booking_sale_refund_within_base",
            ),
        ]

    def label(self):
        if self.kind == self.SERVICE:
            return f"service request #{self.service_request_id}"
        if self.kind == self.STAY:
            return f"stay booking #{self.booking_id}"
        return f"tickets for event #{self.event_id}"

    def __str__(self):
        return f"Booking sale {self.pk}: {self.label()}"


class BookingRefund(models.Model):
    """Money given back to a customer for a booking sale, always into their AshantiHub wallet (ledger.sales.refund).
    One row per (sale, source) — "cancel", "dispute-<id>", "ticket-<id>" — so the same request never refunds twice.
    Pesewas: `amount_pesewas` is booking money returned to the customer; `fee_pesewas` the share of the platform fee that
    went with it (taken back from platform fee income when `released`, otherwise simply never charged);
    `processing_pesewas` a collection charge AshantiHub gave back on its own or the business's error."""

    sale = models.ForeignKey(BookingSale, on_delete=models.PROTECT, related_name="refunds")
    source = models.CharField(max_length=60)
    whole = models.BooleanField(default=False)
    released = models.BooleanField(default=False)
    amount_pesewas = models.BigIntegerField()
    fee_pesewas = models.BigIntegerField(default=0)
    processing_pesewas = models.BigIntegerField(default=0)
    journal = models.OneToOneField(Journal, on_delete=models.PROTECT, related_name="booking_refund")
    created_by = models.ForeignKey("accounts.StaffUser", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    note = models.CharField(max_length=300, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "id"]
        constraints = [models.UniqueConstraint(fields=["sale", "source"], name="ledger_one_booking_refund_per_source")]

    def __str__(self):
        return f"Refund {self.source} on booking sale {self.sale_id}"
```

- [ ] **Step 4: Count booking sales against the cap** — in `backend/ledger/fees.py` replace

```python
from .models import FeeRuleSet, OrderFeeSnapshot
```

with

```python
from .models import BookingSale, FeeRuleSet, OrderFeeSnapshot
```

and replace

```python
def charged_to_date(owner):
    """Fees charged to `owner` so far, for the lifetime cap: every snapshot not fully reversed, less the part of its
    fee a refund gave back (ledger.refunds)."""
    total = OrderFeeSnapshot.objects.filter(business_owner=owner, reversed_at__isnull=True).aggregate(
        total=Sum(F("charged_pesewas") - F("refunded_fee_pesewas"))
    )["total"]
    return total or 0
```

with

```python
def charged_to_date(owner):
    """Fees charged to `owner` so far, for the lifetime cap, across every category (spec §1 row 2): every product-order
    snapshot and every booking sale (Plan 1b) not fully reversed, less the part of its fee a refund gave back."""
    remaining = Sum(F("charged_pesewas") - F("refunded_fee_pesewas"))
    orders = OrderFeeSnapshot.objects.filter(business_owner=owner, reversed_at__isnull=True).aggregate(total=remaining)["total"]
    bookings = BookingSale.objects.filter(business_owner=owner, reversed_at__isnull=True).aggregate(total=remaining)["total"]
    return (orders or 0) + (bookings or 0)
```

- [ ] **Step 5: Generate the migration**

Run: `docker compose -p svc1 run --rm web python manage.py makemigrations ledger --name booking_sales`
Expected: `ledger/migrations/0008_booking_sales.py` with `Create model BookingSale`, `Create model BookingRefund` and the indexes and constraints.

- [ ] **Step 6: Run the tests**

Run: `docker compose -p svc1 run --rm web python manage.py test ledger --noinput`
Expected: PASS (4 new tests; the rest of `ledger` unchanged: `charged_to_date` also feeds every order payment).

- [ ] **Step 7: Record the decisions in the spec.** Append to the end of `docs/superpowers/specs/2026-10-15-wallet-fees-security-design.md`:

```markdown

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
- (lvii) **The 72-hour window for bookings runs from hand-over,** not from purchase, because a booking can be paid weeks
  before it happens. Owner to confirm.
- (lviii) **Cancellation policy.** A customer's cancel of a paid stay before check-in and Support's cancel of a booking
  not yet handed over refund it in full, with no deadline or fee (the processing charge stays with the provider). Owner
  to decide.
- (lix) **A service request paid twice** (two Hubtel checkouts started for one accepted request, both paid) records only
  the first; the second is never recorded (no sale, no journal; the provider holds the money) and the reconciliation reports it `missing_in_ledger`. Refuse a second
  checkout while one is open, or refund the duplicate, before switch-on.
- (lx) **Booking finalizers share the webhook failure mode (i)/(vii):** a finalizer that raises (a paid amount that is not
  the price) leaves a paid booking unrecorded with `processed=False`.
- (lxi) **Reports.** `billing.TransactionReportView` (ix) also counts wallet-paid bookings as cash, and
  `insights/sales.refunds_total` does not count `BookingRefund`. Ticket refunds still write their old REFUNDED
  `billing.Transaction` as well; do not count them twice when (ix) is fixed.
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
```

- [ ] **Step 8: Commit**

```bash
git add backend/ledger/models.py backend/ledger/fees.py backend/ledger/migrations/0008_booking_sales.py backend/ledger/tests/test_booking_models.py docs/superpowers/specs/2026-10-15-wallet-fees-security-design.md
git commit -m "feat(ledger): booking sales and refunds; the lifetime cap counts every category (1b)" --trailer "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>" --trailer "Claude-Session: https://claude.ai/code/session_01HDHNosHkqu4Wwocp7a2c8j"
```

---

### Task 2: Recording a paid booking — the sale, its fee, the payment journal

**Files:**
- Create: `backend/ledger/sales.py`, `backend/ledger/tests/booking_helpers.py`, `backend/ledger/tests/test_booking_payment.py`

**Interfaces:**
- Consumes: `BookingSale` (Task 1), `fees.quote(category, base, *, cap, already_charged, at)`, `fees.charged_to_date(owner)`, `settings_store.current("fee_cap_pesewas", at)`, `posting.account_for/lock/post/debit/credit`, `escrow.enabled()`, `CheckoutSession.WALLET`.
- Produces (module `ledger.sales`):
  - `CATEGORY = {SERVICE: "service", STAY: "service", TICKETS: "event"}`, `SUBJECT = {SERVICE: "service_request", STAY: "booking", TICKETS: "event"}`
  - `pay_key(session) -> "booking-pay-<reference>"`, `release_key(sale) -> "booking-release-<id>"`, `refund_key(sale, source) -> "booking-refund-<id>-<source>"`
  - `price_of(kind, subject, session) -> int` (pesewas)
  - `record_payment(session, kind, subject, business_owner, *, at=None) -> BookingSale | None`
- Produces (module `ledger.tests.booking_helpers`): `fund(customer, pesewas, key)`; class `BookingBase(TestCase)` with `self.customer`, `self.owner`, `self.zone`, `self.service` (a service listing, GH₵ 200.00), `self.lodge` (an accommodation listing, GH₵ 150.00 a night, 2 units), `self.event` (business-organised, in 10 days), `self.ticket_type` (GH₵ 50.00); methods `listing(name, price, category, **extra)`, `as_customer(customer=None)`, `as_owner()`, `as_staff(staff, sudo=False)`, `balance(kind, owner=None)`, `accepted_service(price="200.00")`, `pay_service(sr, method=None)`, `book_stay(nights=2, method=None, starts_in=1)`, `buy_tickets(quantity=2, method=None, event=None, ticket_type=None)`, `paid_service(price="200.00")`, `paid_stay(nights=2)`, `paid_tickets(quantity=2)` (the last three return the `BookingSale`; they need Task 3's wiring)

- [ ] **Step 1: Write the fixtures** — `backend/ledger/tests/booking_helpers.py`

```python
"""Fixtures for the booking-sale tests (Plan 1b; not test cases themselves)."""
from datetime import timedelta
from decimal import Decimal

from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, Customer
from accounts.testing import staff_token
from events.models import Event, EventTicketType
from ledger import posting
from ledger.models import Account, BookingSale
from listings.models import Category, Listing, Zone
from services.models import ServiceRequest


def fund(customer, pesewas, key):
    """Money in a customer's wallet through provider clearing, as a top-up leaves it."""
    posting.post(key=key, kind="test_fund", lines=[
        posting.debit(posting.account_for(Account.PROVIDER_CLEARING), pesewas),
        posting.credit(posting.account_for(Account.CUSTOMER_WALLET, customer), pesewas),
    ])


class BookingBase(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.customer = Customer.objects.create(full_name="Ama Owusu", phone="+233200770001", password_hash="x")
        self.owner = BusinessOwner.objects.create(full_name="Kwame Mensah", login_phone="+233207770001", password_hash="x")
        self.zone = Zone.objects.get(name="Manhyia")
        self.service = self.listing(
            "Home Cleaning", "200.00", Category.objects.create(slug="cleaning-1b", label="Cleaning", kind="service"),
        )
        self.lodge = self.listing(
            "Ashanti Lodge", "150.00",
            Category.objects.create(slug="lodge-1b", label="Lodge", kind="service", is_accommodation=True), units_total=2,
        )
        now = timezone.now()
        self.event = Event.objects.create(
            category=Category.objects.get(slug="festivals"), zone=self.zone, submitted_by_business=self.owner,
            name="Highlife Night", description="Live band.", address="Kumasi", event_date=now + timedelta(days=10),
            visibility_days=14, status=Event.APPROVED, paid_at=now, expires_at=now + timedelta(days=14),
        )
        self.ticket_type = EventTicketType.objects.create(event=self.event, name="Regular", price=Decimal("50.00"))

    def listing(self, name, price, category, **extra):
        return Listing.objects.create(
            business_owner=self.owner, category=category, zone=self.zone, name=name, description="D.",
            contact_phone=self.owner.login_phone, price_amount=Decimal(price), status=Listing.PUBLISHED, **extra,
        )

    def as_customer(self, customer=None):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(customer or self.customer, 'customer')}")

    def as_owner(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.owner, 'business_owner')}")

    def as_staff(self, staff, sudo=False):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(staff, sudo=sudo)}")

    def balance(self, kind, owner=None):
        return posting.balance_of(kind, owner)

    # --- buying through the real endpoints ---

    def accepted_service(self, price="200.00"):
        return ServiceRequest.objects.create(
            customer=self.customer, listing=self.service, business_owner=self.owner, message="Clean my house.",
            agreed_price=Decimal(price), status=ServiceRequest.ACCEPTED,
        )

    def pay_service(self, sr, method=None):
        self.as_customer()
        return self.client.post(f"/api/services/requests/{sr.pk}/pay/", {"payment_method": method} if method else {}, format="json")

    def book_stay(self, nights=2, method=None, starts_in=1):
        self.as_customer()
        check_in = timezone.localdate() + timedelta(days=starts_in)
        body = {
            "listing": self.lodge.pk, "check_in": check_in.isoformat(),
            "check_out": (check_in + timedelta(days=nights)).isoformat(), "units": 1,
        }
        if method:
            body["payment_method"] = method
        return self.client.post("/api/bookings/", body, format="json")

    def buy_tickets(self, quantity=2, method=None, event=None, ticket_type=None):
        self.as_customer()
        body = {"ticket_type": (ticket_type or self.ticket_type).pk, "quantity": quantity}
        if method:
            body["payment_method"] = method
        return self.client.post(f"/api/events/{(event or self.event).pk}/tickets/purchase/", body, format="json")

    # --- paid sales, ready for the later steps (they need the Task 3 wiring) ---

    def paid_service(self, price="200.00"):
        sr = self.accepted_service(price)
        response = self.pay_service(sr)
        assert response.status_code == 200, response.content
        return BookingSale.objects.get(service_request=sr)

    def paid_stay(self, nights=2):
        response = self.book_stay(nights)
        assert response.status_code == 201, response.content
        return BookingSale.objects.get(booking_id=response.json()["id"])

    def paid_tickets(self, quantity=2):
        response = self.buy_tickets(quantity)
        assert response.status_code == 201, response.content
        return BookingSale.objects.get(session__transaction__tickets__id=response.json()[0]["id"])
```

- [ ] **Step 2: Write the failing test** — `backend/ledger/tests/test_booking_payment.py`

```python
"""Recording a paid booking in the ledger (Plan 1b, Task 2): the sale, its fee from its own category table, the payment
journal, and the lifetime cap shared with product orders. Review Focus 1 (the cap across categories, also at the same
moment) and 2 (a payment that is not the price writes nothing)."""
import threading
from datetime import timedelta
from decimal import Decimal

from django.db import connection, transaction
from django.test import TransactionTestCase, override_settings
from django.utils import timezone

from accounts.models import BusinessOwner, Customer
from bookings.models import Booking
from ledger import escrow, fees, posting, sales
from ledger.models import Account, BookingSale, FeeBand, FeeRuleSet, Journal, MoneySetting, OrderFeeSnapshot
from listings.models import Category, Listing, Zone
from orders.models import Order, OrderItem
from payments.models import CheckoutSession
from services.models import ServiceRequest

from .booking_helpers import BookingBase, fund


@override_settings(LEDGER_ENABLED=True)
class RecordBookingPaymentTests(BookingBase):
    def session(self, kind, amount, *, wallet=False, processing="0.00", **metadata):
        return CheckoutSession.objects.create(
            customer=self.customer, kind=kind, amount=Decimal(amount), processing_fee=Decimal(processing),
            provider=CheckoutSession.WALLET if wallet else "simulated", status=CheckoutSession.SUCCESS, purpose="Test",
            metadata=metadata,
        )

    def service_sale(self, price="200.00", **kwargs):
        sr = self.accepted_service(price)
        session = self.session(CheckoutSession.SERVICE_REQUEST, price, service_request_id=sr.pk, **kwargs)
        return sales.record_payment(session, BookingSale.SERVICE, sr, self.owner)

    def test_a_paid_service_holds_its_price_in_pending_with_its_fee_snapshotted(self):
        sale = self.service_sale("200.00")
        self.assertEqual(
            (sale.kind, sale.category, sale.base_pesewas, sale.computed_pesewas, sale.charged_pesewas, sale.cap_pesewas),
            (BookingSale.SERVICE, FeeRuleSet.SERVICE, 20000, 500, 500, None),                       # GH₵ 5.00 flat band
        )
        self.assertEqual(sale.rule_set_id, fees.rule_set_in_force(FeeRuleSet.SERVICE).pk)
        journal = Journal.objects.get(key=f"booking-pay-{sale.session.reference}")
        self.assertEqual((journal.kind, journal.reference_type, journal.reference_id), ("booking_payment", "ledger.bookingsale", str(sale.pk)))
        self.assertEqual(self.balance(Account.PROVIDER_CLEARING), 20000)
        self.assertEqual(self.balance(Account.VENDOR_PENDING, self.owner), 20000)
        self.assertEqual(self.balance(Account.VENDOR_AVAILABLE, self.owner), 0)

    def test_stays_use_the_services_table_and_tickets_the_events_table(self):
        newer = FeeRuleSet.objects.create(category=FeeRuleSet.EVENT, effective_from=timezone.now() - timedelta(minutes=1))
        FeeBand.objects.create(rule_set=newer, lower_pesewas=0, upper_pesewas=None, percent_bp=300)        # events: 3%
        today = timezone.localdate()
        booking = Booking.objects.create(
            customer=self.customer, listing=self.lodge, business_owner=self.owner, check_in=today + timedelta(days=1),
            check_out=today + timedelta(days=3), nightly_rate=Decimal("150.00"), total_price=Decimal("300.00"),
            status=Booking.CONFIRMED,
        )
        stay = sales.record_payment(self.session(CheckoutSession.BOOKING, "300.00", booking_id=booking.pk), BookingSale.STAY, booking, self.owner)
        tickets = sales.record_payment(
            self.session(CheckoutSession.TICKET_PURCHASE, "100.00", unit_price="50.00", quantity=2),
            BookingSale.TICKETS, self.event, self.owner,
        )
        self.assertEqual((stay.category, stay.base_pesewas, stay.charged_pesewas), (FeeRuleSet.SERVICE, 30000, 500))
        self.assertEqual((tickets.category, tickets.base_pesewas, tickets.charged_pesewas), (FeeRuleSet.EVENT, 10000, 300))
        self.assertEqual((stay.booking, tickets.event), (booking, self.event))
        self.assertEqual(self.balance(Account.VENDOR_PENDING, self.owner), 40000)

    def test_review_focus_the_lifetime_cap_is_shared_with_product_orders(self):
        MoneySetting.objects.create(key="fee_cap_pesewas", value=700, effective_from=timezone.now() - timedelta(minutes=1))
        kente = self.listing("Kente", "120.00", Category.objects.get(slug="shops"))
        order = Order.objects.create(customer=self.customer, status=Order.PAID, total_amount=Decimal("120.00"))
        OrderItem.objects.create(order=order, listing=kente, quantity=1, unit_price=Decimal("120.00"), line_total=Decimal("120.00"))
        escrow.record_order_payment(order)                                                    # GH₵ 5.00 of the GH₵ 7.00 cap
        sale = self.service_sale("200.00")
        self.assertEqual((sale.computed_pesewas, sale.charged_pesewas, sale.cap_pesewas), (500, 200, 700))  # only GH₵ 2.00 left
        self.assertEqual(self.service_sale("200.00").charged_pesewas, 0)                     # the cap is used up
        self.assertEqual(fees.charged_to_date(self.owner), 700)

    def test_paid_from_the_wallet_the_wallet_pays_and_a_low_one_writes_nothing(self):
        fund(self.customer, 25000, "fund-1b-payment")
        sale = self.service_sale("200.00", wallet=True)
        self.assertEqual(self.balance(Account.CUSTOMER_WALLET, self.customer), 5000)
        self.assertEqual(self.balance(Account.PROVIDER_CLEARING), 25000)                      # only the top-up moved clearing
        self.assertEqual(self.balance(Account.VENDOR_PENDING, self.owner), 20000)
        with self.assertRaises(posting.InsufficientFunds):
            self.service_sale("200.00", wallet=True)
        self.assertEqual(BookingSale.objects.get(), sale)
        self.assertEqual(self.balance(Account.CUSTOMER_WALLET, self.customer), 5000)

    def test_the_processing_charge_is_not_the_businesss_money(self):
        sr = self.accepted_service("200.00")
        session = self.session(CheckoutSession.SERVICE_REQUEST, "204.00", processing="4.00", service_request_id=sr.pk)
        sale = sales.record_payment(session, BookingSale.SERVICE, sr, self.owner)
        self.assertEqual(sale.base_pesewas, 20000)
        self.assertEqual(self.balance(Account.PROVIDER_CLEARING), 20000)

    def test_review_focus_a_payment_that_does_not_match_the_price_writes_nothing(self):
        sr = self.accepted_service("200.00")
        session = self.session(CheckoutSession.SERVICE_REQUEST, "150.00", service_request_id=sr.pk)
        with self.assertRaises(posting.PostingError):
            sales.record_payment(session, BookingSale.SERVICE, sr, self.owner)
        self.assertFalse(BookingSale.objects.exists())
        self.assertFalse(Journal.objects.filter(kind="booking_payment").exists())

    def test_recording_twice_keeps_one_sale_and_one_journal(self):
        sr = self.accepted_service("200.00")
        session = self.session(CheckoutSession.SERVICE_REQUEST, "200.00", service_request_id=sr.pk)
        first = sales.record_payment(session, BookingSale.SERVICE, sr, self.owner)
        self.assertEqual(sales.record_payment(session, BookingSale.SERVICE, sr, self.owner), first)
        self.assertEqual(Journal.objects.filter(kind="booking_payment").count(), 1)

    def test_a_free_booking_records_nothing_and_a_negative_price_is_refused(self):
        free = self.accepted_service("0.00")
        self.assertIsNone(sales.record_payment(self.session(CheckoutSession.SERVICE_REQUEST, "0.00"), BookingSale.SERVICE, free, self.owner))
        negative = self.accepted_service("-5.00")
        with self.assertRaises(posting.PostingError):
            sales.record_payment(self.session(CheckoutSession.SERVICE_REQUEST, "-5.00"), BookingSale.SERVICE, negative, self.owner)
        self.assertFalse(BookingSale.objects.exists())

    @override_settings(LEDGER_ENABLED=False)
    def test_with_the_ledger_off_nothing_is_recorded(self):
        self.assertIsNone(self.service_sale("200.00"))
        self.assertFalse(Account.objects.exists())


@override_settings(LEDGER_ENABLED=True)
class CapRaceTests(TransactionTestCase):
    serialized_rollback = True

    def test_review_focus_a_product_and_a_service_paid_at_once_never_pass_the_cap(self):
        customer = Customer.objects.create(full_name="Ama", phone="+233200770201", password_hash="x")
        owner = BusinessOwner.objects.create(full_name="Kwame", login_phone="+233207770201", password_hash="x")
        zone = Zone.objects.get(name="Manhyia")
        MoneySetting.objects.create(key="fee_cap_pesewas", value=600, effective_from=timezone.now() - timedelta(minutes=1))
        kente = Listing.objects.create(
            business_owner=owner, category=Category.objects.get(slug="shops"), zone=zone, name="Kente", description="D.",
            contact_phone=owner.login_phone, price_amount=Decimal("120.00"), status=Listing.PUBLISHED,
        )
        order = Order.objects.create(customer=customer, status=Order.PAID, total_amount=Decimal("120.00"))
        OrderItem.objects.create(order=order, listing=kente, quantity=1, unit_price=Decimal("120.00"), line_total=Decimal("120.00"))
        cleaning = Listing.objects.create(
            business_owner=owner, category=Category.objects.create(slug="cleaning-1b-race", label="Cleaning", kind="service"),
            zone=zone, name="Cleaning", description="D.", contact_phone=owner.login_phone, price_amount=Decimal("200.00"),
            status=Listing.PUBLISHED,
        )
        sr = ServiceRequest.objects.create(
            customer=customer, listing=cleaning, business_owner=owner, message="M.", agreed_price=Decimal("200.00"),
            status=ServiceRequest.IN_PROGRESS,
        )
        session = CheckoutSession.objects.create(
            customer=customer, kind=CheckoutSession.SERVICE_REQUEST, amount=Decimal("200.00"), status=CheckoutSession.SUCCESS,
            purpose="Service", metadata={"service_request_id": sr.pk},
        )
        outcomes, barrier = [], threading.Barrier(2)

        def run(step):
            try:
                barrier.wait()
                with transaction.atomic():
                    step()
                outcomes.append("paid")
            except Exception as exc:  # noqa: BLE001 - a failure must show in the assertion, not hang the test
                outcomes.append(type(exc).__name__)
            finally:
                connection.close()

        threads = [
            threading.Thread(target=run, args=(lambda: escrow.record_order_payment(order),)),
            threading.Thread(target=run, args=(lambda: sales.record_payment(session, BookingSale.SERVICE, sr, owner),)),
        ]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=10)
            self.assertFalse(thread.is_alive(), "a racing payment hung")
        self.assertEqual(outcomes, ["paid", "paid"])
        charged = sorted([OrderFeeSnapshot.objects.get().charged_pesewas, BookingSale.objects.get().charged_pesewas])
        self.assertEqual(charged, [100, 500])                       # whichever came second got only the GH₵ 1.00 left
        self.assertEqual(fees.charged_to_date(owner), 600)
```

- [ ] **Step 3: Run it to see it fail**

Run: `docker compose -p svc1 run --rm web python manage.py test ledger.tests.test_booking_payment --noinput`
Expected: ERROR — `ImportError: cannot import name 'sales' from 'ledger'`.

- [ ] **Step 4: Write the module** — `backend/ledger/sales.py`

```python
"""Services, stays and event tickets in the ledger (Plan 1b; spec §4.2, §1 rows 2, 3 and 11, §3.2).

A paid service request, stay booking or ticket purchase is one `BookingSale`: one customer, one business and one fee
category (services and stays use the services table, tickets the events table: spec §1 row 11), with its platform fee
fixed on the row at payment (spec §3.2 step 4). The lifetime cap is counted across every category (fees.charged_to_date).

Payment journal booking-pay-<session reference> (kind booking_payment), in pesewas:
    Dr provider clearing   what the customer paid less the payment-processing charge (Dr customer wallet instead when
                           they paid from it)
    Cr vendor pending      the same amount: a booking has no delivery fee and no coupon
The key names the checkout session, so the nightly reconciliation can expect it from the session alone.

Lock order (spec W7, extended to bookings): the service request or stay booking row (tickets: the purchase's ticket
rows, in primary-key order), then the sale row, then the ledger accounts in primary-key order in one pass
(posting.lock). A business's Pending account is locked before its fees so far are read, as escrow.record_order_payment
does, so a product payment and a booking payment for one business never both see the same cap remainder."""
from django.db import transaction
from django.utils import timezone

from . import escrow, fees, posting, settings_store
from .models import Account, BookingSale, FeeRuleSet
from .money import to_pesewas

# Spec §1 row 11: stays count as services; tickets use the events table, whatever category the listing or event is in.
CATEGORY = {BookingSale.SERVICE: FeeRuleSet.SERVICE, BookingSale.STAY: FeeRuleSet.SERVICE, BookingSale.TICKETS: FeeRuleSet.EVENT}
SUBJECT = {BookingSale.SERVICE: "service_request", BookingSale.STAY: "booking", BookingSale.TICKETS: "event"}


def pay_key(session):
    return f"booking-pay-{session.reference}"


def release_key(sale):
    return f"booking-release-{sale.pk}"


def refund_key(sale, source):
    return f"booking-refund-{sale.pk}-{source}"


def price_of(kind, subject, session):
    """What the business is owed, in pesewas, from what the server priced (never the client): a service request's agreed
    price, a stay's total, or the ticket unit price times the quantity the purchase view put on the session."""
    if kind == BookingSale.SERVICE:
        return to_pesewas(subject.agreed_price)
    if kind == BookingSale.STAY:
        return to_pesewas(subject.total_price)
    return to_pesewas(session.metadata["unit_price"]) * int(session.metadata["quantity"])


def record_payment(session, kind, subject, business_owner, *, at=None):
    """Record a paid booking: the sale with its fee snapshot, and the payment journal. `subject` is the ServiceRequest,
    the Booking or (tickets) the Event; the payment finalizer holds its row lock. Returns the sale; the one already
    recorded for this session when called again (a retried webhook); None while the ledger is off and for a GH₵ 0.00
    booking. Raises posting.PostingError, writing nothing, when what was paid is not the price (or the price is below
    zero), and posting.InsufficientFunds, writing nothing, when a wallet paying for it is too low."""
    from payments.models import CheckoutSession

    if not escrow.enabled():
        return None
    at = at or timezone.now()
    with transaction.atomic():
        existing = BookingSale.objects.filter(session=session).first()
        if existing is not None:
            return existing
        base = price_of(kind, subject, session)
        paid = to_pesewas(session.amount) - to_pesewas(session.processing_fee or 0)
        if base < 0 or paid != base:
            raise posting.PostingError(f"Booking payment {session.reference} does not match its price: paid {paid}, price {base}")
        if base == 0:
            return None  # nothing to hold for a free booking: neither a sale nor a journal
        pending = posting.account_for(Account.VENDOR_PENDING, business_owner)
        source = (
            posting.account_for(Account.CUSTOMER_WALLET, session.customer) if session.provider == CheckoutSession.WALLET
            else posting.account_for(Account.PROVIDER_CLEARING)
        )
        posting.lock(pending, source)
        cap = settings_store.current("fee_cap_pesewas", at)
        category = CATEGORY[kind]
        quote = fees.quote(category, base, cap=cap, already_charged=fees.charged_to_date(business_owner), at=at)
        sale = BookingSale.objects.create(
            kind=kind, session=session, customer=session.customer, business_owner=business_owner,
            category=category, rule_set_id=quote.rule_set_id, base_pesewas=base, computed_pesewas=quote.computed,
            charged_pesewas=quote.charged, cap_pesewas=cap, paid_at=at, **{SUBJECT[kind]: subject},
        )
        posting.post(
            key=pay_key(session), kind="booking_payment", lines=[posting.debit(source, base), posting.credit(pending, base)],
            reference_type="ledger.bookingsale", reference_id=str(sale.pk), memo=f"Payment for {sale.label()}",
        )
        return sale
```

- [ ] **Step 5: Run the tests**

Run: `docker compose -p svc1 run --rm web python manage.py test ledger.tests.test_booking_payment --noinput`
Expected: PASS (10 tests: 9 + 1 threaded).

- [ ] **Step 6: Commit**

```bash
git add backend/ledger/sales.py backend/ledger/tests/booking_helpers.py backend/ledger/tests/test_booking_payment.py
git commit -m "feat(ledger): record paid services, stays and ticket purchases with their own fee and the shared cap (1b)" --trailer "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>" --trailer "Claude-Session: https://claude.ai/code/session_01HDHNosHkqu4Wwocp7a2c8j"
```

---

### Task 3: Wire the three payments — finalizers, payment processing, the reconciliation mark, statements, the price check

**Files:**
- Create: `backend/payments/booking_pay.py`, `backend/ledger/tests/test_booking_wiring.py`
- Modify: `backend/payments/services.py` (`_finalize_service_request`, `_finalize_booking`, `_finalize_ticket_purchase`), `backend/services/views.py` (imports, `clean_price`, `ServiceRequestRespondView`, `ServiceRequestPayView`), `backend/bookings/views.py` (imports, `BookingCreateView`), `backend/events/views.py` (imports, `TicketPurchaseView`), `backend/wallets/reconciliation.py`, `backend/wallets/services.py`

**Interfaces:**
- Consumes: `sales.record_payment`, `sales.pay_key` (Task 2); `payments.services.process_payment(*, kind, amount, purpose, customer, metadata, processing_fee, wallet)`; `payments.providers.get_provider().collection_charge(pesewas)`.
- Produces:
  - module `payments.booking_pay`: `MOMO = "momo"`, `WALLET = "wallet"`, `pay(*, kind, amount, purpose, customer, metadata, method=MOMO, in_ledger=True) -> (result, processing Decimal)`, `with_terms(body, processing, *, method=MOMO, in_ledger=True) -> dict`, `redirect_body(result, processing, *, in_ledger=True) -> dict`
  - `services.views.clean_price(raw) -> Decimal | None`, `PRICE_HINT`
  - the three finalizers call `sales.record_payment` (tickets only for a business-organised event)
  - `wallets.reconciliation.BOOKING_KINDS`; `expected_key` returns `booking-pay-<reference>` for marked booking sessions; `provider_reference` reads `booking-pay-` keys
  - `wallets.services.LABELS` gains `booking_payment`, `booking_release`, `booking_refund`; `line_row(...)` gains `"booking_sale"` (the sale id, else None)

- [ ] **Step 1: Write the failing test** — `backend/ledger/tests/test_booking_wiring.py`

```python
"""Paying for services, stays and tickets records them in the ledger (Plan 1b, Task 3): the finalizers record the sale,
the pay endpoints put the payment-processing charge on top and mark the session for the reconciliation, and nothing
changes while the ledger is off. Review Focus 2 (a confirmation that arrives twice), 6 (switches off) and 7 (the price
check)."""
from datetime import timedelta
from decimal import Decimal

from django.test import override_settings
from django.utils import timezone

from accounts.models import Customer
from billing.models import Transaction
from events.models import Event, EventTicketType, Ticket
from ledger.models import Account, BookingSale, Journal
from payments.models import CheckoutSession
from payments.services import finalize_success
from services.models import ServiceRequest
from wallets import reconciliation
from wallets.models import ReconciliationRun

from .booking_helpers import BookingBase


@override_settings(LEDGER_ENABLED=True)
class BookingPaymentWiringTests(BookingBase):
    def test_a_paid_service_is_recorded_and_its_session_marked(self):
        sr = self.accepted_service("200.00")
        response = self.pay_service(sr)
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        self.assertEqual((body["status"], body["payment_method"], body["payment_processing"]), ("in_progress", "momo", "0.00"))
        sale = BookingSale.objects.get(service_request=sr)
        self.assertEqual((sale.kind, sale.base_pesewas, sale.customer, sale.business_owner), (BookingSale.SERVICE, 20000, self.customer, self.owner))
        self.assertTrue(sale.session.metadata["ledger"])
        self.assertEqual(self.balance(Account.VENDOR_PENDING, self.owner), 20000)

    @override_settings(SIMULATED_COLLECTION_CHARGE_BP=200)
    def test_mobile_money_pays_the_processing_charge_on_top_and_the_business_is_owed_the_price(self):
        response = self.book_stay(nights=2)                                                    # 2 nights x GH₵ 150.00
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.json()["payment_processing"], "6.00")
        sale = BookingSale.objects.get(booking_id=response.json()["id"])
        self.assertEqual((sale.session.amount, sale.session.processing_fee), (Decimal("306.00"), Decimal("6.00")))
        self.assertEqual((sale.kind, sale.base_pesewas), (BookingSale.STAY, 30000))
        self.assertEqual(self.balance(Account.PROVIDER_CLEARING), 30000)

    def test_tickets_are_one_sale_for_the_purchase_and_the_answer_keeps_its_shape(self):
        response = self.buy_tickets(quantity=3)
        self.assertEqual(response.status_code, 201, response.content)
        self.assertIsInstance(response.json(), list)
        sale = BookingSale.objects.get(kind=BookingSale.TICKETS)
        self.assertEqual((sale.event, sale.base_pesewas, sale.category), (self.event, 15000, "event"))
        self.assertEqual(Ticket.objects.filter(transaction=sale.session.transaction).count(), 3)

    def test_review_focus_a_confirmation_that_arrives_twice_records_once(self):
        sale = self.paid_service()
        finalize_success(sale.session)                                                         # Hubtel retrying its callback
        self.assertEqual(BookingSale.objects.count(), 1)
        self.assertEqual(Journal.objects.filter(kind="booking_payment").count(), 1)

    @override_settings(SIMULATED_COLLECTION_CHARGE_BP=200)
    def test_tickets_for_an_event_a_customer_organised_stay_outside_the_ledger(self):
        organiser = Customer.objects.create(full_name="Yaa Organiser", phone="+233200770009", password_hash="x")
        now = timezone.now()
        event = Event.objects.create(
            category=self.event.category, zone=self.zone, submitted_by_customer=organiser, name="Street Party",
            description="D.", address="Kumasi", event_date=now + timedelta(days=5), visibility_days=14,
            status=Event.APPROVED, paid_at=now, expires_at=now + timedelta(days=14),
        )
        ticket_type = EventTicketType.objects.create(event=event, name="Entry", price=Decimal("20.00"))
        response = self.buy_tickets(quantity=1, event=event, ticket_type=ticket_type)
        self.assertEqual(response.status_code, 201, response.content)
        session = CheckoutSession.objects.get(kind=CheckoutSession.TICKET_PURCHASE)
        self.assertNotIn("ledger", session.metadata)
        self.assertEqual((session.amount, session.processing_fee), (Decimal("20.00"), Decimal("0.00")))
        self.assertFalse(BookingSale.objects.exists())

    def test_the_businesss_statement_names_booking_payments(self):
        sale = self.paid_service()
        self.as_owner()
        row = self.client.get("/api/wallet/transactions/").json()["results"][0]
        self.assertEqual(
            (row["label"], row["account"], row["direction"], row["amount"], row["booking_sale"], row["order"], row["reference"]),
            ("Booking payment", "pending", "in", "200.00", sale.pk, None, ""),
        )

    def test_review_focus_with_the_ledger_off_paying_is_exactly_as_before(self):
        with override_settings(LEDGER_ENABLED=False):
            sr = self.accepted_service()
            service = self.pay_service(sr)
            stay = self.book_stay()
            tickets = self.buy_tickets()
        self.assertEqual((service.status_code, stay.status_code, tickets.status_code), (200, 201, 201))
        self.assertEqual(service.json()["status"], "in_progress")
        for body in (service.json(), stay.json()):
            self.assertNotIn("payment_processing", body)
            self.assertNotIn("payment_method", body)
        self.assertFalse(BookingSale.objects.exists())
        self.assertFalse(Account.objects.exists())
        self.assertFalse(CheckoutSession.objects.filter(metadata__has_key="ledger").exists())


@override_settings(LEDGER_ENABLED=True)
class BookingReconciliationTests(BookingBase):
    def test_a_day_of_booking_payments_matches(self):
        self.paid_service("200.00")
        self.paid_stay(nights=1)                                                               # GH₵ 150.00
        self.paid_tickets(quantity=2)                                                          # 2 x GH₵ 50.00
        run = reconciliation.reconcile(timezone.localdate())
        self.assertEqual((run.status, run.differences), (ReconciliationRun.MATCHED, []))
        self.assertEqual((run.statement_in_pesewas, run.ledger_in_pesewas), (45000, 45000))

    def test_a_marked_booking_payment_with_no_journal_is_a_difference(self):
        reference = "AH-SERVICE_REQUEST-LOST000001"
        txn = Transaction.objects.create(customer=self.customer, amount=Decimal("80.00"), purpose="Service", reference=reference)
        CheckoutSession.objects.create(
            customer=self.customer, kind=CheckoutSession.SERVICE_REQUEST, amount=Decimal("80.00"), purpose="Service",
            reference=reference, status=CheckoutSession.SUCCESS, transaction=txn, metadata={"ledger": True},
        )
        run = reconciliation.reconcile(timezone.localdate())
        self.assertEqual(run.status, ReconciliationRun.MISMATCHED)
        self.assertEqual([(d["reference"], d["problem"]) for d in run.differences], [(reference, "missing_in_ledger")])


class ServicePriceTests(BookingBase):
    def respond(self, sr, price):
        self.as_owner()
        return self.client.post(f"/api/services/requests/{sr.pk}/respond/", {"action": "accept", "price": price}, format="json")

    def requested(self):
        return ServiceRequest.objects.create(customer=self.customer, listing=self.service, business_owner=self.owner, message="M.")

    def test_review_focus_a_service_price_must_be_above_zero_with_two_decimals_at_most(self):
        for price in ("-5.00", "0", "0.00", "12.345", "abc", "1e3", "NaN", True):
            sr = self.requested()
            with self.subTest(price=price):
                response = self.respond(sr, price)
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.json(), {"price": "Enter a price in GH₵ above 0.00, like 150.00."})
                sr.refresh_from_db()
                self.assertEqual(sr.status, ServiceRequest.REQUESTED)
        sr = self.requested()
        self.assertEqual(self.respond(sr, "150.5").status_code, 200)
        sr.refresh_from_db()
        self.assertEqual((sr.status, sr.agreed_price), (ServiceRequest.ACCEPTED, Decimal("150.50")))
```

- [ ] **Step 2: Run it to see it fail**

Run: `docker compose -p svc1 run --rm web python manage.py test ledger.tests.test_booking_wiring --noinput`
Expected: FAIL — `BookingSale.DoesNotExist` (nothing records a paid booking yet), `KeyError: 'payment_method'`, and the price cases answering 200.

- [ ] **Step 3: The pay helper** — `backend/payments/booking_pay.py`

```python
"""Paying for a service request, a stay or event tickets (ledger Plan 1b) the way order checkout pays
(orders.views.OrderCheckoutView). While the ledger is on, a mobile-money payment carries the provider's collection
charge on top ("payment processing", spec §1 row 14) and the session is marked metadata["ledger"], so the nightly
reconciliation expects its journal (wallets plan 3b). Tickets for an event no business organises stay outside the
ledger (`in_ledger=False`): no charge, no mark. With the ledger off this is exactly process_payment."""
from decimal import Decimal

from ledger import escrow
from ledger.money import from_pesewas, to_pesewas

from .providers import get_provider
from .services import process_payment

MOMO, WALLET = "momo", "wallet"


def _recorded(in_ledger):
    return in_ledger and escrow.enabled()


def pay(*, kind, amount, purpose, customer, metadata, method=MOMO, in_ledger=True):
    """process_payment for a booking, with the charge and the mark above. Returns (result, processing): the GH₵
    processing charge added on top (Decimal 0.00 when none). Call it inside the caller's transaction.atomic(), so a
    payment the ledger refuses leaves nothing behind."""
    processing = Decimal("0.00")
    if _recorded(in_ledger):
        if method == MOMO:
            processing = from_pesewas(get_provider().collection_charge(to_pesewas(amount)))
        metadata = {**metadata, "ledger": True}
    result = process_payment(
        kind=kind, amount=amount + processing, processing_fee=processing, purpose=purpose, customer=customer,
        metadata=metadata, wallet=method == WALLET,
    )
    return result, processing


def with_terms(body, processing, *, method=MOMO, in_ledger=True):
    """A paid booking's answer plus how it was paid, while the ledger records it (checkout's payment_method and
    payment_processing). Unchanged otherwise."""
    if not _recorded(in_ledger):
        return body
    return {**body, "payment_method": method, "payment_processing": str(processing)}


def redirect_body(result, processing, *, in_ledger=True):
    """The answer that sends the customer to the provider's checkout (Hubtel), with the charge while the ledger is on."""
    body = {"mode": "redirect", "checkout_url": result["checkout_url"], "reference": result["reference"]}
    if _recorded(in_ledger):
        body["payment_processing"] = str(processing)
    return body
```

- [ ] **Step 4: The finalizers record the sale** — in `backend/payments/services.py` (a) replace

```python
    service_request.status = ServiceRequest.IN_PROGRESS
    service_request.paid_at = timezone.now()
    service_request.save(update_fields=["status", "paid_at"])
```

with

```python
    service_request.status = ServiceRequest.IN_PROGRESS
    service_request.paid_at = timezone.now()
    service_request.save(update_fields=["status", "paid_at"])

    from ledger import sales
    from ledger.models import BookingSale

    sales.record_payment(session, BookingSale.SERVICE, service_request, service_request.business_owner)
```

(b) replace

```python
    booking.status = Booking.CONFIRMED
    booking.paid_at = timezone.now()
    booking.save(update_fields=["status", "paid_at"])
```

with

```python
    booking.status = Booking.CONFIRMED
    booking.paid_at = timezone.now()
    booking.save(update_fields=["status", "paid_at"])

    from ledger import sales
    from ledger.models import BookingSale

    sales.record_payment(session, BookingSale.STAY, booking, booking.business_owner)
```

(c) replace

```python
    session.metadata = {**meta, "ticket_ids": [t.id for t in tickets]}
    session.save(update_fields=["metadata", "updated_at"])
```

with

```python
    session.metadata = {**meta, "ticket_ids": [t.id for t in tickets]}
    session.save(update_fields=["metadata", "updated_at"])

    from ledger import escrow, sales
    from ledger.models import BookingSale

    if not escrow.enabled():
        return  # with the ledger off this finalizer is exactly as before (no event lookup either)
    from events.models import Event

    event = Event.objects.select_related("submitted_by_business").get(pk=meta["event_id"])
    if event.submitted_by_business_id is not None:  # a customer-organised event has no business to hold money for (Plan 1b S10)
        sales.record_payment(session, BookingSale.TICKETS, event, event.submitted_by_business)
```

- [ ] **Step 5: Services — the price check and the payment** — in `backend/services/views.py` (a) replace the imports

```python
from django.utils import timezone
from rest_framework import generics, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.views import IsBusinessOwner, IsCustomer
from notifications.services import notify_business_owner, notify_customer
from payments.models import CheckoutSession
from payments.services import process_payment

from .models import ServiceRequest
from .serializers import ServiceRequestCreateSerializer, ServiceRequestSerializer
```

with

```python
import re
from decimal import Decimal

from django.db import transaction as db_transaction
from django.utils import timezone
from rest_framework import generics, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.views import IsBusinessOwner, IsCustomer
from notifications.services import notify_business_owner, notify_customer
from payments import booking_pay
from payments.models import CheckoutSession

from .models import ServiceRequest
from .serializers import ServiceRequestCreateSerializer, ServiceRequestSerializer

PRICE_PATTERN = re.compile(r"[0-9]{1,8}(\.[0-9]{1,2})?", re.ASCII)
PRICE_HINT = "Enter a price in GH₵ above 0.00, like 150.00."


def clean_price(raw):
    """The agreed price as a Decimal from what the business typed ("150", "150.5", 150.25), or None when it is not a
    price: above GH₵ 0.00, at most two decimal places, plain digits (no "1e3", "NaN" or minus sign; ledger Plan 1b S16)."""
    if raw is None or isinstance(raw, bool):
        return None
    text = str(raw).strip()
    if not PRICE_PATTERN.fullmatch(text):
        return None
    value = Decimal(text)
    return value if value > 0 else None
```

(b) in `ServiceRequestRespondView.post` replace

```python
        if action == "accept":
            price = request.data.get("price")
            if price in (None, ""):
                return Response({"price": "A price is required to accept."}, status=400)
            sr.status = ServiceRequest.ACCEPTED
```

with

```python
        if action == "accept":
            raw = request.data.get("price")
            if raw in (None, ""):
                return Response({"price": "A price is required to accept."}, status=400)
            price = clean_price(raw)
            if price is None:
                return Response({"price": PRICE_HINT}, status=400)
            sr.status = ServiceRequest.ACCEPTED
```

(c) replace the whole `ServiceRequestPayView` class with

```python
class ServiceRequestPayView(APIView):
    """POST /api/services/requests/{id}/pay/ — the customer pays for an accepted request, which moves it to
    in_progress. Routes through payments.booking_pay (simulated mode finalizes synchronously; with the ledger on, MoMo
    carries "payment processing" and the sale is recorded). The payment is one transaction, so a payment the ledger
    refuses leaves the request accepted and nothing else behind.
    """

    permission_classes = [IsAuthenticated, IsCustomer]

    def post(self, request, pk):
        sr = generics.get_object_or_404(ServiceRequest, pk=pk, customer=request.user)
        if sr.status != ServiceRequest.ACCEPTED:
            return Response({"detail": "Only an accepted request can be paid for."}, status=400)

        with db_transaction.atomic():
            # Locked and re-checked, so two taps on Pay never start two payments for one request (Plan 1b S15); the
            # finalizer locks the same row again. A second Hubtel checkout is still possible: gate (lix).
            sr = ServiceRequest.objects.select_for_update().get(pk=sr.pk)
            if sr.status != ServiceRequest.ACCEPTED:
                return Response({"detail": "Only an accepted request can be paid for."}, status=400)
            result, processing = booking_pay.pay(
                kind=CheckoutSession.SERVICE_REQUEST,
                amount=sr.agreed_price,
                purpose=f"Service: {sr.listing.name}",
                customer=request.user,
                metadata={"service_request_id": sr.id},
            )
        if result["mode"] == "redirect":
            return Response(booking_pay.redirect_body(result, processing), status=status.HTTP_200_OK)
        sr.refresh_from_db()
        return Response(booking_pay.with_terms(ServiceRequestSerializer(sr).data, processing))
```

- [ ] **Step 6: Stays** — in `backend/bookings/views.py` (a) replace

```python
from payments.models import CheckoutSession
from payments.services import process_payment
```

with

```python
from payments import booking_pay
from payments.models import CheckoutSession
```

(b) in `BookingCreateView.post` replace

```python
            result = process_payment(
                kind=CheckoutSession.BOOKING,
                amount=total,
                purpose=f"Booking: {listing.name} ({data['check_in']} → {data['check_out']})",
                customer=request.user,
                metadata={"booking_id": booking.id},
            )
            if result["mode"] == "redirect":
                return Response(
                    {"mode": "redirect", "checkout_url": result["checkout_url"], "reference": result["reference"]},
                    status=status.HTTP_200_OK,
                )
            booking.refresh_from_db()

        notify_business_owner(
            listing.business_owner, "booking", "New booking",
            body=f"A customer booked “{listing.name}” for {nights} night(s).",
            link="/business-dashboard", icon="🏨",
        )
        return Response(BookingSerializer(booking).data, status=201)
```

with

```python
            result, processing = booking_pay.pay(
                kind=CheckoutSession.BOOKING,
                amount=total,
                purpose=f"Booking: {listing.name} ({data['check_in']} → {data['check_out']})",
                customer=request.user,
                metadata={"booking_id": booking.id},
            )
            if result["mode"] == "redirect":
                return Response(booking_pay.redirect_body(result, processing), status=status.HTTP_200_OK)
            booking.refresh_from_db()

        notify_business_owner(
            listing.business_owner, "booking", "New booking",
            body=f"A customer booked “{listing.name}” for {nights} night(s).",
            link="/business-dashboard", icon="🏨",
        )
        return Response(booking_pay.with_terms(BookingSerializer(booking).data, processing), status=201)
```

- [ ] **Step 7: Tickets** — in `backend/events/views.py` (a) after `from payments.models import CheckoutSession` add `from payments import booking_pay` (keep `from payments.services import process_payment`: `EventPayView` and `EventRenewView` still use it). (b) In `TicketPurchaseView.post` replace

```python
            result = process_payment(
                kind=CheckoutSession.TICKET_PURCHASE,
                amount=ticket_type.price * quantity,
                purpose=f"{quantity}x '{ticket_type.name}' ticket(s) for '{event.name}'",
                customer=request.user,
                metadata={
                    "event_id": event.id,
                    "ticket_type_id": ticket_type.id,
                    "quantity": quantity,
                    "customer_id": request.user.id,
                    "delivery_method": ticket_type.delivery_method,
                    "unit_price": str(ticket_type.price),
                },
            )

            if result["mode"] == "redirect":
                return Response(
                    {
                        "mode": "redirect",
                        "checkout_url": result["checkout_url"],
                        "reference": result["reference"],
                    },
                    status=200,
                )
```

with

```python
            # Tickets for an event a customer organised stay outside the ledger (Plan 1b S10): no business holds them.
            in_ledger = event.submitted_by_business_id is not None
            result, processing = booking_pay.pay(
                kind=CheckoutSession.TICKET_PURCHASE,
                amount=ticket_type.price * quantity,
                purpose=f"{quantity}x '{ticket_type.name}' ticket(s) for '{event.name}'",
                customer=request.user,
                metadata={
                    "event_id": event.id,
                    "ticket_type_id": ticket_type.id,
                    "quantity": quantity,
                    "customer_id": request.user.id,
                    "delivery_method": ticket_type.delivery_method,
                    "unit_price": str(ticket_type.price),
                },
                in_ledger=in_ledger,
            )

            if result["mode"] == "redirect":
                return Response(booking_pay.redirect_body(result, processing, in_ledger=in_ledger), status=200)
```

- [ ] **Step 8: The reconciliation expects booking journals** — in `backend/wallets/reconciliation.py` (a) in the module docstring replace `kinds it does not record yet (subscriptions, tickets, bookings...)` with `kinds it does not record (subscriptions, event listing fees...)`; (b) replace

```python
from ledger import escrow, posting
```

with

```python
from ledger import escrow, posting, sales
```

(c) replace

```python
LEDGER_KINDS = (CheckoutSession.ORDER_CHECKOUT, CheckoutSession.WALLET_TOPUP)
```

with

```python
# Services, stays and ticket purchases are recorded since ledger Plan 1b (booking-pay-<reference>).
BOOKING_KINDS = (CheckoutSession.SERVICE_REQUEST, CheckoutSession.BOOKING, CheckoutSession.TICKET_PURCHASE)
LEDGER_KINDS = (CheckoutSession.ORDER_CHECKOUT, CheckoutSession.WALLET_TOPUP, *BOOKING_KINDS)
```

(d) replace

```python
    if session.kind == CheckoutSession.WALLET_TOPUP:
        return topup_key(session.reference), None
    return escrow.pay_key(Order(pk=session.metadata.get("order_id"))), None
```

with

```python
    if session.kind == CheckoutSession.WALLET_TOPUP:
        return topup_key(session.reference), None
    if session.kind in BOOKING_KINDS:
        return sales.pay_key(session), None
    return escrow.pay_key(Order(pk=session.metadata.get("order_id"))), None
```

(e) replace

```python
    if journal.key.startswith(("wallet-topup-", "withdrawal-paid-")):
        return journal.reference_id
```

with

```python
    if journal.key.startswith(("wallet-topup-", "withdrawal-paid-")):
        return journal.reference_id
    if journal.key.startswith("booking-pay-"):
        return journal.key[len("booking-pay-"):]
```

- [ ] **Step 9: Holder statements name booking journals** — in `backend/wallets/services.py` (a) in `LABELS` after `"order_waiver_return": "Free-delivery promo returned",` add

```python
    "booking_payment": "Booking payment",
    "booking_release": "Released to you",
    "booking_refund": "Refund",
```

(b) replace

```python
    journal = line.journal
    is_order = journal.reference_type == "orders.order" and journal.reference_id.isdigit()
    return {
        "id": line.pk, "at": journal.created_at, "account": ACCOUNT_NAMES[line.account.kind], "kind": journal.kind,
        "label": LABELS.get(journal.kind, "Other"),
        # Every holder account grows with credits, so a credit is money in.
        "direction": "in" if line.side == JournalLine.CREDIT else "out",
        "amount": money(line.amount), "order": int(journal.reference_id) if is_order else None,
        "reference": "" if is_order else journal.reference_id,
    }
```

with

```python
    journal = line.journal
    is_order = journal.reference_type == "orders.order" and journal.reference_id.isdigit()
    is_booking = journal.reference_type == "ledger.bookingsale" and journal.reference_id.isdigit()
    return {
        "id": line.pk, "at": journal.created_at, "account": ACCOUNT_NAMES[line.account.kind], "kind": journal.kind,
        "label": LABELS.get(journal.kind, "Other"),
        # Every holder account grows with credits, so a credit is money in.
        "direction": "in" if line.side == JournalLine.CREDIT else "out",
        "amount": money(line.amount), "order": int(journal.reference_id) if is_order else None,
        "booking_sale": int(journal.reference_id) if is_booking else None,
        "reference": "" if (is_order or is_booking) else journal.reference_id,
    }
```

- [ ] **Step 10: Run the tests**

Run: `docker compose -p svc1 run --rm web python manage.py test ledger.tests.test_booking_wiring services bookings events payments wallets --noinput`
Expected: PASS (10 new tests; the existing services, bookings, events, payments and wallets suites unchanged).

- [ ] **Step 11: Commit**

```bash
git add backend/payments/booking_pay.py backend/payments/services.py backend/services/views.py backend/bookings/views.py backend/events/views.py backend/wallets/reconciliation.py backend/wallets/services.py backend/ledger/tests/test_booking_wiring.py
git commit -m "feat(ledger): services, stays and tickets record their payment; processing charge, reconciliation and the price check (1b)" --trailer "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>" --trailer "Claude-Session: https://claude.ai/code/session_01HDHNosHkqu4Wwocp7a2c8j"
```

---

### Task 4: Pay a booking from the wallet

**Files:**
- Modify: `backend/payments/booking_pay.py` (imports, `Refused`, `method_from`, `too_low`), `backend/payments/services.py` (`WALLET_KINDS`, the wallet guard in `process_payment`, `_finalize_ticket_purchase`), `backend/services/views.py` (`ServiceRequestPayView`, imports), `backend/bookings/views.py` (`BookingCreateView.post`, imports), `backend/events/views.py` (`TicketPurchaseView.post`, imports)
- Create: `backend/ledger/tests/test_booking_wallet.py`

**Interfaces:**
- Consumes: `booking_pay.pay(..., method=, in_ledger=)`, `with_terms`, `redirect_body` (Task 3); `posting.InsufficientFunds(account)`; `sales.record_payment` (debits the wallet for a `provider="wallet"` session, Task 2).
- Produces:
  - `booking_pay.WALLET_OFF`, `WALLET_TOO_LOW`, `Refused(body, status_code)`, `method_from(data) -> "momo" | "wallet"` (raises `Refused`), `too_low(exc) -> Response` (409 `insufficient_funds`; re-raises for any account but a customer wallet)
  - `payments.services.WALLET_KINDS` (orders, service requests, stays, ticket purchases); `process_payment(..., wallet=True)` accepts those kinds
  - the three pay endpoints take `payment_method`; `409 wallet_not_accepted` for tickets to a customer-organised event; `_finalize_ticket_purchase` raises `posting.PostingError` for a wallet payment no business can receive

- [ ] **Step 1: Write the failing test** — `backend/ledger/tests/test_booking_wallet.py`

```python
"""Paying a service, a stay or tickets from the AshantiHub wallet (Plan 1b, Task 4; spec §5): the wallet is debited
instead of provider clearing, it must cover the whole booking, and a refused payment leaves nothing behind. Review Focus
5 (a wallet that covers only part)."""
from datetime import timedelta
from decimal import Decimal

from django.db import transaction
from django.test import override_settings
from django.utils import timezone

from accounts.models import Customer
from billing.models import Transaction
from bookings.models import Booking
from events.models import Event, EventTicketType, Ticket
from ledger import posting
from ledger.models import Account, BookingSale
from payments.models import CheckoutSession
from payments.services import process_payment
from services.models import ServiceRequest

from .booking_helpers import BookingBase, fund


@override_settings(LEDGER_ENABLED=True)
class PayBookingFromWalletTests(BookingBase):
    def customer_event(self):
        organiser = Customer.objects.create(full_name="Yaa Organiser", phone="+233200770009", password_hash="x")
        now = timezone.now()
        event = Event.objects.create(
            category=self.event.category, zone=self.zone, submitted_by_customer=organiser, name="Street Party",
            description="D.", address="Kumasi", event_date=now + timedelta(days=5), visibility_days=14,
            status=Event.APPROVED, paid_at=now, expires_at=now + timedelta(days=14),
        )
        return event, EventTicketType.objects.create(event=event, name="Entry", price=Decimal("20.00"))

    @override_settings(SIMULATED_COLLECTION_CHARGE_BP=200)
    def test_a_service_paid_from_the_wallet_carries_no_processing_charge(self):
        fund(self.customer, 30000, "fund-1b-wallet-1")
        sr = self.accepted_service("200.00")
        response = self.pay_service(sr, method="wallet")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual((response.json()["payment_method"], response.json()["payment_processing"]), ("wallet", "0.00"))
        sale = BookingSale.objects.get(service_request=sr)
        self.assertEqual((sale.session.provider, sale.session.amount), (CheckoutSession.WALLET, Decimal("200.00")))
        self.assertEqual(self.balance(Account.CUSTOMER_WALLET, self.customer), 10000)
        self.assertEqual(self.balance(Account.VENDOR_PENDING, self.owner), 20000)
        self.assertEqual(self.balance(Account.PROVIDER_CLEARING), 30000)                       # only the top-up moved it

    def test_a_stay_and_tickets_paid_from_the_wallet(self):
        fund(self.customer, 40000, "fund-1b-wallet-2")
        self.assertEqual(self.book_stay(nights=1, method="wallet").status_code, 201)           # GH₵ 150.00
        self.assertEqual(self.buy_tickets(quantity=2, method="wallet").status_code, 201)       # GH₵ 100.00
        self.assertEqual(self.balance(Account.CUSTOMER_WALLET, self.customer), 15000)
        self.assertEqual(BookingSale.objects.filter(session__provider=CheckoutSession.WALLET).count(), 2)

    def test_review_focus_a_wallet_that_covers_only_part_pays_nothing_and_keeps_nothing(self):
        fund(self.customer, 10000, "fund-1b-wallet-3")                                        # GH₵ 100.00
        sr = self.accepted_service("200.00")
        for response in (
            self.pay_service(sr, method="wallet"),
            self.book_stay(nights=1, method="wallet"),                                        # GH₵ 150.00
            self.buy_tickets(quantity=3, method="wallet"),                                    # GH₵ 150.00
        ):
            self.assertEqual((response.status_code, response.json()["code"]), (409, "insufficient_funds"))
        sr.refresh_from_db()
        self.assertEqual(sr.status, ServiceRequest.ACCEPTED)
        self.ticket_type.refresh_from_db()
        self.assertEqual(self.ticket_type.quantity_sold, 0)
        for model in (Booking, Ticket, CheckoutSession, Transaction, BookingSale):
            self.assertFalse(model.objects.exists(), model.__name__)
        self.assertEqual(self.balance(Account.CUSTOMER_WALLET, self.customer), 10000)

    def test_an_unknown_method_is_refused_and_the_wallet_needs_the_ledger(self):
        sr = self.accepted_service()
        response = self.pay_service(sr, method="card")
        self.assertEqual(
            (response.status_code, response.json()), (400, {"payment_method": "Pay by mobile money or from your AshantiHub wallet."}),
        )
        with override_settings(LEDGER_ENABLED=False):
            response = self.pay_service(sr, method="wallet")
        self.assertEqual((response.status_code, response.json()["code"]), (409, "ledger_off"))
        sr.refresh_from_db()
        self.assertEqual(sr.status, ServiceRequest.ACCEPTED)

    def test_tickets_for_a_customer_organised_event_cannot_be_paid_from_the_wallet(self):
        fund(self.customer, 5000, "fund-1b-wallet-4")
        event, ticket_type = self.customer_event()
        response = self.buy_tickets(quantity=1, method="wallet", event=event, ticket_type=ticket_type)
        self.assertEqual((response.status_code, response.json()["code"]), (409, "wallet_not_accepted"))
        ticket_type.refresh_from_db()
        self.assertEqual(ticket_type.quantity_sold, 0)
        self.assertEqual(self.balance(Account.CUSTOMER_WALLET, self.customer), 5000)

    def test_the_finalizer_refuses_a_wallet_payment_no_business_can_receive(self):
        fund(self.customer, 5000, "fund-1b-wallet-5")
        event, ticket_type = self.customer_event()
        with self.assertRaises(posting.PostingError), transaction.atomic():
            process_payment(
                kind=CheckoutSession.TICKET_PURCHASE, amount=Decimal("20.00"), purpose="Tickets", customer=self.customer,
                wallet=True, metadata={
                    "event_id": event.pk, "ticket_type_id": ticket_type.pk, "quantity": 1, "customer_id": self.customer.pk,
                    "delivery_method": ticket_type.delivery_method, "unit_price": "20.00",
                },
            )
        self.assertFalse(Ticket.objects.exists())
        self.assertEqual(self.balance(Account.CUSTOMER_WALLET, self.customer), 5000)

    def test_other_kinds_still_cannot_be_paid_from_the_wallet(self):
        with self.assertRaises(ValueError):
            process_payment(kind=CheckoutSession.EVENT_PAY, amount=Decimal("10.00"), purpose="Listing", customer=self.customer, wallet=True)
```

- [ ] **Step 2: Run it to see it fail**

Run: `docker compose -p svc1 run --rm web python manage.py test ledger.tests.test_booking_wallet --noinput`
Expected: FAIL — the wallet bodies answer `"payment_method": "momo"` (the field is ignored), `ValueError: Only a customer's order can be paid from the wallet` for the finalizer test, and no `code` on the refusals.

- [ ] **Step 3: The method, the refusals** — in `backend/payments/booking_pay.py` (a) replace

```python
from decimal import Decimal

from ledger import escrow
from ledger.money import from_pesewas, to_pesewas

from .providers import get_provider
from .services import process_payment

MOMO, WALLET = "momo", "wallet"
```

with

```python
from decimal import Decimal

from rest_framework.response import Response

from ledger import escrow
from ledger.models import Account
from ledger.money import from_pesewas, to_pesewas

from .providers import get_provider
from .services import process_payment

MOMO, WALLET = "momo", "wallet"
WALLET_OFF = "Paying from your AshantiHub wallet isn't switched on yet."
WALLET_TOO_LOW = "Your AshantiHub wallet doesn't hold enough for this."


class Refused(Exception):
    """A payment_method the request cannot use: `body` and `status_code` are the answer to give."""

    def __init__(self, body, status_code):
        super().__init__(body)
        self.body, self.status_code = body, status_code


def method_from(data):
    """`momo` (the default) or `wallet` from the request body. Raises Refused for anything else, and for the wallet while
    the ledger is off (only the ledger can debit it)."""
    method = (data.get("payment_method") if hasattr(data, "get") else None) or MOMO
    if method not in (MOMO, WALLET):
        raise Refused({"payment_method": "Pay by mobile money or from your AshantiHub wallet."}, 400)
    if method == WALLET and not escrow.enabled():
        raise Refused({"detail": WALLET_OFF, "code": "ledger_off"}, 409)
    return method


def too_low(exc):
    """The answer to posting.InsufficientFunds from a wallet payment (the caller's transaction has rolled back). Any other
    account going short is a bug and is raised again."""
    if exc.account.kind != Account.CUSTOMER_WALLET:
        raise exc
    return Response({"detail": WALLET_TOO_LOW, "code": "insufficient_funds"}, status=409)
```

- [ ] **Step 4: `process_payment` accepts the three kinds; the ticket finalizer's belt** — in `backend/payments/services.py` (a) replace

```python
FAILURE_HANDLERS = {
    CheckoutSession.TICKET_PURCHASE: _fail_ticket_purchase,
    CheckoutSession.ORDER_CHECKOUT: _fail_order_checkout,
}
```

with

```python
FAILURE_HANDLERS = {
    CheckoutSession.TICKET_PURCHASE: _fail_ticket_purchase,
    CheckoutSession.ORDER_CHECKOUT: _fail_order_checkout,
}

# What a customer may pay from their AshantiHub wallet: orders (wallets plan 3a) and, since ledger Plan 1b, services,
# stays and event tickets. Everything else (subscriptions, event listing fees, top-ups) goes through the provider.
WALLET_KINDS = (
    CheckoutSession.ORDER_CHECKOUT, CheckoutSession.SERVICE_REQUEST, CheckoutSession.BOOKING, CheckoutSession.TICKET_PURCHASE,
)
```

(b) replace

```python
    if wallet and (customer is None or kind != CheckoutSession.ORDER_CHECKOUT):
        raise ValueError("Only a customer's order can be paid from the wallet")
```

with

```python
    if wallet and (customer is None or kind not in WALLET_KINDS):
        raise ValueError("Only a customer's order or booking can be paid from the wallet")
```

(c) replace

```python
    if event.submitted_by_business_id is not None:  # a customer-organised event has no business to hold money for (Plan 1b S10)
        sales.record_payment(session, BookingSale.TICKETS, event, event.submitted_by_business)
```

with

```python
    if event.submitted_by_business_id is not None:  # a customer-organised event has no business to hold money for (Plan 1b S10)
        sales.record_payment(session, BookingSale.TICKETS, event, event.submitted_by_business)
    elif session.provider == CheckoutSession.WALLET:
        # Nothing would debit the wallet, so the tickets would be free: refuse, which rolls the purchase back.
        from ledger.posting import PostingError

        raise PostingError(f"Tickets {session.reference}: no business organises event {event.pk}, so the wallet cannot pay")
```

- [ ] **Step 5: Services** — in `backend/services/views.py` (a) after `from notifications.services import notify_business_owner, notify_customer` add `from ledger import posting`; (b) replace the whole `ServiceRequestPayView` class with

```python
class ServiceRequestPayView(APIView):
    """POST /api/services/requests/{id}/pay/ {payment_method?} — the customer pays for an accepted request, which moves
    it to in_progress. Routes through payments.booking_pay (simulated mode finalizes synchronously): by mobile money
    (the default; with the ledger on it carries "payment processing") or, with the ledger on, from the AshantiHub
    wallet, which must cover the whole price. The payment is one transaction, so a refused one leaves the request
    accepted and nothing else behind.
    """

    permission_classes = [IsAuthenticated, IsCustomer]

    def post(self, request, pk):
        sr = generics.get_object_or_404(ServiceRequest, pk=pk, customer=request.user)
        if sr.status != ServiceRequest.ACCEPTED:
            return Response({"detail": "Only an accepted request can be paid for."}, status=400)
        try:
            method = booking_pay.method_from(request.data)
        except booking_pay.Refused as exc:
            return Response(exc.body, status=exc.status_code)

        try:
            with db_transaction.atomic():
                # Locked and re-checked, so two taps on Pay never start two payments for one request (Plan 1b S15);
                # the finalizer locks the same row again. A second Hubtel checkout is still possible: gate (lix).
                sr = ServiceRequest.objects.select_for_update().get(pk=sr.pk)
                if sr.status != ServiceRequest.ACCEPTED:
                    return Response({"detail": "Only an accepted request can be paid for."}, status=400)
                result, processing = booking_pay.pay(
                    kind=CheckoutSession.SERVICE_REQUEST,
                    amount=sr.agreed_price,
                    purpose=f"Service: {sr.listing.name}",
                    customer=request.user,
                    metadata={"service_request_id": sr.id},
                    method=method,
                )
        except posting.InsufficientFunds as exc:
            return booking_pay.too_low(exc)
        if result["mode"] == "redirect":
            return Response(booking_pay.redirect_body(result, processing), status=status.HTTP_200_OK)
        sr.refresh_from_db()
        return Response(booking_pay.with_terms(ServiceRequestSerializer(sr).data, processing, method=method))
```

- [ ] **Step 6: Stays** — in `backend/bookings/views.py` (a) replace `from payments import booking_pay` with

```python
from ledger import posting
from payments import booking_pay
```

(b) replace the whole `post` method of `BookingCreateView` with

```python
    def post(self, request):
        serializer = BookingCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            method = booking_pay.method_from(request.data)
        except booking_pay.Refused as exc:
            return Response(exc.body, status=exc.status_code)

        today = timezone.now().date()
        if data["check_in"] < today:
            return Response({"check_in": "Check-in can't be in the past."}, status=400)

        try:
            with db_transaction.atomic():
                listing = generics.get_object_or_404(
                    Listing.objects.select_for_update(), pk=data["listing"]
                )
                if listing.status != Listing.PUBLISHED:
                    return Response({"listing": "This listing isn't available."}, status=400)
                if not (listing.category and listing.category.is_accommodation):
                    return Response({"listing": "This listing isn't a bookable accommodation."}, status=400)
                if listing.price_amount is None:
                    return Response({"listing": "This listing has no nightly rate set."}, status=400)

                if not is_available(listing, data["check_in"], data["check_out"], data["units"]):
                    return Response(
                        {"detail": "Those dates aren't available for the number of units requested."},
                        status=status.HTTP_409_CONFLICT,
                    )

                nights = (data["check_out"] - data["check_in"]).days
                total = listing.price_amount * nights * data["units"]
                booking = Booking.objects.create(
                    customer=request.user,
                    listing=listing,
                    business_owner=listing.business_owner,
                    check_in=data["check_in"],
                    check_out=data["check_out"],
                    units=data["units"],
                    nightly_rate=listing.price_amount,
                    total_price=total,
                    status=Booking.PENDING,
                )

                result, processing = booking_pay.pay(
                    kind=CheckoutSession.BOOKING,
                    amount=total,
                    purpose=f"Booking: {listing.name} ({data['check_in']} → {data['check_out']})",
                    customer=request.user,
                    metadata={"booking_id": booking.id},
                    method=method,
                )
                if result["mode"] == "redirect":
                    return Response(booking_pay.redirect_body(result, processing), status=status.HTTP_200_OK)
                booking.refresh_from_db()
        except posting.InsufficientFunds as exc:
            return booking_pay.too_low(exc)  # the booking rolled back with the payment: its nights stay free

        notify_business_owner(
            listing.business_owner, "booking", "New booking",
            body=f"A customer booked “{listing.name}” for {nights} night(s).",
            link="/business-dashboard", icon="🏨",
        )
        return Response(booking_pay.with_terms(BookingSerializer(booking).data, processing, method=method), status=201)
```

- [ ] **Step 7: Tickets** — in `backend/events/views.py` (a) after `from payments import booking_pay` add `from ledger import posting`; (b) replace the whole `post` method of `TicketPurchaseView` with

```python
    def post(self, request, pk):
        input_serializer = TicketPurchaseInputSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        quantity = input_serializer.validated_data["quantity"]
        try:
            method = booking_pay.method_from(request.data)
        except booking_pay.Refused as exc:
            return Response(exc.body, status=exc.status_code)

        event = generics.get_object_or_404(_live_events_queryset(), pk=pk)
        # Tickets for an event a customer organised stay outside the ledger (Plan 1b S10): no business holds them, so
        # nothing could take the money from a wallet.
        in_ledger = event.submitted_by_business_id is not None
        if method == booking_pay.WALLET and not in_ledger:
            return Response(
                {"detail": "Tickets for this event can only be paid by mobile money.", "code": "wallet_not_accepted"},
                status=409,
            )

        try:
            with db_transaction.atomic():
                try:
                    ticket_type = EventTicketType.objects.select_for_update().get(
                        pk=input_serializer.validated_data["ticket_type"].pk,
                        event=event,
                        is_active=True,
                    )
                except EventTicketType.DoesNotExist:
                    return Response({"detail": "Ticket type not found for this event."}, status=404)

                if (
                    ticket_type.quantity_total is not None
                    and ticket_type.quantity_sold + quantity > ticket_type.quantity_total
                ):
                    return Response({"detail": "Not enough tickets remaining."}, status=400)

                # Reserve inventory now, under this lock, regardless of provider
                # — see docstring above for why this can't wait for webhook
                # confirmation.
                ticket_type.quantity_sold += quantity
                ticket_type.save(update_fields=["quantity_sold"])

                result, processing = booking_pay.pay(
                    kind=CheckoutSession.TICKET_PURCHASE,
                    amount=ticket_type.price * quantity,
                    purpose=f"{quantity}x '{ticket_type.name}' ticket(s) for '{event.name}'",
                    customer=request.user,
                    metadata={
                        "event_id": event.id,
                        "ticket_type_id": ticket_type.id,
                        "quantity": quantity,
                        "customer_id": request.user.id,
                        "delivery_method": ticket_type.delivery_method,
                        "unit_price": str(ticket_type.price),
                    },
                    method=method,
                    in_ledger=in_ledger,
                )

                if result["mode"] == "redirect":
                    return Response(booking_pay.redirect_body(result, processing, in_ledger=in_ledger), status=200)

                # Immediate/simulated mode — process_payment() already ran
                # payments.services._finalize_ticket_purchase, which created the
                # Ticket row(s) and recorded their ids on the session's metadata.
                ticket_ids = result["session"].metadata.get("ticket_ids", [])
                tickets = Ticket.objects.filter(id__in=ticket_ids)
        except posting.InsufficientFunds as exc:
            return booking_pay.too_low(exc)  # the reservation rolled back with the payment

        return Response(
            TicketSerializer(tickets, many=True, context={"request": request}).data, status=201
        )
```

- [ ] **Step 8: Run the tests**

Run: `docker compose -p svc1 run --rm web python manage.py test ledger.tests.test_booking_wallet ledger.tests.test_booking_wiring ledger.tests.test_wallet_payment orders payments services bookings events --noinput`
Expected: PASS (7 new tests; Task 3's and the existing suites unchanged).

- [ ] **Step 9: Commit**

```bash
git add backend/payments/booking_pay.py backend/payments/services.py backend/services/views.py backend/bookings/views.py backend/events/views.py backend/ledger/tests/test_booking_wallet.py
git commit -m "feat(ledger): pay a service, a stay or tickets from the wallet; nothing kept when it is too low (1b)" --trailer "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>" --trailer "Claude-Session: https://claude.ai/code/session_01HDHNosHkqu4Wwocp7a2c8j"
```

---

### Task 5: Hand-over, Support's verification call and the release

**Files:**
- Modify: `backend/ledger/sales.py` (imports; append the after-payment section), `backend/ledger/settings_store.py` (the label of `verification_overdue_hours`), `backend/events/views.py` (`_ledger_sale`, `LEDGER_RELEASES`, `EventCheckinView.post`, `EscrowReleaseView.post`, `EscrowHoldView.post`)
- Create: `backend/ledger/tests/test_booking_release.py`

**Interfaces:**
- Consumes: `sales.pay_key`, `release_key`, `record_payment` (Task 2); `verification.VerificationError(message, status_code=409)`; `settings_store.current("verification_overdue_hours", at)`; `disputes.Dispute`.
- Produces (module `ledger.sales`):
  - `MATCHES`, `DOES_NOT_MATCH`, `UNREACHABLE` (the `FulfilmentCheck` outcomes), `NOT_HANDED_OVER` (kind → message)
  - `tickets_of(sale) -> QuerySet[Ticket]` (empty for a non-ticket sale)
  - `handed_over_at(sale, now=None) -> datetime | None`, `customer_confirmed(sale) -> bool`, `has_open_dispute(sale) -> bool`
  - `lock(sale) -> BookingSale` (subject row(s), then the sale row, fresh; call inside `transaction.atomic()`)
  - `release(sale, now=None) -> Journal | None` (caller holds `lock(sale)`)
  - `record_verification(sale, staff, outcome, *, note="", customer_confirmed_by_phone=False, now=None) -> BookingSale` (raises `VerificationError`)
- Produces (module `events.views`): `LEDGER_RELEASES`, `_ledger_sale(ticket) -> BookingSale | None`; a scan of a ticket in a sale keeps it `held`; manual release/hold of one answer `409 {"code": "ledger_on"}`

- [ ] **Step 1: Write the failing test** — `backend/ledger/tests/test_booking_release.py`

```python
"""Release of a booking's money on Support's verification call (Plan 1b, Task 5; spec §4.2): what "handed over" means for
each kind, the receipt confirmation, the mismatch dispute, and tickets' escrow flags following the sale. Review Focus 3
(release refused before hand-over and while a dispute is open)."""
from datetime import timedelta

from django.test import override_settings
from django.utils import timezone

from accounts.testing import make_staff
from bookings.models import Booking
from disputes.models import Dispute
from events.models import Event, Ticket
from ledger import sales
from ledger.models import Account, Journal
from ledger.verification import VerificationError
from services.models import ServiceRequest

from .booking_helpers import BookingBase


@override_settings(LEDGER_ENABLED=True)
class BookingReleaseTests(BookingBase):
    def setUp(self):
        super().setUp()
        self.support = make_staff("support", "esi-1b@example.com")

    def call(self, sale, outcome, **extra):
        return sales.record_verification(sale, self.support, outcome, **extra)

    def complete(self, sale, at=None):
        ServiceRequest.objects.filter(pk=sale.service_request_id).update(
            status=ServiceRequest.COMPLETED, completed_at=at or timezone.now(),
        )

    def test_a_service_is_released_once_done_and_confirmed_fee_first(self):
        sale = self.paid_service("200.00")
        with self.assertRaisesMessage(VerificationError, "The business has not marked this service done yet."):
            self.call(sale, "matches", customer_confirmed_by_phone=True)
        self.complete(sale)
        with self.assertRaisesMessage(VerificationError, "Record the customer's confirmation first."):
            self.call(sale, "matches")
        sale = self.call(sale, "matches", customer_confirmed_by_phone=True)
        self.assertIsNotNone(sale.released_at)
        self.assertEqual(self.balance(Account.VENDOR_PENDING, self.owner), 0)
        self.assertEqual(self.balance(Account.VENDOR_AVAILABLE, self.owner), 19500)            # 200.00 − GH₵ 5.00
        self.assertEqual(self.balance(Account.PLATFORM_FEE_INCOME), 500)
        kinds = [line.account.kind for line in Journal.objects.get(key=f"booking-release-{sale.pk}").lines.order_by("id")]
        self.assertEqual(kinds, [Account.VENDOR_PENDING, Account.PLATFORM_FEE_INCOME, Account.VENDOR_AVAILABLE])
        with self.assertRaisesMessage(VerificationError, "already been released"):
            self.call(sale, "matches")

    def test_a_stay_is_handed_over_at_check_in(self):
        sale = self.paid_stay(nights=2)                                                         # GH₵ 300.00
        with self.assertRaisesMessage(VerificationError, "The guest has not checked in yet."):
            self.call(sale, "matches", customer_confirmed_by_phone=True)
        Booking.objects.filter(pk=sale.booking_id).update(status=Booking.CHECKED_IN, checked_in_at=timezone.now())
        self.call(sale, "matches", customer_confirmed_by_phone=True)
        self.assertEqual(self.balance(Account.VENDOR_AVAILABLE, self.owner), 29500)

    def test_a_scanned_ticket_hands_over_and_confirms_and_release_marks_the_tickets_released(self):
        sale = self.paid_tickets(quantity=2)                                                    # GH₵ 100.00
        with self.assertRaisesMessage(VerificationError, "The event has not taken place yet and no ticket was scanned."):
            self.call(sale, "matches", customer_confirmed_by_phone=True)
        first = Ticket.objects.filter(transaction=sale.session.transaction).order_by("pk").first()
        self.as_owner()
        response = self.client.post(f"/api/events/{self.event.pk}/tickets/checkin/", {"code": first.code}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        first.refresh_from_db()
        self.assertIsNotNone(first.delivered_at)
        self.assertEqual(first.escrow_status, Ticket.HELD)                                      # the scan releases nothing
        self.call(sale, "matches")                                                              # the scan is the confirmation
        statuses = set(Ticket.objects.filter(transaction=sale.session.transaction).values_list("escrow_status", flat=True))
        self.assertEqual(statuses, {Ticket.RELEASED})
        self.assertEqual(self.balance(Account.VENDOR_AVAILABLE, self.owner), 9500)

    def test_after_the_events_date_tickets_count_as_handed_over_but_need_the_call(self):
        sale = self.paid_tickets(quantity=1)                                                    # GH₵ 50.00: 1% fee
        Event.objects.filter(pk=self.event.pk).update(event_date=timezone.now() - timedelta(hours=1))
        with self.assertRaisesMessage(VerificationError, "Record the customer's confirmation first."):
            self.call(sale, "matches")
        self.call(sale, "matches", customer_confirmed_by_phone=True)
        self.assertEqual(self.balance(Account.VENDOR_AVAILABLE, self.owner), 4950)

    def test_review_focus_a_mismatch_opens_a_dispute_due_72_hours_after_hand_over_and_releases_nothing(self):
        sale = self.paid_service()
        done = timezone.now() - timedelta(hours=2)
        self.complete(sale, at=done)
        sale = self.call(sale, "does_not_match", note="Only half the rooms were cleaned")
        dispute = sale.dispute
        self.assertEqual((dispute.status, dispute.order, dispute.raised_by, dispute.logged_by), (Dispute.OPEN, None, None, self.support))
        self.assertEqual(dispute.answer_due_at, done + timedelta(hours=72))
        self.assertIn("Only half the rooms were cleaned", dispute.description)
        self.assertEqual(self.balance(Account.VENDOR_PENDING, self.owner), 20000)
        with self.assertRaisesMessage(VerificationError, "A dispute is open on this booking."):
            self.call(sale, "matches", customer_confirmed_by_phone=True)
        self.call(sale, "does_not_match", note="Still not right")                              # no second dispute
        self.assertEqual(Dispute.objects.count(), 1)
        Dispute.objects.filter(pk=dispute.pk).update(status=Dispute.RESOLVED)
        self.call(sale, "matches", customer_confirmed_by_phone=True)
        self.assertEqual(self.balance(Account.VENDOR_AVAILABLE, self.owner), 19500)

    def test_could_not_reach_is_only_recorded(self):
        sale = self.paid_service()
        self.complete(sale)
        sale = self.call(sale, "unreachable")
        self.assertEqual((sale.outcome, sale.released_at, sale.outcome_by), ("unreachable", None, self.support))
        self.assertEqual(self.balance(Account.VENDOR_PENDING, self.owner), 20000)

    def test_bad_input_is_refused_before_anything_is_saved(self):
        sale = self.paid_service()
        self.complete(sale)
        cases = (("maybe", "", "Pick matches"), ("does_not_match", "", "Say what does not match."), ("unreachable", 5, "The note must be text."))
        for outcome, note, message in cases:
            with self.subTest(outcome=outcome), self.assertRaisesMessage(VerificationError, message):
                self.call(sale, outcome, note=note)
        sale.refresh_from_db()
        self.assertEqual(sale.outcome, "")

    def test_the_manual_ticket_release_and_hold_are_refused_for_a_ledger_ticket(self):
        sale = self.paid_tickets(quantity=1)
        ticket = Ticket.objects.get(transaction=sale.session.transaction)
        self.as_staff(make_staff("accountant", "kofi-1b@example.com"), sudo=True)
        for action in ("release", "hold"):
            response = self.client.post(f"/api/events/tickets/{ticket.pk}/escrow/{action}/", {"note": "Checked by hand"}, format="json")
            with self.subTest(action=action):
                self.assertEqual((response.status_code, response.json()["code"]), (409, "ledger_on"))
        ticket.refresh_from_db()
        self.assertEqual(ticket.escrow_status, Ticket.HELD)
        self.assertEqual(self.balance(Account.VENDOR_PENDING, self.owner), 5000)
```

- [ ] **Step 2: Run it to see it fail**

Run: `docker compose -p svc1 run --rm web python manage.py test ledger.tests.test_booking_release --noinput`
Expected: ERROR — `AttributeError: module 'ledger.sales' has no attribute 'record_verification'`.

- [ ] **Step 3: The imports** — in `backend/ledger/sales.py` replace

```python
from django.db import transaction
from django.utils import timezone

from . import escrow, fees, posting, settings_store
from .models import Account, BookingSale, FeeRuleSet
from .money import to_pesewas
```

with

```python
from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from . import escrow, fees, posting, settings_store
from .models import Account, BookingSale, FeeRuleSet, FulfilmentCheck, Journal
from .money import to_pesewas
from .verification import VerificationError
```

- [ ] **Step 4: Hand-over, the call and the release** — append to `backend/ledger/sales.py`

```python


# --- after payment: hand-over, Support's call and the release (spec §4.2; Plan 1b S5–S9) ---------------------------

MATCHES, DOES_NOT_MATCH, UNREACHABLE = FulfilmentCheck.MATCHES, FulfilmentCheck.DOES_NOT_MATCH, FulfilmentCheck.UNREACHABLE
NOT_HANDED_OVER = {
    BookingSale.SERVICE: "The business has not marked this service done yet.",
    BookingSale.STAY: "The guest has not checked in yet.",
    BookingSale.TICKETS: "The event has not taken place yet and no ticket was scanned.",
}


def tickets_of(sale):
    """A ticket purchase's tickets (those bought on its checkout session's transaction); none for another kind."""
    from events.models import Ticket

    if sale.kind != BookingSale.TICKETS:
        return Ticket.objects.none()
    return Ticket.objects.filter(transaction_id=sale.session.transaction_id)


def handed_over_at(sale, now=None):
    """When the booking reached the customer, or None (spec §4.2, settled in Plan 1b S5): the business marked the
    service done; the guest checked in; for tickets, the first scan at the door, or else the event's date once it has
    passed."""
    now = now or timezone.now()
    if sale.kind == BookingSale.SERVICE:
        return sale.service_request.completed_at
    if sale.kind == BookingSale.STAY:
        return sale.booking.checked_in_at
    first_scan = (
        tickets_of(sale).filter(delivered_at__isnull=False).order_by("delivered_at").values_list("delivered_at", flat=True).first()
    )
    if first_scan is not None:
        return first_scan
    return sale.event.event_date if sale.event.event_date <= now else None


def customer_confirmed(sale):
    """Support recorded the customer's confirmation on the call, or a ticket of the purchase was scanned at the door."""
    if sale.phone_confirmed_at is not None:
        return True
    return tickets_of(sale).filter(delivered_at__isnull=False).exists()


def has_open_dispute(sale):
    from disputes.models import Dispute

    return sale.dispute_id is not None and Dispute.objects.filter(pk=sale.dispute_id).exclude(status__in=Dispute.FINAL_STATUSES).exists()


def lock(sale):
    """Take the locks a money step on `sale` needs, in the one order every path uses (module docstring): the service
    request or stay booking row (tickets: the purchase's tickets in primary-key order), then the sale row. Returns the
    sale fresh from its locked row. Call inside transaction.atomic()."""
    from bookings.models import Booking
    from events.models import Ticket
    from services.models import ServiceRequest

    if sale.kind == BookingSale.SERVICE:
        ServiceRequest.objects.select_for_update().get(pk=sale.service_request_id)
    elif sale.kind == BookingSale.STAY:
        Booking.objects.select_for_update().get(pk=sale.booking_id)
    else:
        list(Ticket.objects.select_for_update().filter(transaction_id=sale.session.transaction_id).order_by("pk"))
    return BookingSale.objects.select_for_update(of=("self",)).select_related(
        "session", "service_request", "booking", "event", "customer", "business_owner",
    ).get(pk=sale.pk)


def release(sale, now=None):
    """Pay a verified booking's held money out (spec §4.2 and §2.2 step 2): AshantiHub's fee first, then the business's
    Available, only what refunds left. Never by a timer: record_verification, on "matches", is the only caller and holds
    lock(sale). Returns the journal, or None while the ledger is off, without a positive call, with a dispute open, or
    once released or refunded in full. It also marks the purchase's tickets released (their old escrow flag, S9)."""
    from events.models import Ticket

    if not escrow.enabled():
        return None
    now = now or timezone.now()
    if sale.outcome != MATCHES or sale.released_at is not None or sale.reversed_at is not None or has_open_dispute(sale):
        return None
    if Journal.objects.filter(key=release_key(sale)).exists() or not Journal.objects.filter(key=pay_key(sale.session)).exists():
        return None
    base = sale.base_pesewas - sale.refunded_base_pesewas
    fee = sale.charged_pesewas - sale.refunded_fee_pesewas
    pending = posting.account_for(Account.VENDOR_PENDING, sale.business_owner)
    income = posting.account_for(Account.PLATFORM_FEE_INCOME)
    available = posting.account_for(Account.VENDOR_AVAILABLE, sale.business_owner)
    posting.lock(pending, income, available)
    lines = [posting.debit(pending, base)]
    if fee > 0:
        lines.append(posting.credit(income, fee))
    if base - fee > 0:
        lines.append(posting.credit(available, base - fee))
    journal = posting.post(
        key=release_key(sale), kind="booking_release", lines=lines,
        reference_type="ledger.bookingsale", reference_id=str(sale.pk), memo=f"Release of {sale.label()}",
    )
    sale.released_at = now
    sale.save(update_fields=["released_at"])
    tickets_of(sale).filter(refunded_at__isnull=True, escrow_status=Ticket.HELD).update(
        escrow_status=Ticket.RELEASED, escrow_released_at=now,
    )
    return journal


def record_verification(sale, staff, outcome, *, note="", customer_confirmed_by_phone=False, now=None):
    """Support's verification call for a booking (spec §4.2). "matches" releases the money at once; "does not match"
    opens a dispute due `verification_overdue_hours` after hand-over (S7) and releases nothing; "could not reach" is only
    recorded. Raises VerificationError, saving nothing, when the booking cannot be verified now. Returns the sale."""
    from disputes.models import Dispute

    now = now or timezone.now()
    if outcome not in (MATCHES, DOES_NOT_MATCH, UNREACHABLE):
        raise VerificationError("Pick matches, does not match, or could not reach.", 400)
    if note is not None and not isinstance(note, str):
        raise VerificationError("The note must be text.", 400)
    note = (note or "").strip()[:500]
    if outcome == DOES_NOT_MATCH and not note:
        raise VerificationError("Say what does not match.", 400)
    with transaction.atomic():
        sale = lock(sale)
        if sale.reversed_at is not None:
            raise VerificationError("This booking was refunded in full.")
        if sale.released_at is not None:
            raise VerificationError("This booking has already been released to the business.")
        handed = handed_over_at(sale, now)
        if handed is None:
            raise VerificationError(NOT_HANDED_OVER[sale.kind])
        if outcome == MATCHES:
            if has_open_dispute(sale):
                raise VerificationError("A dispute is open on this booking. It must be settled first.")
            if customer_confirmed_by_phone and sale.phone_confirmed_at is None:
                sale.phone_confirmed_at = now
            if not customer_confirmed(sale):
                raise VerificationError("Record the customer's confirmation first.")
        if outcome == DOES_NOT_MATCH and not has_open_dispute(sale):
            hours = settings_store.current("verification_overdue_hours", now)
            # Logged by staff on the customer's behalf: raised_by stays null (the disputes convention, S8).
            sale.dispute = Dispute.objects.create(
                order=None, raised_by=None, logged_by=staff, reason=Dispute.QUALITY_ISSUE, status=Dispute.OPEN,
                description=f"{sale.label().capitalize()} does not match: {note}", answer_due_at=handed + timedelta(hours=hours),
            )
        sale.outcome, sale.outcome_note, sale.outcome_at, sale.outcome_by = outcome, note, now, staff
        sale.save(update_fields=["phone_confirmed_at", "outcome", "outcome_note", "outcome_at", "outcome_by", "dispute"])
        if outcome == MATCHES and escrow.enabled() and release(sale, now) is None:
            raise VerificationError("The booking could not be released. Check for an open dispute and try again.", 409)
        return sale
```

- [ ] **Step 5: Tickets' escrow flags follow the sale** — in `backend/events/views.py` (a) replace

```python
def _checkin_serializer_for(user):
    """Staff see the ticket buyer's phone; an event's organizer never does."""
    return StaffTicketCheckinListSerializer if isinstance(user, StaffUser) else TicketCheckinListSerializer
```

with

```python
def _checkin_serializer_for(user):
    """Staff see the ticket buyer's phone; an event's organizer never does."""
    return StaffTicketCheckinListSerializer if isinstance(user, StaffUser) else TicketCheckinListSerializer


LEDGER_RELEASES = "With the ledger on, this ticket's money is released by Support's call to the customer."


def _ledger_sale(ticket):
    """The ledger's booking sale this ticket was bought in (ledger Plan 1b), or None: the ledger is off, the purchase
    was made before it was on, or the event's organiser is a customer. Only a ticket in a sale has its money in the
    ledger, and then its escrow flag follows the sale (ledger.sales.release)."""
    from ledger import escrow
    from ledger.models import BookingSale

    if not escrow.enabled():
        return None
    return BookingSale.objects.filter(session__transaction_id=ticket.transaction_id).first()
```

(b) replace the whole `post` method of `EventCheckinView` with

```python
    def post(self, request, pk):
        event = generics.get_object_or_404(Event, pk=pk)
        self.check_object_permissions(request, event)

        code = (request.data.get("code") or "").strip()
        with db_transaction.atomic():
            # Locked, so a scan and a refund of the same ticket never cross (ledger Plan 1b S15).
            ticket = generics.get_object_or_404(
                Ticket.objects.select_for_update(of=("self",)), code=code, ticket_type__event=event,
            )

            if ticket.delivered_at is not None:
                return Response({"detail": "This ticket has already been checked in."}, status=400)
            if ticket.refunded_at is not None:
                return Response(
                    {"detail": "This ticket was refunded and cannot be checked in."}, status=400
                )

            ticket.delivered_at = timezone.now()
            ticket.delivered_by_staff = request.user if isinstance(request.user, StaffUser) else None
            update_fields = ["delivered_at", "delivered_by_staff"]

            # With the ledger on, a ticket bought in a booking sale is released by Support's call, not by the scan.
            if ticket.escrow_status == Ticket.HELD and _ledger_sale(ticket) is None:
                ticket.escrow_status = Ticket.RELEASED
                ticket.escrow_released_at = timezone.now()
                update_fields += ["escrow_status", "escrow_released_at"]

            ticket.save(update_fields=update_fields)
        return Response(_checkin_serializer_for(request.user)(ticket).data)
```

(c) in `EscrowReleaseView.post` replace

```python
        if note is None:
            return Response({"note": "Write a note of at least 3 characters: every release is explained."}, status=400)
        with db_transaction.atomic():
```

with

```python
        if note is None:
            return Response({"note": "Write a note of at least 3 characters: every release is explained."}, status=400)
        if _ledger_sale(generics.get_object_or_404(Ticket, pk=ticket_id)) is not None:
            return Response({"detail": LEDGER_RELEASES, "code": "ledger_on"}, status=409)
        with db_transaction.atomic():
```

(d) in `EscrowHoldView.post` replace

```python
        if note is None:
            return Response({"note": "Write a note of at least 3 characters: every hold is explained."}, status=400)
        with db_transaction.atomic():
```

with

```python
        if note is None:
            return Response({"note": "Write a note of at least 3 characters: every hold is explained."}, status=400)
        if _ledger_sale(generics.get_object_or_404(Ticket, pk=ticket_id)) is not None:
            return Response({"detail": LEDGER_RELEASES, "code": "ledger_on"}, status=409)
        with db_transaction.atomic():
```

- [ ] **Step 6: The setting's label says both anchors** — in `backend/ledger/settings_store.py` replace

```python
    "verification_overdue_hours": Definition("Hours after purchase by which an order must be verified or disputed", 72, False, 1, 720),
```

with

```python
    "verification_overdue_hours": Definition(
        "Hours after purchase (orders) or after hand-over (services, stays, tickets) by which a sale must be verified or disputed",
        72, False, 1, 720,
    ),
```

The label is shown on the Accounting money-settings screen and its approvals (`ledger/views.py`); no test asserts it. If the owner wants the two anchors to take different hours, add a separate `booking_verification_overdue_hours` setting instead (gate (lvii)).

- [ ] **Step 7: Run the tests**

Run: `docker compose -p svc1 run --rm web python manage.py test ledger.tests.test_booking_release events --noinput`
Expected: PASS (8 new tests; the events suite unchanged — with the ledger off a scan still releases the flag).

- [ ] **Step 8: Commit**

```bash
git add backend/ledger/sales.py backend/ledger/settings_store.py backend/events/views.py backend/ledger/tests/test_booking_release.py
git commit -m "feat(ledger): booking hand-over, Support's verification call and the release; ticket flags follow the sale (1b)" --trailer "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>" --trailer "Claude-Session: https://claude.ai/code/session_01HDHNosHkqu4Wwocp7a2c8j"
```

---

### Task 6: Support's booking queue and the call over the API

**Files:**
- Modify: `backend/ledger/sales.py` (imports; append the queue section), `backend/ledger/urls.py`
- Create: `backend/ledger/views_bookings.py`, `backend/ledger/tests/test_booking_verification_api.py`

**Interfaces:**
- Consumes: `sales.handed_over_at`, `customer_confirmed`, `record_verification`, `VerificationError` (Task 5); `accounts.permissions.HasRolePermission`.
- Produces:
  - `sales.description(sale) -> str` (what was bought, in words), `sales.awaiting(now=None) -> QuerySet[BookingSale]` (handed over, not released, not refunded in full, oldest paid first), `sales.queue_row(sale, now, hours) -> dict`
  - module `ledger.views_bookings`: `VERIFY = "orders.verify"`, `ledger_off()`, `Pagination` (20), `AwaitingBookingsView`, `BookingVerificationView`
  - URLs `bookings/awaiting-verification/` (`ledger-bookings-awaiting`), `bookings/<int:pk>/verification/` (`ledger-booking-verification`) under `/api/ledger/`

- [ ] **Step 1: Write the failing test** — `backend/ledger/tests/test_booking_verification_api.py`

```python
"""Support's booking queue and the call over the API (Plan 1b, Task 6): handed-over bookings, oldest paid first, with
what the call needs; the call's answers; who may see it. Review Focus 8 (switches off)."""
from datetime import timedelta

from django.test import override_settings
from django.utils import timezone

from accounts.testing import make_staff
from bookings.models import Booking
from disputes.models import Dispute
from ledger.models import BookingSale
from services.models import ServiceRequest

from .booking_helpers import BookingBase

QUEUE = "/api/ledger/bookings/awaiting-verification/"


@override_settings(LEDGER_ENABLED=True)
class BookingQueueApiTests(BookingBase):
    def setUp(self):
        super().setUp()
        self.support = make_staff("support", "esi-q@example.com")
        self.desk = make_staff("pickup_desk", "desk-q@example.com")

    def done(self, sale, at=None):
        ServiceRequest.objects.filter(pk=sale.service_request_id).update(
            status=ServiceRequest.COMPLETED, completed_at=at or timezone.now(),
        )

    def verify(self, sale, **body):
        return self.client.post(f"/api/ledger/bookings/{sale.pk}/verification/", body, format="json")

    def test_the_queue_lists_handed_over_bookings_oldest_first_with_what_the_call_needs(self):
        waiting = self.paid_service()                                                          # not done yet: not listed
        cleaned = self.paid_service("150.00")
        self.done(cleaned, at=timezone.now() - timedelta(hours=73))
        BookingSale.objects.filter(pk=cleaned.pk).update(paid_at=timezone.now() - timedelta(days=5))
        stay = self.paid_stay(nights=1)
        Booking.objects.filter(pk=stay.booking_id).update(status=Booking.CHECKED_IN, checked_in_at=timezone.now())
        self.as_staff(self.support)
        body = self.client.get(QUEUE).json()
        self.assertEqual(body["count"], 2)
        first, second = body["results"]
        self.assertEqual((first["sale_id"], first["kind"], first["overdue"], first["amount"]), (cleaned.pk, "service", True, "150.00"))
        self.assertEqual(
            (first["what"], first["business"], first["customer_name"], first["customer_phone"]),
            ("Home Cleaning", "Kwame Mensah", "Ama Owusu", "+233200770001"),
        )
        self.assertEqual((second["sale_id"], second["kind"], second["overdue"], second["customer_confirmed"]), (stay.pk, "stay", False, False))
        self.assertNotIn(waiting.pk, [row["sale_id"] for row in body["results"]])

    def test_recording_the_call_through_the_api_releases_and_empties_the_queue(self):
        sale = self.paid_service()
        self.done(sale)
        self.as_staff(self.support)
        response = self.verify(sale, outcome="matches", customer_confirmed_by_phone=True)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json(), {"sale": sale.pk, "outcome": "matches", "dispute_id": None, "released": True})
        self.assertEqual(self.client.get(QUEUE).json()["count"], 0)

    def test_a_mismatch_answers_its_dispute_and_refusals_answer_their_status(self):
        sale = self.paid_service()
        self.as_staff(self.support)
        response = self.verify(sale, outcome="matches")
        self.assertEqual((response.status_code, response.json()["detail"]), (409, "The business has not marked this service done yet."))
        self.done(sale)
        self.assertEqual(self.verify(sale, outcome="does_not_match").status_code, 400)
        body = self.verify(sale, outcome="does_not_match", note="Wrong service").json()
        self.assertEqual((body["dispute_id"], body["released"]), (Dispute.objects.get().pk, False))

    def test_only_support_and_super_admin_see_or_record_it(self):
        sale = self.paid_service()
        self.as_staff(self.desk)
        self.assertEqual(self.client.get(QUEUE).status_code, 403)
        self.assertEqual(self.verify(sale, outcome="unreachable").status_code, 403)
        self.as_customer()
        self.assertIn(self.client.get(QUEUE).status_code, (401, 403))

    @override_settings(LEDGER_ENABLED=False)
    def test_review_focus_with_the_ledger_off_the_booking_screens_say_so(self):
        self.as_staff(self.support)
        response = self.client.get(QUEUE)
        self.assertEqual((response.status_code, response.json()["code"]), (409, "ledger_off"))
        self.assertEqual(self.client.post("/api/ledger/bookings/1/verification/", {}, format="json").json()["code"], "ledger_off")
```

- [ ] **Step 2: Run it to see it fail**

Run: `docker compose -p svc1 run --rm web python manage.py test ledger.tests.test_booking_verification_api --noinput`
Expected: FAIL — 404 for `/api/ledger/bookings/...`.

- [ ] **Step 3: The imports** — in `backend/ledger/sales.py` replace

```python
from django.db import transaction
from django.utils import timezone

from . import escrow, fees, posting, settings_store
from .models import Account, BookingSale, FeeRuleSet, FulfilmentCheck, Journal
from .money import to_pesewas
```

with

```python
from django.db import transaction
from django.db.models import Exists, OuterRef, Q
from django.utils import timezone

from . import escrow, fees, posting, settings_store
from .models import Account, BookingSale, FeeRuleSet, FulfilmentCheck, Journal
from .money import from_pesewas, to_pesewas
```

- [ ] **Step 4: The queue** — append to `backend/ledger/sales.py`

```python


# --- Support's list (Plan 1b; paginated from the start, unlike the products list, spec §13 (ii)) --------------------

def description(sale):
    """What was bought, in words, for Support's call and the business's sales list."""
    if sale.kind == BookingSale.SERVICE:
        return sale.service_request.listing.name
    if sale.kind == BookingSale.STAY:
        booking = sale.booking
        units = f", {booking.units} units" if booking.units != 1 else ""
        return f"{booking.listing.name}, {booking.check_in:%d %b} to {booking.check_out:%d %b}{units}"
    quantity = int(sale.session.metadata.get("quantity") or 0)
    noun = "ticket" if quantity == 1 else "tickets"
    return f"{quantity} {noun} for {sale.event.name}, {timezone.localtime(sale.event.event_date):%d %b %Y}"


def awaiting(now=None):
    """Bookings handed over (S5) and waiting for Support's call: not released and not refunded in full, oldest paid
    first. A queryset, for a paginated screen."""
    from events.models import Ticket

    now = now or timezone.now()
    scanned = Ticket.objects.filter(transaction_id=OuterRef("session__transaction_id"), delivered_at__isnull=False)
    return (
        BookingSale.objects.filter(released_at__isnull=True, reversed_at__isnull=True)
        .annotate(scanned=Exists(scanned))
        .filter(
            Q(kind=BookingSale.SERVICE, service_request__completed_at__isnull=False)
            | Q(kind=BookingSale.STAY, booking__checked_in_at__isnull=False)
            | Q(kind=BookingSale.TICKETS, scanned=True)
            | Q(kind=BookingSale.TICKETS, event__event_date__lte=now)
        )
        .select_related(
            "session", "customer", "business_owner__profile", "service_request__listing", "booking__listing", "event",
        )
        .order_by("paid_at", "id")
    )


def queue_row(sale, now, hours):
    """One row of Support's list. `due_by` and `overdue` count `hours` (verification_overdue_hours) from hand-over (S7).
    Carries the customer's phone: only for the orders.verify screen."""
    handed = handed_over_at(sale, now)
    due = handed + timedelta(hours=hours) if handed is not None else None
    return {
        "sale_id": sale.pk, "kind": sale.kind, "label": sale.label(), "what": description(sale), "paid_at": sale.paid_at,
        "handed_over_at": handed, "due_by": due, "overdue": due is not None and now > due,
        "business": sale.business_owner.display_name, "customer_name": sale.customer.full_name,
        "customer_phone": sale.customer.phone,
        "amount": str(from_pesewas(sale.base_pesewas - sale.refunded_base_pesewas)),
        "customer_confirmed": customer_confirmed(sale), "outcome": sale.outcome, "outcome_note": sale.outcome_note,
        "dispute_id": sale.dispute_id,
    }
```

- [ ] **Step 5: The views** — `backend/ledger/views_bookings.py`

```python
"""Support's booking screens (ledger Plan 1b): the paid services, stays and ticket purchases waiting for the verification
call, and recording the call (a positive one releases the money at once). Every endpoint answers 409
{"code": "ledger_off"} while LEDGER_ENABLED is off: only bookings paid with the ledger on are in the ledger."""
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import HasRolePermission

from . import escrow, sales, settings_store
from .models import BookingSale
from .verification import VerificationError

VERIFY = "orders.verify"
OFF = "The ledger isn't switched on yet."


def ledger_off():
    return Response({"detail": OFF, "code": "ledger_off"}, status=409)


class Pagination(PageNumberPagination):
    page_size = 20


class AwaitingBookingsView(APIView):
    """GET bookings/awaiting-verification/ — handed-over bookings waiting for Support's call, oldest paid first, 20 a
    page, with the customer's phone."""

    def get_permissions(self):
        return [HasRolePermission(VERIFY)]

    def get(self, request):
        if not escrow.enabled():
            return ledger_off()
        now = timezone.now()
        hours = settings_store.current("verification_overdue_hours", now)
        paginator = Pagination()
        page = paginator.paginate_queryset(sales.awaiting(now), request, view=self)
        return paginator.get_paginated_response([sales.queue_row(sale, now, hours) for sale in page])


class BookingVerificationView(APIView):
    """POST bookings/<id>/verification/ {outcome: matches|does_not_match|unreachable, note?, customer_confirmed_by_phone?}.
    A positive outcome releases the booking's money at once."""

    def get_permissions(self):
        return [HasRolePermission(VERIFY)]

    def post(self, request, pk):
        if not escrow.enabled():
            return ledger_off()
        sale = get_object_or_404(BookingSale, pk=pk)
        data = request.data if isinstance(request.data, dict) else {}
        try:
            sale = sales.record_verification(
                sale, request.user, data.get("outcome"), note=data.get("note"),
                customer_confirmed_by_phone=data.get("customer_confirmed_by_phone") is True,
            )
        except VerificationError as exc:
            return Response({"detail": exc.message}, status=exc.status_code)
        return Response({
            "sale": sale.pk, "outcome": sale.outcome, "dispute_id": sale.dispute_id, "released": sale.released_at is not None,
        })
```

- [ ] **Step 6: The URLs** — in `backend/ledger/urls.py` replace

```python
from . import views
```

with

```python
from . import views, views_bookings
```

and after `path("pickup/<int:pk>/collected/", views.PickupCollectedView.as_view(), name="ledger-pickup-collected"),` add

```python
    path("bookings/awaiting-verification/", views_bookings.AwaitingBookingsView.as_view(), name="ledger-bookings-awaiting"),
    path("bookings/<int:pk>/verification/", views_bookings.BookingVerificationView.as_view(), name="ledger-booking-verification"),
```

- [ ] **Step 7: Run the tests**

Run: `docker compose -p svc1 run --rm web python manage.py test ledger.tests.test_booking_verification_api ledger.tests.test_booking_release --noinput`
Expected: PASS (5 new tests; Task 5's unchanged).

- [ ] **Step 8: Commit**

```bash
git add backend/ledger/sales.py backend/ledger/views_bookings.py backend/ledger/urls.py backend/ledger/tests/test_booking_verification_api.py
git commit -m "feat(ledger): Support's booking queue and verification call over the API (1b)" --trailer "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>" --trailer "Claude-Session: https://claude.ai/code/session_01HDHNosHkqu4Wwocp7a2c8j"
```

---

### Task 7: The booking refund engine

**Files:**
- Modify: `backend/ledger/sales.py` (imports; append the refunds section)
- Create: `backend/ledger/tests/test_booking_refunds.py`

**Interfaces:**
- Consumes: `sales.lock`, `refund_key`, `tickets_of`, `handed_over_at` (Tasks 2, 5); `ledger.refunds.RefundError(message, status_code=400)`, `ledger.refunds.fee_share(snapshot, refunded_base)` (reads `base_pesewas` and `charged_pesewas`, which a `BookingSale` has); `BookingRefund` (Task 1).
- Produces (module `ledger.sales`):
  - `refund(sale, amount_pesewas=None, *, source, by=None, refund_processing=False, note="", now=None) -> BookingRefund | None` (raises `RefundError`, writing nothing, also when an explicit amount is asked of a sale with nothing left; returns None, with no amount, for a sale already refunded in full; `ValueError` for a bad source)
  - `_processing_share(sale, customer, whole) -> int`, `_cancel_if_not_handed_over(sale, by, note, now)`

- [ ] **Step 1: Write the failing test** — `backend/ledger/tests/test_booking_refunds.py`

```python
"""Refunds of booking sales into the customer's wallet (Plan 1b, Task 7; spec §2.2 steps 3-4, §5): before and after
release, in parts, with the processing charge only on fault, and the whole refund cancelling a booking not yet handed
over. Review Focus 3 (release after a refund) and 4 (refund arithmetic, and nothing left to refund)."""
from django.test import override_settings
from django.utils import timezone

from accounts.testing import make_staff
from bookings.availability import min_units_free
from bookings.models import Booking
from events.models import Ticket
from ledger import fees, posting, refunds, sales
from ledger.models import Account, BookingRefund, Journal
from ledger.verification import VerificationError
from services.models import ServiceRequest

from .booking_helpers import BookingBase


@override_settings(LEDGER_ENABLED=True)
class BookingRefundTests(BookingBase):
    def setUp(self):
        super().setUp()
        self.support = make_staff("support", "esi-r@example.com")

    def wallet(self):
        return self.balance(Account.CUSTOMER_WALLET, self.customer)

    def complete(self, sale):
        ServiceRequest.objects.filter(pk=sale.service_request_id).update(status=ServiceRequest.COMPLETED, completed_at=timezone.now())

    def released(self, sale):
        self.complete(sale)
        return sales.record_verification(sale, self.support, "matches", customer_confirmed_by_phone=True)

    def test_a_whole_refund_before_release_returns_everything_frees_the_cap_and_cancels_the_service(self):
        sale = self.paid_service("200.00")
        refund = sales.refund(sale, source="cancel", by=self.support)
        self.assertEqual((refund.whole, refund.released, refund.amount_pesewas, refund.fee_pesewas), (True, False, 20000, 500))
        self.assertEqual(refund.journal.key, f"booking-refund-{sale.pk}-cancel")
        self.assertEqual(self.wallet(), 20000)
        self.assertEqual(self.balance(Account.VENDOR_PENDING, self.owner), 0)
        sale.refresh_from_db()
        self.assertIsNotNone(sale.reversed_at)
        self.assertEqual(fees.charged_to_date(self.owner), 0)
        self.assertEqual(ServiceRequest.objects.get(pk=sale.service_request_id).status, ServiceRequest.CANCELLED)

    def test_review_focus_the_same_source_refunds_once_and_more_than_is_left_writes_nothing(self):
        sale = self.paid_service("200.00")
        first = sales.refund(sale, 5000, source="dispute-1")
        self.assertEqual(sales.refund(sale, 5000, source="dispute-1"), first)
        with self.assertRaisesMessage(refunds.RefundError, "Only GH₵ 150.00 of this booking can still be refunded."):
            sales.refund(sale, 15001, source="dispute-2")
        with self.assertRaises(refunds.RefundError):
            sales.refund(sale, 0, source="dispute-3")
        self.assertEqual(self.wallet(), 5000)
        self.assertEqual(BookingRefund.objects.count(), 1)
        self.assertEqual(Journal.objects.filter(kind="booking_refund").count(), 1)

    def test_review_focus_fee_given_back_in_parts_adds_up_to_the_fee_taken(self):
        sale = self.paid_service("100.00")                                                     # GH₵ 5.00 flat fee
        self.released(sale)
        self.assertEqual(self.balance(Account.VENDOR_AVAILABLE, self.owner), 9500)
        returned = []
        for source, amount in (("dispute-1", 3333), ("dispute-2", 3333), ("dispute-3", 3334)):
            sales.refund(sale, amount, source=source)
            sale.refresh_from_db()
            returned.append(sale.refunded_fee_pesewas)
        self.assertEqual(returned, [167, 333, 500])                                            # 1.67 + 1.66 + 1.67
        self.assertEqual(self.balance(Account.PLATFORM_FEE_INCOME), 0)
        self.assertEqual(self.balance(Account.VENDOR_AVAILABLE, self.owner), 0)
        self.assertEqual(self.wallet(), 10000)
        self.assertIsNotNone(sale.reversed_at)
        self.assertEqual(ServiceRequest.objects.get(pk=sale.service_request_id).status, ServiceRequest.COMPLETED)

    def test_a_refund_after_release_may_drive_available_below_zero(self):
        sale = self.paid_service("200.00")
        self.released(sale)                                                                    # Available GH₵ 195.00
        posting.post(key="test-1b-spent", kind="test_spend", lines=[
            posting.debit(posting.account_for(Account.VENDOR_AVAILABLE, self.owner), 19500),
            posting.credit(posting.account_for(Account.PROVIDER_CLEARING), 19500),
        ])
        refund = sales.refund(sale, source="dispute-9")
        self.assertTrue(refund.released)
        self.assertEqual(self.balance(Account.VENDOR_AVAILABLE, self.owner), -19500)
        self.assertEqual(self.balance(Account.PLATFORM_FEE_INCOME), 0)
        self.assertEqual(self.wallet(), 20000)

    def test_review_focus_a_refund_then_matches_pays_only_the_rest(self):
        sale = self.paid_service("200.00")                                                     # fee GH₵ 5.00
        sales.refund(sale, 5000, source="dispute-1")                                           # GH₵ 50.00 back first
        self.released(sale)
        self.assertEqual(self.balance(Account.VENDOR_PENDING, self.owner), 0)
        self.assertEqual(self.balance(Account.VENDOR_AVAILABLE, self.owner), 14625)            # 150.00 − (5.00 − 1.25)
        self.assertEqual(self.balance(Account.PLATFORM_FEE_INCOME), 375)

    def test_review_focus_a_wholly_refunded_booking_is_never_released_and_leaves_supports_list(self):
        sale = self.paid_service()
        self.complete(sale)
        sales.refund(sale, source="dispute-1")
        with self.assertRaisesMessage(VerificationError, "This booking was refunded in full."):
            sales.record_verification(sale, self.support, "matches", customer_confirmed_by_phone=True)
        self.assertFalse(sales.awaiting().filter(pk=sale.pk).exists())
        self.assertEqual(self.balance(Account.VENDOR_AVAILABLE, self.owner), 0)

    def test_a_whole_refund_of_a_stay_not_checked_in_cancels_it_and_frees_its_nights(self):
        sale = self.paid_stay(nights=2)
        booking = sale.booking
        self.assertEqual(min_units_free(self.lodge, booking.check_in, booking.check_out), 1)
        sales.refund(sale, source="cancel")
        booking.refresh_from_db()
        self.assertEqual(booking.status, Booking.CANCELLED)
        self.assertIsNotNone(booking.cancelled_at)
        self.assertEqual(min_units_free(self.lodge, booking.check_in, booking.check_out), 2)

    def test_a_whole_refund_of_tickets_marks_the_ones_not_scanned_refunded(self):
        sale = self.paid_tickets(quantity=2)
        scanned, other = Ticket.objects.filter(transaction=sale.session.transaction).order_by("pk")
        Ticket.objects.filter(pk=scanned.pk).update(delivered_at=timezone.now())
        sales.refund(sale, source="dispute-4", by=self.support, note="Event cancelled")
        scanned.refresh_from_db()
        other.refresh_from_db()
        self.assertIsNone(scanned.refunded_at)
        self.assertIsNotNone(other.refunded_at)
        self.assertEqual((other.refund_reason, other.refunded_by_staff), ("Event cancelled", self.support))

    @override_settings(SIMULATED_COLLECTION_CHARGE_BP=200)
    def test_the_processing_charge_comes_back_only_on_fault_and_in_proportion(self):
        sale = self.paid_service("200.00")                                                     # paid 204.00
        sales.refund(sale, 10000, source="dispute-1", refund_processing=True)                  # half: GH₵ 2.00 of 4.00
        self.assertEqual(self.wallet(), 10200)
        sales.refund(sale, source="dispute-2")                                                 # the rest, nobody's fault
        self.assertEqual(self.wallet(), 20200)
        self.assertEqual(self.balance(Account.PROVIDER_FEES), 200)

    def test_with_the_ledger_off_nothing_is_refunded(self):
        sale = self.paid_service()
        with override_settings(LEDGER_ENABLED=False):
            self.assertIsNone(sales.refund(sale, source="cancel"))
        self.assertEqual(self.wallet(), 0)

    def test_an_amount_asked_of_a_booking_refunded_in_full_is_refused(self):
        sale = self.paid_service()
        sales.refund(sale, source="cancel")
        with self.assertRaisesMessage(refunds.RefundError, "Nothing is left to refund on this booking."):
            sales.refund(sale, 100, source="dispute-9")
        self.assertEqual(self.wallet(), 20000)
```

- [ ] **Step 2: Run it to see it fail**

Run: `docker compose -p svc1 run --rm web python manage.py test ledger.tests.test_booking_refunds --noinput`
Expected: ERROR — `AttributeError: module 'ledger.sales' has no attribute 'refund'`.

- [ ] **Step 3: The imports** — in `backend/ledger/sales.py` replace

```python
from django.db.models import Exists, OuterRef, Q
from django.utils import timezone

from . import escrow, fees, posting, settings_store
from .models import Account, BookingSale, FeeRuleSet, FulfilmentCheck, Journal
from .money import from_pesewas, to_pesewas
from .verification import VerificationError
```

with

```python
from django.db.models import Exists, OuterRef, Q, Sum
from django.utils import timezone

from . import escrow, fees, posting, settings_store
from .models import Account, BookingRefund, BookingSale, FeeRuleSet, FulfilmentCheck, Journal
from .money import from_pesewas, to_pesewas
from .refunds import RefundError, fee_share
from .verification import VerificationError
```

- [ ] **Step 4: The refunds** — append to `backend/ledger/sales.py`

```python


# --- refunds, always to the customer's wallet (spec §2.2 steps 3-4, §5; Plan 1b S12) -------------------------------

def _processing_share(sale, customer, whole):
    """The payment-processing charge to give back with `customer` pesewas of the price: what is left of it on the refund
    that empties the sale, else its share of the price, half up, never more than is left (3a W2)."""
    paid = to_pesewas(sale.session.processing_fee or 0)
    done = BookingRefund.objects.filter(sale=sale).aggregate(total=Sum("processing_pesewas"))["total"] or 0
    remaining = paid - done
    if remaining <= 0:
        return 0
    if whole:
        return remaining
    return min(remaining, (2 * paid * customer + sale.base_pesewas) // (2 * sale.base_pesewas))


def _cancel_if_not_handed_over(sale, by, note, now):
    """A booking refunded in full that never reached the customer is cancelled in the refund's own transaction, so it
    can no longer be done, checked into or used (the customer would have the money and the booking): a service request
    still accepted or in progress, a stay not yet checked in (its nights are freed). For tickets, every ticket of the
    purchase not yet scanned is marked refunded. The caller holds lock(sale)."""
    from accounts.models import StaffUser
    from bookings.models import Booking
    from services.models import ServiceRequest

    if sale.kind == BookingSale.SERVICE:
        ServiceRequest.objects.filter(
            pk=sale.service_request_id, status__in=(ServiceRequest.ACCEPTED, ServiceRequest.IN_PROGRESS),
        ).update(status=ServiceRequest.CANCELLED)
    elif sale.kind == BookingSale.STAY:
        Booking.objects.filter(pk=sale.booking_id, status__in=(Booking.PENDING, Booking.CONFIRMED)).update(
            status=Booking.CANCELLED, cancelled_at=now,
        )
    else:
        tickets_of(sale).filter(delivered_at__isnull=True, refunded_at__isnull=True).update(
            refunded_at=now, refunded_by_staff=by if isinstance(by, StaffUser) else None,
            refund_reason=(note or "Refunded with the purchase")[:500],
        )


def refund(sale, amount_pesewas=None, *, source, by=None, refund_processing=False, note="", now=None):
    """Give `amount_pesewas` of a booking back to the customer's AshantiHub wallet (None: all that is left). Returns the
    BookingRefund (the one already made when this source refunded before), or None while the ledger is off or when
    nothing is left. Raises RefundError, writing nothing, for an amount it cannot give.

    Before release the money comes out of the business's Pending (the fee on it is simply never charged); after release
    it comes out of the business's Available, which may go negative (later sales recover it), and the platform fee
    taken on it comes back in proportion (Dr platform fee income, Cr Available). The fee share is cumulative and half up
    (refunds.fee_share), so parts add up exactly to the fee taken, and it frees the lifetime cap. The payment-processing
    charge comes back only when staff say AshantiHub or the business was at fault (`refund_processing`): AshantiHub
    bears it (Dr provider fees), its share on a partial refund. The refund that empties the sale ("whole") marks it
    reversed and cancels a booking not yet handed over (_cancel_if_not_handed_over)."""
    if not escrow.enabled():
        return None
    if not source or len(source) > 60 or len(refund_key(sale, source)) > 120:  # BookingRefund.source is 60, the key 120
        raise ValueError(f"Bad refund source {source!r}")
    if amount_pesewas is not None and (isinstance(amount_pesewas, bool) or not isinstance(amount_pesewas, int) or amount_pesewas <= 0):
        raise RefundError("The refund must be more than GH₵ 0.00.")
    now = now or timezone.now()
    with transaction.atomic():
        sale = lock(sale)
        existing = BookingRefund.objects.filter(sale=sale, source=source).first()
        if existing is not None:
            return existing
        room = sale.base_pesewas - sale.refunded_base_pesewas
        if room <= 0:
            if amount_pesewas is not None:
                raise RefundError("Nothing is left to refund on this booking.")
            return None
        customer = room if amount_pesewas is None else amount_pesewas
        if customer > room:
            raise RefundError(f"Only GH₵ {from_pesewas(room)} of this booking can still be refunded.")
        whole = customer == room
        processing = _processing_share(sale, customer, whole) if refund_processing else 0
        after = sale.refunded_base_pesewas + customer
        fee_after = fee_share(sale, after)
        fee = fee_after - sale.refunded_fee_pesewas
        released = sale.released_at is not None
        owner = sale.business_owner
        lines = []
        if released:
            available = posting.account_for(Account.VENDOR_AVAILABLE, owner)
            lines.append(posting.debit(available, customer))
            if fee:
                lines += [posting.debit(posting.account_for(Account.PLATFORM_FEE_INCOME), fee), posting.credit(available, fee)]
        else:
            lines.append(posting.debit(posting.account_for(Account.VENDOR_PENDING, owner), customer))
        if processing:
            lines.append(posting.debit(posting.account_for(Account.PROVIDER_FEES), processing))
        lines.append(posting.credit(posting.account_for(Account.CUSTOMER_WALLET, sale.customer), customer + processing))
        posting.lock(*(line.account for line in lines))
        journal = posting.post(
            key=refund_key(sale, source), kind="booking_refund", lines=lines,
            reference_type="ledger.bookingsale", reference_id=str(sale.pk), memo=f"Refund for {sale.label()} ({source})",
        )
        sale.refunded_base_pesewas, sale.refunded_fee_pesewas = after, fee_after
        if whole:
            sale.reversed_at = now
        sale.save(update_fields=["refunded_base_pesewas", "refunded_fee_pesewas", "reversed_at"])
        given = BookingRefund.objects.create(
            sale=sale, source=source, whole=whole, released=released, amount_pesewas=customer, fee_pesewas=fee,
            processing_pesewas=processing, journal=journal, created_by=by, note=(note or "")[:300],
        )
        if whole:
            _cancel_if_not_handed_over(sale, by, note, now)
        return given
```

- [ ] **Step 5: Run the tests**

Run: `docker compose -p svc1 run --rm web python manage.py test ledger.tests.test_booking_refunds ledger.tests.test_refunds --noinput`
Expected: PASS (11 new tests; the order refund tests unchanged).

- [ ] **Step 6: Commit**

```bash
git add backend/ledger/sales.py backend/ledger/tests/test_booking_refunds.py
git commit -m "feat(ledger): booking refunds to the wallet; the whole refund cancels a booking not yet handed over (1b)" --trailer "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>" --trailer "Claude-Session: https://claude.ai/code/session_01HDHNosHkqu4Wwocp7a2c8j"
```

---

### Task 8: Wire refunds — the customer's stay cancel, Support's cancel, ticket refunds, disputes; hand-over row locks

**Files:**
- Modify: `backend/ledger/sales.py` (append `CancelError`, `cancel`, `TicketRefundError`, `refund_ticket`), `backend/ledger/views_bookings.py` (`BookingCancelView`, imports), `backend/ledger/urls.py`, `backend/bookings/views.py` (`BookingCancelView`, `BookingCheckInView`, imports), `backend/services/views.py` (`ServiceRequestCompleteView`), `backend/events/views.py` (`EscrowRefundView.post`), `backend/disputes/views.py` (`DisputeResolveView.post`)
- Create: `backend/ledger/tests/test_booking_refund_wiring.py`

**Interfaces:**
- Consumes: `sales.refund`, `lock`, `handed_over_at` (Tasks 5, 7); `events.views._ledger_sale` (Task 5); `refunds.RefundError`.
- Produces:
  - `sales.CancelError(message, status_code=409)`, `sales.ALREADY_HANDED_OVER`, `sales.cancel(sale, staff, reason, now=None) -> BookingRefund`
  - `sales.TicketRefundError(message)`, `sales.refund_ticket(sale, ticket_id, *, by, reason, now=None) -> (Ticket, BookingRefund)`
  - `ledger.views_bookings.SUPPORT = "orders.support_update"`, `BookingCancelView`; URL `bookings/<int:pk>/cancel/` (`ledger-booking-cancel`)
  - customer stay cancel answers `wallet_refund` with the ledger on; the stay check-in and the service "complete" lock their row

- [ ] **Step 1: Write the failing test** — `backend/ledger/tests/test_booking_refund_wiring.py`

```python
"""Refunds wired into the booking flows (Plan 1b, Task 8): the customer's stay cancel, Support's cancel, the Accountant's
ticket refund and dispute resolution, and the hand-over steps locking their row. Review Focus 6 (a hand-over or a second
refund racing a refund), 9 (two taps on Pay) and 8 (switches off)."""
import threading
from datetime import timedelta
from decimal import Decimal

from django.core.cache import cache
from django.db import connection
from django.test import TransactionTestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, Customer
from accounts.testing import make_staff
from billing.models import Transaction
from bookings.models import Booking
from disputes.models import Dispute
from events.models import Event, EventTicketType, Ticket
from ledger import posting, sales
from ledger.models import Account, BookingSale
from listings.models import Category, Listing, Zone
from notifications.models import Notification
from payments.models import CheckoutSession
from payments.services import process_payment
from services.models import ServiceRequest

from .booking_helpers import BookingBase, fund


@override_settings(LEDGER_ENABLED=True)
class BookingRefundWiringTests(BookingBase):
    def setUp(self):
        super().setUp()
        self.support = make_staff("support", "esi-w@example.com")
        self.accountant = make_staff("accountant", "kofi-w@example.com")

    def wallet(self):
        return self.balance(Account.CUSTOMER_WALLET, self.customer)

    def support_cancel(self, sale, reason):
        return self.client.post(f"/api/ledger/bookings/{sale.pk}/cancel/", {"reason": reason}, format="json")

    def test_the_customer_cancels_a_paid_stay_and_gets_it_back_in_the_wallet(self):
        sale = self.paid_stay(nights=2)                                                        # GH₵ 300.00
        self.as_customer()
        response = self.client.post(f"/api/bookings/{sale.booking_id}/cancel/")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual((response.json()["status"], response.json()["wallet_refund"]), ("cancelled", "300.00"))
        self.assertEqual(self.wallet(), 30000)
        self.assertEqual(self.balance(Account.VENDOR_PENDING, self.owner), 0)
        sale.refresh_from_db()
        self.assertIsNotNone(sale.reversed_at)
        self.assertTrue(Notification.objects.filter(customer=self.customer, title="Your booking was cancelled").exists())

    def test_review_focus_a_cancelled_stay_cannot_be_checked_in(self):
        sale = self.paid_stay(nights=1)
        self.as_customer()
        self.client.post(f"/api/bookings/{sale.booking_id}/cancel/")
        self.as_owner()
        self.assertEqual(self.client.post(f"/api/bookings/{sale.booking_id}/check-in/").status_code, 400)
        self.assertEqual(Booking.objects.get(pk=sale.booking_id).status, Booking.CANCELLED)

    def test_review_focus_with_the_ledger_off_a_cancelled_stay_moves_no_money(self):
        with override_settings(LEDGER_ENABLED=False):
            booking_id = self.book_stay(nights=1).json()["id"]
            self.as_customer()
            response = self.client.post(f"/api/bookings/{booking_id}/cancel/")
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("wallet_refund", response.json())
        self.assertFalse(Account.objects.exists())

    def test_support_cancels_a_service_not_done_yet(self):
        sale = self.paid_service("200.00")
        self.as_staff(self.support)
        response = self.support_cancel(sale, "Customer moved away")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json(), {"sale": sale.pk, "refunded": "200.00"})
        self.assertEqual(self.wallet(), 20000)
        self.assertEqual(ServiceRequest.objects.get(pk=sale.service_request_id).status, ServiceRequest.CANCELLED)
        self.assertTrue(Notification.objects.filter(business_owner=self.owner, title="Booking cancelled").exists())
        self.assertTrue(Notification.objects.filter(customer=self.customer, title="Your booking was cancelled").exists())

    def test_support_cannot_cancel_what_was_handed_over(self):
        sale = self.paid_service()
        self.as_owner()
        self.assertEqual(self.client.post(f"/api/services/requests/{sale.service_request_id}/complete/").status_code, 200)
        self.as_staff(self.support)
        response = self.support_cancel(sale, "Changed mind")
        self.assertEqual(
            (response.status_code, response.json()["detail"]),
            (409, "The business has already marked this service done. Open a dispute instead."),
        )
        self.assertEqual(self.support_cancel(sale, "x").status_code, 400)
        self.assertEqual(self.wallet(), 0)

    def test_support_cancels_tickets_before_the_event(self):
        sale = self.paid_tickets(quantity=2)
        self.as_staff(self.support)
        self.assertEqual(self.support_cancel(sale, "Customer cannot come").status_code, 200)
        self.assertEqual(self.wallet(), 10000)
        notice = Notification.objects.get(customer=self.customer, title="Your booking was cancelled")
        self.assertIn("2 tickets for Highlife Night", notice.body)       # in words, never an internal id
        self.assertNotIn("#", notice.body)
        self.assertEqual(Ticket.objects.filter(transaction=sale.session.transaction, refunded_at__isnull=False).count(), 2)

    def test_only_support_may_cancel(self):
        sale = self.paid_service()
        self.as_staff(make_staff("pickup_desk", "desk-w@example.com"))
        self.assertEqual(self.support_cancel(sale, "Because").status_code, 403)

    def test_the_accountant_refunds_one_ticket_to_the_wallet(self):
        sale = self.paid_tickets(quantity=2)
        first, second = Ticket.objects.filter(transaction=sale.session.transaction).order_by("pk")
        self.as_staff(self.accountant, sudo=True)
        url = "/api/events/tickets/{}/escrow/refund/"
        response = self.client.post(url.format(first.pk), {"reason": "Cannot attend"}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["wallet_refund"], "50.00")
        self.assertEqual(self.wallet(), 5000)
        first.refresh_from_db()
        self.assertEqual((first.refund_reason, first.refunded_by_staff), ("Cannot attend", self.accountant))
        self.assertTrue(Transaction.objects.filter(status=Transaction.REFUNDED, amount=Decimal("-50.00")).exists())
        again = self.client.post(url.format(first.pk), {"reason": "Cannot attend"}, format="json")
        self.assertEqual((again.status_code, again.json()["detail"]), (400, "This ticket has already been refunded."))
        Ticket.objects.filter(pk=second.pk).update(delivered_at=timezone.now())
        self.assertEqual(self.client.post(url.format(second.pk), {"reason": "Cannot attend"}, format="json").status_code, 400)
        self.assertEqual(self.wallet(), 5000)

    def test_a_booking_dispute_resolved_with_a_refund_pays_the_wallet_once_and_the_rest_is_released(self):
        sale = self.paid_service("200.00")
        ServiceRequest.objects.filter(pk=sale.service_request_id).update(status=ServiceRequest.COMPLETED, completed_at=timezone.now())
        sale = sales.record_verification(sale, self.support, "does_not_match", note="Half done")
        self.as_staff(self.accountant, sudo=True)
        url = f"/api/disputes/{sale.dispute_id}/resolve/"
        self.assertEqual(self.client.post(url, {"refund_amount": "250.00"}, format="json").status_code, 400)
        self.assertEqual(Dispute.objects.get(pk=sale.dispute_id).status, Dispute.OPEN)            # the decision rolled back
        response = self.client.post(url, {"refund_amount": "80.00", "resolution_notes": "Half the job"}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["wallet_refund"], "80.00")
        self.assertEqual(self.wallet(), 8000)
        sales.record_verification(sale, self.support, "matches", customer_confirmed_by_phone=True)
        self.assertEqual(self.balance(Account.VENDOR_AVAILABLE, self.owner), 12000 - 300)        # fee left 5.00 − 2.00


@override_settings(LEDGER_ENABLED=True)
class TicketRefundRaceTests(TransactionTestCase):
    serialized_rollback = True

    def test_review_focus_two_ticket_refunds_from_one_purchase_at_once_both_land(self):
        customer = Customer.objects.create(full_name="Ama", phone="+233200770301", password_hash="x")
        owner = BusinessOwner.objects.create(full_name="Kwame", login_phone="+233207770301", password_hash="x")
        accountant = make_staff("accountant", "kofi-race@example.com")
        now = timezone.now()
        event = Event.objects.create(
            category=Category.objects.get(slug="festivals"), zone=Zone.objects.get(name="Manhyia"), submitted_by_business=owner,
            name="Highlife Night", description="D.", address="Kumasi", event_date=now + timedelta(days=10),
            visibility_days=14, status=Event.APPROVED, paid_at=now, expires_at=now + timedelta(days=14),
        )
        ticket_type = EventTicketType.objects.create(event=event, name="Regular", price=Decimal("50.00"))
        result = process_payment(
            kind=CheckoutSession.TICKET_PURCHASE, amount=Decimal("100.00"), purpose="Tickets", customer=customer,
            metadata={
                "event_id": event.pk, "ticket_type_id": ticket_type.pk, "quantity": 2, "customer_id": customer.pk,
                "delivery_method": ticket_type.delivery_method, "unit_price": "50.00", "ledger": True,
            },
        )
        sale = BookingSale.objects.get(session=result["session"])
        outcomes, barrier = [], threading.Barrier(2)

        def refund(ticket_id):
            try:
                barrier.wait()
                sales.refund_ticket(sale, ticket_id, by=accountant, reason="Cannot attend")
                outcomes.append("refunded")
            except Exception as exc:  # noqa: BLE001 - a failure must show in the assertion, not hang the test
                outcomes.append(type(exc).__name__)
            finally:
                connection.close()

        threads = [threading.Thread(target=refund, args=(pk,)) for pk in result["session"].metadata["ticket_ids"]]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=10)
            self.assertFalse(thread.is_alive(), "a racing refund hung")
        self.assertEqual(outcomes, ["refunded", "refunded"])
        self.assertEqual(posting.balance_of(Account.CUSTOMER_WALLET, customer), 10000)
        sale.refresh_from_db()
        self.assertIsNotNone(sale.reversed_at)
        self.assertEqual(Ticket.objects.filter(refunded_at__isnull=False).count(), 2)


@override_settings(LEDGER_ENABLED=True)
class SameMomentRaceTests(TransactionTestCase):
    """Two requests at the same moment on one booking: the row lock decides who goes first (Plan 1b S15)."""

    serialized_rollback = True

    def setUp(self):
        cache.clear()
        self.customer = Customer.objects.create(full_name="Ama", phone="+233200770401", password_hash="x")
        self.owner = BusinessOwner.objects.create(full_name="Kwame", login_phone="+233207770401", password_hash="x")
        self.zone = Zone.objects.get(name="Manhyia")

    def listing(self, name, price, category, **extra):
        return Listing.objects.create(
            business_owner=self.owner, category=category, zone=self.zone, name=name, description="D.",
            contact_phone=self.owner.login_phone, price_amount=Decimal(price), status=Listing.PUBLISHED, **extra,
        )

    def client_for(self, account, kind):
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(account, kind)}")
        return client

    def run_together(self, *calls):
        """Each call in its own thread, released at once; returns what each returned (an exception's name if it raised)."""
        results, barrier = [None] * len(calls), threading.Barrier(len(calls))

        def run(index, call):
            try:
                barrier.wait()
                results[index] = call()
            except Exception as exc:  # noqa: BLE001 - a failure must show in the assertion, not hang the test
                results[index] = type(exc).__name__
            finally:
                connection.close()

        threads = [threading.Thread(target=run, args=(index, call)) for index, call in enumerate(calls)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=15)
            self.assertFalse(thread.is_alive(), "a racing request hung")
        return results

    def test_review_focus_two_taps_on_pay_charge_a_service_request_once(self):
        service = self.listing("Home Cleaning", "200.00", Category.objects.create(slug="cleaning-1b-race", label="Cleaning", kind="service"))
        request = ServiceRequest.objects.create(
            customer=self.customer, listing=service, business_owner=self.owner, message="Clean my house.",
            agreed_price=Decimal("200.00"), status=ServiceRequest.ACCEPTED,
        )
        fund(self.customer, 50000, "fund-1b-race-pay")

        def tap():
            client = self.client_for(self.customer, "customer")
            return client.post(f"/api/services/requests/{request.pk}/pay/", {"payment_method": "wallet"}, format="json").status_code

        self.assertEqual(sorted(self.run_together(tap, tap)), [200, 400])
        self.assertEqual(CheckoutSession.objects.filter(status=CheckoutSession.SUCCESS).count(), 1)
        self.assertEqual(Transaction.objects.count(), 1)
        self.assertEqual(BookingSale.objects.filter(service_request=request).count(), 1)
        self.assertEqual(posting.balance_of(Account.CUSTOMER_WALLET, self.customer), 30000)         # debited once

    def test_review_focus_a_check_in_and_a_cancel_at_once_never_both_land(self):
        lodge = self.listing(
            "Ashanti Lodge", "150.00",
            Category.objects.create(slug="lodge-1b-race", label="Lodge", kind="service", is_accommodation=True), units_total=2,
        )
        check_in = timezone.localdate() + timedelta(days=1)
        paid = self.client_for(self.customer, "customer").post("/api/bookings/", {
            "listing": lodge.pk, "check_in": check_in.isoformat(), "check_out": (check_in + timedelta(days=2)).isoformat(), "units": 1,
        }, format="json")
        self.assertEqual(paid.status_code, 201, paid.content)
        booking_id = paid.json()["id"]

        def check_in_call():
            return self.client_for(self.owner, "business_owner").post(f"/api/bookings/{booking_id}/check-in/").status_code

        def cancel_call():
            return self.client_for(self.customer, "customer").post(f"/api/bookings/{booking_id}/cancel/").status_code

        self.assertEqual(sorted(self.run_together(check_in_call, cancel_call)), [200, 400])
        booking = Booking.objects.get(pk=booking_id)
        sale = BookingSale.objects.get(booking=booking)
        wallet = posting.balance_of(Account.CUSTOMER_WALLET, self.customer)
        if booking.status == Booking.CANCELLED:                      # the cancel went first: refunded, never checked in
            self.assertEqual((wallet, booking.checked_in_at), (30000, None))
            self.assertIsNotNone(sale.reversed_at)
        else:                                                         # the check-in went first: the cancel was refused
            self.assertEqual(booking.status, Booking.CHECKED_IN)
            self.assertEqual(wallet, 0)
            self.assertIsNone(sale.reversed_at)
```

- [ ] **Step 2: Run it to see it fail**

Run: `docker compose -p svc1 run --rm web python manage.py test ledger.tests.test_booking_refund_wiring --noinput`
Expected: FAIL / ERROR — `KeyError: 'wallet_refund'`, 404 for `/api/ledger/bookings/<id>/cancel/`, `AttributeError: module 'ledger.sales' has no attribute 'refund_ticket'`.

- [ ] **Step 3: Cancel and ticket refund** — append to `backend/ledger/sales.py`

```python


# --- cancels and ticket refunds (Plan 1b S9, S13) ----------------------------------------------------------------

class CancelError(Exception):
    def __init__(self, message, status_code=409):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


ALREADY_HANDED_OVER = {
    BookingSale.SERVICE: "The business has already marked this service done. Open a dispute instead.",
    BookingSale.STAY: "The guest has already checked in. Open a dispute instead.",
    BookingSale.TICKETS: "The event has taken place or a ticket was scanned. Open a dispute instead.",
}


def cancel(sale, staff, reason, now=None):
    """Support cancels a paid booking the customer has not received yet (S13): refunded whole to the customer's wallet
    (not the processing charge: the customer asked) and cancelled with it (_cancel_if_not_handed_over). Raises
    CancelError, changing nothing, once it was refunded in full, released, or handed over (that is a dispute). Returns
    the BookingRefund."""
    now = now or timezone.now()
    with transaction.atomic():
        sale = lock(sale)
        if sale.reversed_at is not None:
            raise CancelError("This booking was already refunded in full.")
        if sale.released_at is not None:
            raise CancelError("This booking's money was already released to the business. Open a dispute instead.")
        if handed_over_at(sale, now) is not None:
            raise CancelError(ALREADY_HANDED_OVER[sale.kind])
        return refund(sale, source="cancel", by=staff, note=reason, now=now)


class TicketRefundError(Exception):
    def __init__(self, message):
        super().__init__(message)
        self.message = message


def refund_ticket(sale, ticket_id, *, by, reason, now=None):
    """The Accountant's refund of one ticket of a purchase (S9): its price back to the buyer's AshantiHub wallet (source
    ticket-<id>), with today's REFUNDED billing.Transaction and the ticket marked refunded. Takes lock(sale) first (the
    purchase's tickets, then the sale), so it never deadlocks with a scan, the call or another ticket's refund. A scanned
    or already refunded ticket cannot be refunded (TicketRefundError); RefundError when the ledger cannot give it.
    Returns (ticket, BookingRefund)."""
    from billing.models import Transaction
    from django.utils.crypto import get_random_string
    from events.models import Ticket

    now = now or timezone.now()
    with transaction.atomic():
        sale = lock(sale)
        ticket = Ticket.objects.select_related("ticket_type__event", "purchased_by").get(
            pk=ticket_id, transaction_id=sale.session.transaction_id,
        )
        if ticket.delivered_at is not None:
            raise TicketRefundError("This ticket has already been delivered and cannot be refunded.")
        if ticket.refunded_at is not None:
            raise TicketRefundError("This ticket has already been refunded.")
        given = refund(sale, to_pesewas(ticket.price), source=f"ticket-{ticket.pk}", by=by, note=reason, now=now)
        Transaction.objects.create(
            customer=ticket.purchased_by, amount=-ticket.price, status=Transaction.REFUNDED,
            purpose=f"Refund for ticket {ticket.code} ('{ticket.ticket_type.event.name}')",
            reference=f"AH-REFUND-{ticket.id}-{get_random_string(8).upper()}",
        )
        Ticket.objects.filter(pk=ticket.pk).update(refunded_at=now, refunded_by_staff=by, refund_reason=reason)
        ticket.refresh_from_db()
        return ticket, given
```

- [ ] **Step 4: Support's cancel endpoint** — in `backend/ledger/views_bookings.py` (a) replace

```python
from accounts.permissions import HasRolePermission

from . import escrow, sales, settings_store
from .models import BookingSale
from .verification import VerificationError

VERIFY = "orders.verify"
```

with

```python
from accounts.permissions import HasRolePermission
from notifications.services import notify_business_owner, notify_customer

from . import escrow, sales, settings_store
from .models import BookingSale
from .money import from_pesewas
from .verification import VerificationError

VERIFY = "orders.verify"
SUPPORT = "orders.support_update"  # the permission of Support's order status screen, which cancels orders
```

(b) append

```python


class BookingCancelView(APIView):
    """POST bookings/<id>/cancel/ {reason} — Support cancels a paid booking the customer has not received yet: a service
    not done, a stay not checked in, tickets for an event not yet held with none scanned. It goes back to the customer's
    AshantiHub wallet in full (not the processing charge: the customer asked); the customer and the business are told.
    Once handed over it is a dispute, not a cancel (409)."""

    def get_permissions(self):
        return [HasRolePermission(SUPPORT)]

    def post(self, request, pk):
        if not escrow.enabled():
            return ledger_off()
        data = request.data if isinstance(request.data, dict) else {}
        reason = str(data.get("reason") or "").strip()[:300]
        if len(reason) < 3:
            return Response({"reason": "Say why it is cancelled (at least 3 characters)."}, status=400)
        sale = get_object_or_404(BookingSale.objects.select_related("customer", "business_owner"), pk=pk)
        try:
            refund = sales.cancel(sale, request.user, reason)
        except sales.CancelError as exc:
            return Response({"detail": exc.message}, status=exc.status_code)
        back = from_pesewas(refund.amount_pesewas)
        what = sales.description(sale)
        notify_customer(
            sale.customer, "booking", "Your booking was cancelled",
            body=f"AshantiHub Support cancelled your booking ({what}). GH₵ {back} went back to your AshantiHub wallet.",
            link="/my-account", icon="🧾",
        )
        notify_business_owner(
            sale.business_owner, "booking", "Booking cancelled",
            body=f"AshantiHub Support cancelled a booking ({what}) before it took place. The customer was refunded.",
            link="/business-dashboard", icon="⚠️",
        )
        return Response({"sale": sale.pk, "refunded": str(back)})
```

(c) in `backend/ledger/urls.py` after the `bookings/<int:pk>/verification/` path add

```python
    path("bookings/<int:pk>/cancel/", views_bookings.BookingCancelView.as_view(), name="ledger-booking-cancel"),
```

- [ ] **Step 5: The customer's stay cancel refunds; check-in locks the row** — in `backend/bookings/views.py` (a) replace

```python
from ledger import posting
from payments import booking_pay
```

with

```python
from ledger import escrow, posting, sales
from ledger.models import BookingSale
from ledger.money import from_pesewas
from payments import booking_pay
```

(b) replace the whole `BookingCancelView` class with

```python
class BookingCancelView(APIView):
    """POST /api/bookings/{id}/cancel/ — the customer cancels their own booking, freeing the dates. Only before
    check-in. With the ledger on, a paid booking goes back to the customer's AshantiHub wallet in full at once
    (ledger.sales.refund; the payment-processing charge stays with the provider: the customer asked), and the customer
    is told how much. The booking row is locked, so a cancel and a check-in never cross.
    """

    permission_classes = [IsAuthenticated, IsCustomer]

    def post(self, request, pk):
        refund = None
        with db_transaction.atomic():
            booking = generics.get_object_or_404(Booking.objects.select_for_update(), pk=pk, customer=request.user)
            if booking.status not in (Booking.PENDING, Booking.CONFIRMED):
                return Response({"detail": "This booking can no longer be cancelled."}, status=400)
            sale = BookingSale.objects.filter(booking=booking).first() if escrow.enabled() else None
            if sale is not None:
                refund = sales.refund(sale, source="cancel", note="Cancelled by the customer before check-in")
            booking.status = Booking.CANCELLED
            booking.cancelled_at = timezone.now()
            booking.save(update_fields=["status", "cancelled_at"])
        notify_business_owner(
            booking.business_owner, "booking", "Booking cancelled",
            body=f"A booking for “{booking.listing.name}” was cancelled.",
            link="/business-dashboard", icon="⚠️",
        )
        body = BookingSerializer(booking).data
        if refund is not None:
            back = from_pesewas(refund.amount_pesewas)
            notify_customer(
                booking.customer, "booking", "Your booking was cancelled",
                body=f"Your booking for “{booking.listing.name}” was cancelled. GH₵ {back} went back to your AshantiHub wallet.",
                link="/my-account", icon="🧾",
            )
            body = {**body, "wallet_refund": str(back)}
        return Response(body)
```

(c) replace the whole `post` method of `BookingCheckInView` with

```python
    def post(self, request, pk):
        with db_transaction.atomic():
            # Locked, so a check-in and a cancel (with its refund) never cross (ledger Plan 1b S15).
            booking = generics.get_object_or_404(Booking.objects.select_for_update(), pk=pk, business_owner=request.user)
            if booking.status != Booking.CONFIRMED:
                return Response({"detail": "Only a confirmed booking can be checked in."}, status=400)
            booking.status = Booking.CHECKED_IN
            booking.checked_in_at = timezone.now()
            booking.save(update_fields=["status", "checked_in_at"])
        return Response(BookingSerializer(booking).data)
```

- [ ] **Step 6: Marking a service done locks the row** — in `backend/services/views.py` replace the whole `post` method of `ServiceRequestCompleteView` with

```python
    def post(self, request, pk):
        with db_transaction.atomic():
            # Locked, so marking the job done and a cancel (with its refund) never cross (ledger Plan 1b S15).
            sr = generics.get_object_or_404(ServiceRequest.objects.select_for_update(), pk=pk, business_owner=request.user)
            if sr.status != ServiceRequest.IN_PROGRESS:
                return Response({"detail": "Only an in-progress job can be completed."}, status=400)
            sr.status = ServiceRequest.COMPLETED
            sr.completed_at = timezone.now()
            sr.save(update_fields=["status", "completed_at"])
        notify_customer(
            sr.customer, "service_request", "Service completed",
            body=f"“{sr.listing.name}” has been marked complete.",
            link="/my-account", icon="🎉",
        )
        return Response(ServiceRequestSerializer(sr).data)
```

- [ ] **Step 7: The Accountant's ticket refund pays the wallet** — in `backend/events/views.py`, in `EscrowRefundView.post`, replace

```python
        reason = _required_note(request.data.get("reason"))
        if reason is None:
            return Response({"reason": "Write a reason of at least 3 characters: every refund is explained."}, status=400)
        with db_transaction.atomic():
```

with

```python
        reason = _required_note(request.data.get("reason"))
        if reason is None:
            return Response({"reason": "Write a reason of at least 3 characters: every refund is explained."}, status=400)
        sale = _ledger_sale(generics.get_object_or_404(Ticket, pk=ticket_id))
        if sale is not None:
            # With the ledger on, the ticket's price goes back to the buyer's AshantiHub wallet (ledger Plan 1b S9).
            from ledger import sales
            from ledger.money import from_pesewas
            from ledger.refunds import RefundError

            try:
                ticket, given = sales.refund_ticket(sale, ticket_id, by=request.user, reason=reason)
            except sales.TicketRefundError as exc:
                return Response({"detail": exc.message}, status=400)
            except RefundError as exc:
                return Response({"detail": exc.message}, status=exc.status_code)
            back = from_pesewas(given.amount_pesewas)
            notify_customer(
                ticket.purchased_by, "booking", "Your ticket was refunded",
                body=f"GH₵ {back} for your ticket to “{ticket.ticket_type.event.name}” went back to your AshantiHub wallet.",
                link="/my-account", icon="🎟️",
            )
            return Response({**TicketEscrowLedgerSerializer(ticket).data, "wallet_refund": str(back)})
        with db_transaction.atomic():
```

- [ ] **Step 8: A booking's dispute refunds through the ledger** — in `backend/disputes/views.py`, in `DisputeResolveView.post`, replace

```python
                except refunds.RefundError as exc:
                    transaction.set_rollback(True)
                    return Response({"refund_amount": exc.message}, status=exc.status_code)
            # A full refund of the order also reverses the delivery fee its business covered through a
```

with

```python
                except refunds.RefundError as exc:
                    transaction.set_rollback(True)
                    return Response({"refund_amount": exc.message}, status=exc.status_code)
            elif dispute.refund_amount:
                # A booking's mismatch dispute (ledger Plan 1b S13): the same rule, through ledger.sales. Lock order:
                # this dispute row, then the booking (sales.lock), then its accounts.
                from ledger import refunds, sales
                from ledger.models import BookingSale
                from ledger.money import to_pesewas

                sale = BookingSale.objects.filter(dispute=dispute).first()
                if sale is not None:
                    try:
                        refund = sales.refund(
                            sale, to_pesewas(dispute.refund_amount), source=f"dispute-{dispute.pk}", by=request.user,
                            refund_processing=data.get("refund_processing", False), note=f"Dispute #{dispute.pk}",
                        )
                    except refunds.RefundError as exc:
                        transaction.set_rollback(True)
                        return Response({"refund_amount": exc.message}, status=exc.status_code)
            # A full refund of the order also reverses the delivery fee its business covered through a
```

- [ ] **Step 9: Run the tests**

Run: `docker compose -p svc1 run --rm web python manage.py test ledger.tests.test_booking_refund_wiring ledger.tests.test_refund_wiring services bookings events disputes --noinput`
Expected: PASS (12 new tests: 9 + 3 threaded; the existing suites unchanged).

- [ ] **Step 10: Commit**

```bash
git add backend/ledger/sales.py backend/ledger/views_bookings.py backend/ledger/urls.py backend/bookings/views.py backend/services/views.py backend/events/views.py backend/disputes/views.py backend/ledger/tests/test_booking_refund_wiring.py
git commit -m "feat(ledger): booking refunds wired into cancels, ticket refunds and disputes; hand-over steps lock their row (1b)" --trailer "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>" --trailer "Claude-Session: https://claude.ai/code/session_01HDHNosHkqu4Wwocp7a2c8j"
```

---

### Task 9: Documentation and full verification

**Files:**
- Modify: `backend/CLAUDE.md`, `CLAUDE.md`, `docs/IMPLEMENTATION_INSTRUCTIONS.md`, `docs/superpowers/specs/2026-10-15-wallet-fees-security-design.md`

**Interfaces:**
- Consumes: everything above. Produces: no code.

- [ ] **Step 1: Correctness cores** — in `backend/CLAUDE.md`, before the line that starts `- **Pickup Desk** is the `pickup_desk` staff role`, insert

```markdown
- **Services, stays and event tickets in the ledger (`ledger/sales.py`, Plan 1b).** Behind `LEDGER_ENABLED` like the
  rest. A paid service request, stay or ticket purchase is one `ledger.BookingSale` (its subject; its fee snapshot from
  the services table — stays count as services — or the events table; Support's call), recorded by the payment
  finalizers (`booking-pay-<session reference>`: Dr provider clearing or customer wallet, Cr vendor Pending). The
  lifetime cap counts sales and order snapshots together (`fees.charged_to_date`), read after the business's Pending is
  locked. Handed over = service marked done, guest checked in, a ticket scanned or the event's date passed; release only
  on Support's "matches" (`sales.record_verification`, `/api/ledger/bookings/`), with the 72-hour window counted from
  hand-over (provisional until the owner confirms it: spec gate (lvii)). Tickets for a customer-organised event stay outside the ledger (MoMo only). With the ledger on a ticket's
  escrow flag follows its sale: a scan no longer releases it, the manual release and hold answer `409 ledger_on`.
  Refunds go to the wallet through `sales.refund` (one `BookingRefund` per sale and source; the refund that empties a
  sale cancels a booking not yet handed over), wired into the customer's stay cancel, Support's booking cancel, the
  Accountant's ticket refund and dispute resolution. **Lock order:** the service request or stay row (tickets: the
  purchase's tickets in primary-key order), then the sale, then accounts in one sorted pass (`sales.lock(sale)`); the
  hand-over steps (service done, check-in, ticket scan) lock their own row. The three pay endpoints take
  `payment_method` and add "payment processing" on MoMo through `payments/booking_pay.py`; a service request's price
  must be above GH₵ 0.00 with at most two decimals.
```

- [ ] **Step 2: The spec** — in `docs/superpowers/specs/2026-10-15-wallet-fees-security-design.md` (a) replace

```markdown
Stage 3 plans: docs/superpowers/plans/2026-10-16-wallets-payments-3a.md (wallet payments and refunds) and docs/superpowers/plans/2026-10-16-withdrawals-3b.md (payout destinations, withdrawals, reconciliation).
```

with

```markdown
Stage 3 plans: docs/superpowers/plans/2026-10-16-wallets-payments-3a.md (wallet payments and refunds) and docs/superpowers/plans/2026-10-16-withdrawals-3b.md (payout destinations, withdrawals, reconciliation). Plan 1b (services, events and stays): docs/superpowers/plans/2026-10-16-ledger-services-events-stays-1b.md.
```

(b) replace

```markdown
**Scope:** One system, built in the order given in §11. Stage 1 (ledger), Stage 2 (OTP, backend) and Stage 3 (wallets,
payments, refunds, withdrawals and reconciliation, backend) are implemented behind switches that default off (branches
feature/ledger-stage1, feature/otp-security and feature/wallets; see section 13); later stages are specs only.
```

with

```markdown
**Scope:** One system, built in the order given in §11. Stage 1 (ledger) with Plan 1b (services, events and stays),
Stage 2 (OTP, backend) and Stage 3 (wallets, payments, refunds, withdrawals and reconciliation, backend) are implemented
behind switches that default off (branches feature/ledger-stage1, feature/ledger-services-1b, feature/otp-security and
feature/wallets; see section 13); later stages are specs only.
```

(c) replace

```markdown
check-in) is settled in Plan 1b. The ledger records only product orders until then.
```

with

```markdown
check-in) is settled in Plan 1b (§13 B4): the business marks the service done, the guest checks in, a ticket is scanned or
the event's date passes. Plan 1b counts the 72 hours from that hand-over, not from purchase as §4.1 does for products;
that reading is provisional until the owner confirms it (gate (lvii)).
```

- [ ] **Step 3: The stage index** — (a) in the root `CLAUDE.md` replace

```markdown
  OTP; Stage 1 (ledger), Stage 2 (OTP, backend) and Stage 3 (wallets, withdrawals, reconciliation, backend) are
```

with

```markdown
  OTP; Stage 1 (ledger, with Plan 1b: services, events and stays), Stage 2 (OTP, backend) and Stage 3 (wallets,
  withdrawals, reconciliation, backend) are
```

(b) in `docs/IMPLEMENTATION_INSTRUCTIONS.md` replace

```markdown
| **1b** | Ledger recording and release for services, events/tickets and bookings. |
```

with

```markdown
| **1b** | Ledger recording and release for services, events/tickets and bookings. Backend: docs/superpowers/plans/2026-10-16-ledger-services-events-stays-1b.md, built, behind `LEDGER_ENABLED` (default off); Support's booking queue screen is Plan 1F. |
```

- [ ] **Step 4: Commit**

```bash
git add backend/CLAUDE.md CLAUDE.md docs/IMPLEMENTATION_INSTRUCTIONS.md docs/superpowers/specs/2026-10-15-wallet-fees-security-design.md
git commit -m "docs(ledger): correctness core for booking sales; spec scope, hand-over and stage index (1b)" --trailer "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>" --trailer "Claude-Session: https://claude.ai/code/session_01HDHNosHkqu4Wwocp7a2c8j"
```

- [ ] **Step 5: Run the whole backend suite**

Run: `docker compose -p svc1 run --rm web python manage.py test --noinput`
Expected: PASS. If a failure is unrelated to this work, confirm it on the commit this branch started from (`60265fe`, "Merge pull request #150 from Kamankwah/feature/wallets"; `git switch --detach 60265fe`, re-run the failing label, `git switch feature/ledger-services-1b`) and report it rather than fixing it here.

- [ ] **Step 6: Migrations check**

Run: `docker compose -p svc1 run --rm web python manage.py makemigrations --check --dry-run`
Expected: `No changes detected`.

---

## What this plan deliberately does not do (later plans)

| Plan | Scope | Why separate |
|---|---|---|
| **1F** Frontend | Support's booking queue, the call and the cancel; `payment_method` and "payment processing" on the three pay screens; the accept screen's price error; the Accountant's ticket screen with the ledger on. | No screen ships in a backend plan; the API answers `ledger_off` / `insufficient_funds` / `wallet_not_accepted` for it to handle. |
| **4** Vendor side and SMS | The business's sales list (bookings as well as orders), daily summary, statement export, fee card, texts on paid sales and releases. | Spec §6; planned separately. Booking rows and booking texts there build on this plan's `BookingSale` and `ledger.sales`. |
| **7** Hubtel live | The booking finalizers on the webhook path with alerting (gate (lx)); a refund path for a booking paid twice (gate (lix)); a Hubtel payment for a stay cancelled while its checkout was open (gate (lxvi)). | Needs credentials and regulatory clearance (§11 step 7). |
| Owner decisions | A no-show rule, a cancellation policy, paid events organised by customers, whether a door scan releases without a call, the 72-hour window from hand-over, real services and events fee tiers. | Not decided; this plan's defaults are SA1–SA9 and gates (liv)–(lxvi). |

## Self-review

**Spec coverage:**

| Requirement | Task(s) |
|---|---|
| §4.2 services, events and stays released like products after a Support call; mismatch → 72-hour dispute; "handed over" settled here | 5 (hand-over, call, release, dispute), 6 (Support's API), S5–S8 |
| §1 row 11 / §3.1 one tier table per category, services and events seeded from products, stays count as services | 2 (`CATEGORY`; ledger 0004 tables) |
| §1 row 2 lifetime cap per vendor across categories | 1 (`charged_to_date`), 2 (shared cap, threaded race) |
| §1 row 3 fee base = item subtotal after discounts, excluding delivery | 2 (`price_of`, paid − processing; no coupons or delivery on bookings) |
| §3.2 step 4 snapshot at payment; release reads it | 1 (fields on the sale), 5 (`release` reads base/fee less refunds) |
| §2.2 step 1 pay into Pending (MoMo or wallet) | 2, 3, 4 |
| §2.2 step 2 release in the owner's order (fee first, then the vendor) | 5 (line order test) |
| §2.2 steps 3–4 refunds before and after release, fee back in proportion, Available may go negative | 7 |
| §5 refunds to the wallet; processing charge only on platform/vendor error | 7, 8 |
| §1 row 14 / 3a W2 "payment processing" on top of MoMo | 3 |
| §1 row 17 no timer releases money | 5 (release only from `record_verification`; manual ticket release refused) |
| §13 W7 lock order | 2 (Pending locked before the cap), 5 (`lock`), 8 (hand-over row locks, threaded ticket refunds) |
| §13 W12 / 3b E10 reconciliation expects what the ledger records | 3 |
| §11 behind a switch; nothing moves real money | every task (`LEDGER_ENABLED`; simulated provider) |
| Brief: cancellations | 8 (customer stay cancel, Support's cancel); service requests had none |
| Brief: no-show only if the spec decides | not built (S14, gate (lv)) |
| Brief: gate items for §13 | 1 (Step 7: (liv)–(lxvi)) |

**Placeholder scan:** every code step carries complete code and every test step complete test code; edits quote the exact text they replace (or name the whole method or class replaced); no "TBD", "similar to" or undefined names.

**Name consistency:** `BookingSale.SERVICE/STAY/TICKETS`, `label()`, `BookingRefund` (1, 2, 5–8); `sales.CATEGORY`, `SUBJECT`, `pay_key(session)`, `release_key(sale)`, `refund_key(sale, source)`, `price_of`, `record_payment(session, kind, subject, business_owner, *, at=None)` (2, 3, 5, 7); `sales.MATCHES/DOES_NOT_MATCH/UNREACHABLE`, `NOT_HANDED_OVER`, `tickets_of`, `handed_over_at`, `customer_confirmed`, `has_open_dispute`, `lock`, `release`, `record_verification(sale, staff, outcome, *, note, customer_confirmed_by_phone, now)` (5–8); `sales.description`, `awaiting(now=None)`, `queue_row(sale, now, hours)` (6, 7); `sales.refund(sale, amount_pesewas=None, *, source, by, refund_processing, note, now)`, `_processing_share`, `_cancel_if_not_handed_over` (7, 8); `sales.CancelError`, `ALREADY_HANDED_OVER`, `cancel(sale, staff, reason, now=None)`, `TicketRefundError`, `refund_ticket(sale, ticket_id, *, by, reason, now=None)` (8); `booking_pay.MOMO/WALLET`, `pay(*, kind, amount, purpose, customer, metadata, method, in_ledger)`, `with_terms(body, processing, *, method, in_ledger)`, `redirect_body(result, processing, *, in_ledger)` (3, 4), `WALLET_OFF`, `WALLET_TOO_LOW`, `Refused`, `method_from`, `too_low` (4); `payments.services.WALLET_KINDS` (4); `services.views.clean_price`, `PRICE_HINT` (3); `events.views._ledger_sale`, `LEDGER_RELEASES` (5, 8); `views_bookings.VERIFY`, `SUPPORT`, `ledger_off`, `Pagination`, `AwaitingBookingsView`, `BookingVerificationView`, `BookingCancelView` (6, 8); `wallets.reconciliation.BOOKING_KINDS` (3); test helpers `BookingBase`, `fund` and their methods (2–8). From earlier stages: `posting.lock/post/account_for/balance_of/InsufficientFunds/PostingError`, `fees.quote/rule_set_in_force/charged_to_date`, `settings_store.current`, `escrow.enabled/record_order_payment`, `refunds.RefundError/fee_share`, `verification.VerificationError`, `process_payment(..., processing_fee=, wallet=)`, `get_provider().collection_charge`.

**Test counts:** Task 1 — 4 (`test_booking_models`); Task 2 — 10 (`test_booking_payment`: 9 + 1 threaded); Task 3 — 10 (`test_booking_wiring`: 7 + 2 + 1); Task 4 — 7 (`test_booking_wallet`); Task 5 — 8 (`test_booking_release`); Task 6 — 5 (`test_booking_verification_api`); Task 7 — 11 (`test_booking_refunds`); Task 8 — 12 (`test_booking_refund_wiring`: 9 + 3 threaded). 67 new tests in all.

**Review Focus pins:** each of the eight lines above names the task and the test that pins it; all of those tests are written out in their tasks.
