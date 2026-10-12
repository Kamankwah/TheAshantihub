from django.db import migrations

# Operations' read-only view of service problems on their team's businesses
# (Support issues, Deliveries & returns). It lets them read; it does not let
# them reply as Support (messaging.manage) or manage deliveries (delivery.manage).
# Super Admin holds every permission (the invariant in test_roles_seed).
PERMISSION = ("service_issues.view", "See service problems on businesses: contact messages, disputes, conversations and deliveries (read-only)")
ROLES = ["operations", "super_admin"]


def seed(apps, schema_editor):
    Permission = apps.get_model("accounts", "Permission")
    Role = apps.get_model("accounts", "Role")
    permission, _ = Permission.objects.get_or_create(codename=PERMISSION[0], defaults={"description": PERMISSION[1]})
    for role in Role.objects.filter(name__in=ROLES):
        role.permissions.add(permission)


def unseed(apps, schema_editor):
    apps.get_model("accounts", "Permission").objects.filter(codename=PERMISSION[0]).delete()


class Migration(migrations.Migration):
    dependencies = [("accounts", "0041_owner_claim_and_consent")]
    operations = [migrations.RunPython(seed, unseed)]
