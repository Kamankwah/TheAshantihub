"""End of day for third-party riders (wallets Plan 5, Task 3; spec §1 row 5, §2.2 step 6): each earlier day's reserve goes
to platform commission income exactly once, with the day's deliveries, gross, commission and net recorded; a missed
night is caught up. Review Focus 3."""
import threading
import time
from unittest import mock
from datetime import timedelta

from django.conf import settings
from django.db import connection, transaction
from django.test import TransactionTestCase, override_settings
from django.utils import timezone

from delivery.models import Rider, RiderCommissionPosting, RiderEarning
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
        FulfilmentCheck.objects.update_or_create(order=order, defaults=dict(outcome=FulfilmentCheck.MATCHES))
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

    def test_a_reversed_earning_is_never_posted(self):
        swift = rider_helpers.rider()
        earning = self.delivered(swift, self.yesterday)
        RiderEarning.objects.filter(pk=earning.pk).update(reversed_at=timezone.now())
        self.assertEqual(riders.post_commission(today=self.today), 0)
        # a refund that reversed it after the job listed the day: post_day itself must skip it under the lock
        self.assertIsNone(riders.post_day(swift.pk, earning.earned_on))
        self.assertFalse(RiderCommissionPosting.objects.exists())
        self.assertEqual(self.balance(Account.PLATFORM_COMMISSION_INCOME), 0)

    def test_a_late_credit_for_an_already_posted_day_gets_its_own_row_and_key(self):
        swift = rider_helpers.rider()
        self.delivered(swift, self.yesterday)
        self.assertEqual(riders.post_commission(today=self.today), 1)
        self.delivered(swift, self.yesterday, fee="20.00")
        self.assertEqual(riders.post_commission(today=self.today), 1)
        rows = list(RiderCommissionPosting.objects.order_by("pk"))
        self.assertEqual([row.day for row in rows], [self.yesterday.date()] * 2)
        self.assertEqual([row.commission_pesewas for row in rows], [100, 200])
        self.assertNotEqual(rows[0].journal.key, rows[1].journal.key)
        self.assertEqual(self.balance(Account.PLATFORM_COMMISSION_INCOME), 300)

    def test_the_accra_day_boundary(self):
        swift = rider_helpers.rider()
        midnight = timezone.localtime().replace(hour=0, minute=0, second=0, microsecond=0)
        last_second = rider_helpers.earning(swift, gross=1000, at=midnight - timedelta(seconds=1))
        first_second = rider_helpers.earning(swift, gross=1000, at=midnight)
        self.assertEqual((last_second.earned_on, first_second.earned_on), (midnight.date() - timedelta(days=1), midnight.date()))
        self.assertEqual(riders.post_commission(today=midnight.date()), 1)
        self.assertEqual(RiderCommissionPosting.objects.get().day, midnight.date() - timedelta(days=1))
        tomorrow = midnight + timedelta(days=1, hours=1)
        self.assertEqual(riders.post_commission(today=tomorrow.date(), now=tomorrow), 1)

    def test_one_failing_rider_day_does_not_stop_the_others_but_fails_the_job(self):
        first, second = rider_helpers.rider("a@example.com"), rider_helpers.rider(
            "b@example.com", name="Yaw Boateng", phone="+233244000003", company="Fast Riders")
        self.delivered(first, self.yesterday)
        self.delivered(second, self.yesterday)
        real = riders.post_day

        def flaky(rider_id, day, now=None):
            if rider_id == first.pk:
                raise RuntimeError("the ledger refused")
            return real(rider_id, day, now)

        with mock.patch.object(riders, "post_day", flaky), self.assertLogs("ledger.riders", "ERROR"):
            with self.assertRaises(RuntimeError) as caught:
                riders.post_commission(today=self.today)
        self.assertIn("1 rider-day", str(caught.exception))
        self.assertEqual(list(RiderCommissionPosting.objects.values_list("rider_id", flat=True)), [second.pk])
        self.assertEqual(self.balance(Account.RIDER_RESERVE, first.staff), 100)

    def test_post_day_refuses_today_and_the_future(self):
        swift = rider_helpers.rider()
        self.delivered(swift, timezone.now())
        for day in (self.today, self.today + timedelta(days=1)):
            with self.assertRaises(ValueError):
                riders.post_day(swift.pk, day)
        self.assertFalse(RiderCommissionPosting.objects.exists())

    def test_the_memo_says_delivery_or_deliveries(self):
        swift = rider_helpers.rider()
        self.delivered(swift, self.yesterday)
        riders.post_commission(today=self.today)
        self.assertEqual(RiderCommissionPosting.objects.get().journal.memo, f"Commission on 1 delivery of {self.yesterday:%Y-%m-%d}")


@override_settings(LEDGER_ENABLED=True)
class ConcurrentEndOfDayTests(TransactionTestCase):
    """The end-of-day posting takes the rider row first (rider row -> earning rows -> accounts), because its commit checks
    the foreign key to the rider, which waits for a FOR UPDATE holder, while release and the switch back take the rider
    row and then want the reserve. Deterministic: one session holds the rider row, the posting is shown waiting in its
    SELECT on the rider (not in its COMMIT), then the holder takes the reserve and commits."""

    serialized_rollback = True

    @staticmethod
    def a_session_is_waiting_in_a_select_on_the_rider_row(timeout=6.0):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            with connection.cursor() as cursor:
                cursor.execute("SELECT pg_stat_clear_snapshot()")
                cursor.execute("SELECT query FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'")
                if any(query.lstrip().upper().startswith("SELECT") and "delivery_rider" in query for (query,) in cursor.fetchall()):
                    return True
            time.sleep(0.05)
        return False

    def start(self, *targets):
        errors = []

        def wrap(target):
            def run():
                try:
                    target()
                except Exception as exc:  # reported below, never swallowed
                    errors.append(exc)
                finally:
                    connection.close()
            return run

        threads = [threading.Thread(target=wrap(target)) for target in targets]
        for thread in threads:
            thread.start()
        return threads, errors

    def finish(self, threads):
        for thread in threads:
            thread.join(timeout=15)
            self.assertFalse(thread.is_alive(), "a racing thread hung")

    def test_review_focus_the_posting_waits_for_the_rider_row_before_the_accounts(self):
        swift = rider_helpers.rider()
        yesterday = timezone.now() - timedelta(days=1)
        for gross in (1000, 2000):
            rider_helpers.earning(swift, gross=gross, at=yesterday)
        day = timezone.localdate(yesterday)
        reserve = riders.accounts_of(swift)[1]
        holding, may_take_reserve, results = threading.Event(), threading.Event(), []

        def release_like_holder():
            with transaction.atomic():
                Rider.objects.select_for_update(of=("self",)).get(pk=swift.pk)
                holding.set()
                may_take_reserve.wait(timeout=15)
                posting.lock(reserve)

        def end_of_day():
            holding.wait(timeout=15)
            results.append(riders.post_day(swift.pk, day))

        (holder, poster), errors = self.start(release_like_holder, end_of_day)
        holding.wait(timeout=15)
        self.assertTrue(self.a_session_is_waiting_in_a_select_on_the_rider_row(), "the posting did not wait for the rider row up front")
        may_take_reserve.set()
        self.finish([holder, poster])
        self.assertEqual(errors, [])
        self.assertEqual(sum(1 for result in results if result is not None), 1)
        self.assertEqual(RiderCommissionPosting.objects.count(), 1)
        self.assertEqual(posting.balance_of(Account.RIDER_RESERVE, swift.staff), 0)
        self.assertEqual(posting.balance_of(Account.PLATFORM_COMMISSION_INCOME), 300)

    def test_review_focus_two_runs_at_once_post_once(self):
        """Run B waits behind run A's rider lock, then finds nothing left to post."""
        swift = rider_helpers.rider()
        yesterday = timezone.now() - timedelta(days=1)
        for gross in (1000, 2000):
            rider_helpers.earning(swift, gross=gross, at=yesterday)
        day = timezone.localdate(yesterday)
        holding, may_finish, results = threading.Event(), threading.Event(), []

        def run_a():
            with transaction.atomic():
                Rider.objects.select_for_update(of=("self",)).get(pk=swift.pk)
                holding.set()
                may_finish.wait(timeout=15)
                results.append(riders.post_day(swift.pk, day))

        def run_b():
            holding.wait(timeout=15)
            results.append(riders.post_day(swift.pk, day))

        (a, b), errors = self.start(run_a, run_b)
        holding.wait(timeout=15)
        self.assertTrue(self.a_session_is_waiting_in_a_select_on_the_rider_row())
        may_finish.set()
        self.finish([a, b])
        self.assertEqual(errors, [])
        self.assertEqual(sum(1 for result in results if result is not None), 1)
        self.assertEqual(RiderCommissionPosting.objects.count(), 1)
        self.assertEqual(posting.balance_of(Account.PLATFORM_COMMISSION_INCOME), 300)
