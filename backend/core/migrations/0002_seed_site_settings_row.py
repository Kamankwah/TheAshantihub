from django.db import migrations


def seed(apps, schema_editor):
    SiteSettings = apps.get_model("core", "SiteSettings")
    SiteSettings.objects.get_or_create(pk=1)


def unseed(apps, schema_editor):
    SiteSettings = apps.get_model("core", "SiteSettings")
    SiteSettings.objects.filter(pk=1).delete()


class Migration(migrations.Migration):
    # Seeds the singleton row up front so it exists immediately (e.g. in the
    # Django admin) without depending on a GET request to self-heal it via
    # SiteSettings.load() first. The GET/PATCH endpoints still call .load()
    # defensively in case this row is ever removed out-of-band.
    dependencies = [("core", "0001_initial")]
    operations = [migrations.RunPython(seed, unseed)]
