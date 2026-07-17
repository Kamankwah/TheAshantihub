from django.db import migrations

# Unlocks the staff Credit tab (item 16): viewing every business owner's score,
# applying a manual adjustment, managing lending partners, and reviewing loan
# applications. Seeded to accountant + super_admin — the finance roles — since
# lending is a financial function.
PERMISSIONS = [
    ("credit.manage", "Manage business credit scores, lending partners, and loan applications"),
]


def seed(apps, schema_editor):
    Permission = apps.get_model("accounts", "Permission")
    Role = apps.get_model("accounts", "Role")

    permissions = []
    for codename, description in PERMISSIONS:
        permission, _ = Permission.objects.get_or_create(
            codename=codename, defaults={"description": description}
        )
        permissions.append(permission)

    for role_name in ("accountant",):
        role = Role.objects.get(name=role_name)
        role.permissions.add(*permissions)

    super_admin = Role.objects.get(name="super_admin")
    super_admin.permissions.add(*permissions)


def unseed(apps, schema_editor):
    Permission = apps.get_model("accounts", "Permission")
    Permission.objects.filter(codename__in=[c for c, _ in PERMISSIONS]).delete()


class Migration(migrations.Migration):
    dependencies = [("accounts", "0025_staffuser_extra_permissions_staffuser_is_active_and_more")]
    operations = [migrations.RunPython(seed, unseed)]
