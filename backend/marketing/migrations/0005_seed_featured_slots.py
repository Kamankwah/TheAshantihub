from decimal import Decimal

from django.db import migrations

# Configuration, not data about anyone: the canvas keys and weekly prices (Marketing canvas 13).
# These are the prices of the PLACE; an owner's featured promotion is priced separately per day.
SLOTS = [
    ("home-1", "home", "Home · slot 1", Decimal("150.00"), 1, 1),
    ("home-2", "home", "Home · slot 2", Decimal("150.00"), 1, 2),
    ("home-3", "home", "Home · slot 3", Decimal("150.00"), 1, 3),
    ("home-4", "home", "Home · slot 4", Decimal("150.00"), 1, 4),
    ("category-top", "category_top", "Category top", Decimal("60.00"), 2, 1),
]


def seed(apps, schema_editor):
    Slot = apps.get_model("marketing", "FeaturedSlot")
    for key, kind, label, price, capacity, position in SLOTS:
        Slot.objects.get_or_create(key=key, defaults={"kind": kind, "label": label, "weekly_price": price, "capacity": capacity, "position": position})


class Migration(migrations.Migration):
    dependencies = [("marketing", "0004_banners_featured_slots")]
    operations = [migrations.RunPython(seed, migrations.RunPython.noop)]
