from django.db import migrations

# The Delivery Manager's four working permissions (Delivery Manager build). delivery.manage (assign,
# view live) and delivery.dispatch (a rider's own actions) already exist. Super Admin holds every
# permission (the invariant in test_roles_seed); a rider (dispatch) gets none of these.
PERMISSIONS = [
    ("delivery.fleet", "Run the rider fleet: riders, papers, vehicles, shifts and delivery zones"),
    ("delivery.cash", "Count and confirm the cash riders hand in, and report shortfalls"),
    ("delivery.rates", "Propose the delivery rate card, the auto-assign rules and the delivery time limits"),
    ("delivery.disputes", "Decide delivery disputes and returns"),
]
ROLES = ["delivery_manager", "super_admin"]


def seed(apps, schema_editor):
    Permission = apps.get_model("accounts", "Permission")
    Role = apps.get_model("accounts", "Role")
    roles = list(Role.objects.filter(name__in=ROLES))
    for codename, description in PERMISSIONS:
        permission, _ = Permission.objects.get_or_create(codename=codename, defaults={"description": description})
        for role in roles:
            role.permissions.add(permission)


def unseed(apps, schema_editor):
    apps.get_model("accounts", "Permission").objects.filter(codename__in=[c for c, _ in PERMISSIONS]).delete()


class Migration(migrations.Migration):
    dependencies = [("accounts", "0046_seed_roles_manage")]
    operations = [migrations.RunPython(seed, unseed)]
