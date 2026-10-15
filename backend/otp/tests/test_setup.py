"""The switches default off, texts stay in memory under the test runner, the step-up header may cross origins,
and no OTP secret can reach the activity log or Sentry (Review Focus 8)."""
from django.conf import settings
from django.test import SimpleTestCase, override_settings

from activity.services import redact
from ashantihub.sentry import EXTRA_DENYLIST, event_scrubber
from otp import flags

SECRETS = {
    "code": "123456", "mfa_token": "signed-ticket", "recovery_code": "abcde-fghij", "device_token": "raw-device",
    "step_up_token": "raw-step-up", "otpauth_uri": "otpauth://totp/x", "secret": "BASE32SECRET",
}


def shown(value):
    """What Sentry would send: a scrubbed value is an AnnotatedValue."""
    return getattr(value, "value", value)


class SwitchTests(SimpleTestCase):
    def test_every_switch_is_off_by_default(self):
        self.assertEqual((flags.sign_in_enforced(), flags.step_up_enforced(), flags.sign_up_enforced()), (False, False, False))

    @override_settings(OTP_SIGNIN_ENFORCED=True, OTP_STEP_UP_ENFORCED=True, OTP_SIGNUP_VERIFICATION_ENFORCED=True)
    def test_they_are_read_when_asked(self):
        self.assertEqual((flags.sign_in_enforced(), flags.step_up_enforced(), flags.sign_up_enforced()), (True, True, True))

    def test_texts_stay_in_memory_under_the_test_runner(self):
        self.assertEqual(settings.OTP_SMS_PROVIDER, "locmem")

    def test_the_step_up_header_may_cross_origins(self):
        self.assertIn("x-step-up-token", settings.CORS_ALLOW_HEADERS)

    def test_the_code_endpoints_have_their_own_throttles(self):
        rates = settings.REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"]
        self.assertEqual((rates["otp_send"], rates["otp_verify"]), ("5/min", "10/min"))

    def test_the_app_is_installed(self):
        self.assertIn("otp", settings.INSTALLED_APPS)


class SecretsNeverLeakTests(SimpleTestCase):
    def test_the_activity_log_redacts_every_otp_secret(self):
        out = redact({**SECRETS, "channel": "sms"})
        for key in SECRETS:
            self.assertEqual(out[key], "[redacted]", key)
        self.assertEqual(out["channel"], "sms")

    def test_sentry_scrubs_them_in_the_body_and_the_step_up_header(self):
        for key in ("code", "mfa_token", "recovery_code", "device_token", "step_up_token", "otpauth_uri", "x-step-up-token"):
            self.assertIn(key, EXTRA_DENYLIST)
        event = {"request": {
            "data": {**SECRETS, "channel": "sms"},
            "headers": {"X-Step-Up-Token": "raw-step-up", "User-Agent": "Chrome"},
        }}
        event_scrubber().scrub_event(event)
        data = event["request"]["data"]
        for key in SECRETS:
            self.assertEqual(shown(data[key]), "[Filtered]", key)
        self.assertEqual(data["channel"], "sms")
        self.assertEqual(shown(event["request"]["headers"]["X-Step-Up-Token"]), "[Filtered]")
        self.assertEqual(event["request"]["headers"]["User-Agent"], "Chrome")
