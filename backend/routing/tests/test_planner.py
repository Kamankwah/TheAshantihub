from unittest import mock

from django.test import SimpleTestCase

from routing import planner, service

# Rows/columns: shop A, shop B, shop C, then the drop H. Best A-B-C-H = 2+3+1 = 6 km; A to H direct = 5 km.
K = [[0, 2, 9, 5], [2, 0, 3, 4], [9, 3, 0, 1], [5, 4, 1, 0]]
SHOPS = [
    {"key": "A", "lat": 6.700, "lng": -1.620, "food": False},
    {"key": "B", "lat": 6.705, "lng": -1.615, "food": False},
    {"key": "C", "lat": 6.710, "lng": -1.610, "food": False},
]
DROP = (6.69, -1.62)


def table(km=K, basis=service.BASIS_ROAD):
    return mock.patch("routing.planner.service.matrix", return_value={"km": km, "basis": basis})


class PlanRouteTests(SimpleTestCase):
    def test_the_shortest_order_ends_at_the_drop(self):
        with table() as call:
            got = planner.plan_route(SHOPS, DROP)
        self.assertEqual(got, {"order": ["A", "B", "C"], "total_km": 6, "direct_km": 5, "legs_km": [2, 3, 1], "basis": service.BASIS_ROAD})
        call.assert_called_once()
        self.assertEqual(call.call_args[0][0][-1], DROP)

    def test_food_shops_are_collected_last(self):
        shops = [{**SHOPS[0], "food": True}, SHOPS[1], SHOPS[2]]
        with table():
            got = planner.plan_route(shops, DROP)
        self.assertEqual(got["order"], ["C", "B", "A"])  # C-B-A-H = 3+2+5; A may not come before B or C
        self.assertEqual((got["total_km"], got["direct_km"]), (10, 1))

    def test_two_food_shops_both_follow_every_other_shop(self):
        shops = [{**SHOPS[0], "food": True}, {**SHOPS[1], "food": True}, SHOPS[2]]
        with table():
            self.assertEqual(planner.plan_route(shops, DROP)["order"], ["C", "B", "A"])

    def test_an_estimated_table_labels_the_plan(self):
        with table(basis=service.BASIS_ESTIMATE):
            self.assertEqual(planner.plan_route(SHOPS, DROP)["basis"], service.BASIS_ESTIMATE)

    def test_one_shop_uses_the_single_leg_and_no_table(self):
        leg = {"distance_km": 4.2, "duration_s": 600, "basis": service.BASIS_ROAD, "geometry": None}
        with mock.patch("routing.planner.service.leg", return_value=leg), table() as call:
            got = planner.plan_route(SHOPS[:1], DROP)
        call.assert_not_called()
        self.assertEqual(got, {"order": ["A"], "total_km": 4.2, "direct_km": 4.2, "legs_km": [4.2], "basis": service.BASIS_ROAD})

    def test_six_shops_are_brute_forced(self):
        shops = [{"key": n, "lat": 6.7 + n / 100, "lng": -1.62, "food": False} for n in range(1, 7)]
        positions = [1, 2, 3, 4, 5, 6, 0]  # shops on a line, the drop at 0
        km = [[abs(a - b) for b in positions] for a in positions]
        with table(km):
            got = planner.plan_route(shops, DROP)
        self.assertEqual(got["order"], [6, 5, 4, 3, 2, 1])
        self.assertEqual((got["total_km"], got["direct_km"]), (6, 6))

    def test_ties_go_to_the_earlier_shops(self):
        flat = [[0 if i == j else 1 for j in range(4)] for i in range(4)]
        with table(flat):
            self.assertEqual(planner.plan_route(SHOPS, DROP)["order"], ["A", "B", "C"])

    def test_no_shops_or_more_than_six_is_refused(self):
        with self.assertRaises(ValueError):
            planner.plan_route([], DROP)
        with self.assertRaises(ValueError):
            planner.plan_route([{**SHOPS[0], "key": n} for n in range(7)], DROP)

    def test_detour_pct(self):
        self.assertEqual(planner.detour_pct(6, 5), 20.0)
        self.assertEqual(planner.detour_pct(5, 5), 0.0)
        self.assertIsNone(planner.detour_pct(4, 0))
        self.assertIsNone(planner.detour_pct(None, 5))


class SharedBoundTests(SimpleTestCase):
    def test_the_rate_card_shop_bound_is_the_planner_bound(self):
        from delivery import config
        self.assertIs(config.MAX_STOPS, planner.MAX_STOPS)
        with self.assertRaises(config.ConfigError):
            config._int({"max_shops_per_delivery": planner.MAX_STOPS + 1}, "max_shops_per_delivery", 1, config.MAX_STOPS, default=4)
