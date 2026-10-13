import django.db.models.deletion
from django.db import migrations, models

# Step-in ("view as", Super Admin build SA-6, owner decision 3 of 2026-10-12):
# a Super Admin can open a team lead's workspace read-only. staff.view_as is
# Super Admin's alone (the "holds every permission" invariant in
# test_roles_seed); the server also requires the Super Admin role itself, so a
# per-person grant of the code to anyone else does nothing.
PERMISSION = ("staff.view_as", "Step in: see a team member's workspace read-only, as they see it (Super Admin only)")


def seed(apps, schema_editor):
    Permission = apps.get_model("accounts", "Permission")
    Role = apps.get_model("accounts", "Role")
    permission, _ = Permission.objects.get_or_create(codename=PERMISSION[0], defaults={"description": PERMISSION[1]})
    for role in Role.objects.filter(name="super_admin"):
        role.permissions.add(permission)


def unseed(apps, schema_editor):
    apps.get_model("accounts", "Permission").objects.filter(codename=PERMISSION[0]).delete()


class Migration(migrations.Migration):
    dependencies = [("accounts", "0044_seed_cosigner_role")]
    operations = [
        migrations.AddField(
            model_name="staffsession",
            name="view_as_target",
            field=models.ForeignKey(
                blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL,
                related_name="+", to="accounts.staffuser",
            ),
        ),
        migrations.AddField(
            model_name="staffsession",
            name="view_as_started_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.RunPython(seed, unseed),
    ]
