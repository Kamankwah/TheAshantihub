from django.db import migrations

# AshantiHub-funded free-delivery promos (plan 7F-E Task 4, Ruling R2): Marketing creates, Operations or Super Admin approves.
PERMISSIONS = [
    ("delivery_promo.fund", "Create a free-delivery promo that AshantiHub pays for (it waits for approval)"),
    ("delivery_promo.approve", "Approve or return an AshantiHub-funded free-delivery promo"),
]
GRANTS = {
    "marketing": ["delivery_promo.fund"],
    "operations": ["delivery_promo.approve"],
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
    dependencies = [("accounts", "0057_merge_0055_business_hours_0056_seed_deals_permission")]
    operations = [migrations.RunPython(seed, unseed)]
