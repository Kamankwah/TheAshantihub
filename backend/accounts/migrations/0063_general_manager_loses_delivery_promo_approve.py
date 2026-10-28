from django.db import migrations

# Post-review fix A3 (Director decision 2026-10-28): the only approval kind that uses `delivery_promo.approve` as its
# pool permission is marketing.delivery_promo_funding, a money kind the General Manager is barred from anyway. The role
# copied it from Operations in 0061; take it off. 0061 stays as applied. Reversible: the reverse re-grants it.
CODENAME = "delivery_promo.approve"


def revoke(apps, schema_editor):
    Role = apps.get_model("accounts", "Role")
    role = Role.objects.filter(name="general_manager").first()
    permission = apps.get_model("accounts", "Permission").objects.filter(codename=CODENAME).first()
    if role is not None and permission is not None:
        role.permissions.remove(permission)


def regrant(apps, schema_editor):
    Role = apps.get_model("accounts", "Role")
    role = Role.objects.filter(name="general_manager").first()
    permission = apps.get_model("accounts", "Permission").objects.filter(codename=CODENAME).first()
    if role is not None and permission is not None:
        role.permissions.add(permission)


class Migration(migrations.Migration):
    dependencies = [("accounts", "0062_seed_listing_staging_permissions")]
    operations = [migrations.RunPython(revoke, regrant)]
