from django.db import migrations

# Staff phase 2 (scouts + Operations, spec S12). Plan 2B uses the targets,
# calendar, leave and commission ones; seeding them now keeps one migration.
# Every new permission is also granted to super_admin (the "Super Admin holds
# every permission" invariant in test_roles_seed).
PERMISSIONS = [
    ("businesses.register", "Register a business on its owner's behalf"),
    ("businesses.manage_portfolio", "Manage the businesses you are account manager for and propose changes to them"),
    ("portfolio.manage", "See every portfolio, reassign businesses between scouts and create follow-ups"),
    ("targets.manage", "Set daily targets for your team within the limits"),
    ("targets.limits", "Set the lowest and highest daily target allowed for each measure"),
    ("calendar.manage", "Keep the list of public holidays"),
    ("leave.record", "Record leave for the people on your team"),
    ("commission.view_own", "See your own commission statement"),
    ("commission.view_all", "See every staff member's commission records"),
    ("commission.policy", "Propose commission amounts for approval"),
    ("fraud.manage", "Work the fraud-case queue: confirm or dismiss cases"),
    ("fraud.flag", "Raise a fraud case about a business or a staff member"),
]
GRANTS = {
    "scout": ["businesses.register", "businesses.manage_portfolio", "commission.view_own"],
    "operations": [
        "businesses.register", "portfolio.manage", "targets.manage", "leave.record",
        "fraud.manage", "fraud.flag",
    ],
    "accountant": ["commission.view_all", "commission.policy"],
    "support": ["fraud.flag"],
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
    dependencies = [("accounts", "0038_seed_reports_permission")]
    operations = [migrations.RunPython(seed, unseed)]
