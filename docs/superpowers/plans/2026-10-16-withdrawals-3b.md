# Payout Destinations, Withdrawals and Reconciliation — Implementation Plan (Stage 3b)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Customers withdraw their wallet and vendors their Available balance to verified MoMo numbers or bank accounts — name-matched, confirmed with a texted or emailed code, usable after a cooling period, within editable limits — on simulated rails, with payouts settled or returned exactly once, staff able to fail a stuck one, and a nightly reconciliation that compares the ledger with the provider's statement and raises a case on any difference. All behind `LEDGER_ENABLED` (default off).

**Architecture:** The `wallets` app (created by Plan 3a) gains `PayoutDestination`, `Withdrawal` and `ReconciliationRun`. A withdrawal is held in `withdrawal_in_transit` in the request's transaction (which also spends the step-up code), claimed and sent to the provider outside any transaction, and ended by one function, `wallets.payouts.apply_result`, whoever reports the outcome (the provider's answer, the 5-minute poll, a future webhook, or staff). The provider interface from Plan 3a gains a statement for the nightly reconciliation. Step-up codes are always required for wallet actions while the ledger is on.

**Tech Stack:** Django 5.2, DRF, Postgres, Celery beat (eager under tests), the repo's `ledger`, `payments`, `otp`, `fraud`, `notifications`, `activity` apps.

**Spec:** `docs/superpowers/specs/2026-10-15-wallet-fees-security-design.md` — §1 rows 1, 6, 13, 14; §2 (nightly reconciliation), §2.1 (withdrawal in transit), §2.2 step 5, §2.3; §3.3 (withdrawal limits and cooling period are governed settings); §5 (withdrawal); §6 (vendor withdrawal, negative Available blocks it); §8 (payout destinations); §9 (step-up before withdrawal and payout-destination actions); §11 step 3; §13. Deviations are in §0 below; Task 1 records them in the spec.

**Depends on:** **Plan 3a** (`docs/superpowers/plans/2026-10-16-wallets-payments-3a.md`) — every task of it must be done first. This plan uses, from 3a: `payments.providers` (`get_provider`, `payout`, `status`, `payout_charge`, `lookup_account_name`, `payouts_available`, `NotConnected`), `ledger.posting.lock` / `balance_of` / `InsufficientFunds` / `post(..., allow_negative=...)`, `CheckoutSession.processing_fee` / `WALLET` / `WALLET_TOPUP` and `metadata["ledger"]`, the `wallets` app with `wallets.views.ledger_off` / `parse_amount` / `AmountError` / `Pagination`, `wallets.services.money`, `wallets.views_staff` (`VIEW`, `MANAGE`), and the `wallets.view` / `wallets.manage` permissions (accounts migration 0054). Stage 2 (OTP) provides `otp.step_up` with the `WITHDRAWAL` and `PAYOUT_DESTINATION` actions.

## 0. Decisions and reconciliation with the code

| # | Question | Decision | Why (grounded in the code) |
|---|---|---|---|
| E1 | Where the code lives | `wallets/models.py` (`PayoutDestination`, `Withdrawal`, `ReconciliationRun`), `wallets/names.py` (name check), `destinations.py`, `withdrawals.py` (asking), `payouts.py` (sending and settling), `reconciliation.py`, `tasks.py`; holder API in `wallets/views_payouts.py` under `/api/wallet/`; staff in `wallets/views_staff.py`. | Plan 3a made `/api/wallet/` the holder's money API and `wallets/views_staff.py` the staff reads. |
| E2 | How a destination is verified (§8) | The provider looks up the name on the account (`lookup_account_name`); it must match a verified name word for word, or contain every word of it (at least two words): a customer's profile name; a KYC-verified vendor's owner name or business name. The holder confirms with a step-up code (Plan 2's `otp.service` texts or emails it to the holder's own phone or email) spent in the same transaction. No new OTP purpose: `step_up.PAYOUT_DESTINATION` already exists. | `otp.step_up.ACTIONS` already holds `payout_destination` and `withdrawal` "for when they exist (Stage 3)" (spec O4). `payments/hubtel_client.py` has no name lookup, so the Hubtel provider answers `NotConnected` → `409 name_check_unavailable`; the simulated provider answers the holder's own name unless a test lists the number in `SIMULATED_ACCOUNT_NAMES` (the response says `name_check: "simulated"`). |
| E3 | Step-up while the OTP switches are off | Destination add/remove and withdrawals call `step_up.require(request, ACTION, force=True)`: a code is always required while the ledger is on. `otp/views_step_up._codes_off` lets the step-up send/verify endpoints work for `withdrawal` and `payout_destination` whenever `LEDGER_ENABLED` is on. | Spec §8 ("confirms by OTP") and §11 ("OTP must precede any wallet going live"). With `force=True` alone the code could never be obtained: the step-up endpoints answer `409 otp_off` while every OTP switch is off. With the ledger off nothing changes (Plan 2's tests keep passing). |
| E4 | Existing payout details | `BusinessOwnerProfile.payout_*` stay exactly as they are (registration's `payment_info` step, `PATCH business-owners/me/payout/`, the staff detail view's `mask_but_last`). A vendor may copy them into a new destination with `{"from_profile": true}`, which is still name-checked, code-confirmed and cooled. They are not migrated automatically. | They were never name-checked or OTP-confirmed, and changing them would break registration and the masking rule (backend/CLAUDE.md). |
| E5 | Cooling period | `usable_from` = time added + `payout_cooling_hours` in force then; fixed on the row. A destination is never edited: a change is a removal plus a new one (new cooling). At most 5 live per holder. | §8 "new or changed destinations cannot receive money for an editable cooling period"; like fee snapshots, later setting changes never rewrite a row. |
| E6 | Withdrawal journals and the charge | Hold: Dr source (customer wallet or vendor Available) Cr `withdrawal_in_transit` (`withdrawal-hold-<ref>`). Paid: Dr in transit Cr `provider_clearing` (`withdrawal-paid-<ref>`, posted with `allow_negative={provider_clearing}` because the provider has confirmed it). Returned: Dr in transit Cr source (`withdrawal-reversed-<ref>`). The holder bears the provider's charge: it is taken out of the amount sent (`net = amount − charge`); clearing falls by the full amount (what the provider's statement shows: sent plus its charge), so there is no `provider_fees` line — AshantiHub bears nothing. | §2.2 step 5; §1 row 14. `provider_fees` is kept for charges AshantiHub bears (Plan 3a's refunded collection charge). |
| E7 | Limits | Governed money settings in `ledger.settings_store.DEFINITIONS`, changed only through the existing `ledger.setting` approval: `withdrawal_per_tx_limit_pesewas` 500,000 (GH₵ 5,000), `withdrawal_daily_limit_pesewas` 1,000,000 (GH₵ 10,000), `payout_cooling_hours` 24. The day is the calendar day in Africa/Accra; pending, processing and paid withdrawals count; failed and cancelled do not. | §3.3: "withdrawal limits and the cooling period share one flow" (Accounting proposes, Super Admin approves). |
| E8 | Concurrency | `request` locks the destination row, then the source and in-transit accounts together in primary-key order (`posting.lock`), and only then reads the balance and today's total. `apply_result` and `close` lock the withdrawal row, then post. A withdrawal is claimed (pending → processing) under its row lock before the provider is called, so it is sent once. | Two withdrawals of one balance, or a request racing a return to the same wallet, must neither overspend nor deadlock (Plan 3a D12 lock order). |
| E9 | Idempotency and reports | The client sends a `request_id` (unique per holder): a retry answers the same withdrawal (200) without a new code. A report (provider answer, poll, callback, staff) is applied once: journal keys are per reference, a final status never changes, a report whose amount differs from what was sent is not applied (fraud case), and a "paid" report on a withdrawal already failed or cancelled is never posted and opens a fraud case. | §2.3: "idempotent on the provider reference, amount-verified ... monotonic in status". |
| E10 | Reconciliation | Nightly at 02:30 for the day before, by provider reference: every statement line has its journal for the same amount; every journal of the day that moved provider clearing names a movement the provider confirms on any day; in transit equals the open withdrawals; the provider's unconfirmed payouts equal ours. Skipped (never a false alarm): payments made while the ledger was off (no `metadata["ledger"]`), kinds the ledger does not record (subscriptions, tickets, bookings...), GH₵ 0.00 payments, wallet payments (no provider movement). A difference opens one fraud case per day (`fraud.services.raise_flag`, `dedupe_key="reconciliation-<day>"`) and tells `wallets.view` holders once. It never posts or corrects. The simulated provider's statement is read from our own paid checkout sessions and settled withdrawals (what it "did"); Hubtel's is Plan 7, so a Hubtel run is recorded `unavailable`. | §2 "A nightly reconciliation compares the ledger to the provider statement and flags differences." |
| E11 | Staff | `GET staff/withdrawals/` (`wallets.view`); `POST staff/withdrawals/<id>/fail/` (`wallets.manage` + password) only for one stuck (sent 30+ minutes ago with no answer, or held and never sent for 10+ minutes); it returns the money and records `wallets.withdrawal_failed` itself, last, with no account number. | Brief: "force-fail a stuck withdrawal"; backend/CLAUDE.md sudo and `record()` rules. |
| E12 | Riders, Hubtel | Third-party rider wallets are Stage 5. Hubtel payouts, status, name lookups and the payout webhook are Plan 7: `wallets.payouts.apply_result(reference, status, ...)` is the function that webhook will call. | Spec §11. |

## Global Constraints

- Everything in Plan 3a's Global Constraints applies (integer pesewas; `post` only; `LEDGER_ENABLED` gates everything and every `/api/wallet/*` endpoint answers `409 {"code": "ledger_off"}` while it is off; lock order; simulated rails; test and command conventions).
- New journal keys: `withdrawal-hold-<ref>`, `withdrawal-paid-<ref>`, `withdrawal-reversed-<ref>`; kinds `withdrawal_hold`, `withdrawal_paid`, `withdrawal_reversed`. Withdrawal references look like `AH-WD-XXXXXXXXXX`.
- **Payout destination numbers are stored unmasked and only ever leave the server through `accounts.serializers.mask_but_last`** (as `account_number_masked`), in every holder and staff response; never in a log line, an activity body, a fraud case or a notification. `account_number` is added to Sentry's denylist.
- Adding or removing a destination and asking for a withdrawal call `step_up.require(request, ACTION, force=True)` **inside** the `transaction.atomic()` that saves; a refused request keeps the code.
- Defaults (owner may change through `ledger.setting`): per withdrawal GH₵ 5,000 (`500000`), per day GH₵ 10,000 (`1000000`), cooling 24 hours.
- Vendors may withdraw only a positive Available; a negative Available blocks every withdrawal. Third-party riders are not in this plan.
- Reconciliation is read-only: it records a run, raises a fraud case and notifies; it never posts a journal or changes a balance.
- Commands from `/home/righteoushack/projects/TheAshantihub/.worktrees/wallets`: `docker compose -p wal1 run --rm web python manage.py test <label> --noinput`; never two docker commands at once.
- Migrations (after Plan 3a): `wallets` has none yet. This plan adds, in order, all generated: `wallets/0001_payout_destinations.py` (Task 2), `wallets/0002_withdrawals.py` (Task 3), `wallets/0003_reconciliation.py` (Task 6). No accounts migration (Plan 3a's `0054_seed_wallet_permissions` seeded both permissions).
- Style: module docstrings, no type annotations, tests in `wallets/tests/`, plain words in user-facing messages.

## Review Focus

1. **A withdrawal to a destination still in its cooling period** — refused with `409 destination_cooling` and the time it can receive money; nothing held. Pinned in Task 3 (`test_review_focus_a_destination_in_its_cooling_period_cannot_receive_money`) and Task 4 (`test_review_focus_cooling_answers_409_and_the_code_is_kept`).
2. **Two withdrawals of one balance at once** — one is held, the other answers `insufficient_funds`; the balance is never overspent. Pinned in Task 3 (`ConcurrentWithdrawalTests.test_review_focus_two_withdrawals_of_one_balance_at_once_hold_it_once`).
3. **Provider reports duplicated, racing or out of order** — one settlement journal; a final status never changes; "paid" after the money was returned is never posted and opens one fraud case; a different amount is not applied. Pinned in Task 3 (`test_review_focus_reports_are_applied_once_and_never_backwards`, `test_review_focus_a_paid_report_after_the_money_was_returned_opens_a_case`, `test_two_paid_reports_at_once_settle_once`, `test_two_senders_at_once_send_once`).
4. **Balance and limit checks** — a vendor whose Available went negative after a late refund is refused (`negative_balance`); the per-withdrawal and daily limits hold, with failed withdrawals and yesterday's not counted. Pinned in Task 3 (`test_review_focus_a_vendor_with_a_negative_available_cannot_withdraw`, `test_review_focus_limits_per_withdrawal_and_per_day`) and Task 4 (`test_review_focus_a_vendor_with_a_negative_available_is_refused`).
5. **Step-up replay** — the same token cannot pay a second withdrawal, a token for another action is refused, and a refused withdrawal keeps the token. Pinned in Task 4 (`test_review_focus_a_step_up_token_pays_once`, `test_a_code_for_another_action_is_refused`).
6. **Account numbers leaking** — no holder or staff response, activity event or fraud case holds a whole number; Sentry filters `account_number`. Pinned in Task 2 (`test_review_focus_no_response_holds_a_whole_number`, `test_sentry_filters_account_numbers`) and Task 5 (`test_review_focus_failing_a_stuck_withdrawal_returns_the_money_and_logs_no_number`).
7. **Reconciliation false alarms** — payments made while the ledger was off, kinds it does not record, GH₵ 0.00 orders, wallet payments and a payment confirmed just before midnight are not differences; a paid session with no journal is one, and opens one case however often the day is re-run. Pinned in Task 6 (`test_review_focus_payments_the_ledger_was_not_asked_to_record_are_not_differences`, `test_review_focus_a_payment_confirmed_before_midnight_is_not_a_difference_either_day`, `test_review_focus_a_payment_with_no_journal_is_a_difference_and_opens_one_case`).
8. **Switches-off regression** — with the ledger off, the step-up endpoints still answer `otp_off` for wallet actions and every new endpoint answers `ledger_off`. Pinned in Task 1 (`test_review_focus_with_the_ledger_off_nothing_changes`), Task 2 and Task 4 (`LedgerOff...` tests).

## Assumptions made (decided here, cheap to change — for the owner to confirm)

- **B1** Limits: GH₵ 5,000 per withdrawal and GH₵ 10,000 per person per calendar day (Accra time), cooling 24 hours; one pair of limits for customers and vendors alike; all three editable through the money-settings approval.
- **B2** The withdrawal charge is taken out of the amount: ask for X, X − charge arrives; the amount must be more than the charge.
- **B3** While the ledger is on, adding or removing a payout destination and every withdrawal always need a texted or emailed code, whatever `OTP_STEP_UP_ENFORCED` says; the step-up endpoints send codes for those two actions whenever the ledger is on.
- **B4** Name check: the name the network or bank returns must have the same words as the verified name, or contain all of them (at least two words; a middle name or "LTD" may be missing). Customers: their profile name; vendors: the KYC-verified owner name or business name, and only KYC-verified vendors may add destinations. It is checked again at every withdrawal, so renaming a profile makes old destinations unusable until added again (with a new cooling period). The simulated lookup answers the holder's own name.
- **B5** Destinations are never edited (a change = remove + add, new cooling); at most 5 live per person; the business's registered payout details are left as they are and can be copied into a new destination.
- **B6** Simulated payouts settle at once by default (`SIMULATED_PAYOUT_OUTCOME` = succeed, fail or pending). A held withdrawal not yet sent can be cancelled by its holder; staff may fail one stuck 30+ minutes after sending (or 10+ minutes held and never sent), which returns the money.
- **B7** A "paid" report on a withdrawal already failed or cancelled is never posted; it opens a fraud case for staff to check with the provider.
- **B8** Reconciliation runs at 02:30 for the previous day; a mismatch opens one fraud case per day and notifies `wallets.view` holders once; it never corrects anything.
- **B9** Suspended customers and businesses can neither add destinations nor withdraw.

## File Structure

Create:
- `backend/wallets/models.py` (Task 2: `PayoutDestination`; Task 3: `Withdrawal`; Task 6: `ReconciliationRun`), `backend/wallets/migrations/0001_payout_destinations.py`, `0002_withdrawals.py`, `0003_reconciliation.py` (generated)
- `backend/wallets/names.py`, `destinations.py`, `withdrawals.py`, `payouts.py`, `reconciliation.py`, `tasks.py`, `views_payouts.py`
- `backend/wallets/tests/helpers.py`, `test_guards.py`, `test_destinations.py`, `test_withdrawal_engine.py`, `test_withdrawal_api.py`, `test_staff_withdrawals.py`, `test_reconciliation.py`

Modify:
- `backend/ledger/settings_store.py` (three settings), `backend/otp/views_step_up.py` (`_codes_off`)
- `backend/payments/providers.py` (statement, `find`, `pending_payouts`, `day_bounds`, `StatementLine`)
- `backend/wallets/urls.py`, `backend/wallets/views_staff.py`
- `backend/ashantihub/settings.py` (beat entries), `backend/ashantihub/sentry.py` (`account_number`)
- `backend/CLAUDE.md`, `docs/superpowers/specs/2026-10-15-wallet-fees-security-design.md`

API added or changed:

| Method + path | Who | Body → answer |
|---|---|---|
| `GET /api/wallet/destinations/` | customer, owner | → `{results: [{id, rail, institution, account_number_masked, account_name, name_check, usable_from, usable, removed, created_at}], cooling_hours}` |
| `POST /api/wallet/destinations/` | customer, owner + `X-Step-Up-Token` | `{rail, institution, account_number}` or `{from_profile: true}` → 201 destination. 400 `invalid` / `name_mismatch` / `no_profile_details`; 403 `step_up_required` / `suspended`; 409 `kyc_required` / `name_required` / `duplicate` / `too_many` / `name_check_unavailable` |
| `POST /api/wallet/destinations/<id>/remove/` | customer, owner + token | → 204; 404 `not_found` |
| `GET /api/wallet/withdrawals/` | customer, owner | → paginated `{id, reference, amount, charge, you_receive, status, status_label, destination, created_at, settled_at, failure_reason}` |
| `POST /api/wallet/withdrawals/` | customer, owner + token | `{destination, amount, request_id}` → 201 (sent: `succeeded`, `processing` or `failed`) or 200 (a retry of the same `request_id`, no code needed). 400 `invalid` / `below_charge`; 403 `step_up_required` / `suspended`; 404 `unknown_destination`; 409 `destination_cooling` (+ `usable_from`) / `name_mismatch` / `payouts_unavailable` / `over_limit` / `negative_balance` / `insufficient_funds` / `daily_limit` |
| `POST /api/wallet/withdrawals/<id>/cancel/` | the holder | → 200 cancelled (money back); 409 `not_pending`; 404 |
| `GET /api/wallet/staff/withdrawals/?status=open\|succeeded\|failed\|cancelled\|all` | `wallets.view` | → paginated rows with the holder's name, `stuck` |
| `POST /api/wallet/staff/withdrawals/<id>/fail/` | `wallets.manage` + password | `{reason}` → 200 (failed, money back); 409 `not_stuck` |
| `GET /api/wallet/staff/reconciliation/` | `wallets.view` | → `{results: [...]}` the last 30 runs |
| `POST /api/otp/step-up/send/`, `verify/` | changed | with the ledger on, `withdrawal` and `payout_destination` codes are sent whatever the OTP switches say |

---

### Task 1: Governed limits, step-up codes for wallet actions, the name check, spec addendum

**Files:**
- Modify: `backend/ledger/settings_store.py` (`DEFINITIONS`), `backend/otp/views_step_up.py` (`_codes_off`, module text), `docs/superpowers/specs/2026-10-15-wallet-fees-security-design.md` (append)
- Create: `backend/wallets/names.py`, `backend/wallets/tests/test_guards.py`

**Interfaces:**
- Consumes: `ledger.settings_store.Definition`, `ledger.escrow.enabled()`, `otp.step_up.WITHDRAWAL` / `PAYOUT_DESTINATION`.
- Produces:
  - money settings `withdrawal_per_tx_limit_pesewas` (default 500000, 100–10¹⁰), `withdrawal_daily_limit_pesewas` (default 1000000, 100–10¹⁰), `payout_cooling_hours` (default 24, 0–720)
  - `otp.views_step_up.WALLET_ACTIONS = (step_up.WITHDRAWAL, step_up.PAYOUT_DESTINATION)`; `_codes_off(account, action)` is False for those while the ledger is on
  - `wallets.names.words(name) -> set[str]`, `matches(account_name, verified_name) -> bool`, `verified_names(holder) -> list[str]`, `matching_name(account_name, holder) -> str | None`

- [ ] **Step 1: Write the failing test** — `backend/wallets/tests/test_guards.py`

```python
"""Plan 3b groundwork: the withdrawal limits and the cooling period as governed money settings, step-up codes for wallet
actions whenever the ledger is on (spec §8, §11), and the name check. Review Focus 8 (switches off)."""
from django.core.cache import cache
from django.test import SimpleTestCase, TestCase, override_settings
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, BusinessOwnerProfile, Customer
from accounts.testing import make_staff, staff_token
from ledger import settings_store
from otp import senders
from otp.tests.helpers import last_sms_code
from wallets import names


class LimitSettingsTests(TestCase):
    def test_the_new_settings_have_their_defaults(self):
        self.assertEqual(settings_store.current("withdrawal_per_tx_limit_pesewas"), 500_000)
        self.assertEqual(settings_store.current("withdrawal_daily_limit_pesewas"), 1_000_000)
        self.assertEqual(settings_store.current("payout_cooling_hours"), 24)

    def test_their_bounds(self):
        self.assertEqual(settings_store.clean("payout_cooling_hours", 0), 0)
        for key, raw in (("payout_cooling_hours", 721), ("withdrawal_per_tx_limit_pesewas", 99), ("withdrawal_daily_limit_pesewas", None)):
            with self.assertRaises(settings_store.SettingError, msg=f"{key}={raw!r}"):
                settings_store.clean(key, raw)

    def test_they_change_only_through_the_money_setting_approval(self):
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(make_staff('accountant', 'kofi@example.com'))}")
        response = client.post("/api/ledger/settings/", {"key": "payout_cooling_hours", "value": 48}, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(settings_store.current("payout_cooling_hours"), 24)                    # waits for a Super Admin


class WalletStepUpTests(TestCase):
    def setUp(self):
        cache.clear()
        senders.sms_outbox.clear()
        self.customer = Customer.objects.create(full_name="Ama Owusu", phone="+233241234567", password_hash="x")
        self.client = APIClient()
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.customer, 'customer')}")

    def send(self, action):
        return self.client.post("/api/otp/step-up/send/", {"action": action, "channel": "sms"}, format="json")

    @override_settings(LEDGER_ENABLED=True)
    def test_with_the_ledger_on_wallet_actions_get_a_code_whatever_the_otp_switches_say(self):
        for action in ("withdrawal", "payout_destination"):
            with self.subTest(action=action):
                self.assertEqual(self.send(action).status_code, 200)
                verified = self.client.post("/api/otp/step-up/verify/", {"action": action, "code": last_sms_code()}, format="json")
                self.assertEqual(verified.status_code, 200, verified.content)
                self.assertEqual(verified.json()["action"], action)
        self.assertEqual(self.send("contact_change").json()["code"], "otp_off")                # only the wallet actions

    def test_review_focus_with_the_ledger_off_nothing_changes(self):
        response = self.send("withdrawal")
        self.assertEqual((response.status_code, response.json()["code"]), (409, "otp_off"))
        self.assertEqual(senders.sms_outbox, [])


class NameMatchTests(SimpleTestCase):
    def test_the_same_words_in_any_case_order_or_accents_match(self):
        self.assertTrue(names.matches("AMA OWUSU", "Ama Owusu"))
        self.assertTrue(names.matches("Owusu, Ama", "Ama Owusu"))
        self.assertTrue(names.matches("Ábena Ófori", "Abena Ofori"))

    def test_a_missing_middle_name_or_company_suffix_still_matches(self):
        self.assertTrue(names.matches("KWAME ASANTE MENSAH", "Kwame Mensah"))
        self.assertTrue(names.matches("ADEPA VENTURES LTD", "Adepa Ventures"))

    def test_one_word_alone_or_another_person_never_matches(self):
        self.assertFalse(names.matches("MENSAH", "Kwame Mensah"))
        self.assertFalse(names.matches("Kofi Boateng", "Ama Owusu"))
        self.assertFalse(names.matches("", "Ama Owusu"))
        self.assertFalse(names.matches("Ama Owusu", None))


class VerifiedNameTests(TestCase):
    def test_a_customer_has_their_profile_name(self):
        customer = Customer.objects.create(full_name="Ama Owusu", phone="+233241234567", password_hash="x")
        self.assertEqual(names.verified_names(customer), ["Ama Owusu"])
        self.assertEqual(names.matching_name("AMA OWUSU", customer), "Ama Owusu")

    def test_a_vendor_has_names_only_once_kyc_verified(self):
        owner = BusinessOwner.objects.create(full_name="Kwame Mensah", login_phone="+233201112233", password_hash="x")
        BusinessOwnerProfile.objects.create(business_owner=owner, business_name="Adepa Ventures")
        self.assertEqual(names.verified_names(owner), [])
        owner.kyc_status = BusinessOwner.VERIFIED
        owner.save(update_fields=["kyc_status"])
        self.assertEqual(names.verified_names(owner), ["Kwame Mensah", "Adepa Ventures"])
        self.assertEqual(names.matching_name("ADEPA VENTURES LTD", owner), "Adepa Ventures")
        self.assertIsNone(names.matching_name("KOFI BOATENG", owner))
```

- [ ] **Step 2: Run it to see it fail**

Run: `docker compose -p wal1 run --rm web python manage.py test wallets.tests.test_guards --noinput`
Expected: ERROR — `ImportError: cannot import name 'names' from 'wallets'`.

- [ ] **Step 3: The settings** — in `backend/ledger/settings_store.py` replace

```python
    "rider_commission_bp": Definition("Third-party rider commission (basis points; 1000 = 10%)", 1000, False, 0, 10000),
}
```

with

```python
    "rider_commission_bp": Definition("Third-party rider commission (basis points; 1000 = 10%)", 1000, False, 0, 10000),
    # Withdrawals and payout destinations (wallets plan 3b; spec §3.3, §8).
    "withdrawal_per_tx_limit_pesewas": Definition("Most one withdrawal may be (pesewas)", 500_000, False, 100, 10**10),
    "withdrawal_daily_limit_pesewas": Definition("Most one person may withdraw in a day (pesewas)", 1_000_000, False, 100, 10**10),
    "payout_cooling_hours": Definition("Hours a new payout destination waits before it can receive money", 24, False, 0, 720),
}
```

- [ ] **Step 4: Step-up codes for wallet actions** — in `backend/otp/views_step_up.py`, (a) replace

```python
* Only while a code could be owed: OTP_STEP_UP_ENFORCED or OTP_SIGNIN_ENFORCED is on, or - for
  `authenticator_change` alone - the person has an authenticator app on. The authenticator settings ask for a
```

with

```python
* Only while a code could be owed: OTP_STEP_UP_ENFORCED or OTP_SIGNIN_ENFORCED is on, or - for
  `authenticator_change` alone - the person has an authenticator app on, or - for `withdrawal` and
  `payout_destination` - LEDGER_ENABLED is on (the wallet endpoints always ask: spec §8 and §11). The authenticator settings ask for a
```

(b) replace

```python
from rest_framework.response import Response
from rest_framework.views import APIView

from . import authenticator, flags, service, step_up
```

with

```python
from rest_framework.response import Response
from rest_framework.views import APIView

from ledger import escrow

from . import authenticator, flags, service, step_up
```

and (c) replace

```python
def _codes_off(account, action):
    """True when no step-up could be asked of this person for `action`, so no code is sent (see the module text)."""
    if flags.step_up_enforced() or flags.sign_in_enforced():
        return False
    return not (action == step_up.AUTHENTICATOR_CHANGE and authenticator.is_enabled(account))
```

with

```python
# Wallet money actions (wallets plan 3b): while the ledger is on the wallet endpoints always ask for a code
# (step_up.require(..., force=True)), so a code can be sent for them whatever the OTP switches say.
WALLET_ACTIONS = (step_up.WITHDRAWAL, step_up.PAYOUT_DESTINATION)


def _codes_off(account, action):
    """True when no step-up could be asked of this person for `action`, so no code is sent (see the module text)."""
    if flags.step_up_enforced() or flags.sign_in_enforced():
        return False
    if action in WALLET_ACTIONS and escrow.enabled():
        return False
    return not (action == step_up.AUTHENTICATOR_CHANGE and authenticator.is_enabled(account))
```

- [ ] **Step 5: The name check** — `backend/wallets/names.py`

```python
"""Is the name on a payout account the holder's own? (spec §8). A destination is accepted only when the name the
network or bank returns matches a verified name: a customer's profile name; a KYC-verified vendor's owner name or
registered business name. Names are compared as sets of words, accents and punctuation dropped and case ignored:
equal, or every word of the shorter name (at least two words) found in the longer, so a middle name or "LTD" may be
missing. One word alone never matches a longer name."""
import re
import unicodedata

_WORD = re.compile(r"[A-Z0-9]+")


def words(name):
    plain = unicodedata.normalize("NFKD", str(name or "")).encode("ascii", "ignore").decode().upper()
    return set(_WORD.findall(plain))


def matches(account_name, verified_name):
    a, b = words(account_name), words(verified_name)
    if not a or not b:
        return False
    if a == b:
        return True
    shorter, longer = (a, b) if len(a) <= len(b) else (b, a)
    return len(shorter) >= 2 and shorter <= longer


def verified_names(holder):
    """The names a destination may match, or [] when there is none yet (a vendor not KYC-verified, a blank profile)."""
    from accounts.models import BusinessOwner, Customer

    if isinstance(holder, Customer):
        return [holder.full_name] if (holder.full_name or "").strip() else []
    if isinstance(holder, BusinessOwner):
        if holder.kyc_status != BusinessOwner.VERIFIED:
            return []
        profile = getattr(holder, "profile", None)
        business = (profile.business_name or "").strip() if profile is not None else ""
        return [name for name in (holder.full_name, business) if (name or "").strip()]
    return []


def matching_name(account_name, holder):
    """The verified name `account_name` matches, or None."""
    return next((name for name in verified_names(holder) if matches(account_name, name)), None)
```

- [ ] **Step 6: Run the tests**

Run: `docker compose -p wal1 run --rm web python manage.py test wallets.tests.test_guards otp.tests.test_step_up ledger.tests.test_settings_store --noinput`
Expected: PASS — 10 new tests; Plan 2's step-up tests unchanged (they run with the ledger off).

- [ ] **Step 7: Record the decisions in the spec.** Append to the end of `docs/superpowers/specs/2026-10-15-wallet-fees-security-design.md` (after Plan 3a's "Before LEDGER_ENABLED is turned on — Stage 3 additions" list):

```markdown

### Stage 3b (payout destinations, withdrawals, reconciliation) reconciliation (2026-10-16)

Found while writing `docs/superpowers/plans/2026-10-16-withdrawals-3b.md` (§0 there); W1–W7 are above.

- **W8 Payout destinations.** The provider looks up the name on the account; it must match the holder's verified name
  (customer profile name; KYC-verified vendor's owner or business name) as a set of words, and the holder confirms with
  a step-up code. Usable after `payout_cooling_hours` (governed, default 24); never edited (a change is remove + add);
  numbers stored unmasked and sent only through `mask_but_last`. `BusinessOwnerProfile.payout_*` are untouched; a vendor
  may copy them into a new destination.
- **W9 Withdrawals.** Held in withdrawal in transit in the request's transaction, sent once (claimed under a row lock),
  ended by `wallets.payouts.apply_result` (idempotent, amount-checked, monotonic; a "paid" report after the money was
  returned opens a fraud case and is never posted). The holder's charge comes out of the amount sent. Limits per
  withdrawal and per day are governed settings; a negative vendor Available blocks withdrawal.
- **W10 Step-up while the OTP switches are off.** With the ledger on, destinations and withdrawals always ask for a code
  (`force=True`) and the step-up endpoints send codes for those two actions.
- **W11 Reconciliation.** Nightly, by provider reference, read-only; skips what the ledger was not asked to record;
  a difference opens one fraud case per day.

### Before LEDGER_ENABLED is turned on — Stage 3b additions

- (viii) **Wallet step-up is forced while the ledger is on,** so every must-fix in "Before the OTP switches are turned
  on" (notice send limits, a real SMS provider, the secondary-email confirmation) must be done before the ledger is on.
- (ix) **Hubtel payouts, status and name lookups are not connected:** with `PAYMENTS_PROVIDER=hubtel`, adding a
  destination answers `name_check_unavailable`, withdrawals `payouts_unavailable`, and the reconciliation `unavailable`
  until Plan 7.
- (x) **Provider float.** When AshantiHub funds coupons, payouts can exceed collections; a confirmed payout still posts
  and provider clearing may read below zero. Fund the float before go-live and watch the nightly run.
```

- [ ] **Step 8: Commit**

```bash
git add backend/ledger/settings_store.py backend/otp/views_step_up.py backend/wallets/names.py backend/wallets/tests/test_guards.py docs/superpowers/specs/2026-10-15-wallet-fees-security-design.md
git commit -m "feat(wallets): governed withdrawal limits and cooling, step-up codes for wallet actions, name check"
```

---

### Task 2: Payout destinations — add (name-checked, code-confirmed, cooled), list masked, remove

**Files:**
- Create: `backend/wallets/models.py`, `backend/wallets/migrations/0001_payout_destinations.py` (generated), `backend/wallets/destinations.py`, `backend/wallets/views_payouts.py`, `backend/wallets/tests/helpers.py`, `backend/wallets/tests/test_destinations.py`
- Modify: `backend/wallets/urls.py`, `backend/ashantihub/sentry.py` (`EXTRA_DENYLIST`)

**Interfaces:**
- Consumes: `wallets.names` (Task 1), `payments.providers.get_provider().lookup_account_name`, `NotConnected` (Plan 3a), `settings_store.current("payout_cooling_hours")` (Task 1), `otp.step_up.require(request, step_up.PAYOUT_DESTINATION, force=True)`, `otp.identity.ref(account) -> (account_type, account_id)`, `accounts.serializers.mask_but_last`, `accounts.phones.normalize_gh_phone`, `wallets.views.ledger_off` (Plan 3a).
- Produces:
  - model `wallets.PayoutDestination(holder_type, holder_id, rail, institution, account_number, account_name, matched_name, name_source, usable_from, created_at, removed_at)`; `PayoutDestination.MOMO = "momo"`, `BANK = "bank"`; `str()` never contains the number
  - `wallets.destinations`: `DestinationError(message, code, status_code=400, field=None)` with `.body()`, `MAX_LIVE = 5`, `NETWORKS`, `live_for(holder) -> QuerySet`, `clean(data, holder) -> (rail, institution, number)`, `add(holder, data, now=None) -> PayoutDestination`, `remove(holder, destination_id, now=None)`, `row(destination, now=None) -> dict` (with `account_number_masked`)
  - endpoints `GET/POST /api/wallet/destinations/`, `POST /api/wallet/destinations/<id>/remove/`
  - test helpers `wallets.tests.helpers.Holder(account, kind)` (`.client`, `.step_up(action)`, `.post(url, body=None, *, action=None, token=None)`, `.get(url, params=None)`), `fund(kind, owner, pesewas, key)`, `destination(holder, *, number=MOMO_NUMBER, usable=True, name="Ama Owusu", rail="momo", institution="MTN")`, `MOMO_NUMBER = "+233241234567"`

- [ ] **Step 1: Test helpers** — `backend/wallets/tests/helpers.py`

```python
"""Fixtures for the wallets tests (not test cases themselves)."""
from datetime import timedelta

from django.test import RequestFactory
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import AccessToken

from accounts.authentication import issue_token
from ledger import posting
from ledger.models import Account
from otp import step_up
from otp.identity import ref
from wallets.models import PayoutDestination

MOMO_NUMBER = "+233241234567"


class Holder:
    """A signed-in customer or business owner: an API client, and step-up tokens minted for that sign-in (the code
    exchange itself is tested in otp and in test_guards)."""

    def __init__(self, account, kind):
        self.account = account
        self.access = issue_token(account, kind)
        self.client = APIClient()
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.access}")

    def step_up(self, action):
        request = RequestFactory().post("/")
        request.auth = AccessToken(self.access)
        return step_up.issue(self.account, action, request)

    def post(self, url, body=None, *, action=None, token=None):
        headers = {}
        if token is None and action is not None:
            token = self.step_up(action)
        if token is not None:
            headers["HTTP_X_STEP_UP_TOKEN"] = token
        return self.client.post(url, body or {}, format="json", **headers)

    def get(self, url, params=None):
        return self.client.get(url, params or {})


def fund(kind, owner, pesewas, key):
    """Money in a holder's balance through provider clearing, as a top-up (customer) or a release (vendor) leaves it."""
    posting.post(key=key, kind="test_fund", lines=[
        posting.debit(posting.account_for(Account.PROVIDER_CLEARING), pesewas), posting.credit(posting.account_for(kind, owner), pesewas),
    ])


def destination(holder, *, number=MOMO_NUMBER, usable=True, name="Ama Owusu", rail=PayoutDestination.MOMO, institution="MTN"):
    """A payout destination made directly (adding one through the API is tested in test_destinations)."""
    holder_type, holder_id = ref(holder)
    return PayoutDestination.objects.create(
        holder_type=holder_type, holder_id=holder_id, rail=rail, institution=institution, account_number=number,
        account_name=name, matched_name=name, name_source="simulated",
        usable_from=timezone.now() + (timedelta(hours=-1) if usable else timedelta(hours=24)),
    )
```

- [ ] **Step 2: Write the failing test** — `backend/wallets/tests/test_destinations.py`

```python
"""Payout destinations (wallets plan 3b, Task 2; spec §8): name-checked, confirmed with a step-up code, usable after the
cooling period, never shown whole. Review Focus 6 (numbers leaking) and 8 (ledger off)."""
from datetime import timedelta

from django.core.cache import cache
from django.test import SimpleTestCase, TestCase, override_settings
from django.utils import timezone

from accounts.models import BusinessOwner, BusinessOwnerProfile, Customer
from ashantihub.sentry import EXTRA_DENYLIST
from ledger.models import MoneySetting
from otp import step_up
from wallets.models import PayoutDestination

from .helpers import MOMO_NUMBER, Holder, destination

URL = "/api/wallet/destinations/"
MOMO = {"rail": "momo", "institution": "MTN", "account_number": "024 123 4567"}


class DestinationBase(TestCase):
    def setUp(self):
        cache.clear()
        self.customer = Customer.objects.create(full_name="Ama Owusu", phone="+233241234567", password_hash="x")
        self.ama = Holder(self.customer, "customer")

    def add(self, holder=None, body=MOMO, **kwargs):
        holder = holder or self.ama
        if "token" not in kwargs:
            kwargs["action"] = step_up.PAYOUT_DESTINATION
        return holder.post(URL, body, **kwargs)

    def kyc_vendor(self, **profile):
        owner = BusinessOwner.objects.create(
            full_name="Kwame Mensah", login_phone="+233201112233", password_hash="x", kyc_status=BusinessOwner.VERIFIED,
        )
        BusinessOwnerProfile.objects.create(business_owner=owner, business_name="Adepa Ventures", **profile)
        return owner


class LedgerOffDestinationTests(DestinationBase):
    def test_review_focus_destinations_say_ledger_off(self):
        self.assertEqual(self.ama.get(URL).json()["code"], "ledger_off")
        response = self.add()
        self.assertEqual((response.status_code, response.json()["code"]), (409, "ledger_off"))
        self.assertFalse(PayoutDestination.objects.exists())


@override_settings(LEDGER_ENABLED=True)
class DestinationTests(DestinationBase):
    def test_adding_needs_a_step_up_code_even_with_the_otp_switches_off(self):
        response = self.ama.post(URL, MOMO)
        self.assertEqual((response.status_code, response.json()["code"]), (403, "step_up_required"), response.content)
        self.assertFalse(PayoutDestination.objects.exists())

    def test_a_customer_adds_a_momo_number_in_their_own_name(self):
        response = self.add()
        self.assertEqual(response.status_code, 201, response.content)
        body = response.json()
        self.assertEqual(
            (body["rail"], body["institution"], body["account_number_masked"], body["account_name"], body["name_check"], body["usable"]),
            ("momo", "MTN", "••••••••34567", "Ama Owusu", "simulated", False),
        )
        saved = PayoutDestination.objects.get()
        self.assertEqual((saved.account_number, saved.matched_name, saved.holder_type), (MOMO_NUMBER, "Ama Owusu", "customer"))
        self.assertAlmostEqual(saved.usable_from, timezone.now() + timedelta(hours=24), delta=timedelta(minutes=1))

    def test_a_name_that_does_not_match_is_refused_and_the_code_is_kept(self):
        token = self.ama.step_up(step_up.PAYOUT_DESTINATION)
        with override_settings(SIMULATED_ACCOUNT_NAMES={MOMO_NUMBER: "KOFI BOATENG"}):
            refused = self.ama.post(URL, MOMO, token=token)
        self.assertEqual((refused.status_code, refused.json()["code"]), (400, "name_mismatch"))
        self.assertNotIn("KOFI", refused.content.decode())                                       # never someone else's name
        again = self.ama.post(URL, {**MOMO, "account_number": "0241234568"}, token=token)
        self.assertEqual(again.status_code, 201, again.content)

    def test_a_vendor_needs_kyc_and_may_match_its_business_name(self):
        owner = BusinessOwner.objects.create(full_name="Kwame Mensah", login_phone="+233201112233", password_hash="x")
        kwame = Holder(owner, "business_owner")
        refused = self.add(kwame)
        self.assertEqual((refused.status_code, refused.json()["code"]), (409, "kyc_required"))
        owner.kyc_status = BusinessOwner.VERIFIED
        owner.save(update_fields=["kyc_status"])
        BusinessOwnerProfile.objects.create(business_owner=owner, business_name="Adepa Ventures")
        with override_settings(SIMULATED_ACCOUNT_NAMES={MOMO_NUMBER: "ADEPA VENTURES LTD"}):
            response = self.add(kwame)
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(PayoutDestination.objects.get(holder_type="business_owner").matched_name, "Adepa Ventures")

    def test_a_vendor_may_copy_its_registered_payout_details(self):
        owner = self.kyc_vendor(default_payout_method="momo", payout_momo_network="mtn", payout_momo_number="0201112233")
        response = self.add(Holder(owner, "business_owner"), {"from_profile": True})
        self.assertEqual(response.status_code, 201, response.content)
        saved = PayoutDestination.objects.get()
        self.assertEqual((saved.rail, saved.institution, saved.account_number), ("momo", "MTN", "+233201112233"))
        owner.profile.refresh_from_db()
        self.assertEqual(owner.profile.payout_momo_number, "0201112233")                          # the registered details are untouched

    def test_bad_details_are_refused(self):
        cases = (
            {"rail": "card", "institution": "MTN", "account_number": "0241234567"},
            {"rail": "momo", "institution": "Vodafone", "account_number": "0241234567"},
            {"rail": "momo", "institution": "MTN", "account_number": "12345"},
            {"rail": "bank", "institution": "GCB Bank", "account_number": "12ab34"},
            {"rail": "bank", "institution": "", "account_number": "1234567890"},
            {"from_profile": True},
        )
        for body in cases:
            with self.subTest(body=body):
                response = self.add(body=body)
                self.assertEqual(response.status_code, 400, response.content)
        self.assertFalse(PayoutDestination.objects.exists())

    def test_a_bank_account_is_kept_as_digits(self):
        response = self.add(body={"rail": "bank", "institution": "GCB Bank", "account_number": "1234-5678-9012"})
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.json()["account_number_masked"], "•••••••89012")
        self.assertEqual(PayoutDestination.objects.get().account_number, "123456789012")

    def test_duplicates_and_more_than_five_are_refused(self):
        self.assertEqual(self.add().status_code, 201)
        self.assertEqual(self.add().json()["code"], "duplicate")
        for last in range(1, 5):
            self.assertEqual(self.add(body={**MOMO, "account_number": f"024123450{last}"}).status_code, 201)
        too_many = self.add(body={**MOMO, "account_number": "0241234509"})
        self.assertEqual((too_many.status_code, too_many.json()["code"]), (409, "too_many"))

    def test_removing_needs_a_code_and_only_your_own(self):
        mine = destination(self.customer)
        other = destination(Customer.objects.create(full_name="Kojo Asare", phone="+233241234568", password_hash="x"), name="Kojo Asare")
        self.assertEqual(self.ama.post(f"{URL}{mine.pk}/remove/").status_code, 403)
        self.assertEqual(self.ama.post(f"{URL}{other.pk}/remove/", action=step_up.PAYOUT_DESTINATION).status_code, 404)
        self.assertEqual(self.ama.post(f"{URL}{mine.pk}/remove/", action=step_up.PAYOUT_DESTINATION).status_code, 204)
        mine.refresh_from_db()
        self.assertIsNotNone(mine.removed_at)
        self.assertEqual(self.ama.get(URL).json()["results"], [])

    def test_review_focus_no_response_holds_a_whole_number(self):
        added = self.add()
        listed = self.ama.get(URL)
        for response in (added, listed):
            self.assertNotIn("241234567", response.content.decode())
        self.assertEqual(listed.json()["results"][0]["account_number_masked"], "••••••••34567")
        self.assertEqual(listed.json()["cooling_hours"], 24)
        self.assertNotIn("241234567", str(PayoutDestination.objects.get()))

    def test_the_cooling_period_is_the_governed_setting(self):
        MoneySetting.objects.create(key="payout_cooling_hours", value=0, effective_from=timezone.now() - timedelta(days=1))
        self.assertTrue(self.add().json()["usable"])

    @override_settings(PAYMENTS_PROVIDER="hubtel")
    def test_with_hubtel_names_cannot_be_checked_yet(self):
        response = self.add()
        self.assertEqual((response.status_code, response.json()["code"]), (409, "name_check_unavailable"))

    def test_a_suspended_account_cannot_add_one(self):
        Customer.objects.filter(pk=self.customer.pk).update(is_suspended=True)
        response = self.add()
        self.assertEqual((response.status_code, response.json()["code"]), (403, "suspended"))


class SentryTests(SimpleTestCase):
    def test_sentry_filters_account_numbers(self):
        self.assertIn("account_number", EXTRA_DENYLIST)
```

- [ ] **Step 3: Run it to see it fail**

Run: `docker compose -p wal1 run --rm web python manage.py test wallets.tests.test_destinations --noinput`
Expected: ERROR — `ImportError: cannot import name 'PayoutDestination' from 'wallets.models'` (the module does not exist).

- [ ] **Step 4: The model** — `backend/wallets/models.py`

```python
"""Payout destinations, withdrawals and reconciliation runs (spec §8, §2.2 step 5, §2). Account numbers are stored
unmasked, like the business payout details, and only ever leave the server through accounts.serializers.mask_but_last."""
from django.db import models


class PayoutDestination(models.Model):
    """A MoMo number or bank account a customer or business owner may withdraw to. Accepted only when the name the
    network or bank returns matches the holder's verified name and the holder confirmed it with a step-up code; it can
    receive money from `usable_from` (the cooling period). Never edited: a change is a removal plus a new one."""

    MOMO, BANK = "momo", "bank"
    RAIL_CHOICES = [(MOMO, "Mobile money"), (BANK, "Bank account")]

    holder_type = models.CharField(max_length=20)            # "customer" or "business_owner" (otp.identity.ref)
    holder_id = models.PositiveBigIntegerField()
    rail = models.CharField(max_length=4, choices=RAIL_CHOICES)
    institution = models.CharField(max_length=60)            # the MoMo network or the bank
    account_number = models.CharField(max_length=30)         # unmasked; shown only through mask_but_last
    account_name = models.CharField(max_length=150)          # what the network or bank answered
    matched_name = models.CharField(max_length=150)          # the verified name it matched
    name_source = models.CharField(max_length=20)            # the provider that answered ("simulated" says so)
    usable_from = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True)
    removed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [models.Index(fields=["holder_type", "holder_id", "removed_at"])]
        constraints = [
            models.UniqueConstraint(
                fields=["holder_type", "holder_id", "rail", "account_number"], condition=models.Q(removed_at__isnull=True),
                name="wallets_one_live_destination_per_account",
            ),
        ]

    def __str__(self):
        return f"{self.get_rail_display()} ({self.institution}) of {self.holder_type} {self.holder_id}"  # never the number
```

Run: `docker compose -p wal1 run --rm web python manage.py makemigrations wallets --name payout_destinations`
Expected: `backend/wallets/migrations/__init__.py` and `0001_payout_destinations.py` with `CreateModel` `PayoutDestination` (its index and conditional unique constraint).

- [ ] **Step 5: The service** — `backend/wallets/destinations.py`

```python
"""Payout destinations (spec §8): a MoMo number or bank account a customer or business owner may withdraw to.

Adding one: the holder proves it is them with a step-up code (the view spends it in the same transaction, so a refused
add keeps the code); the provider looks up the name on the account and that name must match a verified name
(wallets.names); it can receive money from `usable_from` = now + `payout_cooling_hours` (governed, default 24). A
destination is never edited: a change is a removal and a new one, with a new cooling period. The business's registered
payout details (BusinessOwnerProfile.payout_*) are left as they are; `from_profile` copies them into a new destination.
Numbers are stored unmasked and only ever leave the server through mask_but_last."""
import re
from datetime import timedelta

from django.db import IntegrityError, transaction
from django.utils import timezone

from accounts.models import BusinessOwner, BusinessOwnerProfile
from accounts.phones import normalize_gh_phone
from accounts.serializers import mask_but_last
from ledger import settings_store
from otp.identity import ref
from payments import providers

from . import names
from .models import PayoutDestination

MAX_LIVE = 5
NETWORKS = {"MTN": "MTN", "TELECEL": "Telecel", "AIRTELTIGO": "AirtelTigo"}
_BANK_NUMBER = re.compile(r"[0-9]{6,20}")


class DestinationError(Exception):
    def __init__(self, message, code, status_code=400, field=None):
        super().__init__(message)
        self.message, self.code, self.status_code, self.field = message, code, status_code, field

    def body(self):
        data = {"detail": self.message, "code": self.code}
        if self.field:
            data["field"] = self.field
        return data


def live_for(holder):
    holder_type, holder_id = ref(holder)
    return PayoutDestination.objects.filter(holder_type=holder_type, holder_id=holder_id, removed_at__isnull=True)


def _from_profile(holder):
    profile = BusinessOwnerProfile.objects.filter(business_owner_id=holder.pk).first() if isinstance(holder, BusinessOwner) else None
    if profile is None or profile.default_payout_method not in (BusinessOwnerProfile.MOMO, BusinessOwnerProfile.BANK) or not profile.has_payout_details():
        raise DestinationError("There are no registered payout details to use.", "no_profile_details")
    if profile.default_payout_method == BusinessOwnerProfile.MOMO:
        return {"rail": PayoutDestination.MOMO, "institution": profile.payout_momo_network, "account_number": profile.payout_momo_number}
    return {"rail": PayoutDestination.BANK, "institution": profile.payout_bank_name, "account_number": profile.payout_bank_account_number}


def clean(data, holder):
    """(rail, institution, account_number) from a request body, normalised: a MoMo number as +233…, a bank account as
    digits. Raises DestinationError (400) naming the field."""
    if data.get("from_profile") is True:
        data = _from_profile(holder)
    rail = data.get("rail")
    if rail not in (PayoutDestination.MOMO, PayoutDestination.BANK):
        raise DestinationError("Choose mobile money or a bank account.", "invalid", field="rail")
    institution = str(data.get("institution") or "").strip()
    number = str(data.get("account_number") or "").strip()
    if rail == PayoutDestination.MOMO:
        network = NETWORKS.get(re.sub(r"[^A-Z]", "", institution.upper()))
        if network is None:
            raise DestinationError("Choose MTN, Telecel or AirtelTigo.", "invalid", field="institution")
        try:
            return rail, network, normalize_gh_phone(number)
        except ValueError as exc:
            raise DestinationError(str(exc), "invalid", field="account_number") from None
    if not institution or len(institution) > 60:
        raise DestinationError("Name the bank.", "invalid", field="institution")
    digits = re.sub(r"[\s-]", "", number)
    if not _BANK_NUMBER.fullmatch(digits):
        raise DestinationError("A bank account number is 6 to 20 digits.", "invalid", field="account_number")
    return rail, institution, digits


def add(holder, data, now=None):
    """Check and save a new destination for `holder`. The caller has already spent the step-up code inside the same
    transaction. Raises DestinationError, saving nothing, when anything is wrong."""
    now = now or timezone.now()
    if getattr(holder, "is_suspended", False):
        raise DestinationError("This account is suspended.", "suspended", 403)
    verified = names.verified_names(holder)
    if not verified:
        if isinstance(holder, BusinessOwner):
            raise DestinationError("Your business must pass KYC before money can be paid out to it.", "kyc_required", 409)
        raise DestinationError("Add your full name to your profile first.", "name_required", 409)
    rail, institution, number = clean(data if isinstance(data, dict) else {}, holder)
    holder_type, holder_id = ref(holder)
    live = live_for(holder)
    if live.filter(rail=rail, account_number=number).exists():
        raise DestinationError("That account is already one of your payout destinations.", "duplicate", 409)
    if live.count() >= MAX_LIVE:
        raise DestinationError(f"You can keep at most {MAX_LIVE} payout destinations. Remove one first.", "too_many", 409)
    provider = providers.get_provider()
    try:
        account_name = provider.lookup_account_name(rail, institution, number, holder_name=verified[0])
    except providers.NotConnected:
        raise DestinationError("Account names can't be checked yet, so payout destinations can't be added.", "name_check_unavailable", 409) from None
    matched = names.matching_name(account_name, holder) if account_name else None
    if matched is None:
        # Never echo the name the network answered: it may be someone else's.
        raise DestinationError("The name on that account doesn't match the name we have verified for you.", "name_mismatch", 400)
    hours = settings_store.current("payout_cooling_hours", now)
    try:
        with transaction.atomic():
            return PayoutDestination.objects.create(
                holder_type=holder_type, holder_id=holder_id, rail=rail, institution=institution, account_number=number,
                account_name=account_name[:150], matched_name=matched[:150], name_source=provider.name,
                usable_from=now + timedelta(hours=hours),
            )
    except IntegrityError:
        raise DestinationError("That account is already one of your payout destinations.", "duplicate", 409) from None


def remove(holder, destination_id, now=None):
    """Stop paying to a live destination of `holder` (a withdrawal already sent still completes)."""
    now = now or timezone.now()
    destination = live_for(holder).select_for_update().filter(pk=destination_id).first()
    if destination is None:
        raise DestinationError("That payout destination isn't yours, or it was already removed.", "not_found", 404)
    destination.removed_at = now
    destination.save(update_fields=["removed_at"])
    return destination


def row(destination, now=None):
    """What a holder or staff member sees of a destination: the number masked, always."""
    now = now or timezone.now()
    return {
        "id": destination.pk, "rail": destination.rail, "institution": destination.institution,
        "account_number_masked": mask_but_last(destination.account_number), "account_name": destination.account_name,
        "name_check": destination.name_source, "usable_from": destination.usable_from,
        "usable": destination.removed_at is None and destination.usable_from <= now,
        "removed": destination.removed_at is not None, "created_at": destination.created_at,
    }
```

- [ ] **Step 6: The views and URLs** — `backend/wallets/views_payouts.py`

```python
"""Payout destinations and withdrawals for customers and business owners (spec §8, §2.2 step 5), at /api/wallet/.
Adding or removing a destination and asking for a withdrawal need a step-up code (X-Step-Up-Token) whenever the ledger
is on, whatever OTP_STEP_UP_ENFORCED says (force=True; spec §8 and §11: OTP must precede any wallet going live). The
code is spent inside the transaction that saves, so a refused request keeps it for the retry. Every endpoint answers
409 ledger_off while the ledger is off."""
from django.db import transaction
from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from ledger import escrow, settings_store
from otp import step_up
from otp.views_authenticator import IsCustomerOrOwner

from . import destinations
from .views import ledger_off


class DestinationsView(APIView):
    """GET destinations/ — the holder's live payout destinations (numbers masked) and the cooling period in force.
    POST destinations/ {rail, institution, account_number} or {from_profile: true} + X-Step-Up-Token — add one."""

    permission_classes = [IsCustomerOrOwner]

    def get(self, request):
        if not escrow.enabled():
            return ledger_off()
        now = timezone.now()
        return Response({
            "results": [destinations.row(destination, now) for destination in destinations.live_for(request.user)],
            "cooling_hours": settings_store.current("payout_cooling_hours", now),
        })

    def post(self, request):
        if not escrow.enabled():
            return ledger_off()
        data = request.data if isinstance(request.data, dict) else {}
        try:
            with transaction.atomic():
                step_up.require(request, step_up.PAYOUT_DESTINATION, force=True)
                destination = destinations.add(request.user, data)
        except destinations.DestinationError as exc:
            return Response(exc.body(), status=exc.status_code)
        return Response(destinations.row(destination), status=status.HTTP_201_CREATED)


class DestinationRemoveView(APIView):
    """POST destinations/<id>/remove/ + X-Step-Up-Token — stop paying to it."""

    permission_classes = [IsCustomerOrOwner]

    def post(self, request, pk):
        if not escrow.enabled():
            return ledger_off()
        try:
            with transaction.atomic():
                step_up.require(request, step_up.PAYOUT_DESTINATION, force=True)
                destinations.remove(request.user, pk)
        except destinations.DestinationError as exc:
            return Response(exc.body(), status=exc.status_code)
        return Response(status=status.HTTP_204_NO_CONTENT)
```

In `backend/wallets/urls.py` replace

```python
from . import views, views_staff
```

with

```python
from . import views, views_payouts, views_staff
```

and replace

```python
    path("top-up/", views.TopUpView.as_view(), name="wallet-top-up"),
]
```

with

```python
    path("top-up/", views.TopUpView.as_view(), name="wallet-top-up"),
    path("destinations/", views_payouts.DestinationsView.as_view(), name="wallet-destinations"),
    path("destinations/<int:pk>/remove/", views_payouts.DestinationRemoveView.as_view(), name="wallet-destination-remove"),
]
```

- [ ] **Step 7: Sentry** — in `backend/ashantihub/sentry.py` replace

```python
    "body", "codes", "uri", "recovery", "normalised",
]
```

with

```python
    "body", "codes", "uri", "recovery", "normalised",
    # Payout destinations (wallets): a whole MoMo or bank account number in a request body or a frame.
    "account_number",
]
```

- [ ] **Step 8: Run the tests**

Run: `docker compose -p wal1 run --rm web python manage.py test wallets core.tests.test_sentry_scrubber --noinput`
Expected: PASS (15 new tests; Plan 3a's wallets tests and the scrubber tests unchanged).

- [ ] **Step 9: Commit**

```bash
git add backend/wallets backend/ashantihub/sentry.py
git commit -m "feat(wallets): payout destinations - name-checked, step-up confirmed, cooling period, masked"
```

---

### Task 3: The withdrawal engine — hold, send once, settle or return exactly once

**Files:**
- Modify: `backend/wallets/models.py` (`Withdrawal`), `backend/ashantihub/settings.py` (`CELERY_BEAT_SCHEDULE`)
- Create: `backend/wallets/migrations/0002_withdrawals.py` (generated), `backend/wallets/withdrawals.py`, `backend/wallets/payouts.py`, `backend/wallets/tasks.py`, `backend/wallets/tests/test_withdrawal_engine.py`

**Interfaces:**
- Consumes: `PayoutDestination`, `destinations.row` (Task 2), `names.matching_name` (Task 1), settings `withdrawal_per_tx_limit_pesewas` / `withdrawal_daily_limit_pesewas` (Task 1), `posting.lock`, `posting.post(..., allow_negative=...)`, `posting.balance_of` (Plan 3a), `providers.get_provider(name)`, `.payout(...)`, `.status(reference)`, `.payout_charge(...)`, `.payouts_available()`, `SUCCEEDED`/`FAILED`/`PROCESSING` (Plan 3a), `fraud.services.raise_flag`, `notifications.services.notify_customer` / `notify_business_owner`, `wallets.services.money` (Plan 3a).
- Produces:
  - model `wallets.Withdrawal(reference, holder_type, holder_id, source_kind, destination, request_id, amount_pesewas, charge_pesewas, net_pesewas, status, provider, provider_reference, failure_reason, created_at, submitted_at, settled_at)`; statuses `PENDING`, `PROCESSING`, `SUCCEEDED`, `FAILED`, `CANCELLED`; groups `OPEN`, `FINAL`, `COUNTED`
  - `wallets.withdrawals`: `WithdrawalError(message, code, status_code=409, **extra)` with `.code`, `.body()`; `hold_key(ref)`, `paid_key(ref)`, `reversed_key(ref)`; `source_kind(holder)`; `start_of_day(now)`; `clean_request_id(raw) -> str`; `mine(holder)`; `existing(holder, request_id)`; `request(holder, *, destination_id, amount_pesewas, request_id, now=None) -> Withdrawal` (call inside `transaction.atomic()`); `cancel(holder, withdrawal_id, now=None) -> Withdrawal`; `row(withdrawal) -> dict`
  - `wallets.payouts`: `RESEND_AFTER`, `ASK_AFTER` (2 minutes), `STUCK_AFTER` (30 minutes), `STUCK_PENDING` (10 minutes); `holder_of(w)`; `claim(pk, now=None)`; `submit(pk, now=None) -> Withdrawal`; `apply_result(reference, status, *, provider_reference="", amount_pesewas=None, message="", now=None) -> Withdrawal | None`; `close(w, status, reason, now) -> Withdrawal` (row locked by the caller); `stuck(w, now=None) -> bool`; `poll(now=None) -> int`
  - Celery task `wallets.tasks.poll_withdrawals`; beat entry `"wallets-poll-withdrawals"` (every 300 s)

- [ ] **Step 1: Write the failing test** — `backend/wallets/tests/test_withdrawal_engine.py`

```python
"""The withdrawal engine (wallets plan 3b, Task 3; spec §2.2 step 5, §6, §8). Review Focus 1 (cooling), 2 (double
withdrawal), 3 (duplicate, racing and out-of-order reports) and 4 (negative Available and the limits)."""
import threading
from datetime import timedelta
from unittest import mock

from django.conf import settings
from django.db import connection, transaction
from django.test import TestCase, TransactionTestCase, override_settings
from django.utils import timezone

from accounts.models import BusinessOwner, Customer
from fraud.models import FraudFlag
from ledger import posting
from ledger.models import Account, Journal, MoneySetting
from notifications.models import Notification
from payments import providers
from wallets import payouts, tasks, withdrawals
from wallets.models import Withdrawal

from .helpers import destination, fund


@override_settings(LEDGER_ENABLED=True)
class EngineTests(TestCase):
    def setUp(self):
        self.customer = Customer.objects.create(full_name="Ama Owusu", phone="+233241234567", password_hash="x")
        self.dest = destination(self.customer)
        fund(Account.CUSTOMER_WALLET, self.customer, 20000, "fund-1")
        self.n = 0

    def withdraw(self, amount, *, holder=None, dest=None, request_id=None):
        self.n += 1
        return withdrawals.request(
            holder or self.customer, destination_id=(dest or self.dest).pk, amount_pesewas=amount, request_id=request_id or f"req-{self.n:08d}",
        )

    def refused(self, code, amount=5000, **kwargs):
        with self.assertRaises(withdrawals.WithdrawalError) as caught:
            self.withdraw(amount, **kwargs)
        self.assertEqual(caught.exception.code, code, caught.exception.message)
        return caught.exception

    def wallet(self):
        return posting.balance_of(Account.CUSTOMER_WALLET, self.customer)

    def transit(self):
        return posting.balance_of(Account.WITHDRAWAL_IN_TRANSIT)

    def test_a_request_holds_the_amount_in_transit(self):
        held = self.withdraw(5000)
        self.assertEqual((held.status, held.amount_pesewas, held.charge_pesewas, held.net_pesewas, held.provider), (Withdrawal.PENDING, 5000, 0, 5000, "simulated"))
        self.assertTrue(held.reference.startswith("AH-WD-"))
        self.assertEqual((self.wallet(), self.transit()), (15000, 5000))
        self.assertTrue(Journal.objects.filter(key=f"withdrawal-hold-{held.reference}").exists())

    def test_a_simulated_payout_settles_at_once_and_tells_the_holder(self):
        paid = payouts.submit(self.withdraw(5000).pk)
        self.assertEqual((paid.status, paid.provider_reference), (Withdrawal.SUCCEEDED, f"SIM-{paid.reference}"))
        self.assertIsNotNone(paid.settled_at)
        self.assertEqual((self.wallet(), self.transit()), (15000, 0))
        self.assertEqual(posting.balance_of(Account.PROVIDER_CLEARING), 15000)
        self.assertEqual(Notification.objects.filter(customer=self.customer).latest("id").title, "Your withdrawal was paid")

    @override_settings(SIMULATED_PAYOUT_CHARGE_PESEWAS=150)
    def test_the_holder_bears_the_withdrawal_charge(self):
        paid = payouts.submit(self.withdraw(5000).pk)
        self.assertEqual((paid.charge_pesewas, paid.net_pesewas), (150, 4850))
        self.assertEqual(self.wallet(), 15000)
        self.assertEqual(posting.balance_of(Account.PROVIDER_CLEARING), 15000)                 # 4850 sent + 150 kept by the provider
        self.refused("below_charge", amount=150)

    @override_settings(SIMULATED_PAYOUT_OUTCOME="fail")
    def test_a_failed_payout_returns_the_money(self):
        failed = payouts.submit(self.withdraw(5000).pk)
        self.assertEqual(failed.status, Withdrawal.FAILED)
        self.assertTrue(failed.failure_reason)
        self.assertEqual((self.wallet(), self.transit()), (20000, 0))
        self.assertTrue(Journal.objects.filter(key=f"withdrawal-reversed-{failed.reference}").exists())

    def test_a_payout_the_provider_has_not_answered_is_settled_by_the_poll(self):
        with override_settings(SIMULATED_PAYOUT_OUTCOME="pending"):
            sent = payouts.submit(self.withdraw(5000).pk)
        self.assertEqual(sent.status, Withdrawal.PROCESSING)
        self.assertEqual(payouts.poll(), 0)                                                    # asked too soon
        Withdrawal.objects.filter(pk=sent.pk).update(submitted_at=timezone.now() - timedelta(minutes=3))
        self.assertEqual(payouts.poll(), 1)
        sent.refresh_from_db()
        self.assertEqual(sent.status, Withdrawal.SUCCEEDED)
        self.assertEqual(self.transit(), 0)

    def test_the_poll_sends_a_held_withdrawal_nobody_sent(self):
        held = self.withdraw(5000)
        Withdrawal.objects.filter(pk=held.pk).update(created_at=timezone.now() - timedelta(minutes=3))
        self.assertEqual(tasks.poll_withdrawals(), 1)
        held.refresh_from_db()
        self.assertEqual(held.status, Withdrawal.SUCCEEDED)
        self.assertEqual(settings.CELERY_BEAT_SCHEDULE["wallets-poll-withdrawals"]["task"], "wallets.tasks.poll_withdrawals")

    def test_review_focus_reports_are_applied_once_and_never_backwards(self):
        with override_settings(SIMULATED_PAYOUT_OUTCOME="pending"):
            sent = payouts.submit(self.withdraw(5000).pk)
        payouts.apply_result(sent.reference, providers.SUCCEEDED, amount_pesewas=5000)
        payouts.apply_result(sent.reference, providers.SUCCEEDED, amount_pesewas=5000)        # a duplicate
        payouts.apply_result(sent.reference, providers.FAILED)                                 # late and out of order
        sent.refresh_from_db()
        self.assertEqual(sent.status, Withdrawal.SUCCEEDED)
        self.assertEqual(Journal.objects.filter(kind="withdrawal_paid").count(), 1)
        self.assertFalse(Journal.objects.filter(kind="withdrawal_reversed").exists())
        self.assertEqual(self.wallet(), 15000)

    def test_review_focus_a_paid_report_after_the_money_was_returned_opens_a_case(self):
        with override_settings(SIMULATED_PAYOUT_OUTCOME="fail"):
            failed = payouts.submit(self.withdraw(5000).pk)
        payouts.apply_result(failed.reference, providers.SUCCEEDED)
        payouts.apply_result(failed.reference, providers.SUCCEEDED)
        failed.refresh_from_db()
        self.assertEqual(failed.status, Withdrawal.FAILED)
        self.assertFalse(Journal.objects.filter(kind="withdrawal_paid").exists())
        self.assertEqual(self.wallet(), 20000)
        flags = FraudFlag.objects.filter(dedupe_key=f"withdrawal-late-paid-{failed.reference}")
        self.assertEqual(flags.count(), 1)
        self.assertNotIn("241234567", flags.get().detail)                                       # no account number in the case

    def test_a_report_for_a_different_amount_is_not_applied(self):
        with override_settings(SIMULATED_PAYOUT_OUTCOME="pending"):
            sent = payouts.submit(self.withdraw(5000).pk)
        payouts.apply_result(sent.reference, providers.SUCCEEDED, amount_pesewas=4000)
        sent.refresh_from_db()
        self.assertEqual(sent.status, Withdrawal.PROCESSING)
        self.assertEqual(self.transit(), 5000)
        self.assertTrue(FraudFlag.objects.filter(dedupe_key=f"withdrawal-amount-{sent.reference}").exists())

    def test_an_unknown_reference_is_ignored(self):
        self.assertIsNone(payouts.apply_result("AH-WD-NOSUCH0000", providers.SUCCEEDED))

    def test_review_focus_a_destination_in_its_cooling_period_cannot_receive_money(self):
        cooling = destination(self.customer, number="+233241234599", usable=False)
        error = self.refused("destination_cooling", dest=cooling)
        self.assertEqual(error.body()["usable_from"], cooling.usable_from.isoformat())
        self.assertEqual((self.wallet(), Withdrawal.objects.count()), (20000, 0))

    def test_a_removed_or_someone_elses_destination_is_refused(self):
        removed = destination(self.customer, number="+233241234598")
        removed.removed_at = timezone.now()
        removed.save(update_fields=["removed_at"])
        self.refused("unknown_destination", dest=removed)
        kojo = Customer.objects.create(full_name="Kojo Asare", phone="+233241234568", password_hash="x")
        self.refused("unknown_destination", dest=destination(kojo, number="+233241234597", name="Kojo Asare"))

    def test_a_renamed_holder_must_add_the_destination_again(self):
        Customer.objects.filter(pk=self.customer.pk).update(full_name="Akosua Mensah")
        self.customer.refresh_from_db()
        self.refused("name_mismatch")

    def test_review_focus_limits_per_withdrawal_and_per_day(self):
        now = timezone.now()
        MoneySetting.objects.create(key="withdrawal_per_tx_limit_pesewas", value=6000, effective_from=now - timedelta(days=1))
        MoneySetting.objects.create(key="withdrawal_daily_limit_pesewas", value=10000, effective_from=now - timedelta(days=1))
        self.refused("over_limit", amount=6001)
        first = self.withdraw(6000)
        error = self.refused("daily_limit", amount=5000)
        self.assertEqual(error.message, "You can withdraw GH₵ 40.00 more today.")
        Withdrawal.objects.filter(pk=first.pk).update(status=Withdrawal.FAILED)                   # a failed one does not count
        self.withdraw(5000)
        self.refused("daily_limit", amount=6000)
        Withdrawal.objects.filter(holder_id=self.customer.pk).update(created_at=now - timedelta(days=1))
        self.withdraw(6000)                                                                         # yesterday's do not count today

    def test_more_than_the_balance_is_refused(self):
        self.assertEqual(self.refused("insufficient_funds", amount=20001).message, "You have GH₵ 200.00 to withdraw.")

    def test_review_focus_a_vendor_with_a_negative_available_cannot_withdraw(self):
        owner = BusinessOwner.objects.create(
            full_name="Kwame Mensah", login_phone="+233201112233", password_hash="x", kyc_status=BusinessOwner.VERIFIED,
        )
        to_kwame = destination(owner, number="+233201112233", name="Kwame Mensah")
        fund(Account.VENDOR_AVAILABLE, owner, 5000, "fund-vendor")
        held = self.withdraw(3000, holder=owner, dest=to_kwame)
        self.assertEqual((held.source_kind, posting.balance_of(Account.VENDOR_AVAILABLE, owner)), (Account.VENDOR_AVAILABLE, 2000))
        posting.post(key="late-refund", kind="test", lines=[                                       # a late refund drives it below zero
            posting.debit(posting.account_for(Account.VENDOR_AVAILABLE, owner), 2500),
            posting.credit(posting.account_for(Account.CUSTOMER_WALLET, self.customer), 2500),
        ])
        self.refused("negative_balance", amount=100, holder=owner, dest=to_kwame)

    @override_settings(PAYMENTS_PROVIDER="hubtel")
    def test_with_hubtel_payouts_are_unavailable(self):
        self.refused("payouts_unavailable")

    def test_a_suspended_holder_cannot_withdraw(self):
        Customer.objects.filter(pk=self.customer.pk).update(is_suspended=True)
        self.customer.refresh_from_db()
        self.refused("suspended")

    def test_the_same_request_id_twice_is_refused_by_the_database(self):
        self.withdraw(1000, request_id="req-same-0001")
        self.refused("duplicate_request", amount=1000, request_id="req-same-0001")
        self.assertEqual(self.wallet(), 19000)

    def test_a_held_withdrawal_can_be_cancelled_but_not_a_sent_one(self):
        held = self.withdraw(5000)
        cancelled = withdrawals.cancel(self.customer, held.pk)
        self.assertEqual(cancelled.status, Withdrawal.CANCELLED)
        self.assertEqual((self.wallet(), self.transit()), (20000, 0))
        with override_settings(SIMULATED_PAYOUT_OUTCOME="pending"):
            sent = payouts.submit(self.withdraw(5000).pk)
        with self.assertRaises(withdrawals.WithdrawalError) as caught:
            withdrawals.cancel(self.customer, sent.pk)
        self.assertEqual(caught.exception.code, "not_pending")


@override_settings(LEDGER_ENABLED=True)
class ConcurrentWithdrawalTests(TransactionTestCase):
    serialized_rollback = True

    def setUp(self):
        self.customer = Customer.objects.create(full_name="Ama Owusu", phone="+233241234567", password_hash="x")
        self.dest = destination(self.customer)
        fund(Account.CUSTOMER_WALLET, self.customer, 10000, "fund-1")

    def hold(self, amount, request_id):
        with transaction.atomic():
            return withdrawals.request(self.customer, destination_id=self.dest.pk, amount_pesewas=amount, request_id=request_id)

    def race(self, work):
        results, barrier = [], threading.Barrier(2)

        def run(i):
            try:
                barrier.wait()
                results.append(work(i))
            except withdrawals.WithdrawalError as exc:
                results.append(exc.code)
            finally:
                connection.close()

        threads = [threading.Thread(target=run, args=(i,)) for i in range(2)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=10)
            self.assertFalse(thread.is_alive(), "a racing thread hung")
        return results

    def test_review_focus_two_withdrawals_of_one_balance_at_once_hold_it_once(self):
        results = self.race(lambda i: self.hold(10000, f"req-race-{i:04d}").status)
        self.assertEqual(sorted(results), ["insufficient_funds", Withdrawal.PENDING])
        self.assertEqual(posting.balance_of(Account.CUSTOMER_WALLET, self.customer), 0)
        self.assertEqual(posting.balance_of(Account.WITHDRAWAL_IN_TRANSIT), 10000)
        self.assertEqual(Withdrawal.objects.count(), 1)

    def test_two_paid_reports_at_once_settle_once(self):
        with override_settings(SIMULATED_PAYOUT_OUTCOME="pending"):
            sent = payouts.submit(self.hold(4000, "req-paid-0001").pk)
        results = self.race(lambda i: payouts.apply_result(sent.reference, providers.SUCCEEDED, amount_pesewas=4000).status)
        self.assertEqual(results, [Withdrawal.SUCCEEDED, Withdrawal.SUCCEEDED])
        self.assertEqual(Journal.objects.filter(kind="withdrawal_paid").count(), 1)
        self.assertEqual(posting.balance_of(Account.WITHDRAWAL_IN_TRANSIT), 0)

    def test_two_senders_at_once_send_once(self):
        held = self.hold(4000, "req-send-0001")
        calls, real = [], providers.SimulatedProvider.payout

        def counting(provider, **kwargs):
            calls.append(kwargs["reference"])
            return real(provider, **kwargs)

        with mock.patch.object(providers.SimulatedProvider, "payout", counting):
            self.race(lambda i: payouts.submit(held.pk).status)
        self.assertEqual(calls, [held.reference])
        self.assertEqual(Journal.objects.filter(kind="withdrawal_paid").count(), 1)
```

- [ ] **Step 2: Run it to see it fail**

Run: `docker compose -p wal1 run --rm web python manage.py test wallets.tests.test_withdrawal_engine --noinput`
Expected: ERROR — `ImportError: cannot import name 'payouts' from 'wallets'`.

- [ ] **Step 3: The model** — append to `backend/wallets/models.py`

```python


def _withdrawal_reference():
    from django.utils.crypto import get_random_string

    return f"AH-WD-{get_random_string(10).upper()}"


class Withdrawal(models.Model):
    """Money leaving a holder's balance for one of their payout destinations (spec §2.2 step 5). The amount is held in
    withdrawal in transit at once (journal withdrawal-hold-<reference>), sent to the provider, then settled
    (withdrawal-paid-<reference>: in transit to provider clearing) or returned (withdrawal-reversed-<reference>). The
    holder bears the provider's charge: `net_pesewas` = `amount_pesewas` − `charge_pesewas` reaches the destination. A
    final status never changes (wallets.payouts.apply_result)."""

    PENDING, PROCESSING, SUCCEEDED, FAILED, CANCELLED = "pending", "processing", "succeeded", "failed", "cancelled"
    STATUS_CHOICES = [
        (PENDING, "Held, not sent yet"), (PROCESSING, "Sent, waiting for the provider"), (SUCCEEDED, "Paid"),
        (FAILED, "Failed, money returned"), (CANCELLED, "Cancelled, money returned"),
    ]
    OPEN = (PENDING, PROCESSING)
    FINAL = (SUCCEEDED, FAILED, CANCELLED)
    COUNTED = (PENDING, PROCESSING, SUCCEEDED)  # what counts against the daily limit

    reference = models.CharField(max_length=20, unique=True, default=_withdrawal_reference)
    holder_type = models.CharField(max_length=20)            # "customer" or "business_owner" (otp.identity.ref)
    holder_id = models.PositiveBigIntegerField()
    source_kind = models.CharField(max_length=32)            # the ledger account it came from: customer_wallet or vendor_available
    destination = models.ForeignKey(PayoutDestination, on_delete=models.PROTECT, related_name="withdrawals")
    request_id = models.CharField(max_length=64)             # the client's idempotency key, unique per holder
    amount_pesewas = models.BigIntegerField()
    charge_pesewas = models.BigIntegerField(default=0)
    net_pesewas = models.BigIntegerField()
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default=PENDING)
    provider = models.CharField(max_length=20)
    provider_reference = models.CharField(max_length=128, blank=True, default="")
    failure_reason = models.CharField(max_length=300, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    submitted_at = models.DateTimeField(null=True, blank=True)
    settled_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [
            models.Index(fields=["holder_type", "holder_id", "created_at"]),
            models.Index(fields=["status", "submitted_at"]),
        ]
        constraints = [
            models.UniqueConstraint(fields=["holder_type", "holder_id", "request_id"], name="wallets_one_withdrawal_per_request"),
            models.CheckConstraint(condition=models.Q(net_pesewas__gt=0, charge_pesewas__gte=0), name="wallets_withdrawal_amounts_positive"),
        ]

    def __str__(self):
        return f"Withdrawal {self.reference}"
```

Run: `docker compose -p wal1 run --rm web python manage.py makemigrations wallets --name withdrawals`
Expected: `backend/wallets/migrations/0002_withdrawals.py` with `CreateModel` `Withdrawal` (its indexes and both constraints), depending on `("wallets", "0001_payout_destinations")`.

- [ ] **Step 4: Asking for a withdrawal** — `backend/wallets/withdrawals.py`

```python
"""Asking for money out (spec §2.2 step 5, §6, §8). `request` checks everything and holds the amount in withdrawal in
transit inside the caller's transaction (the one that also spends the step-up code); wallets.payouts then sends it and
settles it. The checks, in order: the holder is not suspended; the destination is theirs, live, past its cooling period
and still matches their verified name; the provider can pay out; the amount is above the provider's charge and within
the per-withdrawal limit; then, with the holder's balance and the in-transit account locked together in primary-key
order (posting.lock), the balance covers it (a vendor's negative Available blocks any withdrawal) and today's
withdrawals stay within the daily limit. Customers withdraw their wallet, vendors their Available; third-party riders
are Stage 5."""
from django.db import IntegrityError, transaction
from django.db.models import Sum
from django.utils import timezone

from accounts.models import BusinessOwner, Customer
from ledger import posting, settings_store
from ledger.models import Account
from ledger.money import from_pesewas
from otp.identity import ref
from payments import providers

from . import destinations, names
from .models import PayoutDestination, Withdrawal
from .services import money


class WithdrawalError(Exception):
    def __init__(self, message, code, status_code=409, **extra):
        super().__init__(message)
        self.message, self.code, self.status_code, self.extra = message, code, status_code, extra

    def body(self):
        return {"detail": self.message, "code": self.code, **self.extra}


def hold_key(reference):
    return f"withdrawal-hold-{reference}"


def paid_key(reference):
    return f"withdrawal-paid-{reference}"


def reversed_key(reference):
    return f"withdrawal-reversed-{reference}"


def source_kind(holder):
    if isinstance(holder, Customer):
        return Account.CUSTOMER_WALLET
    if isinstance(holder, BusinessOwner):
        return Account.VENDOR_AVAILABLE
    raise WithdrawalError("Only customers and businesses can withdraw.", "not_a_holder", 403)


def start_of_day(now):
    """Midnight of `now`'s day in AshantiHub's time zone (Africa/Accra): the daily limit's day."""
    return timezone.localtime(now).replace(hour=0, minute=0, second=0, microsecond=0)


def clean_request_id(raw):
    if not isinstance(raw, str) or not 8 <= len(raw.strip()) <= 64:
        raise WithdrawalError(
            "Send a request_id of 8 to 64 characters, the same on every retry, so a retry is never paid twice.",
            "invalid", 400, field="request_id",
        )
    return raw.strip()


def mine(holder):
    holder_type, holder_id = ref(holder)
    return Withdrawal.objects.filter(holder_type=holder_type, holder_id=holder_id)


def existing(holder, request_id):
    return mine(holder).filter(request_id=request_id).first()


def request(holder, *, destination_id, amount_pesewas, request_id, now=None):
    """Hold `amount_pesewas` of the holder's balance for a payout to `destination_id` and return the new PENDING
    Withdrawal. Call inside transaction.atomic(); raises WithdrawalError, writing nothing, when anything is wrong."""
    now = now or timezone.now()
    if getattr(holder, "is_suspended", False):
        raise WithdrawalError("This account is suspended.", "suspended", 403)
    kind = source_kind(holder)
    holder_type, holder_id = ref(holder)
    if isinstance(amount_pesewas, bool) or not isinstance(amount_pesewas, int) or amount_pesewas <= 0:
        raise WithdrawalError("The amount must be more than GH₵ 0.00.", "invalid", 400, field="amount")
    destination = None
    if isinstance(destination_id, int) and not isinstance(destination_id, bool):
        destination = PayoutDestination.objects.select_for_update().filter(
            pk=destination_id, holder_type=holder_type, holder_id=holder_id, removed_at__isnull=True,
        ).first()
    if destination is None:
        raise WithdrawalError("Choose one of your payout destinations.", "unknown_destination", 404)
    if destination.usable_from > now:
        raise WithdrawalError(
            "A new payout destination can't receive money yet.", "destination_cooling", 409,
            usable_from=destination.usable_from.isoformat(),
        )
    if names.matching_name(destination.account_name, holder) is None:
        raise WithdrawalError("That destination no longer matches the name we have verified for you. Add it again.", "name_mismatch", 409)
    provider = providers.get_provider()
    if not provider.payouts_available():
        raise WithdrawalError("Withdrawals aren't available yet.", "payouts_unavailable", 409)
    charge = provider.payout_charge(amount_pesewas, destination.rail)
    if amount_pesewas <= charge:
        raise WithdrawalError(f"The amount must be more than the GH₵ {from_pesewas(charge)} withdrawal charge.", "below_charge", 400)
    per_withdrawal = settings_store.current("withdrawal_per_tx_limit_pesewas", now)
    if amount_pesewas > per_withdrawal:
        raise WithdrawalError(f"One withdrawal can be at most GH₵ {from_pesewas(per_withdrawal)}.", "over_limit", 409)
    source = posting.account_for(kind, holder)
    transit = posting.account_for(Account.WITHDRAWAL_IN_TRANSIT)
    balance = posting.lock(source, transit)[source.pk].balance
    if kind == Account.VENDOR_AVAILABLE and balance < 0:
        raise WithdrawalError(
            "Your available balance is below zero after a refund. It recovers from your next sales.", "negative_balance", 409,
        )
    if amount_pesewas > balance:
        raise WithdrawalError(f"You have GH₵ {from_pesewas(max(balance, 0))} to withdraw.", "insufficient_funds", 409)
    today = mine(holder).filter(status__in=Withdrawal.COUNTED, created_at__gte=start_of_day(now)).aggregate(total=Sum("amount_pesewas"))["total"] or 0
    daily = settings_store.current("withdrawal_daily_limit_pesewas", now)
    if today + amount_pesewas > daily:
        raise WithdrawalError(f"You can withdraw GH₵ {from_pesewas(max(daily - today, 0))} more today.", "daily_limit", 409)
    try:
        with transaction.atomic():
            withdrawal = Withdrawal.objects.create(
                holder_type=holder_type, holder_id=holder_id, source_kind=kind, destination=destination, request_id=request_id,
                amount_pesewas=amount_pesewas, charge_pesewas=charge, net_pesewas=amount_pesewas - charge, provider=provider.name,
            )
    except IntegrityError:
        raise WithdrawalError("This withdrawal was already asked for.", "duplicate_request", 409) from None
    posting.post(
        key=hold_key(withdrawal.reference), kind="withdrawal_hold",
        lines=[posting.debit(source, amount_pesewas), posting.credit(transit, amount_pesewas)],
        reference_type="wallets.withdrawal", reference_id=withdrawal.reference, memo=f"Withdrawal {withdrawal.reference}",
    )
    return withdrawal


def cancel(holder, withdrawal_id, now=None):
    """The holder takes back a withdrawal not sent to the provider yet: the hold goes back to their balance."""
    from .payouts import close

    now = now or timezone.now()
    with transaction.atomic():
        withdrawal = mine(holder).select_for_update().filter(pk=withdrawal_id).first()
        if withdrawal is None:
            raise WithdrawalError("No such withdrawal.", "not_found", 404)
        if withdrawal.status != Withdrawal.PENDING:
            raise WithdrawalError("Only a withdrawal not sent yet can be cancelled.", "not_pending", 409)
        return close(withdrawal, Withdrawal.CANCELLED, "Cancelled by you.", now)


def row(withdrawal):
    """What the holder (and staff) see: amounts in GH₵, the destination masked."""
    return {
        "id": withdrawal.pk, "reference": withdrawal.reference, "amount": money(withdrawal.amount_pesewas),
        "charge": money(withdrawal.charge_pesewas), "you_receive": money(withdrawal.net_pesewas), "status": withdrawal.status,
        "status_label": withdrawal.get_status_display(), "destination": destinations.row(withdrawal.destination),
        "created_at": withdrawal.created_at, "settled_at": withdrawal.settled_at, "failure_reason": withdrawal.failure_reason,
    }
```

- [ ] **Step 5: Sending and settling** — `backend/wallets/payouts.py`

```python
"""Sending a held withdrawal to the provider and settling it (spec §2.2 step 5, §2.3).

A withdrawal is claimed (PENDING → PROCESSING under its row lock) before the provider is asked, so it is sent once even
when the request and the poll race; the provider call runs outside any transaction. `apply_result` is the one way a
withdrawal ends, whoever reports it - the provider's answer, the 5-minute poll, a payout webhook (Plan 7) - and `close`
the one way its money goes back (a failure, the holder's cancel, staff failing a stuck one). Both lock the row first;
the journal keys are per reference, so a report applied twice posts once. A final status never changes: a "paid" report
on a withdrawal already failed or cancelled is never posted (its money went back) and opens a fraud case; a report
whose amount differs from what was sent is not applied and opens one too. Nothing here logs an account number."""
import logging
from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from accounts.models import BusinessOwner, Customer
from fraud import services as fraud
from fraud.models import FraudFlag
from ledger import posting
from ledger.models import Account
from notifications.services import notify_business_owner, notify_customer
from payments import providers

from .models import Withdrawal
from .services import money
from .withdrawals import paid_key, reversed_key

logger = logging.getLogger(__name__)
RESEND_AFTER = timedelta(minutes=2)    # a held withdrawal nobody sent (the process died) is sent by the poll
ASK_AFTER = timedelta(minutes=2)       # a sent one is asked about after this
STUCK_AFTER = timedelta(minutes=30)    # staff may fail one sent this long ago with no answer (views_staff)
STUCK_PENDING = timedelta(minutes=10)  # ...or one held and never sent for this long


def holder_of(withdrawal):
    model = Customer if withdrawal.holder_type == "customer" else BusinessOwner
    holder = model.objects.filter(pk=withdrawal.holder_id).first()
    if holder is None:
        raise RuntimeError(f"Withdrawal {withdrawal.reference} has no holder")
    return holder


def _tell(withdrawal, title, body):
    holder = holder_of(withdrawal)
    if isinstance(holder, Customer):
        notify_customer(holder, "withdrawal", title, body=body, link="/my-account", icon="💸")
    else:
        notify_business_owner(holder, "withdrawal", title, body=body, link="/business", icon="💸")


def claim(withdrawal_pk, now=None):
    """PENDING → PROCESSING under the row lock. Returns the withdrawal if this caller won it, else None."""
    now = now or timezone.now()
    with transaction.atomic():
        withdrawal = Withdrawal.objects.select_for_update().filter(pk=withdrawal_pk, status=Withdrawal.PENDING).first()
        if withdrawal is None:
            return None
        withdrawal.status, withdrawal.submitted_at = Withdrawal.PROCESSING, now
        withdrawal.save(update_fields=["status", "submitted_at"])
        return withdrawal


def submit(withdrawal_pk, now=None):
    """Send a held withdrawal to the provider once, then apply what it answered. Never raises for a provider problem:
    a send with no answer stays PROCESSING for the poll (or staff) to settle. Returns the withdrawal as it now is."""
    withdrawal = claim(withdrawal_pk, now)
    if withdrawal is None:
        return Withdrawal.objects.get(pk=withdrawal_pk)
    destination = withdrawal.destination
    try:
        result = providers.get_provider(withdrawal.provider).payout(
            reference=withdrawal.reference, rail=destination.rail, institution=destination.institution,
            account_number=destination.account_number, amount_pesewas=withdrawal.net_pesewas,
        )
    except Exception:
        logger.warning("Payout %s could not be sent; the poll will ask about it", withdrawal.reference)
        return Withdrawal.objects.get(pk=withdrawal.pk)
    applied = apply_result(
        withdrawal.reference, result.status, provider_reference=result.provider_reference,
        amount_pesewas=withdrawal.net_pesewas, message=result.message, now=now,
    )
    return applied or Withdrawal.objects.get(pk=withdrawal.pk)


def apply_result(reference, status, *, provider_reference="", amount_pesewas=None, message="", now=None):
    """End a withdrawal from a report: SUCCEEDED posts the payout, FAILED returns the money, PROCESSING changes nothing.
    Returns the withdrawal, or None for an unknown reference."""
    now = now or timezone.now()
    if status not in (providers.SUCCEEDED, providers.FAILED):
        return Withdrawal.objects.filter(reference=reference).first()
    with transaction.atomic():
        withdrawal = Withdrawal.objects.select_for_update().filter(reference=reference).first()
        if withdrawal is None:
            logger.warning("A payout report names an unknown withdrawal %s", reference)
            return None
        if withdrawal.status in Withdrawal.FINAL:
            if status == providers.SUCCEEDED and withdrawal.status != Withdrawal.SUCCEEDED:
                fraud.raise_flag(
                    FraudFlag.OTHER, title=f"Withdrawal {withdrawal.reference} reported paid after its money was returned",
                    detail=(f"The provider reported withdrawal {withdrawal.reference} paid, but it was already "
                            f"{withdrawal.get_status_display().lower()} and GH₵ {money(withdrawal.amount_pesewas)} went back to the "
                            "holder. Nothing was posted. Check with the provider."),
                    dedupe_key=f"withdrawal-late-paid-{withdrawal.reference}",
                )
            return withdrawal
        if amount_pesewas is not None and amount_pesewas != withdrawal.net_pesewas:
            fraud.raise_flag(
                FraudFlag.OTHER, title=f"Withdrawal {withdrawal.reference}: the provider reported a different amount",
                detail=f"Sent GH₵ {money(withdrawal.net_pesewas)}, reported GH₵ {money(amount_pesewas)}. Not applied.",
                dedupe_key=f"withdrawal-amount-{withdrawal.reference}",
            )
            return withdrawal
        if provider_reference and not withdrawal.provider_reference:
            withdrawal.provider_reference = provider_reference[:128]
        if status == providers.FAILED:
            return close(withdrawal, Withdrawal.FAILED, message or "The provider could not pay it.", now)
        posting.post(
            key=paid_key(withdrawal.reference), kind="withdrawal_paid",
            lines=[
                posting.debit(posting.account_for(Account.WITHDRAWAL_IN_TRANSIT), withdrawal.amount_pesewas),
                posting.credit(posting.account_for(Account.PROVIDER_CLEARING), withdrawal.amount_pesewas),
            ],
            reference_type="wallets.withdrawal", reference_id=withdrawal.reference, memo=f"Withdrawal {withdrawal.reference} paid",
            allow_negative={Account.PROVIDER_CLEARING},  # the provider confirmed it: a fact to record (spec §13 x)
        )
        withdrawal.status, withdrawal.settled_at = Withdrawal.SUCCEEDED, now
        withdrawal.save(update_fields=["status", "settled_at", "provider_reference"])
        destination = withdrawal.destination
        _tell(withdrawal, "Your withdrawal was paid",
              f"GH₵ {money(withdrawal.net_pesewas)} was sent to your {destination.get_rail_display().lower()} ({destination.institution}).")
        return withdrawal


def close(withdrawal, status, reason, now):
    """Return a held withdrawal's money to its source (FAILED or CANCELLED). The caller holds the row lock."""
    source = posting.account_for(withdrawal.source_kind, holder_of(withdrawal))
    posting.post(
        key=reversed_key(withdrawal.reference), kind="withdrawal_reversed",
        lines=[
            posting.debit(posting.account_for(Account.WITHDRAWAL_IN_TRANSIT), withdrawal.amount_pesewas),
            posting.credit(source, withdrawal.amount_pesewas),
        ],
        reference_type="wallets.withdrawal", reference_id=withdrawal.reference, memo=f"Withdrawal {withdrawal.reference} returned",
    )
    withdrawal.status, withdrawal.settled_at, withdrawal.failure_reason = status, now, (reason or "")[:300]
    withdrawal.save(update_fields=["status", "settled_at", "failure_reason", "provider_reference"])
    title = "Your withdrawal was cancelled" if status == Withdrawal.CANCELLED else "Your withdrawal didn't go through"
    _tell(withdrawal, title, f"GH₵ {money(withdrawal.amount_pesewas)} is back in your balance. {withdrawal.failure_reason}")
    return withdrawal


def stuck(withdrawal, now=None):
    """Staff may fail it by hand: sent STUCK_AFTER ago with no answer, or held and never sent for STUCK_PENDING."""
    now = now or timezone.now()
    if withdrawal.status == Withdrawal.PROCESSING:
        return withdrawal.submitted_at is not None and withdrawal.submitted_at <= now - STUCK_AFTER
    if withdrawal.status == Withdrawal.PENDING:
        return withdrawal.created_at <= now - STUCK_PENDING
    return False


def poll(now=None):
    """Send held withdrawals nobody sent, and ask the provider about sent ones. Returns how many it looked at. A provider
    that cannot report (NotConnected) leaves them for staff."""
    now = now or timezone.now()
    looked = 0
    for pk in Withdrawal.objects.filter(status=Withdrawal.PENDING, created_at__lt=now - RESEND_AFTER).values_list("pk", flat=True):
        submit(pk, now)
        looked += 1
    for withdrawal in Withdrawal.objects.filter(status=Withdrawal.PROCESSING, submitted_at__lt=now - ASK_AFTER):
        try:
            result = providers.get_provider(withdrawal.provider).status(withdrawal.reference)
        except Exception:
            logger.warning("Could not ask about payout %s", withdrawal.reference)
            continue
        apply_result(withdrawal.reference, result.status, provider_reference=result.provider_reference, message=result.message, now=now)
        looked += 1
    return looked
```

- [ ] **Step 6: The task and its schedule** — `backend/wallets/tasks.py`

```python
from celery import shared_task

from ledger import escrow

from . import payouts


@shared_task
def poll_withdrawals():
    """Every 5 minutes: send held withdrawals nobody sent and ask the provider about sent ones (a no-op while the
    ledger is off). The beat entry makes core.jobs keep a JobRun heartbeat for it."""
    if not escrow.enabled():
        return 0
    return payouts.poll()
```

In `backend/ashantihub/settings.py` replace

```python
    "ledger-refund-uncollected-pickups": {
        "task": "ledger.tasks.refund_uncollected_pickups",
        "schedule": crontab(minute=25),  # hourly, at twenty-five past: a no-op while the ledger is off
    },
}
```

with

```python
    "ledger-refund-uncollected-pickups": {
        "task": "ledger.tasks.refund_uncollected_pickups",
        "schedule": crontab(minute=25),  # hourly, at twenty-five past: a no-op while the ledger is off
    },
    "wallets-poll-withdrawals": {
        "task": "wallets.tasks.poll_withdrawals",
        "schedule": 300.0,  # every 5 minutes: a no-op while the ledger is off
    },
}
```

- [ ] **Step 7: Run the tests**

Run: `docker compose -p wal1 run --rm web python manage.py test wallets core.tests.test_background_jobs --noinput`
Expected: PASS (23 new tests, 3 of them threaded).

- [ ] **Step 8: Commit**

```bash
git add backend/wallets backend/ashantihub/settings.py
git commit -m "feat(wallets): withdrawal engine - hold, send once, settle or return exactly once; 5-minute poll"
```

---

### Task 4: Withdrawals over the API — step-up, idempotent retries, the holder's list, cancel

**Files:**
- Modify: `backend/wallets/views_payouts.py` (withdrawal views), `backend/wallets/urls.py`
- Create: `backend/wallets/tests/test_withdrawal_api.py`

**Interfaces:**
- Consumes: `withdrawals.clean_request_id`, `existing`, `request`, `cancel`, `mine`, `row`, `WithdrawalError`, `payouts.submit` (Task 3); `wallets.views.parse_amount`, `AmountError`, `Pagination`, `ledger_off` (Plan 3a); `otp.step_up.require(request, step_up.WITHDRAWAL, force=True)`.
- Produces: `GET/POST /api/wallet/withdrawals/`, `POST /api/wallet/withdrawals/<id>/cancel/`; views `WithdrawalsView`, `WithdrawalCancelView`.

- [ ] **Step 1: Write the failing test** — `backend/wallets/tests/test_withdrawal_api.py`

```python
"""Withdrawals over the API (wallets plan 3b, Task 4). Review Focus 1 (cooling), 4 (negative Available), 5 (step-up
replay) and 8 (ledger off)."""
from django.core.cache import cache
from django.test import TestCase, override_settings

from accounts.models import BusinessOwner, Customer
from ledger import posting
from ledger.models import Account
from otp import senders, step_up
from otp.tests.helpers import last_sms_code
from wallets import withdrawals
from wallets.models import Withdrawal

from .helpers import Holder, destination, fund

URL = "/api/wallet/withdrawals/"


class WithdrawalApiBase(TestCase):
    def setUp(self):
        cache.clear()
        self.customer = Customer.objects.create(full_name="Ama Owusu", phone="+233241234567", password_hash="x")
        self.ama = Holder(self.customer, "customer")
        self.dest = destination(self.customer)
        self.n = 0

    def body(self, amount="50.00", dest=None, request_id=None):
        self.n += 1
        return {"destination": (dest or self.dest).pk, "amount": amount, "request_id": request_id or f"req-api-{self.n:04d}"}

    def wallet(self):
        return posting.balance_of(Account.CUSTOMER_WALLET, self.customer)


class LedgerOffWithdrawalTests(WithdrawalApiBase):
    def test_review_focus_withdrawals_say_ledger_off(self):
        self.assertEqual(self.ama.get(URL).json()["code"], "ledger_off")
        response = self.ama.post(URL, self.body(), action=step_up.WITHDRAWAL)
        self.assertEqual((response.status_code, response.json()["code"]), (409, "ledger_off"))
        self.assertEqual(self.ama.post(f"{URL}1/cancel/").json()["code"], "ledger_off")
        self.assertFalse(Withdrawal.objects.exists())


@override_settings(LEDGER_ENABLED=True)
class WithdrawalApiTests(WithdrawalApiBase):
    def setUp(self):
        super().setUp()
        fund(Account.CUSTOMER_WALLET, self.customer, 20000, "fund-1")

    def test_withdrawing_needs_a_step_up_code(self):
        response = self.ama.post(URL, self.body())
        self.assertEqual((response.status_code, response.json()["code"]), (403, "step_up_required"))
        self.assertEqual((self.wallet(), Withdrawal.objects.count()), (20000, 0))

    def test_a_customer_withdraws_with_a_code(self):
        response = self.ama.post(URL, self.body(), action=step_up.WITHDRAWAL)
        self.assertEqual(response.status_code, 201, response.content)
        body = response.json()
        self.assertEqual((body["status"], body["amount"], body["you_receive"], body["charge"]), ("succeeded", "50.00", "50.00", "0.00"))
        self.assertEqual(body["destination"]["account_number_masked"], "••••••••34567")
        self.assertNotIn("241234567", response.content.decode())
        self.assertEqual(self.wallet(), 15000)

    def test_review_focus_a_step_up_token_pays_once(self):
        token = self.ama.step_up(step_up.WITHDRAWAL)
        self.assertEqual(self.ama.post(URL, self.body(), token=token).status_code, 201)
        again = self.ama.post(URL, self.body(), token=token)
        self.assertEqual((again.status_code, again.json()["code"]), (403, "step_up_required"))
        self.assertEqual(self.wallet(), 15000)

    def test_a_code_for_another_action_is_refused(self):
        response = self.ama.post(URL, self.body(), action=step_up.PAYOUT_DESTINATION)
        self.assertEqual(response.status_code, 403)
        self.assertEqual(self.wallet(), 20000)

    def test_a_retry_with_the_same_request_id_answers_the_same_withdrawal_without_a_code(self):
        first = self.ama.post(URL, self.body(request_id="req-retry-0001"), action=step_up.WITHDRAWAL)
        again = self.ama.post(URL, self.body(request_id="req-retry-0001"))
        self.assertEqual((first.status_code, again.status_code), (201, 200))
        self.assertEqual(first.json()["id"], again.json()["id"])
        self.assertEqual((Withdrawal.objects.count(), self.wallet()), (1, 15000))

    def test_review_focus_cooling_answers_409_and_the_code_is_kept(self):
        cooling = destination(self.customer, number="+233241234599", usable=False)
        token = self.ama.step_up(step_up.WITHDRAWAL)
        refused = self.ama.post(URL, self.body(dest=cooling), token=token)
        self.assertEqual((refused.status_code, refused.json()["code"]), (409, "destination_cooling"))
        self.assertIn("usable_from", refused.json())
        self.assertEqual(self.wallet(), 20000)
        self.assertEqual(self.ama.post(URL, self.body(), token=token).status_code, 201)            # the refused request kept the code

    def test_review_focus_a_vendor_with_a_negative_available_is_refused(self):
        owner = BusinessOwner.objects.create(
            full_name="Kwame Mensah", login_phone="+233201112233", password_hash="x", kyc_status=BusinessOwner.VERIFIED,
        )
        kwame = Holder(owner, "business_owner")
        to_kwame = destination(owner, number="+233201112233", name="Kwame Mensah")
        fund(Account.VENDOR_AVAILABLE, owner, 5000, "fund-vendor")
        paid = kwame.post(URL, self.body(amount="30.00", dest=to_kwame), action=step_up.WITHDRAWAL)
        self.assertEqual(paid.status_code, 201, paid.content)
        self.assertEqual(posting.balance_of(Account.VENDOR_AVAILABLE, owner), 2000)
        posting.post(key="late-refund", kind="test", lines=[
            posting.debit(posting.account_for(Account.VENDOR_AVAILABLE, owner), 2500),
            posting.credit(posting.account_for(Account.CUSTOMER_WALLET, self.customer), 2500),
        ])
        refused = kwame.post(URL, self.body(amount="1.00", dest=to_kwame), action=step_up.WITHDRAWAL)
        self.assertEqual((refused.status_code, refused.json()["code"]), (409, "negative_balance"))

    def test_bad_requests_are_refused_before_any_code_is_spent(self):
        token = self.ama.step_up(step_up.WITHDRAWAL)
        no_id = self.ama.post(URL, {"destination": self.dest.pk, "amount": "10.00"}, token=token)
        self.assertEqual((no_id.status_code, no_id.json()["field"]), (400, "request_id"))
        bad_amount = self.ama.post(URL, self.body(amount="1.234"), token=token)
        self.assertEqual(bad_amount.status_code, 400)
        self.assertIn("amount", bad_amount.json())
        unknown = self.ama.post(URL, {**self.body(), "destination": 999999}, token=token)
        self.assertEqual((unknown.status_code, unknown.json()["code"]), (404, "unknown_destination"))
        self.assertEqual(self.ama.post(URL, self.body(), token=token).status_code, 201)

    def test_the_list_shows_only_mine_and_a_held_one_can_be_cancelled(self):
        self.ama.post(URL, self.body(), action=step_up.WITHDRAWAL)
        held = withdrawals.request(self.customer, destination_id=self.dest.pk, amount_pesewas=1000, request_id="req-held-0001")
        kojo = Holder(Customer.objects.create(full_name="Kojo Asare", phone="+233241234568", password_hash="x"), "customer")
        self.assertEqual(kojo.get(URL).json()["count"], 0)
        self.assertEqual(self.ama.get(URL).json()["count"], 2)
        self.assertEqual(kojo.post(f"{URL}{held.pk}/cancel/").status_code, 404)
        cancelled = self.ama.post(f"{URL}{held.pk}/cancel/")
        self.assertEqual((cancelled.status_code, cancelled.json()["status"]), (200, "cancelled"))
        paid = Withdrawal.objects.get(status=Withdrawal.SUCCEEDED)
        self.assertEqual(self.ama.post(f"{URL}{paid.pk}/cancel/").json()["code"], "not_pending")
        self.assertEqual(self.wallet(), 15000)

    def test_with_a_texted_code_end_to_end(self):
        senders.sms_outbox.clear()
        sent = self.ama.client.post("/api/otp/step-up/send/", {"action": "withdrawal", "channel": "sms"}, format="json")
        self.assertEqual(sent.status_code, 200, sent.content)
        verified = self.ama.client.post("/api/otp/step-up/verify/", {"action": "withdrawal", "code": last_sms_code()}, format="json")
        self.assertEqual(verified.status_code, 200, verified.content)
        self.assertEqual(self.ama.post(URL, self.body(), token=verified.json()["step_up_token"]).status_code, 201)
```

- [ ] **Step 2: Run it to see it fail**

Run: `docker compose -p wal1 run --rm web python manage.py test wallets.tests.test_withdrawal_api --noinput`
Expected: FAIL — 404 for `/api/wallet/withdrawals/`.

- [ ] **Step 3: The views** — in `backend/wallets/views_payouts.py`, (a) replace

```python
from . import destinations
from .views import ledger_off
```

with

```python
from . import destinations, payouts, withdrawals
from .views import AmountError, Pagination, ledger_off, parse_amount
```

and (b) append at the end of the file

```python


class WithdrawalsView(APIView):
    """GET withdrawals/ — the holder's withdrawals, newest first (20 a page).
    POST withdrawals/ {destination, amount, request_id} + X-Step-Up-Token — withdraw to one of the holder's payout
    destinations. A retry with the same request_id answers the withdrawal already made (200) and needs no new code; a
    new one is held, sent at once and answered 201 with what the provider said (succeeded, processing or failed)."""

    permission_classes = [IsCustomerOrOwner]

    def get(self, request):
        if not escrow.enabled():
            return ledger_off()
        paginator = Pagination()
        page = paginator.paginate_queryset(withdrawals.mine(request.user).select_related("destination"), request, view=self)
        return paginator.get_paginated_response([withdrawals.row(withdrawal) for withdrawal in page])

    def post(self, request):
        if not escrow.enabled():
            return ledger_off()
        data = request.data if isinstance(request.data, dict) else {}
        try:
            request_id = withdrawals.clean_request_id(data.get("request_id"))
        except withdrawals.WithdrawalError as exc:
            return Response(exc.body(), status=exc.status_code)
        found = withdrawals.existing(request.user, request_id)
        if found is not None:
            return Response(withdrawals.row(found), status=status.HTTP_200_OK)
        try:
            amount = parse_amount(data.get("amount"))
        except AmountError as exc:
            return Response({"amount": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        try:
            with transaction.atomic():
                step_up.require(request, step_up.WITHDRAWAL, force=True)
                withdrawal = withdrawals.request(
                    request.user, destination_id=data.get("destination"), amount_pesewas=amount, request_id=request_id,
                )
        except withdrawals.WithdrawalError as exc:
            return Response(exc.body(), status=exc.status_code)
        # Sent outside the transaction: the hold is committed before the provider is asked (wallets.payouts).
        return Response(withdrawals.row(payouts.submit(withdrawal.pk)), status=status.HTTP_201_CREATED)


class WithdrawalCancelView(APIView):
    """POST withdrawals/<id>/cancel/ — take back a withdrawal not sent yet; the money returns to the holder's balance."""

    permission_classes = [IsCustomerOrOwner]

    def post(self, request, pk):
        if not escrow.enabled():
            return ledger_off()
        try:
            withdrawal = withdrawals.cancel(request.user, pk)
        except withdrawals.WithdrawalError as exc:
            return Response(exc.body(), status=exc.status_code)
        return Response(withdrawals.row(withdrawal))
```

In `backend/wallets/urls.py` replace

```python
    path("destinations/<int:pk>/remove/", views_payouts.DestinationRemoveView.as_view(), name="wallet-destination-remove"),
]
```

with

```python
    path("destinations/<int:pk>/remove/", views_payouts.DestinationRemoveView.as_view(), name="wallet-destination-remove"),
    path("withdrawals/", views_payouts.WithdrawalsView.as_view(), name="wallet-withdrawals"),
    path("withdrawals/<int:pk>/cancel/", views_payouts.WithdrawalCancelView.as_view(), name="wallet-withdrawal-cancel"),
]
```

- [ ] **Step 4: Run the tests**

Run: `docker compose -p wal1 run --rm web python manage.py test wallets --noinput`
Expected: PASS (11 new tests, and every earlier wallets test).

- [ ] **Step 5: Commit**

```bash
git add backend/wallets
git commit -m "feat(wallets): withdrawal API with step-up, idempotent retries, list and cancel"
```

---

### Task 5: Staff — the withdrawals list and failing a stuck withdrawal

**Files:**
- Modify: `backend/wallets/views_staff.py`, `backend/wallets/urls.py`
- Create: `backend/wallets/tests/test_staff_withdrawals.py`

**Interfaces:**
- Consumes: `Withdrawal`, `withdrawals.row`, `payouts.stuck`, `payouts.close`, `payouts.apply_result` (Task 3); `VIEW`, `MANAGE`, `Pagination`, `ledger_off`, `money` (Plan 3a); `accounts.permissions.HasRolePermission`, `RequiresSudo`; `activity.services.record`.
- Produces: `GET /api/wallet/staff/withdrawals/?status=open|succeeded|failed|cancelled|all` (unknown → `open`); `POST /api/wallet/staff/withdrawals/<id>/fail/ {reason}`; activity verb `wallets.withdrawal_failed`; `views_staff.STATUS_FILTERS`, `staff_row(withdrawal, holders)`, `holders_of(withdrawals)`.

- [ ] **Step 1: Write the failing test** — `backend/wallets/tests/test_staff_withdrawals.py`

```python
"""Staff and withdrawals (wallets plan 3b, Task 5): the list (wallets.view) and failing a stuck one (wallets.manage and
the password again). Review Focus 3 (a late "paid" after staff failed it) and 6 (no number in the activity log)."""
from datetime import timedelta

from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import Customer
from accounts.testing import make_staff, staff_token
from activity.models import ActivityEvent
from fraud.models import FraudFlag
from ledger import posting
from ledger.models import Account, Journal
from payments import providers
from wallets import payouts, withdrawals
from wallets.models import Withdrawal

from .helpers import destination, fund

URL = "/api/wallet/staff/withdrawals/"


@override_settings(LEDGER_ENABLED=True)
class StaffWithdrawalTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.accountant = make_staff("accountant", "kofi@example.com")
        self.support = make_staff("support", "esi@example.com")
        self.customer = Customer.objects.create(full_name="Ama Owusu", phone="+233241234567", password_hash="x")
        self.dest = destination(self.customer)
        fund(Account.CUSTOMER_WALLET, self.customer, 20000, "fund-1")

    def as_staff(self, staff, sudo=False):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(staff, sudo=sudo)}")

    def sent(self, amount=5000, request_id="req-staff-0001"):
        """A withdrawal the provider has not answered, sent 31 minutes ago."""
        with override_settings(SIMULATED_PAYOUT_OUTCOME="pending"):
            withdrawal = payouts.submit(
                withdrawals.request(self.customer, destination_id=self.dest.pk, amount_pesewas=amount, request_id=request_id).pk,
            )
        Withdrawal.objects.filter(pk=withdrawal.pk).update(submitted_at=timezone.now() - timedelta(minutes=31))
        return withdrawal

    def force_fail(self, withdrawal, reason="Hubtel says it never left"):
        return self.client.post(f"{URL}{withdrawal.pk}/fail/", {"reason": reason}, format="json")

    def wallet(self):
        return posting.balance_of(Account.CUSTOMER_WALLET, self.customer)

    def test_the_accountant_sees_open_withdrawals_with_the_holder_and_no_whole_number(self):
        withdrawal = self.sent()
        self.as_staff(self.accountant)
        response = self.client.get(URL)
        self.assertEqual(response.status_code, 200, response.content)
        row = response.json()["results"][0]
        self.assertEqual(
            (row["reference"], row["holder_type"], row["holder_name"], row["status"], row["stuck"]),
            (withdrawal.reference, "customer", "Ama Owusu", "processing", True),
        )
        self.assertEqual(row["destination"]["account_number_masked"], "••••••••34567")
        self.assertNotIn("241234567", response.content.decode())
        self.assertEqual(self.client.get(URL, {"status": "succeeded"}).json()["count"], 0)
        self.assertEqual(self.client.get(URL, {"status": "bogus"}).json()["count"], 1)            # an unknown tab falls back to open

    def test_only_wallets_view_holders_may_look(self):
        self.as_staff(self.support)
        self.assertEqual(self.client.get(URL).status_code, 403)

    def test_failing_needs_wallets_manage_the_password_and_a_reason(self):
        withdrawal = self.sent()
        self.as_staff(self.support, sudo=True)
        self.assertEqual(self.force_fail(withdrawal).status_code, 403)
        self.as_staff(self.accountant)
        self.assertEqual(self.force_fail(withdrawal).json()["code"], "sudo_required")
        self.as_staff(self.accountant, sudo=True)
        self.assertEqual(self.force_fail(withdrawal, reason="  ").status_code, 400)
        withdrawal.refresh_from_db()
        self.assertEqual(withdrawal.status, Withdrawal.PROCESSING)

    def test_a_withdrawal_that_is_not_stuck_cannot_be_failed_by_hand(self):
        withdrawal = self.sent()
        Withdrawal.objects.filter(pk=withdrawal.pk).update(submitted_at=timezone.now() - timedelta(minutes=5))
        self.as_staff(self.accountant, sudo=True)
        response = self.force_fail(withdrawal)
        self.assertEqual((response.status_code, response.json()["code"]), (409, "not_stuck"))

    def test_review_focus_failing_a_stuck_withdrawal_returns_the_money_and_logs_no_number(self):
        withdrawal = self.sent()
        self.assertEqual(self.wallet(), 15000)
        self.as_staff(self.accountant, sudo=True)
        response = self.force_fail(withdrawal)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["status"], "failed")
        self.assertEqual(self.wallet(), 20000)
        self.assertEqual(posting.balance_of(Account.WITHDRAWAL_IN_TRANSIT), 0)
        event = ActivityEvent.objects.get(verb="wallets.withdrawal_failed")
        self.assertEqual((event.before, event.after["status"]), ({"status": "processing"}, "failed"))
        for text in (event.summary, event.target_label, str(event.before), str(event.after)):
            self.assertNotIn("241234567", text)
        self.assertEqual(ActivityEvent.objects.filter(target_id=str(withdrawal.pk), target_type="wallets.withdrawal").count(), 1)

    def test_review_focus_a_late_paid_report_after_staff_failed_it_is_never_posted(self):
        withdrawal = self.sent()
        self.as_staff(self.accountant, sudo=True)
        self.force_fail(withdrawal)
        payouts.apply_result(withdrawal.reference, providers.SUCCEEDED, amount_pesewas=5000)
        self.assertFalse(Journal.objects.filter(kind="withdrawal_paid").exists())
        self.assertTrue(FraudFlag.objects.filter(dedupe_key=f"withdrawal-late-paid-{withdrawal.reference}").exists())
        self.assertEqual(self.wallet(), 20000)


class StaffWithdrawalLedgerOffTests(TestCase):
    def test_it_says_ledger_off(self):
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(make_staff('accountant', 'kofi@example.com'), sudo=True)}")
        self.assertEqual(client.get(URL).json()["code"], "ledger_off")
        self.assertEqual(client.post(f"{URL}1/fail/", {"reason": "x"}, format="json").json()["code"], "ledger_off")
```

- [ ] **Step 2: Run it to see it fail**

Run: `docker compose -p wal1 run --rm web python manage.py test wallets.tests.test_staff_withdrawals --noinput`
Expected: FAIL — 404 for `/api/wallet/staff/withdrawals/`.

- [ ] **Step 3: The staff views** — in `backend/wallets/views_staff.py`, (a) replace

```python
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import BusinessOwner, Customer
from accounts.permissions import HasRolePermission
from ledger import escrow
from ledger.models import Account

from .services import money
from .views import Pagination, ledger_off
```

with

```python
from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import BusinessOwner, Customer
from accounts.permissions import HasRolePermission, RequiresSudo
from activity.services import record
from ledger import escrow
from ledger.models import Account

from . import payouts, withdrawals
from .models import Withdrawal
from .services import money
from .views import Pagination, ledger_off
```

and (b) append at the end of the file

```python


STATUS_FILTERS = {
    "open": Withdrawal.OPEN, "succeeded": (Withdrawal.SUCCEEDED,), "failed": (Withdrawal.FAILED,),
    "cancelled": (Withdrawal.CANCELLED,), "all": None,
}


def holders_of(rows):
    """{(holder_type, holder_id): name} for these withdrawals, in two queries."""
    customer_ids = {w.holder_id for w in rows if w.holder_type == "customer"}
    owner_ids = {w.holder_id for w in rows if w.holder_type == "business_owner"}
    names = {("customer", pk): name for pk, name in Customer.objects.filter(pk__in=customer_ids).values_list("pk", "full_name")}
    for owner in BusinessOwner.objects.filter(pk__in=owner_ids).select_related("profile"):
        names[("business_owner", owner.pk)] = owner.display_name
    return names


def staff_row(withdrawal, holders):
    return {
        **withdrawals.row(withdrawal), "holder_type": withdrawal.holder_type, "holder_id": withdrawal.holder_id,
        "holder_name": holders.get((withdrawal.holder_type, withdrawal.holder_id), ""), "provider": withdrawal.provider,
        "provider_reference": withdrawal.provider_reference, "submitted_at": withdrawal.submitted_at,
        "stuck": payouts.stuck(withdrawal),
    }


class StaffWithdrawalsView(APIView):
    """GET staff/withdrawals/?status=open|succeeded|failed|cancelled|all — newest first, 20 a page; `open` (held or sent,
    not settled) by default and for an unknown value. Destinations are masked."""

    def get_permissions(self):
        return [HasRolePermission(VIEW)]

    def get(self, request):
        if not escrow.enabled():
            return ledger_off()
        wanted = STATUS_FILTERS.get(request.query_params.get("status") or "open", Withdrawal.OPEN)
        rows = Withdrawal.objects.select_related("destination")
        if wanted is not None:
            rows = rows.filter(status__in=wanted)
        paginator = Pagination()
        page = paginator.paginate_queryset(rows.order_by("-created_at", "-id"), request, view=self)
        holders = holders_of(page)
        return paginator.get_paginated_response([staff_row(withdrawal, holders) for withdrawal in page])


class StaffWithdrawalFailView(APIView):
    """POST staff/withdrawals/<id>/fail/ {reason} — fail a withdrawal stuck with the provider (sent 30+ minutes ago with
    no answer, or held and never sent for 10+ minutes) and return the money. wallets.manage and the password again.
    Check with the provider first: if it did pay after all, its late report opens a fraud case and is never posted."""

    def get_permissions(self):
        return [HasRolePermission(MANAGE), RequiresSudo()]

    def post(self, request, pk):
        if not escrow.enabled():
            return ledger_off()
        data = request.data if isinstance(request.data, dict) else {}
        reason = str(data.get("reason") or "").strip()
        if not reason:
            return Response({"reason": "Say why, after checking with the provider."}, status=status.HTTP_400_BAD_REQUEST)
        with transaction.atomic():
            withdrawal = get_object_or_404(Withdrawal.objects.select_for_update(), pk=pk)
            if not payouts.stuck(withdrawal):
                return Response(
                    {"detail": "Only a withdrawal stuck with the provider can be failed by hand.", "code": "not_stuck"},
                    status=status.HTTP_409_CONFLICT,
                )
            before = withdrawal.status
            payouts.close(withdrawal, Withdrawal.FAILED, f"Failed by AshantiHub: {reason}", timezone.now())
            # Last: record() holds the activity chain lock until commit. No account number, ever.
            record(
                request.user, "wallets.withdrawal_failed", target=withdrawal,
                summary=f"Withdrawal {withdrawal.reference} failed by staff; GH₵ {money(withdrawal.amount_pesewas)} returned",
                before={"status": before}, after={"status": withdrawal.status, "reason": reason[:300]}, request=request,
            )
        return Response(staff_row(withdrawal, holders_of([withdrawal])))
```

In `backend/wallets/urls.py` replace

```python
    path("staff/wallets/", views_staff.StaffWalletsView.as_view(), name="wallet-staff-wallets"),
```

with

```python
    path("staff/wallets/", views_staff.StaffWalletsView.as_view(), name="wallet-staff-wallets"),
    path("staff/withdrawals/", views_staff.StaffWithdrawalsView.as_view(), name="wallet-staff-withdrawals"),
    path("staff/withdrawals/<int:pk>/fail/", views_staff.StaffWithdrawalFailView.as_view(), name="wallet-staff-withdrawal-fail"),
```

- [ ] **Step 4: Run the tests**

Run: `docker compose -p wal1 run --rm web python manage.py test wallets --noinput`
Expected: PASS (7 new tests, and every earlier wallets test).

- [ ] **Step 5: Commit**

```bash
git add backend/wallets
git commit -m "feat(wallets): staff withdrawal list and failing a stuck withdrawal (wallets.manage, password)"
```

---

### Task 6: The nightly reconciliation

**Files:**
- Modify: `backend/payments/providers.py` (statement interface), `backend/wallets/models.py` (`ReconciliationRun`), `backend/wallets/tasks.py`, `backend/wallets/views_staff.py`, `backend/wallets/urls.py`, `backend/ashantihub/settings.py` (`CELERY_BEAT_SCHEDULE`)
- Create: `backend/wallets/migrations/0003_reconciliation.py` (generated), `backend/wallets/reconciliation.py`, `backend/wallets/tests/test_reconciliation.py`

**Interfaces:**
- Consumes: `CheckoutSession` (`processing_fee`, `WALLET_TOPUP`, `metadata["ledger"]`, `metadata["order_id"]`) and `wallets.services.topup_key` (Plan 3a); `Withdrawal`, `withdrawals.paid_key` (Task 3); `posting.lock`; `fraud.services.raise_flag`; `notifications.services.notify_staff_role`; `VIEW`, `ledger_off`, `money` (Plan 3a).
- Produces:
  - `payments.providers`: `COLLECTION = "collection"`, `PAYOUT = "payout"`, `StatementLine(reference, kind, amount_pesewas, at)`, `day_bounds(day) -> (start, end)`; `PaymentProvider.statement(day) -> list[StatementLine]`, `.find(reference) -> StatementLine | None`, `.pending_payouts() -> int` (NotConnected by default; implemented by `SimulatedProvider`)
  - model `wallets.ReconciliationRun(day unique, provider, status, ledger_in_pesewas, statement_in_pesewas, ledger_out_pesewas, statement_out_pesewas, in_transit_pesewas, differences, flag, ran_at)`; statuses `MATCHED`, `MISMATCHED`, `UNAVAILABLE`
  - `wallets.reconciliation.reconcile(day, now=None) -> ReconciliationRun`; difference problems `missing_in_ledger`, `amount_differs`, `missing_on_statement`, `in_transit_differs`, `pending_differs`
  - Celery task `wallets.tasks.reconcile_yesterday`; beat entry `"wallets-reconcile"` (02:30); `GET /api/wallet/staff/reconciliation/`

- [ ] **Step 1: Write the failing test** — `backend/wallets/tests/test_reconciliation.py`

```python
"""The nightly reconciliation (wallets plan 3b, Task 6; spec §2 "compares the ledger to the provider statement and flags
differences"). Review Focus 7: no false alarms, and a real difference opens one case."""
from datetime import timedelta
from decimal import Decimal

from django.conf import settings
from django.core.cache import cache
from django.db import transaction
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import BusinessOwner, Customer
from accounts.testing import make_staff, staff_token
from billing.models import Transaction
from fraud.models import FraudFlag
from ledger import escrow, posting
from ledger.models import Account
from listings.models import Category, Listing, Zone
from notifications.models import Notification
from orders.models import Order, OrderItem
from payments.models import CheckoutSession
from payments.services import process_payment
from wallets import payouts, reconciliation, tasks, withdrawals
from wallets.models import ReconciliationRun

from .helpers import Holder, destination


@override_settings(LEDGER_ENABLED=True)
class ReconciliationTests(TestCase):
    def setUp(self):
        cache.clear()
        self.customer = Customer.objects.create(full_name="Ama Owusu", phone="+233241234567", password_hash="x")
        self.ama = Holder(self.customer, "customer")
        self.owner = BusinessOwner.objects.create(full_name="Kwame Mensah", login_phone="+233201112233", password_hash="x")
        self.kente = self.listing("60.00")
        self.accountant = make_staff("accountant", "kofi@example.com")
        self.today = timezone.localdate()

    def listing(self, price):
        return Listing.objects.create(
            business_owner=self.owner, category=Category.objects.get(slug="shops"), zone=Zone.objects.get(name="Manhyia"),
            name=f"Item {price}", description="D.", contact_phone=self.owner.login_phone, price_amount=Decimal(price), status=Listing.PUBLISHED,
        )

    def buy(self, method="momo", listing=None):
        self.ama.client.post("/api/cart/items/", {"listing": (listing or self.kente).pk, "quantity": 1}, format="json")
        response = self.ama.client.post("/api/orders/checkout/", {"payment_method": method}, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        return response.json()["id"]

    def top_up(self, amount):
        self.assertEqual(self.ama.client.post("/api/wallet/top-up/", {"amount": amount}, format="json").status_code, 201)

    def test_a_clean_day_matches(self):
        self.top_up("100.00")
        self.buy("momo")
        self.buy("wallet")
        with transaction.atomic():
            held = withdrawals.request(self.customer, destination_id=destination(self.customer).pk, amount_pesewas=2000, request_id="req-recon-0001")
        payouts.submit(held.pk)
        run = reconciliation.reconcile(self.today)
        self.assertEqual((run.status, run.differences), (ReconciliationRun.MATCHED, []))
        self.assertEqual((run.statement_in_pesewas, run.ledger_in_pesewas), (16000, 16000))           # top-up 100.00 + MoMo order 60.00
        self.assertEqual((run.statement_out_pesewas, run.ledger_out_pesewas), (2000, 2000))
        self.assertEqual(run.in_transit_pesewas, 0)
        self.assertFalse(FraudFlag.objects.exists())

    @override_settings(SIMULATED_COLLECTION_CHARGE_BP=200)
    def test_the_processing_charge_the_provider_kept_is_not_a_difference(self):
        self.top_up("50.00")
        self.buy("momo")
        run = reconciliation.reconcile(self.today)
        self.assertEqual((run.status, run.statement_in_pesewas, run.ledger_in_pesewas), (ReconciliationRun.MATCHED, 11000, 11000))

    def test_review_focus_payments_the_ledger_was_not_asked_to_record_are_not_differences(self):
        with override_settings(LEDGER_ENABLED=False):
            self.buy("momo")                                                                          # paid while the ledger was off
        self.buy("momo", listing=self.listing("0.00"))                                                 # a GH₵ 0.00 order
        process_payment(kind=CheckoutSession.SUBSCRIPTION, amount=Decimal("50.00"), purpose="Plan", business_owner=self.owner, metadata={})
        run = reconciliation.reconcile(self.today)
        self.assertEqual((run.status, run.differences), (ReconciliationRun.MATCHED, []))

    def test_review_focus_a_payment_with_no_journal_is_a_difference_and_opens_one_case(self):
        order = Order.objects.create(customer=self.customer, status=Order.PAID, total_amount=Decimal("60.00"))
        OrderItem.objects.create(order=order, listing=self.kente, quantity=1, unit_price=Decimal("60.00"), line_total=Decimal("60.00"))
        txn = Transaction.objects.create(customer=self.customer, amount=Decimal("60.00"), purpose="Order", reference="AH-ORDER_CHECKOUT-LOST000001")
        CheckoutSession.objects.create(
            customer=self.customer, kind=CheckoutSession.ORDER_CHECKOUT, amount=Decimal("60.00"), purpose="Order", reference=txn.reference,
            status=CheckoutSession.SUCCESS, transaction=txn, metadata={"order_id": order.pk, "ledger": True},
        )                                                                                              # paid, but its finalizer never posted
        run = reconciliation.reconcile(self.today)
        self.assertEqual(run.status, ReconciliationRun.MISMATCHED)
        self.assertEqual(run.differences, [{"reference": txn.reference, "kind": "collection", "problem": "missing_in_ledger", "ledger": None, "statement": 6000}])
        flag = FraudFlag.objects.get(dedupe_key=f"reconciliation-{self.today.isoformat()}")
        self.assertEqual(run.flag_id, flag.pk)
        self.assertEqual(Notification.objects.filter(staff=self.accountant, kind="reconciliation_mismatch").count(), 1)
        reconciliation.reconcile(self.today)                                                          # the same day again
        self.assertEqual(FraudFlag.objects.filter(dedupe_key=f"reconciliation-{self.today.isoformat()}").count(), 1)
        self.assertEqual(Notification.objects.filter(staff=self.accountant, kind="reconciliation_mismatch").count(), 1)
        self.assertEqual(ReconciliationRun.objects.count(), 1)

    def test_a_clearing_entry_with_no_provider_record_is_a_difference(self):
        order = Order.objects.create(customer=self.customer, status=Order.PAID, total_amount=Decimal("60.00"))
        OrderItem.objects.create(order=order, listing=self.kente, quantity=1, unit_price=Decimal("60.00"), line_total=Decimal("60.00"))
        escrow.record_order_payment(order)                                                            # no checkout session behind it
        run = reconciliation.reconcile(self.today)
        self.assertEqual(run.differences, [{"reference": f"order-pay-{order.pk}", "kind": "collection", "problem": "missing_on_statement", "ledger": 6000, "statement": None}])

    def test_review_focus_a_payment_confirmed_before_midnight_is_not_a_difference_either_day(self):
        self.buy("momo")
        session = CheckoutSession.objects.get(kind=CheckoutSession.ORDER_CHECKOUT)
        Transaction.objects.filter(pk=session.transaction_id).update(created_at=timezone.now() - timedelta(days=1))
        self.assertEqual(reconciliation.reconcile(self.today - timedelta(days=1)).differences, [])
        self.assertEqual(reconciliation.reconcile(self.today).differences, [])

    def test_in_transit_must_equal_the_open_withdrawals(self):
        self.top_up("10.00")
        posting.post(key="stray", kind="test", lines=[
            posting.debit(posting.account_for(Account.CUSTOMER_WALLET, self.customer), 500),
            posting.credit(posting.account_for(Account.WITHDRAWAL_IN_TRANSIT), 500),
        ])
        run = reconciliation.reconcile(self.today)
        self.assertEqual(run.differences, [{"reference": "withdrawal_in_transit", "kind": "payout", "problem": "in_transit_differs", "ledger": 500, "statement": 0}])

    @override_settings(PAYMENTS_PROVIDER="hubtel")
    def test_a_provider_without_a_statement_is_recorded_as_unavailable(self):
        run = reconciliation.reconcile(self.today)
        self.assertEqual((run.status, run.provider), (ReconciliationRun.UNAVAILABLE, "hubtel"))
        self.assertFalse(FraudFlag.objects.exists())

    def test_the_nightly_task_reconciles_yesterday(self):
        self.assertEqual(tasks.reconcile_yesterday(), ReconciliationRun.MATCHED)
        self.assertTrue(ReconciliationRun.objects.filter(day=self.today - timedelta(days=1)).exists())
        self.assertEqual(settings.CELERY_BEAT_SCHEDULE["wallets-reconcile"]["task"], "wallets.tasks.reconcile_yesterday")

    def test_staff_read_the_runs(self):
        reconciliation.reconcile(self.today)
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(self.accountant)}")
        body = client.get("/api/wallet/staff/reconciliation/").json()
        self.assertEqual((body["results"][0]["day"], body["results"][0]["status"]), (self.today.isoformat(), "matched"))
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(make_staff('support', 'esi@example.com'))}")
        self.assertEqual(client.get("/api/wallet/staff/reconciliation/").status_code, 403)


class ReconciliationLedgerOffTests(TestCase):
    def test_the_task_does_nothing_while_the_ledger_is_off(self):
        self.assertIsNone(tasks.reconcile_yesterday())
        self.assertFalse(ReconciliationRun.objects.exists())
```

- [ ] **Step 2: Run it to see it fail**

Run: `docker compose -p wal1 run --rm web python manage.py test wallets.tests.test_reconciliation --noinput`
Expected: ERROR — `ImportError: cannot import name 'reconciliation' from 'wallets'`.

- [ ] **Step 3: The provider's statement** — in `backend/payments/providers.py`, (a) replace

```python
from dataclasses import dataclass

from django.conf import settings

MOMO, BANK = "momo", "bank"
```

with

```python
from dataclasses import dataclass
from datetime import datetime, time, timedelta

from django.conf import settings
from django.utils import timezone

from ledger.money import to_pesewas

MOMO, BANK = "momo", "bank"
COLLECTION, PAYOUT = "collection", "payout"
```

(b) replace

```python
def basis_points(amount_pesewas, bp):
```

with

```python
@dataclass(frozen=True)
class StatementLine:
    """One completed movement on the provider's books, under our reference. `amount_pesewas` is what reached provider
    clearing (a collection less the charge the provider kept) or what left it (a payout, the provider's charge included)."""

    reference: str
    kind: str  # COLLECTION or PAYOUT
    amount_pesewas: int
    at: datetime


def day_bounds(day):
    """[start, end) of a calendar day in AshantiHub's time zone (Africa/Accra)."""
    start = timezone.make_aware(datetime.combine(day, time.min))
    return start, start + timedelta(days=1)


def basis_points(amount_pesewas, bp):
```

(c) replace

```python
    def status(self, reference):
        raise NotConnected(f"{self.name} cannot report payout status yet")


class SimulatedProvider(PaymentProvider):
```

with

```python
    def status(self, reference):
        raise NotConnected(f"{self.name} cannot report payout status yet")

    def statement(self, day):
        """Completed collections and payouts whose completion falls on `day` (a list of StatementLine)."""
        raise NotConnected(f"{self.name} cannot give a statement yet")

    def find(self, reference):
        """The completed movement under our `reference`, whatever day it completed, or None."""
        raise NotConnected(f"{self.name} cannot give a statement yet")

    def pending_payouts(self):
        """What the provider holds as instructed but not yet confirmed payouts, in pesewas."""
        raise NotConnected(f"{self.name} cannot give a statement yet")


class SimulatedProvider(PaymentProvider):
```

and (d) in `SimulatedProvider`, replace

```python
    def status(self, reference):
        outcome = _OUTCOMES.get(settings.SIMULATED_PAYOUT_OUTCOME, PROCESSING)
        return PayoutResult(outcome, provider_reference=f"SIM-{reference}")
```

with

```python
    def status(self, reference):
        outcome = _OUTCOMES.get(settings.SIMULATED_PAYOUT_OUTCOME, PROCESSING)
        return PayoutResult(outcome, provider_reference=f"SIM-{reference}")

    # The simulated provider's books are what it did: the checkout sessions it confirmed (wallet payments are not its
    # movements) and the withdrawals it paid. Read from our own tables, which is all a simulation has.

    @staticmethod
    def _collection(session):
        return StatementLine(session.reference, COLLECTION, to_pesewas(session.amount - session.processing_fee), session.transaction.created_at)

    @staticmethod
    def _payout(withdrawal):
        return StatementLine(withdrawal.reference, PAYOUT, withdrawal.amount_pesewas, withdrawal.settled_at)

    def statement(self, day):
        from payments.models import CheckoutSession
        from wallets.models import Withdrawal

        start, end = day_bounds(day)
        sessions = CheckoutSession.objects.filter(
            provider=self.name, status=CheckoutSession.SUCCESS, transaction__created_at__gte=start, transaction__created_at__lt=end,
        ).select_related("transaction").order_by("transaction__created_at", "id")
        paid = Withdrawal.objects.filter(provider=self.name, status=Withdrawal.SUCCEEDED, settled_at__gte=start, settled_at__lt=end).order_by("settled_at", "id")
        return [self._collection(s) for s in sessions] + [self._payout(w) for w in paid]

    def find(self, reference):
        from payments.models import CheckoutSession
        from wallets.models import Withdrawal

        session = CheckoutSession.objects.filter(
            provider=self.name, status=CheckoutSession.SUCCESS, reference=reference, transaction__isnull=False,
        ).select_related("transaction").first()
        if session is not None:
            return self._collection(session)
        withdrawal = Withdrawal.objects.filter(provider=self.name, status=Withdrawal.SUCCEEDED, reference=reference).first()
        return self._payout(withdrawal) if withdrawal is not None else None

    def pending_payouts(self):
        from django.db.models import Sum

        from wallets.models import Withdrawal

        return Withdrawal.objects.filter(provider=self.name, status=Withdrawal.PROCESSING).aggregate(total=Sum("amount_pesewas"))["total"] or 0
```

- [ ] **Step 4: The run** — append to `backend/wallets/models.py`

```python


class ReconciliationRun(models.Model):
    """One night's comparison of the ledger with the provider's statement for `day` (wallets.reconciliation). A report
    only: it never changes a balance. Re-running a day replaces its row."""

    MATCHED, MISMATCHED, UNAVAILABLE = "matched", "mismatched", "unavailable"
    STATUS_CHOICES = [(MATCHED, "Matches"), (MISMATCHED, "Differences found"), (UNAVAILABLE, "No statement from the provider")]

    day = models.DateField(unique=True)
    provider = models.CharField(max_length=20)
    status = models.CharField(max_length=12, choices=STATUS_CHOICES)
    ledger_in_pesewas = models.BigIntegerField(default=0)
    statement_in_pesewas = models.BigIntegerField(default=0)
    ledger_out_pesewas = models.BigIntegerField(default=0)
    statement_out_pesewas = models.BigIntegerField(default=0)
    in_transit_pesewas = models.BigIntegerField(default=0)
    differences = models.JSONField(default=list, blank=True)
    flag = models.ForeignKey("fraud.FraudFlag", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    ran_at = models.DateTimeField()

    class Meta:
        ordering = ["-day"]

    def __str__(self):
        return f"Reconciliation {self.day}: {self.status}"
```

Run: `docker compose -p wal1 run --rm web python manage.py makemigrations wallets --name reconciliation`
Expected: `backend/wallets/migrations/0003_reconciliation.py` with `CreateModel` `ReconciliationRun` (depending on `("wallets", "0002_withdrawals")` and the `fraud` app).

- [ ] **Step 5: The reconciliation** — `backend/wallets/reconciliation.py`

```python
"""The nightly reconciliation (spec §2: "A nightly reconciliation compares the ledger to the provider statement and
flags differences"). Read-only: it never posts or corrects anything. For a day it checks, by provider reference:

* every collection or payout on the provider's statement has its journal, for the same amount (missing_in_ledger,
  amount_differs), skipping what the ledger was never asked to record: payments made while it was off (no
  metadata["ledger"]), kinds it does not record yet (subscriptions, tickets, bookings...) and GH₵ 0.00 payments;
* every journal of the day that moved provider clearing names a movement the provider confirms, on any day
  (missing_on_statement; so a payment confirmed a second before midnight is not a false alarm);

and, as it runs, that withdrawal in transit equals the open withdrawals (in_transit_differs) and that the provider's
unconfirmed payouts equal ours (pending_differs). A difference opens one fraud case per day and tells wallets.view
holders once. A provider that cannot give a statement (Hubtel until Plan 7) is recorded as unavailable."""
from django.db import transaction
from django.db.models import Sum
from django.utils import timezone

from fraud import services as fraud
from fraud.models import FraudFlag
from ledger import posting
from ledger.models import Account, JournalLine
from notifications.services import notify_staff_role
from payments import providers
from payments.models import CheckoutSession

from .models import ReconciliationRun, Withdrawal
from .services import topup_key
from .withdrawals import paid_key

LEDGER_KINDS = (CheckoutSession.ORDER_CHECKOUT, CheckoutSession.WALLET_TOPUP)


def _difference(reference, kind, problem, ledger, statement):
    return {"reference": reference, "kind": kind, "problem": problem, "ledger": ledger, "statement": statement}


def expected_key(line):
    """The journal a statement line should have, or None when the ledger was never asked to record it."""
    if line.kind == providers.PAYOUT:
        return paid_key(line.reference)
    session = CheckoutSession.objects.filter(reference=line.reference).first()
    if session is None or session.kind not in LEDGER_KINDS or not session.metadata.get("ledger") or line.amount_pesewas <= 0:
        return None
    if session.kind == CheckoutSession.WALLET_TOPUP:
        return topup_key(session.reference)
    return f"order-pay-{session.metadata.get('order_id')}"


def provider_reference(journal):
    """The provider reference a journal that moved provider clearing stands for, or None."""
    if journal.key.startswith(("wallet-topup-", "withdrawal-paid-")):
        return journal.reference_id
    if journal.key.startswith("order-pay-") and journal.reference_id.isdigit():
        session = CheckoutSession.objects.filter(
            kind=CheckoutSession.ORDER_CHECKOUT, metadata__order_id=int(journal.reference_id), status=CheckoutSession.SUCCESS,
        ).first()
        return session.reference if session is not None else None
    return None


def clearing_amount(key, side):
    line = JournalLine.objects.filter(journal__key=key, account__kind=Account.PROVIDER_CLEARING, side=side).first()
    return line.amount if line is not None else None


def reconcile(day, now=None):
    now = now or timezone.now()
    provider = providers.get_provider()
    try:
        lines = provider.statement(day)
    except providers.NotConnected:
        run, _ = ReconciliationRun.objects.update_or_create(day=day, defaults={
            "provider": provider.name, "status": ReconciliationRun.UNAVAILABLE, "differences": [], "ran_at": now,
            "ledger_in_pesewas": 0, "statement_in_pesewas": 0, "ledger_out_pesewas": 0, "statement_out_pesewas": 0, "in_transit_pesewas": 0,
        })
        return run

    differences, seen = [], set()
    statement_in = statement_out = 0
    for line in lines:
        key = expected_key(line)
        if key is None:
            continue
        seen.add(key)
        if line.kind == providers.COLLECTION:
            statement_in += line.amount_pesewas
        else:
            statement_out += line.amount_pesewas
        side = JournalLine.DEBIT if line.kind == providers.COLLECTION else JournalLine.CREDIT
        booked = clearing_amount(key, side)
        if booked is None:
            differences.append(_difference(line.reference, line.kind, "missing_in_ledger", None, line.amount_pesewas))
        elif booked != line.amount_pesewas:
            differences.append(_difference(line.reference, line.kind, "amount_differs", booked, line.amount_pesewas))

    start, end = providers.day_bounds(day)
    ledger_in = ledger_out = 0
    entries = JournalLine.objects.filter(
        account__kind=Account.PROVIDER_CLEARING, journal__created_at__gte=start, journal__created_at__lt=end,
    ).select_related("journal").order_by("id")
    for entry in entries:
        kind = providers.COLLECTION if entry.side == JournalLine.DEBIT else providers.PAYOUT
        if entry.side == JournalLine.DEBIT:
            ledger_in += entry.amount
        else:
            ledger_out += entry.amount
        if entry.journal.key in seen:
            continue
        reference = provider_reference(entry.journal)
        if reference is None or provider.find(reference) is None:
            differences.append(_difference(reference or entry.journal.key, kind, "missing_on_statement", entry.amount, None))

    with transaction.atomic():
        transit = posting.account_for(Account.WITHDRAWAL_IN_TRANSIT)
        in_transit = posting.lock(transit)[transit.pk].balance          # no hold or settlement moves while we count
        open_total = Withdrawal.objects.filter(status__in=Withdrawal.OPEN).aggregate(total=Sum("amount_pesewas"))["total"] or 0
        ours_sent = Withdrawal.objects.filter(status=Withdrawal.PROCESSING, provider=provider.name).aggregate(total=Sum("amount_pesewas"))["total"] or 0
        theirs_sent = provider.pending_payouts()
    if in_transit != open_total:
        differences.append(_difference("withdrawal_in_transit", providers.PAYOUT, "in_transit_differs", in_transit, open_total))
    if theirs_sent != ours_sent:
        differences.append(_difference("pending_payouts", providers.PAYOUT, "pending_differs", ours_sent, theirs_sent))

    run, _ = ReconciliationRun.objects.update_or_create(day=day, defaults={
        "provider": provider.name, "status": ReconciliationRun.MISMATCHED if differences else ReconciliationRun.MATCHED,
        "differences": differences, "ran_at": now, "ledger_in_pesewas": ledger_in, "statement_in_pesewas": statement_in,
        "ledger_out_pesewas": ledger_out, "statement_out_pesewas": statement_out, "in_transit_pesewas": in_transit,
    })
    if differences:
        _raise(run, provider, differences)
    return run


def _raise(run, provider, differences):
    """One fraud case per day (dedupe key) and one notice to wallets.view holders, however often the day is re-run.
    References only: no account number ever reaches a case or a notice."""
    flag = fraud.raise_flag(
        FraudFlag.OTHER, title=f"Money reconciliation for {run.day:%d %b %Y} does not match",
        detail=(f"{len(differences)} difference(s) between the ledger and the {provider.name} statement. "
                "Nothing was corrected; see Wallets, Reconciliation."),
        evidence=[f"{d['problem']}: {d['reference']}" for d in differences[:20]],
        dedupe_key=f"reconciliation-{run.day.isoformat()}",
    )
    if run.flag_id != flag.pk:
        run.flag = flag
        run.save(update_fields=["flag"])
        notify_staff_role(
            "wallets.view", "reconciliation_mismatch",
            f"Reconciliation for {run.day:%d %b %Y} found {len(differences)} difference(s)",
            body="Nothing was corrected. Open Wallets, Reconciliation.", link="wallets-reconciliation", icon="🧮",
        )
```

- [ ] **Step 6: The task, its schedule and the staff read** — (a) in `backend/wallets/tasks.py` replace

```python
from celery import shared_task

from ledger import escrow

from . import payouts
```

with

```python
from datetime import timedelta

from celery import shared_task
from django.utils import timezone

from ledger import escrow

from . import payouts
```

and append

```python


@shared_task
def reconcile_yesterday():
    """02:30 every night: compare yesterday's ledger with the provider's statement (a no-op while the ledger is off).
    Read-only: it never corrects a balance."""
    if not escrow.enabled():
        return None
    from .reconciliation import reconcile

    return reconcile(timezone.localdate() - timedelta(days=1)).status
```

(b) in `backend/ashantihub/settings.py` replace

```python
    "wallets-poll-withdrawals": {
        "task": "wallets.tasks.poll_withdrawals",
        "schedule": 300.0,  # every 5 minutes: a no-op while the ledger is off
    },
}
```

with

```python
    "wallets-poll-withdrawals": {
        "task": "wallets.tasks.poll_withdrawals",
        "schedule": 300.0,  # every 5 minutes: a no-op while the ledger is off
    },
    "wallets-reconcile": {
        "task": "wallets.tasks.reconcile_yesterday",
        "schedule": crontab(hour=2, minute=30),  # the day before; read-only; a no-op while the ledger is off
    },
}
```

(c) append to `backend/wallets/views_staff.py`

```python


class StaffReconciliationView(APIView):
    """GET staff/reconciliation/ — the last 30 nightly runs, newest day first (wallets.view)."""

    def get_permissions(self):
        return [HasRolePermission(VIEW)]

    def get(self, request):
        if not escrow.enabled():
            return ledger_off()
        from .models import ReconciliationRun

        return Response({"results": [
            {
                "day": run.day, "provider": run.provider, "status": run.status, "status_label": run.get_status_display(),
                "ledger_in": money(run.ledger_in_pesewas), "statement_in": money(run.statement_in_pesewas),
                "ledger_out": money(run.ledger_out_pesewas), "statement_out": money(run.statement_out_pesewas),
                "in_transit": money(run.in_transit_pesewas), "differences": run.differences, "fraud_case_id": run.flag_id,
                "ran_at": run.ran_at,
            }
            for run in ReconciliationRun.objects.order_by("-day")[:30]
        ]})
```

and (d) in `backend/wallets/urls.py` replace

```python
    path("staff/withdrawals/<int:pk>/fail/", views_staff.StaffWithdrawalFailView.as_view(), name="wallet-staff-withdrawal-fail"),
```

with

```python
    path("staff/withdrawals/<int:pk>/fail/", views_staff.StaffWithdrawalFailView.as_view(), name="wallet-staff-withdrawal-fail"),
    path("staff/reconciliation/", views_staff.StaffReconciliationView.as_view(), name="wallet-staff-reconciliation"),
```

- [ ] **Step 7: Run the tests**

Run: `docker compose -p wal1 run --rm web python manage.py test wallets payments core.tests.test_background_jobs --noinput`
Expected: PASS (11 new tests; Plan 3a's `payments.tests.test_providers` unchanged).

- [ ] **Step 8: Commit**

```bash
git add backend/payments/providers.py backend/wallets backend/ashantihub/settings.py
git commit -m "feat(wallets): nightly reconciliation of the ledger against the provider statement (read-only)"
```

---

### Task 7: Documentation and full verification

**Files:**
- Modify: `backend/CLAUDE.md`, `docs/superpowers/specs/2026-10-15-wallet-fees-security-design.md`

**Interfaces:**
- Consumes: everything above. Produces: no code.

- [ ] **Step 1: Correctness cores** — in `backend/CLAUDE.md`, (a) replace

```markdown
- **Payout account and MoMo numbers are stored unmasked.** `accounts/serializers.py`'s
  `mask_but_last()` in `StaffBusinessOwnerDetailSerializer.get_profile` is the **only** place they
  ever leave the server, always masked. Don't add a second path.
```

with

```markdown
- **Payout account and MoMo numbers are stored unmasked.** `accounts/serializers.py`'s
  `mask_but_last()` is the **only** way they ever leave the server, always masked: in
  `StaffBusinessOwnerDetailSerializer.get_profile`, and for wallet payout destinations in
  `wallets.destinations.row` (every holder and staff response, withdrawals included). Never put one in a log line, an
  activity body, a fraud case or a notice; `account_number` is in Sentry's denylist. Don't add another path.
```

and (b) replace

```markdown
  `handle_webhook` is `HubtelWebhookView` (both unchanged); the Hubtel provider's payout, status and name lookup raise
  `NotConnected` until Plan 7.
```

with

```markdown
  `handle_webhook` is `HubtelWebhookView` (both unchanged); the Hubtel provider's payout, status and name lookup raise
  `NotConnected` until Plan 7.
- **Payout destinations, withdrawals, reconciliation (`wallets/`, Stage 3b).** A destination is accepted only when the
  provider's account name matches the holder's verified name (`wallets.names`: customer profile name; KYC-verified
  vendor's owner or business name) and a step-up code is spent; it can receive money after `payout_cooling_hours`;
  it is never edited (remove + add). Destination add/remove and withdrawals call `step_up.require(..., force=True)`:
  while the ledger is on they always need a code, and the step-up endpoints send codes for those two actions.
  `wallets.withdrawals.request` locks the destination, then the source and in-transit accounts together
  (`posting.lock`), then checks balance and limits (governed `withdrawal_per_tx_limit_pesewas` /
  `withdrawal_daily_limit_pesewas`); a vendor's negative Available blocks it. A withdrawal is claimed before the
  provider is called (sent once) and ends only through `wallets.payouts.apply_result` / `close` (row lock, per-reference
  journal keys, a final status never changes; a "paid" report after the money went back is never posted and opens a
  fraud case). The nightly `wallets.reconciliation` is read-only and compares by provider reference.
```

- [ ] **Step 2: Spec scope** — in `docs/superpowers/specs/2026-10-15-wallet-fees-security-design.md` replace

```markdown
**Scope:** One system, built in the order given in §11. Stage 1 (ledger), Stage 2 (OTP, backend) and Stage 3a (wallet
payments and refunds, backend) are implemented behind switches that default off (branches feature/ledger-stage1,
feature/otp-security and feature/wallets; see section 13); later stages are specs only.
```

with

```markdown
**Scope:** One system, built in the order given in §11. Stage 1 (ledger), Stage 2 (OTP, backend) and Stage 3 (wallets,
payments, refunds, withdrawals and reconciliation, backend) are implemented behind switches that default off (branches
feature/ledger-stage1, feature/otp-security and feature/wallets; see section 13); later stages are specs only.
```

- [ ] **Step 3: Commit**

```bash
git add backend/CLAUDE.md docs
git commit -m "docs(wallets): correctness cores for destinations, withdrawals and reconciliation; spec scope (3b)"
```

- [ ] **Step 4: Run the whole backend suite**

Run: `docker compose -p wal1 run --rm web python manage.py test --noinput`
Expected: PASS. If a failure is unrelated to this work, confirm it on the last commit of Plan 3a (`git log --oneline` shows "docs(wallets): correctness core, spec status and carry-forward, stage index (3a)"; `git switch --detach <sha>`, re-run the failing label, `git switch feature/wallets`) and report it rather than fixing it here.

- [ ] **Step 5: Migrations check**

Run: `docker compose -p wal1 run --rm web python manage.py makemigrations --check --dry-run`
Expected: `No changes detected`.

---

## What this plan deliberately does not do (later plans)

| Plan | Scope | Why separate |
|---|---|---|
| **3F** Frontend | Payout destinations screen (add with the step-up prompt, masked list, "can receive money from"), withdrawal form with the charge and "you receive", withdrawal history, the staff withdrawals queue and reconciliation screen. | No screen ships in a backend plan; the API answers `step_up_required` / `ledger_off` for it to handle. |
| **4** Vendor dashboard and SMS | Vendor statement with Withdrawn status, withdrawal SMS. | Spec §6. |
| **5** Third-party riders | Rider wallet withdrawals (90% share), reserve, daily commission. | Spec §7; riders have no wallet yet. |
| **7** Hubtel live | Hubtel payouts, payout status, account-name lookups, the payout webhook (it calls `wallets.payouts.apply_result`), Hubtel's statement for the reconciliation, credentials, float funding. | Needs credentials and regulatory clearance (§11 step 7, §12). |
| Owner decisions | Limits per role (vendors vs customers), a minimum withdrawal, a wallet balance cap, customer KYC for a stronger name check. | Not decided; the plan's defaults are listed as assumptions B1–B9. |

## Self-review

**Spec coverage:**

| Requirement | Task(s) |
|---|---|
| §1 row 13 / §8 destination name-matched to the verified name (customer profile or vendor KYC) | 1 (`wallets.names`), 2 (`add`, `name_mismatch`, `kyc_required`) |
| §8 owner confirms by OTP | 1 (step-up codes for wallet actions with the ledger on), 2 (`force=True`), 4 (end to end with a texted code) |
| §8 new or changed destinations cannot receive money for an editable cooling period (default 24 h) | 1 (`payout_cooling_hours`), 2 (`usable_from`, never edited), 3 and 4 (`destination_cooling`) |
| §8 vendors withdraw only to a destination matching their registered business or owner name | 1, 2, 3 (re-checked at every withdrawal) |
| §8 / §3.3 daily and per-transaction limits, editable through the governed flow | 1 (settings via `ledger.setting`), 3 (`over_limit`, `daily_limit`) |
| §5 withdrawal to a verified MoMo number or bank account, the user bears the charge | 2, 3 (charge out of the amount), 4 |
| §6 vendor withdrawal; negative Available blocks it | 3, 4 |
| §2.2 step 5 in transit, instructed, completes on confirmation, reverses on failure | 3 |
| §2.3 payout and status behind the provider interface; idempotent, amount-verified, monotonic reports | 3 (`apply_result`), Plan 3a Task 1 (interface) |
| §2 nightly reconciliation flags differences | 6 |
| §9 step-up before withdrawal and payout-destination actions | 2, 4 |
| §11 step 3 behind a switch; nothing moves real money | every task (`LEDGER_ENABLED`; simulated provider) |
| Brief: staff lists, force-fail a stuck withdrawal | 5 |
| Brief: threaded tests for double withdrawal and duplicate callbacks | 3 (`ConcurrentWithdrawalTests`) |

**Placeholder scan:** every code step carries complete code and every test step complete test code; edits quote the exact text replaced; no "TBD", "similar to" or undefined names.

**Name consistency:** `wallets.names.words/matches/verified_names/matching_name` (1, 2, 3); `destinations.DestinationError(message, code, status_code=400, field=None)`, `live_for`, `clean`, `add`, `remove`, `row` with `account_number_masked` (2, 3, 5); `withdrawals.WithdrawalError(message, code, status_code=409, **extra)`, `hold_key`, `paid_key`, `reversed_key`, `source_kind`, `start_of_day`, `clean_request_id`, `mine`, `existing`, `request(holder, *, destination_id, amount_pesewas, request_id, now=None)`, `cancel(holder, withdrawal_id, now=None)`, `row` (3, 4, 5, 6); `payouts.claim/submit/apply_result(reference, status, *, provider_reference="", amount_pesewas=None, message="", now=None)/close(withdrawal, status, reason, now)/stuck/poll`, `STUCK_AFTER`, `STUCK_PENDING` (3, 4, 5); `providers.StatementLine`, `COLLECTION`, `PAYOUT`, `day_bounds`, `statement`, `find`, `pending_payouts` (6); `reconciliation.reconcile(day, now=None)` (6); `Withdrawal.OPEN/FINAL/COUNTED` (3, 5, 6); test helpers `Holder`, `fund`, `destination`, `MOMO_NUMBER` (2–6). From Plan 3a: `posting.lock`, `posting.balance_of`, `post(..., allow_negative=...)`, `get_provider`, `ledger_off`, `parse_amount`, `AmountError`, `Pagination`, `money`, `topup_key`, `VIEW`, `MANAGE`.

**Review Focus pins:** each of the eight lines above names the task and the test that pins it; all of those tests are written out in their tasks.
