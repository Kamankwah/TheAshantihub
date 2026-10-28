from datetime import datetime
from zoneinfo import ZoneInfo

from django.db import migrations

# 6 November 2026, 06:00 in Accra. Kept literal so the migration never depends on live code.
OPENS_AT = datetime(2026, 11, 6, 6, 0, tzinfo=ZoneInfo("Africa/Accra"))


def seed(apps, schema_editor):
    OpeningTime = apps.get_model("storefront", "OpeningTime")
    if not OpeningTime.objects.exists():
        OpeningTime.objects.create(opens_at=OPENS_AT, reason="Planned opening day")


def unseed(apps, schema_editor):
    apps.get_model("storefront", "OpeningTime").objects.filter(set_by__isnull=True, reason="Planned opening day").delete()


class Migration(migrations.Migration):
    dependencies = [("storefront", "0001_initial")]
    operations = [migrations.RunPython(seed, unseed)]
