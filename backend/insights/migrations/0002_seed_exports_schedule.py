from django.db import migrations

# Who may create and manage scheduled exports. Super Admin holds every
# permission (the invariant in accounts' test_roles_seed).
PERMISSION = ("exports.schedule", "Schedule exports that are sent to named staff as 24-hour links")
ROLES = ["super_admin"]


def seed(apps, schema_editor):
    Permission = apps.get_model("accounts", "Permission")
    Role = apps.get_model("accounts", "Role")
    permission, _ = Permission.objects.get_or_create(codename=PERMISSION[0], defaults={"description": PERMISSION[1]})
    for role in Role.objects.filter(name__in=ROLES):
        role.permissions.add(permission)


def unseed(apps, schema_editor):
    apps.get_model("accounts", "Permission").objects.filter(codename=PERMISSION[0]).delete()


class Migration(migrations.Migration):
    dependencies = [("insights", "0001_initial")]
    operations = [migrations.RunPython(seed, unseed)]
