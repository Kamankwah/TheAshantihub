from django.db import migrations


def seed(apps, schema_editor):
    Permission = apps.get_model("accounts", "Permission")
    Role = apps.get_model("accounts", "Role")
    perm, _ = Permission.objects.get_or_create(
        codename="approvals.view_all",
        defaults={"description": "See every approval request and decide any of them, at any stage"},
    )
    Role.objects.get(name="super_admin").permissions.add(perm)


def unseed(apps, schema_editor):
    apps.get_model("accounts", "Permission").objects.filter(codename="approvals.view_all").delete()


class Migration(migrations.Migration):
    dependencies = [("accounts", "0036_stafftwofactor")]
    operations = [migrations.RunPython(seed, unseed)]
