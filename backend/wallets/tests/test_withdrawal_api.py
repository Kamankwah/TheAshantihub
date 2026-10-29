"""Withdrawals over the API (wallets plan 3b, Task 4). Review Focus 1 (cooling), 4 (negative Available), 5 (step-up
replay) and 8 (ledger off)."""
from unittest import mock

from django.core.cache import cache
from django.test import TestCase, override_settings

from accounts.models import BusinessOwner, Customer
from ledger import posting
from ledger.models import Account
from otp import senders, step_up
from otp.tests.helpers import last_sms_code
from wallets import withdrawals
from wallets.models import Withdrawal

from .helpers import Holder, destination, fund, verify_identity

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

    def test_a_request_id_used_for_another_withdrawal_is_refused(self):
        self.assertEqual(self.ama.post(URL, self.body(request_id="req-reuse-0001"), action=step_up.WITHDRAWAL).status_code, 201)
        other = self.ama.post(URL, self.body(amount="20.00", request_id="req-reuse-0001"))
        self.assertEqual((other.status_code, other.json()["code"]), (409, "request_id_reused"))
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
        verify_identity(owner)
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


@override_settings(LEDGER_ENABLED=True)
class WithdrawalApiRobustnessTests(WithdrawalApiBase):
    def setUp(self):
        super().setUp()
        fund(Account.CUSTOMER_WALLET, self.customer, 20000, "fund-1")

    def test_same_pk_owner_does_not_see_or_touch_a_customers_withdrawals(self):
        held = withdrawals.request(self.customer, destination_id=self.dest.pk, amount_pesewas=1000, request_id="req-held-0002")
        owner = BusinessOwner.objects.create(id=self.customer.pk, full_name="Kwame Mensah", login_phone="+233201112233", password_hash="x")
        other = Holder(owner, "business_owner")
        self.assertEqual(other.get(URL).json()["count"], 0)
        self.assertEqual(other.post(f"{URL}{held.pk}/cancel/").status_code, 404)
        refused = other.post(URL, self.body(), action=step_up.WITHDRAWAL)
        self.assertEqual((refused.status_code, refused.json()["code"]), (404, "unknown_destination"))

    def test_request_id_reused_with_another_destination(self):
        self.ama.post(URL, self.body(request_id="req-reuse-0002"), action=step_up.WITHDRAWAL)
        second = destination(self.customer, number="+233241234577")
        other = self.ama.post(URL, self.body(dest=second, request_id="req-reuse-0002"))
        self.assertEqual((other.status_code, other.json()["code"]), (409, "request_id_reused"))

    def test_cancelling_twice(self):
        held = withdrawals.request(self.customer, destination_id=self.dest.pk, amount_pesewas=1000, request_id="req-held-0003")
        self.assertEqual(self.ama.post(f"{URL}{held.pk}/cancel/").status_code, 200)
        again = self.ama.post(f"{URL}{held.pk}/cancel/")
        self.assertEqual((again.status_code, again.json()["code"]), (409, "not_pending"))
        self.assertEqual(self.wallet(), 20000)

    def test_a_suspended_holder_is_refused(self):
        self.customer.is_suspended = True
        self.customer.save()
        response = self.ama.post(URL, self.body(), action=step_up.WITHDRAWAL)
        self.assertEqual(response.status_code, 403, response.content)
        self.assertEqual((self.wallet(), Withdrawal.objects.count()), (20000, 0))

    def test_a_concurrent_duplicate_with_a_spent_code_answers_the_existing_withdrawal(self):
        token = self.ama.step_up(step_up.WITHDRAWAL)
        first = self.ama.post(URL, self.body(request_id="req-race-0001"), token=token)
        real = withdrawals.existing
        calls = []

        def late(holder, request_id):  # the pre-check misses (the other request was not committed yet)
            calls.append(1)
            return None if len(calls) == 1 else real(holder, request_id)

        with mock.patch.object(withdrawals, "existing", late):
            again = self.ama.post(URL, self.body(request_id="req-race-0001"), token=token)
        self.assertEqual((again.status_code, again.json()["id"]), (200, first.json()["id"]))

    def test_a_provider_error_in_send_still_answers_201(self):
        with mock.patch("wallets.payouts.submit", side_effect=RuntimeError("boom")):
            response = self.ama.post(URL, self.body(), action=step_up.WITHDRAWAL)
        self.assertEqual((response.status_code, response.json()["status"]), (201, "pending"))
        self.assertEqual(self.wallet(), 15000)
