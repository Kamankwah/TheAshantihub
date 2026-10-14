from unittest import mock
from urllib.parse import parse_qs, urlparse

from django.core.cache import cache
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, BusinessOwnerProfile, Customer
from cart.guard import SERVICE_STAY_MESSAGE
from cart.models import Cart, CartItem
from delivery.models import RateCard
from listings.models import Category, Listing, Zone
from routing import service as routing_service

KUMASI = (6.6885, -1.6244)


def leg(km):
    return {"distance_km": km, "duration_s": 600, "basis": routing_service.BASIS_ROAD, "geometry": None}


def osrm_table(km):
    """A fake OSRM /table answer: every source to every destination is `km` by road."""

    def answer(url, timeout):
        query = parse_qs(urlparse(url).query)
        sources, destinations = query["sources"][0].split(";"), query["destinations"][0].split(";")
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
        body = {"delivery_method": method, "delivery_address": "1 Road", "delivery_phone": "+233200000000"}
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
