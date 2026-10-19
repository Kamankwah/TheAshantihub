"""Top-up hold (plan 7C Task 3): money added to a wallet waits `wallet_topup_hold_minutes` before it can be withdrawn."""
from datetime import timedelta

from django.test import TestCase, override_settings

from accounts.models import Customer
from ledger import posting
from ledger.models import Account, Journal, MoneySetting
from ledger.money import from_pesewas
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


def post_move(customer, pesewas, key, kind, *, into):
    """A wallet spend (into=False: the wallet is debited) or a refund credit (into=True), straight through clearing."""
    wallet, clearing = posting.account_for(Account.CUSTOMER_WALLET, customer), posting.account_for(Account.PROVIDER_CLEARING)
    lines = [posting.debit(clearing, pesewas), posting.credit(wallet, pesewas)] if into else [posting.debit(wallet, pesewas), posting.credit(clearing, pesewas)]
    posting.post(key=key, kind=kind, lines=lines)


@override_settings(LEDGER_ENABLED=True)
class TopupHoldBypassTests(TestCase):
    """The hold treats money as spent free-first, so spending then refunding never frees a held top-up (plan 7F-C R7)."""

    def setUp(self):
        self.customer = Customer.objects.create(full_name="Ama Owusu", phone="+233241234567", password_hash="x")
        self.dest = destination(self.customer)
        self.n = 0

    withdraw = TopupHoldTests.withdraw
    refused = TopupHoldTests.refused

    def can(self, now):
        return withdrawals.withdrawable(self.customer, now)

    def test_refund_after_spend_inside_hold_stays_held(self):
        at = topup(self.customer, 10000, "tu-1")
        post_move(self.customer, 10000, "spend-1", "order_payment", into=False)
        post_move(self.customer, 10000, "refund-1", "order_refund", into=True)
        self.assertEqual(self.can(at + timedelta(minutes=10)), 0)
        self.assertEqual(self.can(at + timedelta(minutes=59)), 0)
        self.assertEqual(self.refused(1, at + timedelta(minutes=10)).code, "topup_held")
        self.assertEqual(self.can(at + timedelta(minutes=60)), 10000)

    def test_refund_after_hold_ends_is_free(self):
        at = topup(self.customer, 10000, "tu-1")
        post_move(self.customer, 10000, "spend-1", "order_payment", into=False)
        post_move(self.customer, 10000, "refund-1", "order_refund", into=True)
        self.assertEqual(self.can(at + timedelta(minutes=61)), 10000)
        self.assertEqual(self.withdraw(10000, at + timedelta(minutes=61)).amount_pesewas, 10000)

    def test_free_plus_topup_spend_then_refund_keeps_only_the_free_part(self):
        fund(Account.CUSTOMER_WALLET, self.customer, 3000, "free-1")
        at = topup(self.customer, 5000, "tu-1")
        post_move(self.customer, 6000, "spend-1", "booking_payment", into=False)
        post_move(self.customer, 6000, "refund-1", "booking_refund", into=True)
        now = at + timedelta(minutes=10)
        self.assertEqual(self.can(now), 3000)
        self.assertEqual(self.refused(3001, now).code, "topup_held")
        self.assertEqual(self.withdraw(3000, now).amount_pesewas, 3000)

    def test_partly_spent_held_topup_does_not_overblock(self):
        at = topup(self.customer, 10000, "tu-1")
        post_move(self.customer, 7000, "spend-1", "order_payment", into=False)
        now = at + timedelta(minutes=5)
        self.assertEqual(services.held_topups(self.customer, now, 3000), (3000, at + timedelta(minutes=60)))
        self.assertEqual(services.held_topups(self.customer, now), (10000, at + timedelta(minutes=60)))
        self.assertEqual(services.summary(self.customer)["held_topup_pesewas"], 3000)  # real clock: still inside the window
        self.assertEqual(self.can(now), 0)
        # nothing left: nothing held, and no free_at to show
        self.assertEqual(services.held_topups(self.customer, now, 0), (0, None))
        self.assertEqual(services.held_topups(self.customer, now, -500), (0, None))

    def test_two_topups_free_at_is_latest(self):
        first = topup(self.customer, 4000, "tu-1")
        second = topup(self.customer, 6000, "tu-2")
        post_move(self.customer, 2500, "spend-1", "order_payment", into=False)
        now = second + timedelta(minutes=1)
        held, free_at = services.held_topups(self.customer, now, 7500)
        self.assertEqual((held, free_at), (7500, second + timedelta(minutes=60)))
        self.assertGreaterEqual(second, first)
        self.assertEqual(self.can(now), 0)

    def test_refund_is_not_itself_held_but_cannot_exceed_balance_less_hold(self):
        for kind in ("order_refund", "booking_refund"):
            customer = Customer.objects.create(full_name="Kofi Mensah", phone=f"+23324000{len(kind):04d}", password_hash="x")
            at = topup(customer, 5000, f"tu-{kind}")
            post_move(customer, 5000, f"refund-{kind}", kind, into=True)  # a refund of money paid some other way
            self.assertEqual(services.held_topups(customer, at + timedelta(minutes=1), 10000), (5000, at + timedelta(minutes=60)))
            self.assertEqual(withdrawals.withdrawable(customer, at + timedelta(minutes=1)), 5000)

    def test_refund_during_pending_withdrawal_does_not_free_hold(self):
        fund(Account.CUSTOMER_WALLET, self.customer, 3000, "free-1")
        at = topup(self.customer, 5000, "tu-1")
        now = at + timedelta(minutes=10)
        self.assertEqual(self.withdraw(3000, now).status, "pending")  # balance now 5000, all of it held
        post_move(self.customer, 5000, "spend-1", "order_payment", into=False)
        post_move(self.customer, 5000, "refund-1", "order_refund", into=True)
        self.assertEqual(self.can(now), 0)
        self.assertEqual(self.refused(1, now).code, "topup_held")

    def test_request_and_withdrawable_agree(self):
        """For amounts around the boundary, request accepts exactly what withdrawable says and quotes the same figure."""
        for index, delta in enumerate((-1, 0, 1, 2000)):
            with self.subTest(delta=delta):
                customer = Customer.objects.create(full_name="Ama Owusu", phone=f"+23325000{index:04d}", password_hash="x")
                fund(Account.CUSTOMER_WALLET, customer, 3000, f"free-{index}")
                at = topup(customer, 5000, f"tu-{index}")
                post_move(customer, 1000, f"spend-{index}", "order_payment", into=False)
                now = at + timedelta(minutes=10)
                limit = withdrawals.withdrawable(customer, now)
                self.assertEqual(limit, 2000)
                dest = destination(customer)
                amount = limit + delta
                call = lambda: withdrawals.request(customer, destination_id=dest.pk, amount_pesewas=amount, request_id=f"req-agree{index:03d}", now=now)
                if delta <= 0:
                    self.assertEqual(call().amount_pesewas, amount)
                else:
                    with self.assertRaises(withdrawals.WithdrawalError) as caught:
                        call()
                    self.assertEqual(caught.exception.code, "topup_held")
                    self.assertIn(f"GH₵ {from_pesewas(limit)} now", str(caught.exception))
