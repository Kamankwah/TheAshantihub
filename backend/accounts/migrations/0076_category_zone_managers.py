from django.db import migrations

# Categories and zones (and their pictures) are run by Marketing, Operations and Super Admin. Marketing and Super Admin
# already held both; Operations held zones.manage only, so it gains categories.manage. Idempotent for the others.
CODENAMES = ("categories.manage", "zones.manage")
ROLES = ("marketing", "operations", "super_admin")


def seed(apps, schema_editor):
    Permission = apps.get_model("accounts", "Permission")
    Role = apps.get_model("accounts", "Role")
    permissions = [Permission.objects.get_or_create(codename=c, defaults={"description": f"Manage marketplace {c.split('.')[0]}"})[0] for c in CODENAMES]
    for role in Role.objects.filter(name__in=ROLES):
        role.permissions.add(*permissions)


def unseed(apps, schema_editor):
    # Only the grant this migration added; the permissions themselves belong to earlier migrations.
    Permission = apps.get_model("accounts", "Permission")
    for role in apps.get_model("accounts", "Role").objects.filter(name="operations"):
        role.permissions.remove(*Permission.objects.filter(codename="categories.manage"))


class Migration(migrations.Migration):
    dependencies = [("accounts", "0075_mobilesession_fingerprint")]
    operations = [migrations.RunPython(seed, unseed)]
