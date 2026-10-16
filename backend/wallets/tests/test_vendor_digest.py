"""The business's texts screen and the optional daily digest (vendor plan 4, Task 7). Review Focus 1 (its own texts; a
customer with the same id is refused), 2 (no usable phone said plainly), 4 (the digest covers exactly yesterday) and 5
(ledger off)."""
import threading
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo
from unittest import mock

from django.conf import settings
from django.db import connection
from django.test import TransactionTestCase, override_settings
from django.utils import timezone

from accounts.models import BusinessOwner
from notifications.models import Notification
from otp import senders
from wallets import tasks, vendor_texts
from wallets.models import VendorPreference, VendorText

from .vendor_helpers import VendorBase, paid_order, release, signed_in

TEXTS = "/api/wallet/vendor/texts/"


class LedgerOffTests(VendorBase):
    def test_review_focus_the_texts_screen_says_ledger_off(self):
        for response in (self.kofi.get(TEXTS), self.kofi.client.patch(TEXTS, {"daily_digest": True}, format="json")):
            self.assertEqual((response.status_code, response.json()["code"]), (409, "ledger_off"))
        self.assertFalse(VendorPreference.objects.exists())


@override_settings(LEDGER_ENABLED=True)
class TextSettingsTests(VendorBase):
    def test_the_digest_is_off_until_turned_on(self):
        body = self.kofi.get(TEXTS).json()
        self.assertEqual((body["order_texts"], body["daily_digest"], body["phone"], body["recent"]), (True, False, "020 *** 0001", []))
        self.assertIsNone(body["note"])
        turned_on = self.kofi.client.patch(TEXTS, {"daily_digest": True}, format="json")
        self.assertEqual((turned_on.status_code, turned_on.json()["daily_digest"]), (200, True))
        self.assertTrue(self.kofi.get(TEXTS).json()["daily_digest"])
        self.assertFalse(self.esi.get(TEXTS).json()["daily_digest"])
        self.assertFalse(self.kofi.client.patch(TEXTS, {"daily_digest": False}, format="json").json()["daily_digest"])

    def test_only_true_or_false(self):
        for value in ("yes", 1, None):
            response = self.kofi.client.patch(TEXTS, {"daily_digest": value}, format="json")
            self.assertEqual((response.status_code, list(response.json())), (400, ["daily_digest"]), value)

    def test_recent_texts_are_the_businesss_own_newest_first(self):
        first = paid_order(self.buyer, [(self.kofi.listing("120.00"), 1)])
        second = paid_order(self.buyer, [(self.kofi.listing("600.00"), 1), (self.esi.listing("50.00"), 1)])
        with self.captureOnCommitCallbacks(execute=True):
            release(first)
            release(second)
        recent = self.kofi.get(TEXTS).json()["recent"]
        self.assertEqual([(r["kind"], r["order"], r["status"], r["status_label"], r["to"]) for r in recent], [
            ("order_released", second.pk, "sent", "Sent", "020 *** 0001"),
            ("order_released", first.pk, "sent", "Sent", "020 *** 0001"),
        ])
        self.assertEqual([r["order"] for r in self.esi.get(TEXTS).json()["recent"]], [second.pk])

    def test_review_focus_a_business_with_no_ghana_mobile_is_told_plainly(self):
        BusinessOwner.objects.filter(pk=self.kofi.owner.pk).update(login_phone="+44 20 7946 0000")
        order = paid_order(self.buyer, [(self.kofi.listing("120.00"), 1)])
        with self.captureOnCommitCallbacks(execute=True):
            release(order)
        body = self.kofi.get(TEXTS).json()
        self.assertIsNone(body["phone"])
        self.assertIn("confirmed", body["note"])
        self.assertEqual(
            (body["recent"][0]["status"], body["recent"][0]["status_label"]),
            ("no_phone", "Not sent: no confirmed Ghana mobile number on your account"),
        )
        self.assertTrue(Notification.objects.filter(business_owner=self.kofi.owner, kind="vendor_money").exists())

    def test_review_focus_a_customer_with_the_same_id_cannot_read_or_change_them(self):
        twin = signed_in(self.twin(), "customer")
        self.assertEqual(twin.get(TEXTS).status_code, 403)
        self.assertEqual(twin.patch(TEXTS, {"daily_digest": True}, format="json").status_code, 403)
        self.assertFalse(VendorPreference.objects.exists())


@override_settings(LEDGER_ENABLED=True)
class DigestTests(VendorBase):
    def setUp(self):
        super().setUp()
        self.day = timezone.localdate() - timedelta(days=1)
        self.noon = timezone.make_aware(datetime.combine(self.day, time(12, 0)))

    def yesterday(self):
        return mock.patch("django.utils.timezone.now", return_value=self.noon)

    def test_review_focus_yesterdays_digest_goes_once_to_a_business_that_asked(self):
        VendorPreference.objects.create(business_owner=self.kofi.owner, daily_digest=True)
        VendorPreference.objects.create(business_owner=self.esi.owner, daily_digest=True)        # nothing moved for Esi
        with self.yesterday():
            sold = paid_order(self.buyer, [(self.kofi.listing("120.00"), 1)])
            paid_order(self.buyer, [(self.kofi.listing("600.00"), 1)])
            release(sold)
        paid_order(self.buyer, [(self.kofi.listing("80.00"), 1)])                                 # today: not in yesterday's digest
        with self.captureOnCommitCallbacks(execute=True):
            self.assertEqual(vendor_texts.queue_digests(self.day), 1)
            self.assertEqual(vendor_texts.queue_digests(self.day), 0)                            # a re-run adds nothing
        expected = (
            f"AshantiHub {self.day:%d %b}: 2 orders paid, items GHS 720.00. Released GHS 115.00, fees GHS 5.00, "
            "refunds GHS 0.00. Now Pending GHS 680.00, Available GHS 115.00."
        )
        self.assertEqual([(text.to, text.body) for text in senders.sms_outbox], [("+233201110001", expected)])
        copies = Notification.objects.filter(business_owner=self.kofi.owner, title=f"Your AshantiHub day, {self.day:%d %b}")
        self.assertEqual([copy.body for copy in copies], [expected])

    def test_a_business_that_did_not_ask_gets_none(self):
        with self.yesterday():
            paid_order(self.buyer, [(self.kofi.listing("120.00"), 1)])
        self.assertEqual(vendor_texts.queue_digests(self.day), 0)
        self.assertFalse(VendorText.objects.filter(kind=VendorText.DAILY_DIGEST).exists())

    def test_the_digest_job_is_a_no_op_with_the_ledger_off_and_both_jobs_are_scheduled(self):
        VendorPreference.objects.create(business_owner=self.kofi.owner, daily_digest=True)
        with self.yesterday():
            paid_order(self.buyer, [(self.kofi.listing("120.00"), 1)])
        with override_settings(LEDGER_ENABLED=False):
            self.assertEqual(tasks.queue_vendor_digests(), 0)
        self.assertEqual(tasks.queue_vendor_digests(), 1)
        scheduled = {entry["task"] for entry in settings.CELERY_BEAT_SCHEDULE.values()}
        self.assertTrue({"wallets.tasks.send_due_vendor_texts", "wallets.tasks.queue_vendor_digests"} <= scheduled)

    def test_review_focus_a_payment_at_2359_is_in_the_day_and_one_at_0001_is_in_the_next(self):
        VendorPreference.objects.create(business_owner=self.kofi.owner, daily_digest=True)
        accra = ZoneInfo("Africa/Accra")
        with mock.patch("django.utils.timezone.now", return_value=datetime.combine(self.day, time(23, 59), tzinfo=accra)):
            paid_order(self.buyer, [(self.kofi.listing("120.00"), 1)])
        with mock.patch("django.utils.timezone.now", return_value=datetime.combine(self.day + timedelta(days=1), time(0, 1), tzinfo=accra)):
            paid_order(self.buyer, [(self.kofi.listing("600.00"), 1)])
        with self.captureOnCommitCallbacks(execute=True):
            self.assertEqual(vendor_texts.queue_digests(self.day), 1)
        body = senders.sms_outbox[-1].body
        self.assertIn("1 order paid, items GHS 120.00", body)
        self.assertNotIn("600.00 ", body.split("Now Pending")[0])

    def test_a_second_run_after_the_first_with_its_notice_adds_nothing(self):
        VendorPreference.objects.create(business_owner=self.kofi.owner, daily_digest=True)
        with self.yesterday():
            paid_order(self.buyer, [(self.kofi.listing("120.00"), 1)])
        with self.captureOnCommitCallbacks(execute=True):
            self.assertEqual(vendor_texts.queue_digests(self.day), 1)
        text = VendorText.objects.get(kind=VendorText.DAILY_DIGEST)
        self.assertIsNotNone(text.notification_id)
        self.assertEqual(vendor_texts.queue_digests(self.day), 0)
        self.assertEqual(Notification.objects.filter(business_owner=self.kofi.owner, kind="vendor_money").count(), 1)

    def test_a_run_that_finds_the_text_already_queued_without_a_notice_makes_exactly_one_notice(self):
        """The overlap case: another run queued the text but has not yet made the notice."""
        VendorPreference.objects.create(business_owner=self.kofi.owner, daily_digest=True)
        with self.yesterday():
            paid_order(self.buyer, [(self.kofi.listing("120.00"), 1)])
        with self.captureOnCommitCallbacks(execute=True):
            self.assertEqual(vendor_texts.queue_digests(self.day), 1)
        VendorText.objects.filter(kind=VendorText.DAILY_DIGEST).update(notification=None)
        Notification.objects.all().delete()
        with self.captureOnCommitCallbacks(execute=True):
            vendor_texts.queue_digests(self.day)
            vendor_texts.queue_digests(self.day)
        self.assertEqual(VendorText.objects.filter(kind=VendorText.DAILY_DIGEST).count(), 1)
        self.assertEqual(Notification.objects.filter(business_owner=self.kofi.owner, kind="vendor_money").count(), 1)


@override_settings(LEDGER_ENABLED=True)
class DigestConcurrencyTests(TransactionTestCase):
    """Two runs at once (the beat entry and a manual run), each on its own connection."""
    serialized_rollback = True

    def test_two_overlapping_runs_give_one_text_and_one_notice(self):
        from .vendor_helpers import Shop, customer

        shop, buyer = Shop("Kofi Mensah", "+233201110001"), customer()
        senders.sms_outbox.clear()
        day = timezone.localdate() - timedelta(days=1)
        noon = timezone.make_aware(datetime.combine(day, time(12, 0)))
        VendorPreference.objects.create(business_owner=shop.owner, daily_digest=True)
        with mock.patch("django.utils.timezone.now", return_value=noon):
            paid_order(buyer, [(shop.listing("120.00"), 1)])
        barrier, results, errors = threading.Barrier(2), [], []

        def run():
            try:
                barrier.wait(timeout=10)
                results.append(vendor_texts.queue_digests(day))
            except Exception as exc:  # noqa: BLE001
                errors.append(exc)
            finally:
                connection.close()

        threads = [threading.Thread(target=run) for _ in range(2)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=30)
        self.assertEqual(errors, [])
        self.assertEqual(sum(results), 1)
        self.assertEqual(VendorText.objects.filter(kind=VendorText.DAILY_DIGEST).count(), 1)
        self.assertEqual(Notification.objects.filter(business_owner=shop.owner, kind="vendor_money").count(), 1)
