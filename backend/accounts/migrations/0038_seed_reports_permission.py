from django.db import migrations


def seed(apps, schema_editor):
    Permission = apps.get_model("accounts", "Permission")
    Role = apps.get_model("accounts", "Role")
    perm, _ = Permission.objects.get_or_create(
        codename="reports.view_all",
        defaults={"description": "Read, review and export every staff member's reports"},
    )
    Role.objects.get(name="super_admin").permissions.add(perm)


def unseed(apps, schema_editor):
    apps.get_model("accounts", "Permission").objects.filter(codename="reports.view_all").delete()


class Migration(migrations.Migration):
    dependencies = [("accounts", "0037_seed_approvals_permission")]
    operations = [migrations.RunPython(seed, unseed)]
