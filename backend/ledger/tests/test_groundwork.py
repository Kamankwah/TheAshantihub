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
