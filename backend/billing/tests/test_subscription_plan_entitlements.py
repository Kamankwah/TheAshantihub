from django.test import TestCase

from billing.models import SubscriptionPlan

# Expected backfilled entitlement values per seeded tier — mirrors
# 0004_backfill_subscription_plan_entitlements.py. Deviates from the roadmap's
# suggested defaults where the seeded `features` copy explicitly contradicts
# them (basic/standard say "1 listing"/"5 listings", not 3/10).
EXPECTED_ENTITLEMENTS = {
    "basic": {"max_active_listings": 1, "hero_days": 7, "boost_credits_per_month": 0},
    "standard": {"max_active_listings": 5, "hero_days": 10, "boost_credits_per_month": 2},
    "premium": {"max_active_listings": 999, "hero_days": 15, "boost_credits_per_month": 5},
}


class SubscriptionPlanEntitlementFieldTests(TestCase):
    def test_entitlement_fields_default_to_zero(self):
        # Built as an unsaved instance (tier is unique and the three seeded
        # tiers already exist) — this only checks the field defaults.
        plan = SubscriptionPlan(tier="basic", name="Basic", monthly_price="0", annual_price="0")
        self.assertEqual(plan.max_active_listings, 0)
        self.assertEqual(plan.hero_days, 0)
        self.assertEqual(plan.boost_credits_per_month, 0)

    def test_seeded_plans_are_backfilled_with_expected_entitlements(self):
        for tier, expected in EXPECTED_ENTITLEMENTS.items():
            plan = SubscriptionPlan.objects.get(tier=tier)
            self.assertEqual(plan.max_active_listings, expected["max_active_listings"], tier)
            self.assertEqual(plan.hero_days, expected["hero_days"], tier)
            self.assertEqual(plan.boost_credits_per_month, expected["boost_credits_per_month"], tier)
