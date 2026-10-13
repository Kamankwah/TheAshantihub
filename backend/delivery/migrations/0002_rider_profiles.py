from django.db import migrations


def make_profiles(apps, schema_editor):
    """One Rider profile for every Dispatch account that exists already."""
    StaffUser = apps.get_model("accounts", "StaffUser")
    Rider = apps.get_model("delivery", "Rider")
    for staff in StaffUser.objects.filter(role__name="dispatch"):
        Rider.objects.get_or_create(staff=staff)


class Migration(migrations.Migration):
    dependencies = [("delivery", "0001_initial")]
    operations = [migrations.RunPython(make_profiles, migrations.RunPython.noop)]
