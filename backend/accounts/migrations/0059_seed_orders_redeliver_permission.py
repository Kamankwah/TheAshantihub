from django.db import migrations

# Re-delivery at the customer's request (plan 7F-E Task 7, Ruling R4): Support and the Pickup Desk ask for it; the Super
# Admin holds every permission. Assigning the second trip stays the Dispatch / Delivery Manager's (delivery.manage).
PERMISSION = ("orders.redeliver", "Ask for an order to be delivered again at the customer's request (the customer pays the re-delivery fee)")
ROLES = ("support", "pickup_desk", "super_admin")


def seed(apps, schema_editor):
    Permission = apps.get_model("accounts", "Permission")
    Role = apps.get_model("accounts", "Role")
    permission, _ = Permission.objects.get_or_create(codename=PERMISSION[0], defaults={"description": PERMISSION[1]})
    for role in Role.objects.filter(name__in=ROLES):
        role.permissions.add(permission)


def unseed(apps, schema_editor):
    apps.get_model("accounts", "Permission").objects.filter(codename=PERMISSION[0]).delete()


class Migration(migrations.Migration):
    dependencies = [("accounts", "0058_seed_delivery_promo_permissions")]
    operations = [migrations.RunPython(seed, unseed)]
