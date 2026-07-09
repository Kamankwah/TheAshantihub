from django.db import migrations

CATEGORIES = [
    ("hotels", "🏨", "Hotels", "#000080"),
    ("tours", "🗺️", "Tours", "#006400"),
    ("food", "🍲", "Food", "#CC0000"),
    ("crafts", "🧵", "Crafts", "#B8860B"),
    ("transport", "🚕", "Transport", "#E8621A"),
    ("pharmacy", "💊", "Pharmacy", "#2E8B57"),
    ("shops", "🛍️", "Shops", "#6A0572"),
    ("funeral", "🕊️", "Funeral Services", "#4A4A6A"),
    ("suame", "🔧", "Suame Magazine", "#8B4513"),
    ("grocery", "🛒", "Grocery Concierge", "#2E86AB"),
    ("wedding", "💍", "Wedding Planners", "#C2185B"),
    ("petrol", "⛽", "Petrol Stations", "#F57F17"),
    ("pubs", "🍺", "Pubs & Bars", "#4527A0"),
    ("lifestyle", "💅", "Lifestyle", "#E91E8C"),
    ("health", "🏥", "Health & Wellness", "#00897B"),
]


def seed(apps, schema_editor):
    Category = apps.get_model("listings", "Category")
    for slug, icon, label, color in CATEGORIES:
        Category.objects.get_or_create(slug=slug, defaults={"icon": icon, "label": label, "color": color})


def unseed(apps, schema_editor):
    Category = apps.get_model("listings", "Category")
    Category.objects.filter(slug__in=[c[0] for c in CATEGORIES]).delete()


class Migration(migrations.Migration):
    dependencies = [("listings", "0001_initial")]
    operations = [migrations.RunPython(seed, unseed)]
