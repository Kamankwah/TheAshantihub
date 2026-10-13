import django.db.models.deletion
import django.utils.timezone
from django.conf import settings
from django.db import migrations, models

PERMISSION = ("security.manage", "Change security settings (who must use 2-step sign-in) and read the sign-in history")


def seed(apps, schema_editor):
    Permission = apps.get_model("accounts", "Permission")
    Role = apps.get_model("accounts", "Role")
    permission, _ = Permission.objects.get_or_create(codename=PERMISSION[0], defaults={"description": PERMISSION[1]})
    for role in Role.objects.filter(name="super_admin"):
        role.permissions.add(permission)


def unseed(apps, schema_editor):
    apps.get_model("accounts", "Permission").objects.filter(codename=PERMISSION[0]).delete()


class Migration(migrations.Migration):
    initial = True
    dependencies = [("accounts", "0044_seed_cosigner_role")]

    operations = [
        migrations.CreateModel(
            name="SecurityPolicy",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("two_factor_roles", models.JSONField(blank=True, default=list)),
                ("updated_at", models.DateTimeField(blank=True, null=True)),
                ("updated_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="+", to="accounts.staffuser")),
            ],
        ),
        migrations.CreateModel(
            name="StaffSignInRecord",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("at", models.DateTimeField(db_index=True, default=django.utils.timezone.now)),
                ("kind", models.CharField(choices=[
                    ("signed_in", "Signed in"), ("signed_out", "Signed out"), ("timed_out", "Timed out"),
                    ("sign_in_failed", "Sign-in refused"), ("two_step_failed", "2-step code wrong"),
                    ("password_reentered", "Password re-entered"), ("password_reentry_failed", "Password re-entry failed"),
                ], max_length=30)),
                ("identifier_masked", models.CharField(blank=True, default="", max_length=120)),
                ("two_factor", models.BooleanField(default=False)),
                ("note", models.CharField(blank=True, default="", max_length=200)),
                ("ip", models.GenericIPAddressField(blank=True, null=True)),
                ("user_agent", models.CharField(blank=True, default="", max_length=300)),
                ("device_label", models.CharField(blank=True, default="", max_length=120)),
                ("staff", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="+", to="accounts.staffuser")),
            ],
            options={"ordering": ["-id"]},
        ),
        migrations.AddIndex(model_name="staffsigninrecord", index=models.Index(fields=["kind", "-at"], name="staffsecuri_kind_94065c_idx")),
        migrations.AddIndex(model_name="staffsigninrecord", index=models.Index(fields=["staff", "-at"], name="staffsecuri_staff_i_0d61f8_idx")),
        migrations.RunPython(seed, unseed),
    ]
