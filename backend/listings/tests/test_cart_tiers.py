from unittest import mock

from django.core.cache import cache
from django.db import connection
from django.test import override_settings
from django.test.utils import CaptureQueriesContext

from accounts.authentication import issue_token
from accounts.models import BusinessOwnerProfile
from cart.tests.test_guard import GuardCase, osrm_table
from listings.models import ListingPhoto


class CartTierSearchTests(GuardCase):
    def setUp(self):
        super().setUp()
        self.mine = self.listing(name="Shop A")
        self.close = self.listing(point=(6.6975, -1.6244), name="Shop B")  # about 1 km: 1.3 km as the estimate
        self.far = self.listing(point=(6.80, -1.6244), name="Shop C")  # about 12 km
        self.tour = self.listing(slug="tours", point=(6.689, -1.6244), name="Tour Co")
        self.put(self.mine)

    def search(self, **params):
        r = self.client.get("/api/listings/", {"cart_tiers": "1", **params})
        self.assertEqual(r.status_code, 200, r.content)
        return r.json()["results"]

    def test_cart_shops_then_near_shops_then_everyone_else(self):
        rows = self.search()
        self.assertEqual([r["id"] for r in rows[:2]], [self.mine.id, self.close.id])
        self.assertEqual((rows[0]["cart_tier"], rows[0]["cart_label"]), (1, "In your cart"))
        self.assertEqual((rows[1]["cart_tier"], rows[1]["cart_label"]), (2, "1.3 km from Shop A (estimate)"))
        rest = {r["id"]: r for r in rows[2:]}
        self.assertEqual(set(rest), {self.far.id, self.tour.id})
        self.assertEqual(rest[self.far.id]["cart_tier"], 3)
        self.assertEqual((rest[self.tour.id]["cart_tier"], rest[self.tour.id]["cart_label"], rest[self.tour.id]["cart_blocked"]), (None, None, None))

    def test_near_shops_come_nearest_first_and_another_item_from_a_cart_shop_says_so(self):
        nearer = self.listing(point=(6.6935, -1.6244), name="Shop D")  # about 0.6 km: 0.7 km as the estimate
        more = self.listing(owner=self.mine.business_owner)
        rows = self.search()
        self.assertEqual({r["id"] for r in rows[:2]}, {self.mine.id, more.id})
        self.assertEqual([r["id"] for r in rows[2:4]], [nearer.id, self.close.id])
        by_id = {r["id"]: r for r in rows}
        self.assertEqual((by_id[more.id]["cart_tier"], by_id[more.id]["cart_label"]), (1, "From a shop in your cart"))
        self.assertEqual(by_id[nearer.id]["cart_label"], "0.7 km from Shop A (estimate)")

    def test_tiers_stay_first_under_an_explicit_ordering(self):
        rows = self.search(ordering="-price_amount")
        self.assertEqual([r["id"] for r in rows[:2]], [self.mine.id, self.close.id])

    @override_settings(OSRM_URL="http://osrm:5000")
    def test_a_road_distance_is_not_labelled_an_estimate(self):
        with mock.patch("routing.client._http_get_json", side_effect=osrm_table(1.24)) as get:
            rows = {r["id"]: r for r in self.search()}
        self.assertEqual(rows[self.close.id]["cart_label"], "1.2 km from Shop A")
        self.assertEqual(get.call_count, 1)

    def test_food_beyond_the_radius_is_offered_with_the_reason_it_cannot_join(self):
        near_food = self.listing(slug="food", point=(6.6905, -1.6244))
        far_food = self.listing(slug="food", point=(6.80, -1.6200))
        rows = {r["id"]: r for r in self.search()}
        self.assertEqual((rows[near_food.id]["cart_tier"], rows[near_food.id]["cart_blocked"]), (2, None))
        self.assertEqual(rows[far_food.id]["cart_tier"], 3)
        self.assertEqual(rows[far_food.id]["cart_blocked"]["code"], "food_far")

    def test_at_the_shop_limit_other_shops_say_so(self):
        self.put(self.listing(), self.listing(), self.listing())
        rows = {r["id"]: r for r in self.search()}
        self.assertIsNone(rows[self.mine.id]["cart_blocked"])
        self.assertEqual(rows[self.close.id]["cart_blocked"]["code"], "shop_limit")
        self.assertEqual(rows[self.far.id]["cart_blocked"]["code"], "shop_limit")
        self.assertIsNone(rows[self.tour.id]["cart_blocked"])

    def test_without_the_flag_or_with_an_empty_cart_search_is_unchanged(self):
        from cart.models import CartItem

        self.assertNotIn("cart_tier", self.client.get("/api/listings/").json()["results"][0])
        CartItem.objects.all().delete()
        self.assertNotIn("cart_tier", self.search()[0])

    def test_a_cart_holding_only_a_service_row_from_before_the_guard_has_no_cart_shops(self):
        from cart.models import CartItem

        CartItem.objects.all().delete()
        self.put(self.tour)
        rows = {r["id"]: r for r in self.search()}
        self.assertEqual({rows[i]["cart_tier"] for i in (self.mine.id, self.close.id, self.far.id)}, {3})
        self.assertIsNone(rows[self.tour.id]["cart_tier"])

    def test_the_cached_near_map_still_fits_when_an_unlocated_cart_shop_leaves(self):
        from cart.models import CartItem

        unlocated = self.listing(point=None, name="Shop U")  # Shop U has no pin, and this line has no location
        elsewhere = self.listing(owner=unlocated.business_owner, point=(6.6905, -1.6244))  # its other item, 0.2 km from Shop A
        self.put(unlocated)
        self.assertEqual({r["id"]: r for r in self.search()}[elsewhere.id]["cart_tier"], 1)
        CartItem.objects.filter(listing=unlocated).delete()  # the located cart shops are unchanged, so is the cache key
        row = {r["id"]: r for r in self.search()}[elsewhere.id]
        self.assertEqual((row["cart_tier"], row["cart_label"]), (2, "0.3 km from Shop A (estimate)"))

    def test_anonymous_and_business_callers_get_plain_search(self):
        self.client.credentials()
        self.assertNotIn("cart_tier", self.search()[0])
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.mine.business_owner, 'business_owner')}")
        self.assertNotIn("cart_tier", self.search()[0])

    def test_the_query_count_does_not_grow_with_the_listings(self):
        def queries():
            cache.clear()  # measure the near-shop map afresh each time
            with CaptureQueriesContext(connection) as captured:
                rows = self.search()
            return len(captured.captured_queries), len(rows)

        before, shown = queries()
        for n in range(3):
            point = (6.6895 + n * 0.002, -1.6244)
            pinned = self.listing(slug="food", point=None)
            BusinessOwnerProfile.objects.create(business_owner=pinned.business_owner, lat=str(point[0]), lng=str(point[1]))
            ListingPhoto.objects.create(listing=pinned, image="listing_photos/gallery/x.png", order=n)
            self.listing(slug="food", point=(6.80 + n * 0.01, -1.6244))
            self.listing(point=None)
            self.listing(slug="tours")
            self.listing(owner=self.mine.business_owner)
        after, shown_after = queries()
        self.assertEqual(shown_after, shown + 15)
        self.assertEqual(after, before)


class CartLabelMissingNearTests(GuardCase):
    def test_a_shop_missing_from_the_near_map_has_no_label_instead_of_a_server_error(self):
        from listings.serializers import CartTieredListingSerializer

        listing = self.listing(name="Shop Z")
        serializer = CartTieredListingSerializer(context={"cart_guard": {"listing_ids": set(), "near": {}}})
        listing.cart_tier = 2
        self.assertIsNone(serializer.get_cart_label(listing))
