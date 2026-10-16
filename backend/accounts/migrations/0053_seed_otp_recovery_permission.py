from django.db import migrations

# Staff-assisted sign-in recovery (otp plan Task 11): Support asks, a Super Admin approves (approval kind otp.recovery).
PERMISSIONS = [("otp.recovery", "Ask for a customer's or business owner's sign-in to be recovered (a Super Admin approves)")]
GRANTS = {"support": ["otp.recovery"], "super_admin": ["otp.recovery"]}


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
    dependencies = [("accounts", "0052_seed_pickup_desk_role")]
    operations = [migrations.RunPython(seed, unseed)]
