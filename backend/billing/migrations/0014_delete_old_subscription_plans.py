from django.db import migrations

# Deletes the old flat basic/standard/premium SubscriptionPlan rows (seeded in
# 0002_seed_subscription_plans.py) now that every subscriber has been moved
# onto one of the 3 new product/service-scoped plans by the previous
# migration (0013_backfill_business_kind_and_subscriptions.py). Kept as its
# own separate migration — not combined with the seed (0012) or backfill
# (0013) migrations — so a failure here can't unwind either of those.
OLD_TIERS = ["basic", "standard", "premium"]


def delete_old_plans(apps, schema_editor):
    SubscriptionPlan = apps.get_model("billing", "SubscriptionPlan")
    SubscriptionPlan.objects.filter(tier__in=OLD_TIERS).delete()


def restore_old_plans(apps, schema_editor):
    # Mirrors 0002_seed_subscription_plans.py's original seed data so a
    # reverse migration puts back rows matching what existed before this
    # migration ran (any subscriptions that pointed at them were already
    # repointed at the new plans by 0013 and are not restored here).
    SubscriptionPlan = apps.get_model("billing", "SubscriptionPlan")
    OLD_PLANS = [
        {
            "tier": "basic", "name": "Basic", "kind": "product", "monthly_price": "20.00",
            "features": ["1 listing", "WhatsApp connect", "Basic analytics", "Email support"],
            "is_recommended": False, "status": "active",
            "max_active_listings": 1, "hero_days": 7, "boost_credits_per_month": 0,
        },
        {
            "tier": "standard", "name": "Standard", "kind": "product", "monthly_price": "100.00",
            "features": [
                "5 listings", "Featured placement", "Full analytics", "Priority support", "Price alerts",
            ],
            "is_recommended": True, "status": "active",
            "max_active_listings": 5, "hero_days": 10, "boost_credits_per_month": 2,
        },
        {
            "tier": "premium", "name": "Premium", "kind": "product", "monthly_price": "200.00",
            "features": [
                "Unlimited listings", "Top search", "Advanced analytics", "Account manager",
                "WhatsApp broadcast",
            ],
            "is_recommended": False, "status": "active",
            "max_active_listings": None, "hero_days": 15, "boost_credits_per_month": 5,
        },
    ]
    for plan in OLD_PLANS:
        SubscriptionPlan.objects.get_or_create(tier=plan["tier"], defaults=plan)


class Migration(migrations.Migration):
    dependencies = [("billing", "0013_backfill_business_kind_and_subscriptions")]
    operations = [migrations.RunPython(delete_old_plans, restore_old_plans)]
