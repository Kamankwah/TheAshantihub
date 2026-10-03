from django.db import migrations

# users.view now also reads account detail (minus payout/tax); users.manage
# is what unlocks payout/tax details and every write. Descriptions only.
NEW = {
    "users.view": "View customer and business-owner profiles and account details, excluding payout and tax details",
    "users.manage": "View payout and tax details, and edit and suspend/unsuspend customer and business-owner accounts",
}
OLD = {
    "users.view": "View customer and business owner profiles",
    "users.manage": "View full detail, edit, and suspend/unsuspend customer and business-owner accounts",
}


def _apply(descriptions):
    def run(apps, schema_editor):
        Permission = apps.get_model("accounts", "Permission")
        for codename, description in descriptions.items():
            Permission.objects.filter(codename=codename).update(description=description)
    return run


class Migration(migrations.Migration):
    dependencies = [("accounts", "0028_alter_role_name_scoutassignment_and_more")]
    operations = [migrations.RunPython(_apply(NEW), _apply(OLD))]
