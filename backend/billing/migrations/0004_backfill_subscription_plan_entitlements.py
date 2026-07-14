from django.db import migrations

# Backfills the structured entitlement fields added in
# 0003_subscriptionplan_boost_credits_per_month_and_more.py for the three
# tiers seeded in 0002_seed_subscription_plans.py.
#
# max_active_listings deliberately follows the seeded `features` copy
# ("1 listing" / "5 listings" / "Unlimited listings") rather than the
# roadmap's suggested placeholder defaults (3 / 10 / 999-or-a-real-cap),
# since the roadmap explicitly says to prefer the seeded copy when it
# contradicts the suggested defaults. hero_days/boost_credits_per_month have
# no equivalent hint in `features`, so those use the roadmap's suggested
# defaults as-is.
ENTITLEMENTS = {
    "basic": {"max_active_listings": 1, "hero_days": 7, "boost_credits_per_month": 0},
    "standard": {"max_active_listings": 5, "hero_days": 10, "boost_credits_per_month": 2},
    # "Unlimited listings" in the seeded `features` copy -> a high effective
    # cap rather than a literal unbounded field, since max_active_listings
    # is a PositiveIntegerField and callers need a concrete number to gate on.
    "premium": {"max_active_listings": 999, "hero_days": 15, "boost_credits_per_month": 5},
}


def backfill(apps, schema_editor):
    SubscriptionPlan = apps.get_model("billing", "SubscriptionPlan")
    for tier, values in ENTITLEMENTS.items():
        SubscriptionPlan.objects.filter(tier=tier).update(**values)


def unbackfill(apps, schema_editor):
    SubscriptionPlan = apps.get_model("billing", "SubscriptionPlan")
    SubscriptionPlan.objects.filter(tier__in=ENTITLEMENTS.keys()).update(
        max_active_listings=0, hero_days=0, boost_credits_per_month=0
    )


class Migration(migrations.Migration):
    dependencies = [("billing", "0003_subscriptionplan_boost_credits_per_month_and_more")]
    operations = [migrations.RunPython(backfill, unbackfill)]
