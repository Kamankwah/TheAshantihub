"""The business money-text outbox (vendor plan 4, Task 5): queued with the money movement, sent after commit through
otp.senders, claimed so it is never sent twice at once, retried, and counted by the SMS-spend alert without touching the
code send limits. Review Focus 2."""
from datetime import timedelta
from unittest import mock

from django.db import transaction
from django.test import SimpleTestCase, TestCase, override_settings
from django.utils import timezone

from accounts.models import BusinessOwner
from accounts.testing import make_staff
from notifications.models import Notification
from otp import senders, spend
from otp.identity import contacts
from otp.models import SMS, OtpEvent, VerifiedContact
from staffsecurity import policy
from wallets import vendor_texts
from wallets.models import VendorText

BODY = "AshantiHub: order #12 paid. Items GHS 120.00, platform fee GHS 5.00, due to you GHS 115.00 after hand-over and Support's check."
DOWN = senders.Delivery(ok=False, provider="hubtel")


class PlainTextTests(SimpleTestCase):
    def test_only_plain_characters_and_at_most_two_parts(self):
        self.assertTrue(vendor_texts.fits(BODY))
        self.assertTrue(vendor_texts.fits("x" * 306))
        for body in ("", "x" * 307, "GH₵ 5.00 due", "Order — paid", "1 × Kente"):
            self.assertFalse(vendor_texts.fits(body), body)


class OutboxBase(TestCase):
    def setUp(self):
        senders.sms_outbox.clear()
        self.owner = BusinessOwner.objects.create(full_name="Kofi Mensah", login_phone="0201110001", password_hash="x")
        VerifiedContact.objects.create(                                            # a code sent to this phone was accepted
            account_type="business_owner", account_id=self.owner.pk, channel=SMS, destination=contacts(self.owner)[SMS],
        )
        self.now = timezone.now()

    def queue(self, key="paid-12-1", **extra):
        return vendor_texts.queue(self.owner, VendorText.ORDER_PAID, key, BODY, now=self.now, **extra)


class QueueTests(OutboxBase):
    def test_a_text_is_queued_once_per_key_and_sent_after_commit(self):
        with self.captureOnCommitCallbacks(execute=True):
            first = self.queue()
            again = self.queue()
        self.assertEqual(first.pk, again.pk)
        first.refresh_from_db()
        self.assertEqual(
            (first.status, first.attempts, first.provider, first.to_hint),
            (VendorText.SENT, 1, "locmem", "020 *** 0001"),
        )
        self.assertEqual([(text.to, text.body) for text in senders.sms_outbox], [("+233201110001", BODY)])

    def test_nothing_is_sent_before_the_money_movement_commits(self):
        with self.captureOnCommitCallbacks(execute=False) as callbacks:
            text = self.queue()
        self.assertEqual(len(callbacks), 1)
        self.assertEqual(senders.sms_outbox, [])
        self.assertEqual(VendorText.objects.get(pk=text.pk).status, VendorText.QUEUED)

    def test_review_focus_a_text_that_cannot_be_queued_never_raises(self):
        with mock.patch.object(VendorText.objects, "get_or_create", side_effect=RuntimeError("db down")), \
                self.assertLogs("wallets.vendor_texts", "ERROR") as logs:
            self.assertIsNone(self.queue())
        self.assertIn("RuntimeError", "\n".join(logs.output))
        self.assertNotIn("115.00", "\n".join(logs.output))                                  # never the body

    def test_review_focus_a_worker_that_cannot_be_reached_never_breaks_the_commit(self):
        with mock.patch("wallets.tasks.send_vendor_text.delay", side_effect=RuntimeError("broker down")), \
                self.assertLogs("wallets.vendor_texts", "ERROR"), self.captureOnCommitCallbacks(execute=True):
            text = self.queue()
        self.assertEqual(VendorText.objects.get(pk=text.pk).status, VendorText.QUEUED)   # the 5-minute job sends it

    def test_a_payment_that_rolls_back_leaves_no_text_and_sends_none(self):
        with self.captureOnCommitCallbacks(execute=True) as callbacks:
            with self.assertRaises(RuntimeError), transaction.atomic():
                self.queue()
                raise RuntimeError("payment failed")
        self.assertEqual(callbacks, [])
        self.assertFalse(VendorText.objects.exists())
        self.assertEqual(senders.sms_outbox, [])

    def test_a_body_that_is_not_plain_or_too_long_is_not_queued(self):
        for key, body in (("k-cedi", "GH₵ 5.00 due"), ("k-long", "x" * 307)):
            with self.assertLogs("wallets.vendor_texts", "ERROR"):
                self.assertIsNone(vendor_texts.queue(self.owner, VendorText.ORDER_PAID, key, body, now=self.now))
        self.assertFalse(VendorText.objects.exists())


class DeliverTests(OutboxBase):
    def test_review_focus_a_failed_send_is_retried_with_backoff_then_given_up(self):
        text = self.queue()
        at = self.now
        with mock.patch("wallets.vendor_texts.senders.deliver", return_value=DOWN):
            for attempt, minutes in enumerate((5, 15, 60, 240), start=1):
                self.assertEqual(vendor_texts.deliver(text.pk, at), VendorText.QUEUED)
                text.refresh_from_db()
                self.assertEqual((text.attempts, text.next_attempt_at), (attempt, at + timedelta(minutes=minutes)))
                self.assertIsNone(vendor_texts.deliver(text.pk, at + timedelta(minutes=minutes - 1)))   # not due yet
                at += timedelta(minutes=minutes)
            self.assertEqual(vendor_texts.deliver(text.pk, at), VendorText.FAILED)
        text.refresh_from_db()
        self.assertEqual((text.status, text.attempts, text.provider), (VendorText.FAILED, 5, "hubtel"))
        self.assertIsNone(vendor_texts.deliver(text.pk, at + timedelta(days=1)))                      # final

    def test_review_focus_no_usable_phone_is_final_and_the_in_app_copy_stays(self):
        BusinessOwner.objects.filter(pk=self.owner.pk).update(login_phone="+44 20 7946 0000")
        notice = Notification.objects.create(business_owner=self.owner, kind="vendor_money", title="Order #12 released", body=BODY)
        with self.captureOnCommitCallbacks(execute=True):
            text = self.queue(notification=notice)
        text.refresh_from_db()
        self.assertEqual((text.status, text.notification_id), (VendorText.NO_PHONE, notice.pk))
        self.assertEqual(senders.sms_outbox, [])
        self.assertIsNone(vendor_texts.deliver(text.pk, self.now + timedelta(days=1)))

    def test_review_focus_a_phone_nobody_confirmed_gets_no_text_and_the_in_app_copy_stays(self):
        VerifiedContact.objects.all().delete()                                  # the login phone was never confirmed by a code
        notice = Notification.objects.create(business_owner=self.owner, kind="vendor_money", title="Order #12 released", body=BODY)
        with self.captureOnCommitCallbacks(execute=True):
            text = self.queue(notification=notice)
        text.refresh_from_db()
        self.assertEqual((text.status, text.notification_id), (VendorText.NO_PHONE, notice.pk))
        self.assertEqual(senders.sms_outbox, [])

    def test_review_focus_a_send_in_progress_is_not_picked_up_again(self):
        text = self.queue()
        second = []

        def provider(*args):
            second.append(vendor_texts.deliver(text.pk, self.now))                  # another worker, mid-send
            return senders.Delivery(ok=True, provider="locmem")

        with mock.patch("wallets.vendor_texts.senders.deliver", side_effect=provider):
            self.assertEqual(vendor_texts.deliver(text.pk, self.now), VendorText.SENT)
        self.assertEqual(second, [None])
        self.assertIsNone(vendor_texts.deliver(text.pk, self.now + timedelta(hours=1)))  # sent: never again

    def test_review_focus_a_worker_finishing_late_cannot_undo_a_text_another_worker_sent(self):
        text = self.queue()

        def provider(*args):
            VendorText.objects.filter(pk=text.pk).update(status=VendorText.SENT)   # its lease ran out; another worker sent it
            return DOWN

        with mock.patch("wallets.vendor_texts.senders.deliver", side_effect=provider):
            self.assertIsNone(vendor_texts.deliver(text.pk, self.now))
        self.assertEqual(VendorText.objects.get(pk=text.pk).status, VendorText.SENT)

    def test_review_focus_a_late_worker_cannot_give_up_a_text_another_worker_holds(self):
        text = self.queue()
        VendorText.objects.filter(pk=text.pk).update(attempts=vendor_texts.MAX_ATTEMPTS - 1)   # one more failure would be final
        later = self.now + timedelta(minutes=30)

        def provider(*args):
            VendorText.objects.filter(pk=text.pk).update(attempts=vendor_texts.MAX_ATTEMPTS + 1, next_attempt_at=later)   # worker B re-claimed it
            return DOWN

        with mock.patch("wallets.vendor_texts.senders.deliver", side_effect=provider):
            self.assertIsNone(vendor_texts.deliver(text.pk, self.now))
        text.refresh_from_db()
        self.assertEqual(
            (text.status, text.attempts, text.next_attempt_at, text.provider, text.to_hint),
            (VendorText.QUEUED, vendor_texts.MAX_ATTEMPTS + 1, later, "", ""),
        )

    def test_review_focus_a_late_worker_cannot_reopen_the_lease_of_one_that_re_claimed_the_text(self):
        text = self.queue()
        held_until = self.now + timedelta(hours=2)

        def provider(*args):
            VendorText.objects.filter(pk=text.pk).update(attempts=2, next_attempt_at=held_until)   # worker B holds it
            return senders.Delivery(ok=True, provider="locmem")

        with mock.patch("wallets.vendor_texts.senders.deliver", side_effect=provider):
            self.assertIsNone(vendor_texts.deliver(text.pk, self.now))
        text.refresh_from_db()
        self.assertEqual((text.status, text.attempts, text.next_attempt_at, text.sent_at), (VendorText.QUEUED, 2, held_until, None))

    def test_a_crashed_send_is_tried_again_after_the_lease(self):
        text = self.queue()
        # Claimed by a worker that then died: attempts counted, next try pushed out by the lease.
        VendorText.objects.filter(pk=text.pk).update(attempts=1, next_attempt_at=self.now + vendor_texts.LEASE)
        self.assertIsNone(vendor_texts.deliver(text.pk, self.now + timedelta(minutes=9)))
        self.assertEqual(vendor_texts.deliver(text.pk, self.now + vendor_texts.LEASE), VendorText.SENT)
        self.assertEqual(VendorText.objects.get(pk=text.pk).attempts, 2)

    def test_the_job_sends_what_is_due_and_one_bad_row_never_stops_the_rest(self):
        broken = self.queue("k-broken")
        fine = self.queue("k-fine")
        real = vendor_texts.deliver

        def flaky(pk, now=None):
            if pk == broken.pk:
                raise RuntimeError("boom")
            return real(pk, now)

        with mock.patch("wallets.vendor_texts.deliver", side_effect=flaky), self.assertLogs("wallets.vendor_texts", "ERROR"):
            self.assertEqual(vendor_texts.send_due(self.now), 1)
        self.assertEqual(VendorText.objects.get(pk=fine.pk).status, VendorText.SENT)
        self.assertEqual(VendorText.objects.get(pk=broken.pk).status, VendorText.QUEUED)

    def test_the_job_stops_when_its_time_budget_is_spent(self):
        first, second = self.queue("k-1"), self.queue("k-2")
        with mock.patch.object(vendor_texts, "SEND_BUDGET", timedelta(0)):
            self.assertEqual(vendor_texts.send_due(self.now), 0)
        self.assertEqual(VendorText.objects.filter(status=VendorText.QUEUED).count(), 2)

    def test_the_job_stops_after_three_provider_failures_in_a_row(self):
        for n in range(5):
            self.queue(f"k-{n}")
        with mock.patch("wallets.vendor_texts.senders.deliver", return_value=DOWN) as send:
            self.assertEqual(vendor_texts.send_due(self.now), 0)
        self.assertEqual(send.call_count, vendor_texts.MAX_CONSECUTIVE_FAILURES)

    def test_a_text_another_worker_holds_is_not_counted_as_sent(self):
        text = self.queue()
        with mock.patch("wallets.vendor_texts.deliver", return_value=None):
            self.assertEqual(vendor_texts.send_due(self.now), 0)

    @override_settings(OTP_SMS_PROVIDER="simulated")
    def test_a_simulated_text_says_it_was_not_sent(self):
        text = self.queue()
        self.assertEqual(vendor_texts.deliver(text.pk, self.now), VendorText.SENT)
        text.refresh_from_db()
        self.assertEqual((text.provider, vendor_texts.row(text)["status_label"]), ("simulated", "Not sent: texts are simulated"))


class SpendTests(OutboxBase):
    def setUp(self):
        super().setUp()
        self.boss = make_staff("super_admin", "boss@example.com")
        policy.set_otp({"otp_sms_daily_alert": 3}, self.boss)

    def test_review_focus_business_texts_count_toward_the_sms_spend_alert(self):
        OtpEvent.objects.create(kind=OtpEvent.SENT, channel=SMS, at=self.now, provider="locmem")   # one code text
        for key in ("k-1", "k-2"):
            vendor_texts.deliver(self.queue(key).pk, self.now)
        self.assertEqual(spend.texts_sent_on(timezone.localdate(self.now)), 3)
        alert = Notification.objects.get(staff=self.boss, kind=spend.ALERT_KIND)
        self.assertIn("3", alert.title)
        self.assertIn("2 business money texts", alert.body)

    def test_a_text_is_counted_on_its_own_local_day(self):
        text = self.queue()
        vendor_texts.deliver(text.pk, self.now)
        day = timezone.localdate(self.now)
        self.assertEqual(spend.texts_sent_on(day), 1)
        self.assertEqual(spend.texts_sent_on(day - timedelta(days=1)), 0)
        self.assertEqual(spend.texts_sent_on(day + timedelta(days=1)), 0)

    def test_review_focus_business_texts_never_use_up_the_code_send_limits(self):
        for n in range(25):                                                       # more than the 20-an-hour per-phone ceiling
            vendor_texts.deliver(self.queue(f"k-{n}").pk, self.now)
        self.assertEqual(VendorText.objects.filter(status=VendorText.SENT).count(), 25)
        self.assertFalse(OtpEvent.objects.filter(kind__in=(OtpEvent.SENT, OtpEvent.SEND_FAILED)).exists())
