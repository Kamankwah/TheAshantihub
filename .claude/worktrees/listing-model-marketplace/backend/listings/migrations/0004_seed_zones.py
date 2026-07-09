from django.db import migrations

ZONES = ["Manhyia", "Adum", "Kejetia", "Asokwa", "Nhyiaeso", "Bantama", "Suame", "Bonwire", "Citywide"]


def seed(apps, schema_editor):
    Zone = apps.get_model("listings", "Zone")
    for name in ZONES:
        Zone.objects.get_or_create(name=name)


def unseed(apps, schema_editor):
    Zone = apps.get_model("listings", "Zone")
    Zone.objects.filter(name__in=ZONES).delete()


class Migration(migrations.Migration):
    dependencies = [("listings", "0003_zone")]
    operations = [migrations.RunPython(seed, unseed)]
