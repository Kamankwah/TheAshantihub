from django.db import migrations

# subscription_plans.manage: create/edit a SubscriptionPlan (accountant role,
# per the business-subscription feature's plan authoring workflow) — also
# granted to super_admin so it can manage plans directly, not just approve
# them.
MANAGE_PERMISSIONS = [
    ("subscription_plans.manage", "Create or edit business subscription plans"),
]

# subscription_plans.approve: approve or reject a pending SubscriptionPlan —
# super_admin only, mirroring listings.HeroMediaSubmission's approval gate
# being a separate, stricter permission than the authoring one.
APPROVE_PERMISSIONS = [
    ("subscription_plans.approve", "Approve or reject business subscription plans"),
]

ALL_PERMISSIONS = MANAGE_PERMISSIONS + APPROVE_PERMISSIONS


def seed(apps, schema_editor):
    Permission = apps.get_model("accounts", "Permission")
    Role = apps.get_model("accounts", "Role")

    def get_or_create_permissions(defs):
        permissions = []
        for codename, description in defs:
            permission, _ = Permission.objects.get_or_create(
                codename=codename, defaults={"description": description}
            )
            permissions.append(permission)
        return permissions

    manage_permissions = get_or_create_permissions(MANAGE_PERMISSIONS)
    approve_permissions = get_or_create_permissions(APPROVE_PERMISSIONS)

    accountant = Role.objects.get(name="accountant")
    accountant.permissions.add(*manage_permissions)

    super_admin = Role.objects.get(name="super_admin")
    super_admin.permissions.add(*manage_permissions)
    super_admin.permissions.add(*approve_permissions)


def unseed(apps, schema_editor):
    Permission = apps.get_model("accounts", "Permission")
    Permission.objects.filter(codename__in=[c for c, _ in ALL_PERMISSIONS]).delete()


class Migration(migrations.Migration):
    dependencies = [("accounts", "0016_add_business_kind")]
    operations = [migrations.RunPython(seed, unseed)]
