from django.db import migrations

PERMISSIONS = [
    ("escrow.refund", "Refund a held ticket purchase before delivery"),
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
    dependencies = [("accounts", "0011_seed_reviews_moderate_permission")]
    operations = [migrations.RunPython(seed, unseed)]
