from django.db import migrations

# Marketplace plan M3, Task 3: the client-staging permissions.
# listings.stage: register businesses, add prospects and draft listings for a client (the makers: scout, Operations,
# Super Admin; never the General Manager, who is a checker).
# listings.approve_staffed: created by 0061 for the General Manager and Super Admin; Operations holds it too.
STAGE = ("listings.stage", "Register businesses, add prospects and draft listings for a client")
STAFFED = ("listings.approve_staffed", "Approve listings staff made for a client")
STAGE_ROLES = ("scout", "operations", "super_admin")
STAFFED_ROLES = ("operations", "super_admin", "general_manager")


def seed(apps, schema_editor):
    Permission = apps.get_model("accounts", "Permission")
    Role = apps.get_model("accounts", "Role")
    stage, _ = Permission.objects.get_or_create(codename=STAGE[0], defaults={"description": STAGE[1]})
    staffed, _ = Permission.objects.get_or_create(codename=STAFFED[0], defaults={"description": STAFFED[1]})
    for name in STAGE_ROLES:
        Role.objects.get(name=name).permissions.add(stage)
    for name in STAFFED_ROLES:
        Role.objects.get(name=name).permissions.add(staffed)


def unseed(apps, schema_editor):
    Permission = apps.get_model("accounts", "Permission")
    Role = apps.get_model("accounts", "Role")
    # 0061 owns listings.approve_staffed (and the General Manager / Super Admin grants): only Operations' grant goes.
    staffed = Permission.objects.filter(codename=STAFFED[0]).first()
    if staffed is not None:
        Role.objects.get(name="operations").permissions.remove(staffed)
    Permission.objects.filter(codename=STAGE[0]).delete()  # also drops its role grants


class Migration(migrations.Migration):
    dependencies = [("accounts", "0061_seed_general_manager_role")]
    operations = [migrations.RunPython(seed, unseed)]
