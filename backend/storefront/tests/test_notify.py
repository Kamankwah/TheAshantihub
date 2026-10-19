from datetime import timedelta
from unittest import mock

from django.core import mail
from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.testing import make_staff
from otp import senders
from otp.senders import Delivery
from storefront import notify, opening
from storefront.models import NotifyRequest
from storefront.testing import close_marketplace

URL = "/api/storefront/notify-me/"
STOP = "/api/storefront/notify-me/stop/"


class NotifyBase(TestCase):
    def setUp(self):
        cache.clear()
        senders.sms_outbox.clear()
        self.client = APIClient()
        self.row = close_marketplace(days=10)
        self.after = self.row.opens_at + timedelta(minutes=1)
        self.before = timezone.now()

    def post(self, **body):
        return self.client.post(URL, body, format="json")


class CaptureTests(NotifyBase):
    def test_phone_or_email_alone_is_enough(self):
        self.assertEqual(self.post(phone="0244123456").status_code, 200)
        self.assertEqual(self.post(email="a@example.com").status_code, 200)
        self.assertEqual(NotifyRequest.objects.count(), 2)

    def test_neither_rejected_400(self):
        self.assertEqual(self.post().status_code, 400)
        self.assertEqual(self.post(phone="", email=" ").status_code, 400)

    def test_unusable_phone_or_email_rejected_400(self):
        self.assertEqual(self.post(phone="12345").status_code, 400)
        self.assertEqual(self.post(email="not-an-email").status_code, 400)
        self.assertEqual(NotifyRequest.objects.count(), 0)

    def test_same_phone_three_formats_one_row(self):
        for raw in ("0244123456", "+233244123456", "233 244 123 456"):
            self.assertEqual(self.post(phone=raw).status_code, 200)
        self.assertEqual(NotifyRequest.objects.count(), 1)
        row = NotifyRequest.objects.get()
        self.assertEqual(row.phone, "+233244123456")
        self.assertEqual(row.phone_key, "244123456")

    def test_same_email_different_case_one_row(self):
        self.post(email="Ama@Example.com")
        self.post(email=" ama@example.COM ")
        self.assertEqual(NotifyRequest.objects.count(), 1)
        self.assertEqual(NotifyRequest.objects.get().email_lower, "ama@example.com")

    def test_duplicate_submit_answers_200_and_creates_nothing(self):
        first = self.post(phone="0244123456", email="a@example.com")
        second = self.post(phone="0244123456", email="a@example.com")
        self.assertEqual(first.json(), {"status": "saved"})
        self.assertEqual(second.status_code, 200)
        self.assertEqual(second.json(), {"status": "saved"})
        self.assertEqual(NotifyRequest.objects.count(), 1)

    def test_phone_and_email_on_two_rows_do_not_crash(self):
        self.post(phone="0244123456")
        self.post(email="a@example.com")
        response = self.post(phone="0244123456", email="a@example.com")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "saved"})
        self.assertEqual(NotifyRequest.objects.count(), 2)

    def test_new_field_is_attached_to_existing_row(self):
        self.post(phone="0244123456")
        self.post(phone="0244123456", email="a@example.com")
        self.assertEqual(NotifyRequest.objects.count(), 1)
        self.assertEqual(NotifyRequest.objects.get().email_lower, "a@example.com")

    def test_throttled_after_five_per_hour(self):
        for i in range(5):
            self.assertEqual(self.post(email=f"u{i}@example.com").status_code, 200)
        self.assertEqual(self.post(email="u9@example.com").status_code, 429)

    def test_no_login_needed(self):
        self.assertEqual(APIClient().post(URL, {"email": "z@example.com"}, format="json").status_code, 200)


@override_settings(MARKETPLACE_GATE_ENABLED=True, FRONTEND_BASE_URL="https://www.example.com")
class SendTests(NotifyBase):
    def test_nothing_sent_before_opening(self):
        notify.subscribe(phone="0244123456", email="a@example.com")
        self.assertEqual(notify.send_batch(now=self.before), 0)
        self.assertEqual(senders.sms_outbox, [])
        self.assertEqual(mail.outbox, [])

    @override_settings(MARKETPLACE_GATE_ENABLED=False)
    def test_gate_flag_off_sends_nothing_even_after_opening(self):
        notify.subscribe(phone="0244123456", email="a@example.com")
        self.assertEqual(notify.send_batch(now=self.after), 0)
        self.assertEqual(senders.sms_outbox, [])
        self.assertEqual(mail.outbox, [])

    def test_send_batch_sends_once_and_marks(self):
        notify.subscribe(phone="0244123456", email="a@example.com")
        self.assertEqual(notify.send_batch(now=self.after), 1)
        self.assertEqual(len(senders.sms_outbox), 1)
        self.assertEqual(len(mail.outbox), 1)
        row = NotifyRequest.objects.get()
        self.assertIsNotNone(row.sms_sent_at)
        self.assertIsNotNone(row.email_sent_at)
        self.assertEqual(notify.send_batch(now=self.after), 0)
        self.assertEqual(len(senders.sms_outbox), 1)
        self.assertEqual(len(mail.outbox), 1)

    def test_text_is_short_gsm7_and_carries_the_stop_link(self):
        row = notify.subscribe(phone="0244123456")
        notify.send_batch(now=self.after)
        text = senders.sms_outbox[0]
        self.assertEqual(text.to, "+233244123456")
        self.assertLessEqual(len(text.body), 160)
        self.assertTrue(text.body.isascii())
        self.assertIn(f"https://www.example.com/notify/stop/{row.token}", text.body)
        self.assertIn("open", text.body.lower())

    def test_email_carries_the_stop_link(self):
        row = notify.subscribe(email="a@example.com")
        notify.send_batch(now=self.after)
        self.assertEqual(mail.outbox[0].to, ["a@example.com"])
        self.assertIn(f"https://www.example.com/notify/stop/{row.token}", mail.outbox[0].body)

    def test_batch_limit_respected(self):
        for i in range(250):
            NotifyRequest.objects.create(phone="+233244%06d" % i, phone_key="244%06d" % i, token=f"t{i}")
        self.assertEqual(notify.send_batch(now=self.after), 100)
        self.assertEqual(notify.send_batch(now=self.after), 100)
        self.assertEqual(notify.send_batch(now=self.after), 50)
        self.assertEqual(notify.send_batch(now=self.after), 0)
        self.assertEqual(len(senders.sms_outbox), 250)

    def test_opted_out_never_sent(self):
        row = notify.subscribe(phone="0244123456", email="a@example.com")
        self.assertTrue(notify.opt_out(row.token))
        self.assertEqual(notify.send_batch(now=self.after), 0)
        self.assertEqual(senders.sms_outbox, [])
        self.assertEqual(mail.outbox, [])

    def test_opt_out_stays_after_resubscribe(self):
        row = notify.subscribe(phone="0244123456")
        notify.opt_out(row.token)
        notify.subscribe(phone="0244123456")
        self.assertEqual(notify.send_batch(now=self.after), 0)

    def test_delay_after_partial_send_waits(self):
        notify.subscribe(phone="0244123456")
        self.assertEqual(notify.send_batch(now=self.after), 1)
        notify.subscribe(phone="0200000001")
        staff = make_staff("super_admin", "root@example.com")
        new_time = self.row.opens_at + timedelta(days=3)
        opening.delay(staff, new_time, "late", now=self.before)
        self.assertEqual(notify.send_batch(now=self.after), 0)
        self.assertEqual(len(senders.sms_outbox), 1)
        self.assertEqual(notify.send_batch(now=new_time + timedelta(minutes=1)), 1)
        self.assertEqual(len(senders.sms_outbox), 2)
        self.assertEqual(NotifyRequest.objects.filter(sms_sent_at__isnull=False).count(), 2)

    def test_provider_failure_leaves_row_unsent_for_retry_but_not_duplicated(self):
        notify.subscribe(phone="0244123456")
        with mock.patch("storefront.notify.send_sms", return_value=Delivery(ok=False, provider="hubtel")):
            self.assertEqual(notify.send_batch(now=self.after), 0)
        row = NotifyRequest.objects.get()
        self.assertIsNone(row.sms_sent_at)
        self.assertEqual(notify.send_batch(now=self.after), 1)
        self.assertEqual(notify.send_batch(now=self.after), 0)
        self.assertEqual(len(senders.sms_outbox), 1)

    def test_provider_exception_releases_the_claim(self):
        notify.subscribe(phone="0244123456")
        with mock.patch("storefront.notify.send_sms", side_effect=RuntimeError("boom")):
            self.assertEqual(notify.send_batch(now=self.after), 0)
        self.assertEqual(notify.send_batch(now=self.after), 1)

    def test_live_claim_is_not_taken_twice_but_a_stale_one_is(self):
        row = notify.subscribe(phone="0244123456")
        NotifyRequest.objects.filter(pk=row.pk).update(sms_claimed_at=self.after)
        self.assertEqual(notify.send_batch(now=self.after + timedelta(minutes=1)), 0)
        self.assertEqual(notify.send_batch(now=self.after + timedelta(minutes=11)), 1)

    def test_one_channel_failing_does_not_block_the_other(self):
        notify.subscribe(phone="0244123456", email="a@example.com")
        with mock.patch("storefront.notify.send_sms", return_value=Delivery(ok=False, provider="hubtel")):
            self.assertEqual(notify.send_batch(now=self.after), 1)
        row = NotifyRequest.objects.get()
        self.assertIsNone(row.sms_sent_at)
        self.assertIsNotNone(row.email_sent_at)
        self.assertEqual(notify.send_batch(now=self.after), 1)
        self.assertEqual(len(mail.outbox), 1)


class StopTests(NotifyBase):
    def test_stop_link_sets_opted_out(self):
        row = notify.subscribe(phone="0244123456")
        response = self.client.post(STOP, {"token": row.token}, format="json")
        self.assertEqual(response.status_code, 200)
        row.refresh_from_db()
        self.assertIsNotNone(row.opted_out_at)

    def test_unknown_token_gets_the_same_answer(self):
        row = notify.subscribe(phone="0244123456")
        known = self.client.post(STOP, {"token": row.token}, format="json")
        unknown = self.client.post(STOP, {"token": "nope"}, format="json")
        self.assertEqual(unknown.status_code, known.status_code)
        self.assertEqual(unknown.json(), known.json())
        self.assertEqual(self.client.post(STOP, {}, format="json").status_code, 200)

    def test_task_runs_send_batch(self):
        from storefront.tasks import send_opening_notices

        with mock.patch("storefront.notify.send_batch", return_value=3) as sb:
            self.assertEqual(send_opening_notices(), 3)
        sb.assert_called_once()
