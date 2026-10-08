from django.db import migrations

GRANT_TO = ["operations", "delivery_manager", "super_admin"]
RULES = [("operations", "scout"), ("operations", "support"), ("delivery_manager", "dispatch")]


def seed(apps, schema_editor):
    Permission = apps.get_model("accounts", "Permission")
    Role = apps.get_model("accounts", "Role")
    RoleInviteRule = apps.get_model("accounts", "RoleInviteRule")
    perm, _ = Permission.objects.get_or_create(
        codename="staff.invite_team",
        defaults={"description": "Invite your team, resend their invites, and suspend or unsuspend your direct reports"},
    )
    for name in GRANT_TO:
        Role.objects.get(name=name).permissions.add(perm)
    for inviter, invitee in RULES:
        RoleInviteRule.objects.get_or_create(
            inviter_role=Role.objects.get(name=inviter), invitee_role=Role.objects.get(name=invitee)
        )


def unseed(apps, schema_editor):
    apps.get_model("accounts", "RoleInviteRule").objects.all().delete()
    apps.get_model("accounts", "Permission").objects.filter(codename="staff.invite_team").delete()


class Migration(migrations.Migration):
    dependencies = [("accounts", "0031_staffuser_manager_roleinviterule")]
    operations = [migrations.RunPython(seed, unseed)]
