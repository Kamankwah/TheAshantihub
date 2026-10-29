"""Catalogue plan 6, Task 6: days of stock left, the low-stock line, the governed numbers, the business's "needs
restocking" list and its own line per offer (spec §1 row 15, §3.3, §10). Review Focus 2 (thin or odd history) and 5
(another business's listing)."""
from datetime import timedelta
from decimal import Decimal
from types import SimpleNamespace

from django.db import connection
from django.test import TestCase, override_settings
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APIClient

from catalogue import stock
from catalogue.models import StockAlertState
from catalogue.tests.helpers import as_account, as_staff, business, buyer, go_live, product, sell, service
from ledger import approval_kinds, settings_store
from ledger.models import MoneySetting
from listings.models import Listing
from orders.models import Order


CEILING = 8                                                                          # queries for the stock list


class StockSettingsTests(TestCase):
    def test_defaults_and_bounds(self):
        self.assertEqual(
            [settings_store.current(key) for key in (stock.COVER_DAYS, stock.FALLBACK_UNITS, stock.WINDOW_DAYS)],
            [7, 5, 28],
        )
        for key, raw in (
            (stock.COVER_DAYS, 0), (stock.COVER_DAYS, 91), (stock.WINDOW_DAYS, 6), (stock.FALLBACK_UNITS, -1),
            (stock.FALLBACK_UNITS, None),
        ):
            with self.subTest(key=key, raw=raw), self.assertRaises(settings_store.SettingError):
                settings_store.clean(key, raw)

    def test_they_change_only_through_the_money_setting_approval(self):
        client = APIClient()
        as_staff(client, "accountant", "kofi@example.com")
        response = client.post("/api/ledger/settings/", {"key": stock.COVER_DAYS, "value": 10}, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(settings_store.current(stock.COVER_DAYS), 7)                    # waits for a Super Admin
        from approvals.models import ApprovalRequest
        self.assertTrue(ApprovalRequest.objects.get().title.startswith("Stock setting: "))

    def test_the_approval_says_what_a_stock_setting_applies_to(self):
        said = approval_kinds.setting_consequences(SimpleNamespace(payload={"key": stock.FALLBACK_UNITS}))
        self.assertIn("low-stock", said[0])
        self.assertNotIn("orders", said[0])
        self.assertEqual(
            approval_kinds.setting_consequences(SimpleNamespace(payload={"key": "rider_commission_bp"})),
            ["Applies only to orders paid after it starts."],
        )


class CoverTests(TestCase):
    def setUp(self):
        self.owner = business()

    def established(self, stock_left, sold):
        listing = go_live(product(self.owner, stock=stock_left), 60)
        if sold:
            sell(listing, sold, days_ago=10)
        return listing

    def test_with_sales_fewer_than_seven_days_left_is_low(self):
        seven = stock.cover_of(self.established(7, 28))                                 # 28 sold in 28 days: 1 a day
        self.assertEqual(
            (seven.basis, seven.days_on_sale, seven.units_sold, seven.days_of_cover, seven.line, seven.low),
            (stock.SALES, 28, 28, Decimal("7.0"), None, False),
        )
        six = stock.cover_of(self.established(6, 28))
        self.assertEqual((six.days_of_cover, six.low), (Decimal("6.0"), True))

    def test_review_focus_a_new_offer_is_not_diluted_by_days_it_did_not_exist(self):
        listing = go_live(product(self.owner, stock=13), 2)
        sell(listing, 4, days_ago=1)                                                      # 2 a day over its 2 days
        cover = stock.cover_of(listing)
        self.assertEqual((cover.days_on_sale, cover.days_of_cover, cover.low), (2, Decimal("6.5"), True))

    def test_a_re_approval_does_not_shrink_the_days_already_sold(self):
        listing = go_live(product(self.owner, stock=20), 60)
        sell(listing, 28, days_ago=20)
        Listing.objects.filter(pk=listing.pk).update(reviewed_at=timezone.now())      # approved again today
        listing.refresh_from_db()
        cover = stock.cover_of(listing)
        self.assertEqual((cover.days_on_sale, cover.low), (20, False))

    def test_review_focus_no_sales_uses_the_fallback_line(self):
        five = stock.cover_of(product(self.owner, stock=5))
        self.assertEqual((five.basis, five.line, five.days_of_cover, five.low), (stock.FALLBACK, 5, None, True))
        self.assertFalse(stock.cover_of(product(self.owner, stock=6)).low)

    def test_old_cancelled_and_unpaid_orders_are_not_sales(self):
        listing = self.established(6, 0)
        sell(listing, 100, days_ago=40)
        sell(listing, 50, days_ago=3, status=Order.CANCELLED)
        sell(listing, 50, days_ago=3, status=Order.PENDING)
        cover = stock.cover_of(listing)
        self.assertEqual((cover.units_sold, cover.basis, cover.low), (0, stock.FALLBACK, False))

    def test_the_business_own_line_replaces_the_default(self):
        above = product(self.owner, stock=20)
        stock.set_own_line(above, 25)
        below = product(self.owner, stock=4)
        stock.set_own_line(below, 3)
        cover = stock.cover_of(above)
        self.assertEqual((cover.basis, cover.line, cover.low), (stock.OWN, 25, True))
        self.assertFalse(stock.cover_of(below).low)                                     # 4 > 3, though 4 <= 5

    def test_sold_out_is_low_and_sold_out(self):
        cover = stock.cover_of(product(self.owner, stock=0))
        self.assertEqual((cover.low, cover.sold_out), (True, True))

    def test_a_governed_change_moves_the_line(self):
        MoneySetting.objects.create(key=stock.FALLBACK_UNITS, value=10, effective_from=timezone.now() - timedelta(days=1))
        cover = stock.cover_of(product(self.owner, stock=8))
        self.assertEqual((cover.line, cover.low), (10, True))


class CoverEdgeTests(TestCase):
    def setUp(self):
        self.owner = business()

    def test_the_shown_days_are_rounded_down_so_a_low_row_never_shows_the_limit(self):
        for stock_left, sold in ((35, 141), (69, 277)):                                    # 6.95..6.99 days
            with self.subTest(stock=stock_left):
                listing = go_live(product(self.owner, stock=stock_left), 60)
                sell(listing, sold, days_ago=27)
                Listing.objects.filter(pk=listing.pk).update(created_at=timezone.now() - timedelta(days=28),
                                                             reviewed_at=timezone.now() - timedelta(days=28))
                listing.refresh_from_db()
                cover = stock.cover_of(listing)
                self.assertTrue(cover.low)
                self.assertEqual(cover.days_of_cover, Decimal("6.9"))

    def test_a_sale_before_the_window_proves_the_offer_was_live(self):
        listing = go_live(product(self.owner, stock=3), 60)
        Listing.objects.filter(pk=listing.pk).update(reviewed_at=timezone.now() - timedelta(days=1))
        listing.refresh_from_db()
        sell(listing, 40, days_ago=50)                                                     # before the window
        sell(listing, 28, days_ago=1)
        cover = stock.cover_of(listing)
        self.assertEqual((cover.units_sold, cover.days_on_sale), (28, 28))

    def test_the_decision_uses_elapsed_seconds_not_whole_days(self):
        listing = go_live(product(self.owner, stock=15), 60)
        now = timezone.now()
        Listing.objects.filter(pk=listing.pk).update(reviewed_at=now - timedelta(days=1, hours=23))
        listing.refresh_from_db()
        sell(listing, 1, days_ago=1)
        sell(listing, 3, days_ago=1)
        # 4 sold over 1.96 days with 15 left: 7.35 days of cover, so not low. Rounded down to whole days (1 day) it
        # would be 3.75 days: low. Only the exact seconds give the right answer.
        cover = stock.cover_of(listing, now)
        self.assertEqual(cover.days_on_sale, 1)
        self.assertFalse(cover.low)
        self.assertEqual(cover.days_of_cover, Decimal("7.3"))

    def test_an_uncounted_listing_has_no_cover(self):
        self.assertIsNone(stock.cover_of(product(self.owner, stock=None)))

    def test_one_order_with_several_lines_and_other_listings_lines(self):
        from orders.models import OrderItem
        listing = go_live(product(self.owner, stock=100), 60)
        other = product(self.owner, "Other", stock=100)
        order = sell(listing, 2, days_ago=3)
        OrderItem.objects.create(order=order, listing=listing, quantity=3, unit_price=1, line_total=3)
        OrderItem.objects.create(order=order, listing=other, quantity=50, unit_price=1, line_total=50)
        self.assertEqual(stock.cover_of(listing).units_sold, 5)

    def test_a_setting_that_starts_in_the_future_does_not_apply_yet(self):
        MoneySetting.objects.create(key=stock.FALLBACK_UNITS, value=50, effective_from=timezone.now() + timedelta(days=2))
        self.assertEqual(stock.cover_of(product(self.owner, stock=8)).line, 5)

    def test_the_approval_keys_are_the_three_stock_settings(self):
        self.assertEqual(set(approval_kinds.STOCK_SETTING_KEYS), {stock.COVER_DAYS, stock.FALLBACK_UNITS, stock.WINDOW_DAYS})


class NeedsRestockingTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.owner = business()
        as_account(self.client, self.owner, "business_owner")
        self.low = product(self.owner, "Low", stock=3)
        self.empty = product(self.owner, "Empty", stock=0)
        product(self.owner, "Fine", stock=50)
        product(self.owner, "Uncounted", stock=None)
        service(self.owner)
        product(business("Rival Mart"), "Rival low", stock=1)

    def test_my_low_offers_sold_out_first_with_the_numbers_behind_them(self):
        body = self.client.get("/api/catalogue/stock/").json()
        self.assertEqual([row["listing_id"] for row in body["results"]], [self.empty.pk, self.low.pk])
        self.assertEqual(body["results"][1], {
            "listing_id": self.low.pk, "name": "Low", "stock": 3, "units_sold": 0, "days_on_sale": 1,
            "days_of_cover": None, "basis": "fallback", "line": 5, "low": True, "sold_out": False,
        })
        self.assertEqual((body["tracked_offers"], body["untracked_offers"]), (3, 1))
        self.assertEqual(body["settings"], {
            "cover_days": 7, "fallback_units": 5, "window_days": 28, "alerts_enabled": False, "sold_out_hidden": False,
        })

    def test_settings_say_whether_alerts_and_sold_out_hiding_are_on(self):
        body = self.client.get("/api/catalogue/stock/").json()
        self.assertEqual((body["settings"]["alerts_enabled"], body["settings"]["sold_out_hidden"]), (False, False))
        with override_settings(STOCK_ALERTS_ENABLED=True, SOLD_OUT_HIDDEN_ENABLED=True):
            body = self.client.get("/api/catalogue/stock/").json()
        self.assertEqual((body["settings"]["alerts_enabled"], body["settings"]["sold_out_hidden"]), (True, True))

    def test_nothing_low_is_an_empty_list_said_plainly(self):
        calm = business("Calm Shop")
        product(calm, stock=50)
        as_account(self.client, calm, "business_owner")
        body = self.client.get("/api/catalogue/stock/").json()
        self.assertEqual((body["results"], body["tracked_offers"], body["untracked_offers"]), ([], 1, 0))

    def test_the_list_costs_the_same_queries_however_many_offers(self):
        self.client.get("/api/catalogue/stock/")                                          # warm any caches
        with CaptureQueriesContext(connection) as few:
            self.client.get("/api/catalogue/stock/")
        for n in range(6):
            sell(product(self.owner, f"Extra {n}", stock=2), 1, days_ago=2)
        with CaptureQueriesContext(connection) as many:
            self.client.get("/api/catalogue/stock/")
        self.assertEqual(len(many), len(few))
        self.assertLessEqual(len(few), CEILING)

    def test_a_service_with_a_stock_count_is_not_an_offer(self):
        counted = service(self.owner, "Counted service")
        Listing.objects.filter(pk=counted.pk).update(stock_quantity=1)
        body = self.client.get("/api/catalogue/stock/").json()
        self.assertNotIn(counted.pk, [row["listing_id"] for row in body["results"]])
        self.assertEqual(body["tracked_offers"], 3)

    def test_sales_based_rows_are_fewest_days_first_then_by_id_and_paged(self):
        a = go_live(product(self.owner, "A", stock=6), 60)
        sell(a, 28, days_ago=10)                                                           # 6 days
        b = go_live(product(self.owner, "B", stock=3), 60)
        sell(b, 28, days_ago=10)                                                           # 3 days
        ids = [row["listing_id"] for row in self.client.get("/api/catalogue/stock/").json()["results"]]
        self.assertEqual(ids, [self.empty.pk, b.pk, a.pk, self.low.pk])
        for n in range(22):
            product(self.owner, f"Few {n}", stock=1)
        body = self.client.get("/api/catalogue/stock/").json()
        self.assertEqual((len(body["results"]), body["count"]), (20, 26))
        self.assertIsNotNone(body["next"])
        self.assertEqual(len(self.client.get("/api/catalogue/stock/?page=2").json()["results"]), 6)

    def test_staff_and_a_customer_with_the_owners_id_are_refused(self):
        as_staff(self.client, "accountant", "kofi2@example.com")
        self.assertEqual(self.client.get("/api/catalogue/stock/").status_code, 403)
        from accounts.models import Customer
        customer = Customer.objects.create(id=self.owner.pk, full_name="Same Id", phone="+233249999999", password_hash="x")
        as_account(self.client, customer, "customer")
        self.assertEqual(self.client.get("/api/catalogue/stock/").status_code, 403)

    def test_only_business_owners(self):
        as_account(self.client, buyer(), "customer")
        self.assertEqual(self.client.get("/api/catalogue/stock/").status_code, 403)


class OwnLineTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.owner = business()
        self.listing = product(self.owner, stock=20)
        as_account(self.client, self.owner, "business_owner")

    def put(self, listing, units):
        return self.client.put(f"/api/catalogue/stock/{listing.pk}/line/", {"units": units}, format="json")

    def test_a_body_without_units_is_refused_and_null_clears(self):
        for body in ({}, {"unit": 5}, [5], "5"):
            response = self.client.put(f"/api/catalogue/stock/{self.listing.pk}/line/", body, format="json")
            self.assertEqual((response.status_code, response.json()), (400, {"units": stock.LINE_MESSAGE}), body)
        self.assertEqual(self.put(self.listing, None).status_code, 200)

    def get(self, listing):
        return self.client.get(f"/api/catalogue/stock/{listing.pk}/line/")

    def test_get_answers_the_saved_line_and_its_cover(self):
        self.put(self.listing, 25)
        response = self.get(self.listing)
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        self.assertEqual((body["listing_id"], body["line"], body["cover"]["basis"]), (self.listing.pk, 25, "own_threshold"))

    def test_get_without_an_own_line_answers_null_and_the_default_basis(self):
        body = self.get(self.listing).json()
        self.assertEqual((body["line"], body["cover"]["basis"]), (None, "fallback"))

    def test_get_of_an_uncounted_listing_answers_a_null_cover(self):
        response = self.get(product(self.owner, "Uncounted", stock=None))
        self.assertEqual(response.status_code, 200)
        self.assertEqual((response.json()["line"], response.json()["cover"]), (None, None))

    def test_get_of_a_service_is_not_a_product(self):
        response = self.get(service(self.owner))
        self.assertEqual((response.status_code, response.json()["code"]), (400, "not_a_product"))

    def test_get_of_another_business_listing_is_404(self):
        self.assertEqual(self.get(product(business("Rival Mart"), stock=20)).status_code, 404)

    def test_a_business_sets_and_clears_its_own_line(self):
        response = self.put(self.listing, 25)
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        self.assertEqual((body["line"], body["cover"]["basis"], body["cover"]["low"]), (25, "own_threshold", True))
        body = self.put(self.listing, None).json()
        self.assertEqual((body["line"], body["cover"]["basis"], body["cover"]["low"]), (None, "fallback", False))

    def test_bad_values_are_refused(self):
        for units in (-1, "five", True, 100001, 2.5):
            response = self.put(self.listing, units)
            self.assertEqual((response.status_code, response.json()), (400, {"units": stock.LINE_MESSAGE}), units)

    def test_review_focus_another_business_listing_is_404_and_nothing_changes(self):
        rival = product(business("Rival Mart"), stock=20)
        self.assertEqual(self.put(rival, 25).status_code, 404)
        self.assertFalse(StockAlertState.objects.filter(listing=rival).exists())

    def test_an_uncounted_listing_or_a_service_has_no_line(self):
        response = self.put(product(self.owner, "Uncounted", stock=None), 5)
        self.assertEqual((response.status_code, response.json()["code"]), (409, "not_counted"))
        response = self.put(service(self.owner), 5)
        self.assertEqual((response.status_code, response.json()["code"]), (400, "not_a_product"))

    def test_saving_the_same_line_again_does_not_re_arm(self):
        self.put(self.listing, 10)
        StockAlertState.objects.filter(listing=self.listing).update(low_alerted_at=timezone.now(), low_alerted_stock=9)
        self.put(self.listing, 10)
        self.assertIsNotNone(StockAlertState.objects.get(listing=self.listing).low_alerted_at)

    def test_changing_the_line_re_arms_the_low_alert(self):
        StockAlertState.objects.create(listing=self.listing, low_alerted_at=timezone.now(), low_alerted_stock=20)
        self.put(self.listing, 10)
        state = StockAlertState.objects.get(listing=self.listing)
        self.assertEqual((state.threshold_units, state.low_alerted_at, state.low_alerted_stock), (10, None, None))
