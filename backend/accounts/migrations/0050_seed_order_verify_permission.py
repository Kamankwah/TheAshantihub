from django.db import migrations

# Support's verification call on a delivered or collected product order (ledger plan, Task 8).
PERMISSIONS = [("orders.verify", "Verify a delivered order with the customer and release the vendor's money")]
GRANTS = {"support": ["orders.verify"], "super_admin": ["orders.verify"]}


def seed(apps, schema_editor):
    Permission = apps.get_model("accounts", "Permission")
    Role = apps.get_model("accounts", "Role")
    by_code = {}
    for codename, description in PERMISSIONS:
        by_code[codename], _ = Permission.objects.get_or_create(codename=codename, defaults={"description": description})
    for role_name, codenames in GRANTS.items():
        Role.objects.get(name=role_name).permissions.add(*[by_code[c] for c in codenames])


def unseed(apps, schema_editor):
    apps.get_model("accounts", "Permission").objects.filter(codename__in=[c for c, _ in PERMISSIONS]).delete()


class Migration(migrations.Migration):
    dependencies = [("accounts", "0049_seed_ledger_permissions")]
    operations = [migrations.RunPython(seed, unseed)]
