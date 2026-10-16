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
from wallets.models import PayoutDestination, Withdrawal

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

    def test_a_failed_payout_returns_the_money_and_never_repeats_the_providers_words(self):
        def refused(provider, **kwargs):
            return providers.PayoutResult(providers.FAILED, message=f"Invalid account {kwargs['account_number']}")

        with mock.patch.object(providers.SimulatedProvider, "payout", refused):
            failed = payouts.submit(self.withdraw(5000).pk)
        self.assertEqual((failed.status, failed.failure_reason), (Withdrawal.FAILED, payouts.FAILED_REASON))
        self.assertEqual((self.wallet(), self.transit()), (20000, 0))
        self.assertTrue(Journal.objects.filter(key=f"withdrawal-reversed-{failed.reference}").exists())
        self.assertNotIn("241234567", Notification.objects.filter(customer=self.customer).latest("id").body)

    def test_a_payout_answer_for_a_different_amount_is_not_applied(self):
        def short(provider, **kwargs):
            return providers.PayoutResult(
                providers.SUCCEEDED, provider_reference=f"SIM-{kwargs['reference']}", amount_pesewas=kwargs["amount_pesewas"] - 100,
            )

        with mock.patch.object(providers.SimulatedProvider, "payout", short):
            sent = payouts.submit(self.withdraw(5000).pk)
        self.assertEqual(sent.status, Withdrawal.PROCESSING)
        self.assertFalse(Journal.objects.filter(kind="withdrawal_paid").exists())
        self.assertEqual(self.transit(), 5000)
        self.assertTrue(FraudFlag.objects.filter(dedupe_key=f"withdrawal-amount-{sent.reference}").exists())

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

    def test_one_withdrawal_that_cannot_be_settled_does_not_stop_the_poll(self):
        with override_settings(SIMULATED_PAYOUT_OUTCOME="pending"):
            first = payouts.submit(self.withdraw(5000).pk)
            second = payouts.submit(self.withdraw(5000).pk)
        Withdrawal.objects.filter(pk__in=[first.pk, second.pk]).update(submitted_at=timezone.now() - timedelta(minutes=3))
        real = providers.SimulatedProvider.status

        def broken_for_first(provider, reference):
            if reference == first.reference:
                raise RuntimeError("a bad row")
            return real(provider, reference)

        with mock.patch.object(providers.SimulatedProvider, "status", broken_for_first):
            self.assertEqual(payouts.poll(), 1)
        first.refresh_from_db()
        second.refresh_from_db()
        self.assertEqual((first.status, second.status), (Withdrawal.PROCESSING, Withdrawal.SUCCEEDED))

    def test_a_held_withdrawal_is_not_sent_once_the_holder_is_suspended_or_the_destination_removed(self):
        held = self.withdraw(5000)
        Customer.objects.filter(pk=self.customer.pk).update(is_suspended=True)
        self.assertEqual(payouts.submit(held.pk).status, Withdrawal.CANCELLED)
        self.assertEqual((self.wallet(), self.transit()), (20000, 0))
        Customer.objects.filter(pk=self.customer.pk).update(is_suspended=False)
        other = self.withdraw(5000)
        PayoutDestination.objects.filter(pk=self.dest.pk).update(removed_at=timezone.now())
        self.assertEqual(payouts.submit(other.pk).status, Withdrawal.CANCELLED)
        self.assertEqual((self.wallet(), self.transit()), (20000, 0))
        self.assertFalse(Journal.objects.filter(kind="withdrawal_paid").exists())

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
        self.assertTrue(FraudFlag.objects.filter(dedupe_key=f"withdrawal-late-failed-{sent.reference}").exists())

    def test_a_report_for_a_withdrawal_never_sent_is_not_applied(self):
        held = self.withdraw(5000)
        payouts.apply_result(held.reference, providers.SUCCEEDED, amount_pesewas=5000)
        held.refresh_from_db()
        self.assertEqual(held.status, Withdrawal.PENDING)
        self.assertFalse(Journal.objects.filter(kind="withdrawal_paid").exists())
        self.assertEqual(self.transit(), 5000)
        self.assertEqual(FraudFlag.objects.filter(dedupe_key=f"withdrawal-unsent-report-{held.reference}").count(), 1)

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

    def test_a_failed_report_carrying_zero_returns_the_hold_without_a_case(self):
        with override_settings(SIMULATED_PAYOUT_OUTCOME="pending"):
            sent = payouts.submit(self.withdraw(5000).pk)
        payouts.apply_result(sent.reference, providers.FAILED, amount_pesewas=0)
        sent.refresh_from_db()
        self.assertEqual((sent.status, self.wallet(), self.transit()), (Withdrawal.FAILED, 20000, 0))
        self.assertFalse(FraudFlag.objects.filter(dedupe_key=f"withdrawal-amount-{sent.reference}").exists())

    def test_a_failed_report_carrying_a_non_zero_amount_still_opens_the_case(self):
        with override_settings(SIMULATED_PAYOUT_OUTCOME="pending"):
            sent = payouts.submit(self.withdraw(5000).pk)
        payouts.apply_result(sent.reference, providers.FAILED, amount_pesewas=3000)
        sent.refresh_from_db()
        self.assertEqual((sent.status, self.transit()), (Withdrawal.PROCESSING, 5000))
        self.assertTrue(FraudFlag.objects.filter(dedupe_key=f"withdrawal-amount-{sent.reference}").exists())

    def test_a_vendor_withdrawal_case_appears_on_the_business_and_a_customers_has_none(self):
        owner = BusinessOwner.objects.create(
            full_name="Kwame Mensah", login_phone="+233201112233", password_hash="x", kyc_status=BusinessOwner.VERIFIED,
        )
        dest = destination(owner, number="+233201112233", name="Kwame Mensah")
        fund(Account.VENDOR_AVAILABLE, owner, 20000, "fund-vendor")
        with override_settings(SIMULATED_PAYOUT_OUTCOME="pending"):
            held = withdrawals.request(owner, destination_id=dest.pk, amount_pesewas=5000, request_id="req-vendor-0001")
            sent = payouts.submit(held.pk)
        payouts.apply_result(sent.reference, providers.SUCCEEDED, amount_pesewas=4000)
        flag = FraudFlag.objects.get(dedupe_key=f"withdrawal-amount-{sent.reference}")
        self.assertEqual(flag.business_owner, owner)
        mine = self.withdraw(5000)
        with override_settings(SIMULATED_PAYOUT_OUTCOME="pending"):
            mine = payouts.submit(mine.pk)
        payouts.apply_result(mine.reference, providers.SUCCEEDED, amount_pesewas=4000)
        self.assertIsNone(FraudFlag.objects.get(dedupe_key=f"withdrawal-amount-{mine.reference}").business_owner)

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
class EngineFixRoundTests(TestCase):
    def setUp(self):
        self.customer = Customer.objects.create(full_name="Ama Owusu", phone="+233241234567", password_hash="x")
        self.dest = destination(self.customer)
        fund(Account.CUSTOMER_WALLET, self.customer, 20000, "fund-1")
        self.n = 0

    def withdraw(self, amount=5000):
        self.n += 1
        return withdrawals.request(self.customer, destination_id=self.dest.pk, amount_pesewas=amount, request_id=f"req-fix-{self.n:06d}")

    def wallet(self):
        return posting.balance_of(Account.CUSTOMER_WALLET, self.customer)

    def transit(self):
        return posting.balance_of(Account.WITHDRAWAL_IN_TRANSIT)

    def sent_pending(self):
        with override_settings(SIMULATED_PAYOUT_OUTCOME="pending"):
            return payouts.submit(self.withdraw().pk)

    def test_an_open_amount_case_freezes_settlement_whatever_the_next_report_says(self):
        def short(provider, **kwargs):
            return providers.PayoutResult(providers.SUCCEEDED, amount_pesewas=4000)

        with mock.patch.object(providers.SimulatedProvider, "payout", short):
            sent = payouts.submit(self.withdraw().pk)
        self.assertEqual(sent.status, Withdrawal.PROCESSING)
        payouts.apply_result(sent.reference, providers.FAILED)                                 # no amount
        payouts.apply_result(sent.reference, providers.SUCCEEDED)
        payouts.apply_result(sent.reference, providers.SUCCEEDED, amount_pesewas=5000)
        sent.refresh_from_db()
        self.assertEqual(sent.status, Withdrawal.PROCESSING)
        self.assertEqual((self.wallet(), self.transit()), (15000, 5000))
        self.assertFalse(Journal.objects.filter(kind__in=["withdrawal_reversed", "withdrawal_paid"]).exists())

    def test_submit_inside_a_transaction_fails_loudly_and_sends_nothing(self):
        held = self.withdraw()
        with mock.patch.object(providers.SimulatedProvider, "payout") as payout:
            with self.assertRaises(RuntimeError):
                with transaction.atomic():
                    payouts.submit(held.pk)
        payout.assert_not_called()

    def test_a_send_that_times_out_stays_with_the_provider_and_the_poll_only_asks(self):
        held = self.withdraw()
        with mock.patch.object(providers.SimulatedProvider, "payout", side_effect=TimeoutError("account 0241234567 timed out")):
            sent = payouts.submit(held.pk)
        self.assertEqual(sent.status, Withdrawal.PROCESSING)
        self.assertEqual(self.transit(), 5000)
        self.assertFalse(Journal.objects.filter(kind="withdrawal_reversed").exists())
        Withdrawal.objects.filter(pk=sent.pk).update(submitted_at=timezone.now() - timedelta(minutes=3))
        with mock.patch.object(providers.SimulatedProvider, "payout") as payout:
            self.assertEqual(payouts.poll(), 1)
        payout.assert_not_called()
        sent.refresh_from_db()
        self.assertEqual(sent.status, Withdrawal.SUCCEEDED)

    def test_a_provider_that_cannot_pay_out_returns_the_hold_at_once(self):
        with mock.patch.object(providers.SimulatedProvider, "payout", side_effect=providers.NotConnected("no payouts")):
            failed = payouts.submit(self.withdraw().pk)
        self.assertEqual(failed.status, Withdrawal.FAILED)
        self.assertEqual((self.wallet(), self.transit()), (20000, 0))
        self.assertEqual(Journal.objects.filter(kind="withdrawal_reversed").count(), 1)
        self.assertEqual(payouts.poll(), 0)
        self.assertEqual(Journal.objects.filter(kind="withdrawal_reversed").count(), 1)

    def test_a_held_withdrawal_is_rechecked_before_it_is_sent_late(self):
        held = self.withdraw()
        PayoutDestination.objects.filter(pk=self.dest.pk).update(usable_from=timezone.now() + timedelta(hours=1))
        self.assertEqual(payouts.submit(held.pk).status, Withdrawal.CANCELLED)
        self.assertEqual((self.wallet(), self.transit()), (20000, 0))
        PayoutDestination.objects.filter(pk=self.dest.pk).update(usable_from=timezone.now() - timedelta(hours=1))
        other = self.withdraw()
        Customer.objects.filter(pk=self.customer.pk).update(full_name="Akosua Mensah")
        self.assertEqual(payouts.submit(other.pk).status, Withdrawal.CANCELLED)
        self.assertEqual((self.wallet(), self.transit()), (20000, 0))
        self.assertEqual(Journal.objects.filter(kind="withdrawal_reversed").count(), 2)
        self.assertFalse(Journal.objects.filter(kind="withdrawal_paid").exists())

    def test_a_vendor_who_lost_kyc_is_not_paid_by_a_late_send(self):
        owner = BusinessOwner.objects.create(
            full_name="Kwame Mensah", login_phone="+233201112233", password_hash="x", kyc_status=BusinessOwner.VERIFIED,
        )
        to_kwame = destination(owner, number="+233201112233", name="Kwame Mensah")
        fund(Account.VENDOR_AVAILABLE, owner, 5000, "fund-vendor")
        held = withdrawals.request(owner, destination_id=to_kwame.pk, amount_pesewas=3000, request_id="req-kyc-0001")
        BusinessOwner.objects.filter(pk=owner.pk).update(kyc_status=BusinessOwner.PENDING)
        self.assertEqual(payouts.submit(held.pk).status, Withdrawal.CANCELLED)
        self.assertEqual(posting.balance_of(Account.VENDOR_AVAILABLE, owner), 5000)

    def test_a_paid_report_without_an_amount_is_not_settled_unless_simulated(self):
        sent = self.sent_pending()
        Withdrawal.objects.filter(pk=sent.pk).update(provider="hubtel")
        payouts.apply_result(sent.reference, providers.SUCCEEDED)
        sent.refresh_from_db()
        self.assertEqual(sent.status, Withdrawal.PROCESSING)
        self.assertTrue(FraudFlag.objects.filter(dedupe_key=f"withdrawal-amount-{sent.reference}").exists())
        self.assertFalse(Journal.objects.filter(kind="withdrawal_paid").exists())

    def test_a_processing_answer_keeps_the_providers_reference(self):
        answer = providers.PayoutResult(providers.PROCESSING, provider_reference="HUB-123")
        with mock.patch.object(providers.SimulatedProvider, "payout", return_value=answer):
            sent = payouts.submit(self.withdraw().pk)
        self.assertEqual((sent.status, sent.provider_reference), (Withdrawal.PROCESSING, "HUB-123"))

    def test_a_negative_provider_charge_is_refused(self):
        with mock.patch.object(providers.SimulatedProvider, "payout_charge", return_value=-5):
            with self.assertRaises(withdrawals.WithdrawalError) as caught:
                self.withdraw()
        self.assertEqual(caught.exception.code, "payouts_unavailable")
        self.assertEqual(Withdrawal.objects.count(), 0)

    def test_the_providers_message_is_not_in_the_results_repr(self):
        self.assertNotIn("0241234567", repr(providers.PayoutResult(providers.FAILED, message="Invalid account 0241234567")))

    def test_settled_at_is_the_real_time_not_the_polls_start(self):
        past = timezone.now() - timedelta(days=2)
        paid = payouts.submit(self.withdraw().pk, now=past)
        self.assertGreater(paid.settled_at, past + timedelta(days=1))
        self.assertGreater(paid.submitted_at, past + timedelta(days=1))


    def flagged_short(self):
        def short(provider, **kwargs):
            return providers.PayoutResult(providers.SUCCEEDED, amount_pesewas=4000)

        with mock.patch.object(providers.SimulatedProvider, "payout", short):
            return payouts.submit(self.withdraw().pk)

    def test_close_refuses_a_withdrawal_with_an_open_amount_case(self):
        sent = self.flagged_short()
        with transaction.atomic():
            locked = Withdrawal.objects.select_for_update().get(pk=sent.pk)
            payouts.close(locked, Withdrawal.FAILED, "Staff failed it.", timezone.now())
        sent.refresh_from_db()
        self.assertEqual(sent.status, Withdrawal.PROCESSING)
        self.assertEqual((self.wallet(), self.transit()), (15000, 5000))
        self.assertFalse(Journal.objects.filter(kind="withdrawal_reversed").exists())
        self.assertEqual(payouts._unsent(sent).status, Withdrawal.PROCESSING)                 # the NotConnected path too

    def test_the_poll_leaves_a_withdrawal_that_ever_had_an_amount_case_to_staff(self):
        sent = self.flagged_short()
        FraudFlag.objects.filter(dedupe_key=f"withdrawal-amount-{sent.reference}").update(status=FraudFlag.DISMISSED)
        Withdrawal.objects.filter(pk=sent.pk).update(submitted_at=timezone.now() - timedelta(minutes=3))
        with mock.patch.object(providers.SimulatedProvider, "status") as status:
            self.assertEqual(payouts.poll(), 0)
        status.assert_not_called()
        self.assertEqual(FraudFlag.objects.filter(dedupe_key=f"withdrawal-amount-{sent.reference}").count(), 1)
        sent.refresh_from_db()
        self.assertEqual(sent.status, Withdrawal.PROCESSING)

    def test_any_other_send_failure_keeps_the_withdrawal_processing(self):
        with mock.patch.object(providers.SimulatedProvider, "payout", side_effect=ConnectionError("reset after the request")):
            sent = payouts.submit(self.withdraw().pk)
        self.assertEqual(sent.status, Withdrawal.PROCESSING)
        self.assertEqual((self.wallet(), self.transit()), (15000, 5000))
        self.assertFalse(Journal.objects.filter(kind="withdrawal_reversed").exists())


@override_settings(LEDGER_ENABLED=True)
class ConcurrentWithdrawalTests(TransactionTestCase):
    serialized_rollback = True

    def setUp(self):
        self.customer = Customer.objects.create(full_name="Ama Owusu", phone="+233241234567", password_hash="x")
        self.dest = destination(self.customer)
        fund(Account.CUSTOMER_WALLET, self.customer, 10000, "fund-1")

    def hold(self, amount, request_id, dest=None):
        with transaction.atomic():
            return withdrawals.request(self.customer, destination_id=(dest or self.dest).pk, amount_pesewas=amount, request_id=request_id)

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
        # Two destinations, so the destination row lock does not serialise them: the account lock (posting.lock) must.
        to = [self.dest, destination(self.customer, number="+233241234599")]
        results = self.race(lambda i: self.hold(10000, f"req-race-{i:04d}", to[i]).status)
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
        calls, in_atomic, real = [], [], providers.SimulatedProvider.payout

        def counting(provider, **kwargs):
            calls.append(kwargs["reference"])
            in_atomic.append(connection.in_atomic_block)
            return real(provider, **kwargs)

        with mock.patch.object(providers.SimulatedProvider, "payout", counting):
            self.race(lambda i: payouts.submit(held.pk).status)
        self.assertEqual(calls, [held.reference])
        self.assertEqual(in_atomic, [False])                                                   # never sent inside a transaction
        self.assertEqual(Journal.objects.filter(kind="withdrawal_paid").count(), 1)
