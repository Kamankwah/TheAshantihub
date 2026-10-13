from django.db import migrations, models

# The external co-signer (Super Admin build, owner decision 2026-10-12): a named
# person outside the team who can approve ONLY requests above the co-sign
# threshold, and sees nothing else. Super Admin keeps the "holds every permission"
# invariant; approvals.cosign is never the way Super Admin approves (the engine
# gives a holder of approvals.view_all the ordinary approver slot).
PERMISSIONS = [
    ("approvals.cosign", "Co-sign: give the second approval on a request above the co-sign limit (and see only those requests)"),
    ("approvals.manage_rules", "Edit approval response times and the money limits"),
]


def seed(apps, schema_editor):
    Permission = apps.get_model("accounts", "Permission")
    Role = apps.get_model("accounts", "Role")
    perms = {}
    for codename, description in PERMISSIONS:
        perms[codename], _ = Permission.objects.get_or_create(codename=codename, defaults={"description": description})
    cosigner, _ = Role.objects.get_or_create(name="cosigner")
    cosigner.permissions.set([perms["approvals.cosign"]])
    Role.objects.get(name="super_admin").permissions.add(*perms.values())


def unseed(apps, schema_editor):
    apps.get_model("accounts", "Role").objects.filter(name="cosigner").delete()
    apps.get_model("accounts", "Permission").objects.filter(codename__in=[c for c, _ in PERMISSIONS]).delete()


class Migration(migrations.Migration):
    dependencies = [("accounts", "0043_staff_invite_start_date_areas")]
    operations = [
        migrations.AlterField(
            model_name="role", name="name",
            field=models.CharField(choices=[
                ("super_admin", "Super Admin"), ("operations", "Operations"), ("accountant", "Accountant"),
                ("marketing", "Marketing"), ("support", "Support"), ("scout", "Scout"),
                ("delivery_manager", "Delivery Manager"), ("dispatch", "Dispatch"), ("cosigner", "Co-signer"),
            ], max_length=20, unique=True),
        ),
        migrations.RunPython(seed, unseed),
    ]
