"""Trusted devices (otp.devices), sign-in tickets and the second-step decision (otp.signin).
Review Focus 3, 4 and 7."""
from datetime import timedelta
from unittest import mock

from django.contrib.auth.hashers import make_password
from django.core.cache import cache
from django.test import RequestFactory, TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import PasswordResetToken
from otp import devices, signin
from otp.models import SIGN_IN, SIGN_UP, SMS, OtpEvent, TrustedDevice, VerifiedContact
from staffsecurity import policy

from .helpers import make_customer, make_owner, make_support

ON = override_settings(OTP_SIGNIN_ENFORCED=True)
SIGN_UP_ON = override_settings(OTP_SIGNUP_VERIFICATION_ENFORCED=True)


def browser():
    return RequestFactory().post("/", HTTP_USER_AGENT="Mozilla/5.0 (Linux; Android 14) Chrome/126.0 Mobile Safari/537.36")


class TrustedDeviceTests(TestCase):
    def setUp(self):
        cache.clear()
        self.customer = make_customer()
        self.raw = devices.trust(self.customer, browser())

    def test_a_trusted_device_skips_the_code_is_labelled_and_kept_hashed(self):
        self.assertTrue(devices.is_trusted(self.customer, self.raw))
        device = TrustedDevice.objects.get()
        self.assertEqual(device.label, "Chrome on Android device")
        self.assertNotEqual(device.token_hash, self.raw)
        self.assertTrue(OtpEvent.objects.filter(kind=OtpEvent.DEVICE_TRUSTED).exists())

    def test_any_password_change_ends_it(self):
        # Review Focus 4: whatever path changed the password, the fingerprint no longer matches.
        self.customer.password_hash = make_password("a-new-password-1")
        self.customer.save(update_fields=["password_hash"])
        self.assertFalse(devices.is_trusted(self.customer, self.raw))

    def test_a_password_reset_revokes_every_device_and_records_it(self):
        PasswordResetToken.objects.create(
            account_type="customer", account_id=self.customer.pk, token="reset-1", expires_at=timezone.now() + timedelta(hours=1),
        )
        response = APIClient().post(
            "/api/accounts/password-reset/confirm/",
            {"token": "reset-1", "account_type": "customer", "password": "a-new-password-1"}, format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        device = TrustedDevice.objects.get()
        self.assertEqual(device.revoked_reason, TrustedDevice.PASSWORD_RESET)
        self.assertIsNotNone(device.revoked_at)
        self.assertTrue(OtpEvent.objects.filter(kind=OtpEvent.DEVICE_REVOKED, account_id=self.customer.pk).exists())

    def test_it_lapses_after_the_customer_gap_which_super_admin_can_change(self):
        TrustedDevice.objects.update(verified_at=timezone.now() - timedelta(days=31))
        self.assertFalse(devices.is_trusted(self.customer, self.raw))
        policy.set_otp({"otp_customer_gap_days": 60}, make_support("boss@example.com"))
        self.assertTrue(devices.is_trusted(self.customer, self.raw))

    def test_someone_elses_or_a_made_up_token_is_not_trusted(self):
        other = make_customer(phone="+233249999999", email="yaw@example.com")
        self.assertFalse(devices.is_trusted(other, self.raw))
        for junk in ("", "nonsense", None, 123, "x" * 500):
            self.assertFalse(devices.is_trusted(self.customer, junk))

    def test_trusting_again_with_the_same_token_refreshes_it(self):
        TrustedDevice.objects.update(verified_at=timezone.now() - timedelta(days=31))
        self.assertEqual(devices.trust(self.customer, browser(), existing=self.raw), self.raw)
        self.assertEqual(TrustedDevice.objects.count(), 1)
        self.assertTrue(devices.is_trusted(self.customer, self.raw))

    def test_revoke_all_and_the_live_list(self):
        second = devices.trust(self.customer, browser())
        self.assertEqual(len(devices.live(self.customer)), 2)
        self.assertEqual(devices.revoke_all(self.customer, TrustedDevice.REMOVED_ALL), 2)
        self.assertEqual(devices.live(self.customer), [])
        self.assertFalse(devices.is_trusted(self.customer, second))


class TicketTests(TestCase):
    def setUp(self):
        self.owner = make_owner()

    def test_a_genuine_ticket_reads_back(self):
        ticket = signin.read_ticket(signin.make_ticket(self.owner, signin.CODE_STAGE, SIGN_IN))
        self.assertEqual(
            (ticket.account, ticket.account_type, ticket.stage, ticket.purpose),
            (self.owner, "business_owner", "code", "sign_in"),
        )
        self.assertEqual(len(ticket.nonce), 32)

    def test_every_ticket_has_its_own_nonce(self):
        first = signin.read_ticket(signin.make_ticket(self.owner, signin.CODE_STAGE, SIGN_IN))
        second = signin.read_ticket(signin.make_ticket(self.owner, signin.CODE_STAGE, SIGN_IN))
        self.assertNotEqual(first.nonce, second.nonce)

    def test_tampered_expired_wrong_stage_or_stale_tickets_are_refused(self):
        token = signin.make_ticket(self.owner, signin.CODE_STAGE, SIGN_IN)
        self.assertIsNone(signin.read_ticket(token + "x"))
        self.assertIsNone(signin.read_ticket(token, signin.AUTHENTICATOR_STAGE))
        for junk in (None, "", 7, ["x"]):
            self.assertIsNone(signin.read_ticket(junk))
        with mock.patch("otp.signin.TICKET_MAX_AGE", -1):
            self.assertIsNone(signin.read_ticket(token))
        self.owner.password_hash = make_password("changed-password-1")
        self.owner.save(update_fields=["password_hash"])
        self.assertIsNone(signin.read_ticket(token))

    def test_a_suspended_account_cannot_use_its_ticket(self):
        token = signin.make_ticket(self.owner, signin.CODE_STAGE, SIGN_IN)
        self.owner.is_suspended = True
        self.owner.save(update_fields=["is_suspended"])
        self.assertIsNone(signin.read_ticket(token))


class SignInStepTests(TestCase):
    def setUp(self):
        self.customer, self.owner, self.staff = make_customer(), make_owner(), make_support()

    def test_with_every_switch_off_nobody_owes_a_second_step(self):
        # Review Focus 7.
        for account in (self.customer, self.owner, self.staff):
            self.assertIsNone(signin.sign_in_step(account))

    @ON
    def test_vendors_and_staff_always_owe_a_code(self):
        for account in (self.owner, self.staff):
            step = signin.sign_in_step(account)
            self.assertEqual(set(step), {"otp_required", "mfa_token", "channels"})
            self.assertEqual(signin.read_ticket(step["mfa_token"]).purpose, SIGN_IN)

    @ON
    def test_a_customer_owes_one_only_without_a_trusted_device(self):
        self.assertIsNotNone(signin.sign_in_step(self.customer))
        raw = devices.trust(self.customer, browser())
        self.assertIsNone(signin.sign_in_step(self.customer, raw))
        self.assertIsNotNone(signin.sign_in_step(self.customer, "someone-elses"))

    @SIGN_UP_ON
    def test_an_unverified_customer_or_vendor_owes_a_sign_up_check_but_staff_do_not(self):
        for account in (self.customer, self.owner):
            step = signin.sign_in_step(account)
            self.assertEqual(signin.read_ticket(step["mfa_token"]).purpose, SIGN_UP)
        self.assertIsNone(signin.sign_in_step(self.staff))

    @SIGN_UP_ON
    def test_a_verified_current_contact_is_enough_but_an_old_one_is_not(self):
        VerifiedContact.objects.create(account_type="customer", account_id=self.customer.pk, channel=SMS, destination="+233241234567")
        self.assertTrue(signin.has_verified_contact(self.customer))
        self.assertIsNone(signin.sign_in_step(self.customer))
        self.customer.phone = "+233245550000"
        self.customer.email = None
        self.customer.save()
        self.assertFalse(signin.has_verified_contact(self.customer))
        self.assertIsNotNone(signin.sign_in_step(self.customer))

    @ON
    def test_the_challenge_carries_no_name_id_or_whole_contact(self):
        # Review Focus 3.
        step = signin.sign_in_step(self.owner)
        text = str(step)
        self.assertNotIn("201112233", text)
        self.assertNotIn("kwame@", text)
        self.assertNotIn("Kwame", text)
        self.assertNotIn("id", step)
