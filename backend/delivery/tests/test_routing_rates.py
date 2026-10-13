from decimal import Decimal
from unittest import mock

from django.test import SimpleTestCase

from delivery import rates
from routing import service as routing_service


class Card:
    customer_base, customer_per_km, customer_min_fee = "5.00", "1.50", "6.00"
    extra_pickup, express_multiplier, round_up_to = "0", "1", "0.50"
    vehicle_multipliers = {}
    rider_per_job, rider_per_km, wait_after_min, wait_per_min = "3.00", "0.80", 10, "0.20"


class BasisTests(SimpleTestCase):
    def test_fee_carries_the_basis_it_was_given(self):
        out = rates.customer_fee(Card, 4.2, basis=routing_service.BASIS_ROAD)
        self.assertEqual(out["distance_basis"], "road route")

    def test_fee_defaults_to_the_estimate_label(self):
        self.assertEqual(rates.customer_fee(Card, 4.2)["distance_basis"], rates.BASIS)

    def test_rider_pay_carries_the_basis(self):
        out = rates.rider_pay(Card, 4.2, basis="road route")
        self.assertEqual(out["distance_basis"], "road route")
        self.assertEqual(Decimal(out["total"]), Decimal("6.36"))

    def test_route_km_returns_km_and_basis_from_routing(self):
        order = mock.Mock()
        with mock.patch("delivery.rates.services.pickup_stop", return_value=(6.69, -1.62, "Shop")), \
             mock.patch("delivery.rates.services.drop_stop", return_value=(6.70, -1.60)), \
             mock.patch("delivery.rates.routing_service.leg", return_value={"distance_km": 5.4, "basis": "road route"}):
            self.assertEqual(rates.route_km(order), (5.4, "road route"))

    def test_route_km_none_when_a_point_is_missing(self):
        with mock.patch("delivery.rates.services.pickup_stop", return_value=(None, None, "Shop")), \
             mock.patch("delivery.rates.services.drop_stop", return_value=(6.70, -1.60)):
            self.assertEqual(rates.route_km(mock.Mock()), (None, None))
