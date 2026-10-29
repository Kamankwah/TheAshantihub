"""Catalogue plan 6, Task 7: low-stock and sold-out alerts, told once per crossing and re-armed only by a restock
(spec §1 row 15). Review Focus 3."""
from datetime import timedelta

from unittest import mock

from django.conf import settings
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.test import TestCase, override_settings
from django.utils import timezone

from catalogue import alerts, stock, tasks
from catalogue.models import StockAlertState
from catalogue.tests.helpers import business, go_live, product, sell, service
from listings.models import Listing
from notifications.models import Notification
from orders.models import Order


def set_stock(listing, value):
    Listing.objects.filter(pk=listing.pk).update(stock_quantity=value)


@override_settings(STOCK_ALERTS_ENABLED=True)
class AlertTests(TestCase):
    def setUp(self):
        self.owner = business()

    def notices(self, kind):
        return list(Notification.objects.filter(business_owner=self.owner, kind=kind))

    def test_review_focus_low_is_told_once_until_restocked(self):
        listing = product(self.owner, "Milo 400g", stock=5)
        self.assertEqual(alerts.run(), 1)
        self.assertEqual(alerts.run(), 0)                                          # still low: nothing more
        [notice] = self.notices(alerts.LOW)
        self.assertEqual(notice.title, "Running low")
        self.assertIn("“Milo 400g”", notice.body)
        set_stock(listing, 30)
        self.assertEqual(alerts.run(), 0)                                          # restocked: re-armed, nothing sent
        set_stock(listing, 4)
        self.assertEqual(alerts.run(), 1)
        self.assertEqual(len(self.notices(alerts.LOW)), 2)

    def test_sold_out_is_told_once_and_a_partial_restock_says_nothing(self):
        listing = product(self.owner, "Milo 400g", stock=0)
        self.assertEqual(alerts.run(), 1)
        self.assertEqual((len(self.notices(alerts.SOLD_OUT)), self.notices(alerts.LOW)), (1, []))   # sold out says it all
        set_stock(listing, 2)
        self.assertEqual(alerts.run(), 0)                                          # still low, already told at 0
        set_stock(listing, 0)
        self.assertEqual(alerts.run(), 1)                                          # sold out again
        self.assertEqual(len(self.notices(alerts.SOLD_OUT)), 2)

    def test_review_focus_a_drifting_sales_rate_never_repeats_the_alert(self):
        listing = go_live(product(self.owner, "Nido", stock=6), 60)
        order = sell(listing, 28, days_ago=10)                                     # 1 a day: 6 days left, low
        self.assertEqual(alerts.run(), 1)
        Order.objects.filter(pk=order.pk).update(placed_at=timezone.now() - timedelta(days=40))
        self.assertEqual(alerts.run(), 0)                                          # no sales now: 6 > 5, not restocked
        set_stock(listing, 5)
        self.assertEqual(alerts.run(), 0)                                          # low again, already told
        set_stock(listing, 20)
        self.assertEqual(alerts.run(), 0)                                          # a restock re-arms it
        set_stock(listing, 5)
        self.assertEqual(alerts.run(), 1)

    def test_review_focus_two_runs_at_once_tell_once(self):
        listing = product(self.owner, "Milo", stock=3)
        StockAlertState.objects.create(listing=listing)
        stale = StockAlertState.objects.get(listing=listing)                       # both runs read it before either moved
        cover, now = stock.cover_of(listing), timezone.now()
        self.assertEqual(alerts.move_state(stale, cover, now), alerts.LOW)
        self.assertIsNone(alerts.move_state(stale, cover, now))                    # the conditional update finds it moved

    def test_two_runs_at_once_tell_a_sold_out_offer_once(self):
        listing = product(self.owner, "Milo", stock=0)
        StockAlertState.objects.create(listing=listing)
        stale = StockAlertState.objects.get(listing=listing)
        cover, now = stock.cover_of(listing), timezone.now()
        self.assertEqual(alerts.move_state(stale, cover, now), alerts.SOLD_OUT)
        self.assertIsNone(alerts.move_state(stale, cover, now))

    def test_sold_out_then_a_full_restock_re_arms_low_and_low_is_told_again(self):
        listing = product(self.owner, "Milo", stock=3)
        self.assertEqual(alerts.run(), 1)                                          # low at 3
        set_stock(listing, 0)
        self.assertEqual(alerts.run(), 1)                                          # sold out
        set_stock(listing, 10)
        self.assertEqual(alerts.run(), 0)                                          # restocked: both re-armed
        set_stock(listing, 3)
        self.assertEqual(alerts.run(), 1)                                          # low told again
        self.assertEqual((len(self.notices(alerts.LOW)), len(self.notices(alerts.SOLD_OUT))), (2, 1))

    def test_a_business_with_a_sold_out_and_a_low_offer_gets_exactly_two_notices(self):
        product(self.owner, "Empty", stock=0)
        product(self.owner, "Nearly", stock=2)
        self.assertEqual(alerts.run(), 2)
        self.assertEqual((len(self.notices(alerts.LOW)), len(self.notices(alerts.SOLD_OUT))), (1, 1))
        self.assertEqual(Notification.objects.filter(business_owner=self.owner).count(), 2)

    def test_a_steady_hour_costs_the_same_queries_however_many_offers(self):
        for n in range(3):
            product(self.owner, f"Fine {n}", stock=50)
        alerts.run()                                                               # creates the state rows
        with CaptureQueriesContext(connection) as few:
            alerts.run()
        for n in range(3):
            product(self.owner, f"More {n}", stock=50)
        alerts.run()
        with CaptureQueriesContext(connection) as many:
            alerts.run()
        self.assertEqual(len(many), len(few))
        self.assertFalse([q for q in many.captured_queries if q["sql"].lstrip().upper().startswith(("INSERT", "UPDATE"))])

    def test_state_rows_are_inserted_before_the_runs_transaction_opens(self):
        product(self.owner, "Milo", stock=3)
        with CaptureQueriesContext(connection) as ctx:
            alerts.run()
        sqls = [q["sql"] for q in ctx.captured_queries]
        insert = next(i for i, sql in enumerate(sqls) if sql.startswith("INSERT") and "catalogue_stockalertstate" in sql)
        savepoint = next(i for i, sql in enumerate(sqls) if sql.startswith("SAVEPOINT"))
        self.assertLess(insert, savepoint)                                          # the run's atomic block comes after

    def test_the_low_notice_names_the_needs_restocking_screen(self):
        product(self.owner, "Milo", stock=3)
        alerts.run()
        [notice] = self.notices(alerts.LOW)
        self.assertEqual(notice.body, "“Milo” is running low. See Needs restocking under Products in your dashboard.")

    def test_one_notice_per_business_naming_its_offers(self):
        for n in range(7):
            product(self.owner, f"Item {n}", stock=1)
        rival = business("Rival Mart")
        product(rival, "Rival item", stock=1)
        self.assertEqual(alerts.run(), 8)
        [notice] = self.notices(alerts.LOW)
        self.assertEqual(notice.title, "7 products running low")
        self.assertIn("and 2 more", notice.body)
        self.assertEqual(Notification.objects.filter(business_owner=rival, kind=alerts.LOW).count(), 1)

    def test_a_run_that_dies_part_way_leaves_every_state_as_it_was(self):
        product(self.owner, "Milo", stock=3)
        with mock.patch("catalogue.alerts.tell", side_effect=RuntimeError("worker killed")), self.assertRaises(RuntimeError):
            alerts.run()
        self.assertFalse(StockAlertState.objects.filter(low_alerted_at__isnull=False).exists())   # nothing marked told
        self.assertEqual(alerts.run(), 1)                                          # the next run tells it

    def test_the_sold_out_notice_claims_hiding_only_while_hiding_is_on(self):
        product(self.owner, "Milo 400g", stock=0)
        with override_settings(SOLD_OUT_HIDDEN_ENABLED=False):
            alerts.run()
        [notice] = self.notices(alerts.SOLD_OUT)
        self.assertEqual(notice.body, "“Milo 400g” has sold out. Restock to keep selling.")
        Notification.objects.all().delete()
        StockAlertState.objects.all().delete()
        with override_settings(SOLD_OUT_HIDDEN_ENABLED=True):
            alerts.run()
        [notice] = self.notices(alerts.SOLD_OUT)
        self.assertIn("no longer shows in search", notice.body)

    def test_changing_the_own_line_re_arms_the_low_alert(self):
        listing = product(self.owner, "Milo", stock=4)
        self.assertEqual(alerts.run(), 1)
        stock.set_own_line(listing, 10)
        self.assertEqual(alerts.run(), 1)                                          # 4 <= 10: told against the new line

    def test_a_line_saved_mid_run_is_not_recorded_against_the_old_line(self):
        listing = product(self.owner, "Milo", stock=4)
        StockAlertState.objects.create(listing=listing)
        stale = StockAlertState.objects.get(listing=listing)                       # measured against the default line
        stock.set_own_line(listing, 10)                                            # saved just before the update
        self.assertIsNone(alerts.move_state(stale, stock.cover_of(listing), timezone.now()))
        self.assertIsNone(StockAlertState.objects.get(listing=listing).low_alerted_at)

    def test_a_line_saved_mid_run_is_told_against_the_new_line_next_run(self):
        listing = product(self.owner, "Milo", stock=4)
        StockAlertState.objects.create(listing=listing)
        stale = StockAlertState.objects.get(listing=listing)
        old_cover = stock.measure_many([listing], lines={})[listing.pk]            # measured against the default line 5
        self.assertTrue(old_cover.low)
        stock.set_own_line(listing, 2)                                             # saved mid-run: 4 > 2, not low
        self.assertIsNone(alerts.move_state(stale, old_cover, timezone.now()))     # nothing recorded against the old line
        self.assertIsNone(alerts.move_state(stale, stock.measure_many([listing])[listing.pk], timezone.now()))
        self.assertEqual(alerts.run(), 0)
        set_stock(listing, 2)
        self.assertEqual(alerts.run(), 1)                                          # 2 <= 2: told against the new line

    def test_offers_that_are_never_measured(self):
        product(business("Suspended", suspended=True), stock=0)
        product(self.owner, "Draft", stock=0, status=Listing.DRAFT)
        product(self.owner, "Uncounted", stock=None)
        set_stock(service(self.owner), 0)
        self.assertEqual(alerts.run(), 0)
        self.assertFalse(Notification.objects.exists())


class SwitchedOffTests(TestCase):
    def test_nothing_is_measured_or_sent_while_switched_off(self):
        product(business(), stock=0)
        self.assertEqual(alerts.run(), 0)
        self.assertFalse(Notification.objects.exists())
        self.assertFalse(StockAlertState.objects.exists())


class JobTests(TestCase):
    def test_the_hourly_job_is_scheduled(self):
        entry = settings.CELERY_BEAT_SCHEDULE["catalogue-stock-alerts"]
        self.assertEqual(entry["task"], "catalogue.tasks.check_stock_alerts")
        self.assertEqual((str(entry["schedule"]._orig_minute), str(entry["schedule"]._orig_hour)), ("35", "*"))

    @override_settings(STOCK_ALERTS_ENABLED=True)
    def test_the_task_runs_the_check(self):
        product(business(), stock=0)
        self.assertEqual(tasks.check_stock_alerts(), 1)
