import threading
from unittest import mock
from urllib.parse import parse_qs, urlsplit

from django.core.cache import cache
from django.db import connection
from django.test import TestCase, TransactionTestCase, override_settings
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, BusinessOwnerProfile, Customer
from cart import guard as cart_guard
from cart.guard import SERVICE_STAY_MESSAGE
from cart.models import Cart, CartItem
from delivery.models import RateCard
from listings.models import Category, Listing, Zone
from routing import service as routing_service

KUMASI = (6.6885, -1.6244)


def leg(km):
    return {"distance_km": km, "duration_s": 600, "basis": routing_service.BASIS_ROAD, "geometry": None}


def osrm_table(km):
    """A fake OSRM /table answer: every source to every destination is `km` by road (a full matrix when the request
    names no sources, as routing.client.matrix sends it)."""

    def answer(url, timeout):
        parsed = urlsplit(url)  # not urlparse: it would cut the path at the first ";"
        query = parse_qs(parsed.query)
        points = parsed.path.rsplit("/", 1)[-1].split(";")
        sources = query["sources"][0].split(";") if "sources" in query else points
        destinations = query["destinations"][0].split(";") if "destinations" in query else points
        return {"code": "Ok", "durations": [[300.0] * len(destinations) for _ in sources],
                "distances": [[km * 1000] * len(destinations) for _ in sources]}

    return answer


class GuardCase(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.customer = Customer.objects.create(full_name="Ama Buyer", phone="+233200771001", password_hash="x")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.customer, 'customer')}")
        self.n = 0

    def listing(self, slug="shops", point=KUMASI, owner=None, name=None, category=None):
        self.n += 1
        owner = owner or BusinessOwner.objects.create(full_name=name or f"Shop {self.n}", login_phone=f"+23320777{self.n:04d}", password_hash="x")
        return Listing.objects.create(
            business_owner=owner, category=category or Category.objects.get(slug=slug), zone=Zone.objects.get(name="Manhyia"),
            name=f"{owner.full_name} item {self.n}", description="D.", contact_phone="+233207770000", price_amount="10.00",
            status=Listing.PUBLISHED, lat=str(point[0]) if point else None, lng=str(point[1]) if point else None,
        )

    def add(self, listing):
        return self.client.post("/api/cart/items/", {"listing": listing.id, "quantity": 1}, format="json")

    def put(self, *listings):
        """Rows written straight to the cart, as rows from before the guard would be."""
        cart, _ = Cart.objects.get_or_create(customer=self.customer)
        for listing in listings:
            CartItem.objects.create(cart=cart, listing=listing, quantity=1, unit_price_snapshot="10.00")

    def guard(self, listing=None):
        return self.client.get("/api/cart/guard/", {"listing": listing.id} if listing else {}).json()


class AddToCartTests(GuardCase):
    def test_services_stays_and_events_are_refused_with_the_plain_message(self):
        stay = Category.objects.create(slug="stay-test", icon="🏠", label="Stays", color="#000000", kind=Category.SERVICE, is_accommodation=True)
        for listing in (self.listing(slug="tours"), self.listing(category=stay), self.listing(slug="festivals")):
            r = self.add(listing)
            self.assertEqual(r.status_code, 400, r.content)
            self.assertEqual(r.json(), {"detail": SERVICE_STAY_MESSAGE, "code": "not_deliverable"})
        self.assertFalse(CartItem.objects.exists())

    def test_products_and_food_go_in(self):
        self.assertEqual(self.add(self.listing()).status_code, 201)
        self.assertEqual(self.add(self.listing(slug="food")).status_code, 201)

    def test_a_fifth_shop_is_refused_but_more_from_a_shop_in_the_cart_is_fine(self):
        first = self.listing()
        for listing in (first, self.listing(), self.listing(), self.listing()):
            self.assertEqual(self.add(listing).status_code, 201)
        r = self.add(self.listing())
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json(), {"detail": "Your delivery can include up to 4 shops. Remove one to add this.", "code": "shop_limit"})
        self.assertEqual(self.add(self.listing(owner=first.business_owner)).status_code, 201)

    def test_a_beverages_shop_counts_as_a_food_place(self):
        self.assertEqual(self.add(self.listing(slug="food")).status_code, 201)
        self.assertEqual(self.add(self.listing(slug="beverages")).status_code, 201)
        r = self.add(self.listing(slug="beverages"))
        self.assertEqual(r.json()["code"], "food_limit")
        self.assertEqual(self.guard()["food_shops"], 2)

    def test_pubs_and_bars_are_not_food(self):
        self.assertEqual(self.add(self.listing(slug="pubs")).json(), {"detail": SERVICE_STAY_MESSAGE, "code": "not_deliverable"})

    def test_a_third_food_place_is_refused(self):
        self.assertEqual(self.add(self.listing(slug="food")).status_code, 201)
        self.assertEqual(self.add(self.listing(slug="food")).status_code, 201)
        r = self.add(self.listing(slug="food"))
        self.assertEqual(r.json(), {"detail": "Your delivery can include food from up to 2 places. Remove one to add this.", "code": "food_limit"})

    def test_food_must_be_within_the_radius_of_a_cart_shop(self):
        self.put(self.listing())
        inside = self.listing(slug="food", point=(6.7065, -1.6244))  # about 2.0 km as the crow flies
        outside = self.listing(slug="food", point=(6.7075, -1.6244))  # about 2.1 km as the crow flies
        # One table for the whole cart: a row per nearby business, a column per cart shop.
        with mock.patch("cart.guard.routing_service.legs_between", return_value=[[leg(3.0)], [leg(3.01)]]) as legs:
            self.assertIsNone(self.guard(inside)["listing"]["blocked"])
            far = self.guard(outside)["listing"]["blocked"]
        self.assertEqual(far, {"detail": "This food place is more than 3 km from the shops in your cart, so one rider cannot collect it on the same trip.", "code": "food_far"})
        self.assertEqual(legs.call_count, 1)  # the near-shop map is measured once per cart and cached

    def test_a_food_place_without_a_location_cannot_join_a_cart(self):
        self.put(self.listing())
        r = self.add(self.listing(slug="food", point=None))
        self.assertEqual(r.json()["code"], "food_unlocated")

    def test_food_is_not_measured_against_cart_shops_that_have_no_location(self):
        self.put(self.listing(point=None, name="Pinless Shop"))
        r = self.add(self.listing(slug="food"))
        self.assertEqual(r.json(), {
            "detail": "The shops in your cart have no location on the map yet, so food cannot be added to the same delivery.",
            "code": "food_unlocated",
        })

    def test_a_far_shop_cannot_join_a_cart_whose_only_shop_sells_food(self):
        self.put(self.listing(slug="food"))
        r = self.add(self.listing(point=(6.80, -1.6244)))  # about 12 km
        self.assertEqual(r.json(), {
            "detail": "This shop is more than 3 km from the food place in your cart, so one rider cannot collect both on the same trip.",
            "code": "food_far",
        })
        self.assertEqual(self.add(self.listing(point=(6.6905, -1.6244))).status_code, 201)
        self.assertEqual(self.add(self.listing(point=(6.80, -1.6200))).status_code, 201)  # the food place has a shop nearby now

    def test_a_shop_published_after_the_near_map_was_measured_is_measured_again(self):
        self.put(self.listing(slug="food"))
        self.assertIsNone(self.guard(self.listing(point=(6.6905, -1.6244)))["listing"]["blocked"])  # measures and caches the map
        late = self.listing(point=(6.6895, -1.6244))  # 0.1 km away, published after that map was measured
        self.assertEqual(self.add(late).status_code, 201)

    def test_food_from_a_far_shop_already_in_the_cart_is_refused_unless_it_is_the_only_shop(self):
        near, far = self.listing(), self.listing(point=(6.80, -1.6244))
        self.put(near, far)
        r = self.add(self.listing(slug="food", owner=far.business_owner, point=(6.80, -1.6244)))
        self.assertEqual(r.json()["code"], "food_far")
        CartItem.objects.filter(listing=near).delete()
        self.assertEqual(self.add(self.listing(slug="food", owner=far.business_owner, point=(6.80, -1.6244))).status_code, 201)

    def test_an_estimated_distance_is_said_to_be_an_estimate(self):
        self.put(self.listing())
        r = self.add(self.listing(slug="food", point=(6.7101, -1.6244)))  # 2.4 km as the crow flies, 3.12 km estimated
        self.assertEqual(r.json(), {
            "detail": "This food place is about 3.1 km (estimate) from the shops in your cart, beyond the 3 km one rider can collect from on the same trip.",
            "code": "food_far",
        })

    def test_unlocated_shops_next_to_a_lone_food_place_cannot_be_measured(self):
        self.put(self.listing(slug="food", point=None))
        self.assertEqual(self.add(self.listing()).json(), {
            "detail": "The food place in your cart has no location on the map yet, so no other shop can join the same delivery.",
            "code": "food_unlocated",
        })
        CartItem.objects.all().delete()
        self.put(self.listing(slug="food"))
        self.assertEqual(self.add(self.listing(point=None)).json(), {
            "detail": "This shop has no location on the map yet, so it cannot join a delivery with the food place in your cart.",
            "code": "food_unlocated",
        })

    def test_a_shop_selling_goods_and_food_counts_once_and_as_food(self):
        mixed = self.listing()
        self.put(self.listing(slug="food"), self.listing(slug="food"), mixed)
        r = self.add(self.listing(slug="food", owner=mixed.business_owner))
        self.assertEqual(r.json()["code"], "food_limit")
        self.assertEqual(self.add(self.listing(owner=mixed.business_owner)).status_code, 201)
        summary = self.guard()
        self.assertEqual((len(summary["shops"]), summary["food_shops"]), (3, 2))

    def test_a_service_row_from_before_the_guard_is_not_counted_as_a_shop(self):
        tour = self.listing(slug="tours", name="Tour Co")
        self.put(tour, self.listing(), self.listing(), self.listing())
        self.assertEqual(self.add(self.listing()).status_code, 201)
        summary = self.guard()
        self.assertNotIn(tour.business_owner_id, [s["id"] for s in summary["shops"]])
        self.assertEqual((summary["active"], summary["at_shop_limit"]), (True, True))
        self.assertEqual(summary["checkout"]["any"]["code"], "not_deliverable")

    def test_a_card_that_allows_no_food_says_so(self):
        RateCard.objects.create(version=1, status=RateCard.LIVE, customer_base="5", customer_per_km="1.5", customer_min_fee="8",
                                rider_per_job="3", rider_per_km="1", max_food_shops=0)
        r = self.add(self.listing(slug="food"))
        self.assertEqual(r.json(), {"detail": "Deliveries cannot include food at the moment.", "code": "food_limit"})

    def test_a_refused_add_writes_nothing(self):
        self.add(self.listing(slug="tours"))
        self.assertFalse(Cart.objects.filter(customer=self.customer).exists())

    @override_settings(OSRM_URL="http://osrm:5000")
    def test_one_road_table_for_a_cart_with_several_shops(self):
        self.put(self.listing(), self.listing(point=(6.6935, -1.6244)), self.listing(point=(6.6885, -1.6194)))
        food = self.listing(slug="food", point=(6.6905, -1.6224))
        with mock.patch("routing.client._http_get_json", side_effect=osrm_table(1.5)) as get:
            self.assertEqual(self.add(food).status_code, 201)
        self.assertEqual(get.call_count, 1)
        self.assertIn("/table/v1/driving/", get.call_args[0][0])


class CheckoutGuardTests(GuardCase):
    def checkout(self, method):
        body = {"delivery_method": method, "delivery_address": "1 Road", "delivery_phone": "+233200000000", "delivery_gps_address": "AK-039-5028", "delivery_landmark": "Blue gate"}
        return self.client.post("/api/orders/checkout/", body, format="json")

    def test_checkout_refuses_a_cart_that_predates_the_rules_and_keeps_it(self):
        self.put(self.listing(slug="tours"), self.listing())
        for method in ("store_pickup", "door_to_door"):
            r = self.checkout(method)
            self.assertEqual(r.status_code, 400)
            self.assertEqual(r.json(), {"detail": f"{SERVICE_STAY_MESSAGE} Remove them from your cart to check out.", "code": "not_deliverable"})
        self.assertEqual(CartItem.objects.count(), 2)

    def test_a_cart_over_a_lowered_limit_is_blocked_for_door_to_door_only(self):
        self.put(*(self.listing() for _ in range(4)))
        RateCard.objects.create(version=1, status=RateCard.LIVE, customer_base="5", customer_per_km="1.5", customer_min_fee="8",
                                rider_per_job="3", rider_per_km="1", max_shops_per_delivery=3)
        r = self.checkout("door_to_door")
        self.assertEqual(r.json(), {"detail": "Your delivery can include up to 3 shops. Your cart has 4. Remove 1 to check out.", "code": "shop_limit"})
        self.assertEqual(CartItem.objects.count(), 4)
        self.assertEqual(self.guard()["checkout"]["door_to_door"]["code"], "shop_limit")
        self.assertEqual(self.checkout("store_pickup").status_code, 201)

    def test_a_cart_over_a_lowered_food_limit_is_blocked_for_door_to_door_only(self):
        self.put(self.listing(slug="food"), self.listing(slug="food"))
        RateCard.objects.create(version=1, status=RateCard.LIVE, customer_base="5", customer_per_km="1.5", customer_min_fee="8",
                                rider_per_job="3", rider_per_km="1", max_food_shops=1)
        r = self.checkout("door_to_door")
        self.assertEqual(r.json(), {"detail": "Your delivery can include food from up to 1 place. Your cart has 2. Remove 1 to check out.", "code": "food_limit"})
        self.assertEqual(self.checkout("store_pickup").status_code, 201)

    def test_a_cart_from_before_the_radius_rule_is_refused_for_door_to_door_only(self):
        self.put(self.listing(slug="food", name="Auntie Chop Bar"), self.listing(point=(6.80, -1.6244)))
        r = self.checkout("door_to_door")
        self.assertEqual(r.json(), {
            "detail": "Food from Auntie Chop Bar is more than 3 km from the other shops in your cart, so one rider cannot collect it on the same trip. Remove it to check out.",
            "code": "food_far",
        })
        self.assertEqual(CartItem.objects.count(), 2)
        self.assertEqual(self.guard()["checkout"]["door_to_door"]["code"], "food_far")
        self.assertEqual(self.checkout("store_pickup").status_code, 201)

    def test_a_lowered_radius_binds_at_checkout(self):
        self.put(self.listing(slug="food"), self.listing(point=(6.7065, -1.6244)))  # 2 km apart as the crow flies
        self.assertIsNone(self.guard()["checkout"]["door_to_door"])
        RateCard.objects.create(version=1, status=RateCard.LIVE, customer_base="5", customer_per_km="1.5", customer_min_fee="8",
                                rider_per_job="3", rider_per_km="1", near_shop_radius_km="1.00")
        r = self.checkout("door_to_door")
        self.assertEqual(r.json()["code"], "food_far")
        self.assertIn("more than 1 km", r.json()["detail"])
        self.assertEqual(CartItem.objects.count(), 2)

    def test_a_cart_of_one_food_place_checks_out(self):
        self.put(self.listing(slug="food"))
        self.assertEqual(self.checkout("door_to_door").status_code, 201)

    def test_an_estimated_route_names_its_distance_as_an_estimate(self):
        self.put(self.listing(slug="food", name="Mama Put"), self.listing(point=(6.7101, -1.6244)))
        r = self.client.post("/api/orders/checkout/", {"delivery_method": "door_to_door", "delivery_address": "1 Road",
                                                       "delivery_phone": "+233200000000", "delivery_gps_address": "AK-039-5028", "delivery_landmark": "Blue gate", "delivery_lat": KUMASI[0], "delivery_lng": KUMASI[1]}, format="json")
        self.assertEqual(r.json(), {
            "detail": "Food from Mama Put is about 3.1 km (estimate) from the other shops in your cart, beyond the 3 km one rider can collect from on the same trip. Remove it to check out.",
            "code": "food_far",
        })

    @override_settings(OSRM_URL="http://osrm:5000")
    def test_checkout_measures_the_radius_from_the_route_plan_without_another_routing_call(self):
        self.put(self.listing(slug="food"), self.listing(point=(6.6905, -1.6244)))
        body = {"delivery_method": "door_to_door", "delivery_address": "1 Road", "delivery_phone": "+233200000000",
                "delivery_gps_address": "AK-039-5028", "delivery_landmark": "Blue gate", "delivery_lat": 6.6950, "delivery_lng": -1.6300}
        with mock.patch("routing.client._http_get_json", side_effect=osrm_table(3.5)) as get:
            r = self.client.post("/api/orders/checkout/", body, format="json")
        self.assertEqual((r.json().get("code"), get.call_count), ("food_far", 1))
        self.assertIn("more than 3 km", r.json()["detail"])
        with mock.patch("routing.client._http_get_json", side_effect=osrm_table(1.5)) as get:
            r = self.client.post("/api/orders/checkout/", body, format="json")
        self.assertEqual((r.status_code, get.call_count), (201, 1))

    def test_the_guard_endpoint_describes_the_cart(self):
        self.assertEqual(self.guard()["active"], False)
        self.put(self.listing(name="Kente House"))
        summary = self.guard(self.listing(slug="tours"))
        self.assertEqual(summary["shops"][0]["name"], "Kente House")
        self.assertEqual(summary["limits"]["max_shops_per_delivery"], 4)
        self.assertEqual(summary["listing"]["blocked"]["code"], "not_deliverable")
        self.assertEqual(summary["checkout"], {"any": None, "door_to_door": None})
        self.client.credentials()
        self.assertEqual(self.client.get("/api/cart/guard/").status_code, 401)

    def test_the_guard_says_whether_the_limits_are_the_built_in_defaults(self):
        self.assertEqual((self.guard()["limits"]["source"], self.guard()["limits"]["version"]), ("defaults", None))
        RateCard.objects.create(version=2, status=RateCard.LIVE, customer_base="5", customer_per_km="1.5", customer_min_fee="8",
                                rider_per_job="3", rider_per_km="1", near_shop_radius_km="2.50")
        limits = self.guard()["limits"]
        self.assertEqual((limits["source"], limits["version"], limits["near_shop_radius_km"]), ("version", 2, "2.50"))

    def test_the_guard_names_a_shop_by_its_business_name_and_hides_hidden_businesses(self):
        shop = self.listing(name="Kofi Mensah")
        BusinessOwnerProfile.objects.create(business_owner=shop.business_owner, business_name="Kofi's Kente")
        self.put(shop)
        self.assertEqual(self.guard()["shops"][0]["name"], "Kofi's Kente")
        hidden = self.listing()
        hidden.business_owner.is_suspended = True
        hidden.business_owner.save(update_fields=["is_suspended"])
        self.assertEqual(self.client.get("/api/cart/guard/", {"listing": hidden.id}).status_code, 404)
        self.assertEqual(self.client.get("/api/cart/guard/", {"listing": "x"}).status_code, 400)


class ConcurrentAddTests(TransactionTestCase):
    """Two adds at the same moment both read a cart of 3 shops: the cart lock lets only one of them make it 4."""

    serialized_rollback = True

    def test_two_adds_at_once_cannot_take_the_cart_past_the_shop_limit(self):
        cache.clear()
        customer = Customer.objects.create(full_name="Ama Buyer", phone="+233200771001", password_hash="x")
        shops = Category.objects.get(slug="shops")
        zone = Zone.objects.get(name="Manhyia")

        def listing(n):
            owner = BusinessOwner.objects.create(full_name=f"Shop {n}", login_phone=f"+23320778{n:04d}", password_hash="x")
            return Listing.objects.create(business_owner=owner, category=shops, zone=zone, name=f"Item {n}", description="D.",
                                          contact_phone="+233207770000", price_amount="10.00", status=Listing.PUBLISHED,
                                          lat=str(KUMASI[0]), lng=str(KUMASI[1]))

        cart = Cart.objects.create(customer=customer)
        for n in range(3):
            CartItem.objects.create(cart=cart, listing=listing(n), quantity=1, unit_price_snapshot="10.00")
        racers = [listing(10), listing(11)]
        token = issue_token(customer, "customer")
        real_check, local, barrier, results = cart_guard.check_add, threading.local(), threading.Barrier(2, timeout=5), []

        def check_together(lines, item):
            local.calls = getattr(local, "calls", 0) + 1
            if local.calls == 1:  # both requests have read the 3-shop cart before either writes
                barrier.wait()
            return real_check(lines, item)

        def add(item):
            try:
                client = APIClient()
                client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
                results.append(client.post("/api/cart/items/", {"listing": item.id, "quantity": 1}, format="json").status_code)
            finally:
                connection.close()

        with mock.patch("cart.views.guard.check_add", side_effect=check_together):
            threads = [threading.Thread(target=add, args=(item,)) for item in racers]
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join(timeout=15)
                self.assertFalse(thread.is_alive(), "a racing add hung")
        self.assertEqual(sorted(results), [201, 400])
        self.assertEqual(CartItem.objects.filter(cart=cart).count(), 4)
