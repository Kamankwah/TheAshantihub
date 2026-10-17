"""End of day for third-party riders (wallets Plan 5, Task 3; spec §1 row 5, §2.2 step 6): each earlier day's reserve goes
to platform commission income exactly once, with the day's deliveries, gross, commission and net recorded; a missed
night is caught up. Review Focus 3."""
import threading
from datetime import timedelta

from django.conf import settings
from django.db import connection
from django.test import TransactionTestCase, override_settings
from django.utils import timezone

from delivery.models import RiderCommissionPosting, RiderEarning
from ledger import escrow, posting, riders, tasks
from ledger.models import Account, FulfilmentCheck, MoneySetting

from . import rider_helpers
from .test_refunds import RefundBase


@override_settings(LEDGER_ENABLED=True)
class EndOfDayTests(RefundBase):
    def setUp(self):
        super().setUp()
        self.kofi = self.owner("Kofi")
        self.today = timezone.localdate()
        self.yesterday = timezone.localtime().replace(hour=12, minute=0, second=0, microsecond=0) - timedelta(days=1)

    def delivered(self, by, at, fee="10.00"):
        """An order `by` delivered an hour before `at`, released by Support's call at `at`."""
        order = self.paid([(self.listing(self.kofi, "60.00"), 1)], delivery=fee)
        rider_helpers.delivered_by(order, by, at=at - timedelta(hours=1))
        FulfilmentCheck.objects.create(order=order, outcome=FulfilmentCheck.MATCHES)
        escrow.release_verified(order, now=at)
        return RiderEarning.objects.get(order=order)

    def test_review_focus_end_of_day_posts_each_riders_reserve_once(self):
        swift = rider_helpers.rider("swift@example.com")
        fast = rider_helpers.rider("fast@example.com", name="Yaw Boateng", phone="+233244000003", company="Fast Riders")
        self.delivered(swift, self.yesterday)
        self.delivered(swift, self.yesterday, fee="20.00")
        self.delivered(fast, self.yesterday)
        self.assertEqual(riders.post_commission(today=self.today), 2)
        self.assertEqual(self.balance(Account.RIDER_RESERVE, swift.staff), 0)
        self.assertEqual(self.balance(Account.RIDER_RESERVE, fast.staff), 0)
        self.assertEqual(self.balance(Account.PLATFORM_COMMISSION_INCOME), 400)                # 100 + 200 + 100
        self.assertEqual(self.balance(Account.RIDER_BALANCE, swift.staff), 2700)               # untouched: 900 + 1800
        row = RiderCommissionPosting.objects.get(rider=swift)
        self.assertEqual(
            (row.day, row.deliveries, row.gross_pesewas, row.commission_pesewas, row.net_pesewas),
            (self.yesterday.date(), 2, 3000, 300, 2700),
        )
        self.assertEqual(row.journal.kind, "rider_commission")
        self.assertFalse(RiderEarning.objects.filter(commission_posting__isnull=True).exists())
        self.assertEqual(riders.post_commission(today=self.today), 0)                          # a second run posts nothing
        self.assertEqual(RiderCommissionPosting.objects.count(), 2)
        self.assertEqual(self.balance(Account.PLATFORM_COMMISSION_INCOME), 400)

    def test_todays_deliveries_wait_for_the_end_of_the_day(self):
        swift = rider_helpers.rider()
        self.delivered(swift, timezone.now())
        self.assertEqual(riders.post_commission(today=self.today), 0)
        self.assertEqual(self.balance(Account.RIDER_RESERVE, swift.staff), 100)

    def test_review_focus_a_missed_night_is_caught_up_day_by_day(self):
        swift = rider_helpers.rider()
        self.delivered(swift, self.yesterday - timedelta(days=1))
        self.delivered(swift, self.yesterday)
        self.assertEqual(riders.post_commission(today=self.today), 2)
        self.assertEqual(
            sorted(RiderCommissionPosting.objects.values_list("day", flat=True)),
            [self.yesterday.date() - timedelta(days=1), self.yesterday.date()],
        )
        self.assertEqual(self.balance(Account.PLATFORM_COMMISSION_INCOME), 200)

    def test_a_zero_rate_records_the_day_without_a_journal(self):
        MoneySetting.objects.create(key="rider_commission_bp", value=0, effective_from=timezone.now() - timedelta(days=60))
        swift = rider_helpers.rider()
        earning = self.delivered(swift, self.yesterday)
        self.assertEqual((earning.reserve_pesewas, earning.net_pesewas), (0, 1000))
        self.assertEqual(riders.post_commission(today=self.today), 1)
        row = RiderCommissionPosting.objects.get()
        self.assertEqual((row.gross_pesewas, row.commission_pesewas, row.net_pesewas, row.journal), (1000, 0, 1000, None))

    def test_the_job_runs_after_midnight_and_does_nothing_with_the_ledger_off(self):
        entry = settings.CELERY_BEAT_SCHEDULE["ledger-post-rider-commission"]
        self.assertEqual(entry["task"], "ledger.tasks.post_rider_commission")
        self.assertEqual((entry["schedule"].hour, entry["schedule"].minute), ({0}, {20}))
        swift = rider_helpers.rider()
        self.delivered(swift, self.yesterday)
        with override_settings(LEDGER_ENABLED=False):
            self.assertEqual(tasks.post_rider_commission(), 0)
        self.assertEqual(tasks.post_rider_commission(), 1)
        self.assertEqual(posting.balance_of(Account.RIDER_RESERVE, swift.staff), 0)


class ConcurrentEndOfDayTests(TransactionTestCase):
    serialized_rollback = True

    def test_review_focus_two_runs_at_once_post_once(self):
        swift = rider_helpers.rider()
        yesterday = timezone.now() - timedelta(days=1)
        for gross in (1000, 2000):
            rider_helpers.earning(swift, gross=gross, at=yesterday)
        day = timezone.localdate(yesterday)
        results, errors, barrier = [], [], threading.Barrier(2)

        def run():
            try:
                barrier.wait()
                results.append(riders.post_day(swift.pk, day))
            except Exception as exc:  # reported below, never swallowed
                errors.append(exc)
            finally:
                connection.close()

        threads = [threading.Thread(target=run) for _ in range(2)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=10)
            self.assertFalse(thread.is_alive(), "a racing thread hung")
        self.assertEqual(errors, [])
        self.assertEqual(sum(1 for result in results if result is not None), 1)
        self.assertEqual(RiderCommissionPosting.objects.count(), 1)
        self.assertEqual(posting.balance_of(Account.RIDER_RESERVE, swift.staff), 0)
        self.assertEqual(posting.balance_of(Account.PLATFORM_COMMISSION_INCOME), 300)
