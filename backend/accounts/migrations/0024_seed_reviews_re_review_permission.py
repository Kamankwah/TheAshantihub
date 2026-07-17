from django.db import migrations

# Deliberately narrower than `reviews.moderate` (admin + support + super_admin,
# seeded in 0011): reversing another moderator's rejection is a supervisor
# action, so only super_admin gets it. Seeded for punch-list item 5's
# "review again only by the super admin".
PERMISSIONS = [
    ("reviews.re_review", "Send a rejected review back to the pending queue"),
]


def seed(apps, schema_editor):
    Permission = apps.get_model("accounts", "Permission")
    Role = apps.get_model("accounts", "Role")

    permissions = []
    for codename, description in PERMISSIONS:
        permission, _ = Permission.objects.get_or_create(
            codename=codename, defaults={"description": description}
        )
        permissions.append(permission)

    super_admin = Role.objects.get(name="super_admin")
    super_admin.permissions.add(*permissions)


def unseed(apps, schema_editor):
    Permission = apps.get_model("accounts", "Permission")
    Permission.objects.filter(codename__in=[c for c, _ in PERMISSIONS]).delete()


class Migration(migrations.Migration):
    dependencies = [("accounts", "0023_businessowner_reviewed_at_businessowner_reviewed_by_and_more")]
    operations = [migrations.RunPython(seed, unseed)]
