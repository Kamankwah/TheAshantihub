from django.db import migrations

# Platform-fee and money-setting governance (ledger plan, Task 6). Super Admin holds every permission.
PERMISSIONS = [
    ("fees.view", "See the platform-fee rules, money settings and what is waiting for approval"),
    ("fees.manage", "Propose platform-fee rules and money settings for approval"),
]
GRANTS = {
    "accountant": ["fees.view", "fees.manage"],
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
    dependencies = [("accounts", "0048_merge_20261013_0901")]
    operations = [migrations.RunPython(seed, unseed)]
