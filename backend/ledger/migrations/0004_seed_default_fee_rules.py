from datetime import datetime, timezone

from django.db import migrations

# The brief's product tiers (pesewas). Services and events start as copies for the owner to change.
BANDS = [
    (0, 9999, 100, None),
    (10000, 49999, None, 500),
    (50000, 4999999, 100, None),
    (5000000, None, None, 50000),
]


def seed(apps, schema_editor):
    RuleSet = apps.get_model("ledger", "FeeRuleSet")
    Band = apps.get_model("ledger", "FeeBand")
    start = datetime(2020, 1, 1, tzinfo=timezone.utc)
    for category in ("product", "service", "event"):
        rule_set = RuleSet.objects.create(category=category, effective_from=start)
        for lower, upper, percent, flat in BANDS:
            Band.objects.create(rule_set=rule_set, lower_pesewas=lower, upper_pesewas=upper, percent_bp=percent, flat_pesewas=flat)


def unseed(apps, schema_editor):
    apps.get_model("ledger", "FeeRuleSet").objects.filter(approval_id__isnull=True, created_by__isnull=True).delete()


class Migration(migrations.Migration):
    dependencies = [("ledger", "0003_fee_models")]
    operations = [migrations.RunPython(seed, unseed)]
