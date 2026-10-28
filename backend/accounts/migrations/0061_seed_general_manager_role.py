from django.db import migrations

# The General Manager (marketplace plan M3, Task 0; owner ruling 2026-10-19): a checker who reports to the Super Admin.
# Holds what Operations holds except the client-onboarding maker permission, may decide every non-money approval at any
# stage (approvals.view_all), approves listings staff made for a client, and reads the Super Admin dashboards.
# It never holds a money, ledger-setting, wallet or configuration permission; the approvals engine also bars it from
# every kind marked money=True whatever it holds.
# users.manage is withheld too: with the ledger off it lets the holder rewrite a business owner's login phone and email
# directly, the same class of write as the money-kind owner contact change.
MAKER_PERMISSIONS = ["businesses.register", "users.manage"]
EXTRA = [
    "approvals.view_all",
    "activity.view_all", "analytics.view", "calls.view_all", "calls.view_peers", "commission.view_all",
    "escrow.view", "fees.view", "wallets.view", "reports.view_all",
]
STAFFED = ("listings.approve_staffed", "Approve listings staff made for a client")


def seed(apps, schema_editor):
    Permission = apps.get_model("accounts", "Permission")
    Role = apps.get_model("accounts", "Role")
    role, _ = Role.objects.get_or_create(name="general_manager")
    operations = Role.objects.get(name="operations")
    staffed, _ = Permission.objects.get_or_create(codename=STAFFED[0], defaults={"description": STAFFED[1]})
    wanted = list(operations.permissions.exclude(codename__in=MAKER_PERMISSIONS))
    wanted += list(Permission.objects.filter(codename__in=EXTRA))
    role.permissions.add(staffed, *wanted)
    # The GM invites what Operations invites (a Super Admin or another GM is never in those rules).
    RoleInviteRule = apps.get_model("accounts", "RoleInviteRule")
    for rule in RoleInviteRule.objects.filter(inviter_role=operations):
        RoleInviteRule.objects.get_or_create(inviter_role=role, invitee_role=rule.invitee_role)
    # Super Admin holds every permission; the later staff-listing migration grants it to Operations too.
    Role.objects.get(name="super_admin").permissions.add(staffed)


def unseed(apps, schema_editor):
    apps.get_model("accounts", "Role").objects.filter(name="general_manager").delete()


class Migration(migrations.Migration):
    dependencies = [("accounts", "0060_general_manager_role_choice")]
    operations = [migrations.RunPython(seed, unseed)]
