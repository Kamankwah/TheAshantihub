from django.db import migrations

# Director ruling 1 (2026-10-20): the re-delivery fee (ledger setting redelivery_fee_pesewas) is changed by Operations as
# well as the Super Admin. A holder proposes it on the money-settings endpoint and another holder (Operations or a Super
# Admin) approves it through the ledger.redelivery_fee approval kind; a Super Admin's own change applies at once. No other
# money setting is reachable with this permission.
PERMISSION = ("redelivery_fee.manage", "Change the re-delivery fee (another Operations lead or a Super Admin approves)")
ROLES = ("operations", "super_admin")


def seed(apps, schema_editor):
    Permission = apps.get_model("accounts", "Permission")
    Role = apps.get_model("accounts", "Role")
    permission, _ = Permission.objects.get_or_create(codename=PERMISSION[0], defaults={"description": PERMISSION[1]})
    for role in Role.objects.filter(name__in=ROLES):
        role.permissions.add(permission)


def unseed(apps, schema_editor):
    apps.get_model("accounts", "Permission").objects.filter(codename=PERMISSION[0]).delete()


class Migration(migrations.Migration):
    dependencies = [("accounts", "0060_seed_business_hours_permission")]
    operations = [migrations.RunPython(seed, unseed)]
