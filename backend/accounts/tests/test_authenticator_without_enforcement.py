"""Owner ruling 2026-10-18 (Plan 7C Task 6): a customer or business owner who turned on an authenticator app is asked
for it at sign-in even while OTP_SIGNIN_ENFORCED is off. Texted and emailed sign-in codes stay behind the switch, so
an account without an authenticator signs in with its password alone, as before."""
import time
from unittest import mock

import pyotp
from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.two_factor import encrypt_secret
from otp import devices, senders
from otp.models import AccountAuthenticator, OtpChallenge
from otp.tests.helpers import PASSWORD, make_customer, make_owner, wrong_code

CUSTOMER_LOGIN = "/api/accounts/customers/login/"
OWNER_LOGIN = "/api/accounts/business-owners/login/"
VERIFY = "/api/otp/sign-in/verify/"


@override_settings(OTP_SIGNIN_ENFORCED=False, OTP_SIGNUP_VERIFICATION_ENFORCED=False, OTP_STEP_UP_ENFORCED=False)
class AuthenticatorWithoutEnforcementTests(TestCase):
    def setUp(self):
        cache.clear()
        senders.sms_outbox.clear()
        self.secret = pyotp.random_base32()
        self.t0 = int(time.time())

    def enrol(self, account, kind):
        AccountAuthenticator.objects.create(
            account_type=kind, account_id=account.pk, secret_encrypted=encrypt_secret(self.secret), confirmed_at=timezone.now(),
        )

    def login(self, url, identifier, **extra):
        return APIClient().post(url, {"identifier": identifier, "password": PASSWORD, **extra}, format="json")

    def verify(self, ticket, code):
        with mock.patch("accounts.two_factor._clock", return_value=self.t0):
            return APIClient().post(VERIFY, {"mfa_token": ticket, "code": code}, format="json")

    def test_authenticator_required_when_enabled_and_flag_off(self):
        customer = make_customer()
        self.enrol(customer, "customer")
        response = self.login(CUSTOMER_LOGIN, "+233241234567")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(set(body), {"two_factor_required", "mfa_token"})
        right = pyotp.TOTP(self.secret).at(self.t0)
        refused = self.verify(body["mfa_token"], wrong_code(right))
        self.assertEqual(refused.json()["code"], "wrong_code")
        self.assertNotIn("token", refused.json())
        done = self.verify(body["mfa_token"], right)
        self.assertEqual(done.status_code, 200)
        self.assertEqual(done.json()["account_type"], "customer")
        self.assertIn("token", done.json())

    def test_business_owner_with_an_authenticator_is_asked_too(self):
        owner = make_owner()
        self.enrol(owner, "business_owner")
        body = self.login(OWNER_LOGIN, "+233201112233").json()
        self.assertEqual(set(body), {"two_factor_required", "mfa_token"})
        self.assertIn("token", self.verify(body["mfa_token"], pyotp.TOTP(self.secret).at(self.t0)).json())

    def test_no_authenticator_flag_off_no_code(self):
        make_customer()
        make_owner()
        response = self.login(CUSTOMER_LOGIN, "+233241234567")
        self.assertEqual(response.status_code, 200)
        self.assertIn("token", response.json())
        self.assertNotIn("otp_required", response.json())
        self.assertIn("token", self.login(OWNER_LOGIN, "+233201112233").json())
        self.assertEqual(senders.sms_outbox, [])
        self.assertFalse(OtpChallenge.objects.exists())

    def test_an_unconfirmed_authenticator_asks_nothing(self):
        customer = make_customer()
        AccountAuthenticator.objects.create(account_type="customer", account_id=customer.pk, pending_secret_encrypted=encrypt_secret(self.secret))
        self.assertIn("token", self.login(CUSTOMER_LOGIN, "+233241234567").json())

    def test_a_trusted_customer_device_skips_it_as_with_the_switch_on(self):
        customer = make_customer()
        self.enrol(customer, "customer")
        raw = devices.trust(customer, None)
        self.assertIn("token", self.login(CUSTOMER_LOGIN, "+233241234567", device_token=raw).json())

    def test_the_wrong_password_never_reaches_the_authenticator(self):
        customer = make_customer()
        self.enrol(customer, "customer")
        response = APIClient().post(CUSTOMER_LOGIN, {"identifier": "+233241234567", "password": "nope-nope-1"}, format="json")
        self.assertNotEqual(response.status_code, 200)
        self.assertNotIn("mfa_token", response.json())
