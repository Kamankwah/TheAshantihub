from django.db import migrations

from payments.legacy import stamp_legacy_paid_months


def forwards(apps, schema_editor):
    stamp_legacy_paid_months(apps.get_model("payments", "CheckoutSession"))


class Migration(migrations.Migration):

    dependencies = [
        ("payments", "0004_alter_checkoutsession_kind"),
    ]

    operations = [
        migrations.RunPython(forwards, migrations.RunPython.noop),
    ]
