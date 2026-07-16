from django.db import migrations

# Seeds the 3 new business-subscription plans replacing the old flat
# basic/standard/premium tiers: two Product tiers (Basic capped at 5 active
# listings, Unlimited uncapped) and one Service tier (uncapped, no listing
# count is meaningful the same way for a service business). Pre-approved
# (status="active") since these are the platform's own baseline plans, not
# an accountant-authored plan awaiting super_admin approval.
PLANS = [
    {
        "tier": "product_basic", "name": "Product Basic", "kind": "product",
        "monthly_price": "10.00", "max_active_listings": 5, "hero_days": 7,
        "boost_credits_per_month": 0, "is_recommended": False,
        "status": "active",
        "features": [
            "Up to 5 active listings", "7-day hero placement eligibility",
            "Basic analytics", "Email support",
        ],
    },
    {
        "tier": "product_unlimited", "name": "Product Unlimited", "kind": "product",
        "monthly_price": "30.00", "max_active_listings": None, "hero_days": 14,
        "boost_credits_per_month": 3, "is_recommended": True,
        "status": "active",
        "features": [
            "Unlimited active listings", "14-day hero placement eligibility",
            "3 boost credits every month", "Full analytics", "Priority support",
        ],
    },
    {
        "tier": "service", "name": "Service", "kind": "service",
        "monthly_price": "150.00", "max_active_listings": None, "hero_days": 14,
        "boost_credits_per_month": 3, "is_recommended": False,
        "status": "active",
        "features": [
            "Unlimited active service listings", "14-day hero placement eligibility",
            "3 boost credits every month", "Full analytics", "Priority support",
            "Dedicated account manager",
        ],
    },
]


def seed(apps, schema_editor):
    SubscriptionPlan = apps.get_model("billing", "SubscriptionPlan")
    for plan in PLANS:
        SubscriptionPlan.objects.get_or_create(tier=plan["tier"], defaults=plan)


def unseed(apps, schema_editor):
    SubscriptionPlan = apps.get_model("billing", "SubscriptionPlan")
    SubscriptionPlan.objects.filter(tier__in=[p["tier"] for p in PLANS]).delete()


class Migration(migrations.Migration):
    dependencies = [("billing", "0011_remove_subscriptionplan_annual_price")]
    operations = [migrations.RunPython(seed, unseed)]
