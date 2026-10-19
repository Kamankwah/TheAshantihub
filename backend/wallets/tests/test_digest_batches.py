"""The daily digest in batches with a time budget, and the 10:00 catch-up (wallet rulings 7D, Task 4). Review focus: a run
killed at 07:00 and restarted later gives each business exactly one digest; batches cover everyone exactly once; a deadline
stops the run and the returned cursor resumes it."""
import time as clock
from datetime import datetime, time, timedelta
from unittest import mock

from django.conf import settings
from django.test import override_settings
from django.utils import timezone

from accounts.models import BusinessOwner
from otp import senders
from wallets import tasks, vendor_texts
from wallets.models import VendorPreference, VendorText

from .vendor_helpers import Shop, VendorBase, paid_order


@override_settings(LEDGER_ENABLED=True)
class DigestBatchTests(VendorBase):
    def setUp(self):
        super().setUp()
        self.day = timezone.localdate() - timedelta(days=1)
        noon = timezone.make_aware(datetime.combine(self.day, time(12, 0)))
        self.shops = [self.kofi, self.esi] + [Shop(f"Shop {n}", f"+23320111010{n}") for n in range(3)]
        with mock.patch("django.utils.timezone.now", return_value=noon):
            for shop in self.shops:
                VendorPreference.objects.create(business_owner=shop.owner, daily_digest=True)
                paid_order(self.buyer, [(shop.listing("100.00"), 1)])
        senders.sms_outbox.clear()

    def digests(self):
        return list(VendorText.objects.filter(kind=VendorText.DAILY_DIGEST).values_list("business_owner_id", flat=True))

    def pks(self):
        return sorted(shop.owner.pk for shop in self.shops)

    def test_batches_cover_everyone_exactly_once(self):
        cursor, calls = 0, 0
        with self.captureOnCommitCallbacks(execute=True):
            while True:
                calls += 1
                cursor = vendor_texts.queue_digests(self.day, after_pk=cursor, batch=2)
                if cursor is None:
                    break
        self.assertEqual(calls, 3)
        self.assertEqual(sorted(self.digests()), self.pks())
        self.assertEqual(len(senders.sms_outbox), 5)

    def test_deadline_stops_and_cursor_resumes(self):
        with self.captureOnCommitCallbacks(execute=True):
            cursor = vendor_texts.queue_digests(self.day, deadline=clock.monotonic() - 1)  # already past: one business, then stop
            self.assertEqual(cursor, self.pks()[0])
            self.assertEqual(self.digests(), [self.pks()[0]])
            self.assertIsNone(vendor_texts.queue_digests(self.day, after_pk=cursor, deadline=clock.monotonic() + 600))
        self.assertEqual(sorted(self.digests()), self.pks())

    def test_batch_size_and_budget_come_from_the_money_settings(self):
        with mock.patch("ledger.settings_store.current", side_effect=lambda key, at=None: {"digest_batch_size": 3, "digest_time_budget_seconds": 600}[key]):
            cursor = vendor_texts.queue_digests(self.day)
        self.assertEqual(cursor, self.pks()[2])
        self.assertEqual(len(self.digests()), 3)

    def test_a_suspended_business_is_skipped(self):
        BusinessOwner.objects.filter(pk=self.esi.owner.pk).update(is_suspended=True)
        with self.captureOnCommitCallbacks(execute=True):
            self.assertIsNone(vendor_texts.queue_digests(self.day))
        self.assertEqual(sorted(self.digests()), sorted(set(self.pks()) - {self.esi.owner.pk}))

    def test_the_task_carries_its_cursor_on_to_the_next_batch(self):
        with mock.patch("ledger.settings_store.current", side_effect=lambda key, at=None: {"digest_batch_size": 2, "digest_time_budget_seconds": 600}[key]):
            with self.captureOnCommitCallbacks(execute=True):
                tasks.queue_vendor_digests()  # eager here: each batch enqueues the next
        self.assertEqual(sorted(self.digests()), self.pks())

    def test_catch_up_sends_missed_day_once(self):
        """07:00 died after two businesses; 10:00 finishes the rest and nobody gets a second text."""
        with self.captureOnCommitCallbacks(execute=True):
            vendor_texts.queue_digests(self.day, batch=2)  # the killed run, never re-enqueued
            self.assertEqual(len(self.digests()), 2)
            tasks.catch_up_digests()
        self.assertEqual(sorted(self.digests()), self.pks())
        self.assertEqual(len(senders.sms_outbox), 5)

    def test_rerun_adds_nothing(self):
        with self.captureOnCommitCallbacks(execute=True):
            tasks.queue_vendor_digests()
        before = len(senders.sms_outbox)
        with self.captureOnCommitCallbacks(execute=True):
            tasks.catch_up_digests()
            tasks.queue_vendor_digests()
        self.assertEqual((before, len(senders.sms_outbox), len(self.digests())), (5, 5, 5))

    def test_catch_up_is_scheduled_at_ten_accra_and_is_off_with_the_ledger(self):
        entry = next(e for e in settings.CELERY_BEAT_SCHEDULE.values() if e["task"] == "wallets.tasks.catch_up_digests")
        self.assertEqual((entry["schedule"].hour, entry["schedule"].minute), ({10}, {0}))
        with override_settings(LEDGER_ENABLED=False):
            self.assertEqual(tasks.catch_up_digests(), 0)
        self.assertEqual(self.digests(), [])
