from django.db import migrations

# Deals (plan M1, Task 6): flag a listing as sponsored. Super Admin holds every permission.
PERMISSIONS = [
    ("deals.manage", "Flag listings as sponsored so they appear in Deals"),
]
ROLES = ["marketing", "operations", "super_admin"]


def seed(apps, schema_editor):
    Permission = apps.get_model("accounts", "Permission")
    Role = apps.get_model("accounts", "Role")
    permissions = [Permission.objects.get_or_create(codename=c, defaults={"description": d})[0] for c, d in PERMISSIONS]
    for role in Role.objects.filter(name__in=ROLES):
        role.permissions.add(*permissions)


def unseed(apps, schema_editor):
    apps.get_model("accounts", "Permission").objects.filter(codename__in=[c for c, _ in PERMISSIONS]).delete()


class Migration(migrations.Migration):
    dependencies = [("accounts", "0055_seed_opening_permission")]
    operations = [migrations.RunPython(seed, unseed)]
