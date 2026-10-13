from django.db import migrations

# Integrations and System health (Super Admin build SA-9) are read by Super Admin alone.
PERMISSION = ("system.view", "See which outside services are connected and how the system is running")


def seed(apps, schema_editor):
    Permission = apps.get_model("accounts", "Permission")
    Role = apps.get_model("accounts", "Role")
    permission, _ = Permission.objects.get_or_create(codename=PERMISSION[0], defaults={"description": PERMISSION[1]})
    for role in Role.objects.filter(name="super_admin"):
        role.permissions.add(permission)


def unseed(apps, schema_editor):
    apps.get_model("accounts", "Permission").objects.filter(codename=PERMISSION[0]).delete()


class Migration(migrations.Migration):
    dependencies = [("core", "0005_sa9"), ("accounts", "0046_seed_roles_manage")]
    operations = [migrations.RunPython(seed, unseed)]
