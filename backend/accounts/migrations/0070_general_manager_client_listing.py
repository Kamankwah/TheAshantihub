from django.db import migrations

# Owner ruling 2026-10-30: the General Manager may also register businesses, add prospects and draft listings for a
# client (the Listing for clients group in its menu), reversing the 2026-10-19 "checker only" rule for these two
# permissions. users.manage stays withheld. The maker-checker rule still holds per item: whoever made a staged listing
# cannot decide it (listings.revisions.cannot_decide), so the GM never approves a listing it made itself.
GRANT = ["businesses.register", "listings.stage"]


def grant(apps, schema_editor):
    Permission = apps.get_model("accounts", "Permission")
    Role = apps.get_model("accounts", "Role")
    role = Role.objects.filter(name="general_manager").first()
    if role is not None:
        role.permissions.add(*Permission.objects.filter(codename__in=GRANT))


def revoke(apps, schema_editor):
    Permission = apps.get_model("accounts", "Permission")
    Role = apps.get_model("accounts", "Role")
    role = Role.objects.filter(name="general_manager").first()
    if role is not None:
        role.permissions.remove(*Permission.objects.filter(codename__in=GRANT))


class Migration(migrations.Migration):
    dependencies = [("accounts", "0069_customer_address")]
    operations = [migrations.RunPython(grant, revoke)]
