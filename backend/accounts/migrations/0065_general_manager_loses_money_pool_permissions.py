from django.db import migrations

# Integration merge (Director decision 2026-10-28): the General Manager seed (0061) copies Operations' permissions when
# it runs. Where origin's 0061_seed_redelivery_fee_permission ran first, the copy included redelivery_fee.manage, the
# pool permission of the money kind ledger.redelivery_fee. The General Manager never decides a money kind (the engine
# bars it by the registry's money flag), so take every money-kind pool permission it could have inherited off the role.
# portfolio.manage is deliberately kept: it is shared with business.update, a kind the General Manager may decide.
# business-hours (businesses.set_hours) goes to Support and the Super Admin only, so it never reaches the role.
# Idempotent. 0061 stays as applied. Reverse is a no-op: re-granting a money permission is never wanted.
MONEY_POOL_PERMISSIONS = ["redelivery_fee.manage", "delivery_promo.approve", "wallets.manage", "users.manage"]


def revoke(apps, schema_editor):
    Role = apps.get_model("accounts", "Role")
    Permission = apps.get_model("accounts", "Permission")
    role = Role.objects.filter(name="general_manager").first()
    if role is not None:
        role.permissions.remove(*Permission.objects.filter(codename__in=MONEY_POOL_PERMISSIONS))


class Migration(migrations.Migration):
    dependencies = [("accounts", "0064_merge_origin_righteoushack")]
    operations = [migrations.RunPython(revoke, migrations.RunPython.noop)]
