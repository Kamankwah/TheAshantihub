from django.db import migrations

# Director ruling 7 (2026-10-20): Support may set any business's weekly opening hours, through the staff hours endpoint
# (PUT /api/portfolio/businesses/<id>/hours/, the same rules as the owner's and recorded as business.hours_set). The
# account manager (businesses.manage_portfolio) and portfolio.manage holders keep their own way in; the Super Admin holds
# every permission.
PERMISSION = ("businesses.set_hours", "Set any business's weekly opening hours (recorded in the activity log)")
ROLES = ("support", "super_admin")


def seed(apps, schema_editor):
    Permission = apps.get_model("accounts", "Permission")
    Role = apps.get_model("accounts", "Role")
    permission, _ = Permission.objects.get_or_create(codename=PERMISSION[0], defaults={"description": PERMISSION[1]})
    for role in Role.objects.filter(name__in=ROLES):
        role.permissions.add(permission)


def unseed(apps, schema_editor):
    apps.get_model("accounts", "Permission").objects.filter(codename=PERMISSION[0]).delete()


class Migration(migrations.Migration):
    dependencies = [("accounts", "0059_seed_orders_redeliver_permission")]
    operations = [migrations.RunPython(seed, unseed)]
