from django.db import migrations

PERMISSIONS = [
    ("kyc.approve", "Approve or reject business owner KYC submissions"),
    ("listings.moderate", "Approve, edit, or remove marketplace listings"),
    ("users.view", "View customer and business owner profiles"),
    ("escrow.view", "View the escrow ledger"),
    ("escrow.release", "Release or hold escrow payouts"),
    ("disputes.resolve_financial", "Resolve the financial side of a dispute"),
    ("transactions.report", "Generate transaction/financial reports"),
    ("promotions.manage", "Manage promotions and featured listings"),
    ("analytics.view", "View marketplace analytics"),
    ("categories.manage", "Manage marketplace categories"),
    ("messaging.manage", "Manage the messaging/ticket queue"),
    ("disputes.flag", "Flag and intake disputes"),
    ("staff.manage", "Create, invite, deactivate, or reassign staff accounts"),
]

ROLE_PERMISSIONS = {
    "super_admin": [codename for codename, _ in PERMISSIONS],
    "admin": ["kyc.approve", "listings.moderate", "users.view"],
    "accountant": ["escrow.view", "escrow.release", "disputes.resolve_financial", "transactions.report"],
    "marketing": ["promotions.manage", "analytics.view", "categories.manage"],
    "support": ["messaging.manage", "disputes.flag", "users.view"],
}


def seed(apps, schema_editor):
    Permission = apps.get_model("accounts", "Permission")
    Role = apps.get_model("accounts", "Role")

    codename_to_permission = {}
    for codename, description in PERMISSIONS:
        permission, _ = Permission.objects.get_or_create(
            codename=codename, defaults={"description": description}
        )
        codename_to_permission[codename] = permission

    for role_name, codenames in ROLE_PERMISSIONS.items():
        role, _ = Role.objects.get_or_create(name=role_name)
        role.permissions.set([codename_to_permission[c] for c in codenames])


def unseed(apps, schema_editor):
    Role = apps.get_model("accounts", "Role")
    Permission = apps.get_model("accounts", "Permission")
    Role.objects.filter(name__in=ROLE_PERMISSIONS.keys()).delete()
    Permission.objects.filter(codename__in=[c for c, _ in PERMISSIONS]).delete()


class Migration(migrations.Migration):
    dependencies = [("accounts", "0001_initial")]
    operations = [migrations.RunPython(seed, unseed)]
