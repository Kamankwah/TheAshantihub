from django.db import migrations

# Maps every existing Subscription row's old `billing_cycle` value onto the
# new `cycle_months` field before `billing_cycle` itself is dropped in the
# next migration (0010_remove_subscription_billing_cycle.py).
CYCLE_MONTHS_BY_BILLING_CYCLE = {
    "monthly": 1,
    "annual": 12,
}


def backfill(apps, schema_editor):
    Subscription = apps.get_model("billing", "Subscription")
    for billing_cycle, cycle_months in CYCLE_MONTHS_BY_BILLING_CYCLE.items():
        Subscription.objects.filter(billing_cycle=billing_cycle).update(cycle_months=cycle_months)


def unbackfill(apps, schema_editor):
    # No meaningful backwards operation — billing_cycle still holds the
    # original data at this point in the migration history, so there's
    # nothing to restore.
    pass


class Migration(migrations.Migration):
    dependencies = [("billing", "0008_subscription_cycle_months_and_trial")]
    operations = [migrations.RunPython(backfill, unbackfill)]
