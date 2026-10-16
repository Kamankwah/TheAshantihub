# Ledger, Fee Engine and Governed Money Settings — Implementation Plan (Stage 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the double-entry ledger, the editable platform-fee engine (with lifetime cap), governed money settings, ledger recording and release for product orders, and the subscription freeze — all on simulated rails, behind switches that default to today's behaviour.

**Architecture:** A new Django app `ledger` owns immutable journal entries (integer pesewas, balanced, idempotent). Orders post a payment journal when `payments.services._finalize_order_checkout` runs. The vendor's money is released by a person, not a timer: once the goods have reached the customer, a Support staff member's verification call records a positive result and the release journal posts at once (a mismatch raises a 72-hour dispute instead). A new Pickup Desk role confirms store-pickup collection. Fee rules and money settings are versioned rows changed only through the existing `approvals` engine (maker-checker). Everything is gated by `LEDGER_ENABLED` (default off) and `SUBSCRIPTIONS_ENABLED` (default on) so merging changes nothing until each switch is flipped.

**Tech Stack:** Django 5.2, DRF, Postgres (triggers), the repo's `approvals` and `activity` apps. Tests: `docker compose run --rm web python manage.py test <label>` from the repo root.

**Spec:** `docs/superpowers/specs/2026-10-15-wallet-fees-security-design.md` (see §0 below for deviations found while reconciling it with the code).

## 0. Reconciliation with the code (deviations from the spec)

These were found by reading the existing code; Task 1 records them in the spec.

| # | Spec said | Code reality | Plan does |
|---|---|---|---|
| D1 | Fee base = item subtotal **after discounts** | `OrderItem.line_total` already reflects seller-funded flash-sale prices; coupons are **AshantiHub-funded** and leave `line_total` untouched (`marketing/checkout.py`). | Fee base = Σ `line_total` per vendor and fee category. The coupon is a platform subsidy (`platform_promo_subsidy` account), never charged to the vendor. |
| D2 | Separate "Order escrow" account | Not needed: the payment journal allocates straight into Vendor Pending and Delivery payable. | No `order_escrow` account. Held funds are exactly Σ Vendor Pending + Σ Delivery payable. |
| D3 | Either role proposes, the other approves | `approvals` is maker-checker with a Super Admin approver for money kinds (see `commission/approval_kinds.py`); a Super Admin's own change applies at once and is logged. | Accounting proposes, Super Admin approves; Super Admin can apply directly. Accounting never approves. |
| D4 | Hubtel gated switch | `settings.PAYMENTS_PROVIDER` is derived from `HUBTEL_CLIENT_ID`. | Unchanged. Ledger records the same either way; no provider code is touched. |
| D5 | Subscriptions "hidden and frozen" | Listing creation **requires** an active subscription (`listings/serializers.py:236`), and registration's `plan_selection` step also captures `business_kind` (`accounts/models.py:377`, `billing/serializers.py` `StartTrialSerializer`). | Task 10 adds `SUBSCRIPTIONS_ENABLED`, skips both when off, and adds a business-kind endpoint. The frontend registration change is **Plan 1F**; the flag must stay on until 1F ships. |
| D6 | Timed hold-back, then auto-confirm | **Owner decision (2026-10-15):** vendor money is not held on a timer. Release happens when Support's verification call is positive. | `holdback_hours` and `product_auto_confirm_hours` are dropped. Task 8 adds `FulfilmentCheck`, the Support endpoints and release on a positive result. |
| D8 | Store pickup | **Owner decision:** collected at the AshantiHub office within 24 hours of purchase, confirmed by an AshantiHub staff member in a role that does not exist yet. | Task 9 adds the `pickup_desk` role, the `pickup.confirm` permission, the queue and the collect endpoint. |
| D7 | Services, events, stays | They pay through `process_payment` with other kinds (`ticket_purchase`, `service_request`, `booking`). Owner decision (2026-10-15): they use the same Support-verification release as products. | Out of scope for Stage 1 (product orders only). Plan 1b reuses `FulfilmentCheck`/`verification.record` and defines what "handed over" means for each kind. |

## Global Constraints

- Amounts in the ledger are **integer pesewas**, never floats or Decimals. Convert only through `ledger.money`.
- Fee rounding: nearest pesewa, **half up**.
- Product tiers (pesewas): `0–9,999` 1%; `10,000–49,999` flat `500`; `50,000–4,999,999` 1%; `5,000,000+` flat `50,000`.
- Fee cap is per vendor, **lifetime**, cumulative across categories; blank/None = no cap; the fee that crosses the cap is charged only up to the remainder.
- Delivery is paid by the customer **on top**, one fee per order, never borne by the vendor; to platform income while all riders are company staff.
- Journal rows are append-only (enforced by Postgres triggers). A balance is never edited outside `ledger.posting.post`.
- Defaults seeded as editable settings: verification-overdue `72` h (from purchase), store-pickup window `24` h, rider commission `1000` bp, fee cap blank.
- **No timer releases a vendor's money.** Release happens only inside `verification.record` on a positive Support outcome. A dispute that is open (any status not in `Dispute.FINAL_STATUSES`) blocks it.
- Customer contact details (phone) are shown only to Support (`orders.verify`); the Pickup Desk never sees them, and vendors never do.
- Staff-facing changes to fees/settings go through `approvals.services.submit()`; never write `FeeRuleSet`/`MoneySetting` rows from a view.
- A new staff endpoint is covered by `StaffActivityMiddleware`; apply handlers call `activity.services.record()` last.
- Match the repo's style: module docstrings, no type-annotation noise, tests in `<app>/tests/`.

## Review Focus

1. **An order that does not reconcile** (`total_amount + discount_amount ≠ Σ line_total + delivery_fee`): payment recording must fail loudly and roll back with no snapshots, not post a skewed journal. Pinned in Task 7.
2. **Free or zero-value vendor lines** (coupon covers everything, or a GHS 0 base): fee is 0, and no zero-amount journal line is written. Pinned in Task 7.
3. **Two payments for one vendor racing at the cap:** total fees never exceed the cap. Pinned in Task 7 (serialised by locking the vendor's Pending account).
4. **Finalizer runs twice** (webhook retry): one journal, one set of snapshots. Pinned in Task 7.
5. **Fee rules edited after an order is paid:** release uses the snapshot, not the new rules. Pinned in Task 8.
6. **A dispute is open (or ended `rejected` rather than `resolved`):** an open one blocks a positive verification, and a rejected one no longer does. Pinned in Task 8.
7. **The customer never taps "confirm receipt":** Support can record it on the call, so the vendor is not stuck. Pinned in Task 8.
8. **A pickup order is verified before anyone collected it, or a door-to-door order before the rider delivered it:** refused with 409, nothing moves. Pinned in Tasks 8 and 9.

## Assumptions to confirm (decided here, cheap to change)

- **A1 — customer confirmation.** You said both the rider and the customer confirm delivery. The plan requires the rider's delivery mark and **either** the customer's own confirmation **or** Support recording it on the verification call, so a customer who never taps "confirm" cannot strand the vendor's money.
- **A2 — pickup orders are also verified by a Support call** after the desk marks them collected (same flow as delivery).
- **A3 — a customer Support cannot reach** is recorded as "could not reach"; the order stays on Support's list, flagged overdue 72 hours after purchase. Nothing releases automatically.
- **A4 — a mismatch** raises a dispute with `answer_due_at` = purchase + 72 hours. After it ends (resolved or rejected), Support records the positive result to release. A customer refund after a dispute is Stage 3.
- **A5 — an uncollected pickup order** is only flagged overdue after 24 hours in Stage 1. Refunding it to the customer's wallet is Stage 3.
- **A6 — only a Super Admin invites a Pickup Desk member** (no invite rule is added).

## File Structure

Create:
- `backend/ledger/__init__.py`, `apps.py`, `models.py`, `money.py`, `posting.py`, `fees.py`, `settings_store.py`, `escrow.py`, `verification.py`, `approval_kinds.py`, `views.py`, `urls.py`
- `backend/ledger/migrations/0001_initial.py` (generated), `0002_append_only_triggers.py`, `0003_fee_models.py`, `0004_seed_default_fee_rules.py`, `0005_moneysetting.py`, `0006_fulfilmentcheck.py`
- `backend/accounts/migrations/0049_seed_ledger_permissions.py`, `0050_seed_order_verify_permission.py`, `0051_alter_role_name.py`, `0052_seed_pickup_desk_role.py`
- `backend/billing/switch.py`
- `backend/ledger/tests/__init__.py`, `test_money.py`, `test_models.py`, `test_posting.py`, `test_fees.py`, `test_settings_store.py`, `test_governance.py`, `test_order_payment.py`, `test_verification.py`, `test_pickup.py`
- `backend/billing/tests/test_subscription_freeze.py`

Modify:
- `backend/ashantihub/settings.py` (apps, flags)
- `backend/ashantihub/urls.py`
- `backend/payments/services.py` (finalizer hook)
- `backend/accounts/models.py` (`Role.PICKUP_DESK`), `backend/accounts/tests/test_roles_seed.py`, `docs/STAFF_ROLES.md`
- `backend/listings/serializers.py` (listing creation gate)
- `backend/accounts/models.py` (`compute_registration_step`)
- `backend/billing/views.py`, `billing/urls.py`, `billing/clock.py`
- `backend/CLAUDE.md`, `docs/superpowers/specs/2026-10-15-wallet-fees-security-design.md`

---

### Task 1: App scaffold, flags, money helpers, spec addendum

**Files:**
- Create: `backend/ledger/__init__.py`, `backend/ledger/apps.py`, `backend/ledger/money.py`, `backend/ledger/tests/__init__.py`, `backend/ledger/tests/test_money.py`
- Modify: `backend/ashantihub/settings.py` (INSTALLED_APPS after `"commission"`; add flags near `SUBSCRIPTION_PAUSE_ENABLED`), `docs/superpowers/specs/2026-10-15-wallet-fees-security-design.md`

**Interfaces:**
- Produces: `ledger.money.to_pesewas(value) -> int` (raises `ValueError` if not a whole number of pesewas), `ledger.money.from_pesewas(p: int) -> Decimal`; `settings.LEDGER_ENABLED: bool`, `settings.SUBSCRIPTIONS_ENABLED: bool`.

- [ ] **Step 1: Write the failing test** — `backend/ledger/tests/test_money.py`

```python
from decimal import Decimal

from django.test import SimpleTestCase

from ledger.money import from_pesewas, to_pesewas


class MoneyTests(SimpleTestCase):
    def test_whole_cedis_and_pesewas_convert_exactly(self):
        self.assertEqual(to_pesewas("99.99"), 9999)
        self.assertEqual(to_pesewas(Decimal("100.00")), 10000)
        self.assertEqual(to_pesewas(Decimal("0.1")), 10)
        self.assertEqual(to_pesewas(0), 0)

    def test_a_fraction_of_a_pesewa_is_refused_not_rounded(self):
        with self.assertRaises(ValueError):
            to_pesewas("1.005")

    def test_round_trip(self):
        self.assertEqual(from_pesewas(9999), Decimal("99.99"))
        self.assertEqual(from_pesewas(5000000), Decimal("50000.00"))
        self.assertEqual(from_pesewas(0), Decimal("0.00"))
```

- [ ] **Step 2: Run it to see it fail**

Run: `docker compose run --rm web python manage.py test ledger.tests.test_money`
Expected: ERROR `No module named 'ledger'`.

- [ ] **Step 3: Create the app and helpers**

`backend/ledger/__init__.py`: empty file.
`backend/ledger/tests/__init__.py`: empty file.

`backend/ledger/apps.py`:

```python
from django.apps import AppConfig


class LedgerConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "ledger"

    def ready(self):
        from approvals import registry

        from .approval_kinds import FEE_RULES, MONEY_SETTING

        for kind in (FEE_RULES, MONEY_SETTING):
            if registry.get_kind(kind.key) is None:
                registry.register(kind)
```

`backend/ledger/money.py`:

```python
"""Money helpers for the ledger. Ledger amounts are integer pesewas (1 GH₵ = 100);
Decimal GH₵ exists only at the edges (the rest of the codebase stores Decimal(10, 2))."""
from decimal import ROUND_HALF_UP, Decimal

PESEWA = Decimal("0.01")


def to_pesewas(value):
    """Integer pesewas from a GH₵ amount. A fraction of a pesewa is a bug upstream, so it raises."""
    amount = Decimal(str(value))
    if amount != amount.quantize(PESEWA):
        raise ValueError(f"{value!r} is not a whole number of pesewas")
    return int((amount * 100).to_integral_value(rounding=ROUND_HALF_UP))


def from_pesewas(pesewas):
    return (Decimal(pesewas) / 100).quantize(PESEWA)
```

In `backend/ashantihub/settings.py` add `"ledger",` to `INSTALLED_APPS` directly after `"commission",`, and add below the `SUBSCRIPTION_PAUSE_ENABLED` line:

```python
# The ledger (docs/superpowers/specs/2026-10-15-wallet-fees-security-design.md). Off by default: with it off
# no journal is posted and no fee is snapshotted, so payments behave exactly as before. Turn it on per
# environment once staging has been checked. Read at call time through ledger.escrow.enabled().
LEDGER_ENABLED = env.bool("LEDGER_ENABLED", default=False)

# Subscriptions as a product. On (default) = today's behaviour. Off = plans are hidden, nothing can be bought or
# renewed, the billing clock stops, and listing creation no longer needs a plan. Keep it ON until the frontend
# registration change (Plan 1F) ships, because registration still asks for a plan. See billing/switch.py.
SUBSCRIPTIONS_ENABLED = env.bool("SUBSCRIPTIONS_ENABLED", default=True)
```

- [ ] **Step 4: Create a stub `approval_kinds.py` so `ready()` imports** — `backend/ledger/approval_kinds.py`:

```python
"""Filled in by Task 6. Present now so LedgerConfig.ready() imports cleanly."""
from approvals.registry import ApprovalKind


def _unused(request):
    return {}


FEE_RULES = ApprovalKind(key="ledger.fee_rules", label="Change platform-fee rules", pool_permission="", current_state=_unused, apply=_unused)
MONEY_SETTING = ApprovalKind(key="ledger.setting", label="Change a money setting", pool_permission="", current_state=_unused, apply=_unused)
```

- [ ] **Step 5: Run the tests**

Run: `docker compose run --rm web python manage.py test ledger.tests.test_money`
Expected: 3 tests PASS.

- [ ] **Step 6: Record the deviations in the spec.** Append to `docs/superpowers/specs/2026-10-15-wallet-fees-security-design.md`:

```markdown

## 13. Reconciliation with the code (2026-10-15)

Found while writing the Stage 1 plan (`docs/superpowers/plans/2026-10-15-ledger-fees-foundation.md`, §0):

- **D1 Fee base.** Coupon discounts are AshantiHub-funded and leave `OrderItem.line_total` untouched; flash-sale prices are seller-funded and already in `line_total`. The fee base is Σ `line_total` per vendor and category. The coupon is a platform subsidy, never charged to the vendor.
- **D2 No order-escrow account.** The payment journal allocates directly into Vendor Pending and Delivery payable (equivalent, one fewer pass-through).
- **D3 Governance.** Accounting proposes and Super Admin approves (existing maker-checker); Super Admin may apply directly (logged). Accounting does not approve.
- **D5 Subscriptions.** Listing creation and the registration `plan_selection` step currently depend on a subscription. The freeze switch (`SUBSCRIPTIONS_ENABLED`) must stay on until the frontend registration change ships.
- **D6 Release.** Owner decision (2026-10-15): no timed hold-back. Release follows Support's verification call (§4).
- **D7 Scope.** Stage 1 covers product orders only; services, events and stays follow in Plan 1b.
- **D8 Store pickup.** Collected at the AshantiHub office within 24 hours, confirmed by a new Pickup Desk role (§4.3).
```

- [ ] **Step 7: Run the whole ledger label and commit**

Run: `docker compose run --rm web python manage.py test ledger`
Expected: PASS.

```bash
git add backend/ledger backend/ashantihub/settings.py docs/superpowers/specs/2026-10-15-wallet-fees-security-design.md
git commit -m "feat(ledger): app scaffold, pesewa helpers, switches; record spec deviations"
```

---

### Task 2: Ledger models and append-only triggers

**Files:**
- Create: `backend/ledger/models.py`, `backend/ledger/migrations/0001_initial.py` (generated), `backend/ledger/migrations/0002_append_only_triggers.py`, `backend/ledger/tests/test_models.py`

**Interfaces:**
- Produces: `Account(kind, owner_type, owner_id, net_credit)` with `.balance` (normal-side balance) and class constants `Account.CUSTOMER_WALLET, VENDOR_PENDING, VENDOR_AVAILABLE, DELIVERY_PAYABLE, RIDER_BALANCE, RIDER_RESERVE, PLATFORM_FEE_INCOME, PLATFORM_DELIVERY_INCOME, PLATFORM_COMMISSION_INCOME, PLATFORM_PROMO_SUBSIDY, PROVIDER_CLEARING, PROVIDER_FEES, WITHDRAWAL_IN_TRANSIT`, `Account.DEBIT_NORMAL`, `Account.MAY_GO_NEGATIVE`; `Journal(key, kind, reference_type, reference_id, memo, created_at)`; `JournalLine(journal, account, side, amount)` with `JournalLine.DEBIT = "debit"`, `JournalLine.CREDIT = "credit"`.

- [ ] **Step 1: Write the failing test** — `backend/ledger/tests/test_models.py`

```python
from django.db import DatabaseError, connection, transaction
from django.test import TestCase

from ledger.models import Account, Journal, JournalLine


class AccountBalanceTests(TestCase):
    def test_a_credit_normal_account_reads_net_credit(self):
        account = Account.objects.create(kind=Account.VENDOR_PENDING, owner_type="accounts.businessowner", owner_id="1", net_credit=500)
        self.assertEqual(account.balance, 500)

    def test_a_debit_normal_account_reads_the_negated_net_credit(self):
        account = Account.objects.create(kind=Account.PROVIDER_CLEARING, net_credit=-500)
        self.assertEqual(account.balance, 500)

    def test_one_account_per_kind_and_owner(self):
        Account.objects.create(kind=Account.VENDOR_PENDING, owner_type="accounts.businessowner", owner_id="1")
        with self.assertRaises(Exception), transaction.atomic():
            Account.objects.create(kind=Account.VENDOR_PENDING, owner_type="accounts.businessowner", owner_id="1")


class AppendOnlyTests(TestCase):
    def setUp(self):
        self.journal = Journal.objects.create(key="k1", kind="test")
        self.account = Account.objects.create(kind=Account.PROVIDER_CLEARING)
        self.line = JournalLine.objects.create(journal=self.journal, account=self.account, side=JournalLine.DEBIT, amount=100)

    def test_orm_save_of_an_existing_journal_is_refused(self):
        self.journal.memo = "changed"
        with self.assertRaises(RuntimeError):
            self.journal.save()

    def test_orm_delete_is_refused(self):
        with self.assertRaises(RuntimeError):
            self.line.delete()

    def test_raw_update_is_refused_by_the_database(self):
        with self.assertRaises(DatabaseError), transaction.atomic():
            with connection.cursor() as cursor:
                cursor.execute("UPDATE ledger_journal SET memo = 'x'")

    def test_raw_delete_of_a_line_is_refused_by_the_database(self):
        with self.assertRaises(DatabaseError), transaction.atomic():
            with connection.cursor() as cursor:
                cursor.execute("DELETE FROM ledger_journalline")

    def test_a_line_must_have_a_positive_amount(self):
        with self.assertRaises(Exception), transaction.atomic():
            JournalLine.objects.create(journal=self.journal, account=self.account, side=JournalLine.CREDIT, amount=0)
```

- [ ] **Step 2: Run it to see it fail**

Run: `docker compose run --rm web python manage.py test ledger.tests.test_models`
Expected: ERROR `cannot import name 'Account'`.

- [ ] **Step 3: Write the models** — `backend/ledger/models.py`

```python
"""The ledger: accounts, and journals of balanced lines that are never edited.

A balance lives on `Account.net_credit` (credits minus debits) as a cache that only
`ledger.posting.post` changes, in the same transaction that writes the journal lines."""
from django.db import models


class Account(models.Model):
    CUSTOMER_WALLET = "customer_wallet"
    VENDOR_PENDING = "vendor_pending"
    VENDOR_AVAILABLE = "vendor_available"
    DELIVERY_PAYABLE = "delivery_payable"
    RIDER_BALANCE = "rider_balance"
    RIDER_RESERVE = "rider_reserve"
    PLATFORM_FEE_INCOME = "platform_fee_income"
    PLATFORM_DELIVERY_INCOME = "platform_delivery_income"
    PLATFORM_COMMISSION_INCOME = "platform_commission_income"
    PLATFORM_PROMO_SUBSIDY = "platform_promo_subsidy"
    PROVIDER_CLEARING = "provider_clearing"
    PROVIDER_FEES = "provider_fees"
    WITHDRAWAL_IN_TRANSIT = "withdrawal_in_transit"
    KIND_CHOICES = [
        (CUSTOMER_WALLET, "Customer wallet"),
        (VENDOR_PENDING, "Vendor pending"),
        (VENDOR_AVAILABLE, "Vendor available"),
        (DELIVERY_PAYABLE, "Delivery payable"),
        (RIDER_BALANCE, "Rider balance"),
        (RIDER_RESERVE, "Rider commission reserve"),
        (PLATFORM_FEE_INCOME, "Platform fee income"),
        (PLATFORM_DELIVERY_INCOME, "Platform delivery income"),
        (PLATFORM_COMMISSION_INCOME, "Platform commission income"),
        (PLATFORM_PROMO_SUBSIDY, "Platform promotion subsidy"),
        (PROVIDER_CLEARING, "Provider clearing"),
        (PROVIDER_FEES, "Provider fees"),
        (WITHDRAWAL_IN_TRANSIT, "Withdrawal in transit"),
    ]
    # Asset and expense accounts grow with debits; everything else grows with credits.
    DEBIT_NORMAL = frozenset({PROVIDER_CLEARING, PLATFORM_PROMO_SUBSIDY, PROVIDER_FEES})
    # A late refund may drive a vendor's available balance below zero (recovered from later sales).
    MAY_GO_NEGATIVE = frozenset({VENDOR_AVAILABLE})

    kind = models.CharField(max_length=32, choices=KIND_CHOICES)
    owner_type = models.CharField(max_length=40, blank=True, default="")
    owner_id = models.CharField(max_length=40, blank=True, default="")
    net_credit = models.BigIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["kind", "owner_type", "owner_id"], name="ledger_one_account_per_kind_and_owner")]

    @property
    def balance(self):
        """The balance on the account's normal side, in pesewas."""
        return -self.net_credit if self.kind in self.DEBIT_NORMAL else self.net_credit

    def __str__(self):
        owner = f" {self.owner_type}:{self.owner_id}" if self.owner_id else ""
        return f"{self.kind}{owner}"


class _AppendOnly(models.Model):
    class Meta:
        abstract = True

    def save(self, *args, **kwargs):
        if self.pk is not None and not self._state.adding:
            raise RuntimeError(f"{type(self).__name__} rows are append-only")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise RuntimeError(f"{type(self).__name__} rows are append-only")


class Journal(_AppendOnly):
    key = models.CharField(max_length=120, unique=True)
    kind = models.CharField(max_length=40)
    reference_type = models.CharField(max_length=50, blank=True, default="")
    reference_id = models.CharField(max_length=64, blank=True, default="")
    memo = models.CharField(max_length=300, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["id"]
        indexes = [models.Index(fields=["reference_type", "reference_id"])]

    def __str__(self):
        return f"{self.kind} {self.key}"


class JournalLine(_AppendOnly):
    DEBIT = "debit"
    CREDIT = "credit"
    SIDE_CHOICES = [(DEBIT, "Debit"), (CREDIT, "Credit")]

    journal = models.ForeignKey(Journal, on_delete=models.PROTECT, related_name="lines")
    account = models.ForeignKey(Account, on_delete=models.PROTECT, related_name="lines")
    side = models.CharField(max_length=6, choices=SIDE_CHOICES)
    amount = models.BigIntegerField()

    class Meta:
        ordering = ["id"]
        constraints = [models.CheckConstraint(condition=models.Q(amount__gt=0), name="ledger_line_amount_positive")]
```

- [ ] **Step 4: Generate the schema migration**

Run: `docker compose run --rm web python manage.py makemigrations ledger`
Expected: creates `ledger/migrations/0001_initial.py`.

- [ ] **Step 5: Add the trigger migration** — `backend/ledger/migrations/0002_append_only_triggers.py`

```python
from django.db import migrations

FORWARD = """
CREATE FUNCTION ledger_refuse_change() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'ledger journal rows are append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER ledger_journal_append_only BEFORE UPDATE OR DELETE ON ledger_journal
    FOR EACH ROW EXECUTE FUNCTION ledger_refuse_change();
CREATE TRIGGER ledger_journalline_append_only BEFORE UPDATE OR DELETE ON ledger_journalline
    FOR EACH ROW EXECUTE FUNCTION ledger_refuse_change();
"""
REVERSE = """
DROP TRIGGER ledger_journalline_append_only ON ledger_journalline;
DROP TRIGGER ledger_journal_append_only ON ledger_journal;
DROP FUNCTION ledger_refuse_change();
"""


class Migration(migrations.Migration):
    dependencies = [("ledger", "0001_initial")]
    operations = [migrations.RunSQL(FORWARD, REVERSE)]
```

- [ ] **Step 6: Run the tests**

Run: `docker compose run --rm web python manage.py test ledger.tests.test_models`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/ledger
git commit -m "feat(ledger): accounts, append-only journals and lines with database triggers"
```

---

### Task 3: Posting service

**Files:**
- Create: `backend/ledger/posting.py`, `backend/ledger/tests/test_posting.py`

**Interfaces:**
- Consumes: `Account`, `Journal`, `JournalLine` from Task 2.
- Produces: `posting.PostingError`; `posting.account_for(kind, owner=None) -> Account` (get-or-create; `owner` is any model instance); `posting.debit(account, amount) -> Line`, `posting.credit(account, amount) -> Line`; `posting.post(*, key, kind, lines, reference_type="", reference_id="", memo="") -> Journal` (atomic, idempotent on `key`, refuses unbalanced or overdrawing postings).

- [ ] **Step 1: Write the failing tests** — `backend/ledger/tests/test_posting.py`

```python
from django.test import TestCase

from accounts.models import BusinessOwner
from ledger import posting
from ledger.models import Account, Journal, JournalLine


class PostingTests(TestCase):
    def setUp(self):
        self.owner = BusinessOwner.objects.create(full_name="Kofi", login_phone="+233207000001", password_hash="x")
        self.clearing = posting.account_for(Account.PROVIDER_CLEARING)
        self.pending = posting.account_for(Account.VENDOR_PENDING, self.owner)

    def test_a_balanced_posting_moves_both_balances(self):
        posting.post(key="a", kind="t", lines=[posting.debit(self.clearing, 1000), posting.credit(self.pending, 1000)])
        self.clearing.refresh_from_db()
        self.pending.refresh_from_db()
        self.assertEqual(self.clearing.balance, 1000)
        self.assertEqual(self.pending.balance, 1000)
        self.assertEqual(JournalLine.objects.count(), 2)

    def test_an_unbalanced_posting_is_refused_and_writes_nothing(self):
        with self.assertRaises(posting.PostingError):
            posting.post(key="b", kind="t", lines=[posting.debit(self.clearing, 1000), posting.credit(self.pending, 900)])
        self.assertFalse(Journal.objects.exists())
        self.clearing.refresh_from_db()
        self.assertEqual(self.clearing.balance, 0)

    def test_zero_negative_and_non_integer_amounts_are_refused(self):
        for bad in (0, -5, 1.5, True):
            with self.assertRaises(posting.PostingError, msg=repr(bad)):
                posting.post(key=f"bad{bad}", kind="t", lines=[posting.debit(self.clearing, bad), posting.credit(self.pending, bad)])

    def test_fewer_than_two_lines_is_refused(self):
        with self.assertRaises(posting.PostingError):
            posting.post(key="c", kind="t", lines=[posting.debit(self.clearing, 5)])

    def test_the_same_key_posts_once(self):
        lines = [posting.debit(self.clearing, 1000), posting.credit(self.pending, 1000)]
        first = posting.post(key="dup", kind="t", lines=lines)
        again = posting.post(key="dup", kind="t", lines=lines)
        self.assertEqual(first.pk, again.pk)
        self.pending.refresh_from_db()
        self.assertEqual(self.pending.balance, 1000)
        self.assertEqual(Journal.objects.count(), 1)

    def test_a_pending_balance_cannot_be_overdrawn(self):
        posting.post(key="in", kind="t", lines=[posting.debit(self.clearing, 500), posting.credit(self.pending, 500)])
        income = posting.account_for(Account.PLATFORM_FEE_INCOME)
        with self.assertRaises(posting.PostingError):
            posting.post(key="out", kind="t", lines=[posting.debit(self.pending, 600), posting.credit(income, 600)])
        self.pending.refresh_from_db()
        self.assertEqual(self.pending.balance, 500)

    def test_vendor_available_may_go_negative(self):
        available = posting.account_for(Account.VENDOR_AVAILABLE, self.owner)
        income = posting.account_for(Account.PLATFORM_FEE_INCOME)
        posting.post(key="neg", kind="t", lines=[posting.debit(available, 200), posting.credit(income, 200)])
        available.refresh_from_db()
        self.assertEqual(available.balance, -200)

    def test_account_for_is_get_or_create(self):
        self.assertEqual(posting.account_for(Account.VENDOR_PENDING, self.owner).pk, self.pending.pk)
        self.assertEqual(Account.objects.filter(kind=Account.VENDOR_PENDING).count(), 1)
```

- [ ] **Step 2: Run it to see it fail**

Run: `docker compose run --rm web python manage.py test ledger.tests.test_posting`
Expected: ERROR `cannot import name 'posting'`.

- [ ] **Step 3: Implement** — `backend/ledger/posting.py`

```python
"""The only door through which a ledger balance changes. `post` writes one balanced journal
atomically, idempotently on its key, locking the accounts it touches in primary-key order so
concurrent postings serialise instead of deadlocking."""
from dataclasses import dataclass

from django.db import transaction

from .models import Account, Journal, JournalLine


class PostingError(Exception):
    pass


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


def post(*, key, kind, lines, reference_type="", reference_id="", memo=""):
    lines = list(lines)
    _validate(key, kind, lines)
    with transaction.atomic():
        ids = sorted({line.account.pk for line in lines})
        locked = {a.pk: a for a in Account.objects.select_for_update().filter(pk__in=ids).order_by("pk")}
        existing = Journal.objects.filter(key=key).first()
        if existing is not None:
            return existing
        journal = Journal.objects.create(key=key, kind=kind, reference_type=reference_type, reference_id=str(reference_id), memo=memo[:300])
        for line in lines:
            JournalLine.objects.create(journal=journal, account_id=line.account.pk, side=line.side, amount=line.amount)
            delta = line.amount if line.side == JournalLine.CREDIT else -line.amount
            locked[line.account.pk].net_credit += delta
        for account in locked.values():
            if account.balance < 0 and account.kind not in Account.MAY_GO_NEGATIVE:
                raise PostingError(f"{account} would go below zero")
            account.save(update_fields=["net_credit"])
        return journal
```

- [ ] **Step 4: Run the tests**

Run: `docker compose run --rm web python manage.py test ledger.tests.test_posting`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/ledger
git commit -m "feat(ledger): atomic, idempotent, balanced posting service"
```

---

### Task 4: Fee rules, calculator and seeded defaults

**Files:**
- Modify: `backend/ledger/models.py` (append `FeeRuleSet`, `FeeBand`, `OrderFeeSnapshot`)
- Create: `backend/ledger/fees.py`, `backend/ledger/migrations/0003_fee_models.py` (generated), `backend/ledger/migrations/0004_seed_default_fee_rules.py`, `backend/ledger/tests/test_fees.py`

**Interfaces:**
- Consumes: `Category.PRODUCT/SERVICE/EVENT` string values `"product"|"service"|"event"`.
- Produces: `FeeRuleSet(category, effective_from, created_by, approval_id)` with `.bands`; `FeeBand(lower_pesewas, upper_pesewas, percent_bp, flat_pesewas)`; `OrderFeeSnapshot(order, business_owner, category, rule_set, base_pesewas, computed_pesewas, charged_pesewas, cap_pesewas, released_at, reversed_at)`; `fees.FeeError`; `fees.validate_bands(bands: list[dict]) -> None` (dict keys `lower`, `upper`, `percent_bp`, `flat`); `fees.rule_set_in_force(category, at=None) -> FeeRuleSet | None`; `fees.band_fee(bands, base) -> int`; `fees.apply_cap(computed, cap, already_charged) -> int`; `fees.quote(category, base, *, cap, already_charged, at=None) -> FeeQuote(rule_set_id, base, computed, charged)`; `fees.charged_to_date(owner) -> int`.

- [ ] **Step 1: Write the failing tests** — `backend/ledger/tests/test_fees.py`

```python
from django.test import SimpleTestCase, TestCase

from accounts.models import BusinessOwner
from ledger import fees
from ledger.models import FeeBand, FeeRuleSet

PRODUCT = [
    {"lower": 0, "upper": 9999, "percent_bp": 100, "flat": None},
    {"lower": 10000, "upper": 49999, "percent_bp": None, "flat": 500},
    {"lower": 50000, "upper": 4999999, "percent_bp": 100, "flat": None},
    {"lower": 5000000, "upper": None, "percent_bp": None, "flat": 50000},
]


def as_bands(spec):
    return [FeeBand(lower_pesewas=b["lower"], upper_pesewas=b["upper"], percent_bp=b["percent_bp"], flat_pesewas=b["flat"]) for b in spec]


class BandFeeTests(SimpleTestCase):
    def fee(self, pesewas):
        return fees.band_fee(as_bands(PRODUCT), pesewas)

    def test_the_brief_tier_boundaries(self):
        self.assertEqual(self.fee(9999), 100)         # GHS 99.99  -> 1% = GHS 1.00
        self.assertEqual(self.fee(10000), 500)        # GHS 100.00 -> GHS 5.00 flat
        self.assertEqual(self.fee(49999), 500)        # GHS 499.99 -> GHS 5.00 flat
        self.assertEqual(self.fee(50000), 500)        # GHS 500.00 -> 1% = GHS 5.00
        self.assertEqual(self.fee(4999999), 50000)    # GHS 49,999.99 -> 1% = GHS 500.00
        self.assertEqual(self.fee(5000000), 50000)    # GHS 50,000.00 -> GHS 500 flat
        self.assertEqual(self.fee(12345678), 50000)   # far above: still GHS 500 flat

    def test_one_percent_rounds_half_up_to_the_pesewa(self):
        self.assertEqual(self.fee(150), 2)   # 1.5 pesewas -> 2
        self.assertEqual(self.fee(149), 1)   # 1.49 pesewas -> 1
        self.assertEqual(self.fee(0), 0)
        self.assertEqual(self.fee(1234), 12)

    def test_an_amount_with_no_band_raises(self):
        with self.assertRaises(fees.FeeError):
            fees.band_fee(as_bands(PRODUCT[1:]), 5)


class CapTests(SimpleTestCase):
    def test_no_cap_charges_the_full_fee(self):
        self.assertEqual(fees.apply_cap(500, None, 10**9), 500)

    def test_the_fee_that_crosses_the_cap_is_trimmed_to_the_remainder(self):
        self.assertEqual(fees.apply_cap(500, 1000, 700), 300)

    def test_nothing_is_charged_once_the_cap_is_reached_or_passed(self):
        self.assertEqual(fees.apply_cap(500, 1000, 1000), 0)
        self.assertEqual(fees.apply_cap(500, 1000, 1500), 0)


class ValidateBandsTests(SimpleTestCase):
    def test_the_brief_tiers_are_valid(self):
        fees.validate_bands(PRODUCT)

    def bad(self, spec):
        with self.assertRaises(fees.FeeError):
            fees.validate_bands(spec)

    def test_must_start_at_zero(self):
        self.bad([{"lower": 1, "upper": None, "percent_bp": 100, "flat": None}])

    def test_must_be_contiguous(self):
        self.bad([{"lower": 0, "upper": 99, "percent_bp": 100, "flat": None}, {"lower": 101, "upper": None, "percent_bp": 100, "flat": None}])

    def test_last_band_must_be_open_ended(self):
        self.bad([{"lower": 0, "upper": 99, "percent_bp": 100, "flat": None}])

    def test_only_the_last_band_may_be_open_ended(self):
        self.bad([{"lower": 0, "upper": None, "percent_bp": 100, "flat": None}, {"lower": 100, "upper": None, "percent_bp": 100, "flat": None}])

    def test_exactly_one_of_percent_or_flat(self):
        self.bad([{"lower": 0, "upper": None, "percent_bp": 100, "flat": 5}])
        self.bad([{"lower": 0, "upper": None, "percent_bp": None, "flat": None}])

    def test_percent_is_whole_basis_points_up_to_100_percent(self):
        self.bad([{"lower": 0, "upper": None, "percent_bp": 10001, "flat": None}])
        self.bad([{"lower": 0, "upper": None, "percent_bp": -1, "flat": None}])

    def test_empty_is_refused(self):
        self.bad([])


class SeededDefaultsTests(TestCase):
    def test_each_category_has_the_brief_tiers_in_force(self):
        for category in ("product", "service", "event"):
            rule_set = fees.rule_set_in_force(category)
            self.assertIsNotNone(rule_set, category)
            self.assertEqual(fees.band_fee(list(rule_set.bands.all()), 10000), 500, category)
            self.assertEqual(fees.band_fee(list(rule_set.bands.all()), 5000000), 50000, category)

    def test_the_latest_rule_set_in_force_wins_and_a_future_one_waits(self):
        from datetime import timedelta

        from django.utils import timezone

        now = timezone.now()
        newer = FeeRuleSet.objects.create(category="product", effective_from=now - timedelta(hours=1))
        FeeBand.objects.create(rule_set=newer, lower_pesewas=0, upper_pesewas=None, percent_bp=200)
        later = FeeRuleSet.objects.create(category="product", effective_from=now + timedelta(days=1))
        FeeBand.objects.create(rule_set=later, lower_pesewas=0, upper_pesewas=None, percent_bp=300)
        self.assertEqual(fees.rule_set_in_force("product", now).pk, newer.pk)
        self.assertEqual(fees.rule_set_in_force("product", now + timedelta(days=2)).pk, later.pk)

    def test_quote_applies_band_then_cap(self):
        quote = fees.quote("product", 10000, cap=800, already_charged=500)
        self.assertEqual((quote.base, quote.computed, quote.charged), (10000, 500, 300))

    def test_charged_to_date_ignores_reversed_snapshots(self):
        from django.utils import timezone

        from orders.models import Order
        from accounts.models import Customer

        owner = BusinessOwner.objects.create(full_name="K", login_phone="+233207000002", password_hash="x")
        customer = Customer.objects.create(full_name="A", phone="+233200000002", password_hash="x")
        order = Order.objects.create(customer=customer, total_amount="10.00")
        rule_set = fees.rule_set_in_force("product")
        from ledger.models import OrderFeeSnapshot

        OrderFeeSnapshot.objects.create(order=order, business_owner=owner, category="product", rule_set=rule_set, base_pesewas=1000, computed_pesewas=10, charged_pesewas=10)
        OrderFeeSnapshot.objects.create(order=order, business_owner=owner, category="service", rule_set=rule_set, base_pesewas=1000, computed_pesewas=10, charged_pesewas=10, reversed_at=timezone.now())
        self.assertEqual(fees.charged_to_date(owner), 10)
```

- [ ] **Step 2: Run it to see it fail**

Run: `docker compose run --rm web python manage.py test ledger.tests.test_fees`
Expected: ERROR `cannot import name 'fees'`.

- [ ] **Step 3: Add the models** — append to `backend/ledger/models.py`

```python


class FeeRuleSet(models.Model):
    """One version of a category's platform-fee tiers. Rows are never edited: the rule set in force
    is the latest whose `effective_from` has passed (the approvals engine creates new ones)."""

    PRODUCT, SERVICE, EVENT = "product", "service", "event"
    CATEGORY_CHOICES = [(PRODUCT, "Products"), (SERVICE, "Services"), (EVENT, "Events")]

    category = models.CharField(max_length=10, choices=CATEGORY_CHOICES)
    effective_from = models.DateTimeField()
    created_by = models.ForeignKey("accounts.StaffUser", null=True, blank=True, on_delete=models.PROTECT, related_name="+")
    approval_id = models.PositiveBigIntegerField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-effective_from", "-id"]
        indexes = [models.Index(fields=["category", "-effective_from"])]

    def __str__(self):
        return f"{self.category} fees from {self.effective_from:%Y-%m-%d %H:%M}"


class FeeBand(models.Model):
    """One tier of a rule set: amounts from `lower_pesewas` to `upper_pesewas` inclusive (None = no upper
    limit) cost `percent_bp` basis points (100 = 1%) or a flat `flat_pesewas`."""

    rule_set = models.ForeignKey(FeeRuleSet, on_delete=models.CASCADE, related_name="bands")
    lower_pesewas = models.BigIntegerField()
    upper_pesewas = models.BigIntegerField(null=True, blank=True)
    percent_bp = models.PositiveIntegerField(null=True, blank=True)
    flat_pesewas = models.BigIntegerField(null=True, blank=True)

    class Meta:
        ordering = ["lower_pesewas"]
        constraints = [
            models.CheckConstraint(
                condition=(
                    models.Q(percent_bp__isnull=False, flat_pesewas__isnull=True)
                    | models.Q(percent_bp__isnull=True, flat_pesewas__isnull=False)
                ),
                name="ledger_band_percent_xor_flat",
            ),
        ]


class OrderFeeSnapshot(models.Model):
    """The fee fixed for one vendor and fee category of one order at payment time. Release reads this,
    so later rule or cap edits never change an order already paid. `reversed_at` frees the cap again
    (refunds, Stage 3)."""

    order = models.ForeignKey("orders.Order", on_delete=models.PROTECT, related_name="fee_snapshots")
    business_owner = models.ForeignKey("accounts.BusinessOwner", on_delete=models.PROTECT, related_name="fee_snapshots")
    category = models.CharField(max_length=10, choices=FeeRuleSet.CATEGORY_CHOICES)
    rule_set = models.ForeignKey(FeeRuleSet, on_delete=models.PROTECT, related_name="+")
    base_pesewas = models.BigIntegerField()
    computed_pesewas = models.BigIntegerField()
    charged_pesewas = models.BigIntegerField()
    cap_pesewas = models.BigIntegerField(null=True, blank=True)
    released_at = models.DateTimeField(null=True, blank=True)
    reversed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["order", "business_owner", "category"], name="ledger_one_snapshot_per_order_vendor_category")]
        indexes = [models.Index(fields=["business_owner", "reversed_at"])]
```

- [ ] **Step 4: Implement the calculator** — `backend/ledger/fees.py`

```python
"""Platform-fee calculation. Pure functions over pesewa integers, plus the lookups that find the
rule set in force and a vendor's fees charged so far (for the lifetime cap)."""
from dataclasses import dataclass

from django.db.models import Sum
from django.utils import timezone

from .models import FeeRuleSet, OrderFeeSnapshot


class FeeError(Exception):
    pass


@dataclass(frozen=True)
class FeeQuote:
    rule_set_id: int
    base: int
    computed: int
    charged: int


def rule_set_in_force(category, at=None):
    at = at or timezone.now()
    return FeeRuleSet.objects.filter(category=category, effective_from__lte=at).order_by("-effective_from", "-id").first()


def band_fee(bands, base):
    for band in bands:
        if band.lower_pesewas <= base and (band.upper_pesewas is None or base <= band.upper_pesewas):
            if band.percent_bp is not None:
                return (base * band.percent_bp + 5000) // 10000  # half up
            return band.flat_pesewas
    raise FeeError(f"No fee band covers {base} pesewas")


def apply_cap(computed, cap, already_charged):
    if cap is None:
        return computed
    return max(0, min(computed, cap - already_charged))


def quote(category, base, *, cap, already_charged, at=None):
    rule_set = rule_set_in_force(category, at)
    if rule_set is None:
        raise FeeError(f"No fee rules are in force for {category}")
    computed = band_fee(list(rule_set.bands.all()), base)
    return FeeQuote(rule_set.pk, base, computed, apply_cap(computed, cap, already_charged))


def charged_to_date(owner):
    total = OrderFeeSnapshot.objects.filter(business_owner=owner, reversed_at__isnull=True).aggregate(total=Sum("charged_pesewas"))["total"]
    return total or 0


def validate_bands(bands):
    """Raises FeeError unless `bands` (dicts with lower/upper/percent_bp/flat) form a complete, gap-free
    ladder from 0 to no upper limit with exactly one of percent or flat on each band."""
    if not bands:
        raise FeeError("Add at least one fee band")
    previous_upper = -1
    for index, band in enumerate(bands):
        lower, upper = band.get("lower"), band.get("upper")
        percent, flat = band.get("percent_bp"), band.get("flat")
        if not isinstance(lower, int) or lower != previous_upper + 1:
            raise FeeError("Fee bands must start at 0 and follow one another with no gap or overlap")
        if (percent is None) == (flat is None):
            raise FeeError("Each fee band takes either a percentage or a flat amount, not both")
        if percent is not None and (not isinstance(percent, int) or not 0 <= percent <= 10000):
            raise FeeError("A percentage is whole basis points from 0 to 10000")
        if flat is not None and (not isinstance(flat, int) or flat < 0):
            raise FeeError("A flat fee is a whole number of pesewas, zero or more")
        last = index == len(bands) - 1
        if last != (upper is None):
            raise FeeError("Only the last fee band has no upper limit, and the last band must have none")
        if upper is not None:
            if not isinstance(upper, int) or upper < lower:
                raise FeeError("A band's upper limit cannot be below its lower limit")
            previous_upper = upper
```

- [ ] **Step 5: Generate the migration, then the seed migration**

Run: `docker compose run --rm web python manage.py makemigrations ledger -n fee_models`
Expected: creates `0003_fee_models.py`.

`backend/ledger/migrations/0004_seed_default_fee_rules.py`:

```python
from datetime import datetime, timezone

from django.db import migrations

# The brief's product tiers (pesewas). Services and events start as copies for the owner to change.
BANDS = [
    (0, 9999, 100, None),
    (10000, 49999, None, 500),
    (50000, 4999999, 100, None),
    (5000000, None, None, 50000),
]


def seed(apps, schema_editor):
    RuleSet = apps.get_model("ledger", "FeeRuleSet")
    Band = apps.get_model("ledger", "FeeBand")
    start = datetime(2020, 1, 1, tzinfo=timezone.utc)
    for category in ("product", "service", "event"):
        rule_set = RuleSet.objects.create(category=category, effective_from=start)
        for lower, upper, percent, flat in BANDS:
            Band.objects.create(rule_set=rule_set, lower_pesewas=lower, upper_pesewas=upper, percent_bp=percent, flat_pesewas=flat)


def unseed(apps, schema_editor):
    apps.get_model("ledger", "FeeRuleSet").objects.filter(approval_id__isnull=True, created_by__isnull=True).delete()


class Migration(migrations.Migration):
    dependencies = [("ledger", "0003_fee_models")]
    operations = [migrations.RunPython(seed, unseed)]
```

If `makemigrations` names the file differently, set the dependency to the actual generated name.

- [ ] **Step 6: Run the tests**

Run: `docker compose run --rm web python manage.py test ledger.tests.test_fees`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/ledger
git commit -m "feat(ledger): versioned fee rules, calculator with lifetime cap, seeded brief tiers"
```

---

### Task 5: Governed money settings store

**Files:**
- Modify: `backend/ledger/models.py` (append `MoneySetting`)
- Create: `backend/ledger/settings_store.py`, `backend/ledger/migrations/0005_moneysetting.py` (generated), `backend/ledger/tests/test_settings_store.py`

**Interfaces:**
- Produces: `MoneySetting(key, value, effective_from, created_by, approval_id)`; `settings_store.DEFINITIONS` (dict key → `Definition(default, nullable, minimum, maximum, label)`); `settings_store.current(key, at=None) -> int | None`; `settings_store.clean(key, raw) -> int | None` (raises `settings_store.SettingError`). Keys: `fee_cap_pesewas`, `verification_overdue_hours`, `pickup_window_hours`, `rider_commission_bp`.

- [ ] **Step 1: Write the failing tests** — `backend/ledger/tests/test_settings_store.py`

```python
from datetime import timedelta

from django.test import SimpleTestCase, TestCase
from django.utils import timezone

from ledger import settings_store as store
from ledger.models import MoneySetting


class DefaultsTests(TestCase):
    def test_defaults_when_nothing_is_set(self):
        self.assertIsNone(store.current("fee_cap_pesewas"))
        self.assertEqual(store.current("pickup_window_hours"), 24)
        self.assertEqual(store.current("verification_overdue_hours"), 72)
        self.assertEqual(store.current("rider_commission_bp"), 1000)

    def test_the_latest_row_in_force_wins_and_a_future_row_waits(self):
        now = timezone.now()
        MoneySetting.objects.create(key="pickup_window_hours", value=48, effective_from=now - timedelta(hours=2))
        MoneySetting.objects.create(key="pickup_window_hours", value=12, effective_from=now - timedelta(hours=1))
        MoneySetting.objects.create(key="pickup_window_hours", value=1, effective_from=now + timedelta(days=1))
        self.assertEqual(store.current("pickup_window_hours", now), 12)

    def test_a_blank_cap_row_means_no_cap(self):
        now = timezone.now()
        MoneySetting.objects.create(key="fee_cap_pesewas", value=100000, effective_from=now - timedelta(hours=2))
        MoneySetting.objects.create(key="fee_cap_pesewas", value=None, effective_from=now - timedelta(hours=1))
        self.assertIsNone(store.current("fee_cap_pesewas", now))

    def test_an_unknown_key_raises(self):
        with self.assertRaises(store.SettingError):
            store.current("nope")


class CleanTests(SimpleTestCase):
    def test_accepts_whole_numbers_in_range(self):
        self.assertEqual(store.clean("pickup_window_hours", "36"), 36)
        self.assertEqual(store.clean("pickup_window_hours", 1), 1)

    def test_blank_is_allowed_only_for_nullable_keys(self):
        self.assertIsNone(store.clean("fee_cap_pesewas", ""))
        self.assertIsNone(store.clean("fee_cap_pesewas", None))
        with self.assertRaises(store.SettingError):
            store.clean("pickup_window_hours", None)

    def test_rejects_out_of_range_and_non_integers(self):
        for key, raw in [("pickup_window_hours", -1), ("pickup_window_hours", 721), ("rider_commission_bp", 10001),
                         ("fee_cap_pesewas", 0), ("pickup_window_hours", "abc"), ("pickup_window_hours", 1.5), ("pickup_window_hours", True)]:
            with self.assertRaises(store.SettingError, msg=f"{key}={raw!r}"):
                store.clean(key, raw)
```

- [ ] **Step 2: Run it to see it fail**

Run: `docker compose run --rm web python manage.py test ledger.tests.test_settings_store`
Expected: ERROR `cannot import name 'settings_store'`.

- [ ] **Step 3: Add the model** — append to `backend/ledger/models.py`

```python


class MoneySetting(models.Model):
    """One approved value of a money setting from `effective_from` on. Never edited: the value in force
    is the latest row whose time has come. `value=None` is a deliberate blank (for the fee cap, no cap)."""

    key = models.CharField(max_length=50)
    value = models.BigIntegerField(null=True, blank=True)
    effective_from = models.DateTimeField()
    created_by = models.ForeignKey("accounts.StaffUser", null=True, blank=True, on_delete=models.PROTECT, related_name="+")
    approval_id = models.PositiveBigIntegerField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-effective_from", "-id"]
        indexes = [models.Index(fields=["key", "-effective_from"])]

    def __str__(self):
        return f"{self.key}={self.value}"
```

- [ ] **Step 4: Implement the store** — `backend/ledger/settings_store.py`

```python
"""Money settings that finance can change without a developer. Reading goes through `current`;
writing only ever happens in the approval kind's `apply` (ledger/approval_kinds.py)."""
from dataclasses import dataclass
from typing import Optional

from django.utils import timezone

from .models import MoneySetting


class SettingError(Exception):
    pass


@dataclass(frozen=True)
class Definition:
    label: str
    default: Optional[int]
    nullable: bool
    minimum: int
    maximum: int


DEFINITIONS = {
    "fee_cap_pesewas": Definition("Lifetime platform-fee cap per vendor (pesewas; blank = no cap)", None, True, 1, 10**12),
    "verification_overdue_hours": Definition("Hours after purchase by which an order must be verified or disputed", 72, False, 1, 720),
    "pickup_window_hours": Definition("Hours after purchase within which a store-pickup order is collected", 24, False, 1, 168),
    "rider_commission_bp": Definition("Third-party rider commission (basis points; 1000 = 10%)", 1000, False, 0, 10000),
}


def _definition(key):
    try:
        return DEFINITIONS[key]
    except KeyError:
        raise SettingError(f"Unknown money setting {key!r}") from None


def current(key, at=None):
    definition = _definition(key)
    at = at or timezone.now()
    row = MoneySetting.objects.filter(key=key, effective_from__lte=at).order_by("-effective_from", "-id").first()
    return definition.default if row is None else row.value


def clean(key, raw):
    definition = _definition(key)
    if raw is None or (isinstance(raw, str) and not raw.strip()):
        if definition.nullable:
            return None
        raise SettingError(f"{definition.label} cannot be blank")
    if isinstance(raw, bool) or isinstance(raw, float):
        raise SettingError("Enter a whole number")
    try:
        value = int(str(raw).strip())
    except ValueError:
        raise SettingError("Enter a whole number") from None
    if not definition.minimum <= value <= definition.maximum:
        raise SettingError(f"{definition.label} must be between {definition.minimum} and {definition.maximum}")
    return value
```

- [ ] **Step 5: Generate the migration**

Run: `docker compose run --rm web python manage.py makemigrations ledger -n moneysetting`
Expected: creates `0005_moneysetting.py`.

- [ ] **Step 6: Run the tests**

Run: `docker compose run --rm web python manage.py test ledger.tests.test_settings_store`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/ledger
git commit -m "feat(ledger): versioned money settings with defaults and validation"
```

---

### Task 6: Governed changes — permissions, approval kinds, API

**Files:**
- Create: `backend/accounts/migrations/0049_seed_ledger_permissions.py`, `backend/ledger/views.py`, `backend/ledger/urls.py`, `backend/ledger/tests/test_governance.py`
- Modify: `backend/ledger/approval_kinds.py` (replace the Task 1 stub), `backend/ashantihub/urls.py`

**Interfaces:**
- Consumes: `fees.validate_bands`, `fees.rule_set_in_force`, `settings_store.clean/current/DEFINITIONS`, `approvals.services.submit`, `approvals.registry.ApprovalKind`.
- Produces: permissions `fees.view`, `fees.manage`; approval kinds `ledger.fee_rules` (payload `{category, bands, effective_from}`) and `ledger.setting` (payload `{key, value, effective_from}`); endpoints `GET/POST /api/ledger/fees/`, `GET/POST /api/ledger/settings/`.

- [ ] **Step 1: Confirm the latest accounts migration** (the dependency below assumes `0048_merge_20261013_0901` is the leaf).

Run: `ls backend/accounts/migrations | sort | tail -3`
Expected: `0048_merge_20261013_0901.py` is last. If another is, use that name in the dependency.

- [ ] **Step 2: Write the permissions seed** — `backend/accounts/migrations/0049_seed_ledger_permissions.py`

```python
from django.db import migrations

# Platform-fee and money-setting governance (ledger plan, Task 6). Super Admin holds every permission.
PERMISSIONS = [
    ("fees.view", "See the platform-fee rules, money settings and what is waiting for approval"),
    ("fees.manage", "Propose platform-fee rules and money settings for approval"),
]
GRANTS = {
    "accountant": ["fees.view", "fees.manage"],
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
    dependencies = [("accounts", "0048_merge_20261013_0901")]
    operations = [migrations.RunPython(seed, unseed)]
```

- [ ] **Step 3: Write the failing tests** — `backend/ledger/tests/test_governance.py`

```python
from datetime import timedelta

from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.testing import make_staff, staff_token
from approvals import services as approvals
from ledger import fees, settings_store
from ledger.models import FeeRuleSet, MoneySetting

TIERS = [
    {"lower": 0, "upper": 99999, "percent_bp": 150, "flat": None},
    {"lower": 100000, "upper": None, "percent_bp": None, "flat": 2500},
]


class GovernanceBase(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.boss = make_staff("super_admin", "boss@example.com")
        self.accountant = make_staff("accountant", "kofi@example.com")
        self.support = make_staff("support", "esi@example.com")

    def as_staff(self, staff, sudo=False):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(staff, sudo=sudo)}")


class FeeRulesTests(GovernanceBase):
    def test_accounting_proposes_and_nothing_changes_until_a_super_admin_approves(self):
        self.as_staff(self.accountant)
        before = FeeRuleSet.objects.count()
        response = self.client.post("/api/ledger/fees/", {"category": "service", "bands": TIERS}, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(FeeRuleSet.objects.count(), before)
        approvals.approve(response.json()["approval_id"], self.boss)
        applied = fees.rule_set_in_force("service")
        self.assertEqual(applied.created_by_id, self.boss.pk)
        self.assertEqual(fees.band_fee(list(applied.bands.all()), 1000), 15)       # 1.5% of GHS 10.00
        self.assertEqual(fees.band_fee(list(applied.bands.all()), 100000), 2500)

    def test_a_super_admin_proposal_applies_at_once(self):
        self.as_staff(self.boss, sudo=True)
        response = self.client.post("/api/ledger/fees/", {"category": "event", "bands": TIERS}, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(fees.band_fee(list(fees.rule_set_in_force("event").bands.all()), 1000), 15)

    def test_a_malformed_ladder_is_refused_and_nothing_is_queued(self):
        self.as_staff(self.accountant)
        bad = [{"lower": 5, "upper": None, "percent_bp": 100, "flat": None}]
        response = self.client.post("/api/ledger/fees/", {"category": "product", "bands": bad}, format="json")
        self.assertEqual(response.status_code, 400, response.content)

    def test_an_unknown_category_is_refused(self):
        self.as_staff(self.accountant)
        response = self.client.post("/api/ledger/fees/", {"category": "gold", "bands": TIERS}, format="json")
        self.assertEqual(response.status_code, 400)

    def test_an_effective_time_in_the_past_never_backdates(self):
        self.as_staff(self.boss, sudo=True)
        yesterday = (timezone.now() - timedelta(days=1)).isoformat()
        self.client.post("/api/ledger/fees/", {"category": "service", "bands": TIERS, "effective_from": yesterday}, format="json")
        applied = fees.rule_set_in_force("service")
        self.assertGreaterEqual(applied.effective_from, timezone.now() - timedelta(minutes=1))

    def test_only_fees_permission_holders_can_read_or_propose(self):
        self.as_staff(self.support)
        self.assertEqual(self.client.get("/api/ledger/fees/").status_code, 403)
        self.assertEqual(self.client.post("/api/ledger/fees/", {"category": "product", "bands": TIERS}, format="json").status_code, 403)

    def test_get_lists_the_rules_in_force_and_what_is_pending(self):
        self.as_staff(self.accountant)
        self.client.post("/api/ledger/fees/", {"category": "service", "bands": TIERS}, format="json")
        body = self.client.get("/api/ledger/fees/").json()
        self.assertEqual({row["category"] for row in body["current"]}, {"product", "service", "event"})
        self.assertEqual(len(body["pending"]), 1)
        self.assertEqual(body["pending"][0]["category"], "service")

    def test_a_second_pending_proposal_for_the_same_category_is_a_conflict(self):
        self.as_staff(self.accountant)
        self.client.post("/api/ledger/fees/", {"category": "service", "bands": TIERS}, format="json")
        again = self.client.post("/api/ledger/fees/", {"category": "service", "bands": TIERS}, format="json")
        self.assertEqual(again.status_code, 409)


class SettingsTests(GovernanceBase):
    def test_accounting_proposes_a_cap_and_a_super_admin_approves(self):
        self.as_staff(self.accountant)
        response = self.client.post("/api/ledger/settings/", {"key": "fee_cap_pesewas", "value": 5000000}, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        self.assertIsNone(settings_store.current("fee_cap_pesewas"))
        approvals.approve(response.json()["approval_id"], self.boss)
        self.assertEqual(settings_store.current("fee_cap_pesewas"), 5000000)

    def test_a_blank_cap_removes_the_cap(self):
        MoneySetting.objects.create(key="fee_cap_pesewas", value=100, effective_from=timezone.now() - timedelta(days=1))
        self.as_staff(self.boss, sudo=True)
        self.client.post("/api/ledger/settings/", {"key": "fee_cap_pesewas", "value": None}, format="json")
        self.assertIsNone(settings_store.current("fee_cap_pesewas"))

    def test_an_out_of_range_or_unknown_setting_is_refused(self):
        self.as_staff(self.accountant)
        self.assertEqual(self.client.post("/api/ledger/settings/", {"key": "pickup_window_hours", "value": 9999}, format="json").status_code, 400)
        self.assertEqual(self.client.post("/api/ledger/settings/", {"key": "nope", "value": 1}, format="json").status_code, 400)

    def test_get_shows_each_setting_with_its_value_in_force(self):
        self.as_staff(self.accountant)
        body = self.client.get("/api/ledger/settings/").json()
        keys = {row["key"]: row["value"] for row in body["settings"]}
        self.assertEqual(keys["pickup_window_hours"], 24)
        self.assertEqual(keys["verification_overdue_hours"], 72)
        self.assertIn("fee_cap_pesewas", keys)
        self.assertIsNone(keys["fee_cap_pesewas"])
```

- [ ] **Step 4: Run it to see it fail**

Run: `docker compose run --rm web python manage.py test ledger.tests.test_governance`
Expected: FAIL — 404 on `/api/ledger/fees/`.

- [ ] **Step 5: Implement the approval kinds** — replace `backend/ledger/approval_kinds.py`

```python
"""ledger.fee_rules and ledger.setting: a new fee ladder or money-setting value, proposed by Accounting and
approved by a Super Admin (a Super Admin's own change applies at once). Applying never backdates: the
change takes effect at the later of the proposed time and now, so orders already paid keep their snapshot."""
from datetime import datetime

from django.utils import timezone
from django.utils.dateparse import parse_datetime

from activity.services import record
from approvals.models import ApprovalRequest
from approvals.registry import ApprovalKind
from approvals.services import ApprovalError

from . import fees, settings_store
from .models import FeeBand, FeeRuleSet, MoneySetting

FEE_RULES_KEY = "ledger.fee_rules"
SETTING_KEY = "ledger.setting"
CATEGORY_LABELS = dict(FeeRuleSet.CATEGORY_CHOICES)


def effective_time(raw):
    """The later of the proposed time (ISO string, or None for now) and now."""
    now = timezone.now()
    if not raw:
        return now
    parsed = parse_datetime(str(raw)) if not isinstance(raw, datetime) else raw
    if parsed is None:
        raise ApprovalError("Use a full date and time, like 2026-11-01T09:00:00Z, for when it starts.")
    if timezone.is_naive(parsed):
        parsed = timezone.make_aware(parsed)
    return max(parsed, now)


def bands_as_dicts(rule_set):
    return [
        {"lower": b.lower_pesewas, "upper": b.upper_pesewas, "percent_bp": b.percent_bp, "flat": b.flat_pesewas}
        for b in rule_set.bands.all()
    ] if rule_set else []


def describe_band(band):
    top = "and above" if band["upper"] is None else f"to {band['upper']}"
    price = f"{band['percent_bp'] / 100:g}%" if band["percent_bp"] is not None else f"{band['flat']} pesewas flat"
    return f"{band['lower']} {top}: {price}"


# --- fee rules -------------------------------------------------------------------------------------------

def fee_current_state(request):
    category = request.payload.get("category")
    return {"category": category, "bands": bands_as_dicts(fees.rule_set_in_force(category))}


def fee_validate(request):
    payload = request.payload
    if payload.get("category") not in CATEGORY_LABELS:
        raise ApprovalError("Pick products, services or events.")
    try:
        fees.validate_bands(payload.get("bands") or [])
    except fees.FeeError as exc:
        raise ApprovalError(str(exc)) from exc
    effective_time(payload.get("effective_from"))


def fee_apply(request):
    payload = request.payload
    decider = request.decided_by or request.maker
    rule_set = FeeRuleSet.objects.create(
        category=payload["category"], effective_from=effective_time(payload.get("effective_from")),
        created_by=decider, approval_id=request.pk,
    )
    for band in payload["bands"]:
        FeeBand.objects.create(
            rule_set=rule_set, lower_pesewas=band["lower"], upper_pesewas=band["upper"],
            percent_bp=band["percent_bp"], flat_pesewas=band["flat"],
        )
    # Last: the event refreshes every open fee screen live.
    record(
        decider, "ledger.fee_rules_applied", target=rule_set,
        summary=f"{CATEGORY_LABELS[rule_set.category]} fee rules changed, effective {rule_set.effective_from:%Y-%m-%d %H:%M}",
        after={"category": rule_set.category, "bands": payload["bands"]},
    )


def fee_diff(request):
    before = (request.before or {}).get("bands") or []
    label = CATEGORY_LABELS.get(request.payload["category"], request.payload["category"])
    return [{
        "field": f"{label} fee bands",
        "before": "; ".join(describe_band(b) for b in before) or None,
        "after": "; ".join(describe_band(b) for b in request.payload["bands"]),
    }]


def super_admin_only(request):
    return [(ApprovalRequest.SUPER_ADMIN, None)]


FEE_RULES = ApprovalKind(
    key=FEE_RULES_KEY, label="Change platform-fee rules", pool_permission="", current_state=fee_current_state,
    apply=fee_apply, response_hours=48, chain_note="Super Admin only", resolve_approver=super_admin_only,
    render_diff=fee_diff, validate=fee_validate, requires_sudo=True,
    consequences=lambda request: ["Applies only to orders paid after it starts. Orders already paid keep the fee they were given."],
)


# --- money settings --------------------------------------------------------------------------------------

def setting_current_state(request):
    key = request.payload.get("key")
    return {"key": key, "value": settings_store.current(key) if key in settings_store.DEFINITIONS else None}


def setting_validate(request):
    payload = request.payload
    try:
        settings_store.clean(payload.get("key"), payload.get("value"))
    except settings_store.SettingError as exc:
        raise ApprovalError(str(exc)) from exc
    effective_time(payload.get("effective_from"))


def setting_apply(request):
    payload = request.payload
    decider = request.decided_by or request.maker
    value = settings_store.clean(payload["key"], payload.get("value"))
    row = MoneySetting.objects.create(
        key=payload["key"], value=value, effective_from=effective_time(payload.get("effective_from")),
        created_by=decider, approval_id=request.pk,
    )
    record(
        decider, "ledger.setting_applied", target=row,
        summary=f"{settings_store.DEFINITIONS[row.key].label} set to {'blank' if value is None else value}",
        after={"key": row.key, "value": value},
    )


def setting_diff(request):
    definition = settings_store.DEFINITIONS[request.payload["key"]]
    before = (request.before or {}).get("value")
    return [{"field": definition.label, "before": None if before is None else str(before), "after": "blank" if request.payload.get("value") in (None, "") else str(request.payload["value"])}]


MONEY_SETTING = ApprovalKind(
    key=SETTING_KEY, label="Change a money setting", pool_permission="", current_state=setting_current_state,
    apply=setting_apply, response_hours=48, chain_note="Super Admin only", resolve_approver=super_admin_only,
    render_diff=setting_diff, validate=setting_validate, requires_sudo=True,
    consequences=lambda request: ["Applies only to orders paid after it starts."],
)
```

- [ ] **Step 6: Implement the views and URLs** — `backend/ledger/views.py`

```python
"""Ledger staff API: the fee rules and money settings in force, and proposals to change them
(maker-checker through the approvals engine)."""
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import HasAnyRolePermission, HasRolePermission
from approvals import services as approvals
from approvals.models import ApprovalRequest

from . import fees, settings_store
from .approval_kinds import CATEGORY_LABELS, FEE_RULES_KEY, SETTING_KEY, bands_as_dicts
from .models import FeeRuleSet, MoneySetting

VIEW, MANAGE = "fees.view", "fees.manage"


def _submit(request, kind_key, **kwargs):
    try:
        approval = approvals.submit(request.user, kind_key, request=request, **kwargs)
    except approvals.ApprovalError as exc:
        return Response({"detail": exc.message}, status=exc.status_code)
    return Response({"approval_id": approval.pk, "status": approval.status}, status=status.HTTP_201_CREATED)


class FeeRulesView(APIView):
    """GET fees/ — the rules in force per category, the proposals waiting and recent history.
    POST fees/ {category, bands, effective_from?, note?} — propose a new ladder."""

    def get_permissions(self):
        if self.request.method == "POST":
            return [HasRolePermission(MANAGE)]
        return [HasAnyRolePermission(VIEW, MANAGE)]

    def get(self, request):
        current = []
        for category, label in FeeRuleSet.CATEGORY_CHOICES:
            rule_set = fees.rule_set_in_force(category)
            current.append({
                "category": category, "label": label, "bands": bands_as_dicts(rule_set),
                "effective_from": rule_set.effective_from if rule_set else None,
            })
        pending = [
            {"id": r.pk, "category": r.payload.get("category"), "bands": r.payload.get("bands"),
             "effective_from": r.payload.get("effective_from"), "maker": r.maker.full_name, "created_at": r.created_at}
            for r in ApprovalRequest.objects.filter(kind=FEE_RULES_KEY, status=ApprovalRequest.PENDING).select_related("maker").order_by("-pk")
        ]
        history = [
            {"category": r.category, "effective_from": r.effective_from, "approved_by": r.created_by.full_name if r.created_by else None}
            for r in FeeRuleSet.objects.select_related("created_by").order_by("-effective_from", "-id")[:20]
        ]
        return Response({"current": current, "pending": pending, "history": history})

    def post(self, request):
        data = request.data if isinstance(request.data, dict) else {}
        category = data.get("category")
        if category not in CATEGORY_LABELS:
            return Response({"detail": "Pick products, services or events."}, status=400)
        if ApprovalRequest.objects.filter(kind=FEE_RULES_KEY, status=ApprovalRequest.PENDING, payload__category=category).exists():
            return Response({"detail": "A change to these fee rules is already waiting for approval."}, status=status.HTTP_409_CONFLICT)
        return _submit(
            request, FEE_RULES_KEY, title=f"Platform fees: {CATEGORY_LABELS[category]}",
            target_type="ledger.feeruleset", target_id=category, target_label=CATEGORY_LABELS[category],
            payload={"category": category, "bands": data.get("bands") or [], "effective_from": data.get("effective_from")},
            maker_note=str(data.get("note") or ""),
        )


class MoneySettingsView(APIView):
    """GET settings/ — every setting with its value in force. POST settings/ {key, value, effective_from?, note?}."""

    def get_permissions(self):
        if self.request.method == "POST":
            return [HasRolePermission(MANAGE)]
        return [HasAnyRolePermission(VIEW, MANAGE)]

    def get(self, request):
        rows = [
            {"key": key, "label": d.label, "value": settings_store.current(key), "nullable": d.nullable, "minimum": d.minimum, "maximum": d.maximum}
            for key, d in settings_store.DEFINITIONS.items()
        ]
        pending = [
            {"id": r.pk, "key": r.payload.get("key"), "value": r.payload.get("value"), "maker": r.maker.full_name, "created_at": r.created_at}
            for r in ApprovalRequest.objects.filter(kind=SETTING_KEY, status=ApprovalRequest.PENDING).select_related("maker").order_by("-pk")
        ]
        history = [{"key": r.key, "value": r.value, "effective_from": r.effective_from} for r in MoneySetting.objects.order_by("-effective_from", "-id")[:20]]
        return Response({"settings": rows, "pending": pending, "history": history})

    def post(self, request):
        data = request.data if isinstance(request.data, dict) else {}
        key = data.get("key")
        try:
            settings_store.clean(key, data.get("value"))
        except settings_store.SettingError as exc:
            return Response({"detail": str(exc)}, status=400)
        if ApprovalRequest.objects.filter(kind=SETTING_KEY, status=ApprovalRequest.PENDING, payload__key=key).exists():
            return Response({"detail": "A change to this setting is already waiting for approval."}, status=status.HTTP_409_CONFLICT)
        label = settings_store.DEFINITIONS[key].label
        return _submit(
            request, SETTING_KEY, title=f"Money setting: {label}",
            target_type="ledger.moneysetting", target_id=key, target_label=label,
            payload={"key": key, "value": data.get("value"), "effective_from": data.get("effective_from")},
            maker_note=str(data.get("note") or ""),
        )
```

`backend/ledger/urls.py`:

```python
from django.urls import path

from . import views

urlpatterns = [
    path("fees/", views.FeeRulesView.as_view(), name="ledger-fees"),
    path("settings/", views.MoneySettingsView.as_view(), name="ledger-settings"),
]
```

In `backend/ashantihub/urls.py`, next to `path("api/commission/", include("commission.urls")),` add `path("api/ledger/", include("ledger.urls")),`.

- [ ] **Step 7: Run the tests**

Run: `docker compose run --rm web python manage.py test ledger.tests.test_governance accounts.tests.test_roles_seed`
Expected: all PASS (the roles-seed test confirms Super Admin still holds every permission).

- [ ] **Step 8: Commit**

```bash
git add backend/accounts/migrations/0049_seed_ledger_permissions.py backend/ledger backend/ashantihub/urls.py
git commit -m "feat(ledger): governed fee rules and money settings through the approvals engine"
```

---

### Task 7: Record order payments into the ledger

**Files:**
- Create: `backend/ledger/escrow.py`, `backend/ledger/tests/test_order_payment.py`
- Modify: `backend/payments/services.py` (`_finalize_order_checkout`, after `order.save(update_fields=["status"])`)

**Interfaces:**
- Consumes: `posting.*`, `fees.quote/charged_to_date`, `settings_store.current`, `OrderFeeSnapshot`, `money.to_pesewas`.
- Produces: `escrow.enabled() -> bool`; `escrow.record_order_payment(order, *, at=None) -> Journal | None` (journal key `order-pay-<order id>`; returns `None` when disabled or already recorded).

- [ ] **Step 1: Write the failing tests** — `backend/ledger/tests/test_order_payment.py`

```python
from datetime import timedelta
from decimal import Decimal

from django.db import transaction
from django.test import TestCase, override_settings
from django.utils import timezone

from accounts.models import BusinessOwner, Customer
from ledger import escrow, posting
from ledger.models import Account, Journal, MoneySetting, OrderFeeSnapshot
from listings.models import Category, Listing, Zone
from orders.models import Order, OrderItem


class OrderPaymentBase(TestCase):
    def setUp(self):
        self.customer = Customer.objects.create(full_name="Ama", phone="+233200990001", password_hash="x")
        self.shops = Category.objects.get(slug="shops")
        self.zone = Zone.objects.get(name="Manhyia")
        self.n = 0

    def owner(self, name):
        self.n += 1
        return BusinessOwner.objects.create(full_name=name, login_phone=f"+2332079900{self.n:02d}", password_hash="x")

    def listing(self, owner, price):
        self.n += 1
        return Listing.objects.create(
            business_owner=owner, category=self.shops, zone=self.zone, name=f"Item {self.n}", description="D.",
            contact_phone=owner.login_phone, price_amount=Decimal(price), status=Listing.PUBLISHED,
        )

    def order(self, lines, *, delivery=None, discount="0.00", total=None):
        """lines: [(listing, quantity)]. total defaults to a reconciling amount."""
        items_total = sum((l.price_amount * q for l, q in lines), Decimal("0.00"))
        paid = total if total is not None else items_total - Decimal(discount) + Decimal(delivery or "0.00")
        order = Order.objects.create(
            customer=self.customer, status=Order.PAID, total_amount=paid, discount_amount=discount,
            delivery_fee=delivery,
        )
        for listing, quantity in lines:
            OrderItem.objects.create(order=order, listing=listing, quantity=quantity, unit_price=listing.price_amount, line_total=listing.price_amount * quantity)
        return order

    def balance(self, kind, owner=None):
        return posting.account_for(kind, owner).balance


@override_settings(LEDGER_ENABLED=True)
class RecordOrderPaymentTests(OrderPaymentBase):
    def test_a_single_vendor_order_posts_pending_snapshot_and_clearing(self):
        kofi = self.owner("Kofi")
        order = self.order([(self.listing(kofi, "60.00"), 2)], delivery="10.00")        # items 120.00 + delivery 10.00
        journal = escrow.record_order_payment(order)
        self.assertEqual(journal.key, f"order-pay-{order.pk}")
        self.assertEqual(self.balance(Account.PROVIDER_CLEARING), 13000)
        self.assertEqual(self.balance(Account.VENDOR_PENDING, kofi), 12000)
        self.assertEqual(self.balance(Account.DELIVERY_PAYABLE, order), 1000)
        snap = OrderFeeSnapshot.objects.get(order=order)
        self.assertEqual((snap.base_pesewas, snap.computed_pesewas, snap.charged_pesewas), (12000, 500, 500))   # GHS 120 -> GHS 5 flat

    def test_each_vendor_in_a_mixed_cart_pays_their_own_fee(self):
        kofi, esi = self.owner("Kofi"), self.owner("Esi")
        order = self.order([(self.listing(kofi, "50.00"), 1), (self.listing(esi, "600.00"), 1)])
        escrow.record_order_payment(order)
        by_owner = {s.business_owner_id: s for s in OrderFeeSnapshot.objects.filter(order=order)}
        self.assertEqual(by_owner[kofi.pk].charged_pesewas, 50)       # 1% of GHS 50.00
        self.assertEqual(by_owner[esi.pk].charged_pesewas, 600)       # 1% of GHS 600.00
        self.assertEqual(self.balance(Account.VENDOR_PENDING, kofi), 5000)
        self.assertEqual(self.balance(Account.VENDOR_PENDING, esi), 60000)

    def test_a_coupon_is_a_platform_subsidy_not_a_vendor_cost(self):
        kofi = self.owner("Kofi")
        order = self.order([(self.listing(kofi, "100.00"), 1)], discount="10.00")        # customer pays 90.00
        escrow.record_order_payment(order)
        self.assertEqual(self.balance(Account.PROVIDER_CLEARING), 9000)
        self.assertEqual(self.balance(Account.PLATFORM_PROMO_SUBSIDY), 1000)
        self.assertEqual(self.balance(Account.VENDOR_PENDING, kofi), 10000)               # vendor still owed the full line
        self.assertEqual(OrderFeeSnapshot.objects.get(order=order).base_pesewas, 10000)

    def test_review_focus_an_order_that_does_not_reconcile_fails_and_leaves_nothing(self):
        kofi = self.owner("Kofi")
        order = self.order([(self.listing(kofi, "60.00"), 1)], total=Decimal("59.00"))    # short by GHS 1.00
        with self.assertRaises(posting.PostingError), transaction.atomic():
            escrow.record_order_payment(order)
        self.assertFalse(Journal.objects.exists())
        self.assertFalse(OrderFeeSnapshot.objects.exists())

    def test_review_focus_a_fully_discounted_order_writes_no_zero_lines(self):
        kofi = self.owner("Kofi")
        order = self.order([(self.listing(kofi, "20.00"), 1)], discount="20.00")           # customer pays 0.00
        escrow.record_order_payment(order)
        self.assertEqual(self.balance(Account.PLATFORM_PROMO_SUBSIDY), 2000)
        self.assertEqual(self.balance(Account.PROVIDER_CLEARING), 0)
        self.assertFalse(Journal.objects.get(key=f"order-pay-{order.pk}").lines.filter(amount=0).exists())

    def test_review_focus_recording_twice_posts_once(self):
        kofi = self.owner("Kofi")
        order = self.order([(self.listing(kofi, "60.00"), 1)])
        escrow.record_order_payment(order)
        self.assertIsNone(escrow.record_order_payment(order))
        self.assertEqual(Journal.objects.count(), 1)
        self.assertEqual(OrderFeeSnapshot.objects.filter(order=order).count(), 1)
        self.assertEqual(self.balance(Account.VENDOR_PENDING, kofi), 6000)

    def test_the_lifetime_cap_trims_and_then_stops_the_fee(self):
        MoneySetting.objects.create(key="fee_cap_pesewas", value=700, effective_from=timezone.now() - timedelta(days=1))
        kofi = self.owner("Kofi")
        listing = self.listing(kofi, "120.00")                                              # GHS 5.00 flat each
        charged = []
        for _ in range(3):
            order = self.order([(listing, 1)])
            escrow.record_order_payment(order)
            charged.append(OrderFeeSnapshot.objects.get(order=order).charged_pesewas)
        self.assertEqual(charged, [500, 200, 0])

    def test_review_focus_two_payments_for_one_vendor_never_exceed_the_cap(self):
        MoneySetting.objects.create(key="fee_cap_pesewas", value=500, effective_from=timezone.now() - timedelta(days=1))
        kofi = self.owner("Kofi")
        listing = self.listing(kofi, "120.00")
        for _ in range(2):
            escrow.record_order_payment(self.order([(listing, 1)]))
        total = sum(s.charged_pesewas for s in OrderFeeSnapshot.objects.filter(business_owner=kofi))
        self.assertEqual(total, 500)


class DisabledTests(OrderPaymentBase):
    def test_nothing_is_recorded_while_the_ledger_is_off(self):
        kofi = self.owner("Kofi")
        order = self.order([(self.listing(kofi, "60.00"), 1)])
        self.assertIsNone(escrow.record_order_payment(order))
        self.assertFalse(Journal.objects.exists())
        self.assertFalse(OrderFeeSnapshot.objects.exists())


@override_settings(LEDGER_ENABLED=True)
class CheckoutHookTests(OrderPaymentBase):
    def test_a_simulated_checkout_records_the_payment(self):
        from rest_framework.test import APIClient

        from accounts.authentication import issue_token

        kofi = self.owner("Kofi")
        listing = self.listing(kofi, "60.00")
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.customer, 'customer')}")
        added = client.post("/api/cart/items/", {"listing": listing.id, "quantity": 2}, format="json")
        self.assertIn(added.status_code, (200, 201), added.content)
        response = client.post("/api/orders/checkout/")
        self.assertEqual(response.status_code, 201, response.content)
        order = Order.objects.get(pk=response.json()["id"])
        self.assertTrue(Journal.objects.filter(key=f"order-pay-{order.pk}").exists())
        self.assertEqual(self.balance(Account.VENDOR_PENDING, kofi), 12000)
```

- [ ] **Step 2: Run it to see it fail**

Run: `docker compose run --rm web python manage.py test ledger.tests.test_order_payment`
Expected: ERROR `cannot import name 'escrow'`.

- [ ] **Step 3: Implement** — `backend/ledger/escrow.py`

```python
"""Order money in the ledger: record_order_payment (this task) and release_order (Task 8).

Payment journal for an order, in pesewas:
    Dr provider clearing   what the customer paid (order.total_amount)
    Dr promo subsidy       the coupon discount, funded by AshantiHub (order.discount_amount)
    Cr vendor pending      each vendor's item subtotal (Σ line_total)
    Cr delivery payable    the delivery fee, held until the delivery is paid out
The two debits always equal the credits for a consistent order; if they do not, nothing is written."""
from django.conf import settings
from django.db import transaction
from django.utils import timezone

from . import fees, posting, settings_store
from .models import Account, Journal, OrderFeeSnapshot
from .money import to_pesewas


def enabled():
    return bool(settings.LEDGER_ENABLED)


def pay_key(order):
    return f"order-pay-{order.pk}"


def _vendor_groups(order):
    groups = {}
    for item in order.items.select_related("listing__business_owner", "listing__category"):
        owner = item.listing.business_owner
        entry = groups.setdefault(owner.pk, {"owner": owner, "by_category": {}})
        category = item.listing.category.kind
        entry["by_category"][category] = entry["by_category"].get(category, 0) + to_pesewas(item.line_total)
    return groups


def record_order_payment(order, *, at=None):
    if not enabled():
        return None
    at = at or timezone.now()
    with transaction.atomic():
        if Journal.objects.filter(key=pay_key(order)).exists():
            return None
        groups = _vendor_groups(order)
        pendings = {pk: posting.account_for(Account.VENDOR_PENDING, g["owner"]) for pk, g in groups.items()}
        # Lock every vendor's pending account in primary-key order before reading fees charged so far,
        # so two payments for one vendor cannot both see the same cap remainder.
        list(Account.objects.select_for_update().filter(pk__in=[a.pk for a in pendings.values()]).order_by("pk"))
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

        delivery = to_pesewas(order.delivery_fee or 0)
        paid = to_pesewas(order.total_amount)
        subsidy = to_pesewas(order.discount_amount or 0)
        if paid + subsidy != items_total + delivery:
            raise posting.PostingError(
                f"Order {order.pk} does not reconcile: paid {paid} + discount {subsidy} != items {items_total} + delivery {delivery}"
            )
        if delivery:
            credits.append(posting.credit(posting.account_for(Account.DELIVERY_PAYABLE, order), delivery))
        debits = []
        if paid:
            debits.append(posting.debit(posting.account_for(Account.PROVIDER_CLEARING), paid))
        if subsidy:
            debits.append(posting.debit(posting.account_for(Account.PLATFORM_PROMO_SUBSIDY), subsidy))
        return posting.post(
            key=pay_key(order), kind="order_payment", lines=debits + credits,
            reference_type="orders.order", reference_id=str(order.pk), memo=f"Payment for order #{order.pk}",
        )
```

- [ ] **Step 4: Hook it into the finalizer** — in `backend/payments/services.py`, change `_finalize_order_checkout` so the ledger records the payment before the owner alert:

```python
    order.status = Order.PAID
    order.save(update_fields=["status"])

    from ledger import escrow

    escrow.record_order_payment(order)

    from orders.alerts import alert_owners_of_paid_order

    alert_owners_of_paid_order(order)
```

- [ ] **Step 5: Run the new tests and the existing order and payment suites**

Run: `docker compose run --rm web python manage.py test ledger orders payments`
Expected: all PASS (the ledger is off by default, so existing tests are unaffected).

- [ ] **Step 6: Commit**

```bash
git add backend/ledger backend/payments/services.py
git commit -m "feat(ledger): record product-order payments with per-vendor fee snapshots"
```

---

### Task 8: Support verification and release to the vendor

Money reaches the vendor only after a person has checked the order. The goods must have reached the customer (a rider marked the delivery done, or the pickup desk marked a store-pickup order collected), the customer's receipt must be confirmed (their own tap, or Support recording it on the call), and Support must record that a call confirmed the product matches its description. A positive result releases the money **at once**, inside the same transaction. A negative result raises a dispute due within 72 hours of purchase and releases nothing. There is no timer-based release.

**Files:**
- Modify: `backend/ledger/models.py` (append `FulfilmentCheck`), `backend/ledger/escrow.py` (append release), `backend/ledger/views.py`, `backend/ledger/urls.py`
- Create: `backend/ledger/verification.py`, `backend/ledger/migrations/0006_fulfilmentcheck.py` (generated), `backend/accounts/migrations/0050_seed_order_verify_permission.py`, `backend/ledger/tests/test_verification.py`

**Interfaces:**
- Consumes: Task 7's journal and snapshots; `DeliveryAssignment.delivered_at/confirmed_at/status` via `order.delivery_assignment`; `disputes.models.Dispute` (`raised_by`, `logged_by`, `answer_due_at`, `FINAL_STATUSES`); `settings_store.current("verification_overdue_hours")`.
- Produces: `FulfilmentCheck(order, collected_at, collected_by, phone_confirmed_at, outcome, outcome_note, outcome_at, outcome_by, dispute)` with `FulfilmentCheck.MATCHES / DOES_NOT_MATCH / UNREACHABLE`; `escrow.has_open_dispute(order) -> bool`; `escrow.release_verified(order, now=None) -> Journal | None` (journal key `order-release-<order id>`); `verification.VerificationError(message, status_code)`; `verification.check_for(order) -> FulfilmentCheck`; `verification.handed_over(order, check) -> bool`; `verification.record(order, staff, outcome, *, note="", customer_confirmed_by_phone=False, now=None) -> FulfilmentCheck`; `verification.awaiting(now=None) -> list[dict]`; permission `orders.verify` (Support, Super Admin); endpoints `GET /api/ledger/orders/awaiting-verification/` and `POST /api/ledger/orders/<id>/verification/`.

- [ ] **Step 1: Write the failing tests** — `backend/ledger/tests/test_verification.py`

```python
from datetime import timedelta

from django.core.cache import cache
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.testing import make_staff, staff_token
from disputes.models import Dispute
from ledger import escrow
from ledger.models import Account, FulfilmentCheck, Journal, OrderFeeSnapshot
from orders.models import DeliveryAssignment, Order

from .test_order_payment import OrderPaymentBase


class VerificationBase(OrderPaymentBase):
    def setUp(self):
        super().setUp()
        cache.clear()
        self.client = APIClient()
        self.support = make_staff("support", "esi@example.com")
        self.accountant = make_staff("accountant", "kofi@example.com")

    def as_staff(self, staff):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(staff)}")

    def paid_order(self, *, delivered=True, customer_confirmed=False, price="120.00", delivery="10.00"):
        """A paid door-to-door order (items 120.00 + delivery 10.00) with its payment recorded."""
        self.kofi = self.owner("Kofi")
        order = self.order([(self.listing(self.kofi, price), 1)], delivery=delivery)
        order.delivery_method = Order.DOOR_TO_DOOR
        order.save(update_fields=["delivery_method"])
        escrow.record_order_payment(order)
        if delivered:
            DeliveryAssignment.objects.create(
                order=order, status=DeliveryAssignment.DELIVERED, delivered_at=timezone.now() - timedelta(hours=1),
            )
        if customer_confirmed:
            DeliveryAssignment.objects.filter(order=order).update(status=DeliveryAssignment.CONFIRMED, confirmed_at=timezone.now())
        return order

    def verify(self, order, outcome, **extra):
        return self.client.post(f"/api/ledger/orders/{order.pk}/verification/", {"outcome": outcome, **extra}, format="json")


@override_settings(LEDGER_ENABLED=True)
class RecordVerificationTests(VerificationBase):
    def test_a_positive_call_releases_at_once_in_the_owners_order(self):
        order = self.paid_order(customer_confirmed=True)
        self.as_staff(self.support)
        response = self.verify(order, "matches")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertTrue(response.json()["released"])
        self.assertEqual(self.balance(Account.VENDOR_PENDING, self.kofi), 0)
        self.assertEqual(self.balance(Account.VENDOR_AVAILABLE, self.kofi), 11500)          # 120.00 - GHS 5.00 fee
        self.assertEqual(self.balance(Account.PLATFORM_FEE_INCOME), 500)
        self.assertEqual(self.balance(Account.DELIVERY_PAYABLE, order), 0)
        self.assertEqual(self.balance(Account.PLATFORM_DELIVERY_INCOME), 1000)              # company rider: delivery is platform income
        self.assertTrue(OrderFeeSnapshot.objects.get(order=order).released_at)
        kinds = [line.account.kind for line in Journal.objects.get(key=f"order-release-{order.pk}").lines.order_by("id")]
        self.assertLess(kinds.index(Account.PLATFORM_FEE_INCOME), kinds.index(Account.VENDOR_AVAILABLE))

    def test_nothing_moves_until_the_goods_have_reached_the_customer(self):
        order = self.paid_order(delivered=False)
        self.as_staff(self.support)
        self.assertEqual(self.verify(order, "matches").status_code, 409)
        self.assertEqual(self.balance(Account.VENDOR_PENDING, self.kofi), 12000)

    def test_the_customers_receipt_can_be_confirmed_on_the_call(self):
        order = self.paid_order(customer_confirmed=False)
        self.as_staff(self.support)
        refused = self.verify(order, "matches")
        self.assertEqual(refused.status_code, 409)
        self.assertIn("confirmation of receipt", refused.json()["detail"])
        ok = self.verify(order, "matches", customer_confirmed_by_phone=True)
        self.assertEqual(ok.status_code, 200, ok.content)
        self.assertIsNotNone(FulfilmentCheck.objects.get(order=order).phone_confirmed_at)
        self.assertEqual(self.balance(Account.VENDOR_AVAILABLE, self.kofi), 11500)

    def test_a_mismatch_raises_a_dispute_due_within_72_hours_of_purchase_and_releases_nothing(self):
        order = self.paid_order(customer_confirmed=True)
        self.as_staff(self.support)
        self.assertEqual(self.verify(order, "does_not_match").status_code, 400)             # a note is required
        response = self.verify(order, "does_not_match", note="Customer received a different colour")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertFalse(response.json()["released"])
        order.refresh_from_db()
        dispute = Dispute.objects.get(order=order)
        self.assertEqual((dispute.status, dispute.raised_by_id, dispute.logged_by_id), (Dispute.OPEN, self.customer.pk, self.support.pk))
        self.assertEqual(dispute.answer_due_at, order.placed_at + timedelta(hours=72))
        self.assertEqual(self.balance(Account.VENDOR_PENDING, self.kofi), 12000)

    def test_a_second_mismatch_note_does_not_open_a_second_dispute(self):
        order = self.paid_order(customer_confirmed=True)
        self.as_staff(self.support)
        self.verify(order, "does_not_match", note="Wrong size")
        self.verify(order, "does_not_match", note="Still wrong")
        self.assertEqual(Dispute.objects.filter(order=order).count(), 1)

    def test_unreachable_is_recorded_and_releases_nothing(self):
        order = self.paid_order(customer_confirmed=True)
        self.as_staff(self.support)
        response = self.verify(order, "unreachable", note="Rang three times")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(FulfilmentCheck.objects.get(order=order).outcome, "unreachable")
        self.assertEqual(self.balance(Account.VENDOR_PENDING, self.kofi), 12000)
        self.assertFalse(Dispute.objects.filter(order=order).exists())

    def test_review_focus_an_open_dispute_blocks_a_positive_result_until_it_is_final(self):
        order = self.paid_order(customer_confirmed=True)
        self.as_staff(self.support)
        self.verify(order, "does_not_match", note="Wrong item")
        self.assertEqual(self.verify(order, "matches").status_code, 409)
        for final in Dispute.FINAL_STATUSES:                                                 # resolved and rejected both end it
            Dispute.objects.filter(order=order).update(status=final)
            self.assertFalse(escrow.has_open_dispute(order), final)
        Dispute.objects.filter(order=order).update(status=Dispute.REJECTED)
        self.assertEqual(self.verify(order, "matches").status_code, 200)
        self.assertEqual(self.balance(Account.VENDOR_AVAILABLE, self.kofi), 11500)

    def test_a_released_order_cannot_be_verified_again(self):
        order = self.paid_order(customer_confirmed=True)
        self.as_staff(self.support)
        self.verify(order, "matches")
        self.assertEqual(self.verify(order, "matches").status_code, 409)
        self.assertEqual(Journal.objects.filter(key=f"order-release-{order.pk}").count(), 1)
        self.assertEqual(self.balance(Account.VENDOR_AVAILABLE, self.kofi), 11500)

    def test_review_focus_release_uses_the_snapshot_not_the_rules_now(self):
        from ledger.models import FeeBand, FeeRuleSet

        order = self.paid_order(customer_confirmed=True)
        newer = FeeRuleSet.objects.create(category="product", effective_from=timezone.now())
        FeeBand.objects.create(rule_set=newer, lower_pesewas=0, upper_pesewas=None, percent_bp=5000)      # 50%!
        self.as_staff(self.support)
        self.verify(order, "matches")
        self.assertEqual(self.balance(Account.PLATFORM_FEE_INCOME), 500)

    def test_the_result_is_recorded_but_nothing_moves_while_the_ledger_is_off(self):
        order = self.paid_order(customer_confirmed=True)
        self.as_staff(self.support)
        with override_settings(LEDGER_ENABLED=False):
            response = self.verify(order, "matches")
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["released"])
        self.assertEqual(self.balance(Account.VENDOR_PENDING, self.kofi), 12000)

    def test_only_support_and_super_admin_may_verify(self):
        order = self.paid_order(customer_confirmed=True)
        self.as_staff(self.accountant)
        self.assertEqual(self.verify(order, "matches").status_code, 403)

    def test_an_unknown_outcome_is_a_400(self):
        order = self.paid_order(customer_confirmed=True)
        self.as_staff(self.support)
        self.assertEqual(self.verify(order, "maybe").status_code, 400)


@override_settings(LEDGER_ENABLED=True)
class AwaitingListTests(VerificationBase):
    def get(self):
        return self.client.get("/api/ledger/orders/awaiting-verification/")

    def test_lists_delivered_unverified_orders_with_what_to_check_on_the_call(self):
        order = self.paid_order(customer_confirmed=True)
        self.as_staff(self.support)
        rows = self.get().json()["results"]
        self.assertEqual([r["order_id"] for r in rows], [order.pk])
        row = rows[0]
        self.assertEqual(row["customer_phone"], "+233200990001")
        self.assertEqual(len(row["items"]), 1)
        self.assertEqual(row["items"][0]["quantity"], 1)
        self.assertTrue(row["customer_confirmed"])
        self.assertFalse(row["overdue"])

    def test_hides_undelivered_verified_and_released_orders(self):
        undelivered = self.paid_order(delivered=False)
        released = self.paid_order(customer_confirmed=True)
        self.as_staff(self.support)
        self.verify(released, "matches")
        ids = [r["order_id"] for r in self.get().json()["results"]]
        self.assertNotIn(undelivered.pk, ids)
        self.assertNotIn(released.pk, ids)

    def test_an_order_past_72_hours_from_purchase_is_flagged_overdue(self):
        order = self.paid_order(customer_confirmed=True)
        Order.objects.filter(pk=order.pk).update(placed_at=timezone.now() - timedelta(hours=73))
        self.as_staff(self.support)
        self.assertTrue(self.get().json()["results"][0]["overdue"])

    def test_an_order_with_a_mismatch_stays_on_the_list_with_its_note(self):
        order = self.paid_order(customer_confirmed=True)
        self.as_staff(self.support)
        self.verify(order, "does_not_match", note="Wrong colour")
        row = self.get().json()["results"][0]
        self.assertEqual((row["outcome"], row["outcome_note"]), ("does_not_match", "Wrong colour"))

    def test_support_only(self):
        self.as_staff(self.accountant)
        self.assertEqual(self.get().status_code, 403)
```

- [ ] **Step 2: Run it to see it fail**

Run: `docker compose run --rm web python manage.py test ledger.tests.test_verification`
Expected: ERROR `cannot import name 'FulfilmentCheck'`.

- [ ] **Step 3: Add the model** — append to `backend/ledger/models.py`

```python


class FulfilmentCheck(models.Model):
    """What happened to a product order after it was handed over: collected at the AshantiHub office (store pickup),
    the customer's receipt confirmed by phone, and Support's verification call. The vendor's money is released only
    on a positive outcome."""

    MATCHES, DOES_NOT_MATCH, UNREACHABLE = "matches", "does_not_match", "unreachable"
    OUTCOME_CHOICES = [
        ("", "Not verified yet"), (MATCHES, "Matches the description"), (DOES_NOT_MATCH, "Does not match"),
        (UNREACHABLE, "Could not reach the customer"),
    ]

    order = models.OneToOneField("orders.Order", on_delete=models.PROTECT, related_name="fulfilment_check")
    collected_at = models.DateTimeField(null=True, blank=True)
    collected_by = models.ForeignKey("accounts.StaffUser", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    phone_confirmed_at = models.DateTimeField(null=True, blank=True)
    outcome = models.CharField(max_length=14, choices=OUTCOME_CHOICES, blank=True, default="")
    outcome_note = models.CharField(max_length=500, blank=True, default="")
    outcome_at = models.DateTimeField(null=True, blank=True)
    outcome_by = models.ForeignKey("accounts.StaffUser", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    dispute = models.ForeignKey("disputes.Dispute", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Order {self.order_id}: {self.outcome or 'awaiting verification'}"
```

- [ ] **Step 4: Generate the migration**

Run: `docker compose run --rm web python manage.py makemigrations ledger -n fulfilmentcheck`
Expected: creates `ledger/migrations/0006_fulfilmentcheck.py`.

- [ ] **Step 5: Add the release function** — append to `backend/ledger/escrow.py` (and add `FulfilmentCheck` to the `from .models import ...` line at the top)

```python
# --- release ---------------------------------------------------------------------------------------------

def release_key(order):
    return f"order-release-{order.pk}"


def has_open_dispute(order):
    from disputes.models import Dispute

    return Dispute.objects.filter(order=order).exclude(status__in=Dispute.FINAL_STATUSES).exists()


def release_verified(order, now=None):
    """Release an order's held money to the vendor and the platform. Called when Support records a positive
    verification; there is no timer. Returns the journal, or None when the ledger is off, the order has no positive
    verification or an open dispute, or it was already released."""
    if not enabled():
        return None
    now = now or timezone.now()
    with transaction.atomic():
        if Journal.objects.filter(key=release_key(order)).exists() or has_open_dispute(order):
            return None
        if not FulfilmentCheck.objects.filter(order=order, outcome=FulfilmentCheck.MATCHES).exists():
            return None
        snapshots = list(
            OrderFeeSnapshot.objects.select_for_update()
            .filter(order=order, released_at__isnull=True, reversed_at__isnull=True).select_related("business_owner")
        )
        if not snapshots or not Journal.objects.filter(key=pay_key(order)).exists():
            return None
        income = posting.account_for(Account.PLATFORM_FEE_INCOME)
        by_vendor = {}
        for snap in snapshots:
            entry = by_vendor.setdefault(snap.business_owner_id, {"owner": snap.business_owner, "base": 0, "fee": 0})
            entry["base"] += snap.base_pesewas
            entry["fee"] += snap.charged_pesewas

        # The owner's order: AshantiHub first (fee, delivery), then each vendor, then any third-party rider (Stage 5).
        debits, credits = [], []
        for vendor_id in sorted(by_vendor):
            entry = by_vendor[vendor_id]
            debits.append(posting.debit(posting.account_for(Account.VENDOR_PENDING, entry["owner"]), entry["base"]))
            if entry["fee"]:
                credits.append(posting.credit(income, entry["fee"]))
        delivery = to_pesewas(order.delivery_fee or 0)
        if delivery:
            debits.append(posting.debit(posting.account_for(Account.DELIVERY_PAYABLE, order), delivery))
            credits.append(posting.credit(posting.account_for(Account.PLATFORM_DELIVERY_INCOME), delivery))
        for vendor_id in sorted(by_vendor):
            entry = by_vendor[vendor_id]
            payable = entry["base"] - entry["fee"]
            if payable:
                credits.append(posting.credit(posting.account_for(Account.VENDOR_AVAILABLE, entry["owner"]), payable))
        journal = posting.post(
            key=release_key(order), kind="order_release", lines=debits + credits,
            reference_type="orders.order", reference_id=str(order.pk), memo=f"Release of order #{order.pk}",
        )
        OrderFeeSnapshot.objects.filter(pk__in=[s.pk for s in snapshots]).update(released_at=now)
        return journal
```

- [ ] **Step 6: Implement verification** — `backend/ledger/verification.py`

```python
"""Support's verification of a product order that has reached the customer, and the release it triggers. A positive
result releases the money immediately; a negative one raises a dispute due within `verification_overdue_hours` of
purchase and releases nothing; "could not reach" is only recorded (the order stays on Support's list)."""
from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from . import escrow, settings_store
from .models import FulfilmentCheck, Journal


class VerificationError(Exception):
    def __init__(self, message, status_code=409):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def check_for(order):
    check, _ = FulfilmentCheck.objects.get_or_create(order=order)
    return check


def handed_over(order, check):
    """True once the goods have reached the customer: a rider marked the delivery done, or the pickup desk marked a
    store-pickup order collected."""
    from orders.models import DeliveryAssignment, Order

    if order.delivery_method == Order.STORE_PICKUP:
        return check.collected_at is not None
    assignment = getattr(order, "delivery_assignment", None)
    return assignment is not None and assignment.status != DeliveryAssignment.FAILED and assignment.delivered_at is not None


def customer_confirmed(order, check):
    from orders.models import Order

    if order.delivery_method == Order.STORE_PICKUP:
        return True  # the customer took the goods at the desk
    assignment = getattr(order, "delivery_assignment", None)
    return bool(assignment and assignment.confirmed_at) or check.phone_confirmed_at is not None


def record(order, staff, outcome, *, note="", customer_confirmed_by_phone=False, now=None):
    from disputes.models import Dispute
    from orders.models import Order

    now = now or timezone.now()
    if outcome not in (FulfilmentCheck.MATCHES, FulfilmentCheck.DOES_NOT_MATCH, FulfilmentCheck.UNREACHABLE):
        raise VerificationError("Pick matches, does not match, or could not reach.", 400)
    note = (note or "").strip()[:500]
    if outcome == FulfilmentCheck.DOES_NOT_MATCH and not note:
        raise VerificationError("Say what does not match.", 400)
    with transaction.atomic():
        order = Order.objects.select_for_update().get(pk=order.pk)
        if order.status != Order.PAID:
            raise VerificationError("This order has not been paid.")
        if Journal.objects.filter(key=escrow.release_key(order)).exists():
            raise VerificationError("This order has already been released to the vendor.")
        check = check_for(order)
        if not handed_over(order, check):
            raise VerificationError("This order has not been delivered or collected yet.")
        if outcome == FulfilmentCheck.MATCHES:
            if escrow.has_open_dispute(order):
                raise VerificationError("A dispute is open on this order. It must be settled first.")
            if customer_confirmed_by_phone and check.phone_confirmed_at is None:
                check.phone_confirmed_at = now
            if not customer_confirmed(order, check):
                raise VerificationError("Record the customer's confirmation of receipt first.")
        if outcome == FulfilmentCheck.DOES_NOT_MATCH and not escrow.has_open_dispute(order):
            hours = settings_store.current("verification_overdue_hours", now)
            check.dispute = Dispute.objects.create(
                order=order, raised_by=order.customer, logged_by=staff, reason=Dispute.ORDER_ISSUE,
                problem_type=Dispute.WRONG_OR_MISSING, description=note, status=Dispute.OPEN,
                answer_due_at=order.placed_at + timedelta(hours=hours),
            )
        check.outcome, check.outcome_note, check.outcome_at, check.outcome_by = outcome, note, now, staff
        check.save()
        if outcome == FulfilmentCheck.MATCHES:
            escrow.release_verified(order, now)
        return check


def awaiting(now=None):
    """Paid orders that have reached the customer and are not yet verified positive, oldest first, with what Support
    needs on the call. `overdue` means more than `verification_overdue_hours` have passed since purchase."""
    from orders.models import Order

    now = now or timezone.now()
    limit = timedelta(hours=settings_store.current("verification_overdue_hours", now))
    orders = (
        Order.objects.filter(status=Order.PAID, fee_snapshots__released_at__isnull=True).distinct()
        .select_related("customer").prefetch_related("items__listing__business_owner").order_by("placed_at", "id")
    )
    rows = []
    for order in orders:
        check = FulfilmentCheck.objects.filter(order=order).first() or FulfilmentCheck(order=order)
        if not handed_over(order, check) or check.outcome == FulfilmentCheck.MATCHES:
            continue
        rows.append({
            "order_id": order.pk, "placed_at": order.placed_at, "due_by": order.placed_at + limit,
            "overdue": now > order.placed_at + limit, "delivery_method": order.delivery_method,
            "customer_name": order.customer.full_name, "customer_phone": order.delivery_phone or order.customer.phone,
            "items": [
                {"name": item.listing.name, "quantity": item.quantity, "business": item.listing.business_owner.display_name}
                for item in order.items.all()
            ],
            "customer_confirmed": customer_confirmed(order, check),
            "outcome": check.outcome, "outcome_note": check.outcome_note,
        })
    return rows
```

- [ ] **Step 7: Add the endpoints** — append to `backend/ledger/views.py` (add `from django.shortcuts import get_object_or_404`, `from orders.models import Order` and `from . import escrow, verification` and `Journal` to the imports):

```python
class AwaitingVerificationView(APIView):
    """GET orders/awaiting-verification/ — delivered or collected orders waiting for Support's verification call."""

    def get_permissions(self):
        return [HasRolePermission("orders.verify")]

    def get(self, request):
        return Response({"results": verification.awaiting()})


class OrderVerificationView(APIView):
    """POST orders/<id>/verification/ {outcome: matches|does_not_match|unreachable, note?, customer_confirmed_by_phone?}.
    A positive outcome releases the order's money at once."""

    def get_permissions(self):
        return [HasRolePermission("orders.verify")]

    def post(self, request, pk):
        order = get_object_or_404(Order, pk=pk)
        data = request.data if isinstance(request.data, dict) else {}
        try:
            check = verification.record(
                order, request.user, data.get("outcome"), note=data.get("note"),
                customer_confirmed_by_phone=data.get("customer_confirmed_by_phone") is True,
            )
        except verification.VerificationError as exc:
            return Response({"detail": exc.message}, status=exc.status_code)
        return Response({
            "order": order.pk, "outcome": check.outcome, "dispute_id": check.dispute_id,
            "released": Journal.objects.filter(key=escrow.release_key(order)).exists(),
        })
```

In `backend/ledger/urls.py` add:

```python
    path("orders/awaiting-verification/", views.AwaitingVerificationView.as_view(), name="ledger-awaiting-verification"),
    path("orders/<int:pk>/verification/", views.OrderVerificationView.as_view(), name="ledger-order-verification"),
```

- [ ] **Step 8: Seed the permission** — `backend/accounts/migrations/0050_seed_order_verify_permission.py`

```python
from django.db import migrations

# Support's verification call on a delivered or collected product order (ledger plan, Task 8).
PERMISSIONS = [("orders.verify", "Verify a delivered order with the customer and release the vendor's money")]
GRANTS = {"support": ["orders.verify"], "super_admin": ["orders.verify"]}


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
    dependencies = [("accounts", "0049_seed_ledger_permissions")]
    operations = [migrations.RunPython(seed, unseed)]
```

- [ ] **Step 9: Run the tests**

Run: `docker compose run --rm web python manage.py test ledger accounts.tests.test_roles_seed`
Expected: all PASS. If `DeliveryAssignment.objects.create(order=..., status=..., delivered_at=...)` raises an `IntegrityError` for another required field, set it the way `orders/tests/test_delivery_assignment.py` does.

- [ ] **Step 10: Commit**

```bash
git add backend/ledger backend/accounts/migrations/0050_seed_order_verify_permission.py
git commit -m "feat(ledger): Support verification call releases the vendor's money; mismatch raises a 72-hour dispute"
```

---

### Task 9: Pickup Desk role and store-pickup collection

A store-pickup order is collected at the AshantiHub office within a window after purchase (default 24 hours). A new staff role, **Pickup Desk**, sees the queue and marks an order collected. Collection stands in for the rider's delivery and the customer's confirmation; Support's verification call (Task 8) still follows. What happens to an order not collected inside the window is Stage 3 (refund to the customer's wallet); here it is only flagged overdue.

**Files:**
- Modify: `backend/accounts/models.py` (`Role`), `backend/ledger/verification.py` (append), `backend/ledger/views.py`, `backend/ledger/urls.py`, `backend/accounts/tests/test_roles_seed.py`, `docs/STAFF_ROLES.md`
- Create: `backend/accounts/migrations/0051_alter_role_name.py` (generated), `backend/accounts/migrations/0052_seed_pickup_desk_role.py`, `backend/ledger/tests/test_pickup.py`

**Interfaces:**
- Consumes: `FulfilmentCheck.collected_at/collected_by`, `verification.check_for`, `settings_store.current("pickup_window_hours")`.
- Produces: `Role.PICKUP_DESK = "pickup_desk"`; permission `pickup.confirm` (Pickup Desk, Super Admin); `verification.mark_collected(order, staff, now=None) -> FulfilmentCheck`; `verification.pickup_queue(now=None) -> list[dict]`; endpoints `GET /api/ledger/pickup/` and `POST /api/ledger/pickup/<order id>/collected/`.

- [ ] **Step 1: Write the failing tests** — `backend/ledger/tests/test_pickup.py`

```python
from datetime import timedelta

from django.core.cache import cache
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import Role
from accounts.testing import make_staff, staff_token
from ledger import escrow
from ledger.models import Account, FulfilmentCheck
from orders.models import DeliveryAssignment, Order

from .test_order_payment import OrderPaymentBase


class PickupBase(OrderPaymentBase):
    def setUp(self):
        super().setUp()
        cache.clear()
        self.client = APIClient()
        self.desk = make_staff("pickup_desk", "yaa@example.com")
        self.support = make_staff("support", "esi@example.com")
        self.accountant = make_staff("accountant", "kofi@example.com")

    def as_staff(self, staff):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(staff)}")

    def pickup_order(self):
        self.kofi = self.owner("Kofi")
        order = self.order([(self.listing(self.kofi, "120.00"), 1)])
        order.delivery_method = Order.STORE_PICKUP
        order.save(update_fields=["delivery_method"])
        escrow.record_order_payment(order)
        return order


class RoleTests(PickupBase):
    def test_the_role_exists_with_its_permission_and_super_admin_holds_it_too(self):
        role = Role.objects.get(name="pickup_desk")
        self.assertEqual(list(role.permissions.values_list("codename", flat=True)), ["pickup.confirm"])
        self.assertTrue(Role.objects.get(name="super_admin").permissions.filter(codename="pickup.confirm").exists())


@override_settings(LEDGER_ENABLED=True)
class CollectionTests(PickupBase):
    def collect(self, order):
        return self.client.post(f"/api/ledger/pickup/{order.pk}/collected/")

    def test_the_desk_marks_a_store_pickup_order_collected_and_it_is_idempotent(self):
        order = self.pickup_order()
        self.as_staff(self.desk)
        first = self.collect(order)
        self.assertEqual(first.status_code, 200, first.content)
        check = FulfilmentCheck.objects.get(order=order)
        self.assertEqual(check.collected_by_id, self.desk.pk)
        stamped = check.collected_at
        self.assertEqual(self.collect(order).status_code, 200)
        self.assertEqual(FulfilmentCheck.objects.get(order=order).collected_at, stamped)

    def test_a_door_to_door_or_unpaid_order_cannot_be_collected(self):
        order = self.pickup_order()
        Order.objects.filter(pk=order.pk).update(delivery_method=Order.DOOR_TO_DOOR)
        self.as_staff(self.desk)
        self.assertEqual(self.collect(order).status_code, 409)
        Order.objects.filter(pk=order.pk).update(delivery_method=Order.STORE_PICKUP, status=Order.PENDING)
        self.assertEqual(self.collect(order).status_code, 409)

    def test_a_collected_order_can_then_be_verified_and_released(self):
        order = self.pickup_order()
        self.as_staff(self.desk)
        self.collect(order)
        self.as_staff(self.support)
        response = self.client.post(f"/api/ledger/orders/{order.pk}/verification/", {"outcome": "matches"}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(self.balance(Account.VENDOR_AVAILABLE, self.kofi), 11500)

    def test_an_uncollected_pickup_order_cannot_be_verified(self):
        order = self.pickup_order()
        self.as_staff(self.support)
        response = self.client.post(f"/api/ledger/orders/{order.pk}/verification/", {"outcome": "matches"}, format="json")
        self.assertEqual(response.status_code, 409)

    def test_only_the_desk_and_super_admin_may_collect(self):
        order = self.pickup_order()
        for staff in (self.support, self.accountant):
            self.as_staff(staff)
            self.assertEqual(self.collect(order).status_code, 403)


@override_settings(LEDGER_ENABLED=True)
class QueueTests(PickupBase):
    def test_lists_uncollected_pickup_orders_with_the_collect_by_time_and_overdue_flag(self):
        fresh = self.pickup_order()
        late = self.pickup_order()
        Order.objects.filter(pk=late.pk).update(placed_at=timezone.now() - timedelta(hours=25))
        self.as_staff(self.desk)
        rows = {r["order_id"]: r for r in self.client.get("/api/ledger/pickup/").json()["results"]}
        self.assertFalse(rows[fresh.pk]["overdue"])
        self.assertTrue(rows[late.pk]["overdue"])
        self.assertEqual(rows[fresh.pk]["customer_name"], "Ama")

    def test_collected_and_door_to_door_orders_are_not_listed(self):
        collected = self.pickup_order()
        self.as_staff(self.desk)
        self.client.post(f"/api/ledger/pickup/{collected.pk}/collected/")
        delivery = self.pickup_order()
        Order.objects.filter(pk=delivery.pk).update(delivery_method=Order.DOOR_TO_DOOR)
        ids = [r["order_id"] for r in self.client.get("/api/ledger/pickup/").json()["results"]]
        self.assertNotIn(collected.pk, ids)
        self.assertNotIn(delivery.pk, ids)

    def test_the_desk_does_not_see_the_customers_phone_number(self):
        self.pickup_order()
        self.as_staff(self.desk)
        self.assertNotIn("customer_phone", self.client.get("/api/ledger/pickup/").json()["results"][0])
```

- [ ] **Step 2: Add the role** — in `backend/accounts/models.py` `Role`, after `DISPATCH = "dispatch"` add `PICKUP_DESK = "pickup_desk"` and add `(PICKUP_DESK, "Pickup Desk"),` to `NAME_CHOICES` before `(COSIGNER, "Co-signer"),`. Then generate the migration:

Run: `docker compose run --rm web python manage.py makemigrations accounts -n alter_role_name`
Expected: creates `accounts/migrations/0051_alter_role_name.py`. If Django names it differently, use that name in Step 3's dependency.

- [ ] **Step 3: Seed the role and permission** — `backend/accounts/migrations/0052_seed_pickup_desk_role.py`

```python
from django.db import migrations

# The AshantiHub office desk that hands store-pickup orders to customers (ledger plan, Task 9). Only a Super Admin
# invites this role (no RoleInviteRule); it holds one permission, and Super Admin holds it too.
PERMISSION = ("pickup.confirm", "See the store-pickup queue and mark an order collected")


def seed(apps, schema_editor):
    Permission = apps.get_model("accounts", "Permission")
    Role = apps.get_model("accounts", "Role")
    permission, _ = Permission.objects.get_or_create(codename=PERMISSION[0], defaults={"description": PERMISSION[1]})
    desk, _ = Role.objects.get_or_create(name="pickup_desk")
    desk.permissions.add(permission)
    Role.objects.get(name="super_admin").permissions.add(permission)


def unseed(apps, schema_editor):
    apps.get_model("accounts", "Role").objects.filter(name="pickup_desk").delete()
    apps.get_model("accounts", "Permission").objects.filter(codename=PERMISSION[0]).delete()


class Migration(migrations.Migration):
    dependencies = [("accounts", "0051_alter_role_name")]
    operations = [migrations.RunPython(seed, unseed)]
```

- [ ] **Step 4: Add the setting** — in `backend/ledger/settings_store.py`'s `DEFINITIONS` the key `pickup_window_hours` (Task 5) already exists; confirm it is there. Then append to `backend/ledger/verification.py`:

```python
def mark_collected(order, staff, now=None):
    """The pickup desk hands a paid store-pickup order to the customer. Idempotent: a second call keeps the first stamp."""
    from orders.models import Order

    now = now or timezone.now()
    with transaction.atomic():
        order = Order.objects.select_for_update().get(pk=order.pk)
        if order.status != Order.PAID or order.delivery_method != Order.STORE_PICKUP:
            raise VerificationError("Only a paid store-pickup order can be marked collected.")
        check = check_for(order)
        if check.collected_at is None:
            check.collected_at, check.collected_by = now, staff
            check.save(update_fields=["collected_at", "collected_by", "updated_at"])
        return check


def pickup_queue(now=None):
    """Paid store-pickup orders not yet collected, oldest first. Deliberately carries no phone number: the desk
    hands over goods, it does not call customers."""
    from orders.models import Order

    now = now or timezone.now()
    window = timedelta(hours=settings_store.current("pickup_window_hours", now))
    orders = (
        Order.objects.filter(status=Order.PAID, delivery_method=Order.STORE_PICKUP)
        .exclude(fulfilment_check__collected_at__isnull=False)
        .select_related("customer").prefetch_related("items__listing__business_owner").order_by("placed_at", "id")
    )
    return [
        {
            "order_id": order.pk, "placed_at": order.placed_at, "collect_by": order.placed_at + window,
            "overdue": now > order.placed_at + window, "customer_name": order.customer.full_name,
            "items": [
                {"name": item.listing.name, "quantity": item.quantity, "business": item.listing.business_owner.display_name}
                for item in order.items.all()
            ],
        }
        for order in orders
    ]
```

- [ ] **Step 5: Add the endpoints** — append to `backend/ledger/views.py`:

```python
class PickupQueueView(APIView):
    """GET pickup/ — store-pickup orders waiting at the office, with the time each must be collected by."""

    def get_permissions(self):
        return [HasRolePermission("pickup.confirm")]

    def get(self, request):
        return Response({"results": verification.pickup_queue()})


class PickupCollectedView(APIView):
    """POST pickup/<order id>/collected/ — the desk hands the order to the customer."""

    def get_permissions(self):
        return [HasRolePermission("pickup.confirm")]

    def post(self, request, pk):
        order = get_object_or_404(Order, pk=pk)
        try:
            check = verification.mark_collected(order, request.user)
        except verification.VerificationError as exc:
            return Response({"detail": exc.message}, status=exc.status_code)
        return Response({"order": order.pk, "collected_at": check.collected_at})
```

In `backend/ledger/urls.py` add:

```python
    path("pickup/", views.PickupQueueView.as_view(), name="ledger-pickup"),
    path("pickup/<int:pk>/collected/", views.PickupCollectedView.as_view(), name="ledger-pickup-collected"),
```

- [ ] **Step 6: Keep the existing role tests and docs true.** Read `backend/accounts/tests/test_roles_seed.py::test_all_roles_exist` and add `"pickup_desk"` to the expected set. Then find anything else that lists every role:

Run: `grep -rn "delivery_manager" backend --include=*.py | grep -v "migrations\|/tests/test_roles_seed"`
Expected: a list of places that enumerate roles (permission maps, label tables, view-as sweeps). For each one that must know every role, add `pickup_desk` the same way `dispatch` is handled (a label of "Pickup Desk"); leave places that are specific to delivery alone.

Add a row for **Pickup Desk** to `docs/STAFF_ROLES.md` (the role-count sentence, the "Roles at a glance" table and the permission matrix with `pickup.confirm`), and add `orders.verify` to the Support column of the matrix.

- [ ] **Step 7: Run the tests**

Run: `docker compose run --rm web python manage.py test ledger accounts people`
Expected: all PASS. A failure in `accounts` or `people` that names `pickup_desk` is a role enumeration from Step 6 you still need to extend.

- [ ] **Step 8: Commit**

```bash
git add backend/accounts backend/ledger docs/STAFF_ROLES.md
git commit -m "feat(ledger): Pickup Desk role, store-pickup queue and collection"
```

---
### Task 10: Subscription freeze switch

**Files:**
- Create: `backend/billing/switch.py`, `backend/billing/tests/test_subscription_freeze.py`
- Modify: `backend/listings/serializers.py` (~line 236), `backend/accounts/models.py` (`compute_registration_step`, `_scout_registration_step`), `backend/billing/views.py` (`SubscriptionPlanListView`, `SubscriptionMeView.post`, `SubscriptionStartTrialView.post`, `TransactionMineListCreateView.post`; new `BusinessKindView`), `backend/billing/urls.py`, `backend/billing/clock.py` (`tick`)

**Interfaces:**
- Produces: `billing.switch.subscriptions_enabled() -> bool`; `POST /api/billing/business-kind/` `{business_kind}` → sets the kind while subscriptions are off; `409 {"code": "subscriptions_paused"}` from every purchase path while off.
- Behaviour while `SUBSCRIPTIONS_ENABLED=False`: public plans list is `[]`; listing creation needs no active plan and has no listing cap; registration needs only a business kind (no plan); the billing clock does nothing; subscribing, renewing, and starting a trial answer 409. Default is ON, so nothing changes until the flag is flipped.

- [ ] **Step 1: Write the failing tests** — `backend/billing/tests/test_subscription_freeze.py`

```python
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, BusinessOwnerProfile
from billing import clock, switch
from billing.models import Subscription, SubscriptionPlan


class SwitchTests(TestCase):
    def test_on_by_default_and_follows_the_setting(self):
        self.assertTrue(switch.subscriptions_enabled())
        with override_settings(SUBSCRIPTIONS_ENABLED=False):
            self.assertFalse(switch.subscriptions_enabled())


@override_settings(SUBSCRIPTIONS_ENABLED=False)
class FrozenTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.owner = BusinessOwner.objects.create(full_name="Kofi", login_phone="+233207880001", password_hash="x")
        BusinessOwnerProfile.objects.create(business_owner=self.owner, business_name="Kofi Shop")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.owner, 'business_owner')}")

    def test_the_public_plan_list_is_empty(self):
        self.assertEqual(APIClient().get("/api/billing/plans/").json(), [])

    def test_subscribing_renewing_and_starting_a_trial_answer_409(self):
        plan = SubscriptionPlan.objects.filter(status=SubscriptionPlan.ACTIVE_STATUS).first()
        payload = {"plan": plan.tier, "cycle_months": 1}
        for path in ("/api/billing/subscriptions/me/", "/api/billing/subscriptions/start-trial/"):
            response = self.client.post(path, {**payload, "business_kind": plan.kind}, format="json")
            self.assertEqual(response.status_code, 409, path)
            self.assertEqual(response.json()["code"], "subscriptions_paused")

    def test_a_subscription_payment_is_refused_but_other_payments_are_not(self):
        refused = self.client.post(
            "/api/billing/transactions/mine/",
            {"kind": "subscription", "amount": "100.00", "purpose": "Plan", "metadata": {"plan": "product_basic", "cycle_months": 1}},
            format="json",
        )
        self.assertEqual(refused.status_code, 409)

    def test_business_kind_endpoint_sets_the_kind_once(self):
        response = self.client.post("/api/billing/business-kind/", {"business_kind": "product"}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        self.owner.profile.refresh_from_db()
        self.assertEqual(self.owner.profile.business_kind, "product")
        again = self.client.post("/api/billing/business-kind/", {"business_kind": "service"}, format="json")
        self.assertEqual(again.status_code, 400)

    def test_the_clock_does_nothing(self):
        self.assertEqual(clock.tick(), {"overdue": 0, "reminders": 0, "paused": 0})

    def test_registration_asks_for_a_kind_not_a_plan(self):
        complete_business_info(self.owner.profile)
        owner = BusinessOwner.objects.get(pk=self.owner.pk)
        self.assertEqual(owner.compute_registration_step(), "payment_info")      # kind set, no subscription needed

    def test_registration_still_asks_for_a_kind_when_none_is_set(self):
        complete_business_info(self.owner.profile, kind="")
        owner = BusinessOwner.objects.get(pk=self.owner.pk)
        self.assertEqual(owner.compute_registration_step(), "plan_selection")


class UnfrozenTests(TestCase):
    def test_with_the_switch_on_registration_still_needs_a_subscription(self):
        owner = BusinessOwner.objects.create(full_name="Ama", login_phone="+233207880002", password_hash="x")
        profile = BusinessOwnerProfile.objects.create(business_owner=owner, business_name="Ama")
        complete_business_info(profile)
        self.assertEqual(BusinessOwner.objects.get(pk=owner.pk).compute_registration_step(), "plan_selection")


def complete_business_info(profile, kind="product"):
    """A profile that has passed the business_info step (card, address, phone and both card photos)."""
    profile.ghana_card_number = "GHA-000000000-0"
    profile.gps_address = "AK-039-5028"
    profile.business_contact_phone = "+233207880001"
    profile.ghana_card_front_image = "front.jpg"
    profile.ghana_card_back_image = "back.jpg"
    profile.business_kind = kind
    profile.save()
```

(Notes for the implementer: the existing listing-creation suite `listings/tests/test_listing_crud.py` already contains the owner/profile/payload fixtures for `POST /api/listings/`. Add two tests there under `@override_settings(SUBSCRIPTIONS_ENABLED=False)`: one creating a listing for an owner with **no** subscription (expect 201), one for an owner whose plan cap is already met (expect 201). Copy its existing "subscription inactive" and "listing limit" tests and flip the expectation.)

- [ ] **Step 2: Run it to see it fail**

Run: `docker compose run --rm web python manage.py test billing.tests.test_subscription_freeze`
Expected: ERROR `cannot import name 'switch'`.

- [ ] **Step 3: Implement the switch** — `backend/billing/switch.py`

```python
"""The subscription switch. `settings.SUBSCRIPTIONS_ENABLED` (env, default on) turns subscriptions into a product
or pauses them: with it off nothing can be bought, renewed or trialled, plans are hidden, the billing clock stops,
and neither registration nor listing creation depends on a plan. The code and data stay so it can return."""
from django.conf import settings
from rest_framework.response import Response

PAUSED_MESSAGE = "Subscriptions are not being offered right now."


def subscriptions_enabled():
    return bool(settings.SUBSCRIPTIONS_ENABLED)


def paused_response():
    return Response({"detail": PAUSED_MESSAGE, "code": "subscriptions_paused"}, status=409)
```

- [ ] **Step 4: Guard the views and add the business-kind endpoint** — in `backend/billing/views.py`:

Add `from . import switch` with the other imports. Then:

```python
class SubscriptionPlanListView(generics.ListAPIView):
    ...
    def get_queryset(self):
        if not switch.subscriptions_enabled():
            return SubscriptionPlan.objects.none()
        return super().get_queryset()
```

At the top of `SubscriptionMeView.post` and `SubscriptionStartTrialView.post`:

```python
        if not switch.subscriptions_enabled():
            return switch.paused_response()
```

In `TransactionMineListCreateView.post`, immediately after `data = input_serializer.validated_data`:

```python
        if data["kind"] == "subscription" and not switch.subscriptions_enabled():
            return switch.paused_response()
```

Add a new view after `SubscriptionStartTrialView`:

```python
class BusinessKindView(APIView):
    """POST /api/billing/business-kind/ {business_kind} — registration's replacement for "pick a plan" while
    subscriptions are off: it records whether the business sells products or services, once."""

    permission_classes = [IsAuthenticated, IsBusinessOwner]

    def post(self, request):
        if switch.subscriptions_enabled():
            return Response({"detail": "Choose a plan to continue.", "code": "use_plan_selection"}, status=409)
        kind = request.data.get("business_kind") if isinstance(request.data, dict) else None
        if kind not in dict(BusinessOwnerProfile.BUSINESS_KIND_CHOICES):
            return Response({"business_kind": "Pick products or services."}, status=400)
        profile = request.user.profile
        if profile.business_kind:
            return Response({"business_kind": "Your business type is already set."}, status=400)
        profile.business_kind = kind
        profile.save(update_fields=["business_kind"])
        return Response({"business_kind": kind, "registration_step": request.user.compute_registration_step()})
```

(import `BusinessOwnerProfile` from `accounts.models` at the top if not already imported.)

In `backend/billing/urls.py` add: `path("business-kind/", views.BusinessKindView.as_view(), name="business-kind"),`.

- [ ] **Step 5: Stop the clock** — in `backend/billing/clock.py`, at the top of `tick`, after `now = now or timezone.now()`:

```python
    from .switch import subscriptions_enabled

    if not subscriptions_enabled():
        return {"overdue": 0, "reminders": 0, "paused": 0}
```

- [ ] **Step 6: Registration needs a kind, not a plan, while off** — in `backend/accounts/models.py`:

In `compute_registration_step`, replace

```python
        if not profile.business_kind or getattr(self, "subscription", None) is None:
            return "plan_selection"
```

with

```python
        if not profile.business_kind or (subscriptions_enabled() and getattr(self, "subscription", None) is None):
            return "plan_selection"
```

and in `_scout_registration_step`, replace `if getattr(self, "subscription", None) is None:` with `if subscriptions_enabled() and getattr(self, "subscription", None) is None:`. Add a module-level lazy helper above the class so `accounts` does not import `billing` at load time:

```python
def subscriptions_enabled():
    from billing.switch import subscriptions_enabled as enabled

    return enabled()
```

- [ ] **Step 7: Open listing creation while off** — in `backend/listings/serializers.py`, inside `validate_listing_for_owner`, change the single line `    if instance is None:` (the one directly above `subscription = getattr(owner, "subscription", None)`, ~line 236) to the line below. Nothing else in that block changes: the inactive-subscription and `max_active_listings` checks simply stop running while the switch is off.

```python
    if instance is None and subscriptions_on():
```

Then add at module level, above `validate_listing_for_owner`: 

```python
def subscriptions_on():
    from billing.switch import subscriptions_enabled

    return subscriptions_enabled()
```

- [ ] **Step 8: Run the tests**

Run: `docker compose run --rm web python manage.py test billing listings accounts payments`
Expected: all PASS (the switch defaults on, so existing suites are unchanged).

- [ ] **Step 9: Commit**

```bash
git add backend/billing backend/listings backend/accounts
git commit -m "feat(billing): SUBSCRIPTIONS_ENABLED switch; plans, purchase, clock, registration and listing gates"
```

---

### Task 11: Documentation and full verification

**Files:**
- Modify: `backend/CLAUDE.md`, `docs/superpowers/specs/2026-10-15-wallet-fees-security-design.md`, `docs/IMPLEMENTATION_INSTRUCTIONS.md` (add the stage list)

- [ ] **Step 1: Add the ledger's correctness core to `backend/CLAUDE.md`**, under "Correctness cores", one bullet:

```markdown
- **The ledger (`ledger/`) is append-only and integer-pesewa.** A balance changes only inside `ledger.posting.post`
  (balanced, idempotent on its key, accounts locked in primary-key order); Postgres triggers refuse `UPDATE`/`DELETE`
  on journals and lines, so a correction is a new reversing journal. Convert money only through `ledger.money`. Fees
  are snapshotted per order, vendor and category at payment (`OrderFeeSnapshot`): release reads the snapshot, never the
  rules now. **No timer releases a vendor's money:** `verification.record` releases on Support's positive call, after the
  goods reached the customer (rider delivery or pickup-desk collection) and the customer's receipt is confirmed. Fee rules and money settings change only through the `ledger.fee_rules` / `ledger.setting` approval kinds
  (Super Admin approves; Accounting proposes). `LEDGER_ENABLED` (default off) gates all recording, and
  `SUBSCRIPTIONS_ENABLED` (default on) must stay on until the frontend registration change (Plan 1F) ships. Held
  customer money is exactly Σ Vendor Pending + Σ Delivery payable (no order-escrow account).
```

- [ ] **Step 2: Mark the spec's status line** — change `**Status:** Design approved in conversation 2026-10-15; written spec awaiting owner review.` to `**Status:** Approved 2026-10-15. Stage 1 plan: docs/superpowers/plans/2026-10-15-ledger-fees-foundation.md.`

- [ ] **Step 3: Run the whole backend suite**

Run: `docker compose run --rm web python manage.py test`
Expected: PASS. If a failure is unrelated to this work (check with `git stash` + re-run on the failing label), report it rather than fixing it here.

- [ ] **Step 4: Run migrations check**

Run: `docker compose run --rm web python manage.py makemigrations --check --dry-run`
Expected: `No changes detected`.

- [ ] **Step 5: Commit**

```bash
git add backend/CLAUDE.md docs
git commit -m "docs(ledger): correctness core, spec status, stage index"
```

---

## What this plan deliberately does not do (later plans)

| Plan | Scope | Why separate |
|---|---|---|
| **1F** Frontend | Accounting fee/settings screens; Support "awaiting verification" screen; Pickup Desk dashboard and navigation; registration "business type" step replacing "pick a plan"; hide plan UI when the plans list is empty. | The registration change must ship before `SUBSCRIPTIONS_ENABLED` is turned off. |
| **1b** | Ledger recording and release for services, events/tickets and bookings. | Same verification flow as products; each kind needs its own definition of "handed over". |
| **2** OTP and security | One OTP service, step-up tokens, trusted devices, customer and vendor 2FA. | Independent of money; **must precede any wallet going live**. |
| **3** Wallets and payments | Customer wallet, top-up, refunds (pre- and post-release, including a customer refund after a dispute and an uncollected pickup order), withdrawals, payout destinations, provider interface and simulated provider, reconciliation. | Needs Plan 2. |
| **4** Vendor dashboard and SMS | Statements, per-order SMS, digest, cap meter. | Reads Plan 1 data. |
| **5** Third-party dispatch | `Rider` employment flag, rider wallet, 90/10 split on release, end-of-day commission job. | Needs the third-party/company distinction the code lacks. |
| **6** Offers and stock | Catalogue entries, offers, "other sellers", stock reservation upgrade, low-stock alerts. | No money logic; large UI. |
| **7** Hubtel live switch | Credentials, webhook verification run against sandbox, regulatory clearance. | Gated on external approvals. |
