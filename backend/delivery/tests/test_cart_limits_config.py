from decimal import Decimal

from delivery import config
from delivery.models import RateCard

from .test_dispatch import CARD, EngineCase


class CartLimitConfigTests(EngineCase):
    def propose(self, **over):
        self.as_staff(self.admin, sudo=True)
        return self.client.post("/api/delivery/rules/rate-card/", {"values": {**CARD, **over}}, format="json")

    def test_built_in_defaults_run_until_a_card_is_in_force(self):
        limits = config.effective_cart_limits()
        self.assertEqual(limits["source"], "defaults")
        self.assertIsNone(limits["version"])
        self.assertEqual((limits["max_shops_per_delivery"], limits["max_food_shops"], limits["detour_limit_pct"]), (4, 2, 40))
        self.assertEqual(limits["near_shop_radius_km"], Decimal("3.00"))

    def test_a_card_proposed_without_the_limits_gets_the_defaults(self):
        self.assertEqual(self.propose().status_code, 201)
        card = config.live(RateCard)
        self.assertEqual((card.max_shops_per_delivery, card.max_food_shops, card.near_shop_radius_km, card.detour_limit_pct), (4, 2, Decimal("3.00"), 40))
        self.assertEqual(config.effective_cart_limits()["source"], "version")

    def test_the_manager_changes_the_limits_through_the_card(self):
        r = self.propose(max_shops_per_delivery=3, max_food_shops=1, near_shop_radius_km="2.5", detour_limit_pct=25)
        self.assertEqual(r.status_code, 201, r.content)
        limits = config.effective_cart_limits()
        self.assertEqual(
            (limits["max_shops_per_delivery"], limits["max_food_shops"], limits["near_shop_radius_km"], limits["detour_limit_pct"]),
            (3, 1, Decimal("2.50"), 25),
        )
        data = self.client.get("/api/delivery/rules/rate-card/").json()
        self.assertEqual(data["current"]["max_shops_per_delivery"], 3)
        self.assertEqual(data["current"]["near_shop_radius_km"], "2.50")
        self.assertEqual(data["cart_limits"], {"source": "version", "version": data["current"]["version"], "max_shops_per_delivery": 3,
                                               "max_food_shops": 1, "near_shop_radius_km": "2.50", "detour_limit_pct": 25})

    def test_bad_limits_are_refused_with_the_field(self):
        cases = (
            ({"max_shops_per_delivery": 7}, "max_shops_per_delivery"),
            ({"max_shops_per_delivery": 0}, "max_shops_per_delivery"),
            ({"max_shops_per_delivery": 2, "max_food_shops": 3}, "max_food_shops"),
            ({"near_shop_radius_km": "0.1"}, "near_shop_radius_km"),
            ({"near_shop_radius_km": "far"}, "near_shop_radius_km"),
            ({"detour_limit_pct": 301}, "detour_limit_pct"),
            ({"detour_limit_pct": "x"}, "detour_limit_pct"),
        )
        for over, field in cases:
            r = self.propose(**over)
            self.assertEqual(r.status_code, 400, (over, r.content))
            self.assertEqual(r.json()["field"], field)
        self.assertIsNone(config.live(RateCard))
