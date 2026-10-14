from django.db import migrations, models


# Food (chop bars, restaurants) and the new Beverages category both follow the food rules. Pubs & Bars is not flagged.
FOOD_CATEGORY_SLUGS = ("food", "beverages")
# Seeded like 0002/0012: slug, icon, label, colour, plus an explicit kind. Existing drink shops are not moved here.
BEVERAGES = {"slug": "beverages", "icon": "🥤", "label": "Beverages", "color": "#0277BD", "kind": "product"}


def seed_beverages(apps, schema_editor):
    Category = apps.get_model("listings", "Category")
    Category.objects.get_or_create(slug=BEVERAGES["slug"], defaults={k: v for k, v in BEVERAGES.items() if k != "slug"})


def mark_food(apps, schema_editor):
    seed_beverages(apps, schema_editor)
    apps.get_model("listings", "Category").objects.filter(slug__in=FOOD_CATEGORY_SLUGS).update(is_food=True)


def unmark_food(apps, schema_editor):
    # Only unflag. The beverages category stays: other tables reference it (PROTECT/SET_NULL) and it may pre-date 0020.
    apps.get_model("listings", "Category").objects.filter(slug__in=FOOD_CATEGORY_SLUGS).update(is_food=False)


class Migration(migrations.Migration):
    dependencies = [("listings", "0019_listing_created_by_staff")]
    operations = [
        migrations.AddField(model_name="category", name="is_food", field=models.BooleanField(default=False)),
        migrations.RunPython(mark_food, unmark_food),
    ]
