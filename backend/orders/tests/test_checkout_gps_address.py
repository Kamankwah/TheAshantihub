from unittest import mock

from django.test import override_settings

from cart.models import Cart
from orders.models import Order, OrderItem
from orders.tests.test_fulfilment_spine import FulfilmentSpineTestsBase

PHONE = "+233200770001"
PIN_MESSAGE = "Pin your door on the map so we can work out the delivery fee."
FEE = {"total": "15.00", "lines": [], "distance_km": "3", "distance_basis": "test"}
PIN = {"delivery_lat": 6.6885, "delivery_lng": -1.6244}
LANDMARK_MESSAGE = "Add a landmark near your door so the rider can find you."


class CheckoutGpsAddressTests(FulfilmentSpineTestsBase):
    def setUp(self):
        super().setUp()
        self._auth(self.customer)
        self._add_to_cart(self.tracked, 2)

    def body(self, **over):
        body = {
            "delivery_method": "door_to_door", "delivery_address": "12 Ash Road, Kumasi", "delivery_phone": PHONE,
            "delivery_gps_address": "AK-039-5028", "delivery_landmark": "Blue gate opposite the pharmacy",
        }
        body.update(over)
        return {k: v for k, v in body.items() if v is not None}

    def checkout(self, **over):
        return self.client.post("/api/orders/checkout/", self.body(**over), format="json")

    def assertRefused(self, response, field):
        self.assertEqual(response.status_code, 400, response.content)
        self.assertIn(field, response.json())
        self.assertFalse(Order.objects.exists())
        self.assertFalse(OrderItem.objects.exists())
        self.tracked.refresh_from_db()
        self.assertEqual(self.tracked.stock_quantity, 5)
        self.assertEqual(Cart.objects.get(customer=self.customer).items.count(), 1)

    def test_door_to_door_without_a_gps_address_is_refused_and_nothing_is_created(self):
        response = self.checkout(delivery_gps_address=None)
        self.assertRefused(response, "delivery_gps_address")
        self.assertEqual(response.json()["delivery_gps_address"], ["A Ghana Post GPS address is required."])

    def test_malformed_code_is_refused(self):
        for code in ("AK-39-5028", "AK0395028"):
            with self.subTest(code=code):
                response = self.checkout(delivery_gps_address=code)
                self.assertRefused(response, "delivery_gps_address")
                self.assertEqual(
                    response.json()["delivery_gps_address"], ["Enter a valid Ghana Post GPS address, e.g. AK-039-5028."],
                )

    def test_a_non_string_code_is_a_field_error_not_a_500(self):
        for value in (123, ["AK-039-5028"], {"code": "AK-039-5028"}, True):
            with self.subTest(value=value):
                response = self.checkout(delivery_gps_address=value)
                self.assertRefused(response, "delivery_gps_address")
                self.assertEqual(
                    response.json()["delivery_gps_address"], ["Enter a valid Ghana Post GPS address, e.g. AK-039-5028."],
                )

    def test_a_non_string_landmark_is_a_field_error(self):
        for value in (123, ["Blue gate"], {"a": "b"}):
            with self.subTest(value=value):
                response = self.checkout(delivery_landmark=value)
                self.assertRefused(response, "delivery_landmark")
                self.assertEqual(response.json()["delivery_landmark"], [LANDMARK_MESSAGE])

    def test_a_code_outside_ashanti_is_refused(self):
        response = self.checkout(delivery_gps_address="GA-123-4567")
        self.assertRefused(response, "delivery_gps_address")
        self.assertIn("Ashanti Region", response.json()["delivery_gps_address"][0])

    def test_a_lower_case_code_is_stored_upper_case(self):
        response = self.checkout(delivery_gps_address="  ak-039-5028 ")
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(Order.objects.get(id=response.json()["id"]).delivery_gps_address, "AK-039-5028")

    def test_door_to_door_without_a_landmark_is_refused(self):
        for value in (None, "", "   "):
            with self.subTest(value=value):
                response = self.checkout(delivery_landmark=value)
                self.assertRefused(response, "delivery_landmark")
                self.assertEqual(response.json()["delivery_landmark"], [LANDMARK_MESSAGE])

    def test_landmark_longer_than_200_is_refused(self):
        response = self.checkout(delivery_landmark="x" * 201)
        self.assertRefused(response, "delivery_landmark")
        self.assertEqual(response.json()["delivery_landmark"], ["Keep the landmark under 200 characters."])
        self.assertEqual(self.checkout(delivery_landmark="x" * 200).status_code, 201)

    def test_the_existing_address_and_phone_message_is_unchanged(self):
        response = self.checkout(delivery_address=None)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json(), {"detail": "Door-to-door delivery needs a delivery address and phone number."})

    def test_store_pickup_needs_neither_and_stores_blank(self):
        response = self.client.post("/api/orders/checkout/", {
            "delivery_method": "store_pickup", "delivery_gps_address": "AK-039-5028", "delivery_landmark": "Ignored",
        }, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        order = Order.objects.get(id=response.json()["id"])
        self.assertEqual((order.delivery_gps_address, order.delivery_landmark), ("", ""))

    def test_order_json_carries_both_fields(self):
        response = self.checkout()
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.json()["delivery_gps_address"], "AK-039-5028")
        self.assertEqual(response.json()["delivery_landmark"], "Blue gate opposite the pharmacy")
        listed = self.client.get("/api/orders/").json()[0]
        self.assertEqual(listed["delivery_gps_address"], "AK-039-5028")

    def test_old_orders_with_blank_fields_still_serialize(self):
        old = Order.objects.create(customer=self.customer, status=Order.PAID, total_amount="10.00")
        listed = self.client.get("/api/orders/").json()
        row = next(r for r in listed if r["id"] == old.id)
        self.assertEqual((row["delivery_gps_address"], row["delivery_landmark"]), ("", ""))

    def test_owner_order_list_shows_the_address_but_still_no_phone(self):
        self.assertEqual(self.checkout().status_code, 201)
        self._auth(self.owner, "business_owner")
        response = self.client.get("/api/orders/owner/")
        row = response.json()["results"][0]
        self.assertEqual(row["delivery_gps_address"], "AK-039-5028")
        self.assertEqual(row["delivery_landmark"], "Blue gate opposite the pharmacy")
        self.assertNotIn("delivery_phone", row)
        self.assertNotIn(PHONE.encode(), response.content)

    # Ruling P45: while delivery fees are on and a rate card is live, a door-to-door order needs a map pin.
    def live_card(self):
        from delivery.models import RateCard

        return RateCard.objects.create(
            version=1, customer_base="5", customer_per_km="1.5", customer_min_fee="8", rider_per_job="3", rider_per_km="1",
        )

    @override_settings(DELIVERY_FEE_ENABLED=True)
    def test_fees_on_without_a_pin_is_refused_and_nothing_is_created(self):
        self.live_card()
        with mock.patch("delivery.stops.plan_with_distances") as plan:
            for extra in ({}, {"delivery_lat": "", "delivery_lng": ""}, {"delivery_lat": 6.6885}):
                response = self.checkout(**extra)
                self.assertRefused(response, "delivery_lat")
                self.assertEqual(response.json()["delivery_lat"], [PIN_MESSAGE])
        plan.assert_not_called()  # refused before any routing

    @override_settings(DELIVERY_FEE_ENABLED=True)
    def test_fees_on_with_a_pin_checks_out(self):
        self.live_card()
        with mock.patch("delivery.rates.checkout_fee", lambda items, lat, lng, **kw: (None, dict(FEE))):
            self.assertEqual(self.checkout(**PIN).status_code, 201)

    @override_settings(DELIVERY_FEE_ENABLED=True)
    def test_fees_on_store_pickup_needs_no_pin(self):
        self.live_card()
        response = self.checkout(delivery_method="store_pickup")
        self.assertEqual(response.status_code, 201, response.content)

    @override_settings(DELIVERY_FEE_ENABLED=False)
    def test_fees_off_needs_no_pin(self):
        self.live_card()
        self.assertEqual(self.checkout().status_code, 201)

    @override_settings(DELIVERY_FEE_ENABLED=True)
    def test_fees_on_with_no_rate_card_adds_no_fee_so_needs_no_pin(self):
        self.assertEqual(self.checkout().status_code, 201)
