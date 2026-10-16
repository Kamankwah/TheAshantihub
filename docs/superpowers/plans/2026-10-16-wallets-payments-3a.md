# Wallets, Payments and Refunds — Implementation Plan (Stage 3a)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A customer wallet on simulated rails — top-up by mobile money, paying for an order from the wallet or by MoMo with a "payment processing" line, refunds into the wallet that reverse the fee snapshots and free the lifetime cap — wired into Support's cancel, disputes, delivery-case refunds and uncollected store pickups, all behind `LEDGER_ENABLED` (default off).

**Architecture:** A provider interface (`payments/providers.py`) answers charges, account-name lookups, payouts and payout status, with a default simulated provider and a Hubtel provider that refuses what `hubtel_client.py` cannot do yet. Collections still go through `payments.services.process_payment` and `HubtelWebhookView` (unchanged Hubtel path), with a new `wallet_topup` kind and a `wallet` payment source. `ledger/refunds.py` gives money back per fee snapshot (one `OrderRefund` per order and source) and release is changed to pay only what is left. A new `wallets` app serves the holder's own money at `/api/wallet/`. Nothing changes while the ledger is off.

**Tech Stack:** Django 5.2, DRF, Postgres, Celery beat (eager under tests), the repo's `ledger`, `payments`, `approvals`, `activity`, `notifications`, `otp` apps.

**Spec:** `docs/superpowers/specs/2026-10-15-wallet-fees-security-design.md` — §1 rows 1, 6, 13, 14, 18; §2.2 steps 1, 3, 4; §2.3; §3.2 (the "payment processing" line); §4.3; §5; §6 (Pending/Available); §11 step 3; §13 "Stage 3 carry-forward" and "Before LEDGER_ENABLED is turned on". Deviations found while reconciling it with the code are in §0 below; Task 1 records them in the spec.

**Depends on:** Stage 1 (ledger) and Stage 2 (OTP, backend), both already on this branch (`feature/wallets` is stacked on `feature/otp-security`, stacked on `feature/ledger-stage1`). **Plan 3b** (`docs/superpowers/plans/2026-10-16-withdrawals-3b.md`: payout destinations, withdrawals, reconciliation) **depends on this plan** and must start only after its last task.

## 0. Decisions and reconciliation with the code

| # | Question | Decision | Why (grounded in the code) |
|---|---|---|---|
| D1 | Where the code lives | Provider interface in `payments/providers.py`; refunds in `ledger/refunds.py` with `ledger.OrderRefund`; the holder-facing API in a new app `wallets` mounted at **`/api/wallet/`**; staff reads under `/api/wallet/staff/`. | `/api/wallet/` is the holder's own money (customers and vendors), a different audience from `/api/ledger/`, which is staff governance (fees, settings) and the Support/Pickup queues. `hubtel_client.py` already lives in `payments`; refunds touch snapshots and journals only. |
| D2 | Spec §2.3 `collect, payout, status, handle_webhook` | `collect` **is** `payments.services.process_payment` and `handle_webhook` **is** `payments.views.HubtelWebhookView` — both unchanged (they already branch simulated/Hubtel and log raw, verify the signature, de-duplicate on the reference, re-check the amount and never move backwards). `PaymentProvider` adds `collection_charge`, `payout_charge`, `lookup_account_name`, `payout`, `status`, `payouts_available` (Plan 3b adds `statement`, `find`, `pending_payouts`). | `payments/hubtel_client.py` has only `create_checkout` and `verify_webhook_signature`: there is no Hubtel payout, status or name-lookup call to wrap, so `HubtelProvider` raises `NotConnected` for them (Plan 7). No Hubtel API is invented. |
| D3 | Collection charge (§1 row 14) | Paid by the customer **on top** of a MoMo payment or top-up ("payment processing"): `CheckoutSession.amount` = order total (or top-up) + charge, the charge kept on the new `CheckoutSession.processing_fee`. The provider keeps it; the ledger records only the net (provider clearing += order total / top-up). None on wallet payments. Refunded only on a platform/vendor error, and then AshantiHub bears it: Dr `provider_fees`, Cr `customer_wallet`. | Pass-through at cost (§1 row 14). The simulated provider's charge is `SIMULATED_COLLECTION_CHARGE_BP`, **default 0**: no real rate is known and the UI must not show a made-up number (CLAUDE.md "No fabricated data"). Hubtel's goes in `HUBTEL_COLLECTION_CHARGE_BP` (default 0) when contracted. |
| D4 | Paying from the wallet | New optional `payment_method` on `POST /api/orders/checkout/`: `momo` (default — exactly today's path) or `wallet`. `process_payment(..., wallet=True)` makes an immediate session with provider `"wallet"` whatever `PAYMENTS_PROVIDER` says; `_finalize_order_checkout` calls `escrow.record_order_payment(order, wallet=True)`, which debits `customer_wallet` instead of `provider_clearing`. A balance that is too low raises `posting.InsufficientFunds` from `post()`; the checkout catches it, rolls the whole order back and answers `409 insufficient_funds`. | The wallet is just another source in the existing payment journal (§2.2 step 1, "MoMo or wallet"). `post()` already refuses to drive a non-vendor balance below zero under the account lock, so it is the one authority for "enough money" (no separate pre-check race). |
| D5 | Account kinds | **None added.** `customer_wallet`, `provider_fees` (a refunded collection charge AshantiHub bears), `platform_promo_subsidy` (a coupon returned on the refund that empties an order), `platform_delivery_income` (a business's waived delivery fee) and `withdrawal_in_transit` (3b) already exist in `ledger.models.Account`. | Every movement in this plan fits the Stage 1 chart of accounts. |
| D6 | Refund granularity | Per fee snapshot (order, vendor, category) — the unit release pays and the cap counts — not per order line. `OrderFeeSnapshot` gains `refunded_base_pesewas` and `refunded_fee_pesewas` (cumulative); `reversed_at` is set when the whole base is refunded. A refund's scope is the whole order or a set of vendors (a skipped stop is one vendor's lines: `delivery.stops.stop_lines` filters by `business_owner_id`). An amount is spread over the snapshots in proportion to what is left of each (largest remainder); the fee share is cumulative and rounded half up. | §13 carry-forward: "Stage 3 must reverse them (`OrderFeeSnapshot.reversed_at`)" and "release must leave out disputed lines". Dispute and delivery-case refunds carry a GH₵ amount, not lines (`Dispute.refund_amount`, `delivery.refund_request` payload), so the amount must be allocated. |
| D7 | Coupons, delivery and partial refunds | A partial refund of R gives the customer R and takes R from the vendors' lines; it may not exceed the items left. The delivery fee comes back only with the whole order. The refund that empties the order returns the rest of the coupon to AshantiHub (Cr `platform_promo_subsidy`). The customer can never get back more than they paid (`total_amount`). | Coupons are AshantiHub-funded (§13 D1). Keeps every refund journal balanced (items + delivery = customer + subsidy) and never leaves part of a delivery fee held with no release and no refund path (release follows the item snapshots). |
| D8 | Waived delivery fee (§13 carry-forward) | `marketing.WaivedFeeCharge` (the business pays its free-delivery promo, `models_waivers.py`) is charged at release from the business's Available to platform delivery income (journal `order-waiver-<order>`); a whole refund after release gives it back (`order-waiver-return-<order>`). A refund never pays the waived fee to the customer (they never paid it). `WaivedFeeCharge.status` is not changed (no marketing migration). | "The waived delivery fee never reaches the ledger" — today the charge is only a row nothing settles. |
| D9 | Release | `release_verified` never releases an order that is no longer `paid` (cancelled), pays each snapshot's base and fee **less what was refunded**, and releases the delivery fee still held in the order's Delivery payable (its balance), not `order.delivery_fee`. | §13 carry-forward: a refund followed by Support's "matches" must never pay the vendor in full. |
| D10 | Disputes | `DisputeResolveView` (Accountant, `disputes.resolve_financial` + password, unchanged) posts the refund for `refund_amount` with source `dispute-<id>`; the delivery-case approval `delivery.refund_request` (Super Admin, unchanged) posts it on approve with the **same source**, so one dispute can never be refunded twice. A case opened by a skipped stop refunds that shop's lines only. The processing charge is refunded on a delivery case whose `fault` is `rider` or `business`, and on dispute resolve when the Accountant sends `refund_processing: true`. A refund the ledger cannot give rolls the decision back (400). | Permissions and doors stay as they are (brief). `delivery.config.refund_apply` today only records an activity line. |
| D11 | Cancel and uncollected pickup | Support's cancel of a **paid** order (`orders.support`) refunds it whole to the wallet (no processing refund: the customer asked). An hourly job refunds, cancels and restocks a paid store-pickup order not collected within `pickup_window_hours` of purchase — only orders whose payment the ledger recorded, never one with an open dispute. | §4.3 / §13: "Cancelled paid orders keep their snapshot counted against the cap and their money in Pending"; "refunding it to the customer's wallet is Stage 3". |
| D12 | Lock order | Order row → its fee snapshots → ledger accounts in primary-key order, all taken up front (`posting.lock`, which `post` also uses). `record_order_payment` now locks **every** account it will touch up front (Stage 1 locked only the vendors' Pending first, then the rest inside `post`), so a wallet payment and a refund to the same wallet cannot deadlock. | With Stage 1's order, a wallet payment would hold a vendor's Pending while asking for the wallet, and a refund to that wallet (sorted inside `post`) could hold the wallet while asking for that Pending: each would wait for the other. One sorted pass up front removes the cycle. |
| D13 | Ledger off | No wallet account is ever opened; every `/api/wallet/*` endpoint answers `409 {"code": "ledger_off"}`; `payment_method: "wallet"` answers the same; checkout, cancel, dispute and approval responses are byte-for-byte today's. With the ledger on, checkout's body gains `payment_method` and `payment_processing`. | Brief and §11: everything gated by `LEDGER_ENABLED`. |
| D14 | Reconciliation marker | With the ledger on, order and top-up sessions carry `metadata["ledger"] = true`. | Plan 3b's nightly reconciliation expects a journal only for payments the ledger was asked to record, so payments made while it was off are never false alarms. |

## Global Constraints

- Ledger amounts are **integer pesewas**; convert only through `ledger.money` (`to_pesewas`, `from_pesewas`). API amounts are GH₵ strings with two decimals (`"50.00"`).
- A balance changes only inside `ledger.posting.post`, with a deterministic key: `order-pay-<order>`, `order-release-<order>`, `order-refund-<order>-<source>`, `order-waiver-<order>`, `order-waiver-return-<order>`, `wallet-topup-<session reference>` (Plan 3b adds `withdrawal-hold-<ref>`, `withdrawal-paid-<ref>`, `withdrawal-reversed-<ref>`).
- **`LEDGER_ENABLED` (default off) gates everything.** With it off: no account is opened, `/api/wallet/*` answers `409 {"detail": "Wallets aren't switched on yet.", "code": "ledger_off"}`, and every existing response and test is unchanged.
- **Lock order:** order row → fee snapshots → ledger accounts in primary-key order, taken up front with `posting.lock(*accounts)` inside `transaction.atomic()`.
- Customers pay the provider's collection charge on top of MoMo payments and top-ups ("payment processing"); wallet payments carry none; it is not refunded except on a platform/vendor error (`refund_processing=True`), when AshantiHub bears it (Dr `provider_fees`).
- Refunds go **only** to the customer's AshantiHub wallet. Vendor Available may go negative after a late refund (recovered from later sales); no other holder balance may go below zero.
- Platform fees are never shown to customers; a customer sees items, delivery and "payment processing".
- Simulated rails only: `SIMULATED_COLLECTION_CHARGE_BP` 0, `SIMULATED_PAYOUT_CHARGE_PESEWAS` 0, `SIMULATED_PAYOUT_OUTCOME` `"succeed"`, `SIMULATED_ACCOUNT_NAMES` `{}`, `HUBTEL_COLLECTION_CHARGE_BP` 0 (all env-settable except the dict). Nothing here moves real money (§11 step 7 is Plan 7).
- Staff endpoints: `wallets.view` / `wallets.manage` (Accountant, Super Admin), seeded in `accounts/migrations/0054_seed_wallet_permissions.py`; staff writes are recorded by `StaffActivityMiddleware`; an `apply` or a view that records its own event calls `activity.services.record()` last.
- Tests: Django `TestCase`/`APIClient`; `@override_settings(LEDGER_ENABLED=True)`; staff tokens via `accounts.testing.staff_token(staff, sudo=...)`; customers and owners via `accounts.authentication.issue_token(account, "customer"|"business_owner")`; `cache.clear()` in `setUp` of classes that call the API; time travel by back-dating rows with `.update(...)`; a threaded `TransactionTestCase` with `serialized_rollback = True` only for the wallet double-spend.
- Commands, from the worktree root `/home/righteoushack/projects/TheAshantihub/.worktrees/wallets`: `docker compose -p wal1 run --rm web python manage.py test <label> --noinput`. Never run two docker commands at once.
- Migrations: today's leaves are `accounts/0053_seed_otp_recovery_permission`, `ledger/0006_fulfilmentcheck`, `payments/0005_stamp_legacy_paid_months` (check with `ls backend/accounts/migrations backend/ledger/migrations backend/payments/migrations`). This plan adds, in order: `ledger/0007_order_refunds.py` (generated, Task 2), `payments/0006_wallet_payments.py` (generated, Task 3), `accounts/0054_seed_wallet_permissions.py` (hand-written, Task 9). `wallets` has no models in this plan.
- Style: module docstrings, no type annotations, tests in `<app>/tests/`, plain words in user-facing messages.

## Review Focus

1. **Double spend of a wallet balance** — two wallet payments at once from one GH₵ 150 wallet for GH₵ 100 each: exactly one is paid, the other is refused and leaves no journal or snapshot. Pinned in Task 3 (`WalletDoubleSpendTests.test_review_focus_two_wallet_payments_at_once_never_spend_one_balance_twice`).
2. **A wallet that covers only part of an order** — refused whole: no order, session, snapshot or stock reservation survives, the cart is kept, the wallet untouched. Pinned in Task 3 (`test_review_focus_a_wallet_that_covers_only_part_pays_nothing_and_changes_nothing`).
3. **A line refunded twice, or more than was paid** — the same source refunds once; amounts are capped by what the customer has left and by each snapshot's base; a scoped refund never takes the delivery fee. Pinned in Task 5 (`test_review_focus_the_same_source_refunds_once`, `test_review_focus_more_than_is_left_is_refused_and_writes_nothing`, `test_review_focus_a_scoped_refund_takes_only_that_vendors_lines`).
4. **Partial-refund fee rounding** — fee shares are cumulative and half up: three refunds of a GH₵ 100.00 line return 1.67 + 1.66 + 1.67 = GH₵ 5.00 exactly, never more than was taken. Pinned in Task 5 (`test_review_focus_fee_returned_in_parts_adds_up_to_the_fee_taken`).
5. **Release after refund** — a refund then Support's "matches" pays the vendor only what is left; a cancelled order is never released; a fully refunded order leaves Support's list. Pinned in Task 6 (`test_review_focus_a_refund_then_matches_pays_only_the_rest`, `test_review_focus_a_cancelled_order_is_never_released`) and Task 7 (`test_review_focus_mismatch_money_back_then_matches_pays_the_rest`).
6. **A duplicate provider callback for a top-up** — Hubtel's retry of the same success webhook credits the wallet once. Pinned in Task 4 (`test_review_focus_the_wallet_is_credited_once_when_hubtel_confirms`).
7. **Switches-off regression** — with the ledger off, checkout, cancel, dispute resolve and the delivery refund approval answer exactly as today and open no account. Pinned in Task 3 (`test_review_focus_with_the_ledger_off_checkout_is_exactly_as_before`), Task 4 (`test_review_focus_every_wallet_endpoint_says_ledger_off_and_opens_nothing`), Task 7 (`LedgerOffWiringTests`).
8. **The pickup desk racing the expiry job** — an order collected before the job runs is never refunded; one with an open dispute is left for a person. Pinned in Task 8 (`test_review_focus_a_collected_order_is_never_refunded`).

## Assumptions made (decided here, cheap to change — for the owner to confirm)

- **A1** Simulated collection and withdrawal charges are 0 unless set (no real rate is known); Hubtel's contracted collection rate goes in `HUBTEL_COLLECTION_CHARGE_BP` (default 0) in Plan 7.
- **A2** A top-up uses the provider's hosted checkout, like an order payment (the MoMo number is typed there); there is no stored "attached" MoMo number for direct debit yet (Plan 7).
- **A3** No wallet balance cap and no top-up limit (the spec sets none); add one when the regulatory route (§12) is known.
- **A4** A wallet payment must cover the whole order; no split wallet + MoMo payment.
- **A5** A partial refund comes out of the item lines and may not exceed them; the delivery fee comes back only with the whole order; the coupon goes back to AshantiHub only on the refund that empties the order; the total refunded never exceeds what the customer paid.
- **A6** The processing charge is refunded only when staff say AshantiHub or the vendor was at fault: `refund_processing: true` on dispute resolve, and delivery cases decided with fault `rider` or `business`; never on a customer cancel or an uncollected pickup.
- **A7** Support's cancel of a paid order refunds it whole to the wallet at once (no approval step).
- **A8** An uncollected store pickup is refunded, cancelled and restocked by an hourly job once `pickup_window_hours` (24) have passed since purchase, unless a dispute is open; only orders paid while the ledger was on.
- **A9** A business's free-delivery promo cost is taken from its Available at release (may go negative) and given back if the order is later refunded whole.
- **A10** A dispute's refund reaches the wallet when the Accountant resolves it (password again); a delivery-case refund when the Super Admin approves it. They share the source `dispute-<id>`, so never twice.
- **A11** `wallets.view` (balances, withdrawals, reconciliation) and `wallets.manage` (fail a stuck withdrawal, Plan 3b) go to the Accountant and Super Admin.

## File Structure

Create:
- `backend/payments/providers.py` (the provider interface, simulated and Hubtel providers), `backend/payments/tests/test_providers.py`
- `backend/payments/migrations/0006_wallet_payments.py` (generated)
- `backend/ledger/refunds.py` (refunds), `backend/ledger/tasks.py` (hourly uncollected-pickup job)
- `backend/ledger/migrations/0007_order_refunds.py` (generated)
- `backend/ledger/tests/test_groundwork.py`, `test_wallet_payment.py`, `test_refunds.py`, `test_release_after_refund.py`, `test_refund_wiring.py`, `test_pickup_expiry.py`
- `backend/wallets/__init__.py`, `apps.py`, `services.py` (top-up posting, balances, statement lines), `views.py` (holder API), `views_staff.py` (staff reads), `urls.py`
- `backend/wallets/tests/__init__.py`, `test_wallet_api.py`, `test_staff_wallets.py`
- `backend/accounts/migrations/0054_seed_wallet_permissions.py`

Modify:
- `backend/ashantihub/settings.py` (provider knobs, `wallets` app, beat entry), `backend/ashantihub/urls.py`
- `backend/ledger/models.py` (`OrderFeeSnapshot` refund fields, `OrderRefund`), `posting.py` (`lock`, `balance_of`, `InsufficientFunds`, `allow_negative`), `fees.py` (`charged_to_date`), `escrow.py` (wallet source, up-front locks, release after refunds, waiver), `verification.py` (Support's list, uncollected pickups)
- `backend/payments/models.py` (`WALLET_TOPUP`, `WALLET`, `processing_fee`), `backend/payments/services.py` (`process_payment`, finalizers)
- `backend/orders/views.py` (checkout `payment_method`, processing), `backend/orders/support.py` (cancel refunds, `return_stock`)
- `backend/disputes/views.py`, `backend/disputes/serializers.py` (resolve refunds), `backend/delivery/config.py` (refund approval)
- `backend/accounts/tests/test_roles_seed.py`, `backend/people/roles.py`, `docs/STAFF_ROLES.md`
- `backend/CLAUDE.md`, `docs/superpowers/specs/2026-10-15-wallet-fees-security-design.md`, `docs/IMPLEMENTATION_INSTRUCTIONS.md`

API added or changed:

| Method + path | Who | Body → answer |
|---|---|---|
| `POST /api/orders/checkout/` | customer | + optional `payment_method` (`momo` default, `wallet`). Ledger on: body + `payment_method`, `payment_processing`. `409 insufficient_funds` (wallet too low, nothing kept), `409 ledger_off` (`wallet` while off), `400 payment_method` (unknown). |
| `GET /api/wallet/` | customer, owner | → `{kind: "customer", balance}` or `{kind: "vendor", pending, available}` |
| `GET /api/wallet/transactions/` | customer, owner | → paginated `{id, at, account, kind, label, direction, amount, order, reference}` |
| `GET /api/wallet/processing/?amount=` | customer | → `{amount, payment_processing, you_pay, provider}` |
| `POST /api/wallet/top-up/` | customer | `{amount}` → 201 `{mode: "immediate", reference, amount, payment_processing, you_pay, kind, balance}` or 200 `{mode: "redirect", checkout_url, reference, ...}` |
| `GET /api/wallet/staff/wallets/?kind=customer\|vendor` | `wallets.view` | → paginated balances (names, no account numbers) |
| `POST /api/orders/<id>/support-status/` (cancel) | unchanged | ledger on: a paid order goes back to the wallet; the customer's notice says how much |
| `POST /api/disputes/<id>/resolve/` | unchanged | + optional `refund_processing`; ledger on: posts the refund, body + `wallet_refund`; `400 {"refund_amount"}` when it can't (nothing saved) |
| approving `delivery.refund_request` | unchanged | ledger on: posts the refund; a refund it can't give leaves the request pending (400) |

---
### Task 1: The provider interface, its settings, and the spec addendum

**Files:**
- Create: `backend/payments/providers.py`, `backend/payments/tests/test_providers.py`
- Modify: `backend/ashantihub/settings.py` (after the `PAYMENTS_PROVIDER = ...` line), `docs/superpowers/specs/2026-10-15-wallet-fees-security-design.md` (append)

**Interfaces:**
- Consumes: `settings.PAYMENTS_PROVIDER` (`"simulated"` or `"hubtel"`, derived from `HUBTEL_CLIENT_ID`).
- Produces (module `payments.providers`):
  - constants `MOMO = "momo"`, `BANK = "bank"`, `RAILS`, `SUCCEEDED = "succeeded"`, `FAILED = "failed"`, `PROCESSING = "processing"`
  - exceptions `ProviderError(Exception)`, `NotConnected(ProviderError)`
  - `PayoutResult(status, provider_reference="", message="")` (frozen dataclass)
  - `basis_points(amount_pesewas, bp) -> int` (half up)
  - class `PaymentProvider` with `name`, `collection_charge(amount_pesewas) -> int`, `payouts_available() -> bool`, `payout_charge(amount_pesewas, rail) -> int`, `lookup_account_name(rail, institution, account_number, *, holder_name="") -> str | None`, `payout(*, reference, rail, institution, account_number, amount_pesewas) -> PayoutResult`, `status(reference) -> PayoutResult`
  - `SimulatedProvider` (`name = "simulated"`), `HubtelProvider` (`name = "hubtel"`), `get_provider(name=None) -> PaymentProvider`
  - settings `SIMULATED_COLLECTION_CHARGE_BP` (int, 0), `SIMULATED_PAYOUT_CHARGE_PESEWAS` (int, 0), `SIMULATED_PAYOUT_OUTCOME` (`"succeed"`), `SIMULATED_ACCOUNT_NAMES` (`{}`), `HUBTEL_COLLECTION_CHARGE_BP` (int, 0)

- [ ] **Step 1: Write the failing test** — `backend/payments/tests/test_providers.py`

```python
"""The payment provider interface (spec §2.3): simulated by default, steered by settings; Hubtel's unknowns refuse
instead of guessing (payments/hubtel_client.py has no payout, status or name-lookup call)."""
from django.test import SimpleTestCase, override_settings

from payments import providers

NUMBER = "+233241234567"


class SelectionTests(SimpleTestCase):
    def test_the_default_is_the_simulated_provider(self):
        self.assertEqual(providers.get_provider().name, "simulated")

    @override_settings(PAYMENTS_PROVIDER="hubtel")
    def test_payments_provider_picks_hubtel(self):
        self.assertEqual(providers.get_provider().name, "hubtel")

    def test_a_name_overrides_the_setting_and_an_unknown_one_raises(self):
        self.assertEqual(providers.get_provider("hubtel").name, "hubtel")
        with self.assertRaises(providers.ProviderError):
            providers.get_provider("stripe")


class SimulatedProviderTests(SimpleTestCase):
    def setUp(self):
        self.provider = providers.SimulatedProvider()

    def test_charges_are_zero_unless_set(self):
        self.assertEqual(self.provider.collection_charge(12000), 0)
        self.assertEqual(self.provider.payout_charge(12000, providers.MOMO), 0)

    @override_settings(SIMULATED_COLLECTION_CHARGE_BP=195, SIMULATED_PAYOUT_CHARGE_PESEWAS=150)
    def test_charges_follow_the_settings_and_round_half_up(self):
        self.assertEqual(self.provider.collection_charge(10000), 195)      # 1.95% of GH₵ 100.00
        self.assertEqual(self.provider.collection_charge(1000), 20)        # 19.5 pesewas rounds up
        self.assertEqual(self.provider.payout_charge(50000, providers.BANK), 150)

    def test_payouts_end_as_the_setting_says_and_anything_else_waits(self):
        cases = (("succeed", providers.SUCCEEDED), ("fail", providers.FAILED), ("pending", providers.PROCESSING), ("typo", providers.PROCESSING))
        for setting, expected in cases:
            with self.subTest(setting=setting), override_settings(SIMULATED_PAYOUT_OUTCOME=setting):
                result = self.provider.payout(reference="AH-WD-1", rail=providers.MOMO, institution="MTN", account_number=NUMBER, amount_pesewas=5000)
                self.assertEqual((result.status, result.provider_reference), (expected, "SIM-AH-WD-1"))
                self.assertEqual(self.provider.status("AH-WD-1").status, expected)
        self.assertTrue(self.provider.payouts_available())

    def test_the_name_lookup_answers_the_holder_unless_the_number_is_listed(self):
        self.assertEqual(self.provider.lookup_account_name(providers.MOMO, "MTN", NUMBER, holder_name="Ama Owusu"), "Ama Owusu")
        with override_settings(SIMULATED_ACCOUNT_NAMES={NUMBER: "KOFI BOATENG"}):
            self.assertEqual(self.provider.lookup_account_name(providers.MOMO, "MTN", NUMBER, holder_name="Ama Owusu"), "KOFI BOATENG")
        self.assertIsNone(self.provider.lookup_account_name(providers.MOMO, "MTN", NUMBER))


class HubtelProviderTests(SimpleTestCase):
    def setUp(self):
        self.provider = providers.HubtelProvider()

    def test_only_the_collection_charge_is_known(self):
        self.assertEqual(self.provider.collection_charge(10000), 0)
        with override_settings(HUBTEL_COLLECTION_CHARGE_BP=100):
            self.assertEqual(self.provider.collection_charge(10000), 100)
        self.assertFalse(self.provider.payouts_available())

    def test_payouts_status_charges_and_name_lookups_are_not_connected(self):
        calls = (
            lambda: self.provider.payout(reference="AH-WD-1", rail=providers.MOMO, institution="MTN", account_number=NUMBER, amount_pesewas=5000),
            lambda: self.provider.status("AH-WD-1"),
            lambda: self.provider.lookup_account_name(providers.MOMO, "MTN", NUMBER, holder_name="Ama Owusu"),
            lambda: self.provider.payout_charge(5000, providers.MOMO),
        )
        for call in calls:
            with self.assertRaises(providers.NotConnected):
                call()
```

- [ ] **Step 2: Run it to see it fail**

Run: `docker compose -p wal1 run --rm web python manage.py test payments.tests.test_providers --noinput`
Expected: ERROR — `ImportError: cannot import name 'providers' from 'payments'`.

- [ ] **Step 3: Write the provider module** — `backend/payments/providers.py`

```python
"""The payment provider behind AshantiHub's money movements (spec §2.3).

Hubtel (or a bank) holds the money; AshantiHub keeps the ledger and instructs the provider. Of the spec's four
operations, two already exist and are not touched here:
- collect is `payments.services.process_payment` (it branches simulated/Hubtel and is the only way a customer pays,
  for an order or a wallet top-up);
- handle_webhook is `payments.views.HubtelWebhookView` (logged raw first, signature-verified, idempotent on the
  reference, amount-verified, monotonic).
This module adds the rest: the collection and payout charges, the account-name lookup a payout destination needs,
payout and payout status (Plan 3b adds the daily statement used by the reconciliation).

`get_provider()` follows `settings.PAYMENTS_PROVIDER`. The simulated provider moves no money and asks no network:
everything it answers comes from settings, so tests and staging can steer it. The Hubtel provider knows only its
collection charge (`HUBTEL_COLLECTION_CHARGE_BP`); `payments/hubtel_client.py` has no payout, status or name-lookup
call, so those raise NotConnected until Plan 7 builds them against Hubtel's real API."""
from dataclasses import dataclass

from django.conf import settings

MOMO, BANK = "momo", "bank"
RAILS = (MOMO, BANK)
SUCCEEDED, FAILED, PROCESSING = "succeeded", "failed", "processing"
_OUTCOMES = {"succeed": SUCCEEDED, "fail": FAILED, "pending": PROCESSING}


class ProviderError(Exception):
    pass


class NotConnected(ProviderError):
    """The provider cannot do this yet. Callers refuse the action cleanly; it is never a failed money movement."""


@dataclass(frozen=True)
class PayoutResult:
    status: str  # SUCCEEDED, FAILED or PROCESSING
    provider_reference: str = ""
    message: str = ""


def basis_points(amount_pesewas, bp):
    """`bp` basis points of an amount in pesewas, half up (100 bp = 1%)."""
    return (int(amount_pesewas) * int(bp) + 5000) // 10000


class PaymentProvider:
    name = ""

    def collection_charge(self, amount_pesewas):
        """What the customer pays on top of `amount_pesewas` for a MoMo payment or a top-up ("payment processing")."""
        raise NotImplementedError

    def payouts_available(self):
        return False

    def payout_charge(self, amount_pesewas, rail):
        """What the provider keeps from a withdrawal of `amount_pesewas` to a `rail` destination (the holder bears it)."""
        raise NotConnected(f"{self.name} cannot price payouts yet")

    def lookup_account_name(self, rail, institution, account_number, *, holder_name=""):
        """The name the network or bank holds for this account, or None when it has none. `holder_name` is used only by
        the simulated provider, which has no network to ask."""
        raise NotConnected(f"{self.name} cannot look up account names yet")

    def payout(self, *, reference, rail, institution, account_number, amount_pesewas):
        """Instruct a payout of `amount_pesewas` (what reaches the destination) under our `reference`."""
        raise NotConnected(f"{self.name} cannot make payouts yet")

    def status(self, reference):
        raise NotConnected(f"{self.name} cannot report payout status yet")


class SimulatedProvider(PaymentProvider):
    """No money moves and no network is asked. Charges are SIMULATED_COLLECTION_CHARGE_BP and
    SIMULATED_PAYOUT_CHARGE_PESEWAS (both 0 unless set: no real rate is known). Payouts end as
    SIMULATED_PAYOUT_OUTCOME says (succeed, fail or pending; anything else waits, so a typo never pays). The name lookup
    answers SIMULATED_ACCOUNT_NAMES[account_number] when listed, else the holder's own name."""

    name = "simulated"

    def collection_charge(self, amount_pesewas):
        return basis_points(amount_pesewas, settings.SIMULATED_COLLECTION_CHARGE_BP)

    def payouts_available(self):
        return True

    def payout_charge(self, amount_pesewas, rail):
        return int(settings.SIMULATED_PAYOUT_CHARGE_PESEWAS)

    def lookup_account_name(self, rail, institution, account_number, *, holder_name=""):
        return settings.SIMULATED_ACCOUNT_NAMES.get(account_number, holder_name) or None

    def payout(self, *, reference, rail, institution, account_number, amount_pesewas):
        return self.status(reference)

    def status(self, reference):
        outcome = _OUTCOMES.get(settings.SIMULATED_PAYOUT_OUTCOME, PROCESSING)
        return PayoutResult(outcome, provider_reference=f"SIM-{reference}")


class HubtelProvider(PaymentProvider):
    """Collections are the existing Hubtel Checkout path (process_payment + HubtelWebhookView). Only the collection
    charge is known here (HUBTEL_COLLECTION_CHARGE_BP, 0 until the contracted rate is set); payouts, their status, their
    charge and account-name lookups are Plan 7."""

    name = "hubtel"

    def collection_charge(self, amount_pesewas):
        return basis_points(amount_pesewas, settings.HUBTEL_COLLECTION_CHARGE_BP)


_PROVIDERS = {SimulatedProvider.name: SimulatedProvider, HubtelProvider.name: HubtelProvider}


def get_provider(name=None):
    """The provider called `name` (a withdrawal remembers whose it was), else the one PAYMENTS_PROVIDER names."""
    key = name or settings.PAYMENTS_PROVIDER
    try:
        return _PROVIDERS[key]()
    except KeyError:
        raise ProviderError(f"Unknown payment provider {key!r}") from None
```

- [ ] **Step 4: Settings** — in `backend/ashantihub/settings.py` replace

```python
PAYMENTS_PROVIDER = "hubtel" if HUBTEL_CLIENT_ID else "simulated"
```

with

```python
PAYMENTS_PROVIDER = "hubtel" if HUBTEL_CLIENT_ID else "simulated"

# Payment provider knobs (payments/providers.py, wallets plan 3a). The simulated provider moves no money. Its charges
# default to 0 because no real rate is known (the UI must not show a made-up number); staging or tests may set them
# to see the "payment processing" and withdrawal-charge lines. SIMULATED_PAYOUT_OUTCOME is succeed (default), fail or
# pending. SIMULATED_ACCOUNT_NAMES is for tests only: {account number: the name the simulated network answers}.
# HUBTEL_COLLECTION_CHARGE_BP is Hubtel's contracted collection rate in basis points (Plan 7); 0 until it is known.
SIMULATED_COLLECTION_CHARGE_BP = env.int("SIMULATED_COLLECTION_CHARGE_BP", default=0)
SIMULATED_PAYOUT_CHARGE_PESEWAS = env.int("SIMULATED_PAYOUT_CHARGE_PESEWAS", default=0)
SIMULATED_PAYOUT_OUTCOME = env("SIMULATED_PAYOUT_OUTCOME", default="succeed")
SIMULATED_ACCOUNT_NAMES = {}
HUBTEL_COLLECTION_CHARGE_BP = env.int("HUBTEL_COLLECTION_CHARGE_BP", default=0)
```

- [ ] **Step 5: Run the tests**

Run: `docker compose -p wal1 run --rm web python manage.py test payments.tests.test_providers --noinput`
Expected: PASS (9 tests).

- [ ] **Step 6: Record the deviations in the spec.** Append to the end of `docs/superpowers/specs/2026-10-15-wallet-fees-security-design.md`:

```markdown

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
  known). When AshantiHub gives it back (its own or a vendor's error) it bears it: Dr provider fees.
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
  (`ledger.posting.lock`).

### Before LEDGER_ENABLED is turned on — Stage 3 additions

- (vi) **Simulated rails let anyone top up for free.** Never turn the ledger on in production before Plan 7 (Hubtel
  live) and the regulatory route (§12); on staging it is safe.
- (vii) **Top-ups share the Hubtel webhook failure mode (i).** A finalizer that raises leaves a paid top-up
  uncredited with `processed=False`; the 3b reconciliation reports it as `missing_in_ledger`, but alerting is still owed.
```

- [ ] **Step 7: Commit**

```bash
git add backend/payments/providers.py backend/payments/tests/test_providers.py backend/ashantihub/settings.py docs/superpowers/specs/2026-10-15-wallet-fees-security-design.md
git commit -m "feat(payments): provider interface with a simulated provider; Hubtel payouts not connected"
```

---

### Task 2: Ledger groundwork — locks, InsufficientFunds, refund fields on snapshots, OrderRefund

**Files:**
- Modify: `backend/ledger/posting.py` (whole file below), `backend/ledger/models.py` (`OrderFeeSnapshot` fields; new `OrderRefund`), `backend/ledger/fees.py` (`charged_to_date`)
- Create: `backend/ledger/migrations/0007_order_refunds.py` (generated), `backend/ledger/tests/test_groundwork.py`

**Interfaces:**
- Consumes: `ledger.models.Account`, `Journal`, `JournalLine`, `OrderFeeSnapshot`.
- Produces:
  - `posting.InsufficientFunds(PostingError)` with `.account` (the `Account` that would go below zero)
  - `posting.lock(*accounts) -> dict[int, Account]` (locked, fresh, in primary-key order; `None` entries skipped; call inside `transaction.atomic()`)
  - `posting.balance_of(kind, owner=None) -> int` (0 when the account was never opened; never creates one)
  - `posting.post(*, key, kind, lines, reference_type="", reference_id="", memo="", allow_negative=())` — `allow_negative` is a collection of account kinds this one posting may drive below zero
  - `OrderFeeSnapshot.refunded_base_pesewas`, `OrderFeeSnapshot.refunded_fee_pesewas` (`BigIntegerField`, default 0)
  - model `ledger.OrderRefund(order, source, whole, amount_pesewas, items_pesewas, delivery_pesewas, subsidy_pesewas, processing_pesewas, allocation, journal, created_by, note, created_at)`, unique on `(order, source)`, `related_name="refunds"` on the order
  - `fees.charged_to_date(owner)` = Σ (`charged_pesewas` − `refunded_fee_pesewas`) over snapshots not reversed

- [ ] **Step 1: Write the failing test** — `backend/ledger/tests/test_groundwork.py`

```python
"""Stage 3 groundwork: accounts locked in primary-key order, InsufficientFunds naming the account, one posting that
may drive a named kind below zero (a payout the provider confirmed), balances read without opening accounts,
refunded fees freeing the lifetime cap, and one refund per order and source."""
from django.db import IntegrityError, transaction
from django.test import TestCase
from django.utils import timezone

from accounts.models import BusinessOwner, Customer
from ledger import fees, posting
from ledger.models import Account, FeeRuleSet, OrderFeeSnapshot, OrderRefund
from orders.models import Order


class PostingGroundworkTests(TestCase):
    def setUp(self):
        self.customer = Customer.objects.create(full_name="Ama", phone="+233200990001", password_hash="x")
        self.clearing = posting.account_for(Account.PROVIDER_CLEARING)
        self.wallet = posting.account_for(Account.CUSTOMER_WALLET, self.customer)
        self.income = posting.account_for(Account.PLATFORM_FEE_INCOME)

    def test_overdrawing_a_wallet_raises_insufficient_funds_naming_it(self):
        posting.post(key="in", kind="t", lines=[posting.debit(self.clearing, 500), posting.credit(self.wallet, 500)])
        with self.assertRaises(posting.InsufficientFunds) as caught:
            posting.post(key="out", kind="t", lines=[posting.debit(self.wallet, 600), posting.credit(self.income, 600)])
        self.assertEqual(caught.exception.account.pk, self.wallet.pk)
        self.assertIsInstance(caught.exception, posting.PostingError)
        self.wallet.refresh_from_db()
        self.assertEqual(self.wallet.balance, 500)

    def test_one_posting_may_allow_a_named_kind_below_zero(self):
        subsidy = posting.account_for(Account.PLATFORM_PROMO_SUBSIDY)
        transit = posting.account_for(Account.WITHDRAWAL_IN_TRANSIT)
        posting.post(key="fund", kind="t", lines=[posting.debit(subsidy, 500), posting.credit(self.wallet, 500)])
        posting.post(key="hold", kind="t", lines=[posting.debit(self.wallet, 500), posting.credit(transit, 500)])
        settle = [posting.debit(transit, 500), posting.credit(self.clearing, 500)]
        with self.assertRaises(posting.InsufficientFunds):
            posting.post(key="paid", kind="t", lines=settle)
        posting.post(key="paid", kind="t", lines=settle, allow_negative={Account.PROVIDER_CLEARING})
        self.clearing.refresh_from_db()
        self.assertEqual(self.clearing.balance, -500)

    def test_lock_takes_accounts_in_primary_key_order_and_returns_them_fresh(self):
        Account.objects.filter(pk=self.wallet.pk).update(net_credit=700)
        with transaction.atomic():
            locked = posting.lock(self.wallet, None, self.clearing, self.wallet)
        self.assertEqual(list(locked), sorted({self.wallet.pk, self.clearing.pk}))
        self.assertEqual(locked[self.wallet.pk].balance, 700)

    def test_balance_of_reads_without_opening_an_account(self):
        other = Customer.objects.create(full_name="Kojo", phone="+233200990002", password_hash="x")
        self.assertEqual(posting.balance_of(Account.CUSTOMER_WALLET, other), 0)
        self.assertFalse(Account.objects.filter(kind=Account.CUSTOMER_WALLET, owner_id=str(other.pk)).exists())
        posting.post(key="in", kind="t", lines=[posting.debit(self.clearing, 250), posting.credit(self.wallet, 250)])
        self.assertEqual(posting.balance_of(Account.CUSTOMER_WALLET, self.customer), 250)
        self.assertEqual(posting.balance_of(Account.PROVIDER_CLEARING), 250)


class RefundGroundworkTests(TestCase):
    def setUp(self):
        self.customer = Customer.objects.create(full_name="Ama", phone="+233200990001", password_hash="x")
        self.owner = BusinessOwner.objects.create(full_name="Kofi", login_phone="+233207990001", password_hash="x")
        self.rules = FeeRuleSet.objects.filter(category=FeeRuleSet.PRODUCT).first()

    def snapshot(self, charged, refunded_fee=0, reversed=False):
        order = Order.objects.create(customer=self.customer, status=Order.PAID, total_amount="100.00")
        return OrderFeeSnapshot.objects.create(
            order=order, business_owner=self.owner, category=FeeRuleSet.PRODUCT, rule_set=self.rules, base_pesewas=10000,
            computed_pesewas=charged, charged_pesewas=charged, refunded_fee_pesewas=refunded_fee,
            refunded_base_pesewas=10000 if reversed else 0, reversed_at=timezone.now() if reversed else None,
        )

    def test_a_refunded_fee_frees_the_cap_and_a_reversed_snapshot_counts_nothing(self):
        self.snapshot(500)
        self.snapshot(500, refunded_fee=200)
        self.snapshot(500, refunded_fee=500, reversed=True)
        self.assertEqual(fees.charged_to_date(self.owner), 800)

    def test_one_refund_per_order_and_source(self):
        order = Order.objects.create(customer=self.customer, status=Order.PAID, total_amount="10.00")
        OrderRefund.objects.create(order=order, source="cancel", amount_pesewas=1000)
        with self.assertRaises(IntegrityError), transaction.atomic():
            OrderRefund.objects.create(order=order, source="cancel", amount_pesewas=1000)
        OrderRefund.objects.create(order=order, source="dispute-1", amount_pesewas=1)
        self.assertEqual(order.refunds.count(), 2)
```

- [ ] **Step 2: Run it to see it fail**

Run: `docker compose -p wal1 run --rm web python manage.py test ledger.tests.test_groundwork --noinput`
Expected: ERROR — `ImportError: cannot import name 'OrderRefund' from 'ledger.models'`.

- [ ] **Step 3: Posting** — replace the whole of `backend/ledger/posting.py` with

```python
"""The only door through which a ledger balance changes. `post` writes one balanced journal
atomically, idempotently on its key, locking the accounts it touches in primary-key order so
concurrent postings serialise instead of deadlocking. A caller that must read a balance before it
posts (a withdrawal's limits, a payment's fee cap) takes the same locks first with `lock`; every
money path takes them in one sorted pass, after the order row and its fee snapshots."""
from dataclasses import dataclass

from django.db import transaction

from .models import Account, Journal, JournalLine


class PostingError(Exception):
    pass


class InsufficientFunds(PostingError):
    """A balance that may not go below zero would have. `account` names it (a wallet, a pending balance...)."""

    def __init__(self, account):
        super().__init__(f"{account} would go below zero")
        self.account = account


@dataclass(frozen=True)
class Line:
    account: Account
    side: str
    amount: int


def debit(account, amount):
    return Line(account, JournalLine.DEBIT, amount)


def credit(account, amount):
    return Line(account, JournalLine.CREDIT, amount)


def account_for(kind, owner=None):
    """The account of `kind` held by `owner` (any model instance), created on first use."""
    owner_type, owner_id = ("", "") if owner is None else (owner._meta.label_lower, str(owner.pk))
    account, _ = Account.objects.get_or_create(kind=kind, owner_type=owner_type, owner_id=owner_id)
    return account


def balance_of(kind, owner=None):
    """`owner`'s balance on its `kind` account, 0 when that account was never opened. Never creates one."""
    owner_type, owner_id = ("", "") if owner is None else (owner._meta.label_lower, str(owner.pk))
    account = Account.objects.filter(kind=kind, owner_type=owner_type, owner_id=owner_id).first()
    return account.balance if account is not None else 0


def lock(*accounts):
    """Lock these accounts in primary-key order (the order every posting takes them) and return them fresh from the
    database: {pk: Account}. Call inside transaction.atomic(); None entries are skipped."""
    ids = sorted({account.pk for account in accounts if account is not None})
    return {account.pk: account for account in Account.objects.select_for_update().filter(pk__in=ids).order_by("pk")}


def _validate(key, kind, lines):
    if not key or not kind:
        raise PostingError("A posting needs a key and a kind")
    if len(lines) < 2:
        raise PostingError("A posting needs at least two lines")
    for line in lines:
        if line.side not in (JournalLine.DEBIT, JournalLine.CREDIT):
            raise PostingError(f"Unknown side {line.side!r}")
        if isinstance(line.amount, bool) or not isinstance(line.amount, int) or line.amount <= 0:
            raise PostingError(f"Amounts are positive whole pesewas, got {line.amount!r}")
    debits = sum(line.amount for line in lines if line.side == JournalLine.DEBIT)
    credits = sum(line.amount for line in lines if line.side == JournalLine.CREDIT)
    if debits != credits:
        raise PostingError(f"Unbalanced posting: debits {debits} != credits {credits}")


def post(*, key, kind, lines, reference_type="", reference_id="", memo="", allow_negative=()):
    """Write one balanced journal, or return the journal already posted under `key`. Raises InsufficientFunds (and
    writes nothing) when an account that may not go below zero would. `allow_negative` names account kinds this one
    posting may drive below zero: a payout the provider has already confirmed is a fact to record, whatever the
    provider-clearing balance says (Plan 3b)."""
    lines = list(lines)
    _validate(key, kind, lines)
    with transaction.atomic():
        locked = lock(*(line.account for line in lines))
        existing = Journal.objects.filter(key=key).first()
        if existing is not None:
            return existing
        journal = Journal.objects.create(key=key, kind=kind, reference_type=reference_type, reference_id=str(reference_id), memo=memo[:300])
        for line in lines:
            JournalLine.objects.create(journal=journal, account_id=line.account.pk, side=line.side, amount=line.amount)
            delta = line.amount if line.side == JournalLine.CREDIT else -line.amount
            locked[line.account.pk].net_credit += delta
        for account in locked.values():
            if account.balance < 0 and account.kind not in Account.MAY_GO_NEGATIVE and account.kind not in allow_negative:
                raise InsufficientFunds(account)
            account.save(update_fields=["net_credit"])
        return journal
```

- [ ] **Step 4: Models** — in `backend/ledger/models.py`, (a) replace

```python
    released_at = models.DateTimeField(null=True, blank=True)
    reversed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["order", "business_owner", "category"], name="ledger_one_snapshot_per_order_vendor_category")]
```

with

```python
    released_at = models.DateTimeField(null=True, blank=True)
    reversed_at = models.DateTimeField(null=True, blank=True)
    # What refunds have taken back so far (ledger.refunds; cumulative, pesewas): release pays only base and fee not
    # yet refunded, and the refunded fee no longer counts against the lifetime cap. `reversed_at` is set once the
    # whole base is refunded.
    refunded_base_pesewas = models.BigIntegerField(default=0)
    refunded_fee_pesewas = models.BigIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["order", "business_owner", "category"], name="ledger_one_snapshot_per_order_vendor_category")]
```

and (b) append at the end of the file

```python


class OrderRefund(models.Model):
    """Money given back to a customer for a paid order, always into their AshantiHub wallet (ledger.refunds). One row
    per (order, source): the source names what asked for it ("cancel", "pickup_expired", "dispute-<id>"), so the same
    request can never refund twice. Pesewas: `amount_pesewas` is order money returned to the customer (items_pesewas +
    delivery_pesewas − subsidy_pesewas); `processing_pesewas` is a collection charge AshantiHub gave back on its own or
    a vendor's error. `allocation` lists what each fee snapshot gave. `journal` is null only when nothing had to move."""

    order = models.ForeignKey("orders.Order", on_delete=models.PROTECT, related_name="refunds")
    source = models.CharField(max_length=60)
    whole = models.BooleanField(default=False)
    amount_pesewas = models.BigIntegerField()
    items_pesewas = models.BigIntegerField(default=0)
    delivery_pesewas = models.BigIntegerField(default=0)
    subsidy_pesewas = models.BigIntegerField(default=0)
    processing_pesewas = models.BigIntegerField(default=0)
    allocation = models.JSONField(default=list, blank=True)
    journal = models.OneToOneField(Journal, null=True, blank=True, on_delete=models.PROTECT, related_name="refund")
    created_by = models.ForeignKey("accounts.StaffUser", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    note = models.CharField(max_length=300, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "id"]
        constraints = [models.UniqueConstraint(fields=["order", "source"], name="ledger_one_refund_per_order_and_source")]

    def __str__(self):
        return f"Refund {self.source} on order {self.order_id}"
```

- [ ] **Step 5: The cap** — in `backend/ledger/fees.py` replace

```python
from django.db.models import Sum
```

with

```python
from django.db.models import F, Sum
```

and replace

```python
def charged_to_date(owner):
    total = OrderFeeSnapshot.objects.filter(business_owner=owner, reversed_at__isnull=True).aggregate(total=Sum("charged_pesewas"))["total"]
    return total or 0
```

with

```python
def charged_to_date(owner):
    """Fees charged to `owner` so far, for the lifetime cap: every snapshot not fully reversed, less the part of its
    fee a refund gave back (ledger.refunds)."""
    total = OrderFeeSnapshot.objects.filter(business_owner=owner, reversed_at__isnull=True).aggregate(
        total=Sum(F("charged_pesewas") - F("refunded_fee_pesewas"))
    )["total"]
    return total or 0
```

- [ ] **Step 6: Generate the migration**

Run: `docker compose -p wal1 run --rm web python manage.py makemigrations ledger --name order_refunds`
Expected: `backend/ledger/migrations/0007_order_refunds.py` with `AddField` `orderfeesnapshot.refunded_base_pesewas`, `AddField` `orderfeesnapshot.refunded_fee_pesewas` and `CreateModel` `OrderRefund` (dependencies include `("ledger", "0006_fulfilmentcheck")`). Open it and confirm nothing else is in it.

- [ ] **Step 7: Run the tests**

Run: `docker compose -p wal1 run --rm web python manage.py test ledger --noinput`
Expected: PASS — the 6 new tests and every existing ledger test (`InsufficientFunds` is a `PostingError`, so `test_posting.test_a_pending_balance_cannot_be_overdrawn` still passes).

- [ ] **Step 8: Commit**

```bash
git add backend/ledger
git commit -m "feat(ledger): lock helper, InsufficientFunds, refund fields on fee snapshots and OrderRefund"
```

---

### Task 3: Pay for an order from the wallet, and the "payment processing" line on MoMo

**Files:**
- Modify: `backend/payments/models.py` (kind `WALLET_TOPUP`, provider value `WALLET`, field `processing_fee`), `backend/payments/services.py` (`process_payment`, `_finalize_order_checkout`), `backend/ledger/escrow.py` (`record_order_payment`), `backend/orders/views.py` (`OrderCheckoutView`)
- Create: `backend/payments/migrations/0006_wallet_payments.py` (generated), `backend/ledger/tests/test_wallet_payment.py`

**Interfaces:**
- Consumes: `payments.providers.get_provider().collection_charge(amount_pesewas)` (Task 1); `posting.lock`, `posting.InsufficientFunds`, `posting.balance_of` (Task 2).
- Produces:
  - `CheckoutSession.WALLET_TOPUP = "wallet_topup"` (kind; its finalizer is Task 4), `CheckoutSession.WALLET = "wallet"` (the `provider` value of a wallet payment), `CheckoutSession.processing_fee` (`DecimalField(10, 2)`, default 0)
  - `process_payment(*, kind, amount, purpose, business_owner=None, customer=None, metadata=None, processing_fee=None, wallet=False)` — `wallet=True` only for a customer's `order_checkout`; immediate whatever `PAYMENTS_PROVIDER` says
  - `escrow.record_order_payment(order, *, at=None, wallet=False)` — debits `customer_wallet` instead of `provider_clearing` when `wallet`; raises `posting.InsufficientFunds` (writes nothing) when the wallet is too low
  - `POST /api/orders/checkout/` accepts `payment_method` (`"momo"` default, `"wallet"`); constants `orders.views.MOMO`, `WALLET`, `PAYMENT_METHODS`
  - with the ledger on, order sessions carry `metadata["ledger"] = True`

- [ ] **Step 1: Write the failing test** — `backend/ledger/tests/test_wallet_payment.py`

```python
"""Paying for an order from the AshantiHub wallet, and the payment-processing line on a MoMo payment (wallets plan 3a,
Task 3). Review Focus 1 (double spend), 2 (a wallet that covers only part) and 7 (ledger off)."""
import threading
from decimal import Decimal

from django.core.cache import cache
from django.db import connection, transaction
from django.test import TransactionTestCase, override_settings
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, Customer
from billing.models import Transaction
from cart.models import Cart
from ledger import escrow, posting
from ledger.models import Account, Journal, OrderFeeSnapshot
from listings.models import Category, Listing, Zone
from orders.models import Order, OrderItem
from payments.models import CheckoutSession

from .test_order_payment import OrderPaymentBase


def fund(customer, pesewas, key):
    """Put money in a customer's wallet the way a top-up does: provider clearing in, the wallet credited."""
    posting.post(key=key, kind="wallet_top_up", lines=[
        posting.debit(posting.account_for(Account.PROVIDER_CLEARING), pesewas),
        posting.credit(posting.account_for(Account.CUSTOMER_WALLET, customer), pesewas),
    ])


class CheckoutBase(OrderPaymentBase):
    def setUp(self):
        super().setUp()
        cache.clear()
        self.client = APIClient()
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.customer, 'customer')}")
        self.kofi = self.owner("Kofi")
        self.item = self.listing(self.kofi, "60.00")
        self.item.stock_quantity = 5
        self.item.save(update_fields=["stock_quantity"])

    def add_to_cart(self, quantity=2):
        added = self.client.post("/api/cart/items/", {"listing": self.item.id, "quantity": quantity}, format="json")
        self.assertIn(added.status_code, (200, 201), added.content)

    def checkout(self, **body):
        return self.client.post("/api/orders/checkout/", body, format="json")

    def wallet(self):
        return posting.balance_of(Account.CUSTOMER_WALLET, self.customer)


@override_settings(LEDGER_ENABLED=True)
class WalletCheckoutTests(CheckoutBase):
    def test_an_order_paid_from_the_wallet_debits_the_wallet_not_the_provider(self):
        fund(self.customer, 15000, "fund-1")
        self.add_to_cart(2)                                                              # GH₵ 120.00
        response = self.checkout(payment_method="wallet")
        self.assertEqual(response.status_code, 201, response.content)
        body = response.json()
        self.assertEqual((body["payment_method"], body["payment_processing"]), ("wallet", "0.00"))
        order = Order.objects.get(pk=body["id"])
        self.assertEqual(order.status, Order.PAID)
        self.assertEqual(self.wallet(), 3000)
        self.assertEqual(self.balance(Account.VENDOR_PENDING, self.kofi), 12000)
        self.assertEqual(self.balance(Account.PROVIDER_CLEARING), 15000)                 # only the top-up came through the provider
        session = CheckoutSession.objects.get(metadata__order_id=order.pk)
        self.assertEqual((session.provider, session.amount, session.processing_fee), ("wallet", Decimal("120.00"), Decimal("0.00")))
        self.assertTrue(session.metadata["ledger"])
        self.assertEqual(Transaction.objects.get(reference=session.reference).amount, Decimal("120.00"))
        self.assertFalse(Cart.objects.get(customer=self.customer).items.exists())

    def test_review_focus_a_wallet_that_covers_only_part_pays_nothing_and_changes_nothing(self):
        fund(self.customer, 5000, "fund-1")
        self.add_to_cart(2)
        response = self.checkout(payment_method="wallet")
        self.assertEqual((response.status_code, response.json()["code"]), (409, "insufficient_funds"), response.content)
        self.assertFalse(Order.objects.exists())
        self.assertFalse(CheckoutSession.objects.exists())
        self.assertFalse(OrderFeeSnapshot.objects.exists())
        self.assertEqual(self.wallet(), 5000)
        self.item.refresh_from_db()
        self.assertEqual(self.item.stock_quantity, 5)                                    # the reservation was undone
        self.assertEqual(Cart.objects.get(customer=self.customer).items.count(), 1)      # the cart is kept

    def test_a_wallet_payment_never_redirects_even_with_hubtel(self):
        fund(self.customer, 15000, "fund-1")
        self.add_to_cart(2)
        with override_settings(PAYMENTS_PROVIDER="hubtel"):
            response = self.checkout(payment_method="wallet")
        self.assertEqual(response.status_code, 201, response.content)
        self.assertNotIn("mode", response.json())
        self.assertEqual(self.wallet(), 3000)

    def test_an_unknown_payment_method_is_refused(self):
        self.add_to_cart(1)
        response = self.checkout(payment_method="card")
        self.assertEqual(response.status_code, 400)
        self.assertIn("payment_method", response.json())
        self.assertFalse(Order.objects.exists())

    @override_settings(SIMULATED_COLLECTION_CHARGE_BP=200)
    def test_momo_adds_payment_processing_on_top_and_the_ledger_records_the_net(self):
        self.add_to_cart(2)
        response = self.checkout()
        self.assertEqual(response.status_code, 201, response.content)
        body = response.json()
        self.assertEqual((body["payment_method"], body["payment_processing"], body["total_amount"]), ("momo", "2.40", "120.00"))
        session = CheckoutSession.objects.get(metadata__order_id=body["id"])
        self.assertEqual((session.amount, session.processing_fee, session.provider), (Decimal("122.40"), Decimal("2.40"), "simulated"))
        self.assertEqual(Transaction.objects.get(reference=session.reference).amount, Decimal("122.40"))
        self.assertEqual(self.balance(Account.PROVIDER_CLEARING), 12000)                 # the provider kept GH₵ 2.40

    @override_settings(SIMULATED_COLLECTION_CHARGE_BP=200)
    def test_a_wallet_payment_carries_no_processing_charge(self):
        fund(self.customer, 12000, "fund-1")
        self.add_to_cart(2)
        response = self.checkout(payment_method="wallet")
        self.assertEqual((response.status_code, response.json()["payment_processing"]), (201, "0.00"))
        self.assertEqual(self.wallet(), 0)


class LedgerOffCheckoutTests(CheckoutBase):
    def test_review_focus_with_the_ledger_off_checkout_is_exactly_as_before(self):
        self.add_to_cart(2)
        response = self.checkout()
        self.assertEqual(response.status_code, 201, response.content)
        self.assertNotIn("payment_method", response.json())
        self.assertNotIn("payment_processing", response.json())
        session = CheckoutSession.objects.get(metadata__order_id=response.json()["id"])
        self.assertEqual((session.amount, session.processing_fee, session.provider), (Decimal("120.00"), Decimal("0.00"), "simulated"))
        self.assertNotIn("ledger", session.metadata)
        self.assertFalse(Account.objects.exists())

    def test_paying_from_the_wallet_is_refused_while_the_ledger_is_off(self):
        self.add_to_cart(1)
        response = self.checkout(payment_method="wallet")
        self.assertEqual((response.status_code, response.json()["code"]), (409, "ledger_off"))
        self.assertFalse(Order.objects.exists())


@override_settings(LEDGER_ENABLED=True)
class WalletDoubleSpendTests(TransactionTestCase):
    serialized_rollback = True

    def test_review_focus_two_wallet_payments_at_once_never_spend_one_balance_twice(self):
        customer = Customer.objects.create(full_name="Ama", phone="+233200990001", password_hash="x")
        owner = BusinessOwner.objects.create(full_name="Kofi", login_phone="+233207990001", password_hash="x")
        listing = Listing.objects.create(
            business_owner=owner, category=Category.objects.get(slug="shops"), zone=Zone.objects.get(name="Manhyia"),
            name="Kente", description="D.", contact_phone=owner.login_phone, price_amount=Decimal("100.00"), status=Listing.PUBLISHED,
        )
        fund(customer, 15000, "fund-1")
        orders = []
        for _ in range(2):
            order = Order.objects.create(customer=customer, status=Order.PAID, total_amount=Decimal("100.00"))
            OrderItem.objects.create(order=order, listing=listing, quantity=1, unit_price=Decimal("100.00"), line_total=Decimal("100.00"))
            orders.append(order)
        results, barrier = [], threading.Barrier(2)

        def pay(order):
            try:
                barrier.wait()
                with transaction.atomic():
                    escrow.record_order_payment(order, wallet=True)
                results.append("paid")
            except posting.InsufficientFunds:
                results.append("refused")
            finally:
                connection.close()

        threads = [threading.Thread(target=pay, args=(order,)) for order in orders]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=10)
            self.assertFalse(thread.is_alive(), "a racing thread hung")
        self.assertEqual(sorted(results), ["paid", "refused"])
        self.assertEqual(posting.balance_of(Account.CUSTOMER_WALLET, customer), 5000)
        self.assertEqual(Journal.objects.filter(kind="order_payment").count(), 1)
        self.assertEqual(OrderFeeSnapshot.objects.count(), 1)
```

- [ ] **Step 2: Run it to see it fail**

Run: `docker compose -p wal1 run --rm web python manage.py test ledger.tests.test_wallet_payment --noinput`
Expected: FAIL/ERROR — `record_order_payment() got an unexpected keyword argument 'wallet'`, and the wallet checkout answers 201 without `payment_method` (the field is ignored today).

- [ ] **Step 3: Payments model** — in `backend/payments/models.py`, (a) replace

```python
    EVENT_RENEW = "event_renew"
    KIND_CHOICES = [
```

with

```python
    EVENT_RENEW = "event_renew"
    # Money added to a customer's AshantiHub wallet by mobile money (wallets plan 3a; finalizer in services.py).
    WALLET_TOPUP = "wallet_topup"
    KIND_CHOICES = [
```

(b) replace

```python
        (EVENT_RENEW, "Event Renewal"),
    ]
```

with

```python
        (EVENT_RENEW, "Event Renewal"),
        (WALLET_TOPUP, "Wallet Top-up"),
    ]

    # The `provider` of an order paid from the customer's AshantiHub wallet: no provider moved any money.
    WALLET = "wallet"
```

and (c) replace

```python
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    purpose = models.CharField(max_length=255)
```

with

```python
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    # The provider's collection charge the customer pays on top ("payment processing", spec §1 row 14), already inside
    # `amount`. 0 for a wallet payment and whenever the ledger is off. The provider keeps it; the ledger records the rest.
    processing_fee = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    purpose = models.CharField(max_length=255)
```

- [ ] **Step 4: Generate the migration**

Run: `docker compose -p wal1 run --rm web python manage.py makemigrations payments --name wallet_payments`
Expected: `backend/payments/migrations/0006_wallet_payments.py` with `AddField` `checkoutsession.processing_fee` and `AlterField` `checkoutsession.kind` (the new choice), depending on `("payments", "0005_stamp_legacy_paid_months")`.

- [ ] **Step 5: `process_payment` and the order finalizer** — in `backend/payments/services.py`, (a) in `_finalize_order_checkout` replace

```python
    escrow.record_order_payment(order)
```

with

```python
    # Paid from the customer's wallet (process_payment(wallet=True)): the wallet is debited instead of provider
    # clearing; a balance too low raises posting.InsufficientFunds, which rolls the checkout back.
    escrow.record_order_payment(order, wallet=session.provider == CheckoutSession.WALLET)
```

and (b) replace the whole `process_payment` function (from `def process_payment(` to the end of the file) with

```python
def process_payment(*, kind, amount, purpose, business_owner=None, customer=None, metadata=None, processing_fee=None, wallet=False):
    """The shared entrypoint described in this module's docstring. Returns:
    - `{"mode": "immediate", "transaction": Transaction, "session": CheckoutSession}`
      when PAYMENTS_PROVIDER != "hubtel" (or for a wallet payment) — the Transaction already exists and
      the finalizer has already run, exactly as every pre-existing call site
      used to do inline.
    - `{"mode": "redirect", "checkout_url": str, "reference": str, "session": CheckoutSession}`
      when PAYMENTS_PROVIDER == "hubtel" — nothing is finalized yet; the
      caller must return this shape to the frontend so it can redirect.

    `processing_fee` is the provider's collection charge already included in `amount` (kept on the session; 0 by
    default). `wallet=True` pays a customer's order from their AshantiHub wallet: the session's provider is "wallet",
    it is immediate whatever PAYMENTS_PROVIDER says, and the order finalizer debits the wallet instead of provider
    clearing (ledger.posting.InsufficientFunds when the balance is too low, which rolls the caller's transaction back).
    """
    if bool(business_owner) == bool(customer):
        raise ValueError("process_payment requires exactly one of business_owner or customer")
    if wallet and (customer is None or kind != CheckoutSession.ORDER_CHECKOUT):
        raise ValueError("Only a customer's order can be paid from the wallet")

    session = CheckoutSession.objects.create(
        business_owner=business_owner,
        customer=customer,
        kind=kind,
        amount=amount,
        processing_fee=processing_fee or 0,
        provider=CheckoutSession.WALLET if wallet else "simulated",
        purpose=purpose,
        metadata=metadata or {},
    )

    if wallet or settings.PAYMENTS_PROVIDER != "hubtel":
        txn_kwargs = {
            "amount": amount,
            "purpose": purpose,
            "status": Transaction.SUCCESS,
            "reference": session.reference,
        }
        if business_owner is not None:
            txn_kwargs["business_owner"] = business_owner
        else:
            txn_kwargs["customer"] = customer
        txn = Transaction.objects.create(**txn_kwargs)

        session.status = CheckoutSession.SUCCESS
        session.transaction = txn
        session.save(update_fields=["status", "transaction", "updated_at"])

        finalize_success(session)

        return {"mode": "immediate", "transaction": txn, "session": session}

    # settings.PAYMENTS_PROVIDER == "hubtel" — UNVERIFIED path, see
    # hubtel_client.py's module docstring. Only ever reached once
    # HUBTEL_CLIENT_ID etc. are actually set, which they are not at launch.
    checkout = hubtel_client.create_checkout(session)
    session.provider = "hubtel"
    session.checkout_url = checkout.get("checkout_url")
    session.hubtel_checkout_id = checkout.get("checkout_id")
    session.save(update_fields=["provider", "checkout_url", "hubtel_checkout_id", "updated_at"])

    return {
        "mode": "redirect",
        "checkout_url": session.checkout_url,
        "reference": session.reference,
        "session": session,
    }
```

- [ ] **Step 6: The payment journal** — in `backend/ledger/escrow.py`, (a) in the module docstring replace

```python
    Dr provider clearing   what the customer paid (order.total_amount)
```

with

```python
    Dr provider clearing   what the customer paid (order.total_amount), or Dr customer wallet when paid from the wallet
```

and (b) replace the whole `record_order_payment` function with

```python
def record_order_payment(order, *, at=None, wallet=False):
    """The payment journal for a paid order (see the module docstring). `wallet=True`: the customer paid from their
    AshantiHub wallet, so the wallet is debited instead of provider clearing; a wallet that is too low raises
    posting.InsufficientFunds and nothing is written. Every account the journal touches is locked up front in
    primary-key order before the fees charged so far are read: two payments for one vendor cannot both see the same
    cap remainder, and a wallet payment cannot deadlock with a refund to the same wallet."""
    if not enabled():
        return None
    at = at or timezone.now()
    with transaction.atomic():
        if Journal.objects.filter(key=pay_key(order)).exists():
            return None
        groups = _vendor_groups(order)
        delivery = to_pesewas(order.delivery_fee or 0)
        paid = to_pesewas(order.total_amount)
        subsidy = to_pesewas(order.discount_amount or 0)
        if not (paid or subsidy or delivery or any(sum(g["by_category"].values()) for g in groups.values())):
            return None  # a GHS 0.00 order has no money to record; write neither snapshots nor a journal
        # Created in primary-key order so two first payments sharing vendors cannot deadlock on the unique index.
        pendings = {pk: posting.account_for(Account.VENDOR_PENDING, groups[pk]["owner"]) for pk in sorted(groups)}
        source = None
        if paid:
            source = (
                posting.account_for(Account.CUSTOMER_WALLET, order.customer) if wallet
                else posting.account_for(Account.PROVIDER_CLEARING)
            )
        payable = posting.account_for(Account.DELIVERY_PAYABLE, order) if delivery else None
        promo = posting.account_for(Account.PLATFORM_PROMO_SUBSIDY) if subsidy else None
        posting.lock(*pendings.values(), source, payable, promo)
        cap = settings_store.current("fee_cap_pesewas", at)

        credits, items_total = [], 0
        for pk in sorted(groups):
            group = groups[pk]
            already = fees.charged_to_date(group["owner"])
            vendor_total = 0
            for category, base in sorted(group["by_category"].items()):
                quote = fees.quote(category, base, cap=cap, already_charged=already, at=at)
                already += quote.charged
                vendor_total += base
                OrderFeeSnapshot.objects.create(
                    order=order, business_owner=group["owner"], category=category, rule_set_id=quote.rule_set_id,
                    base_pesewas=base, computed_pesewas=quote.computed, charged_pesewas=quote.charged, cap_pesewas=cap,
                )
            if vendor_total:
                credits.append(posting.credit(pendings[pk], vendor_total))
            items_total += vendor_total

        if paid + subsidy != items_total + delivery:
            raise posting.PostingError(
                f"Order {order.pk} does not reconcile: paid {paid} + discount {subsidy} != items {items_total} + delivery {delivery}"
            )
        if delivery:
            credits.append(posting.credit(payable, delivery))
        debits = []
        if paid:
            debits.append(posting.debit(source, paid))
        if subsidy:
            debits.append(posting.debit(promo, subsidy))
        return posting.post(
            key=pay_key(order), kind="order_payment", lines=debits + credits,
            reference_type="orders.order", reference_id=str(order.pk), memo=f"Payment for order #{order.pk}",
        )
```

- [ ] **Step 7: Checkout** — four edits in `backend/orders/views.py`.

(a) Replace

```python
from marketing import waivers
from payments.services import process_payment
```

with

```python
from marketing import waivers
from ledger import escrow, posting
from ledger.models import Account
from ledger.money import from_pesewas, to_pesewas
from payments.providers import get_provider
from payments.services import process_payment
```

(b) Replace

```python
class OrderCheckoutView(APIView):
```

with

```python
# How a customer pays at checkout (wallets plan 3a): by mobile money through the provider (the default, today's path)
# or from their AshantiHub wallet, which needs LEDGER_ENABLED.
MOMO, WALLET = "momo", "wallet"
PAYMENT_METHODS = (MOMO, WALLET)
WALLET_OFF = "Paying from your AshantiHub wallet isn't switched on yet."
WALLET_TOO_LOW = "Your AshantiHub wallet doesn't hold enough for this order."


class OrderCheckoutView(APIView):
```

(c) Replace

```python
        if not items:
            return Response({"detail": "Your cart is empty."}, status=status.HTTP_400_BAD_REQUEST)

        # Delivery method + address (Wave F). Defaults to store pickup so an
```

with

```python
        if not items:
            return Response({"detail": "Your cart is empty."}, status=status.HTTP_400_BAD_REQUEST)

        payment_method = request.data.get("payment_method") or MOMO
        if payment_method not in PAYMENT_METHODS:
            return Response({"payment_method": "Pay by mobile money or from your AshantiHub wallet."}, status=status.HTTP_400_BAD_REQUEST)
        if payment_method == WALLET and not escrow.enabled():
            return Response({"detail": WALLET_OFF, "code": "ledger_off"}, status=status.HTTP_409_CONFLICT)
        processing = Decimal("0.00")

        # Delivery method + address (Wave F). Defaults to store pickup so an
```

(d) Replace everything from

```python
            result = process_payment(
                kind=CheckoutSession.ORDER_CHECKOUT,
                amount=total,
```

down to and including the final

```python
        return Response(OrderSerializer(order).data, status=status.HTTP_201_CREATED)
```

of `OrderCheckoutView.post` with

```python
            # The provider's collection charge ("payment processing", spec §1 row 14) is paid on top of a MoMo payment
            # while the ledger is on; a wallet payment carries none. With the ledger off nothing is added.
            if escrow.enabled() and payment_method == MOMO:
                processing = from_pesewas(get_provider().collection_charge(to_pesewas(total)))
            try:
                with db_transaction.atomic():
                    result = process_payment(
                        kind=CheckoutSession.ORDER_CHECKOUT,
                        amount=total + processing,
                        processing_fee=processing,
                        wallet=payment_method == WALLET,
                        purpose=f"AshantiHub Order #{order.id}",
                        customer=request.user,
                        # stock_reservations lets _fail_order_checkout put the stock
                        # back if a (Hubtel-mode) payment later fails/expires. "ledger" tells the nightly
                        # reconciliation (wallets plan 3b) that the ledger was asked to record this payment.
                        metadata={
                            "order_id": order.id, "stock_reservations": reservations,
                            **({"promos": True} if promo else {}), **({"ledger": True} if escrow.enabled() else {}),
                        },
                    )
            except posting.InsufficientFunds as exc:
                if exc.account.kind != Account.CUSTOMER_WALLET:
                    raise
                # Nothing is paid in part: the order, its lines, the stock reservation and any coupon use all roll back.
                db_transaction.set_rollback(True)
                return Response({"detail": WALLET_TOO_LOW, "code": "insufficient_funds"}, status=status.HTTP_409_CONFLICT)

            if result["mode"] == "redirect":
                redirect = {
                    "mode": "redirect",
                    "checkout_url": result["checkout_url"],
                    "reference": result["reference"],
                }
                if escrow.enabled():
                    redirect["payment_processing"] = str(processing)
                return Response(redirect, status=status.HTTP_200_OK)

            # Immediate/simulated mode — process_payment() has already
            # created the Transaction and run _finalize_order_checkout
            # (order.status = PAID) synchronously, exactly matching this
            # view's pre-existing behavior.
            order.refresh_from_db()
            cart.items.all().delete()

        body = OrderSerializer(order).data
        if escrow.enabled():
            body = {**body, "payment_method": payment_method, "payment_processing": str(processing)}
        return Response(body, status=status.HTTP_201_CREATED)
```

- [ ] **Step 8: Run the tests**

Run: `docker compose -p wal1 run --rm web python manage.py test ledger payments orders --noinput`
Expected: PASS — the 9 new tests, and every existing ledger, payments and orders test unchanged (the default `payment_method` is today's path; `test_process_payment_simulated` still sees provider `"simulated"`).

- [ ] **Step 9: Commit**

```bash
git add backend/payments backend/ledger backend/orders/views.py
git commit -m "feat(wallets): pay for an order from the wallet; payment processing on MoMo; up-front account locks"
```

---

### Task 4: The `wallets` app — top-up, balances, statement, processing quote

**Files:**
- Create: `backend/wallets/__init__.py` (empty), `backend/wallets/apps.py`, `backend/wallets/services.py`, `backend/wallets/views.py`, `backend/wallets/urls.py`, `backend/wallets/tests/__init__.py` (empty), `backend/wallets/tests/test_wallet_api.py`
- Modify: `backend/ashantihub/settings.py` (`INSTALLED_APPS`), `backend/ashantihub/urls.py`, `backend/payments/services.py` (top-up finalizer)

**Interfaces:**
- Consumes: `process_payment(..., processing_fee=...)`, `CheckoutSession.WALLET_TOPUP` (Task 3); `get_provider()` (Task 1); `posting.balance_of`, `posting.post` (Task 2); `otp.views_authenticator.IsCustomerOrOwner`; `accounts.views.IsCustomer`.
- Produces:
  - `wallets.services.topup_key(reference) -> "wallet-topup-<reference>"`, `record_top_up(session) -> Journal`, `money(pesewas) -> "12.50"`, `summary(holder) -> dict`, `statement_lines(holder) -> QuerySet[JournalLine]`, `line_row(line) -> dict`, `LABELS`
  - `wallets.views.ledger_off() -> Response(409)`, `OFF`, `parse_amount(raw) -> int` (pesewas), `AmountError`, `MAX_PESEWAS`, `Pagination` (20 a page) — reused by Task 9 and Plan 3b
  - endpoints `GET /api/wallet/`, `GET /api/wallet/transactions/`, `GET /api/wallet/processing/?amount=`, `POST /api/wallet/top-up/`
  - `payments.services._finalize_wallet_topup(session)` registered in `FINALIZERS`

- [ ] **Step 1: Write the failing test** — `backend/wallets/tests/test_wallet_api.py` (and an empty `backend/wallets/tests/__init__.py`)

```python
"""The holder's wallet API (wallets plan 3a, Task 4): top-up, balances, statement, processing quote. Review Focus 6 (a
duplicate webhook credits once) and 7 (ledger off)."""
import hashlib
import hmac
import json
from decimal import Decimal
from unittest.mock import patch

from django.core.cache import cache
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, Customer
from billing.models import Transaction
from ledger import posting
from ledger.models import Account, Journal
from payments.models import CheckoutSession

SECRET = "test-webhook-secret"


def client_for(account, kind):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(account, kind)}")
    return client


class WalletApiBase(TestCase):
    def setUp(self):
        cache.clear()
        self.customer = Customer.objects.create(full_name="Ama Owusu", phone="+233241234567", password_hash="x")
        self.owner = BusinessOwner.objects.create(full_name="Kwame Mensah", login_phone="+233201112233", password_hash="x")
        self.client = client_for(self.customer, "customer")

    def wallet(self):
        return posting.balance_of(Account.CUSTOMER_WALLET, self.customer)

    def top_up(self, amount):
        return self.client.post("/api/wallet/top-up/", {"amount": amount}, format="json")


class LedgerOffTests(WalletApiBase):
    def test_review_focus_every_wallet_endpoint_says_ledger_off_and_opens_nothing(self):
        for response in (
            self.client.get("/api/wallet/"), self.client.get("/api/wallet/transactions/"),
            self.client.get("/api/wallet/processing/?amount=10"), self.top_up("10"),
        ):
            self.assertEqual((response.status_code, response.json()["code"]), (409, "ledger_off"))
        self.assertFalse(Account.objects.exists())
        self.assertFalse(CheckoutSession.objects.exists())


@override_settings(LEDGER_ENABLED=True)
class TopUpTests(WalletApiBase):
    def test_a_simulated_top_up_credits_the_wallet_at_once(self):
        response = self.top_up("50.00")
        self.assertEqual(response.status_code, 201, response.content)
        body = response.json()
        self.assertEqual(
            (body["mode"], body["amount"], body["payment_processing"], body["you_pay"], body["balance"]),
            ("immediate", "50.00", "0.00", "50.00", "50.00"),
        )
        session = CheckoutSession.objects.get(reference=body["reference"])
        self.assertEqual((session.kind, session.status, session.amount), (CheckoutSession.WALLET_TOPUP, CheckoutSession.SUCCESS, Decimal("50.00")))
        self.assertEqual((session.metadata["credit_pesewas"], session.metadata["ledger"]), (5000, True))
        self.assertTrue(Journal.objects.filter(key=f"wallet-topup-{session.reference}").exists())
        self.assertEqual(self.wallet(), 5000)
        self.assertEqual(posting.balance_of(Account.PROVIDER_CLEARING), 5000)

    @override_settings(SIMULATED_COLLECTION_CHARGE_BP=200)
    def test_the_customer_pays_the_processing_charge_and_the_wallet_gets_the_amount(self):
        body = self.top_up("50.00").json()
        self.assertEqual((body["payment_processing"], body["you_pay"], body["balance"]), ("1.00", "51.00", "50.00"))
        session = CheckoutSession.objects.get(reference=body["reference"])
        self.assertEqual((session.amount, session.processing_fee), (Decimal("51.00"), Decimal("1.00")))
        self.assertEqual(Transaction.objects.get(reference=session.reference).amount, Decimal("51.00"))
        self.assertEqual(posting.balance_of(Account.PROVIDER_CLEARING), 5000)               # the provider kept GH₵ 1.00

    def test_bad_amounts_are_refused(self):
        for raw in ("0", "-5", "1.005", "abc", "", None, True, "NaN", "100000000"):
            with self.subTest(raw=raw):
                response = self.top_up(raw)
                self.assertEqual(response.status_code, 400, response.content)
                self.assertIn("amount", response.json())
        self.assertFalse(CheckoutSession.objects.exists())

    def test_business_owners_cannot_top_up(self):
        response = client_for(self.owner, "business_owner").post("/api/wallet/top-up/", {"amount": "10"}, format="json")
        self.assertEqual(response.status_code, 403)
        self.assertFalse(CheckoutSession.objects.exists())


@override_settings(LEDGER_ENABLED=True, PAYMENTS_PROVIDER="hubtel", HUBTEL_WEBHOOK_SECRET=SECRET)
class HubtelTopUpTests(WalletApiBase):
    def webhook(self, payload):
        raw = json.dumps(payload).encode("utf-8")
        signature = hmac.new(SECRET.encode("utf-8"), raw, hashlib.sha256).hexdigest()
        return APIClient().generic(
            "POST", "/api/payments/webhook/hubtel/", data=raw, content_type="application/json", HTTP_X_HUBTEL_SIGNATURE=signature,
        )

    @patch("payments.services.hubtel_client.create_checkout", return_value={"checkout_url": "https://checkout.example/x", "checkout_id": "hb-1"})
    def test_review_focus_the_wallet_is_credited_once_when_hubtel_confirms(self, _create):
        response = self.top_up("20.00")
        self.assertEqual((response.status_code, response.json()["mode"]), (200, "redirect"), response.content)
        self.assertEqual(response.json()["checkout_url"], "https://checkout.example/x")
        reference = response.json()["reference"]
        self.assertEqual(self.wallet(), 0)                                                   # nothing until Hubtel confirms
        payload = {"ClientReference": reference, "Status": "Success", "Amount": "20.00"}
        self.assertEqual(self.webhook(payload).status_code, 200)
        self.assertEqual(self.webhook(payload).status_code, 200)                              # Hubtel retries
        self.assertEqual(self.wallet(), 2000)
        self.assertEqual(Journal.objects.filter(kind="wallet_top_up").count(), 1)


@override_settings(LEDGER_ENABLED=True)
class BalanceAndStatementTests(WalletApiBase):
    def test_a_customer_sees_their_wallet_and_its_lines_newest_first(self):
        self.top_up("30.00")
        self.top_up("5.50")
        self.assertEqual(self.client.get("/api/wallet/").json(), {"kind": "customer", "balance": "35.50"})
        page = self.client.get("/api/wallet/transactions/").json()
        self.assertEqual(page["count"], 2)
        first = page["results"][0]
        self.assertEqual(
            (first["label"], first["direction"], first["amount"], first["account"], first["order"]),
            ("Top-up", "in", "5.50", "wallet", None),
        )
        self.assertTrue(first["reference"].startswith("AH-WALLET_TOPUP-"))

    def test_a_vendor_sees_pending_and_available_and_reading_opens_no_account(self):
        owner_client = client_for(self.owner, "business_owner")
        self.assertEqual(owner_client.get("/api/wallet/").json(), {"kind": "vendor", "pending": "0.00", "available": "0.00"})
        self.assertEqual(owner_client.get("/api/wallet/transactions/").json()["count"], 0)
        self.assertFalse(Account.objects.exists())

    def test_the_processing_quote(self):
        with override_settings(SIMULATED_COLLECTION_CHARGE_BP=195):
            body = self.client.get("/api/wallet/processing/?amount=100").json()
        self.assertEqual(
            (body["amount"], body["payment_processing"], body["you_pay"], body["provider"]), ("100.00", "1.95", "101.95", "simulated"),
        )
        self.assertEqual(self.client.get("/api/wallet/processing/?amount=1.234").status_code, 400)

    def test_another_holders_lines_are_never_shown(self):
        other = Customer.objects.create(full_name="Kojo", phone="+233241234568", password_hash="x")
        client_for(other, "customer").post("/api/wallet/top-up/", {"amount": "9.00"}, format="json")
        self.assertEqual(self.client.get("/api/wallet/transactions/").json()["count"], 0)
        self.assertEqual(self.client.get("/api/wallet/").json()["balance"], "0.00")
```

- [ ] **Step 2: Run it to see it fail**

Run: `docker compose -p wal1 run --rm web python manage.py test wallets --noinput`
Expected: ERROR — `ModuleNotFoundError: No module named 'wallets'` (or "Failed to import test module").

- [ ] **Step 3: The app** — `backend/wallets/__init__.py`: empty file. `backend/wallets/apps.py`:

```python
from django.apps import AppConfig


class WalletsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "wallets"
    verbose_name = "Wallets"
```

In `backend/ashantihub/settings.py` (`INSTALLED_APPS`) replace

```python
    "otp",
    "announcements",
```

with

```python
    "otp",
    "wallets",
    "announcements",
```

In `backend/ashantihub/urls.py` replace

```python
    path("api/otp/", include("otp.urls")),
```

with

```python
    path("api/otp/", include("otp.urls")),
    path("api/wallet/", include("wallets.urls")),
```

- [ ] **Step 4: Services** — `backend/wallets/services.py`

```python
"""Customer wallets and vendor balances as their holders see them (spec §5, §6), over the ledger. Money is integer
pesewas inside and GH₵ strings at the API edge. Reading a balance never opens an account; only a posting does."""
from accounts.models import BusinessOwner, Customer
from ledger import posting
from ledger.models import Account, JournalLine
from ledger.money import from_pesewas

# What each journal kind is called on a holder's statement.
LABELS = {
    "order_payment": "Order payment",
    "order_release": "Released to you",
    "order_refund": "Refund",
    "order_waiver_charge": "Free-delivery promo",
    "order_waiver_return": "Free-delivery promo returned",
    "wallet_top_up": "Top-up",
    "withdrawal_hold": "Withdrawal",
    "withdrawal_reversed": "Withdrawal returned",
}
ACCOUNT_NAMES = {Account.CUSTOMER_WALLET: "wallet", Account.VENDOR_PENDING: "pending", Account.VENDOR_AVAILABLE: "available"}


def money(pesewas):
    """"12.50" for 1250 pesewas."""
    return str(from_pesewas(pesewas))


def topup_key(reference):
    return f"wallet-topup-{reference}"


def record_top_up(session):
    """Credit a paid top-up session to the customer's wallet: Dr provider clearing, Cr customer wallet, by the amount
    asked for (`metadata["credit_pesewas"]`; the processing charge the provider kept is not in it). Idempotent on the
    session's reference. Posted whatever LEDGER_ENABLED says now: a top-up session exists only if the ledger was on when
    it was created, and a customer who paid must be credited."""
    credit = session.metadata.get("credit_pesewas")
    if isinstance(credit, bool) or not isinstance(credit, int) or credit <= 0 or session.customer_id is None:
        raise posting.PostingError(f"Top-up {session.reference} carries no amount to credit")
    return posting.post(
        key=topup_key(session.reference), kind="wallet_top_up",
        lines=[
            posting.debit(posting.account_for(Account.PROVIDER_CLEARING), credit),
            posting.credit(posting.account_for(Account.CUSTOMER_WALLET, session.customer), credit),
        ],
        reference_type="payments.checkoutsession", reference_id=session.reference, memo=f"Wallet top-up {session.reference}",
    )


def account_kinds(holder):
    if isinstance(holder, Customer):
        return (Account.CUSTOMER_WALLET,)
    if isinstance(holder, BusinessOwner):
        return (Account.VENDOR_PENDING, Account.VENDOR_AVAILABLE)
    raise TypeError(f"{type(holder).__name__} holds no wallet")


def summary(holder):
    """A customer's wallet balance, or a vendor's Pending and Available (Available may be negative after a late refund)."""
    if isinstance(holder, Customer):
        return {"kind": "customer", "balance": money(posting.balance_of(Account.CUSTOMER_WALLET, holder))}
    return {
        "kind": "vendor",
        "pending": money(posting.balance_of(Account.VENDOR_PENDING, holder)),
        "available": money(posting.balance_of(Account.VENDOR_AVAILABLE, holder)),
    }


def statement_lines(holder):
    """Every journal line on the holder's own accounts, newest first."""
    return (
        JournalLine.objects.filter(
            account__kind__in=account_kinds(holder), account__owner_type=holder._meta.label_lower, account__owner_id=str(holder.pk),
        )
        .select_related("journal", "account").order_by("-journal__created_at", "-id")
    )


def line_row(line):
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

- [ ] **Step 5: Views and URLs** — `backend/wallets/views.py`

```python
"""The holder's own money (spec §5, §6), at /api/wallet/: balances, the statement, the payment-processing quote and
top-ups. Customers and business owners only (top-ups and quotes: customers). Every endpoint answers
409 {"code": "ledger_off"} while LEDGER_ENABLED is off, so nothing changes until it is turned on. Staff reads are in
views_staff.py."""
from decimal import Decimal, InvalidOperation

from django.db import transaction
from rest_framework import status
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.views import IsCustomer
from ledger import escrow
from ledger.money import from_pesewas, to_pesewas
from otp.views_authenticator import IsCustomerOrOwner
from payments.models import CheckoutSession
from payments.providers import get_provider
from payments.services import process_payment

from . import services

OFF = "Wallets aren't switched on yet."
MAX_PESEWAS = 9_999_999_999  # a DecimalField(10, 2) holds at most GH₵ 99,999,999.99


def ledger_off():
    return Response({"detail": OFF, "code": "ledger_off"}, status=status.HTTP_409_CONFLICT)


class AmountError(Exception):
    pass


def parse_amount(raw):
    """Pesewas from a GH₵ amount a person typed ("50", "50.5", 50.25). Raises AmountError with the message to show."""
    if raw is None or isinstance(raw, bool) or (isinstance(raw, str) and not raw.strip()):
        raise AmountError("Enter an amount in GH₵.")
    try:
        value = Decimal(str(raw).strip())
    except InvalidOperation:
        raise AmountError("Enter an amount in GH₵, like 50.00.") from None
    if not value.is_finite():
        raise AmountError("Enter an amount in GH₵, like 50.00.")
    try:
        pesewas = to_pesewas(value)
    except ValueError:
        raise AmountError("Use at most two decimal places.") from None
    if pesewas <= 0:
        raise AmountError("The amount must be more than GH₵ 0.00.")
    if pesewas > MAX_PESEWAS:
        raise AmountError("That amount is too large.")
    return pesewas


class Pagination(PageNumberPagination):
    page_size = 20


class WalletView(APIView):
    """GET / — the holder's balances: a customer's wallet, or a vendor's Pending and Available."""

    permission_classes = [IsCustomerOrOwner]

    def get(self, request):
        if not escrow.enabled():
            return ledger_off()
        return Response(services.summary(request.user))


class TransactionsView(APIView):
    """GET transactions/ — every ledger line on the holder's own accounts, newest first, 20 a page."""

    permission_classes = [IsCustomerOrOwner]

    def get(self, request):
        if not escrow.enabled():
            return ledger_off()
        paginator = Pagination()
        page = paginator.paginate_queryset(services.statement_lines(request.user), request, view=self)
        return paginator.get_paginated_response([services.line_row(line) for line in page])


class ProcessingView(APIView):
    """GET processing/?amount= — the payment-processing charge a MoMo payment or top-up of that amount adds on top."""

    permission_classes = [IsCustomer]

    def get(self, request):
        if not escrow.enabled():
            return ledger_off()
        try:
            amount = parse_amount(request.query_params.get("amount"))
        except AmountError as exc:
            return Response({"amount": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        provider = get_provider()
        charge = provider.collection_charge(amount)
        return Response({
            "amount": services.money(amount), "payment_processing": services.money(charge),
            "you_pay": services.money(amount + charge), "provider": provider.name,
        })


class TopUpView(APIView):
    """POST top-up/ {amount} — add money to the wallet by mobile money. The customer pays the amount plus the provider's
    collection charge; the wallet receives the amount. Simulated: credited at once (201). Hubtel: a checkout to redirect
    to (200); the wallet is credited when HubtelWebhookView confirms the payment (once, however often it is told)."""

    permission_classes = [IsCustomer]

    def post(self, request):
        if not escrow.enabled():
            return ledger_off()
        data = request.data if isinstance(request.data, dict) else {}
        try:
            amount = parse_amount(data.get("amount"))
        except AmountError as exc:
            return Response({"amount": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        charge = get_provider().collection_charge(amount)
        if amount + charge > MAX_PESEWAS:
            return Response({"amount": "That amount is too large."}, status=status.HTTP_400_BAD_REQUEST)
        with transaction.atomic():
            result = process_payment(
                kind=CheckoutSession.WALLET_TOPUP, amount=from_pesewas(amount + charge), processing_fee=from_pesewas(charge),
                purpose="AshantiHub wallet top-up", customer=request.user,
                metadata={"credit_pesewas": amount, "ledger": True},
            )
        body = {
            "reference": result["session"].reference, "amount": services.money(amount),
            "payment_processing": services.money(charge), "you_pay": services.money(amount + charge),
        }
        if result["mode"] == "redirect":
            return Response({**body, "mode": "redirect", "checkout_url": result["checkout_url"]}, status=status.HTTP_200_OK)
        return Response({**body, "mode": "immediate", **services.summary(request.user)}, status=status.HTTP_201_CREATED)
```

`backend/wallets/urls.py`:

```python
from django.urls import path

from . import views

urlpatterns = [
    path("", views.WalletView.as_view(), name="wallet"),
    path("transactions/", views.TransactionsView.as_view(), name="wallet-transactions"),
    path("processing/", views.ProcessingView.as_view(), name="wallet-processing"),
    path("top-up/", views.TopUpView.as_view(), name="wallet-top-up"),
]
```

- [ ] **Step 6: The top-up finalizer** — in `backend/payments/services.py`, (a) replace

```python
def _finalize_event_pay(session):
```

with

```python
def _finalize_wallet_topup(session):
    """A paid top-up credits the customer's wallet (wallets.services.record_top_up; idempotent on the reference, so a
    retried webhook credits once)."""
    from wallets.services import record_top_up

    record_top_up(session)


def _finalize_event_pay(session):
```

and (b) replace

```python
    CheckoutSession.BOOKING: _finalize_booking,
}
```

with

```python
    CheckoutSession.BOOKING: _finalize_booking,
    CheckoutSession.WALLET_TOPUP: _finalize_wallet_topup,
}
```

- [ ] **Step 7: Run the tests**

Run: `docker compose -p wal1 run --rm web python manage.py test wallets payments core.tests.test_background_jobs --noinput`
Expected: PASS (10 new tests; the payments and background-job tests unchanged).

- [ ] **Step 8: Commit**

```bash
git add backend/wallets backend/ashantihub/settings.py backend/ashantihub/urls.py backend/payments/services.py
git commit -m "feat(wallets): wallet API - top-up by MoMo, balances, statement, payment-processing quote"
```

---

### Task 5: The refund engine

**Files:**
- Create: `backend/ledger/refunds.py`, `backend/ledger/tests/test_refunds.py`

**Interfaces:**
- Consumes: `posting.post`, `posting.account_for`, `posting.balance_of` (Task 2), `OrderFeeSnapshot.refunded_base_pesewas/refunded_fee_pesewas`, `OrderRefund` (Task 2), `escrow.enabled()`, `escrow.pay_key(order)`, `escrow.release_key(order)` (Stage 1), `CheckoutSession.processing_fee` (Task 3), `marketing.waivers.reverse_for_order(order, reason)`.
- Produces (module `ledger.refunds`):
  - `RefundError(message, status_code=400)` with `.message`, `.status_code`
  - `Left(customer, delivery, subsidy, processing)` (frozen dataclass, pesewas); `left(order) -> Left`; `processing_paid(order) -> int`
  - `refund_key(order, source) -> "order-refund-<order>-<source>"`
  - `allocate(amount, rooms) -> dict` (largest remainder), `fee_share(snapshot, refunded_base) -> int` (half up, cumulative)
  - `refund_order(order, amount_pesewas=None, *, source, by=None, owner_ids=None, refund_processing=False, note="", now=None) -> OrderRefund | None`
  - journal kind `"order_refund"`

- [ ] **Step 1: Write the failing test** — `backend/ledger/tests/test_refunds.py`

```python
"""Refunds into the customer's wallet (wallets plan 3a, Task 5). Review Focus 3 (a line refunded twice, or more than was
paid) and 4 (partial-refund fee rounding)."""
from decimal import Decimal

from django.test import SimpleTestCase, override_settings

from ledger import escrow, fees, posting, refunds
from ledger.models import Account, FulfilmentCheck, Journal, OrderFeeSnapshot, OrderRefund
from payments.models import CheckoutSession

from .test_order_payment import OrderPaymentBase


class RefundBase(OrderPaymentBase):
    def paid(self, lines, *, delivery=None, discount="0.00"):
        order = self.order(lines, delivery=delivery, discount=discount)
        escrow.record_order_payment(order)
        return order

    def release(self, order):
        FulfilmentCheck.objects.create(order=order, outcome=FulfilmentCheck.MATCHES)
        journal = escrow.release_verified(order)
        self.assertIsNotNone(journal)
        return journal

    def wallet(self):
        return posting.balance_of(Account.CUSTOMER_WALLET, self.customer)

    def snap(self, order, owner):
        return OrderFeeSnapshot.objects.get(order=order, business_owner=owner)


@override_settings(LEDGER_ENABLED=True)
class RefundTests(RefundBase):
    def test_a_whole_refund_before_release_returns_everything_and_frees_the_cap(self):
        kofi = self.owner("Kofi")
        order = self.paid([(self.listing(kofi, "60.00"), 2)], delivery="10.00")          # items 120.00 + delivery 10.00
        refund = refunds.refund_order(order, source="cancel")
        self.assertTrue(refund.whole)
        self.assertEqual((refund.amount_pesewas, refund.items_pesewas, refund.delivery_pesewas), (13000, 12000, 1000))
        self.assertEqual(refund.journal.key, f"order-refund-{order.pk}-cancel")
        self.assertEqual(self.wallet(), 13000)
        self.assertEqual(self.balance(Account.VENDOR_PENDING, kofi), 0)
        self.assertEqual(self.balance(Account.DELIVERY_PAYABLE, order), 0)
        snap = self.snap(order, kofi)
        self.assertEqual((snap.refunded_base_pesewas, snap.refunded_fee_pesewas), (12000, 500))
        self.assertIsNotNone(snap.reversed_at)
        self.assertEqual(fees.charged_to_date(kofi), 0)

    def test_a_partial_refund_is_shared_by_what_is_left_of_each_line(self):
        kofi, esi = self.owner("Kofi"), self.owner("Esi")
        order = self.paid([(self.listing(kofi, "60.00"), 1), (self.listing(esi, "600.00"), 1)])   # bases 6000 and 60000
        refund = refunds.refund_order(order, 3300, source="dispute-1")
        self.assertFalse(refund.whole)
        self.assertEqual(self.wallet(), 3300)
        self.assertEqual(self.balance(Account.VENDOR_PENDING, kofi), 5700)                # 300 of Kofi's 6000
        self.assertEqual(self.balance(Account.VENDOR_PENDING, esi), 57000)                # 3000 of Esi's 60000
        kofi_snap, esi_snap = self.snap(order, kofi), self.snap(order, esi)
        self.assertEqual((kofi_snap.refunded_base_pesewas, kofi_snap.refunded_fee_pesewas), (300, 3))     # fee 60 x 300/6000
        self.assertEqual((esi_snap.refunded_base_pesewas, esi_snap.refunded_fee_pesewas), (3000, 30))    # fee 600 x 3000/60000
        self.assertIsNone(esi_snap.reversed_at)
        self.assertEqual(fees.charged_to_date(esi), 570)

    def test_review_focus_fee_returned_in_parts_adds_up_to_the_fee_taken(self):
        kofi = self.owner("Kofi")
        order = self.paid([(self.listing(kofi, "100.00"), 1)])                           # GH₵ 5.00 flat fee
        self.release(order)
        self.assertEqual(self.balance(Account.VENDOR_AVAILABLE, kofi), 9500)
        returned = []
        for source, amount in (("dispute-1", 3333), ("dispute-2", 3333), ("dispute-3", 3334)):
            refunds.refund_order(order, amount, source=source)
            returned.append(self.snap(order, kofi).refunded_fee_pesewas)
        self.assertEqual(returned, [167, 333, 500])                                         # 1.67 + 1.66 + 1.67
        self.assertEqual(self.balance(Account.PLATFORM_FEE_INCOME), 0)
        self.assertEqual(self.balance(Account.VENDOR_AVAILABLE, kofi), 0)
        self.assertEqual(self.wallet(), 10000)
        self.assertIsNotNone(self.snap(order, kofi).reversed_at)

    def test_a_refund_after_release_may_drive_available_below_zero(self):
        kofi = self.owner("Kofi")
        order = self.paid([(self.listing(kofi, "60.00"), 2)], delivery="10.00")
        self.release(order)                                                                   # Available 11500, delivery income 1000
        available = posting.account_for(Account.VENDOR_AVAILABLE, kofi)
        posting.post(key="spent", kind="test", lines=[
            posting.debit(available, 11000), posting.credit(posting.account_for(Account.WITHDRAWAL_IN_TRANSIT), 11000),
        ])
        refunds.refund_order(order, source="dispute-9")                                      # whole: 130.00 back
        self.assertEqual(self.wallet(), 13000)
        self.assertEqual(self.balance(Account.VENDOR_AVAILABLE, kofi), -11000)               # 500 - 12000 + 500 fee returned
        self.assertEqual(self.balance(Account.PLATFORM_FEE_INCOME), 0)
        self.assertEqual(self.balance(Account.PLATFORM_DELIVERY_INCOME), 0)

    def test_a_coupon_goes_back_to_ashantihub_only_when_the_order_is_emptied(self):
        kofi = self.owner("Kofi")
        order = self.paid([(self.listing(kofi, "100.00"), 1)], discount="10.00")            # the customer paid 90.00
        refunds.refund_order(order, 4500, source="dispute-1")
        self.assertEqual((self.wallet(), self.balance(Account.PLATFORM_PROMO_SUBSIDY)), (4500, 1000))
        last = refunds.refund_order(order, source="cancel")
        self.assertEqual((last.whole, last.amount_pesewas, last.subsidy_pesewas, last.items_pesewas), (True, 4500, 1000, 5500))
        self.assertEqual((self.wallet(), self.balance(Account.PLATFORM_PROMO_SUBSIDY)), (9000, 0))   # never more than was paid
        self.assertEqual(self.balance(Account.VENDOR_PENDING, kofi), 0)
        with self.assertRaises(refunds.RefundError):
            refunds.refund_order(order, 1, source="dispute-2")

    def test_review_focus_more_than_is_left_is_refused_and_writes_nothing(self):
        kofi = self.owner("Kofi")
        order = self.paid([(self.listing(kofi, "60.00"), 1)])
        with self.assertRaises(refunds.RefundError) as caught:
            refunds.refund_order(order, 6001, source="dispute-1")
        self.assertEqual(caught.exception.message, "Only GH₵ 60.00 of this order can still be refunded.")
        for bad in (0, -1, True, 1.5):
            with self.assertRaises(refunds.RefundError, msg=repr(bad)):
                refunds.refund_order(order, bad, source="dispute-1")
        self.assertFalse(OrderRefund.objects.exists())
        self.assertEqual(self.wallet(), 0)
        self.assertEqual(self.balance(Account.VENDOR_PENDING, kofi), 6000)

    def test_the_delivery_fee_comes_back_only_with_the_whole_order(self):
        kofi = self.owner("Kofi")
        order = self.paid([(self.listing(kofi, "60.00"), 1)], delivery="10.00")              # paid 70.00
        with self.assertRaises(refunds.RefundError) as caught:
            refunds.refund_order(order, 6500, source="dispute-1")
        self.assertEqual(
            caught.exception.message,
            "The items left are worth GH₵ 60.00. The delivery fee comes back only with the whole order: GH₵ 70.00.",
        )
        refund = refunds.refund_order(order, 7000, source="dispute-1")
        self.assertEqual((refund.whole, refund.delivery_pesewas), (True, 1000))
        self.assertEqual(self.balance(Account.DELIVERY_PAYABLE, order), 0)

    def test_review_focus_the_same_source_refunds_once(self):
        kofi = self.owner("Kofi")
        order = self.paid([(self.listing(kofi, "60.00"), 1)])
        first = refunds.refund_order(order, 2000, source="dispute-1")
        again = refunds.refund_order(order, 2000, source="dispute-1")
        self.assertEqual(first.pk, again.pk)
        self.assertEqual(self.wallet(), 2000)
        self.assertEqual(Journal.objects.filter(kind="order_refund").count(), 1)

    def test_review_focus_a_scoped_refund_takes_only_that_vendors_lines(self):
        kofi, esi = self.owner("Kofi"), self.owner("Esi")
        order = self.paid([(self.listing(kofi, "60.00"), 1), (self.listing(esi, "40.00"), 1)], delivery="10.00")
        with self.assertRaises(refunds.RefundError):
            refunds.refund_order(order, 4001, source="dispute-1", owner_ids={esi.pk})          # more than Esi's lines
        refund = refunds.refund_order(order, 4000, source="dispute-1", owner_ids={esi.pk})
        self.assertEqual((refund.whole, refund.delivery_pesewas), (False, 0))
        self.assertEqual(self.balance(Account.VENDOR_PENDING, esi), 0)
        self.assertEqual(self.balance(Account.VENDOR_PENDING, kofi), 6000)
        self.assertEqual(self.balance(Account.DELIVERY_PAYABLE, order), 1000)                # never the delivery fee
        self.assertIsNotNone(self.snap(order, esi).reversed_at)
        self.assertEqual(self.wallet(), 4000)

    def test_the_processing_charge_comes_back_only_when_asked_and_only_once(self):
        kofi = self.owner("Kofi")
        order = self.paid([(self.listing(kofi, "60.00"), 1)])
        CheckoutSession.objects.create(
            customer=self.customer, kind=CheckoutSession.ORDER_CHECKOUT, amount=Decimal("61.20"), processing_fee=Decimal("1.20"),
            purpose="Order", status=CheckoutSession.SUCCESS, metadata={"order_id": order.pk},
        )
        refunds.refund_order(order, 1000, source="dispute-1")
        self.assertEqual(self.wallet(), 1000)
        refund = refunds.refund_order(order, 1000, source="dispute-2", refund_processing=True)
        self.assertEqual(refund.processing_pesewas, 120)
        self.assertEqual(self.wallet(), 2120)
        self.assertEqual(self.balance(Account.PROVIDER_FEES), 120)                            # AshantiHub bears it
        refunds.refund_order(order, source="cancel", refund_processing=True)
        self.assertEqual(self.wallet(), 6120)                                                  # the rest, without the charge again


class RefundGateTests(RefundBase):
    def test_nothing_happens_while_the_ledger_is_off(self):
        kofi = self.owner("Kofi")
        order = self.order([(self.listing(kofi, "60.00"), 1)])
        self.assertIsNone(refunds.refund_order(order, source="cancel"))
        self.assertFalse(Account.objects.exists())

    @override_settings(LEDGER_ENABLED=True)
    def test_an_order_paid_before_the_ledger_was_on_is_left_alone(self):
        kofi = self.owner("Kofi")
        order = self.order([(self.listing(kofi, "60.00"), 1)])                                # no payment journal
        self.assertIsNone(refunds.refund_order(order, source="cancel"))
        self.assertFalse(OrderRefund.objects.exists())

    @override_settings(LEDGER_ENABLED=True)
    def test_an_order_already_refunded_whole_gives_nothing_more(self):
        kofi = self.owner("Kofi")
        order = self.paid([(self.listing(kofi, "60.00"), 1)])
        refunds.refund_order(order, source="dispute-1")
        self.assertIsNone(refunds.refund_order(order, source="cancel"))
        self.assertEqual(OrderRefund.objects.count(), 1)
        self.assertEqual(self.wallet(), 6000)


class AllocateTests(SimpleTestCase):
    def test_largest_remainders_ties_to_the_earlier_and_never_beyond_a_room(self):
        self.assertEqual(refunds.allocate(100, [("a", 50), ("b", 50), ("c", 50)]), {"a": 34, "b": 33, "c": 33})
        self.assertEqual(refunds.allocate(5, [("a", 0), ("b", 5)]), {"a": 0, "b": 5})
        self.assertEqual(refunds.allocate(0, [("a", 7)]), {"a": 0})
```

- [ ] **Step 2: Run it to see it fail**

Run: `docker compose -p wal1 run --rm web python manage.py test ledger.tests.test_refunds --noinput`
Expected: ERROR — `ImportError: cannot import name 'refunds' from 'ledger'`.

- [ ] **Step 3: Write the engine** — `backend/ledger/refunds.py`

```python
"""Giving a customer money back for a paid product order (spec §2.2 steps 3-4, §5; §13 Stage 3 carry-forward).

A refund always goes to the customer's AshantiHub wallet and is recorded as an `OrderRefund`, one per order and source
(so the same request can never refund twice), with one journal `order-refund-<order>-<source>`:

* Before release the vendor's share comes back out of Vendor Pending, the delivery fee out of the order's Delivery
  payable. After release it comes out of Vendor Available (which may go negative; later sales recover it), the platform
  fee taken at release is returned in proportion (Dr platform fee income, Cr Vendor Available), and a delivery fee
  already taken as platform delivery income comes back from there.
* Fees are snapshotted per (order, vendor, category). A refund raises the snapshot's `refunded_base_pesewas` and
  `refunded_fee_pesewas`; the fee share is cumulative and rounded half up, so the fee given back never exceeds the fee
  taken and reaches it exactly when the whole base is refunded. That frees the lifetime cap (fees.charged_to_date), and
  release pays only what is left. A snapshot refunded in full gets `reversed_at`.
* A partial refund of R comes out of the item lines in proportion to what is left of each (largest remainder); the
  customer gets R. The delivery fee comes back only with the whole order, so no part of it is ever left held with no
  way out. The refund that empties the order ("whole") also returns the rest of any coupon to AshantiHub (Cr promo
  subsidy), so the customer never gets back more than they paid.
* The provider's collection charge ("payment processing") is not refunded, except when staff say AshantiHub or a vendor
  was at fault (`refund_processing=True`): AshantiHub then bears it (Dr provider fees, Cr wallet).

Callers: Support's cancel (orders.support), the uncollected-pickup job (ledger.verification), dispute resolution
(disputes.views) and the delivery-case refund approval (delivery.config). Lock order: the order row, its fee
snapshots, then the accounts in primary-key order (inside posting.post)."""
from dataclasses import dataclass

from django.db import transaction
from django.db.models import Sum
from django.utils import timezone

from . import escrow, posting
from .models import Account, Journal, OrderFeeSnapshot, OrderRefund
from .money import from_pesewas, to_pesewas


class RefundError(Exception):
    def __init__(self, message, status_code=400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


@dataclass(frozen=True)
class Left:
    """What can still be refunded on an order, in pesewas."""

    customer: int
    delivery: int
    subsidy: int
    processing: int


def refund_key(order, source):
    return f"order-refund-{order.pk}-{source}"


def processing_paid(order):
    """The collection charge the customer paid on top for this order (0 for a wallet payment or none recorded)."""
    from payments.models import CheckoutSession

    session = CheckoutSession.objects.filter(
        kind=CheckoutSession.ORDER_CHECKOUT, metadata__order_id=order.pk, status=CheckoutSession.SUCCESS,
    ).first()
    return to_pesewas(session.processing_fee) if session is not None else 0


def left(order):
    done = OrderRefund.objects.filter(order=order).aggregate(
        customer=Sum("amount_pesewas"), delivery=Sum("delivery_pesewas"), subsidy=Sum("subsidy_pesewas"),
        processing=Sum("processing_pesewas"),
    )
    return Left(
        customer=to_pesewas(order.total_amount) - (done["customer"] or 0),
        delivery=to_pesewas(order.delivery_fee or 0) - (done["delivery"] or 0),
        subsidy=to_pesewas(order.discount_amount or 0) - (done["subsidy"] or 0),
        processing=processing_paid(order) - (done["processing"] or 0),
    )


def allocate(amount, rooms):
    """Split `amount` over [(key, room)] in proportion to each room: floor shares, then the pesewas left over to the
    largest remainders (ties to the earlier key). Every share stays within its room; `amount` must not exceed the rooms'
    total."""
    total = sum(room for _, room in rooms)
    if amount <= 0 or total <= 0:
        return {key: 0 for key, _ in rooms}
    shares = {key: amount * room // total for key, room in rooms}
    spare = amount - sum(shares.values())
    by_remainder = sorted(range(len(rooms)), key=lambda i: (-(amount * rooms[i][1] % total), i))
    for i in by_remainder[:spare]:
        shares[rooms[i][0]] += 1
    return shares


def fee_share(snapshot, refunded_base):
    """The part of the snapshot's charged fee that belongs to `refunded_base` pesewas of its base, rounded half up."""
    if refunded_base >= snapshot.base_pesewas:
        return snapshot.charged_pesewas
    return (2 * snapshot.charged_pesewas * refunded_base + snapshot.base_pesewas) // (2 * snapshot.base_pesewas)


def _check_amount(amount_pesewas):
    if amount_pesewas is None:
        return
    if isinstance(amount_pesewas, bool) or not isinstance(amount_pesewas, int) or amount_pesewas <= 0:
        raise RefundError("The refund must be more than GH₵ 0.00.")


def refund_order(order, amount_pesewas=None, *, source, by=None, owner_ids=None, refund_processing=False, note="", now=None):
    """Refund `amount_pesewas` of `order` to the customer's wallet (None: everything still refundable in the scope).
    `owner_ids` limits it to those vendors' lines (a shop that could not hand over): never the delivery fee or the
    coupon. Returns the OrderRefund (the existing one when this source already refunded), or None while the ledger is
    off, when the order's payment was never recorded in the ledger (paid before it was on), or when nothing is left.
    Raises RefundError, writing nothing, for an amount it cannot give."""
    from orders.models import Order

    if not escrow.enabled():
        return None
    if not source or len(refund_key(order, source)) > 120:
        raise ValueError(f"Bad refund source {source!r}")
    _check_amount(amount_pesewas)
    now = now or timezone.now()
    with transaction.atomic():
        order = Order.objects.select_for_update(of=("self",)).get(pk=order.pk)
        existing = OrderRefund.objects.filter(order=order, source=source).first()
        if existing is not None:
            return existing
        if not Journal.objects.filter(key=escrow.pay_key(order)).exists():
            return None
        remaining = left(order)
        snapshots = list(
            OrderFeeSnapshot.objects.select_for_update(of=("self",))
            .filter(order=order, reversed_at__isnull=True).select_related("business_owner").order_by("pk")
        )
        if owner_ids is not None:
            wanted = set(owner_ids)
            snapshots = [snap for snap in snapshots if snap.business_owner_id in wanted]
        rooms = [(snap.pk, snap.base_pesewas - snap.refunded_base_pesewas) for snap in snapshots]
        items_room = sum(room for _, room in rooms)
        processing = remaining.processing if refund_processing else 0
        whole = owner_ids is None and (amount_pesewas is None or amount_pesewas == remaining.customer)
        if whole:
            if not (remaining.customer or remaining.delivery or remaining.subsidy or items_room or processing):
                return None
            customer, delivery, subsidy, shares = remaining.customer, remaining.delivery, remaining.subsidy, dict(rooms)
        else:
            customer = items_room if amount_pesewas is None else amount_pesewas
            if customer > remaining.customer:
                raise RefundError(f"Only GH₵ {from_pesewas(remaining.customer)} of this order can still be refunded.")
            if owner_ids is not None and customer > items_room:
                raise RefundError(f"Only GH₵ {from_pesewas(items_room)} of those items can still be refunded.")
            if customer > items_room:
                raise RefundError(
                    f"The items left are worth GH₵ {from_pesewas(items_room)}. The delivery fee comes back only with the "
                    f"whole order: GH₵ {from_pesewas(remaining.customer)}."
                )
            if customer <= 0:
                raise RefundError("Nothing is left to refund on those items.")
            delivery, subsidy, shares = 0, 0, allocate(customer, rooms)
        refund = _post(
            order, snapshots, shares, customer=customer, delivery=delivery, subsidy=subsidy, processing=processing,
            whole=whole, source=source, by=by, note=note, now=now,
        )
        if whole:
            from marketing.waivers import reverse_for_order

            reverse_for_order(order, "order_refunded")
        return refund


def _post(order, snapshots, shares, *, customer, delivery, subsidy, processing, whole, source, by, note, now):
    released = Journal.objects.filter(key=escrow.release_key(order)).exists()
    by_vendor, allocation = {}, []
    for snap in snapshots:
        base = shares.get(snap.pk, 0)
        if base <= 0 and not whole:
            continue
        after = snap.refunded_base_pesewas + base
        fee_after = fee_share(snap, after)
        fee = fee_after - snap.refunded_fee_pesewas
        entry = by_vendor.setdefault(snap.business_owner_id, {"owner": snap.business_owner, "pending": 0, "available": 0, "fee": 0})
        if snap.released_at is None:
            entry["pending"] += base          # the fee was never taken: release will simply charge less
        else:
            entry["available"] += base
            entry["fee"] += fee
        allocation.append({
            "snapshot": snap.pk, "business_owner": snap.business_owner_id, "category": snap.category,
            "base": base, "fee": fee, "released": snap.released_at is not None,
        })
        snap.refunded_base_pesewas, snap.refunded_fee_pesewas = after, fee_after
        if after >= snap.base_pesewas:
            snap.reversed_at = now
        snap.save(update_fields=["refunded_base_pesewas", "refunded_fee_pesewas", "reversed_at"])

    debits, credits = [], []
    for vendor_id in sorted(by_vendor):
        entry = by_vendor[vendor_id]
        if entry["pending"]:
            debits.append(posting.debit(posting.account_for(Account.VENDOR_PENDING, entry["owner"]), entry["pending"]))
        if entry["available"]:
            debits.append(posting.debit(posting.account_for(Account.VENDOR_AVAILABLE, entry["owner"]), entry["available"]))
        if entry["fee"]:
            debits.append(posting.debit(posting.account_for(Account.PLATFORM_FEE_INCOME), entry["fee"]))
            credits.append(posting.credit(posting.account_for(Account.VENDOR_AVAILABLE, entry["owner"]), entry["fee"]))
    if delivery:
        holder = (
            posting.account_for(Account.PLATFORM_DELIVERY_INCOME) if released
            else posting.account_for(Account.DELIVERY_PAYABLE, order)
        )
        debits.append(posting.debit(holder, delivery))
    if processing:
        debits.append(posting.debit(posting.account_for(Account.PROVIDER_FEES), processing))
    if subsidy:
        credits.append(posting.credit(posting.account_for(Account.PLATFORM_PROMO_SUBSIDY), subsidy))
    if customer + processing:
        credits.append(posting.credit(posting.account_for(Account.CUSTOMER_WALLET, order.customer), customer + processing))
    journal = None
    if len(debits) + len(credits) >= 2:
        journal = posting.post(
            key=refund_key(order, source), kind="order_refund", lines=debits + credits,
            reference_type="orders.order", reference_id=str(order.pk), memo=f"Refund for order #{order.pk} ({source})",
        )
    items = sum(entry["pending"] + entry["available"] for entry in by_vendor.values())
    return OrderRefund.objects.create(
        order=order, source=source, whole=whole, amount_pesewas=customer, items_pesewas=items, delivery_pesewas=delivery,
        subsidy_pesewas=subsidy, processing_pesewas=processing, allocation=allocation, journal=journal, created_by=by,
        note=(note or "")[:300],
    )
```

- [ ] **Step 4: Run the tests**

Run: `docker compose -p wal1 run --rm web python manage.py test ledger.tests.test_refunds --noinput`
Expected: PASS (14 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/ledger/refunds.py backend/ledger/tests/test_refunds.py
git commit -m "feat(ledger): refunds into the customer's wallet, per fee snapshot, freeing the cap"
```

---

### Task 6: Release pays only what refunds left; the waived delivery fee reaches the ledger

**Files:**
- Modify: `backend/ledger/escrow.py` (`release_verified`; new `waiver_key`, `waiver_return_key`, `charge_waiver`, `return_waiver`), `backend/ledger/refunds.py` (a whole refund gives the waiver back), `backend/ledger/verification.py` (`awaiting` leaves out fully refunded orders)
- Create: `backend/ledger/tests/test_release_after_refund.py`

**Interfaces:**
- Consumes: `refunds.refund_order` (Task 5), `posting.balance_of` (Task 2), `marketing.models_waivers.WaivedFeeCharge` (`OWED`, `REVERSED`, `amount`, `business_owner`).
- Produces:
  - `escrow.release_verified(order, now=None)` — unchanged signature; returns None for an order whose status is not `paid`; pays per snapshot `base − refunded_base` to Pending/Available and `charged − refunded_fee` to fee income; releases the order's Delivery payable **balance**; then calls `charge_waiver(order)`
  - `escrow.waiver_key(order) -> "order-waiver-<order>"`, `escrow.waiver_return_key(order) -> "order-waiver-return-<order>"`
  - `escrow.charge_waiver(order) -> Journal | None` (kind `"order_waiver_charge"`), `escrow.return_waiver(order) -> Journal | None` (kind `"order_waiver_return"`)
  - `verification.awaiting()` lists only orders with a snapshot neither released nor reversed

- [ ] **Step 1: Write the failing test** — `backend/ledger/tests/test_release_after_refund.py`

```python
"""Release after refunds (wallets plan 3a, Task 6; spec §13 "Stage 3 carry-forward"). Review Focus 5: a refund then
Support's "matches" pays the vendor only what is left, and a cancelled order is never released. Also: the waived
delivery fee is charged to the business at release and given back on a whole refund."""
from datetime import timedelta
from decimal import Decimal

from django.test import override_settings
from django.utils import timezone

from ledger import escrow, refunds, verification
from ledger.models import Account, FulfilmentCheck, Journal
from marketing.models_waivers import DeliveryWaiver, WaivedFeeCharge
from orders.models import DeliveryAssignment, Order

from .test_refunds import RefundBase


@override_settings(LEDGER_ENABLED=True)
class ReleaseAfterRefundTests(RefundBase):
    def test_review_focus_a_refund_then_matches_pays_only_the_rest(self):
        kofi, esi = self.owner("Kofi"), self.owner("Esi")
        order = self.paid([(self.listing(kofi, "60.00"), 1), (self.listing(esi, "600.00"), 1)], delivery="10.00")
        refunds.refund_order(order, 6000, source="dispute-1", owner_ids={kofi.pk})        # Kofi's shop could not hand over
        refunds.refund_order(order, 30000, source="dispute-2", owner_ids={esi.pk})         # half of Esi's item went back
        self.release(order)
        self.assertEqual(self.balance(Account.VENDOR_PENDING, kofi), 0)
        self.assertEqual(self.balance(Account.VENDOR_AVAILABLE, kofi), 0)                 # nothing paid for refunded lines
        self.assertEqual(self.balance(Account.VENDOR_PENDING, esi), 0)
        self.assertEqual(self.balance(Account.VENDOR_AVAILABLE, esi), 29700)              # 30000 left, less the 300 of fee left
        self.assertEqual(self.balance(Account.PLATFORM_FEE_INCOME), 300)
        self.assertEqual(self.balance(Account.PLATFORM_DELIVERY_INCOME), 1000)
        self.assertEqual(self.wallet(), 36000)

    def test_review_focus_a_cancelled_order_is_never_released(self):
        kofi = self.owner("Kofi")
        order = self.paid([(self.listing(kofi, "60.00"), 1)])
        Order.objects.filter(pk=order.pk).update(status=Order.CANCELLED)
        FulfilmentCheck.objects.create(order=order, outcome=FulfilmentCheck.MATCHES)
        self.assertIsNone(escrow.release_verified(order))
        self.assertFalse(Journal.objects.filter(key=f"order-release-{order.pk}").exists())
        self.assertEqual(self.balance(Account.VENDOR_PENDING, kofi), 6000)

    def test_a_fully_refunded_order_leaves_supports_list(self):
        kofi = self.owner("Kofi")
        order = self.paid([(self.listing(kofi, "60.00"), 1)])
        order.delivery_method = Order.DOOR_TO_DOOR
        order.save(update_fields=["delivery_method"])
        DeliveryAssignment.objects.create(
            order=order, status=DeliveryAssignment.CONFIRMED, delivered_at=timezone.now(), confirmed_at=timezone.now(),
        )
        self.assertEqual([row["order_id"] for row in verification.awaiting()], [order.pk])
        refunds.refund_order(order, source="dispute-1")
        self.assertEqual(verification.awaiting(), [])

    def waived(self, owner, order, status=WaivedFeeCharge.OWED):
        now = timezone.now()
        waiver = DeliveryWaiver.objects.create(
            business_owner=owner, name="Free delivery week", starts_at=now - timedelta(days=1), ends_at=now + timedelta(days=1),
            status=DeliveryWaiver.ACTIVE,
        )
        return WaivedFeeCharge.objects.create(order=order, waiver=waiver, business_owner=owner, amount=Decimal("15.00"), status=status)

    def test_a_free_delivery_promo_is_charged_at_release_and_given_back_on_a_whole_refund(self):
        kofi = self.owner("Kofi")
        order = self.paid([(self.listing(kofi, "120.00"), 1)], delivery="0.00")             # the delivery fee was waived
        charge = self.waived(kofi, order)
        self.release(order)
        self.assertEqual(self.balance(Account.VENDOR_AVAILABLE, kofi), 10000)                # 12000 - 500 fee - 1500 promo
        self.assertEqual(self.balance(Account.PLATFORM_DELIVERY_INCOME), 1500)
        self.assertTrue(Journal.objects.filter(key=f"order-waiver-{order.pk}").exists())
        refunds.refund_order(order, source="dispute-1")                                       # the whole order goes back
        self.assertEqual(self.wallet(), 12000)                                                 # never the waived fee: it was never paid
        self.assertEqual(self.balance(Account.VENDOR_AVAILABLE, kofi), 0)
        self.assertEqual(self.balance(Account.PLATFORM_DELIVERY_INCOME), 0)
        self.assertTrue(Journal.objects.filter(key=f"order-waiver-return-{order.pk}").exists())
        charge.refresh_from_db()
        self.assertEqual(charge.status, WaivedFeeCharge.REVERSED)

    def test_a_reversed_promo_charge_is_never_taken(self):
        kofi = self.owner("Kofi")
        order = self.paid([(self.listing(kofi, "120.00"), 1)], delivery="0.00")
        self.waived(kofi, order, status=WaivedFeeCharge.REVERSED)
        self.release(order)
        self.assertFalse(Journal.objects.filter(key=f"order-waiver-{order.pk}").exists())
        self.assertEqual(self.balance(Account.VENDOR_AVAILABLE, kofi), 11500)
```

- [ ] **Step 2: Run it to see it fail**

Run: `docker compose -p wal1 run --rm web python manage.py test ledger.tests.test_release_after_refund --noinput`
Expected: FAIL — Esi's Available is 59400 (release paid the whole snapshot), the cancelled order is released, the refunded order stays on Support's list, and no `order-waiver-` journal exists.

- [ ] **Step 3: Release** — in `backend/ledger/escrow.py`, (a) replace

```python
from .models import Account, FulfilmentCheck, Journal, OrderFeeSnapshot
```

with

```python
from .models import Account, FulfilmentCheck, Journal, JournalLine, OrderFeeSnapshot
```

and (b) replace the whole `release_verified` function with

```python
def release_verified(order, now=None):
    """Release an order's held money to the vendor and the platform. Called when Support records a positive
    verification; there is no timer. Returns the journal, or None when the ledger is off, the order is no longer paid
    (cancelled), has no positive verification or an open dispute, or was already released.

    Refunds come first (ledger.refunds): each snapshot pays only the base and fee not yet refunded, a fully refunded one
    (reversed) pays nothing, and the delivery fee released is what the order's Delivery payable still holds. A business
    that waived the delivery fee through its free-delivery promo pays it from its Available right after (charge_waiver)."""
    from orders.models import Order

    if not enabled():
        return None
    now = now or timezone.now()
    with transaction.atomic():
        if Journal.objects.filter(key=release_key(order)).exists() or has_open_dispute(order):
            return None
        if not Order.objects.filter(pk=order.pk, status=Order.PAID).exists():
            return None
        if not FulfilmentCheck.objects.filter(order=order, outcome=FulfilmentCheck.MATCHES).exists():
            return None
        snapshots = list(
            OrderFeeSnapshot.objects.select_for_update(of=("self",))  # never lock the vendor's BusinessOwner row (deadlocks with a payment)
            .filter(order=order, released_at__isnull=True, reversed_at__isnull=True).select_related("business_owner")
        )
        if not snapshots or not Journal.objects.filter(key=pay_key(order)).exists():
            return None
        income = posting.account_for(Account.PLATFORM_FEE_INCOME)
        by_vendor = {}
        for snap in snapshots:
            entry = by_vendor.setdefault(snap.business_owner_id, {"owner": snap.business_owner, "base": 0, "fee": 0})
            entry["base"] += snap.base_pesewas - snap.refunded_base_pesewas
            entry["fee"] += snap.charged_pesewas - snap.refunded_fee_pesewas

        # The owner's order: AshantiHub first (fee, delivery), then each vendor, then any third-party rider (Stage 5).
        debits, credits = [], []
        for vendor_id in sorted(by_vendor):
            entry = by_vendor[vendor_id]
            if entry["base"] > 0:
                debits.append(posting.debit(posting.account_for(Account.VENDOR_PENDING, entry["owner"]), entry["base"]))
            if entry["fee"] > 0:
                credits.append(posting.credit(income, entry["fee"]))
        delivery = posting.balance_of(Account.DELIVERY_PAYABLE, order)
        if delivery > 0:
            debits.append(posting.debit(posting.account_for(Account.DELIVERY_PAYABLE, order), delivery))
            credits.append(posting.credit(posting.account_for(Account.PLATFORM_DELIVERY_INCOME), delivery))
        for vendor_id in sorted(by_vendor):
            entry = by_vendor[vendor_id]
            payable = entry["base"] - entry["fee"]
            if payable > 0:
                credits.append(posting.credit(posting.account_for(Account.VENDOR_AVAILABLE, entry["owner"]), payable))
        if len(debits) + len(credits) < 2:
            OrderFeeSnapshot.objects.filter(pk__in=[s.pk for s in snapshots]).update(released_at=now)
            return None  # nothing to post (every line was zero)
        journal = posting.post(
            key=release_key(order), kind="order_release", lines=debits + credits,
            reference_type="orders.order", reference_id=str(order.pk), memo=f"Release of order #{order.pk}",
        )
        OrderFeeSnapshot.objects.filter(pk__in=[s.pk for s in snapshots]).update(released_at=now)
        charge_waiver(order)
        return journal


# --- the business's free-delivery promo (marketing.WaivedFeeCharge; spec §13 Stage 3 carry-forward) -----------------

def waiver_key(order):
    return f"order-waiver-{order.pk}"


def waiver_return_key(order):
    return f"order-waiver-return-{order.pk}"


def charge_waiver(order):
    """A business that waived the delivery fee through its free-delivery promo pays it at release: Dr its Available
    (which may go negative), Cr platform delivery income. Only a charge still owed is taken (a cancel or a whole refund
    reverses it first); idempotent on the key. The customer never paid it, so no refund ever returns it to them."""
    from marketing.models_waivers import WaivedFeeCharge

    charge = WaivedFeeCharge.objects.filter(order=order, status=WaivedFeeCharge.OWED).select_related("business_owner").first()
    amount = to_pesewas(charge.amount) if charge is not None else 0
    if amount <= 0:
        return None
    return posting.post(
        key=waiver_key(order), kind="order_waiver_charge",
        lines=[
            posting.debit(posting.account_for(Account.VENDOR_AVAILABLE, charge.business_owner), amount),
            posting.credit(posting.account_for(Account.PLATFORM_DELIVERY_INCOME), amount),
        ],
        reference_type="orders.order", reference_id=str(order.pk), memo=f"Free-delivery promo on order #{order.pk}, paid by the business",
    )


def return_waiver(order):
    """Give a charged promo back to the business when the order is refunded whole (it owes nothing for a refunded order)."""
    line = JournalLine.objects.filter(journal__key=waiver_key(order), side=JournalLine.DEBIT).select_related("account").first()
    if line is None:
        return None
    return posting.post(
        key=waiver_return_key(order), kind="order_waiver_return",
        lines=[posting.debit(posting.account_for(Account.PLATFORM_DELIVERY_INCOME), line.amount), posting.credit(line.account, line.amount)],
        reference_type="orders.order", reference_id=str(order.pk), memo=f"Free-delivery promo on order #{order.pk} returned (order refunded)",
    )
```

- [ ] **Step 4: A whole refund gives the promo back** — in `backend/ledger/refunds.py` replace

```python
        if whole:
            from marketing.waivers import reverse_for_order

            reverse_for_order(order, "order_refunded")
        return refund
```

with

```python
        if whole:
            from marketing.waivers import reverse_for_order

            escrow.return_waiver(order)               # charged at release: the business owes nothing for a refunded order
            reverse_for_order(order, "order_refunded")
        return refund
```

- [ ] **Step 5: Support's list** — in `backend/ledger/verification.py` replace

```python
        Order.objects.filter(status=Order.PAID, fee_snapshots__released_at__isnull=True).distinct()
```

with

```python
        # A snapshot neither released nor refunded in full: a fully refunded order has nothing left to verify.
        Order.objects.filter(status=Order.PAID, fee_snapshots__released_at__isnull=True, fee_snapshots__reversed_at__isnull=True).distinct()
```

- [ ] **Step 6: Run the tests**

Run: `docker compose -p wal1 run --rm web python manage.py test ledger --noinput`
Expected: PASS — the 5 new tests and every existing ledger test (verification and pickup tests unchanged).

- [ ] **Step 7: Commit**

```bash
git add backend/ledger
git commit -m "feat(ledger): release pays only what refunds left, never a cancelled order; free-delivery promos reach the ledger"
```

---

### Task 7: Wire refunds into Support's cancel, dispute resolution and the delivery-case approval

**Files:**
- Modify: `backend/ledger/refunds.py` (`scope_for_dispute`), `backend/orders/support.py` (cancel refunds; `return_stock`), `backend/disputes/views.py` and `backend/disputes/serializers.py` (`DisputeResolveView`), `backend/delivery/config.py` (`refund_apply`, consequences)
- Create: `backend/ledger/tests/test_refund_wiring.py`

**Interfaces:**
- Consumes: `refunds.refund_order`, `refunds.RefundError` (Task 5), release after refunds (Task 6), `approvals.services.submit/approve/ApprovalError`, `delivery.models.DeliveryEvent.SKIPPED_STOP` / `PickupStop.business_owner`.
- Produces:
  - `refunds.scope_for_dispute(dispute) -> set[int] | None` — the business owners of the skipped stops whose `DeliveryEvent` names this dispute, else None (whole order)
  - `orders.support.return_stock(order)` (used by Task 8)
  - `SupportOrderStatusView._cancel(order, staff=None) -> OrderRefund | None` (`staff` defaults to None because `marketing/tests/test_waivers.py` calls `_cancel(order)`); `_tell_customer(order, note, refund=None)`
  - `DisputeResolveSerializer.refund_processing` (bool, default False); the resolve body gains `wallet_refund` (GH₵ string) when a refund was posted; `400 {"refund_amount": message}` when the ledger cannot give it (the decision is rolled back)
  - `delivery.config.refund_apply` posts the refund (source `dispute-<id>`) and raises `ApprovalError` when it cannot

- [ ] **Step 1: Write the failing test** — `backend/ledger/tests/test_refund_wiring.py`

```python
"""Refunds wired into the doors that already decide them (wallets plan 3a, Task 7): Support's cancel, dispute
resolution (Accountant, password again) and the delivery-case refund approval (Super Admin). Review Focus 5 and 7."""
from decimal import Decimal

from django.core.cache import cache
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.testing import make_staff, staff_token
from activity.models import ActivityEvent
from approvals import services as approvals
from approvals.models import ApprovalRequest
from delivery import config
from delivery.models import DeliveryEvent, PickupStop
from disputes.models import Dispute
from ledger import refunds
from ledger.models import Account, OrderFeeSnapshot, OrderRefund
from notifications.models import Notification
from orders.models import DeliveryAssignment, Order
from payments.models import CheckoutSession

from .test_refunds import RefundBase


class WiringBase(RefundBase):
    def setUp(self):
        super().setUp()
        cache.clear()
        self.client = APIClient()
        self.support = make_staff("support", "esi@example.com")
        self.accountant = make_staff("accountant", "kofi@example.com")
        self.boss = make_staff("super_admin", "boss@example.com")
        self.manager = make_staff("delivery_manager", "dm@example.com")

    def as_staff(self, staff, sudo=False):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(staff, sudo=sudo)}")

    def with_processing(self, order, fee="1.20"):
        CheckoutSession.objects.create(
            customer=self.customer, kind=CheckoutSession.ORDER_CHECKOUT, amount=order.total_amount + Decimal(fee),
            processing_fee=Decimal(fee), purpose="Order", status=CheckoutSession.SUCCESS, metadata={"order_id": order.pk},
        )

    def cancel(self, order):
        return self.client.post(
            f"/api/orders/{order.pk}/support-status/", {"status": "cancelled_by_customer", "reason": "Changed their mind"}, format="json",
        )

    def resolve(self, dispute, **body):
        return self.client.post(f"/api/disputes/{dispute.pk}/resolve/", body, format="json")

    def verify(self, order, outcome, **extra):
        return self.client.post(f"/api/ledger/orders/{order.pk}/verification/", {"outcome": outcome, **extra}, format="json")

    def dispute(self, order):
        return Dispute.objects.create(
            order=order, raised_by=self.customer, reason=Dispute.ORDER_ISSUE, description="Wrong colour", status=Dispute.INVESTIGATING,
        )

    def ask_refund(self, case, amount):
        return approvals.submit(
            self.manager, config.REFUND, title=f"Refund for case #{case.pk}", payload={"dispute_id": case.pk, "amount": amount}, target=case,
        )


@override_settings(LEDGER_ENABLED=True)
class SupportCancelTests(WiringBase):
    def test_cancelling_a_paid_order_refunds_it_whole_without_the_processing_charge(self):
        kofi = self.owner("Kofi")
        order = self.paid([(self.listing(kofi, "60.00"), 2)], delivery="10.00")
        self.with_processing(order)
        self.as_staff(self.support)
        response = self.cancel(order)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["status"], Order.CANCELLED)
        self.assertEqual(self.wallet(), 13000)                                                   # 130.00, not the 1.20 charge
        self.assertEqual(self.balance(Account.VENDOR_PENDING, kofi), 0)
        self.assertIsNotNone(OrderFeeSnapshot.objects.get(order=order).reversed_at)
        refund = OrderRefund.objects.get(order=order)
        self.assertEqual((refund.source, refund.created_by_id, refund.processing_pesewas), ("cancel", self.support.pk, 0))
        notice = Notification.objects.filter(customer=self.customer).latest("id")
        self.assertIn("GH₵ 130.00 went back to your AshantiHub wallet", notice.body)


@override_settings(LEDGER_ENABLED=True)
class DisputeRefundTests(WiringBase):
    def test_resolving_with_a_refund_amount_pays_it_into_the_wallet(self):
        kofi = self.owner("Kofi")
        order = self.paid([(self.listing(kofi, "60.00"), 2)], delivery="10.00")
        dispute = self.dispute(order)
        self.as_staff(self.accountant, sudo=True)
        response = self.resolve(dispute, refund_amount="40.00", resolution_notes="One item was wrong")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["wallet_refund"], "40.00")
        self.assertEqual(self.wallet(), 4000)
        self.assertEqual(OrderRefund.objects.get(order=order).source, f"dispute-{dispute.pk}")
        self.assertEqual(self.balance(Account.VENDOR_PENDING, kofi), 8000)

    def test_a_refund_the_ledger_cannot_give_leaves_the_dispute_undecided(self):
        kofi = self.owner("Kofi")
        order = self.paid([(self.listing(kofi, "60.00"), 2)], delivery="10.00")
        dispute = self.dispute(order)
        self.as_staff(self.accountant, sudo=True)
        response = self.resolve(dispute, refund_amount="500.00")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["refund_amount"], "Only GH₵ 130.00 of this order can still be refunded.")
        dispute.refresh_from_db()
        self.assertEqual((dispute.status, dispute.refund_amount), (Dispute.INVESTIGATING, None))
        self.assertEqual(self.wallet(), 0)

    def test_the_processing_charge_comes_back_when_the_accountant_says_so(self):
        kofi = self.owner("Kofi")
        order = self.paid([(self.listing(kofi, "60.00"), 1)])
        self.with_processing(order)
        self.as_staff(self.accountant, sudo=True)
        response = self.resolve(self.dispute(order), refund_amount="60.00", refund_processing=True)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["wallet_refund"], "61.20")
        self.assertEqual(self.wallet(), 6120)

    def test_review_focus_mismatch_money_back_then_matches_pays_the_rest(self):
        kofi = self.owner("Kofi")
        order = self.paid([(self.listing(kofi, "120.00"), 1)], delivery="10.00")
        order.delivery_method = Order.DOOR_TO_DOOR
        order.save(update_fields=["delivery_method"])
        DeliveryAssignment.objects.create(
            order=order, status=DeliveryAssignment.CONFIRMED, delivered_at=timezone.now(), confirmed_at=timezone.now(),
        )
        self.as_staff(self.support)
        self.assertEqual(self.verify(order, "does_not_match", note="Different colour").status_code, 200)
        dispute = Dispute.objects.get(order=order)
        self.as_staff(self.accountant, sudo=True)
        self.assertEqual(self.resolve(dispute, refund_amount="60.00").status_code, 200)
        self.as_staff(self.support)
        response = self.verify(order, "matches")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertTrue(response.json()["released"])
        self.assertEqual(self.balance(Account.VENDOR_AVAILABLE, kofi), 5750)                    # 6000 left less the 250 of fee left
        self.assertEqual(self.balance(Account.PLATFORM_FEE_INCOME), 250)
        self.assertEqual(self.balance(Account.PLATFORM_DELIVERY_INCOME), 1000)
        self.assertEqual(self.wallet(), 6000)


@override_settings(LEDGER_ENABLED=True)
class DeliveryCaseRefundTests(WiringBase):
    def skipped_case(self):
        self.kofi, self.esi = self.owner("Kofi"), self.owner("Esi")
        order = self.paid([(self.listing(self.kofi, "60.00"), 1), (self.listing(self.esi, "600.00"), 1)], delivery="10.00")
        self.with_processing(order, fee="13.40")
        assignment = DeliveryAssignment.objects.create(order=order, status=DeliveryAssignment.DELIVERED, delivered_at=timezone.now())
        case = Dispute.objects.create(
            order=order, reason=Dispute.DELIVERY_ISSUE, case_type=Dispute.NOT_RECEIVED, description="Esi's shop could not hand over",
            status=Dispute.RESOLVED, outcome="refund", fault="business", refund_amount=Decimal("600.00"),
        )
        stop = PickupStop.objects.create(assignment=assignment, sequence=2, business_owner=self.esi, status=PickupStop.SKIPPED)
        DeliveryEvent.objects.create(assignment=assignment, stop=stop, step=DeliveryEvent.SKIPPED_STOP, at=timezone.now(), dispute=case)
        return order, case

    def test_approving_a_skipped_shops_refund_pays_that_shops_lines_and_the_charge(self):
        order, case = self.skipped_case()
        self.assertEqual(refunds.scope_for_dispute(case), {self.esi.pk})
        approvals.approve(self.ask_refund(case, "600.00").pk, self.boss)
        self.assertEqual(self.wallet(), 61340)                                                    # Esi's 600.00 + the 13.40 charge (business at fault)
        self.assertEqual(self.balance(Account.VENDOR_PENDING, self.esi), 0)
        self.assertEqual(self.balance(Account.VENDOR_PENDING, self.kofi), 6000)
        self.assertEqual(OrderRefund.objects.get(order=order).source, f"dispute-{case.pk}")
        event = ActivityEvent.objects.filter(verb="delivery.refund_request_decided").latest("id")
        self.assertIn("returned to the customer's AshantiHub wallet", event.summary)

    def test_a_refund_beyond_the_shops_lines_leaves_the_request_pending(self):
        order, case = self.skipped_case()
        approval = self.ask_refund(case, "700.00")
        with self.assertRaises(approvals.ApprovalError):
            approvals.approve(approval.pk, self.boss)
        approval.refresh_from_db()
        self.assertEqual(approval.status, ApprovalRequest.PENDING)
        self.assertEqual(self.wallet(), 0)

    def test_a_dispute_is_never_refunded_twice_across_both_doors(self):
        order, case = self.skipped_case()
        approvals.approve(self.ask_refund(case, "600.00").pk, self.boss)
        refunds.refund_order(order, 60000, source=f"dispute-{case.pk}")                       # the same source again
        self.assertEqual(OrderRefund.objects.filter(order=order).count(), 1)
        self.assertEqual(self.wallet(), 61340)

    def test_a_case_without_a_skipped_stop_refunds_from_the_whole_order(self):
        kofi = self.owner("Kofi")
        order = self.paid([(self.listing(kofi, "60.00"), 1)])
        self.assertIsNone(refunds.scope_for_dispute(self.dispute(order)))


class LedgerOffWiringTests(WiringBase):
    def test_review_focus_with_the_ledger_off_cancel_dispute_and_approval_move_nothing(self):
        kofi = self.owner("Kofi")
        order = self.order([(self.listing(kofi, "60.00"), 1)])
        self.as_staff(self.support)
        self.assertEqual(self.cancel(order).status_code, 200)
        notice = Notification.objects.filter(customer=self.customer).latest("id")
        self.assertEqual(notice.body, f"Your order #{order.pk} was cancelled at your request. Contact AshantiHub Support with any question.")
        other = self.order([(self.listing(kofi, "60.00"), 1)])
        self.as_staff(self.accountant, sudo=True)
        response = self.resolve(self.dispute(other), refund_amount="20.00")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertNotIn("wallet_refund", response.json())
        case = Dispute.objects.create(
            order=other, reason=Dispute.DELIVERY_ISSUE, description="Not received", status=Dispute.RESOLVED, outcome="refund",
            fault="rider", refund_amount=Decimal("10.00"),
        )
        approvals.approve(self.ask_refund(case, "10.00").pk, self.boss)
        event = ActivityEvent.objects.filter(verb="delivery.refund_request_decided").latest("id")
        self.assertIn("recorded only; payments are simulated", event.summary)
        self.assertFalse(Account.objects.exists())
        self.assertFalse(OrderRefund.objects.exists())
```

- [ ] **Step 2: Run it to see it fail**

Run: `docker compose -p wal1 run --rm web python manage.py test ledger.tests.test_refund_wiring --noinput`
Expected: FAIL/ERROR — `AttributeError: module 'ledger.refunds' has no attribute 'scope_for_dispute'`, the wallet stays at 0 after a cancel or a resolve, and `wallet_refund` is missing.

- [ ] **Step 3: Which lines a dispute may refund** — append to `backend/ledger/refunds.py`

```python


def scope_for_dispute(dispute):
    """The vendors a dispute's refund may come from: the businesses whose stop a rider skipped and whose skip opened this
    case (that shop's lines only, delivery.services.open_case_for_skipped_stop), or None for the whole order."""
    from delivery.models import DeliveryEvent

    owners = set(
        DeliveryEvent.objects.filter(dispute=dispute, step=DeliveryEvent.SKIPPED_STOP, stop__isnull=False)
        .values_list("stop__business_owner_id", flat=True)
    )
    return owners or None
```

- [ ] **Step 4: Support's cancel** — four edits in `backend/orders/support.py`.

(a) Replace

```python
from accounts.phones import filter_by_phone, mask_phone, phone_key
```

with

```python
from accounts.phones import filter_by_phone, mask_phone, phone_key
from ledger.money import from_pesewas
```

(b) Replace

```python
def _base():
```

with

```python
def return_stock(order):
    """Put the stock an order reserved at checkout back on the shelf (tracked listings only)."""
    from listings.models import Listing

    for line in order.items.all():
        listing = Listing.objects.select_for_update().get(pk=line.listing_id)
        if listing.stock_quantity is not None:
            listing.stock_quantity += line.quantity
            listing.save(update_fields=["stock_quantity"])


def _base():
```

(c) Replace

```python
            if kind == OrderSupportNote.CANCELLED_BY_CUSTOMER:
                self._cancel(order)
        self._tell_customer(order, note)
```

with

```python
            refund = None
            if kind == OrderSupportNote.CANCELLED_BY_CUSTOMER:
                refund = self._cancel(order, request.user)
        self._tell_customer(order, note, refund)
```

(d) Replace the two static methods `_cancel` and `_tell_customer` (from `    @staticmethod\n    def _cancel(order):` to the end of the file) with

```python
    @staticmethod
    def _cancel(order, staff=None):
        """Cancel through the order's own fields: stock reserved at checkout goes
        back on the shelf (tracked listings only), a courier assignment not yet
        picked up is withdrawn. With the ledger on, a paid order's money goes back to
        the customer's AshantiHub wallet in full (ledger.refunds; the payment-processing
        charge stays with the provider, because the customer asked to cancel). Returns
        that OrderRefund, or None (ledger off, not paid, or paid before the ledger was on)."""
        return_stock(order)
        assignment = getattr(order, "delivery_assignment", None)
        if assignment is not None:
            assignment.delete()
        order.status = Order.CANCELLED
        order.save(update_fields=["status"])
        from marketing.waivers import reverse_for_order

        reverse_for_order(order, "order_cancelled")
        from ledger import refunds

        return refunds.refund_order(order, source="cancel", by=staff, note="Cancelled at the customer's request")

    @staticmethod
    def _tell_customer(order, note, refund=None):
        if note.kind == OrderSupportNote.RUNNING_LATE:
            title = "Your order is running late"
            body = f"Your order #{order.pk} is running late. New expected time: {note.expected_time}. Sorry for the wait."
        else:
            title = "Your order was cancelled"
            body = f"Your order #{order.pk} was cancelled at your request. Contact AshantiHub Support with any question."
            if refund is not None and refund.amount_pesewas > 0:
                body = (
                    f"Your order #{order.pk} was cancelled at your request. GH₵ {from_pesewas(refund.amount_pesewas)} went back "
                    "to your AshantiHub wallet. Contact AshantiHub Support with any question."
                )
        notify_customer(order.customer, "order_status", title, body=body, link="/my-account", icon="🚚")
        if order.customer.email:
            _send(f"{title} (order #{order.pk})", body, order.customer.email)
```

- [ ] **Step 5: Dispute resolution** — (a) in `backend/disputes/serializers.py` replace

```python
    resolution_notes = serializers.CharField(required=False, allow_blank=True, default="")


class DisputeEvidenceSerializer(serializers.ModelSerializer):
```

with

```python
    resolution_notes = serializers.CharField(required=False, allow_blank=True, default="")
    # With the ledger on: also give back the payment-processing charge, because AshantiHub or the business was at fault.
    refund_processing = serializers.BooleanField(required=False, default=False)


class DisputeEvidenceSerializer(serializers.ModelSerializer):
```

(b) in `backend/disputes/views.py` replace the whole `post` method of `DisputeResolveView` (from `    def post(self, request, pk):\n        serializer = DisputeResolveSerializer(data=request.data)` to `        return Response(DisputeSerializer(dispute).data)`) with

```python
    def post(self, request, pk):
        serializer = DisputeResolveSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        refund = None
        # Two staff resolving at once must not both book a refund: lock the row.
        with transaction.atomic():
            dispute = generics.get_object_or_404(Dispute.objects.select_for_update(), pk=pk)
            if dispute.status in Dispute.FINAL_STATUSES:
                return Response({"detail": "This dispute has already been resolved."}, status=400)
            dispute.status = Dispute.RESOLVED if data["outcome"] == "resolved" else Dispute.REJECTED
            # A rejected dispute never moves money: drop any refund_amount sent
            # with outcome="rejected" so a Rejected row can't show a refund.
            dispute.refund_amount = data.get("refund_amount") if data["outcome"] == "resolved" else None
            dispute.resolution_notes = data.get("resolution_notes", "")
            dispute.resolved_by = request.user
            dispute.save(
                update_fields=["status", "refund_amount", "resolution_notes", "resolved_by", "updated_at"]
            )
            # With the ledger on, the refund goes to the customer's AshantiHub wallet now (ledger.refunds; nothing
            # happens while it is off). Its source dispute-<id> is the one the delivery-case approval uses too, so a
            # dispute is never refunded twice. A refund the ledger cannot give undoes the whole decision.
            if dispute.order_id and dispute.refund_amount:
                from ledger import refunds
                from ledger.money import to_pesewas

                try:
                    refund = refunds.refund_order(
                        dispute.order, to_pesewas(dispute.refund_amount), source=f"dispute-{dispute.pk}", by=request.user,
                        owner_ids=refunds.scope_for_dispute(dispute), refund_processing=data.get("refund_processing", False),
                        note=f"Dispute #{dispute.pk}",
                    )
                except refunds.RefundError as exc:
                    transaction.set_rollback(True)
                    return Response({"refund_amount": exc.message}, status=exc.status_code)
            # A full refund of the order also reverses the delivery fee its business covered through a
            # free-delivery promo; a partial one leaves that charge standing.
            if dispute.order_id and dispute.refund_amount and dispute.refund_amount >= dispute.order.total_amount:
                from marketing.waivers import reverse_for_order

                reverse_for_order(dispute.order, "order_refunded")
        body = DisputeSerializer(dispute).data
        if refund is not None:
            from ledger.money import from_pesewas

            body = {**body, "wallet_refund": str(from_pesewas(refund.amount_pesewas + refund.processing_pesewas))}
        return Response(body)
```

- [ ] **Step 6: The delivery-case approval** — in `backend/delivery/config.py` replace

```python
def refund_apply(request):
    """Records that a refund was asked for. No money moves: payments are simulated until a payment provider is connected."""
    from activity.services import record

    record(request.decided_by or request.maker, "delivery.refund_request_decided", target_type="disputes.dispute", target_id=str(request.payload.get("dispute_id")),
           summary=f"Refund of GH₵ {request.payload.get('amount')} for case #{request.payload.get('dispute_id')} approved (recorded only; payments are simulated)")


REFUND_KIND = ApprovalKind(
    key=REFUND, label="Refund asked for a delivery case", pool_permission="", current_state=refund_current_state, apply=refund_apply, response_hours=48,
    resolve_approver=lambda request: [(ApprovalRequest.SUPER_ADMIN, None)], chain_note="Super Admin only", requires_sudo=True,
    consequences=lambda request: ["Approving records the decision. No money moves: payments are simulated until a payment provider is connected."],
```

with

```python
def refund_apply(request):
    """Records the approved refund. With the ledger on, the money goes back to the customer's AshantiHub wallet
    (ledger.refunds, source dispute-<id>: the same source dispute resolution uses, so never twice); a skipped shop's case
    refunds that shop's lines only, and the payment-processing charge too when the rider or the business was at fault.
    A refund the ledger cannot give raises ApprovalError, so the request stays pending. With the ledger off nothing
    moves: payments are simulated until a payment provider is connected."""
    from activity.services import record
    from disputes.models import Dispute
    from ledger import refunds
    from ledger.money import from_pesewas, to_pesewas

    decider = request.decided_by or request.maker
    dispute_id, amount = request.payload.get("dispute_id"), request.payload.get("amount")
    dispute = Dispute.objects.select_related("order").filter(pk=dispute_id).first()
    refund = None
    if dispute is not None and dispute.order_id:
        try:
            refund = refunds.refund_order(
                dispute.order, to_pesewas(amount), source=f"dispute-{dispute.pk}", by=decider,
                owner_ids=refunds.scope_for_dispute(dispute), refund_processing=dispute.fault in ("rider", "business"),
                note=f"Delivery case #{dispute.pk}",
            )
        except refunds.RefundError as exc:
            raise ApprovalError(exc.message) from exc
    if refund is not None:
        summary = (f"Refund of GH₵ {from_pesewas(refund.amount_pesewas + refund.processing_pesewas)} for case #{dispute_id} approved "
                   "and returned to the customer's AshantiHub wallet")
    else:
        summary = f"Refund of GH₵ {amount} for case #{dispute_id} approved (recorded only; payments are simulated)"
    # Last: record() holds the activity chain lock until commit.
    record(decider, "delivery.refund_request_decided", target_type="disputes.dispute", target_id=str(dispute_id), summary=summary)


def refund_consequences(request):
    from ledger import escrow

    if escrow.enabled():
        return ["Approving returns the amount to the customer's AshantiHub wallet at once. Payments are simulated until a payment provider is connected."]
    return ["Approving records the decision. No money moves: payments are simulated until a payment provider is connected."]


REFUND_KIND = ApprovalKind(
    key=REFUND, label="Refund asked for a delivery case", pool_permission="", current_state=refund_current_state, apply=refund_apply, response_hours=48,
    resolve_approver=lambda request: [(ApprovalRequest.SUPER_ADMIN, None)], chain_note="Super Admin only", requires_sudo=True,
    consequences=refund_consequences,
```

- [ ] **Step 7: Run the tests**

Run: `docker compose -p wal1 run --rm web python manage.py test ledger disputes orders delivery marketing.tests.test_waivers --noinput`
Expected: PASS — the 10 new tests, and the existing disputes, orders (support cancel), delivery (case decision) and waiver tests unchanged with the ledger off (`test_cancel_reverses_the_charge_once` still calls `_cancel(order)` with no staff).

- [ ] **Step 8: Commit**

```bash
git add backend/ledger backend/orders/support.py backend/disputes backend/delivery/config.py
git commit -m "feat(ledger): Support cancel, dispute resolution and delivery-case approval refund into the wallet"
```

---

### Task 8: Uncollected store pickups go back to the wallet (hourly job)

**Files:**
- Modify: `backend/ledger/verification.py` (`expire_uncollected`), `backend/ashantihub/settings.py` (`CELERY_BEAT_SCHEDULE`)
- Create: `backend/ledger/tasks.py`, `backend/ledger/tests/test_pickup_expiry.py`

**Interfaces:**
- Consumes: `refunds.refund_order` (Task 5), `orders.support.return_stock` (Task 7), `settings_store.current("pickup_window_hours", now)`, `escrow.pay_key`, `escrow.has_open_dispute`, `notifications.services.notify_customer`.
- Produces: `verification.expire_uncollected(now=None) -> int` (how many orders it refunded); Celery task `ledger.tasks.refund_uncollected_pickups`; beat entry `"ledger-refund-uncollected-pickups"` (hourly at :25).

- [ ] **Step 1: Write the failing test** — `backend/ledger/tests/test_pickup_expiry.py`

```python
"""Store-pickup orders nobody collected within the pickup window are refunded to the wallet, cancelled and restocked
(wallets plan 3a, Task 8; spec §4.3). Review Focus 8: the desk racing the job."""
from datetime import timedelta

from django.conf import settings
from django.test import override_settings
from django.utils import timezone

from disputes.models import Dispute
from ledger import tasks, verification
from ledger.models import Account, FulfilmentCheck, MoneySetting, OrderRefund
from notifications.models import Notification
from orders.models import Order

from .test_refunds import RefundBase


@override_settings(LEDGER_ENABLED=True)
class PickupExpiryTests(RefundBase):
    def pickup(self, hours_ago, stock=3):
        self.kofi = self.owner("Kofi")
        self.item = self.listing(self.kofi, "60.00")
        self.item.stock_quantity = stock
        self.item.save(update_fields=["stock_quantity"])
        order = self.paid([(self.item, 2)])                                                   # store pickup is the default
        Order.objects.filter(pk=order.pk).update(placed_at=timezone.now() - timedelta(hours=hours_ago))
        return order

    def test_an_order_not_collected_in_24_hours_goes_back_to_the_wallet(self):
        order = self.pickup(hours_ago=25)
        self.assertEqual(verification.expire_uncollected(), 1)
        order.refresh_from_db()
        self.assertEqual(order.status, Order.CANCELLED)
        self.assertEqual(self.wallet(), 12000)
        self.assertEqual(self.balance(Account.VENDOR_PENDING, self.kofi), 0)
        self.assertEqual(OrderRefund.objects.get(order=order).source, "pickup_expired")
        self.item.refresh_from_db()
        self.assertEqual(self.item.stock_quantity, 5)                                         # the 2 reserved go back on the shelf
        notice = Notification.objects.filter(customer=self.customer).latest("id")
        self.assertEqual(notice.title, "Your order was not collected")
        self.assertIn("GH₵ 120.00 went back to your AshantiHub wallet", notice.body)
        self.assertEqual(verification.expire_uncollected(), 0)                                # once only

    def test_an_order_still_inside_the_window_is_left(self):
        order = self.pickup(hours_ago=23)
        self.assertEqual(verification.expire_uncollected(), 0)
        order.refresh_from_db()
        self.assertEqual(order.status, Order.PAID)

    def test_the_window_is_the_governed_setting(self):
        MoneySetting.objects.create(key="pickup_window_hours", value=48, effective_from=timezone.now() - timedelta(days=3))
        order = self.pickup(hours_ago=30)
        self.assertEqual(verification.expire_uncollected(), 0)
        order.refresh_from_db()
        self.assertEqual(order.status, Order.PAID)

    def test_review_focus_a_collected_order_is_never_refunded(self):
        order = self.pickup(hours_ago=30)
        FulfilmentCheck.objects.create(order=order, collected_at=timezone.now() - timedelta(hours=1))
        self.assertEqual(verification.expire_uncollected(), 0)
        order.refresh_from_db()
        self.assertEqual(order.status, Order.PAID)
        self.assertEqual(self.wallet(), 0)

    def test_an_order_with_an_open_dispute_is_left_for_a_person(self):
        order = self.pickup(hours_ago=30)
        Dispute.objects.create(order=order, raised_by=self.customer, reason=Dispute.ORDER_ISSUE, description="Wrong item", status=Dispute.OPEN)
        self.assertEqual(verification.expire_uncollected(), 0)
        self.assertEqual(self.wallet(), 0)

    def test_an_order_paid_before_the_ledger_was_on_is_left(self):
        kofi = self.owner("Kofi")
        order = self.order([(self.listing(kofi, "60.00"), 1)])                                # no payment journal
        Order.objects.filter(pk=order.pk).update(placed_at=timezone.now() - timedelta(hours=30))
        self.assertEqual(verification.expire_uncollected(), 0)
        order.refresh_from_db()
        self.assertEqual(order.status, Order.PAID)

    def test_the_hourly_task_runs_it(self):
        self.pickup(hours_ago=25)
        self.assertEqual(tasks.refund_uncollected_pickups(), 1)
        entry = settings.CELERY_BEAT_SCHEDULE["ledger-refund-uncollected-pickups"]
        self.assertEqual(entry["task"], "ledger.tasks.refund_uncollected_pickups")


class PickupExpiryLedgerOffTests(RefundBase):
    def test_nothing_happens_while_the_ledger_is_off(self):
        kofi = self.owner("Kofi")
        order = self.order([(self.listing(kofi, "60.00"), 1)])
        Order.objects.filter(pk=order.pk).update(placed_at=timezone.now() - timedelta(hours=30))
        self.assertEqual(verification.expire_uncollected(), 0)
        order.refresh_from_db()
        self.assertEqual(order.status, Order.PAID)
```

- [ ] **Step 2: Run it to see it fail**

Run: `docker compose -p wal1 run --rm web python manage.py test ledger.tests.test_pickup_expiry --noinput`
Expected: ERROR — `ImportError: cannot import name 'tasks' from 'ledger'`.

- [ ] **Step 3: The job** — in `backend/ledger/verification.py`, (a) replace

```python
from . import escrow, settings_store
from .models import FulfilmentCheck, Journal, OrderFeeSnapshot
```

with

```python
from . import escrow, settings_store
from .models import FulfilmentCheck, Journal, OrderFeeSnapshot
from .money import from_pesewas
```

and (b) append at the end of the file

```python


def expire_uncollected(now=None):
    """Refund and cancel paid store-pickup orders nobody collected within `pickup_window_hours` of purchase (spec §4.3,
    Stage 3): the whole order goes back to the customer's AshantiHub wallet (not the payment-processing charge: the
    customer did not come), its stock back on the shelf, and the customer is told. Only orders whose payment the ledger
    recorded (older ones stay on the desk's list for a person) and never one with an open dispute. The desk's collection
    and this job both lock the order row, so a collected order is never refunded. Returns how many were refunded."""
    from notifications.services import notify_customer
    from orders.models import Order
    from orders.support import return_stock

    from . import refunds

    if not escrow.enabled():
        return 0
    now = now or timezone.now()
    hours = settings_store.current("pickup_window_hours", now)
    due = list(
        Order.objects.filter(status=Order.PAID, delivery_method=Order.STORE_PICKUP, placed_at__lt=now - timedelta(hours=hours))
        .exclude(fulfilment_check__collected_at__isnull=False).order_by("placed_at", "id").values_list("pk", flat=True)
    )
    done = 0
    for pk in due:
        with transaction.atomic():
            order = Order.objects.select_for_update(of=("self",)).select_related("customer").get(pk=pk)
            if order.status != Order.PAID or not Journal.objects.filter(key=escrow.pay_key(order)).exists():
                continue
            if FulfilmentCheck.objects.filter(order=order, collected_at__isnull=False).exists() or escrow.has_open_dispute(order):
                continue
            return_stock(order)
            order.status = Order.CANCELLED
            order.save(update_fields=["status"])
            refund = refunds.refund_order(order, source="pickup_expired", note=f"Not collected within {hours} hours")
            back = (
                f" GH₵ {from_pesewas(refund.amount_pesewas)} went back to your AshantiHub wallet."
                if refund is not None and refund.amount_pesewas > 0 else ""
            )
            notify_customer(
                order.customer, "order_status", "Your order was not collected",
                body=f"Order #{order.pk} was not collected within {hours} hours of purchase, so it was cancelled.{back}",
                link="/my-account", icon="🧾",
            )
        done += 1
    return done
```

- [ ] **Step 4: The task and its schedule** — `backend/ledger/tasks.py`

```python
from celery import shared_task

from . import verification


@shared_task
def refund_uncollected_pickups():
    """Hourly: store-pickup orders not collected within the pickup window go back to the customer's wallet (a no-op
    while the ledger is off). The beat entry makes core.jobs keep a JobRun heartbeat for it."""
    return verification.expire_uncollected()
```

In `backend/ashantihub/settings.py` replace

```python
    "otp-purge-old-rows": {
        "task": "otp.tasks.purge_old_otp_rows",
        "schedule": crontab(hour=3, minute=55),
    },
}
```

with

```python
    "otp-purge-old-rows": {
        "task": "otp.tasks.purge_old_otp_rows",
        "schedule": crontab(hour=3, minute=55),
    },
    "ledger-refund-uncollected-pickups": {
        "task": "ledger.tasks.refund_uncollected_pickups",
        "schedule": crontab(minute=25),  # hourly, at twenty-five past: a no-op while the ledger is off
    },
}
```

- [ ] **Step 5: Run the tests**

Run: `docker compose -p wal1 run --rm web python manage.py test ledger core.tests.test_background_jobs --noinput`
Expected: PASS (8 new tests; `test_every_scheduled_job_names_a_registered_task` finds the new task).

- [ ] **Step 6: Commit**

```bash
git add backend/ledger backend/ashantihub/settings.py
git commit -m "feat(ledger): refund and cancel store pickups not collected within the window (hourly)"
```

---

### Task 9: Staff reads — wallet balances — and the wallet permissions

**Files:**
- Create: `backend/accounts/migrations/0054_seed_wallet_permissions.py`, `backend/wallets/views_staff.py`, `backend/wallets/tests/test_staff_wallets.py`
- Modify: `backend/wallets/urls.py`, `backend/accounts/tests/test_roles_seed.py`, `backend/people/roles.py`, `docs/STAFF_ROLES.md`

**Interfaces:**
- Consumes: `wallets.views.ledger_off`, `Pagination` (Task 4), `wallets.services.money` (Task 4), `accounts.permissions.HasRolePermission`.
- Produces: permissions `wallets.view` (balances, withdrawals, reconciliation runs) and `wallets.manage` (fail a stuck withdrawal — used by Plan 3b), both granted to `accountant` and `super_admin`; `GET /api/wallet/staff/wallets/?kind=customer|vendor`; module `wallets.views_staff` (Plan 3b adds withdrawals and reconciliation views to it).

- [ ] **Step 1: Confirm the latest accounts migration**

Run: `ls backend/accounts/migrations | sort | tail -3`
Expected: `0053_seed_otp_recovery_permission.py` is the last numbered file. If another is, use that name in the dependency below.

- [ ] **Step 2: Write the permissions seed** — `backend/accounts/migrations/0054_seed_wallet_permissions.py`

```python
from django.db import migrations

# Wallets (wallets plan 3a, Task 9; 3b uses wallets.manage). Super Admin holds every permission.
PERMISSIONS = [
    ("wallets.view", "See customer wallets and vendor balances, withdrawals and the nightly reconciliation"),
    ("wallets.manage", "Fail a withdrawal stuck with the provider and return the money (password again)"),
]
GRANTS = {
    "accountant": ["wallets.view", "wallets.manage"],
    "super_admin": [codename for codename, _ in PERMISSIONS],
}


def seed(apps, schema_editor):
    Permission = apps.get_model("accounts", "Permission")
    Role = apps.get_model("accounts", "Role")
    by_code = {}
    for codename, description in PERMISSIONS:
        by_code[codename], _ = Permission.objects.get_or_create(codename=codename, defaults={"description": description})
    for role_name, codenames in GRANTS.items():
        Role.objects.get(name=role_name).permissions.add(*[by_code[c] for c in codenames])


def unseed(apps, schema_editor):
    apps.get_model("accounts", "Permission").objects.filter(codename__in=[c for c, _ in PERMISSIONS]).delete()


class Migration(migrations.Migration):
    dependencies = [("accounts", "0053_seed_otp_recovery_permission")]
    operations = [migrations.RunPython(seed, unseed)]
```

- [ ] **Step 3: Write the failing test** — `backend/wallets/tests/test_staff_wallets.py`

```python
"""Staff read customers' wallets and vendors' balances (wallets plan 3a, Task 9): wallets.view only, names and
balances, never an account number."""
from django.core.cache import cache
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from accounts.models import BusinessOwner, BusinessOwnerProfile, Customer, Role
from accounts.testing import make_staff, staff_token
from ledger import posting
from ledger.models import Account

URL = "/api/wallet/staff/wallets/"


def credit(kind, owner, pesewas, key):
    posting.post(key=key, kind="test", lines=[
        posting.debit(posting.account_for(Account.PROVIDER_CLEARING), pesewas), posting.credit(posting.account_for(kind, owner), pesewas),
    ])


class StaffWalletsBase(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.accountant = make_staff("accountant", "kofi@example.com")
        self.support = make_staff("support", "esi@example.com")

    def as_staff(self, staff):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(staff)}")


@override_settings(LEDGER_ENABLED=True)
class StaffWalletsTests(StaffWalletsBase):
    def test_the_accountant_sees_customer_wallets_largest_first(self):
        ama = Customer.objects.create(full_name="Ama Owusu", phone="+233241234567", password_hash="x")
        kojo = Customer.objects.create(full_name="Kojo Asare", phone="+233241234568", password_hash="x")
        credit(Account.CUSTOMER_WALLET, ama, 1250, "a")
        credit(Account.CUSTOMER_WALLET, kojo, 9000, "b")
        self.as_staff(self.accountant)
        page = self.client.get(URL).json()
        self.assertEqual(page["count"], 2)
        self.assertEqual(
            [(row["holder_id"], row["name"], row["balance"]) for row in page["results"]],
            [(kojo.pk, "Kojo Asare", "90.00"), (ama.pk, "Ama Owusu", "12.50")],
        )

    def test_vendors_show_pending_and_available_under_the_business_name(self):
        owner = BusinessOwner.objects.create(full_name="Kwame Mensah", login_phone="+233201112233", password_hash="x")
        BusinessOwnerProfile.objects.create(business_owner=owner, business_name="Adepa Ventures", payout_momo_number="+233201112233")
        credit(Account.VENDOR_PENDING, owner, 5000, "p")
        credit(Account.VENDOR_AVAILABLE, owner, 700, "v")
        self.as_staff(self.accountant)
        response = self.client.get(URL, {"kind": "vendor"})
        self.assertEqual(response.status_code, 200, response.content)
        row = response.json()["results"][0]
        self.assertEqual((row["holder_id"], row["name"], row["pending"], row["available"]), (owner.pk, "Adepa Ventures", "50.00", "7.00"))
        self.assertNotIn("201112233", response.content.decode())                              # never a payout number

    def test_an_unknown_kind_is_refused(self):
        self.as_staff(self.accountant)
        self.assertEqual(self.client.get(URL, {"kind": "rider"}).status_code, 400)

    def test_only_wallets_view_holders_may_look(self):
        self.as_staff(self.support)
        self.assertEqual(self.client.get(URL).status_code, 403)

    def test_the_accountant_and_super_admin_hold_both_wallet_permissions(self):
        for role in ("accountant", "super_admin"):
            held = set(Role.objects.get(name=role).permissions.values_list("codename", flat=True))
            self.assertLessEqual({"wallets.view", "wallets.manage"}, held, role)


class StaffWalletsLedgerOffTests(StaffWalletsBase):
    def test_it_says_ledger_off(self):
        self.as_staff(self.accountant)
        response = self.client.get(URL)
        self.assertEqual((response.status_code, response.json()["code"]), (409, "ledger_off"))
```

- [ ] **Step 4: Run it to see it fail**

Run: `docker compose -p wal1 run --rm web python manage.py test wallets.tests.test_staff_wallets --noinput`
Expected: FAIL — 404 for `/api/wallet/staff/wallets/`.

- [ ] **Step 5: The staff view** — `backend/wallets/views_staff.py`

```python
"""Staff reads of holders' money (wallets.view: Accountant, Super Admin). Never an account or MoMo number. Answers
409 ledger_off while the ledger is off. Plan 3b adds withdrawals and the reconciliation runs here."""
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import BusinessOwner, Customer
from accounts.permissions import HasRolePermission
from ledger import escrow
from ledger.models import Account

from .services import money
from .views import Pagination, ledger_off

VIEW, MANAGE = "wallets.view", "wallets.manage"


class StaffWalletsView(APIView):
    """GET staff/wallets/?kind=customer|vendor — customers' wallets, or vendors' Pending and Available (every vendor
    with a sale has a Pending account), largest first, 20 a page."""

    def get_permissions(self):
        return [HasRolePermission(VIEW)]

    def get(self, request):
        if not escrow.enabled():
            return ledger_off()
        kind = request.query_params.get("kind") or "customer"
        if kind not in ("customer", "vendor"):
            return Response({"kind": "Choose customer or vendor."}, status=status.HTTP_400_BAD_REQUEST)
        if kind == "customer":
            accounts = Account.objects.filter(kind=Account.CUSTOMER_WALLET, owner_type=Customer._meta.label_lower)
        else:
            accounts = Account.objects.filter(kind=Account.VENDOR_PENDING, owner_type=BusinessOwner._meta.label_lower)
        paginator = Pagination()
        page = paginator.paginate_queryset(accounts.order_by("-net_credit", "pk"), request, view=self)
        ids = [int(account.owner_id) for account in page]
        if kind == "customer":
            names = dict(Customer.objects.filter(pk__in=ids).values_list("pk", "full_name"))
            rows = [{"holder_id": int(a.owner_id), "name": names.get(int(a.owner_id), ""), "balance": money(a.balance)} for a in page]
        else:
            owners = {owner.pk: owner for owner in BusinessOwner.objects.filter(pk__in=ids).select_related("profile")}
            available = {
                a.owner_id: a.balance
                for a in Account.objects.filter(kind=Account.VENDOR_AVAILABLE, owner_type=BusinessOwner._meta.label_lower, owner_id__in=[a.owner_id for a in page])
            }
            rows = [
                {
                    "holder_id": int(a.owner_id), "name": owners[int(a.owner_id)].display_name if int(a.owner_id) in owners else "",
                    "pending": money(a.balance), "available": money(available.get(a.owner_id, 0)),
                }
                for a in page
            ]
        return paginator.get_paginated_response(rows)
```

In `backend/wallets/urls.py` replace

```python
from . import views

urlpatterns = [
```

with

```python
from . import views, views_staff

urlpatterns = [
    path("staff/wallets/", views_staff.StaffWalletsView.as_view(), name="wallet-staff-wallets"),
```

- [ ] **Step 6: Role seed test, permission groups, staff roles doc**

(a) In `backend/accounts/tests/test_roles_seed.py` replace

```python
        "commission.view_all", "commission.policy",
    },
```

with

```python
        "commission.view_all", "commission.policy", "wallets.view", "wallets.manage",
    },
```

(b) In `backend/people/roles.py` replace

```python
    ("Money", ("escrow.", "transactions.", "commission.", "subscription_plans.", "event_pricing.", "credit.", "targets.")),
```

with

```python
    ("Money", ("escrow.", "transactions.", "commission.", "subscription_plans.", "event_pricing.", "credit.", "targets.", "wallets.")),
```

(c) In `docs/STAFF_ROLES.md` replace

```markdown
| | `fees.manage` | Propose fee-rule and money-setting changes (a Super Admin's apply at once) | ✓ | | ✓ | | | | | | |
```

with

```markdown
| | `fees.manage` | Propose fee-rule and money-setting changes (a Super Admin's apply at once) | ✓ | | ✓ | | | | | | |
| | `wallets.view` | See customer wallets and vendor balances, withdrawals and the nightly reconciliation | ✓ | | ✓ | | | | | | |
| | `wallets.manage` | Fail a withdrawal stuck with the provider and return the money (password again) | ✓ | | ✓ | | | | | | |
```

- [ ] **Step 7: Run the tests**

Run: `docker compose -p wal1 run --rm web python manage.py test wallets accounts.tests.test_roles_seed people --noinput`
Expected: PASS (6 new tests; the role-seed and people tests unchanged apart from the two new grants).

- [ ] **Step 8: Commit**

```bash
git add backend/accounts/migrations/0054_seed_wallet_permissions.py backend/accounts/tests/test_roles_seed.py backend/people/roles.py backend/wallets docs/STAFF_ROLES.md
git commit -m "feat(wallets): staff wallet balances behind wallets.view; seed wallets.view and wallets.manage"
```

---

### Task 10: Documentation and full verification

**Files:**
- Modify: `backend/CLAUDE.md`, `docs/superpowers/specs/2026-10-15-wallet-fees-security-design.md`, `docs/IMPLEMENTATION_INSTRUCTIONS.md`

**Interfaces:**
- Consumes: everything above. Produces: no code.

- [ ] **Step 1: Correctness core** — in `backend/CLAUDE.md` replace

```markdown
  `docs/superpowers/specs/2026-10-15-wallet-fees-security-design.md` section 13.
- **Pickup Desk** is the `pickup_desk` staff role with the single permission `pickup.confirm` (store-pickup queue and
```

with

```markdown
  `docs/superpowers/specs/2026-10-15-wallet-fees-security-design.md` section 13.
- **Wallets, payments and refunds (`wallets/`, `ledger/refunds.py`, `payments/providers.py`).** Behind `LEDGER_ENABLED`
  like the rest of the ledger: with it off every `/api/wallet/` endpoint answers `409 ledger_off` and checkout, cancel,
  dispute and approval responses are exactly as before. A customer pays by MoMo (`payment_method` `momo`, the default)
  or from the wallet (`wallet`: the payment journal debits `customer_wallet` instead of provider clearing; a wallet must
  cover the whole order, else `409 insufficient_funds` and the checkout rolls back). The provider's collection charge
  is paid on top of MoMo payments and top-ups (`CheckoutSession.processing_fee`, "payment processing"); the ledger
  records only the net. Refunds always go to the wallet through `ledger.refunds.refund_order` (one `OrderRefund` per
  order and source, e.g. `dispute-<id>`, so never twice), per fee snapshot (`refunded_base_pesewas` /
  `refunded_fee_pesewas`, `reversed_at` when whole), which frees the lifetime cap; release pays only what is left and
  never a cancelled order; after release the vendor's Available is debited (may go negative) and the fee returned in
  proportion; the delivery fee comes back only with the whole order; the collection charge only on a platform/vendor
  error. Support's cancel, the hourly uncollected-pickup job, dispute resolution and the delivery-case refund approval
  all call it. A business's free-delivery promo (`WaivedFeeCharge`) is taken from its Available at release. **Lock
  order for money:** the order row, its fee snapshots, then ledger accounts in primary-key order taken up front with
  `posting.lock` (`posting.post` takes them the same way). `collect` is `payments.services.process_payment` and
  `handle_webhook` is `HubtelWebhookView` (both unchanged); the Hubtel provider's payout, status and name lookup raise
  `NotConnected` until Plan 7.
- **Pickup Desk** is the `pickup_desk` staff role with the single permission `pickup.confirm` (store-pickup queue and
```

- [ ] **Step 2: Spec status and carry-forward** — in `docs/superpowers/specs/2026-10-15-wallet-fees-security-design.md`, (a) replace

```markdown
**Status:** Approved 2026-10-15. Stage 1 plan: docs/superpowers/plans/2026-10-15-ledger-fees-foundation.md. Stage 2 (OTP, backend) plan: docs/superpowers/plans/2026-10-16-otp-security.md.
**Scope:** One system, built in the order given in §11. Stage 1 (ledger) and Stage 2 (OTP, backend) are implemented
behind switches that default off (branches feature/ledger-stage1 and feature/otp-security; see section 13); later
stages are specs only.
```

with

```markdown
**Status:** Approved 2026-10-15. Stage 1 plan: docs/superpowers/plans/2026-10-15-ledger-fees-foundation.md. Stage 2 (OTP, backend) plan: docs/superpowers/plans/2026-10-16-otp-security.md. Stage 3 plans: docs/superpowers/plans/2026-10-16-wallets-payments-3a.md (wallet payments and refunds) and docs/superpowers/plans/2026-10-16-withdrawals-3b.md (payout destinations, withdrawals, reconciliation).
**Scope:** One system, built in the order given in §11. Stage 1 (ledger), Stage 2 (OTP, backend) and Stage 3a (wallet
payments and refunds, backend) are implemented behind switches that default off (branches feature/ledger-stage1,
feature/otp-security and feature/wallets; see section 13); later stages are specs only.
```

and (b) replace

```markdown
### Stage 3 carry-forward

- Cancelled paid orders keep their `OrderFeeSnapshot` counted against the lifetime cap and their money in Vendor Pending / Delivery payable. Stage 3 must reverse them (`OrderFeeSnapshot.reversed_at`) and refund.

- Release pays every unreleased snapshot, so a refund resolution (skipped-stop "refund these lines only", or money-back) followed by "matches" would pay the vendor in full. Stage 3 must reverse those snapshots (`OrderFeeSnapshot.reversed_at`), or release must leave out disputed lines.
- The money-releasing POST has no password re-check (`RequiresSudo`). Owner question: should it?
- The waived delivery fee never reaches the ledger.
```

with

```markdown
### Stage 3 carry-forward

- **Done in Stage 3a (W4, W6).** Cancelled paid orders kept their `OrderFeeSnapshot` counted against the lifetime cap
  and their money in Vendor Pending / Delivery payable: Support's cancel and the uncollected-pickup job now refund the
  order whole to the wallet and reverse its snapshots.
- **Done in Stage 3a (W4).** Release paid every unreleased snapshot, so a refund resolution followed by "matches" would
  have paid the vendor in full: refunds now raise each snapshot's refunded base and fee (reversed when whole), release
  pays only what is left, and a skipped stop's case refunds that shop's lines only.
- The money-releasing POST has no password re-check (`RequiresSudo`). Owner question: should it? (Still open.)
- **Done in Stage 3a (W5).** The waived delivery fee never reached the ledger: the business's promo cost is now taken
  from its Available at release and given back on a whole refund.
```

- [ ] **Step 3: Stage index** — in `docs/IMPLEMENTATION_INSTRUCTIONS.md` replace

```markdown
| **3** Wallets and payments | Customer wallet, top-up, refunds, withdrawals, payout destinations, provider interface and simulated provider, reconciliation. Needs Plan 2. |
```

with

```markdown
| **3** Wallets and payments | Customer wallet, top-up, refunds, withdrawals, payout destinations, provider interface and simulated provider, reconciliation. Needs Plan 2. Backend: 3a docs/superpowers/plans/2026-10-16-wallets-payments-3a.md (provider interface, top-up, paying from the wallet, refunds) then 3b docs/superpowers/plans/2026-10-16-withdrawals-3b.md (payout destinations, withdrawals, reconciliation), behind `LEDGER_ENABLED`; the screens are Plan 3F. |
```

- [ ] **Step 4: Commit**

```bash
git add backend/CLAUDE.md docs
git commit -m "docs(wallets): correctness core, spec status and carry-forward, stage index (3a)"
```

- [ ] **Step 5: Run the whole backend suite**

Run: `docker compose -p wal1 run --rm web python manage.py test --noinput`
Expected: PASS. If a failure is unrelated to this work, confirm it on the commit this plan was written on (`git log --oneline -1 -- docs/superpowers/plans/2026-10-16-wallets-payments-3a.md` gives it; `git switch --detach <sha>`, re-run the failing label, `git switch feature/wallets`) and report it rather than fixing it here.

- [ ] **Step 6: Migrations check**

Run: `docker compose -p wal1 run --rm web python manage.py makemigrations --check --dry-run`
Expected: `No changes detected`.

---

## What this plan deliberately does not do (later plans)

| Plan | Scope | Why separate |
|---|---|---|
| **3b** Withdrawals | Payout destinations (name-matched, OTP-confirmed, cooling period), withdrawals for customers and vendors with limits and step-up, payout settlement and reversal, the nightly reconciliation, staff withdrawal screens. | Depends on everything here; its own review gate. `docs/superpowers/plans/2026-10-16-withdrawals-3b.md`. |
| **3F** Frontend | Wallet screen (balance, statement, top-up with the payment-processing line), "pay from wallet" at checkout, refund notices, the staff wallet list. | No screen ships in a backend plan. |
| **4** Vendor dashboard and SMS | Vendor statement page (gross, fee shown separately, status Pending/Available/Withdrawn/Refunded, cap meter, export), per-order and release SMS, daily digest. | Spec §6; `GET /api/wallet/transactions/` gives the raw lines it builds on. |
| **5** Third-party riders | Rider wallet, 90/10 split, end-of-day commission; a refunded delivery reversing its reserve. | Spec §7; company riders have no wallet. |
| **7** Hubtel live | Hubtel's real collection charge (`HUBTEL_COLLECTION_CHARGE_BP`), payouts, payout status, account-name lookups, the payout webhook, credentials. | Needs credentials and regulatory clearance (§11 step 7, §12). |
| Owner question | `RequiresSudo` on Support's money-releasing verification POST (§13). | Not decided. |

## Self-review

**Spec coverage:**

| Requirement | Task(s) |
|---|---|
| §1 row 1 / §2.3 provider interface, simulated by default, Hubtel gated | 1 (interface), 3 and 4 (collections through `process_payment`; Hubtel webhook unchanged, top-up credited once: Task 4) |
| §1 row 14 customers pay the collection charge as "payment processing"; none for wallet payments | 3 (checkout), 4 (top-up, quote) |
| §1 row 14 collection charge not refunded except on platform/vendor error | 5 (`refund_processing`), 7 (dispute flag, delivery fault) |
| §2.2 step 1 pay by MoMo or wallet into escrow (Pending + Delivery payable) | 3 |
| §2.2 step 3 refund before release returns escrow-backed money to the wallet | 5, 7, 8 |
| §2.2 step 4 / §1 row 6 refund after release debits Available (may go negative), fee returned in proportion | 5 (`test_a_refund_after_release_may_drive_available_below_zero`, rounding) |
| §3.2 fees never shown to customers; "payment processing" shown for MoMo/top-up | 3, 4 |
| §4.3 uncollected pickup refunded to the wallet | 8 |
| §5 top-up from MoMo, customer bears the charge | 4 |
| §5 pay directly by MoMo or from the wallet (no charge from wallet) | 3 |
| §5 refunds credit the wallet | 5, 7, 8 |
| §5 withdrawal to verified destinations | Plan 3b |
| §6 Pending and Available views | 4 (`GET /api/wallet/` for owners); statement page is Plan 4 |
| §6 withdrawal; negative Available blocks it | Plan 3b |
| §13 carry-forward: cancelled paid orders reversed (`reversed_at`) and refunded, cap freed | 2 (`charged_to_date`), 5, 7 (cancel), 8 (pickup) |
| §13 carry-forward: release leaves out refunded lines | 6, 7 (`test_review_focus_mismatch_money_back_then_matches_pays_the_rest`) |
| §13 carry-forward: waived delivery fee reaches the ledger | 6 |
| §13 carry-forward: `RequiresSudo` on release | not in scope (owner question) |
| §11 step 3 behind a switch; nothing moves real money | every task (`LEDGER_ENABLED`; simulated provider) |

**Placeholder scan:** every code step carries complete code and every test step complete test code; edits to existing files quote the exact text replaced; no "TBD", "similar to" or undefined names.

**Name consistency:** `payments.providers.get_provider(name=None)`, `collection_charge(amount_pesewas)`, `payout_charge(amount_pesewas, rail)`, `lookup_account_name(rail, institution, account_number, *, holder_name="")`, `payout(*, reference, rail, institution, account_number, amount_pesewas)`, `status(reference)`, `payouts_available()`, `NotConnected`, `MOMO`/`BANK`, `SUCCEEDED`/`FAILED`/`PROCESSING` (Tasks 1, 3, 4; Plan 3b); `posting.lock(*accounts)`, `posting.balance_of(kind, owner=None)`, `posting.InsufficientFunds.account`, `post(..., allow_negative=())` (Tasks 2, 3, 6; 3b); `escrow.record_order_payment(order, *, at=None, wallet=False)` (3); `process_payment(..., processing_fee=None, wallet=False)`, `CheckoutSession.WALLET`, `WALLET_TOPUP`, `processing_fee` (3, 4, 5); `refunds.refund_order(order, amount_pesewas=None, *, source, by=None, owner_ids=None, refund_processing=False, note="", now=None)`, `RefundError.message/.status_code`, `scope_for_dispute(dispute)` (5, 6, 7, 8); `escrow.charge_waiver`, `return_waiver`, `waiver_key`, `waiver_return_key` (6); `orders.support.return_stock(order)` (7, 8); `verification.expire_uncollected(now=None)` (8); `wallets.views.ledger_off`, `parse_amount`, `AmountError`, `Pagination`, `wallets.services.money` (4, 9; 3b); permissions `wallets.view`, `wallets.manage` (9; 3b).

**Review Focus pins:** each of the eight lines above names the task and the test that pins it; all of those tests are written out in their tasks.
