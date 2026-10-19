"""Authenticator-app sign-in for customers and business owners (otp plan Task 9). Review Focus 2."""
import time
from unittest import mock

import pyotp
from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.testing import staff_token
from accounts.two_factor import encrypt_secret
from otp import authenticator, devices, senders
from otp.models import AccountAuthenticator, OtpEvent

from .helpers import PASSWORD, last_sms_code, make_customer, make_owner, make_support, wrong_code

ON = override_settings(OTP_SIGNIN_ENFORCED=True)


class AuthenticatorBase(TestCase):
    def setUp(self):
        cache.clear()
        senders.sms_outbox.clear()
        self.t0 = int(time.time())
        self.owner = make_owner()
        self.client = APIClient()
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.owner, 'business_owner')}")

    def clock(self, offset=0):
        return mock.patch("accounts.two_factor._clock", return_value=self.t0 + offset)

    def step_up(self):
        self.client.post("/api/otp/step-up/send/", {"action": "authenticator_change", "channel": "sms"}, format="json")
        response = self.client.post("/api/otp/step-up/verify/", {"action": "authenticator_change", "code": last_sms_code()}, format="json")
        return response.json()["step_up_token"]

    def turn_on(self):
        """Enrol through the API; returns (secret, recovery codes)."""
        secret = self.client.post("/api/otp/authenticator/setup/", HTTP_X_STEP_UP_TOKEN=self.step_up()).json()["secret"]
        with self.clock():
            response = self.client.post("/api/otp/authenticator/setup/confirm/", {"code": pyotp.TOTP(secret).at(self.t0)}, format="json")
        return secret, response.json()["recovery_codes"]

    def password_step(self):
        return APIClient().post("/api/accounts/business-owners/login/", {"identifier": "+233201112233", "password": PASSWORD}, format="json").json()

    def finish(self, mfa_token, **body):
        return APIClient().post("/api/otp/sign-in/verify/", {"mfa_token": mfa_token, **body}, format="json")


class SetupTests(AuthenticatorBase):
    def test_it_is_not_offered_while_sign_in_codes_are_off(self):
        response = self.client.post("/api/otp/authenticator/setup/")
        self.assertEqual((response.status_code, response.json()["code"]), (409, "otp_off"))
        self.assertFalse(self.client.get("/api/otp/authenticator/").json()["available"])

    @ON
    def test_setting_it_up_needs_a_step_up_code_even_with_step_up_switched_off(self):
        response = self.client.post("/api/otp/authenticator/setup/")
        self.assertEqual((response.status_code, response.json()["code"]), (403, "step_up_required"))

    @ON
    def test_turning_it_on_gives_ten_recovery_codes_and_keeps_the_secret_encrypted(self):
        secret, codes = self.turn_on()
        self.assertEqual(len(codes), 10)
        self.assertNotIn(secret, AccountAuthenticator.objects.get().secret_encrypted)
        self.assertTrue(authenticator.is_enabled(self.owner))
        self.assertTrue(OtpEvent.objects.filter(kind=OtpEvent.AUTHENTICATOR_ON).exists())
        self.assertTrue(self.client.get("/api/otp/authenticator/").json()["enabled"])

    @ON
    def test_a_wrong_first_code_turns_nothing_on(self):
        secret = self.client.post("/api/otp/authenticator/setup/", HTTP_X_STEP_UP_TOKEN=self.step_up()).json()["secret"]
        with self.clock():
            response = self.client.post("/api/otp/authenticator/setup/confirm/", {"code": wrong_code(pyotp.TOTP(secret).at(self.t0))}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertFalse(authenticator.is_enabled(self.owner))

    def test_staff_use_their_own_endpoints(self):
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(make_support())}")
        self.assertEqual(client.get("/api/otp/authenticator/").status_code, 403)


@ON
class SignInTests(AuthenticatorBase):
    def test_it_replaces_the_code_at_sign_in(self):
        secret, _ = self.turn_on()
        body = self.password_step()
        self.assertEqual(set(body), {"two_factor_required", "mfa_token"})
        with self.clock(30):
            response = self.finish(body["mfa_token"], code=pyotp.TOTP(secret).at(self.t0 + 30))
        self.assertEqual(response.status_code, 200, response.content)
        self.assertIn("token", response.json())

    def test_no_authenticator_code_works_twice(self):
        secret, _ = self.turn_on()
        code = pyotp.TOTP(secret).at(self.t0 + 30)
        with self.clock(30):
            self.assertEqual(self.finish(self.password_step()["mfa_token"], code=code).status_code, 200)
            self.assertEqual(self.finish(self.password_step()["mfa_token"], code=code).status_code, 400)

    def test_a_recovery_code_works_once(self):
        _, codes = self.turn_on()
        self.assertEqual(self.finish(self.password_step()["mfa_token"], recovery_code=codes[0]).status_code, 200)
        self.assertEqual(self.finish(self.password_step()["mfa_token"], recovery_code=codes[0]).status_code, 400)

    def test_five_wrong_codes_lock_it(self):
        secret, _ = self.turn_on()
        ticket = self.password_step()["mfa_token"]
        with self.clock(30):
            right = pyotp.TOTP(secret).at(self.t0 + 30)
            for _ in range(5):
                self.assertEqual(self.finish(ticket, code=wrong_code(right)).json()["code"], "wrong_code")
            response = self.finish(ticket, code=right)
        self.assertEqual((response.status_code, response.json()["code"]), (429, "try_later"))

    def test_a_trusted_customer_device_still_skips_the_second_step(self):
        customer = make_customer()
        AccountAuthenticator.objects.create(
            account_type="customer", account_id=customer.pk, secret_encrypted=encrypt_secret(pyotp.random_base32()), confirmed_at=timezone.now(),
        )
        raw = devices.trust(customer, None)
        body = APIClient().post("/api/accounts/customers/login/", {"identifier": "+233241234567", "password": PASSWORD, "device_token": raw}, format="json").json()
        self.assertIn("token", body)

    def test_a_code_ticket_from_before_the_authenticator_was_turned_on_stops_working(self):
        # Final review F8: the texted-code ticket must not outlive the authenticator that now replaces it.
        customer = make_customer()
        login = {"identifier": "+233241234567", "password": PASSWORD}
        old = APIClient().post("/api/accounts/customers/login/", login, format="json").json()
        self.assertTrue(old["otp_required"])
        self.assertEqual(APIClient().post("/api/otp/sign-in/send/", {"mfa_token": old["mfa_token"], "channel": "sms"}, format="json").status_code, 200)
        code = last_sms_code()
        secret = pyotp.random_base32()
        AccountAuthenticator.objects.create(
            account_type="customer", account_id=customer.pk, secret_encrypted=encrypt_secret(secret), confirmed_at=timezone.now(),
        )
        for path, body in (("send", {"channel": "email"}), ("verify", {"code": code})):
            response = APIClient().post(f"/api/otp/sign-in/{path}/", {"mfa_token": old["mfa_token"], **body}, format="json")
            self.assertEqual((response.status_code, response.json()["code"]), (400, "challenge_expired"), path)
        new = APIClient().post("/api/accounts/customers/login/", login, format="json").json()
        self.assertEqual(set(new), {"two_factor_required", "mfa_token"})
        with self.clock(30):
            done = self.finish(new["mfa_token"], code=pyotp.TOTP(secret).at(self.t0 + 30))
        self.assertIn("token", done.json())

    def test_an_authenticator_ticket_cannot_ask_for_a_text(self):
        self.turn_on()
        ticket = self.password_step()["mfa_token"]
        response = APIClient().post("/api/otp/sign-in/send/", {"mfa_token": ticket, "channel": "sms"}, format="json")
        self.assertEqual(response.json()["code"], "challenge_expired")


@ON
class ManageTests(AuthenticatorBase):
    def test_turning_it_off_needs_a_code_and_brings_back_the_text_code(self):
        self.turn_on()
        self.assertEqual(self.client.post("/api/otp/authenticator/disable/").status_code, 403)
        self.assertEqual(self.client.post("/api/otp/authenticator/disable/", HTTP_X_STEP_UP_TOKEN=self.step_up()).status_code, 204)
        self.assertFalse(authenticator.is_enabled(self.owner))
        self.assertTrue(OtpEvent.objects.filter(kind=OtpEvent.AUTHENTICATOR_OFF).exists())
        self.assertIn("otp_required", self.password_step())

    def test_new_recovery_codes_need_a_code_and_replace_the_old(self):
        _, old = self.turn_on()
        new = self.client.post("/api/otp/authenticator/recovery-codes/", HTTP_X_STEP_UP_TOKEN=self.step_up()).json()["recovery_codes"]
        self.assertEqual(len(new), 10)
        self.assertEqual(self.finish(self.password_step()["mfa_token"], recovery_code=old[0]).status_code, 400)
        self.assertEqual(self.finish(self.password_step()["mfa_token"], recovery_code=new[0]).status_code, 200)

    def test_nothing_to_turn_off_spends_no_code(self):
        self.assertEqual(self.client.post("/api/otp/authenticator/disable/").status_code, 400)
        self.assertEqual(self.client.post("/api/otp/authenticator/recovery-codes/").status_code, 400)


class SignUpCodeDoesNotSkipAuthenticatorTests(TestCase):
    """A correct sign-up code must not finish the sign-in of an account with an authenticator."""

    def setUp(self):
        cache.clear()
        senders.sms_outbox.clear()
        self.t0 = int(time.time())
        self.secret = pyotp.random_base32()

    def enrol(self, account, kind):
        AccountAuthenticator.objects.create(
            account_type=kind, account_id=account.pk, secret_encrypted=encrypt_secret(self.secret), confirmed_at=timezone.now(),
        )

    def sign_up_ticket(self, url, identifier, **extra):
        body = APIClient().post(url, {"identifier": identifier, "password": PASSWORD, **extra}, format="json").json()
        self.assertIn("otp_required", body)
        client = APIClient()
        client.post("/api/otp/sign-in/send/", {"mfa_token": body["mfa_token"], "channel": "sms"}, format="json")
        return body["mfa_token"], last_sms_code()

    @override_settings(OTP_SIGNIN_ENFORCED=True, OTP_SIGNUP_VERIFICATION_ENFORCED=True)
    def test_a_sign_up_code_then_the_authenticator(self):
        owner = make_owner()
        self.enrol(owner, "business_owner")
        ticket, code = self.sign_up_ticket("/api/accounts/business-owners/login/", "+233201112233")
        response = APIClient().post("/api/otp/sign-in/verify/", {"mfa_token": ticket, "code": code}, format="json")
        body = response.json()
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("token", body)
        self.assertEqual(set(body), {"two_factor_required", "mfa_token"})
        with mock.patch("accounts.two_factor._clock", return_value=self.t0 + 30):
            done = APIClient().post(
                "/api/otp/sign-in/verify/", {"mfa_token": body["mfa_token"], "code": pyotp.TOTP(self.secret).at(self.t0 + 30)}, format="json",
            )
        self.assertIn("token", done.json())

    @override_settings(OTP_SIGNIN_ENFORCED=True, OTP_SIGNUP_VERIFICATION_ENFORCED=True)
    def test_a_trusted_customer_device_gets_the_token_directly(self):
        customer = make_customer()
        self.enrol(customer, "customer")
        raw = devices.trust(customer, None)
        ticket, code = self.sign_up_ticket("/api/accounts/customers/login/", "+233241234567")
        response = APIClient().post("/api/otp/sign-in/verify/", {"mfa_token": ticket, "code": code, "device_token": raw}, format="json")
        self.assertIn("token", response.json())

    @override_settings(OTP_SIGNUP_VERIFICATION_ENFORCED=True)
    def test_with_sign_in_codes_off_the_authenticator_is_still_asked_after_the_sign_up_code(self):
        # Owner ruling 2026-10-18: an opted-in authenticator is honoured even with OTP_SIGNIN_ENFORCED off.
        owner = make_owner()
        self.enrol(owner, "business_owner")
        ticket, code = self.sign_up_ticket("/api/accounts/business-owners/login/", "+233201112233")
        response = APIClient().post("/api/otp/sign-in/verify/", {"mfa_token": ticket, "code": code}, format="json")
        self.assertNotIn("token", response.json())
        self.assertEqual(set(response.json()), {"two_factor_required", "mfa_token"})

    @override_settings(OTP_SIGNIN_ENFORCED=True, OTP_SIGNUP_VERIFICATION_ENFORCED=True)
    def test_a_changed_verified_contact_does_not_open_a_way_round_the_authenticator(self):
        from otp.models import VerifiedContact

        owner = make_owner()
        self.enrol(owner, "business_owner")
        VerifiedContact.objects.create(account_type="business_owner", account_id=owner.pk, channel="email", destination="kwame@example.com")
        owner.email = "attacker@example.com"
        owner.save()
        ticket, code = self.sign_up_ticket("/api/accounts/business-owners/login/", "+233201112233")
        response = APIClient().post("/api/otp/sign-in/verify/", {"mfa_token": ticket, "code": code}, format="json")
        self.assertNotIn("token", response.json())
        self.assertTrue(response.json()["two_factor_required"])
