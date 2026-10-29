from django.db import migrations

# Ashanti Direct (marketplace Plan 2, Task 11): who may run the company's own shop. Super Admin holds every permission.
PERMISSIONS = [
    ("direct.operate", "Run Ashanti Direct: list, edit, price and stock the company's own products"),
]
GRANTS = {
    "operations": ["direct.operate"],
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
    dependencies = [("accounts", "0066_businessowner_is_company_and_more")]
    operations = [migrations.RunPython(seed, unseed)]
