"""Step-up tokens before sensitive changes (otp plan Task 8). Review Focus 5 and 7."""
from datetime import timedelta

from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwnerProfile
from otp import senders, step_up
from otp.models import OtpEvent, StepUpToken

from .helpers import last_sms_code, make_customer, make_owner

ON = override_settings(OTP_STEP_UP_ENFORCED=True)
PAYOUT = "/api/accounts/business-owners/me/payout/"
NEW_MOMO = {"default_payout_method": "momo", "payout_momo_network": "MTN", "payout_momo_number": "+233209990000", "payout_momo_name": "Kwame Mensah"}


def client_for(account, kind):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(account, kind)}")
    return client


class StepUpBase(TestCase):
    def setUp(self):
        cache.clear()
        senders.sms_outbox.clear()
        self.owner = make_owner()
        self.profile = BusinessOwnerProfile.objects.create(business_owner=self.owner, default_payout_method="momo", payout_momo_number="+233201112233")
        self.client = client_for(self.owner, "business_owner")

    def step_up(self, action=step_up.PAYOUT_DESTINATION, client=None):
        client = client or self.client
        sent = client.post("/api/otp/step-up/send/", {"action": action, "channel": "sms"}, format="json")
        self.assertEqual(sent.status_code, 200, sent.content)
        response = client.post("/api/otp/step-up/verify/", {"action": action, "code": last_sms_code()}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual((response.json()["action"], response.json()["expires_in"]), (action, 300))
        return response.json()["step_up_token"]

    def patch_payout(self, token=None, body=NEW_MOMO):
        headers = {"HTTP_X_STEP_UP_TOKEN": token} if token else {}
        return self.client.patch(PAYOUT, body, format="json", **headers)


class SwitchedOffTests(StepUpBase):
    def test_sensitive_endpoints_work_exactly_as_before(self):
        # Review Focus 7.
        self.assertEqual(self.patch_payout().status_code, 200)
        customer = client_for(make_customer(), "customer")
        self.assertEqual(customer.post("/api/accounts/customers/me/secondary-email/", {"secondary_email": "backup@example.com"}, format="json").status_code, 200)
        self.assertEqual(customer.post("/api/accounts/customers/me/secondary-phone/", {"secondary_phone": "+233245550000"}, format="json").status_code, 200)


@ON
class StepUpTests(StepUpBase):
    def test_a_payout_change_without_a_code_is_refused_and_says_which_action(self):
        response = self.patch_payout()
        self.assertEqual(response.status_code, 403)
        self.assertEqual((response.json()["code"], response.json()["action"]), ("step_up_required", "payout_destination"))
        self.profile.refresh_from_db()
        self.assertEqual(self.profile.payout_momo_number, "+233201112233")

    def test_a_code_unlocks_one_change_once(self):
        token = self.step_up()
        self.assertEqual(self.patch_payout(token).status_code, 200)
        self.profile.refresh_from_db()
        self.assertEqual(self.profile.payout_momo_number, "+233209990000")
        self.assertEqual(self.patch_payout(token).status_code, 403)
        self.assertEqual(OtpEvent.objects.filter(kind=OtpEvent.STEP_UP_USED).count(), 1)
        self.assertEqual(OtpEvent.objects.filter(kind=OtpEvent.STEP_UP_ISSUED).count(), 1)

    def test_a_token_for_another_action_is_refused(self):
        self.assertEqual(self.patch_payout(self.step_up(step_up.CONTACT_CHANGE)).status_code, 403)

    def test_a_token_works_only_with_the_access_token_it_was_issued_to(self):
        token = self.step_up()
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.owner, 'business_owner')}")
        self.assertEqual(self.patch_payout(token).status_code, 403)

    def test_a_token_lasts_five_minutes(self):
        token = self.step_up()
        StepUpToken.objects.update(expires_at=timezone.now() - timedelta(seconds=1))
        self.assertEqual(self.patch_payout(token).status_code, 403)

    def test_a_refused_change_leaves_the_token_for_the_retry(self):
        token = self.step_up()
        self.assertEqual(self.patch_payout(token, {"default_payout_method": "bank", "payout_bank_account_number": ""}).status_code, 400)
        self.assertEqual(self.patch_payout(token).status_code, 200)

    def test_only_the_hash_is_kept(self):
        token = self.step_up()
        row = StepUpToken.objects.get()
        self.assertNotEqual(row.token_hash, token)
        self.assertEqual((row.action, row.account_type, row.account_id), ("payout_destination", "business_owner", self.owner.pk))

    def test_adding_a_recovery_contact_needs_its_own_code(self):
        client = client_for(make_customer(), "customer")
        url = "/api/accounts/customers/me/secondary-email/"
        self.assertEqual(client.post(url, {"secondary_email": "backup@example.com"}, format="json").status_code, 403)
        token = self.step_up(step_up.CONTACT_CHANGE, client=client)
        self.assertEqual(client.post(url, {"secondary_email": "backup@example.com"}, format="json", HTTP_X_STEP_UP_TOKEN=token).status_code, 200)
        phone_url = "/api/accounts/customers/me/secondary-phone/"
        self.assertEqual(client.post(phone_url, {"secondary_phone": "+233245550000"}, format="json", HTTP_X_STEP_UP_TOKEN=token).status_code, 403)

    def test_bad_requests(self):
        self.assertEqual(self.client.post("/api/otp/step-up/send/", {"action": "launch_rockets", "channel": "sms"}, format="json").status_code, 400)
        self.assertEqual(self.client.post("/api/otp/step-up/send/", {"action": ["x"], "channel": "sms"}, format="json").status_code, 400)
        response = self.client.post("/api/otp/step-up/verify/", {"action": "payout_destination", "code": "123456"}, format="json")
        self.assertEqual(response.json()["code"], "code_expired")
        anonymous = APIClient()
        self.assertEqual(anonymous.post("/api/otp/step-up/send/", {"action": "payout_destination", "channel": "sms"}, format="json").status_code, 401)
