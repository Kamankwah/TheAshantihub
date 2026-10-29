from unittest import mock

from django.test import override_settings

from orders.models import Order
from orders.tests.test_checkout import CheckoutTestsBase

ACCRA = {"delivery_lat": 5.6037, "delivery_lng": -0.1870}
KUMASI = {"delivery_lat": 6.6885, "delivery_lng": -1.6244}
FEE = {"total": "15.00", "lines": [], "distance_km": "3", "distance_basis": "test"}


class ServiceAreaCheckoutTests(CheckoutTestsBase):
    def setUp(self):
        super().setUp()
        self._auth(self.customer)
        self._add_to_cart(self.listing_a, 1)

    def _post(self, **extra):
        body = {"delivery_method": "door_to_door", "delivery_address": "12 Test St", "delivery_phone": "0240000000", "delivery_gps_address": "AK-039-5028", "delivery_landmark": "Blue gate", **extra}
        return self.client.post("/api/orders/checkout/", body, format="json")

    def test_point_outside_ashanti_is_refused(self):
        resp = self._post(**ACCRA)
        self.assertEqual(resp.status_code, 400, resp.content)
        self.assertEqual(resp.json()["code"], "out_of_area")
        self.assertEqual(Order.objects.count(), 0)

    def test_point_inside_ashanti_checks_out(self):
        self.assertEqual(self._post(**KUMASI).status_code, 201)

    def test_free_text_address_without_coordinates_is_not_refused(self):
        self.assertEqual(self._post().status_code, 201)

    def test_store_pickup_ignores_coordinates(self):
        resp = self.client.post("/api/orders/checkout/", {"delivery_method": "store_pickup", **ACCRA}, format="json")
        self.assertEqual(resp.status_code, 201, resp.content)

    @override_settings(DELIVERY_FEE_ENABLED=True)
    def test_fee_switch_on_still_charges_for_in_area_orders(self):
        with mock.patch("delivery.rates.checkout_fee", lambda items, lat, lng, **kw: (None, dict(FEE))):
            resp = self._post(**KUMASI)
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertIsNotNone(resp.json()["delivery_fee"])

    @override_settings(DELIVERY_FEE_ENABLED=True)
    def test_fee_is_quoted_before_the_checkout_transaction_opens(self):
        from django.db import connection

        from routing import region

        depth = {}
        real_area = region.in_service_area

        def area(lat, lng):
            depth["request"] = len(connection.savepoint_ids)  # the depth the request starts at, before checkout's own atomic
            return real_area(lat, lng)

        def quote(items, lat, lng, **kw):
            depth["quote"] = len(connection.savepoint_ids)
            return None, dict(FEE)

        with mock.patch("routing.region.in_service_area", area), mock.patch("delivery.rates.checkout_fee", quote):
            resp = self._post(**KUMASI)
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertEqual(depth["quote"], depth["request"])
        self.assertEqual(resp.json()["delivery_fee"], "15.00")

    @override_settings(DELIVERY_FEE_ENABLED=False)
    def test_fee_switch_off_never_quotes(self):
        with mock.patch("delivery.rates.checkout_fee") as quote:
            self.assertEqual(self._post(**KUMASI).status_code, 201)
        quote.assert_not_called()
