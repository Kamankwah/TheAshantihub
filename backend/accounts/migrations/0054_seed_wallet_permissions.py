from django.db import migrations

# Wallets (wallets plan 3a, Task 9; 3b uses wallets.manage). Super Admin holds every permission.
PERMISSIONS = [
    ("wallets.view", "See customer wallets and vendor balances, withdrawals and the nightly reconciliation"),
    ("wallets.manage", "Fail a withdrawal stuck with the provider and return the money (password again)"),
]
GRANTS = {
    "accountant": ["wallets.view", "wallets.manage"],
    "super_admin": [codename for codename, _ in PERMISSIONS],
}


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
    dependencies = [("accounts", "0053_seed_otp_recovery_permission")]
    operations = [migrations.RunPython(seed, unseed)]
