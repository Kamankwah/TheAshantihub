from django.db import migrations

# The Support dashboard's permissions (docs/STAFF_ROLES.md). Idempotent, like 0034/0042.
#  - calls.view_peers: a Support agent sees their teammates' calls too (the "Support team" call-log filter).
#  - orders.support_update: the narrow Order status screen (running late, cancelled by customer).
#    It deliberately cannot set Delivered; only the rider's code (Delivery phase) or a delivery
#    manager does that.
#  - support.limits: Operations edits the Support time limits, hours and capacity.
# Support also loses orders.manage_delivery: that permission can mark an order Delivered, which
# Support must not be able to do. Operations, Delivery Manager and Super Admin keep it.
NEW = [
    ("calls.view_peers", "See calls logged by teammates in the same role", ["support", "super_admin"]),
    ("orders.support_update", "Update an order's status for a customer on the Support order screen (never Delivered)", ["support", "operations", "super_admin"]),
    ("support.limits", "Set Support's time limits, business hours and capacity", ["operations", "super_admin"]),
]
REMOVE_FROM_SUPPORT = "orders.manage_delivery"


def seed(apps, schema_editor):
    Permission = apps.get_model("accounts", "Permission")
    Role = apps.get_model("accounts", "Role")
    for codename, description, roles in NEW:
        permission, _ = Permission.objects.get_or_create(codename=codename, defaults={"description": description})
        for role in Role.objects.filter(name__in=roles):
            role.permissions.add(permission)
    held = Permission.objects.filter(codename=REMOVE_FROM_SUPPORT).first()
    if held:
        for role in Role.objects.filter(name="support"):
            role.permissions.remove(held)


def unseed(apps, schema_editor):
    Permission = apps.get_model("accounts", "Permission")
    Role = apps.get_model("accounts", "Role")
    Permission.objects.filter(codename__in=[n[0] for n in NEW]).delete()
    held = Permission.objects.filter(codename=REMOVE_FROM_SUPPORT).first()
    if held:
        for role in Role.objects.filter(name="support"):
            role.permissions.add(held)


class Migration(migrations.Migration):
    dependencies = [("accounts", "0046_seed_roles_manage")]
    operations = [migrations.RunPython(seed, unseed)]
