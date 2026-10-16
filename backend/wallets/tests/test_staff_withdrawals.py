"""Staff and withdrawals (wallets plan 3b, Task 5): the list (wallets.view) and failing a stuck one (wallets.manage and
the password again; the provider is asked first). Review Focus 3 (a late "paid" after staff failed it, a provider
answer or an amount case stops a hand fail) and 6 (no number in the activity log)."""
from datetime import timedelta
from unittest import mock

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
from wallets import payouts, views_staff, withdrawals
from wallets.models import Withdrawal

from .helpers import destination, fund

URL = "/api/wallet/staff/withdrawals/"


# The provider has not answered unless a test says so: failing by hand asks it first, and "succeed" would settle it.
@override_settings(LEDGER_ENABLED=True, SIMULATED_PAYOUT_OUTCOME="pending")
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
        """A withdrawal the provider has not answered (the class runs with SIMULATED_PAYOUT_OUTCOME=pending), sent 31
        minutes ago."""
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
        self.assertEqual((response.json()["status"], response.json()["failure_reason"]), ("failed", views_staff.STAFF_FAILED_REASON))
        self.assertEqual(self.wallet(), 20000)
        self.assertEqual(posting.balance_of(Account.WITHDRAWAL_IN_TRANSIT), 0)
        event = ActivityEvent.objects.get(verb="wallets.withdrawal_failed")
        self.assertEqual(
            (event.before, event.after["status"], event.after["reason"]), ({"status": "processing"}, "failed", "Hubtel says it never left"),
        )                                                                                         # the staff reason stays here only
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

    def test_a_withdrawal_the_provider_has_answered_is_settled_not_failed(self):
        withdrawal = self.sent()
        self.as_staff(self.accountant, sudo=True)
        with override_settings(SIMULATED_PAYOUT_OUTCOME="succeed"):                               # it did pay after all
            response = self.force_fail(withdrawal)
        self.assertEqual((response.status_code, response.json()["code"], response.json()["status"]), (409, "provider_answered", "succeeded"))
        self.assertTrue(Journal.objects.filter(key=f"withdrawal-paid-{withdrawal.reference}").exists())
        self.assertEqual(self.wallet(), 15000)                                                    # paid out, never credited back
        self.assertFalse(ActivityEvent.objects.filter(verb="wallets.withdrawal_failed").exists())

    def test_a_withdrawal_with_an_open_amount_case_is_never_failed_by_hand(self):
        withdrawal = self.sent()
        payouts.apply_result(withdrawal.reference, providers.SUCCEEDED, amount_pesewas=4000)      # money did leave
        self.as_staff(self.accountant, sudo=True)
        response = self.force_fail(withdrawal)
        self.assertEqual((response.status_code, response.json()["code"]), (409, "amount_case_open"))
        withdrawal.refresh_from_db()
        self.assertEqual((withdrawal.status, self.wallet()), (Withdrawal.PROCESSING, 15000))

    def resolved_case(self, withdrawal, outcome):
        """The provider reported a different amount (a case opens), then fraud staff resolved it."""
        payouts.apply_result(withdrawal.reference, providers.SUCCEEDED, amount_pesewas=4000)
        flag = FraudFlag.objects.get(dedupe_key=f"withdrawal-amount-{withdrawal.reference}")
        self.assertEqual(flag.status, FraudFlag.OPEN)
        FraudFlag.objects.filter(pk=flag.pk).update(status=outcome)

    def test_an_open_amount_case_returns_nothing_and_logs_nothing(self):
        withdrawal = self.sent()
        payouts.apply_result(withdrawal.reference, providers.SUCCEEDED, amount_pesewas=4000)
        self.as_staff(self.accountant, sudo=True)
        self.force_fail(withdrawal)
        self.assertFalse(Journal.objects.filter(kind="withdrawal_reversed").exists())
        self.assertFalse(ActivityEvent.objects.filter(verb="wallets.withdrawal_failed").exists())

    def test_a_case_opened_after_the_view_looked_is_caught_inside_the_lock(self):
        """close() refuses it too, and the view answers 409 instead of claiming it failed."""
        withdrawal = self.sent()
        payouts.apply_result(withdrawal.reference, providers.SUCCEEDED, amount_pesewas=4000)
        self.as_staff(self.accountant, sudo=True)
        with mock.patch.object(views_staff, "amount_case_open", return_value=False):
            response = self.force_fail(withdrawal)
        self.assertEqual((response.status_code, response.json()["code"]), (409, "amount_case_open"))
        withdrawal.refresh_from_db()
        self.assertEqual((withdrawal.status, self.wallet()), (Withdrawal.PROCESSING, 15000))
        self.assertFalse(ActivityEvent.objects.filter(verb="wallets.withdrawal_failed").exists())

    def test_a_resolved_amount_case_leaves_staff_a_way_out_and_money_returns_once(self):
        for outcome in (FraudFlag.CONFIRMED, FraudFlag.DISMISSED):
            with self.subTest(outcome=outcome):
                cache.clear()
                withdrawal = self.sent(request_id=f"req-{outcome}-0001")
                self.resolved_case(withdrawal, outcome)
                self.as_staff(self.accountant, sudo=True)
                before = self.wallet()
                response = self.force_fail(withdrawal)
                self.assertEqual(response.status_code, 200, response.content)
                self.assertEqual(response.json()["status"], "failed")
                self.assertEqual(self.wallet(), before + 5000)
                self.assertEqual(self.force_fail(withdrawal).status_code, 409)                  # a second try is not stuck any more
                self.assertEqual(self.wallet(), before + 5000)
                self.assertEqual(Journal.objects.filter(key=f"withdrawal-reversed-{withdrawal.reference}").count(), 1)

    def test_a_resolved_case_with_the_provider_saying_paid_is_recorded_paid_not_returned(self):
        withdrawal = self.sent()
        self.resolved_case(withdrawal, FraudFlag.CONFIRMED)
        self.as_staff(self.accountant, sudo=True)
        with override_settings(SIMULATED_PAYOUT_OUTCOME="succeed"):
            response = self.force_fail(withdrawal)
        self.assertEqual((response.status_code, response.json()["code"], response.json()["status"]), (409, "provider_answered", "succeeded"))
        self.assertTrue(Journal.objects.filter(key=f"withdrawal-paid-{withdrawal.reference}").exists())
        self.assertFalse(Journal.objects.filter(kind="withdrawal_reversed").exists())
        self.assertEqual(self.wallet(), 15000)

    def test_the_holder_sees_the_fixed_text_never_the_staff_reason(self):
        withdrawal = self.sent()
        self.as_staff(self.accountant, sudo=True)
        self.force_fail(withdrawal, reason="secret staff note")
        withdrawal.refresh_from_db()
        self.assertEqual(withdrawal.failure_reason, views_staff.STAFF_FAILED_REASON)
        self.assertNotIn("secret", withdrawal.failure_reason)


class StaffWithdrawalLedgerOffTests(TestCase):
    def test_it_says_ledger_off(self):
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(make_staff('accountant', 'kofi@example.com'), sudo=True)}")
        self.assertEqual(client.get(URL).json()["code"], "ledger_off")
        self.assertEqual(client.post(f"{URL}1/fail/", {"reason": "x"}, format="json").json()["code"], "ledger_off")
