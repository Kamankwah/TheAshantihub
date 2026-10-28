"""While OTP_SMS_PROVIDER is "simulated" no text reaches anyone, so an SMS code send is refused (final review ruling R12)."""
from django.core import mail
from django.test import override_settings

from otp import senders
from otp.models import OtpEvent

from .helpers import last_email_code, last_sms_code
from .test_sign_in_api import ON, SignInApiBase
from .test_step_up import ON as STEP_UP_ON, SEND, StepUpBase

REFUSED = "Texts aren't being sent yet. Choose email instead."


@ON
@override_settings(OTP_SMS_PROVIDER="simulated")
class SignInSimulatedTextTests(SignInApiBase):
    def test_a_text_is_refused_with_channel_unavailable_and_nothing_is_sent(self):
        response = self.send(self.ticket(), "sms")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["code"], "channel_unavailable")
        self.assertEqual(response.json()["detail"], REFUSED)
        self.assertEqual(senders.sms_outbox, [])
        self.assertEqual(len(mail.outbox), 0)
        self.assertTrue(OtpEvent.objects.filter(kind=OtpEvent.SEND_REFUSED, note="texts simulated").exists())
        self.assertFalse(OtpEvent.objects.filter(kind=OtpEvent.SENT).exists())

    def test_email_still_sends_and_finishes_signing_in(self):
        ticket = self.ticket()
        self.assertEqual(self.send(ticket, "email").status_code, 200)
        self.assertIn("token", self.verify(ticket, last_email_code()).json())


@ON
@override_settings(OTP_SMS_PROVIDER="locmem")
class SignInRealProviderTextTests(SignInApiBase):
    def test_a_text_still_sends_with_a_connected_provider(self):
        ticket = self.ticket()
        self.assertEqual(self.send(ticket, "sms").status_code, 200)
        self.assertIn("token", self.verify(ticket, last_sms_code()).json())


@STEP_UP_ON
@override_settings(OTP_SMS_PROVIDER="simulated")
class StepUpSimulatedTextTests(StepUpBase):
    def test_a_text_is_refused_for_a_step_up(self):
        response = self.client.post(SEND, {"action": "payout_destination", "channel": "sms"}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["code"], "channel_unavailable")
        self.assertEqual(senders.sms_outbox, [])

    def test_email_still_sends_for_a_step_up(self):
        response = self.client.post(SEND, {"action": "payout_destination", "channel": "email"}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(len(mail.outbox), 1)


@STEP_UP_ON
@override_settings(OTP_SMS_PROVIDER="locmem")
class StepUpRealProviderTextTests(StepUpBase):
    def test_a_text_still_sends_with_a_connected_provider(self):
        self.assertEqual(self.client.post(SEND, {"action": "payout_destination", "channel": "sms"}, format="json").status_code, 200)
        self.assertEqual(len(senders.sms_outbox), 1)
