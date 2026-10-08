from django.db import migrations

PERMISSIONS = [
    ("calls.log", "Log inbound and outbound calls"),
    ("calls.view_team", "See your direct reports' call logs"),
    ("calls.view_all", "See every call log, with full phone numbers"),
]
GRANTS = {
    "scout": ["calls.log"],
    "support": ["calls.log"],
    "operations": ["calls.log", "calls.view_team"],
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
    dependencies = [("accounts", "0033_seed_activity_permissions")]
    operations = [migrations.RunPython(seed, unseed)]
