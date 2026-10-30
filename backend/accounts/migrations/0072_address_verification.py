from django.db import migrations, models

# Shop location and address verification (Task 2): how and why an address was decided, the first-verification stamp, and the
# new permission that lets Operations, the General Manager and Super Admin decide it (never Support or Scout). Follows the
# seeding pattern of 0067 / 0070; the reverse removes the permission and its grants.
PERMISSION = ("address.verify", "Verify or mark wrong a business's shop address from the Address verification queue")
ROLES = ["operations", "general_manager", "super_admin"]


def seed(apps, schema_editor):
    Permission = apps.get_model("accounts", "Permission")
    Role = apps.get_model("accounts", "Role")
    permission, _ = Permission.objects.get_or_create(codename=PERMISSION[0], defaults={"description": PERMISSION[1]})
    for role in Role.objects.filter(name__in=ROLES):
        role.permissions.add(permission)


def unseed(apps, schema_editor):
    apps.get_model("accounts", "Permission").objects.filter(codename=PERMISSION[0]).delete()


class Migration(migrations.Migration):
    dependencies = [("accounts", "0071_location_capture")]

    operations = [
        migrations.AddField(
            model_name="businessownerprofile",
            name="address_verification_method",
            field=models.CharField(
                blank=True, default="", max_length=12,
                choices=[("gps_capture", "GPS capture"), ("video_call", "Video call"), ("scout", "Scout visit"), ("desk", "Desk check")],
            ),
        ),
        migrations.AddField(
            model_name="businessownerprofile",
            name="address_verification_note",
            field=models.TextField(blank=True, default=""),
        ),
        migrations.AddField(
            model_name="businessownerprofile",
            name="address_first_verified_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.RunPython(seed, unseed),
    ]
