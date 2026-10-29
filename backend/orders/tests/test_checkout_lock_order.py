"""Checkout takes its listing row locks in primary-key order whatever order the cart was filled in (spec (xvii)), so
two carts holding the same listings can never wait on each other."""
import re

from django.db import connection
from django.test.utils import CaptureQueriesContext

from listings.models import Listing
from orders.models import Order

from .test_checkout import CheckoutTestsBase


class CheckoutLockOrderTests(CheckoutTestsBase):
    def setUp(self):
        super().setUp()
        Listing.objects.filter(pk__in=[self.listing_a.pk, self.listing_b.pk]).update(stock_quantity=5)
        self._auth(self.customer)

    def test_review_focus_checkout_locks_listings_in_primary_key_order(self):
        self.assertLess(self.listing_a.pk, self.listing_b.pk)
        self._add_to_cart(self.listing_b, 1)
        self._add_to_cart(self.listing_a, 1)
        with CaptureQueriesContext(connection) as queries:
            response = self.client.post("/api/orders/checkout/")
        self.assertEqual(response.status_code, 201, response.content)
        locks = [q["sql"] for q in queries if "FOR UPDATE" in q["sql"] and 'FROM "listings_listing"' in q["sql"]]
        self.assertTrue(locks)
        ids = [int(n) for n in re.findall(r"\d+", re.search(r'"listings_listing"\."id" IN \(([^)]*)\)', locks[0]).group(1))]
        self.assertEqual(ids, sorted(ids))
        self.assertIn("ORDER BY", locks[0])
        self.assertRegex(locks[0], r'ORDER BY "listings_listing"\."id"')

    def test_stock_is_still_reserved_for_every_line(self):
        self._add_to_cart(self.listing_b, 2)
        self._add_to_cart(self.listing_a, 3)
        response = self.client.post("/api/orders/checkout/")
        self.assertEqual(response.status_code, 201, response.content)
        self.listing_a.refresh_from_db()
        self.listing_b.refresh_from_db()
        self.assertEqual((self.listing_a.stock_quantity, self.listing_b.stock_quantity), (2, 3))
        self.assertEqual(Order.objects.count(), 1)
