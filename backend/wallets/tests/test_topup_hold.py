"""Top-up hold (plan 7C Task 3): money added to a wallet waits `wallet_topup_hold_minutes` before it can be withdrawn."""
from datetime import timedelta

from django.test import TestCase, override_settings

from accounts.models import Customer
from ledger import posting
from ledger.models import Account, Journal, MoneySetting
from wallets import services, withdrawals

from .helpers import destination, fund


def topup(customer, pesewas, key):
    posting.post(key=key, kind="wallet_top_up", lines=[
        posting.debit(posting.account_for(Account.PROVIDER_CLEARING), pesewas),
        posting.credit(posting.account_for(Account.CUSTOMER_WALLET, customer), pesewas),
    ])
    return Journal.objects.get(key=key).created_at


@override_settings(LEDGER_ENABLED=True)
class TopupHoldTests(TestCase):
    def setUp(self):
        self.customer = Customer.objects.create(full_name="Ama Owusu", phone="+233241234567", password_hash="x")
        self.dest = destination(self.customer)
        self.n = 0

    def withdraw(self, amount, now):
        self.n += 1
        return withdrawals.request(self.customer, destination_id=self.dest.pk, amount_pesewas=amount, request_id=f"req-{self.n:08d}", now=now)

    def refused(self, amount, now):
        with self.assertRaises(withdrawals.WithdrawalError) as caught:
            self.withdraw(amount, now)
        return caught.exception

    def test_withdraw_blocked_inside_hold(self):
        at = topup(self.customer, 10000, "tu-1")
        err = self.refused(5000, at + timedelta(minutes=59))
        self.assertEqual((err.code, err.status_code), ("topup_held", 409))
        self.assertEqual(err.body()["free_at"], (at + timedelta(minutes=60)).isoformat())
        self.assertEqual(withdrawals.withdrawable(self.customer, at + timedelta(minutes=59)), 0)

    def test_allowed_at_exact_hold_end(self):
        at = topup(self.customer, 10000, "tu-1")
        self.assertEqual(self.withdraw(10000, at + timedelta(minutes=60)).amount_pesewas, 10000)

    def test_sale_proceeds_not_held(self):
        fund(Account.CUSTOMER_WALLET, self.customer, 10000, "refund-1")
        at = topup(self.customer, 5000, "tu-1")
        self.assertEqual(self.withdraw(10000, at).amount_pesewas, 10000)

    def test_partial_withdraw_of_non_held_part_allowed(self):
        fund(Account.CUSTOMER_WALLET, self.customer, 3000, "refund-1")
        at = topup(self.customer, 5000, "tu-1")
        now = at + timedelta(minutes=10)
        self.assertEqual(withdrawals.withdrawable(self.customer, now), 3000)
        self.assertEqual(self.refused(3001, now).code, "topup_held")  # total covers it, the non-held part does not
        self.assertEqual(self.withdraw(3000, now).amount_pesewas, 3000)

    def test_hold_follows_setting_change(self):
        at = topup(self.customer, 10000, "tu-1")
        now = at + timedelta(minutes=90)
        MoneySetting.objects.create(key="wallet_topup_hold_minutes", value=120, effective_from=at - timedelta(days=1))
        self.assertEqual(self.refused(5000, now).code, "topup_held")
        MoneySetting.objects.create(key="wallet_topup_hold_minutes", value=60, effective_from=at - timedelta(hours=1))
        self.assertEqual(self.withdraw(5000, now).amount_pesewas, 5000)

    def test_summary_reports_the_hold(self):
        at = topup(self.customer, 10000, "tu-1")
        held, free_at = services.held_topups(self.customer, at + timedelta(minutes=1))
        self.assertEqual((held, free_at), (10000, at + timedelta(minutes=60)))
