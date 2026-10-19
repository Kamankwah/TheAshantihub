from django.db import migrations

# Marketplace opening gate (plan M1, Task 1): delay the opening and manage the test-customer allowlist.
PERMISSIONS = [
    ("opening.manage", "Delay the marketplace opening and manage the customers allowed to buy before it"),
]


def seed(apps, schema_editor):
    Permission = apps.get_model("accounts", "Permission")
    Role = apps.get_model("accounts", "Role")
    permissions = [Permission.objects.get_or_create(codename=c, defaults={"description": d})[0] for c, d in PERMISSIONS]
    for role in Role.objects.filter(name="super_admin"):
        role.permissions.add(*permissions)


def unseed(apps, schema_editor):
    apps.get_model("accounts", "Permission").objects.filter(codename__in=[c for c, _ in PERMISSIONS]).delete()


class Migration(migrations.Migration):
    dependencies = [("accounts", "0054_seed_wallet_permissions")]
    operations = [migrations.RunPython(seed, unseed)]
