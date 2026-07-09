from django.db import migrations


def seed(apps, schema_editor):
    Permission = apps.get_model("accounts", "Permission")
    Role = apps.get_model("accounts", "Role")

    permission, _ = Permission.objects.get_or_create(
        codename="zones.manage", defaults={"description": "Manage marketplace zones"}
    )
    for role_name in ("admin", "marketing"):
        role = Role.objects.get(name=role_name)
        role.permissions.add(permission)

    super_admin = Role.objects.get(name="super_admin")
    super_admin.permissions.add(permission)


def unseed(apps, schema_editor):
    Permission = apps.get_model("accounts", "Permission")
    Permission.objects.filter(codename="zones.manage").delete()


class Migration(migrations.Migration):
    dependencies = [("accounts", "0005_businessowner_businessownerprofile")]
    operations = [migrations.RunPython(seed, unseed)]
