from django.test import TestCase

from billing.models import SubscriptionPlan

# Expected seeded entitlement values per tier — mirrors
# 0012_seed_new_subscription_plans.py. `max_active_listings=None` means
# unlimited (product_unlimited/service).
EXPECTED_ENTITLEMENTS = {
    "product_basic": {"max_active_listings": 5, "hero_days": 7, "boost_credits_per_month": 0},
    "product_unlimited": {"max_active_listings": None, "hero_days": 14, "boost_credits_per_month": 3},
    "service": {"max_active_listings": None, "hero_days": 14, "boost_credits_per_month": 3},
}


class SubscriptionPlanEntitlementFieldTests(TestCase):
    def test_entitlement_fields_default_sensibly(self):
        # Built as an unsaved instance (tier is unique and the three seeded
        # tiers already exist) — this only checks the field defaults.
        plan = SubscriptionPlan(tier="product_basic", name="Product Basic", kind="product", monthly_price="0")
        self.assertIsNone(plan.max_active_listings)
        self.assertEqual(plan.hero_days, 0)
        self.assertEqual(plan.boost_credits_per_month, 0)

    def test_seeded_plans_are_backfilled_with_expected_entitlements(self):
        for tier, expected in EXPECTED_ENTITLEMENTS.items():
            plan = SubscriptionPlan.objects.get(tier=tier)
            self.assertEqual(plan.max_active_listings, expected["max_active_listings"], tier)
            self.assertEqual(plan.hero_days, expected["hero_days"], tier)
            self.assertEqual(plan.boost_credits_per_month, expected["boost_credits_per_month"], tier)
