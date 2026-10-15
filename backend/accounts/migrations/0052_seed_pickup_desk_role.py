from django.db import migrations

# The AshantiHub office desk that hands store-pickup orders to customers (ledger plan, Task 9). Only a Super Admin
# invites this role (no RoleInviteRule); it holds one permission, and Super Admin holds it too.
PERMISSION = ("pickup.confirm", "See the store-pickup queue and mark an order collected")


def seed(apps, schema_editor):
    Permission = apps.get_model("accounts", "Permission")
    Role = apps.get_model("accounts", "Role")
    permission, _ = Permission.objects.get_or_create(codename=PERMISSION[0], defaults={"description": PERMISSION[1]})
    desk, _ = Role.objects.get_or_create(name="pickup_desk")
    desk.permissions.add(permission)
    Role.objects.get(name="super_admin").permissions.add(permission)


def unseed(apps, schema_editor):
    apps.get_model("accounts", "Role").objects.filter(name="pickup_desk").delete()
    apps.get_model("accounts", "Permission").objects.filter(codename=PERMISSION[0]).delete()


class Migration(migrations.Migration):
    dependencies = [("accounts", "0051_alter_role_name")]
    operations = [migrations.RunPython(seed, unseed)]
