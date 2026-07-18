from django.db import migrations

# The six lending partners seeded by 0003 were placeholder/demo data (the old
# hardcoded frontend LENDING_PARTNERS directory). Per the launch punch-list the
# platform should ship with an EMPTY partner list — real partners are onboarded
# by staff through the credit panel only after they've actually agreed to lend.
#
# Deletes strictly by the six seeded names, so any real partner staff have
# already added (a different name) is left untouched. Reverse re-seeds them via
# 0003's own seed() so the migration pair stays reversible.
SEEDED_NAMES = [
    "Fidelity Bank Ghana",
    "Sinapi Aba Savings & Loans",
    "Opportunity International Ghana",
    "ARB Apex Bank",
    "Absa Ghana SME",
    "Ghana Enterprise Agency",
]


def clear(apps, schema_editor):
    LendingPartner = apps.get_model("credit", "LendingPartner")
    LendingPartner.objects.filter(name__in=SEEDED_NAMES).delete()


def reseed(apps, schema_editor):
    # Re-run 0003's seed so `migrate credit 0003` restores the demo rows.
    import importlib

    seed_module = importlib.import_module("credit.migrations.0003_seed_lending_partners")
    seed_module.seed(apps, schema_editor)


class Migration(migrations.Migration):
    dependencies = [("credit", "0003_seed_lending_partners")]
    operations = [migrations.RunPython(clear, reseed)]
