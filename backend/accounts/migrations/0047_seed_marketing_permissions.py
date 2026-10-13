from django.db import migrations

# Marketing dashboard (canvas 2026-10-13). Four permissions on top of the six Marketing
# already holds (promotions.manage, analytics.view, categories.manage, zones.manage,
# hero_media.approve, event.approve):
#   campaigns.manage  compose, schedule, withdraw; templates, segments, sender-ID register, propose send rules
#   consent.view      read the consent ledger (revealing a contact or exporting proof also needs the password)
#   coupons.manage    coupons
#   site_promo.manage flash sales, banners, featured slots
PERMISSIONS = [
    ("campaigns.manage", "Compose, schedule and withdraw marketing campaigns, templates and audiences"),
    ("consent.view", "See the marketing consent ledger and opt-outs"),
    ("coupons.manage", "Create and pause discount coupons"),
    ("site_promo.manage", "Run flash sales, banners and featured slots on the site"),
]


def seed(apps, schema_editor):
    Permission = apps.get_model("accounts", "Permission")
    Role = apps.get_model("accounts", "Role")
    permissions = [Permission.objects.get_or_create(codename=c, defaults={"description": d})[0] for c, d in PERMISSIONS]
    for name in ("marketing", "super_admin"):
        for role in Role.objects.filter(name=name):
            role.permissions.add(*permissions)


def unseed(apps, schema_editor):
    apps.get_model("accounts", "Permission").objects.filter(codename__in=[c for c, _ in PERMISSIONS]).delete()


class Migration(migrations.Migration):
    dependencies = [("accounts", "0046_seed_roles_manage")]
    operations = [migrations.RunPython(seed, unseed)]
