from datetime import datetime, timezone

from django.db import migrations

# Owner decision 2026-10-18: suggest figures now; a Super Admin edits them from Money rules (plan 7A). Pesewas;
# (lower, upper, percent basis points). Products keep the original ladder seeded in 0004.
LADDERS = {
    "service": [(0, 49_999, 200), (50_000, 499_999, 150), (500_000, None, 100)],
    "event": [(0, 9_999, 300), (10_000, 99_999, 250), (100_000, None, 200)],
}
SEEDED_BEFORE = datetime(2020, 1, 2, tzinfo=timezone.utc)  # 0004's rule sets start 2020-01-01; these start at migration time


def seed(apps, schema_editor):
    RuleSet = apps.get_model("ledger", "FeeRuleSet")
    Band = apps.get_model("ledger", "FeeBand")
    start = datetime.now(timezone.utc)
    for category, bands in LADDERS.items():
        rule_set = RuleSet.objects.create(category=category, effective_from=start)
        for lower, upper, percent in bands:
            Band.objects.create(rule_set=rule_set, lower_pesewas=lower, upper_pesewas=upper, percent_bp=percent)


def unseed(apps, schema_editor):
    apps.get_model("ledger", "FeeRuleSet").objects.filter(
        category__in=list(LADDERS), approval_id__isnull=True, created_by__isnull=True, effective_from__gt=SEEDED_BEFORE,
    ).delete()


class Migration(migrations.Migration):
    dependencies = [("ledger", "0008_booking_sales")]
    operations = [migrations.RunPython(seed, unseed)]
