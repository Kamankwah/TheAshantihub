from django.db import migrations

# Mirrors frontend/App.jsx's SUBSCRIPTION_PLANS (~line 628) so BusinessDashboard's
# and PaymentDashboard's Subscription tabs get the same tiers from a real endpoint.
PLANS = [
    {
        "tier": "basic", "name": "Basic", "monthly_price": "20.00", "annual_price": "200.00",
        "features": ["1 listing", "WhatsApp connect", "Basic analytics", "Email support"],
        "is_recommended": False,
    },
    {
        "tier": "standard", "name": "Standard", "monthly_price": "100.00", "annual_price": "1000.00",
        "features": [
            "5 listings", "Featured placement", "Full analytics", "Priority support", "Price alerts",
        ],
        "is_recommended": True,
    },
    {
        "tier": "premium", "name": "Premium", "monthly_price": "200.00", "annual_price": "2000.00",
        "features": [
            "Unlimited listings", "Top search", "Advanced analytics", "Account manager",
            "WhatsApp broadcast",
        ],
        "is_recommended": False,
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
    dependencies = [("billing", "0001_initial")]
    operations = [migrations.RunPython(seed, unseed)]
