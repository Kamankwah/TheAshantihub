"""How a code travels (otp.senders) and the SMS-spend alert (otp.spend). Review Focus 6 and 8."""
from datetime import timedelta
from unittest import mock

from django.core import mail
from django.core.exceptions import ImproperlyConfigured
from django.test import TestCase, override_settings
from django.utils import timezone

from accounts.testing import make_staff
from marketing.models_campaigns import SenderId
from notifications.models import Notification
from otp import senders, spend
from otp.models import EMAIL, SMS, OtpEvent
from staffsecurity import policy

HUBTEL = override_settings(
    OTP_SMS_PROVIDER="hubtel", HUBTEL_SMS_CLIENT_ID="test-id", HUBTEL_SMS_CLIENT_SECRET="test-secret", HUBTEL_SMS_SENDER_ID="AshantiHub",
)
HUBTEL_HTTP = "marketing.providers.hubtel_sms.http_request"
BODY = "123456 is your AshantiHub code to sign in."


class FakeResp:
    def __init__(self, data, status=200):
        self.data, self.status_code = data, status

    def json(self):
        return self.data


class SenderTests(TestCase):
    def setUp(self):
        senders.sms_outbox.clear()

    def test_texts_stay_in_the_outbox_under_tests(self):
        delivery = senders.deliver(SMS, "+233241234567", "Your AshantiHub code", BODY)
        self.assertEqual((delivery.ok, delivery.provider), (True, "locmem"))
        self.assertEqual([(t.to, t.body) for t in senders.sms_outbox], [("+233241234567", BODY)])

    @override_settings(OTP_SMS_PROVIDER="simulated")
    def test_the_simulated_provider_sends_and_keeps_nothing(self):
        delivery = senders.deliver(SMS, "+233241234567", "Your AshantiHub code", BODY)
        self.assertEqual((delivery.ok, delivery.provider), (True, "simulated"))
        self.assertEqual(senders.sms_outbox, [])

    @override_settings(OTP_SMS_PROVIDER="twilio")
    def test_an_unknown_sms_provider_fails_loudly(self):
        with self.assertRaisesMessage(ImproperlyConfigured, "OTP_SMS_PROVIDER"):
            senders.deliver(SMS, "+233241234567", "s", BODY)
        self.assertEqual(senders.sms_outbox, [])

    def test_email_goes_through_django_mail(self):
        delivery = senders.deliver(EMAIL, "ama@example.com", "Your AshantiHub code", BODY)
        self.assertEqual((delivery.ok, delivery.provider), (True, "email"))
        self.assertEqual((mail.outbox[0].to, mail.outbox[0].subject, mail.outbox[0].body), (["ama@example.com"], "Your AshantiHub code", BODY))

    def test_a_failed_email_says_so_and_never_logs_the_body(self):
        with mock.patch("otp.senders.send_mail", side_effect=OSError("smtp down")), self.assertLogs("otp.senders", "WARNING") as logs:
            delivery = senders.deliver(EMAIL, "ama@example.com", "Your AshantiHub code", BODY)
        self.assertFalse(delivery.ok)
        self.assertNotIn("123456", "\n".join(logs.output))

    def test_an_unknown_channel_is_a_programming_error(self):
        with self.assertRaises(ValueError):
            senders.deliver("pigeon", "x", "s", BODY)

    @HUBTEL
    def test_hubtel_sends_through_the_marketing_client(self):
        SenderId.objects.create(name="AshantiHub", network="mtn", status=SenderId.APPROVED)
        stub = mock.Mock(return_value=FakeResp({"MessageId": "m-1", "Status": 0}))
        with mock.patch(HUBTEL_HTTP, stub):
            delivery = senders.deliver(SMS, "+233241234567", "Your AshantiHub code", BODY)
        self.assertEqual((delivery.ok, delivery.provider, delivery.ref), (True, "hubtel", "m-1"))
        self.assertEqual(stub.call_args.kwargs["json"]["To"], "233241234567")
        self.assertEqual(stub.call_args.kwargs["json"]["Content"], BODY)

    @HUBTEL
    def test_a_hubtel_refusal_is_a_failed_delivery_and_the_body_is_not_logged(self):
        SenderId.objects.create(name="AshantiHub", network="mtn", status=SenderId.APPROVED)
        with mock.patch(HUBTEL_HTTP, return_value=FakeResp({"Message": "no credit"}, status=402)), \
                self.assertLogs("otp.senders", "WARNING") as logs:
            delivery = senders.deliver(SMS, "+233241234567", "Your AshantiHub code", BODY)
        self.assertFalse(delivery.ok)
        self.assertNotIn("123456", "\n".join(logs.output))

    @override_settings(OTP_SMS_PROVIDER="hubtel", HUBTEL_SMS_CLIENT_ID="")
    def test_hubtel_without_keys_sends_nothing(self):
        with self.assertLogs("otp.senders", "WARNING"):
            self.assertFalse(senders.deliver(SMS, "+233241234567", "s", BODY).ok)


class SmsSpendAlertTests(TestCase):
    def setUp(self):
        self.boss = make_staff("super_admin", "boss@example.com")
        policy.set_otp({"otp_sms_daily_alert": 3}, self.boss)
        self.now = timezone.now()

    def text(self, at=None, channel=SMS, kind=OtpEvent.SENT):
        OtpEvent.objects.create(kind=kind, channel=channel, at=at or self.now, provider="locmem")

    def test_it_alerts_once_when_the_day_reaches_the_threshold(self):
        self.text()
        self.text()
        self.assertFalse(spend.check(self.now))
        self.text()
        self.assertTrue(spend.check(self.now))
        self.text()
        self.assertFalse(spend.check(self.now))
        alerts = Notification.objects.filter(staff=self.boss, kind=spend.ALERT_KIND)
        self.assertEqual(alerts.count(), 1)
        self.assertIn("3", alerts.get().title)
        self.assertEqual(OtpEvent.objects.filter(kind=OtpEvent.SMS_ALERT).count(), 1)

    def test_emails_and_refused_or_failed_sends_do_not_count(self):
        for _ in range(3):
            self.text(channel=EMAIL)
        self.text(kind=OtpEvent.SEND_REFUSED)
        self.text(kind=OtpEvent.SEND_FAILED)
        self.assertFalse(spend.check(self.now))

    def test_a_new_day_can_alert_again(self):
        for _ in range(3):
            self.text()
        self.assertTrue(spend.check(self.now))
        tomorrow = self.now + timedelta(days=1)
        for _ in range(3):
            self.text(at=tomorrow)
        self.assertTrue(spend.check(tomorrow))
        self.assertEqual(Notification.objects.filter(staff=self.boss, kind=spend.ALERT_KIND).count(), 2)

    def test_only_security_managers_hear(self):
        support = make_staff("support", "esi@example.com")
        for _ in range(3):
            self.text()
        spend.check(self.now)
        self.assertFalse(Notification.objects.filter(staff=support, kind=spend.ALERT_KIND).exists())
