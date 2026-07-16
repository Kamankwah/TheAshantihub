from django.db import migrations

TIERS = [(7, "20.00"), (15, "30.00"), (30, "50.00"), (60, "90.00"), (90, "120.00")]


def seed(apps, schema_editor):
    EventPricingTier = apps.get_model("events", "EventPricingTier")
    for days, price in TIERS:
        EventPricingTier.objects.get_or_create(
            duration_days=days, defaults={"live_price": price}
        )


def unseed(apps, schema_editor):
    EventPricingTier = apps.get_model("events", "EventPricingTier")
    EventPricingTier.objects.filter(duration_days__in=[d for d, _ in TIERS]).delete()


class Migration(migrations.Migration):
    dependencies = [("events", "0004_eventpricingtier")]
    operations = [migrations.RunPython(seed, unseed)]
