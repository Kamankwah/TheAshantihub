from django.db import migrations

# The role-level editor (Super Admin build SA-4, screen "Roles & permissions"):
# changing what a whole role can do is Super Admin's alone, and needs the password
# again. Super Admin holds every permission (the invariant in test_roles_seed).
PERMISSION = ("roles.manage", "Change what each role can do (the role and permission matrix)")


def seed(apps, schema_editor):
    Permission = apps.get_model("accounts", "Permission")
    Role = apps.get_model("accounts", "Role")
    permission, _ = Permission.objects.get_or_create(codename=PERMISSION[0], defaults={"description": PERMISSION[1]})
    for role in Role.objects.filter(name="super_admin"):
        role.permissions.add(permission)


def unseed(apps, schema_editor):
    apps.get_model("accounts", "Permission").objects.filter(codename=PERMISSION[0]).delete()


class Migration(migrations.Migration):
    dependencies = [("accounts", "0045_view_as")]
    operations = [migrations.RunPython(seed, unseed)]
