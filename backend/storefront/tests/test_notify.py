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

    def test_unmatched_phone_does_not_attach_to_an_email_only_row(self):
        self.post(email="a@example.com")
        row = notify.subscribe(phone="0244123456")
        self.assertEqual(NotifyRequest.objects.count(), 2)
        self.assertEqual(row.phone_key, "244123456")

    def test_new_field_is_attached_to_existing_row(self):
        self.post(phone="0244123456")
        self.post(phone="0244123456", email="a@example.com")
        self.assertEqual(NotifyRequest.objects.count(), 1)
        self.assertEqual(NotifyRequest.objects.get().email_lower, "a@example.com")

    def test_throttled_after_thirty_per_hour(self):
        for i in range(30):
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

    def _sms(self):
        notify.subscribe(phone="0244123456")
        notify.send_batch(now=self.after)
        return senders.sms_outbox[0]

    def test_text_is_the_agreed_wording_with_the_site_host(self):
        text = self._sms()
        self.assertEqual(text.to, "+233244123456")
        self.assertEqual(text.body, "AshantiHub is open! Shop now: www.example.com")

    @override_settings(FRONTEND_BASE_URL="https://staging.theashantihub.com/")
    def test_text_is_one_segment_gsm7(self):
        body = self._sms().body
        self.assertLessEqual(len(body), 160)
        self.assertTrue(body.isascii())
        self.assertEqual(body, "AshantiHub is open! Shop now: staging.theashantihub.com")

    def test_unset_frontend_base_url_uses_safe_default_and_never_a_broken_link(self):
        for bad in ("", None, "   ", "http://", "localhost", "http://localhost:5173", "not a url"):
            with self.subTest(bad=bad), override_settings(FRONTEND_BASE_URL=bad):
                senders.sms_outbox.clear()
                NotifyRequest.objects.all().delete()
                body = self._sms().body
                self.assertEqual(body, f"AshantiHub is open! Shop now: {notify.DEFAULT_SITE_HOST}")
                self.assertNotIn("None", body)
                self.assertNotIn("localhost", body)

    def test_email_links_use_safe_default_when_base_url_unusable(self):
        for bad in ("", None, "   ", "http://", "localhost", "http://localhost:5173", "not a url"):
            with self.subTest(bad=bad), override_settings(FRONTEND_BASE_URL=bad):
                subject, body = notify.email_parts("tok")
                self.assertIn(f"Start shopping: https://{notify.DEFAULT_SITE_HOST}\n", body)
                self.assertIn(f"https://{notify.DEFAULT_SITE_HOST}/notify/stop/tok", body)
                self.assertNotIn("localhost", body)

    @override_settings(FRONTEND_BASE_URL="https://staging.example.com/app/")
    def test_email_links_keep_configured_scheme_and_path(self):
        _, body = notify.email_parts("tok")
        self.assertIn("Start shopping: https://staging.example.com/app\n", body)
        self.assertIn("https://staging.example.com/app/notify/stop/tok", body)

    def test_email_body_contains_the_same_link(self):
        row = notify.subscribe(email="a@example.com")
        notify.send_batch(now=self.after)
        body = mail.outbox[0].body
        self.assertIn("https://www.example.com", body)
        self.assertIn(f"https://www.example.com/notify/stop/{row.token}", body)

    def test_a_claim_taken_over_mid_batch_is_not_sent_by_the_first_worker(self):
        first = notify.subscribe(phone="0244123456")
        second = notify.subscribe(phone="0200000001")
        real = notify._still_mine
        calls = []

        def steal_then_check(pk, channel, claim, require_open=True):
            if not calls:  # another worker reclaims the second row after the first row was handled
                calls.append(1)
                NotifyRequest.objects.filter(pk=second.pk).update(sms_claimed_at=claim + timedelta(minutes=11))
            return real(pk, channel, claim, require_open)

        with mock.patch("storefront.notify._still_mine", side_effect=steal_then_check):
            self.assertEqual(notify.send_batch(now=self.after), 1)
        self.assertEqual([t.to for t in senders.sms_outbox], ["+233244123456"])
        second.refresh_from_db()
        self.assertIsNone(second.sms_sent_at)
        self.assertEqual(second.sms_claimed_at, self.after + timedelta(minutes=11))  # the release did not clear the thief's claim

    def test_a_batch_past_half_the_lease_stops_and_releases_the_rest(self):
        notify.subscribe(phone="0244123456")
        notify.subscribe(phone="0200000001")
        clock = iter([0, 0, 400, 400, 400, 400])
        with mock.patch("storefront.notify.time.monotonic", side_effect=lambda: next(clock)):
            self.assertEqual(notify.send_batch(now=self.after), 1)
        self.assertEqual(len(senders.sms_outbox), 1)
        self.assertEqual(NotifyRequest.objects.filter(sms_claimed_at__isnull=False, sms_sent_at__isnull=True).count(), 0)
        self.assertEqual(notify.send_batch(now=self.after), 1)

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
