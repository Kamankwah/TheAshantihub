from django.db import migrations

# New kind=event categories for docs/BUSINESS_EVENTS_ROADMAP.md Phase 6's
# Events tab. Distinct slugs from the existing kind=service "funeral" and
# "wedding" categories (0002_seed_categories.py) — those are business/
# vendor categories (funeral service providers, wedding planners); these are
# event-occurrence categories (an actual funeral rite or wedding ceremony a
# customer/business submits as an Event).
CATEGORIES = [
    ("festivals", "🎉", "Festivals", "#CC0000"),
    ("durbar", "👑", "Durbar & Royal Events", "#B8860B"),
    ("funeral-events", "🕊️", "Funeral Rites", "#4A4A6A"),
    ("wedding-events", "💍", "Wedding Ceremonies", "#C2185B"),
    ("concerts", "🎤", "Concerts & Shows", "#6A0572"),
]


def seed(apps, schema_editor):
    Category = apps.get_model("listings", "Category")
    for slug, icon, label, color in CATEGORIES:
        Category.objects.get_or_create(
            slug=slug, defaults={"icon": icon, "label": label, "color": color, "kind": "event"}
        )


def unseed(apps, schema_editor):
    Category = apps.get_model("listings", "Category")
    Category.objects.filter(slug__in=[c[0] for c in CATEGORIES]).delete()


class Migration(migrations.Migration):
    dependencies = [("listings", "0011_promotion")]
    operations = [migrations.RunPython(seed, unseed)]
