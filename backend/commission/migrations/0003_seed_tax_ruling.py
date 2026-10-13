from django.db import migrations

# Recording the scouts' tax ruling is Super Admin's alone (Super Admin build SA-9).
PERMISSION = ("commission.tax_ruling", "Record the accountant's or GRA's ruling on scouts' tax status")


def seed(apps, schema_editor):
    Permission = apps.get_model("accounts", "Permission")
    Role = apps.get_model("accounts", "Role")
    permission, _ = Permission.objects.get_or_create(codename=PERMISSION[0], defaults={"description": PERMISSION[1]})
    for role in Role.objects.filter(name="super_admin"):
        role.permissions.add(permission)


def unseed(apps, schema_editor):
    apps.get_model("accounts", "Permission").objects.filter(codename=PERMISSION[0]).delete()


class Migration(migrations.Migration):
    dependencies = [("commission", "0002_sa9"), ("accounts", "0046_seed_roles_manage")]
    operations = [migrations.RunPython(seed, unseed)]
