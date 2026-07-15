from django.db import migrations

PERMISSIONS = [
    ("site_settings.manage", "Edit site-wide settings (footer contact info and social links)"),
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

    for role_name in ("admin", "super_admin"):
        role = Role.objects.get(name=role_name)
        role.permissions.add(*permissions)


def unseed(apps, schema_editor):
    Permission = apps.get_model("accounts", "Permission")
    Permission.objects.filter(codename__in=[c for c, _ in PERMISSIONS]).delete()


class Migration(migrations.Migration):
    dependencies = [("accounts", "0009_seed_hero_and_event_approve_permissions")]
    operations = [migrations.RunPython(seed, unseed)]
