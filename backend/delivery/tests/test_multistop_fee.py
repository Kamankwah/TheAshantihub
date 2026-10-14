from datetime import timedelta
from decimal import Decimal
from unittest import mock

from django.test import SimpleTestCase, override_settings
from django.utils import timezone

from accounts.authentication import issue_token
from accounts.models import BusinessOwner
from cart.models import Cart, CartItem
from delivery import rates
from marketing.models_waivers import DeliveryWaiver
from orders.models import Order
from routing import service as routing_service

from .base import DROP
from .test_dispatch import CARD, EngineCase

A, B, C = (6.70, -1.62), (6.705, -1.615), (6.71, -1.61)
UNDER = [[0, 2, 9, 5], [2, 0, 3, 4], [9, 3, 0, 1], [5, 4, 1, 0]]     # best A-B-C-H 6 km, direct 5 (20 %)
OVER = [[0, 4, 9, 5], [4, 0, 3, 9], [9, 3, 0, 3], [5, 9, 3, 0]]      # best A-B-C-H 10 km, direct 5 (100 %)
AT_LIMIT = [[0, 1, 9, 5], [1, 0, 3, 9], [9, 3, 0, 3], [5, 9, 3, 0]]  # best A-B-C-H 7 km, direct 5 (exactly 40 %)


def table(km, basis=routing_service.BASIS_ROAD):
    return mock.patch("routing.planner.service.matrix", return_value={"km": km, "basis": basis})


def leg(km):
    return {"distance_km": km, "duration_s": 600, "basis": routing_service.BASIS_ROAD, "geometry": None}


class Card:
    customer_base, customer_per_km, customer_min_fee, extra_pickup = "5", "1.5", "8", "2"
    express_multiplier, round_up_to, vehicle_multipliers = "1", "0.5", {}


class FeeLineTests(SimpleTestCase):
    def test_extra_pickups_and_the_detour_are_their_own_lines(self):
        fee = rates.customer_fee(Card, 5, extra_pickups=2, detour_km=Decimal("3"))
        self.assertEqual([l["label"] for l in fee["lines"]], ["Base", "Distance 5 km", "2 extra pickup(s)", "Detour 3 km"])
        self.assertEqual(fee["lines"][3]["amount"], "4.50")
        self.assertEqual(fee["total"], "21.00")

    def test_detour_over_km_counts_only_beyond_the_allowance(self):
        self.assertEqual(rates.detour_over_km(10, 5, 40), Decimal("3.00"))
        self.assertEqual(rates.detour_over_km(7, 5, 40), Decimal("0.00"))
        self.assertEqual(rates.detour_over_km(6, 5, 40), Decimal("0.00"))
        self.assertEqual(rates.detour_over_km(4, 0, 40), Decimal("4.00"))
        self.assertEqual(rates.detour_over_km(None, 5, 40), Decimal("0"))


@override_settings(DELIVERY_FEE_ENABLED=True)
class MultiStopCheckoutTests(EngineCase):
    def setUp(self):
        super().setUp()
        self.as_staff(self.admin, sudo=True)
        assert self.client.post("/api/delivery/rules/rate-card/", {"values": CARD}, format="json").status_code == 201
        self.shop_a, self.item_a = self.make_shop("Shop A", "+233207000201", A)
        self.shop_b, self.item_b = self.make_shop("Shop B", "+233207000202", B)
        self.shop_c, self.item_c = self.make_shop("Shop C", "+233207000203", C)

    def checkout(self, *listings, drop=DROP, method="door_to_door"):
        cart, _ = Cart.objects.get_or_create(customer=self.customer)
        cart.items.all().delete()
        for listing in listings:
            CartItem.objects.create(cart=cart, listing=listing, quantity=1, unit_price_snapshot="10.00")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.customer, 'customer')}")
        body = {"delivery_method": method, "delivery_address": "1 Road", "delivery_phone": "+233200000000"}
        if drop:
            body.update({"delivery_lat": drop[0], "delivery_lng": drop[1]})
        response = self.client.post("/api/orders/checkout/", body, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        return Order.objects.get(pk=response.json()["id"])

    def lines(self, order):
        return {l["label"]: l["amount"] for l in order.delivery_fee_breakdown["lines"]}

    def test_three_shops_under_the_detour_limit(self):
        with table(UNDER):
            order = self.checkout(self.item_a, self.item_b, self.item_c)
        self.assertEqual(self.lines(order)["2 extra pickup(s)"], "4.00")  # CARD's extra_pickup is 2
        self.assertFalse(any(label.startswith("Detour") for label in self.lines(order)))
        self.assertEqual(order.delivery_fee, Decimal("16.50"))  # 5 + 5 km x 1.5 + 2 x 2, rounded to 0.50
        plan = order.route_plan
        self.assertEqual(plan["owner_ids"], [self.shop_a.pk, self.shop_b.pk, self.shop_c.pk])
        self.assertEqual((plan["total_km"], plan["direct_km"], plan["detour_pct"], plan["limit_pct"], plan["over_limit"]), (6, 5, 20.0, 40, False))
        self.assertEqual(order.delivery_fee_breakdown["route"]["stops"], 3)

    def test_over_the_limit_charges_only_the_km_beyond_the_allowance(self):
        with table(OVER):
            order = self.checkout(self.item_a, self.item_b, self.item_c)
        self.assertEqual(self.lines(order)["Detour 3.00 km"], "4.50")  # 10 - 5 x 1.4 = 3 km at 1.5
        self.assertEqual(order.delivery_fee, Decimal("21.00"))
        self.assertTrue(order.route_plan["over_limit"])
        self.assertEqual(order.delivery_fee_breakdown["route"]["detour_charged_km"], "3.00")

    def test_exactly_at_the_limit_adds_no_detour(self):
        with table(AT_LIMIT):
            order = self.checkout(self.item_a, self.item_b, self.item_c)
        self.assertFalse(any(label.startswith("Detour") for label in self.lines(order)))
        self.assertFalse(order.route_plan["over_limit"])

    def test_an_estimated_route_labels_the_fee(self):
        with table(UNDER, basis=routing_service.BASIS_ESTIMATE):
            order = self.checkout(self.item_a, self.item_b, self.item_c)
        self.assertEqual(order.delivery_fee_breakdown["distance_basis"], routing_service.BASIS_ESTIMATE)
        self.assertEqual(order.route_plan["basis"], routing_service.BASIS_ESTIMATE)

    def test_no_drop_pin_stores_a_fallback_plan_and_charges_nothing(self):
        chop, food = self.make_shop("Chop Bar", "+233207000204", C, slug="food")
        order = self.checkout(food, self.item_a, drop=None)
        self.assertIsNone(order.delivery_fee)
        self.assertEqual(order.route_plan["owner_ids"], [self.shop_a.pk, chop.pk])
        self.assertEqual((order.route_plan["planned"], order.route_plan["total_km"], order.route_plan["direct_km"]), (False, None, None))

    def test_a_shop_without_a_pin_falls_back_and_charges_from_the_first_shop(self):
        _, nowhere = self.make_shop("Shop X", "+233207000205", None)
        with mock.patch("delivery.stops.routing_service.leg", return_value=leg(4.0)):
            order = self.checkout(self.item_a, nowhere)
        self.assertFalse(order.route_plan["planned"])
        self.assertEqual(order.route_plan["direct_km"], 4.0)
        self.assertFalse(any(label.startswith("Detour") for label in self.lines(order)))
        self.assertEqual(order.delivery_fee, Decimal("13.00"))  # 5 + 4 km x 1.5 + 1 x 2

    def test_a_single_shop_at_the_delivery_point_does_not_divide_by_zero(self):
        with mock.patch("routing.planner.service.leg", return_value=leg(0.0)):
            order = self.checkout(self.item_a)
        self.assertIsNone(order.route_plan["detour_pct"])
        self.assertFalse(order.route_plan["over_limit"])
        self.assertEqual(order.delivery_fee, Decimal("8.00"))  # the card's minimum fee

    def test_a_single_shop_fee_is_what_it_was_before_multi_stop(self):
        with mock.patch("routing.planner.service.leg", return_value=leg(7.0)):
            order = self.checkout(self.item_a)
        self.assertEqual(order.delivery_fee, Decimal("15.50"))  # 5 + 7 km x 1.5, no extra pickup, no detour
        self.assertEqual([l["label"] for l in order.delivery_fee_breakdown["lines"]], ["Base", "Distance 7.0 km"])
        self.assertEqual(order.delivery_fee_breakdown["route"]["stops"], 1)

    def test_store_pickup_stores_no_plan(self):
        self.assertIsNone(self.checkout(self.item_a, self.item_b, method="store_pickup").route_plan)

    def test_fees_off_still_stores_the_plan_and_charges_nothing(self):
        with override_settings(DELIVERY_FEE_ENABLED=False), table(UNDER):
            order = self.checkout(self.item_a, self.item_b, self.item_c)
        self.assertIsNone(order.delivery_fee)
        self.assertTrue(order.route_plan["planned"])

    def test_a_free_delivery_promo_from_one_of_three_shops_waives_nothing(self):
        BusinessOwner.objects.filter(pk=self.shop_a.pk).update(kyc_status=BusinessOwner.VERIFIED)
        now = timezone.now()
        DeliveryWaiver.objects.create(business_owner=self.shop_a, name="Free", status=DeliveryWaiver.ACTIVE, all_items=True,
                                      starts_at=now - timedelta(hours=1), ends_at=now + timedelta(days=1))
        with table(UNDER):
            order = self.checkout(self.item_a, self.item_b, self.item_c)
        self.assertNotIn("waived", order.delivery_fee_breakdown)
        self.assertEqual(order.delivery_fee, Decimal("16.50"))
