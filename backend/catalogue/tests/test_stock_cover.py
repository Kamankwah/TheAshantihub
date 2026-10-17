"""Catalogue plan 6, Task 6: days of stock left, the low-stock line, the governed numbers, the business's "needs
restocking" list and its own line per offer (spec §1 row 15, §3.3, §10). Review Focus 2 (thin or odd history) and 5
(another business's listing)."""
from datetime import timedelta
from decimal import Decimal
from types import SimpleNamespace

from django.db import connection
from django.test import TestCase
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
        self.assertEqual(body["settings"], {"cover_days": 7, "fallback_units": 5, "window_days": 28})

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
