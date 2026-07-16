from django.db import migrations

MANAGE = ("event_pricing.manage", "Propose changes to event visibility pricing tiers")
APPROVE = ("event_pricing.approve", "Approve or reject proposed event pricing changes")


def seed(apps, schema_editor):
    Permission = apps.get_model("accounts", "Permission")
    Role = apps.get_model("accounts", "Role")

    manage, _ = Permission.objects.get_or_create(
        codename=MANAGE[0], defaults={"description": MANAGE[1]}
    )
    approve, _ = Permission.objects.get_or_create(
        codename=APPROVE[0], defaults={"description": APPROVE[1]}
    )

    # Deliberately asymmetric — unlike every prior seed migration in this
    # file, which grants its new codenames to both a specific role and
    # super_admin identically. Here `accountant` proposes (event_pricing
    # .manage) but only `super_admin` approves (event_pricing.approve) —
    # that separation of duties is the entire point of this feature.
    accountant = Role.objects.get(name="accountant")
    accountant.permissions.add(manage)

    super_admin = Role.objects.get(name="super_admin")
    super_admin.permissions.add(manage, approve)


def unseed(apps, schema_editor):
    Permission = apps.get_model("accounts", "Permission")
    Permission.objects.filter(codename__in=[MANAGE[0], APPROVE[0]]).delete()


class Migration(migrations.Migration):
    dependencies = [("accounts", "0015_seed_orders_manage_delivery_permission")]
    operations = [migrations.RunPython(seed, unseed)]
