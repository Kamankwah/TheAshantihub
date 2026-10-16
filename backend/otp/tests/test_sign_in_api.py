"""Sign-in and sign-up with a code through the HTTP API (otp plan Task 7). Review Focus 3 and 7."""
import time
from datetime import timedelta
from unittest import mock

import pyotp
from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient, APIRequestFactory

from accounts import two_factor
from accounts.models import BusinessOwner, Customer, StaffSession
from accounts.testing import make_staff
from activity.models import ActivityEvent
from otp import senders, signin
from otp.models import SIGN_IN, OtpChallenge, VerifiedContact
from staffsecurity.models import StaffSignInRecord

from .helpers import HASHED, PASSWORD, last_email_code, last_sms_code, make_customer, make_owner, make_support, wrong_code

ON = override_settings(OTP_SIGNIN_ENFORCED=True)
SIGN_UP_ON = override_settings(OTP_SIGNUP_VERIFICATION_ENFORCED=True)
LOGIN = {
    "customer": "/api/accounts/customers/login/",
    "business_owner": "/api/accounts/business-owners/login/",
    "staff": "/api/accounts/staff/login/",
}
SIGNED_IN = {"token", "account_type", "id", "full_name"}
CHALLENGE = {"otp_required", "mfa_token", "channels"}


class SignInApiBase(TestCase):
    def setUp(self):
        cache.clear()
        senders.sms_outbox.clear()
        self.client = APIClient()
        self.customer, self.owner, self.staff = make_customer(), make_owner(), make_support()

    def login(self, kind, identifier, password=PASSWORD, **extra):
        return self.client.post(LOGIN[kind], {"identifier": identifier, "password": password, **extra}, format="json")

    def ticket(self, kind="business_owner", identifier="+233201112233", **extra):
        return self.login(kind, identifier, **extra).json()["mfa_token"]

    def send(self, mfa_token, channel="sms"):
        return self.client.post("/api/otp/sign-in/send/", {"mfa_token": mfa_token, "channel": channel}, format="json")

    def verify(self, mfa_token, code, **extra):
        return self.client.post("/api/otp/sign-in/verify/", {"mfa_token": mfa_token, "code": code, **extra}, format="json")


class SwitchedOffTests(SignInApiBase):
    def test_sign_in_and_registration_answer_exactly_as_before(self):
        # Review Focus 7.
        self.assertEqual(set(self.login("customer", "+233241234567").json()), SIGNED_IN)
        self.assertEqual(set(self.login("business_owner", "+233201112233").json()), SIGNED_IN)
        self.assertEqual(set(self.login("staff", "esi@example.com").json()), SIGNED_IN | {"role", "permissions"})
        response = self.client.post("/api/accounts/customers/register/", {"full_name": "Yaa", "phone": "+233245550000", "password": PASSWORD}, format="json")
        self.assertEqual(response.status_code, 201)
        self.assertIn("token", response.json())
        self.assertEqual(OtpChallenge.objects.count(), 0)


@ON
class VendorSignInTests(SignInApiBase):
    def test_the_password_step_answers_a_challenge_without_a_token(self):
        body = self.login("business_owner", "+233201112233").json()
        self.assertEqual(set(body), CHALLENGE)
        self.assertEqual(body["channels"], [
            {"channel": "sms", "hint": "020 *** 2233"}, {"channel": "email", "hint": "kw•••@example.com"},
        ])

    def test_a_code_by_text_finishes_signing_in(self):
        ticket = self.ticket()
        sent = self.send(ticket)
        self.assertEqual(sent.status_code, 200, sent.content)
        self.assertEqual(sent.json(), {"channel": "sms", "hint": "020 *** 2233", "expires_in": 300, "resend_in": 60})
        body = self.verify(ticket, last_sms_code()).json()
        self.assertEqual(set(body), SIGNED_IN)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {body['token']}")
        self.assertEqual(self.client.get("/api/accounts/me/").json()["account_type"], "business_owner")

    def test_a_wrong_code_then_the_right_one(self):
        ticket = self.ticket()
        self.send(ticket)
        code = last_sms_code()
        response = self.verify(ticket, wrong_code(code))
        self.assertEqual((response.status_code, response.json()["code"]), (400, "wrong_code"))
        self.assertEqual(self.verify(ticket, code).status_code, 200)

    def test_the_other_channel_recovers_a_code_that_never_arrived(self):
        ticket = self.ticket()
        self.send(ticket)
        text_code = last_sms_code()
        OtpChallenge.objects.update(last_sent_at=timezone.now() - timedelta(seconds=61))
        self.assertEqual(self.send(ticket, "email").status_code, 200)
        email_code = last_email_code()
        if text_code != email_code:
            self.assertEqual(self.verify(ticket, text_code).json()["code"], "wrong_code")
        self.assertEqual(self.verify(ticket, email_code).status_code, 200)

    def test_one_attempts_code_never_finishes_another(self):
        first, second = self.ticket(), self.ticket()
        self.send(first)
        response = self.verify(second, last_sms_code())
        self.assertEqual((response.status_code, response.json()["code"]), (400, "code_expired"))

    def test_a_bad_or_stale_ticket_is_challenge_expired(self):
        for path in ("send", "verify"):
            response = self.client.post(f"/api/otp/sign-in/{path}/", {"mfa_token": "junk", "code": "123456", "channel": "sms"}, format="json")
            self.assertEqual((response.status_code, response.json()["code"]), (400, "challenge_expired"), path)
        ticket = self.ticket()
        self.owner.is_suspended = True
        self.owner.save(update_fields=["is_suspended"])
        self.assertEqual(self.send(ticket).json()["code"], "challenge_expired")

    def test_a_stale_authorization_header_does_not_block_the_public_endpoints(self):
        ticket = self.ticket()
        self.client.credentials(HTTP_AUTHORIZATION="Bearer not-a-real-token")
        self.assertEqual(self.send(ticket).status_code, 200)

    def test_a_wrong_password_reads_the_same_whether_or_not_the_account_exists(self):
        # Review Focus 3: the switch changes nothing before the password is right.
        known = self.login("business_owner", "+233201112233", password="wrong-password-1")
        unknown = self.login("business_owner", "+233209998887", password="wrong-password-1")
        self.assertEqual((known.status_code, known.json()), (unknown.status_code, unknown.json()))


@ON
class CustomerSignInTests(SignInApiBase):
    def test_trusting_the_device_skips_the_next_code(self):
        ticket = self.ticket("customer", "+233241234567")
        self.send(ticket, "email")
        body = self.verify(ticket, last_email_code(), trust_device=True).json()
        device_token = body["device_token"]
        self.assertEqual(set(self.login("customer", "+233241234567", device_token=device_token).json()), SIGNED_IN)
        self.assertEqual(set(self.login("customer", "+233241234567").json()), CHALLENGE)

    def test_no_device_token_unless_asked_and_never_for_vendors(self):
        ticket = self.ticket("customer", "+233241234567")
        self.send(ticket)
        self.assertNotIn("device_token", self.verify(ticket, last_sms_code()).json())
        owner_ticket = self.ticket()
        self.send(owner_ticket)
        self.assertNotIn("device_token", self.verify(owner_ticket, last_sms_code(), trust_device=True).json())


@ON
class StaffSignInTests(SignInApiBase):
    def test_staff_without_an_authenticator_get_a_code_by_email(self):
        body = self.login("staff", "esi@example.com").json()
        self.assertEqual(body["channels"], [{"channel": "email", "hint": "es•••@example.com"}])
        self.send(body["mfa_token"], "email")
        signed_in = self.verify(body["mfa_token"], last_email_code()).json()
        self.assertEqual(signed_in["role"], "support")
        self.assertTrue(StaffSession.objects.get(staff=self.staff).two_factor)

    def test_a_wrong_staff_code_is_in_the_sign_in_history(self):
        ticket = self.ticket("staff", "esi@example.com")
        self.send(ticket, "email")
        self.verify(ticket, wrong_code(last_email_code()))
        self.assertTrue(StaffSignInRecord.objects.filter(kind=StaffSignInRecord.TWO_STEP_FAILED, staff=self.staff).exists())

    def test_staff_with_an_authenticator_keep_the_existing_step(self):
        secret, _ = two_factor.begin_enrolment(self.staff)
        t0 = int(time.time())
        with mock.patch("accounts.two_factor._clock", return_value=t0):
            two_factor.confirm_enrolment(self.staff, pyotp.TOTP(secret).at(t0))
        self.assertEqual(set(self.login("staff", "esi@example.com").json()), {"two_factor_required", "mfa_token"})

    def test_a_super_admin_without_one_still_sets_it_up_first(self):
        make_staff("super_admin", "boss@example.com", password_hash=HASHED)
        self.assertEqual(set(self.login("staff", "boss@example.com").json()), {"two_factor_setup_required", "mfa_token"})


@SIGN_UP_ON
class SignUpTests(SignInApiBase):
    def test_registration_holds_the_token_until_the_contact_is_confirmed(self):
        response = self.client.post("/api/accounts/customers/register/", {"full_name": "Yaa Asantewaa", "phone": "0245550000", "password": PASSWORD}, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        body = response.json()
        self.assertNotIn("token", body)
        self.assertTrue(body["otp_required"])
        self.send(body["mfa_token"])
        self.assertIn("token", self.verify(body["mfa_token"], last_sms_code()).json())
        yaa = Customer.objects.get(full_name="Yaa Asantewaa")
        self.assertTrue(VerifiedContact.objects.filter(account_type="customer", account_id=yaa.pk, destination="+233245550000").exists())

    def test_a_business_registration_does_too(self):
        response = self.client.post("/api/accounts/business-owners/register/", {"full_name": "Kofi Boateng", "login_phone": "+233207770000", "password": PASSWORD}, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        self.assertNotIn("token", response.json())
        self.assertTrue(response.json()["otp_required"])

    def test_an_existing_unverified_customer_confirms_at_the_next_sign_in(self):
        body = self.login("customer", "+233241234567").json()
        self.assertTrue(body["otp_required"])
        self.send(body["mfa_token"])
        self.assertIn("token", self.verify(body["mfa_token"], last_sms_code()).json())
        self.assertIn("token", self.login("customer", "+233241234567").json())


class NoUsableChannelTests(SignInApiBase):
    NO_CHANNEL = {"detail": "We have no phone or email on file to send a code to. Contact Support.", "code": "no_channel"}

    def test_a_customer_with_only_a_foreign_phone_gets_no_ticket(self):
        Customer.objects.create(full_name="Kojo", phone="+447700900123", email="", password_hash=HASHED)
        with ON:
            response = self.login("customer", "+447700900123")
        self.assertEqual((response.status_code, response.json()), (409, self.NO_CHANNEL))

    def test_an_owner_with_no_usable_contact_gets_no_ticket(self):
        BusinessOwner.objects.create(full_name="Yaw", login_phone="+447700900124", email="", password_hash=HASHED)
        with ON:
            response = self.login("business_owner", "+447700900124")
        self.assertEqual((response.status_code, response.json()), (409, self.NO_CHANNEL))

    def test_with_the_switch_off_nothing_changes(self):
        Customer.objects.create(full_name="Kojo", phone="+447700900123", email="", password_hash=HASHED)
        self.assertEqual(set(self.login("customer", "+447700900123").json()), SIGNED_IN)


@ON
class StaffOrderingTests(SignInApiBase):
    def test_a_code_ticket_is_refused_for_staff_who_owe_the_authenticator(self):
        secret, _ = two_factor.begin_enrolment(self.staff)
        t0 = int(time.time())
        with mock.patch("accounts.two_factor._clock", return_value=t0):
            two_factor.confirm_enrolment(self.staff, pyotp.TOTP(secret).at(t0))
        self.assertEqual(set(self.login("staff", "esi@example.com").json()), {"two_factor_required", "mfa_token"})
        forged = signin.make_ticket(self.staff, signin.CODE_STAGE, SIGN_IN)
        self.assertIsNone(signin.read_ticket(forged, signin.CODE_STAGE))
        self.assertEqual(self.send(forged, "email").json()["code"], "challenge_expired")

    def test_a_code_ticket_is_refused_for_staff_who_owe_enrolment(self):
        boss = make_staff("super_admin", "boss@example.com", password_hash=HASHED)
        forged = signin.make_ticket(boss, signin.CODE_STAGE, SIGN_IN)
        self.assertIsNone(signin.read_ticket(forged, signin.CODE_STAGE))


class SignedInBodyTests(SignInApiBase):
    """signed_in_body must equal what the existing login views answer with the switches off."""

    def same_shape(self, kind, identifier, account):
        existing = self.login(kind, identifier).json()
        request = APIRequestFactory().post("/x/")
        body = signin.signed_in_body(account, request)
        self.assertEqual(set(body), set(existing))
        for key in existing:
            if key != "token":
                self.assertEqual(body[key], existing[key], key)
        self.assertTrue(body["token"])

    def test_customer(self):
        self.same_shape("customer", "+233241234567", self.customer)

    def test_business_owner(self):
        self.same_shape("business_owner", "+233201112233", self.owner)

    def test_staff_records_the_same_history_as_the_existing_path(self):
        existing = self.login("staff", "esi@example.com").json()
        body = signin.signed_in_body(self.staff, APIRequestFactory().post("/x/"))
        self.assertEqual(set(body), set(existing))
        for key in existing:
            if key != "token":
                self.assertEqual(body[key], existing[key], key)
        self.assertEqual(StaffSignInRecord.objects.filter(kind=StaffSignInRecord.SIGNED_IN, staff=self.staff).count(), 2)
        self.assertEqual(ActivityEvent.objects.filter(verb="staff.signed_in").count(), 2)
        self.assertEqual(StaffSession.objects.filter(staff=self.staff).count(), 2)
