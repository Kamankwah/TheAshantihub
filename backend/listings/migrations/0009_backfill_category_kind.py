from django.db import migrations

# Classifies the 15 categories seeded in 0002_seed_categories.py. Explicit
# per docs/BUSINESS_EVENTS_ROADMAP.md Phase 1: hotels/accommodation/
# decorations/mechanic/tours/crafts/transport-type categories -> service,
# electronics/food-stuff-type categories -> product. New event categories
# land in a later phase (Phase 6) with kind="event".
CATEGORY_KINDS = {
    "hotels": "service",
    "tours": "service",
    # "Food" (chop bars / restaurants / prepared-meal vendors) is a dining
    # experience, not a purchasable good — distinct from the "grocery"
    # category below, which is the actual product/take-home-goods case.
    "food": "service",
    # Craft listings are treated as artisan/commission-style service
    # bookings here (per the roadmap's explicit instruction), not retail
    # of pre-made goods.
    "crafts": "service",
    "transport": "service",
    # Pharmacies primarily sell over-the-counter goods; any consultation
    # component is secondary to the product sale.
    "pharmacy": "product",
    "shops": "product",
    "funeral": "service",
    "suame": "service",  # Suame Magazine — Kumasi's mechanic/auto-repair zone.
    "grocery": "product",
    "wedding": "service",
    # Fuel is a consumable good, though dispensed at a "station" — treated
    # as product since the customer is paying for the fuel itself.
    "petrol": "product",
    "pubs": "service",  # Bar/drinks venue — a consumption experience, like food.
    "lifestyle": "service",  # Salon/spa-type listings (nails icon), not retail goods.
    "health": "service",
}


def backfill(apps, schema_editor):
    Category = apps.get_model("listings", "Category")
    for slug, kind in CATEGORY_KINDS.items():
        Category.objects.filter(slug=slug).update(kind=kind)


def unbackfill(apps, schema_editor):
    Category = apps.get_model("listings", "Category")
    Category.objects.filter(slug__in=CATEGORY_KINDS.keys()).update(kind="product")


class Migration(migrations.Migration):
    dependencies = [("listings", "0008_category_kind")]
    operations = [migrations.RunPython(backfill, unbackfill)]
