from django.db import migrations

PERMISSIONS = [
    ("hero_media.approve", "Approve or reject business hero-media submissions"),
    ("event.approve", "Approve or reject submitted events"),
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

    for role_name in ("admin", "marketing"):
        role = Role.objects.get(name=role_name)
        role.permissions.add(*permissions)

    super_admin = Role.objects.get(name="super_admin")
    super_admin.permissions.add(*permissions)


def unseed(apps, schema_editor):
    Permission = apps.get_model("accounts", "Permission")
    Permission.objects.filter(codename__in=[c for c, _ in PERMISSIONS]).delete()


class Migration(migrations.Migration):
    dependencies = [("accounts", "0008_business_registration_stages")]
    operations = [migrations.RunPython(seed, unseed)]
