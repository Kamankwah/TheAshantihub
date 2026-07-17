from django.db import migrations

# Three field-work roles + their permissions (punch-list item 11):
#   scout            — visits business addresses to verify the Ghana Post
#                      address, legitimacy, and the owner's details.
#   delivery_manager — sees paid door-to-door orders and assigns a dispatch.
#   dispatch         — the assigned courier: confirms pickup and delivery.
#
# Every new permission is also granted to super_admin, preserving the
# "super_admin holds every permission" invariant asserted by
# test_roles_seed.test_super_admin_has_every_permission.
PERMISSIONS = [
    ("scouts.verify", "Field-verify a business's address, legitimacy, and owner details"),
    ("scouts.assign", "Assign scouts to businesses for field verification"),
    ("delivery.manage", "See door-to-door orders and assign a dispatch to deliver them"),
    ("delivery.dispatch", "Pick up and deliver an assigned order"),
]

# New role → the codenames it holds. A scout can also view business/user
# profiles (users.view) so it can see who/what it's verifying in the field.
NEW_ROLE_PERMISSIONS = {
    "scout": ["scouts.verify", "users.view"],
    "delivery_manager": ["delivery.manage"],
    "dispatch": ["delivery.dispatch"],
}

# scouts.assign is field-supervision, granted to the office roles that already
# run onboarding, not to the field roles themselves.
EXISTING_ROLE_GRANTS = {
    "admin": ["scouts.assign"],
}


def seed(apps, schema_editor):
    Permission = apps.get_model("accounts", "Permission")
    Role = apps.get_model("accounts", "Role")

    codename_to_permission = {}
    for codename, description in PERMISSIONS:
        permission, _ = Permission.objects.get_or_create(
            codename=codename, defaults={"description": description}
        )
        codename_to_permission[codename] = permission

    for role_name, codenames in NEW_ROLE_PERMISSIONS.items():
        role, _ = Role.objects.get_or_create(name=role_name)
        # users.view already exists from migration 0002; look it up.
        perms = []
        for c in codenames:
            perm = codename_to_permission.get(c) or Permission.objects.get(codename=c)
            perms.append(perm)
        role.permissions.set(perms)

    for role_name, codenames in EXISTING_ROLE_GRANTS.items():
        role = Role.objects.get(name=role_name)
        role.permissions.add(*[codename_to_permission[c] for c in codenames])

    # super_admin gets every new permission (the invariant).
    super_admin = Role.objects.get(name="super_admin")
    super_admin.permissions.add(*codename_to_permission.values())


def unseed(apps, schema_editor):
    Permission = apps.get_model("accounts", "Permission")
    Role = apps.get_model("accounts", "Role")
    Role.objects.filter(name__in=NEW_ROLE_PERMISSIONS.keys()).delete()
    Permission.objects.filter(codename__in=[c for c, _ in PERMISSIONS]).delete()


class Migration(migrations.Migration):
    dependencies = [("accounts", "0026_seed_credit_manage_permission")]
    operations = [migrations.RunPython(seed, unseed)]
