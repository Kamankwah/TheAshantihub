import hashlib

from django.db import migrations, models


def hash_pending_invites(apps, schema_editor):
    """A pending invitation's raw 43-character token becomes its SHA-256 (review DB-14); the emailed link keeps working."""
    StaffUser = apps.get_model("accounts", "StaffUser")
    for pk, token in list(StaffUser.objects.filter(invite_token__isnull=False).values_list("pk", "invite_token")):
        if len(token) != 64:
            StaffUser.objects.filter(pk=pk).update(invite_token=hashlib.sha256(token.encode()).hexdigest())


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0082_pii_encryption'),
    ]

    operations = [
        # lint-migrations: ok varchar(6) to varchar(64) is a catalogue-only change in Postgres (no rewrite); the column now holds an HMAC (review DB-14)
        migrations.AlterField(
            model_name='customer',
            name='secondary_email_verify_code',
            field=models.CharField(blank=True, max_length=64, null=True),
        ),
        # lint-migrations: ok varchar(6) to varchar(64) is a catalogue-only change in Postgres (no rewrite); the column now holds an HMAC (review DB-14)
        migrations.AlterField(
            model_name='customer',
            name='secondary_phone_verify_code',
            field=models.CharField(blank=True, max_length=64, null=True),
        ),
        # lint-migrations: ok one-off update of the few pending staff invitations, in the migration's transaction
        migrations.RunPython(hash_pending_invites, migrations.RunPython.noop),
    ]
