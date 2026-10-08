from django.db import migrations

PERMISSIONS = [
    ("activity.view_team", "See your direct reports' activity"),
    ("activity.view_domains", "See the activity of the roles your role oversees"),
    ("activity.view_all", "See every staff member's activity"),
]
GRANTS = {
    "operations": ["activity.view_team", "activity.view_domains"],
    "delivery_manager": ["activity.view_team"],
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
    dependencies = [("accounts", "0032_seed_team_invites")]
    operations = [migrations.RunPython(seed, unseed)]
