"""Remove the Amazon Devices & Accessories department and its five sub-categories (browse-rail plan, Task 2).

Safe on live data: a category is deleted only when NOTHING references it. "Referenced" means any reverse relation of
the historical Category model (walked generically through `_meta.get_fields(include_hidden=True)`, because
`_meta.related_objects` leaves out `related_name="+"` relations) has a row pointing at it, except `children` (handled by the order of deletion: the department goes only
once it has no children left) and CategoryVisit (analytics clicks that cascade by design). Whatever is kept is printed
so an operator can see what survived. If a related model cannot be queried the category is kept. Reverse: noop."""
from django.db import migrations

DEPARTMENT_SLUG = "amazon-devices"
# The five sub-category slugs, written out once: sub_slug("amazon-devices", label) for the labels "Amazon Echo & Alexa",
# "Fire Tablets", "Fire TV", "Ring" and "Device Accessories". Hard-coded so this migration never depends on seed data.
CHILD_SLUGS = [
    "amazon-devices-amazon-echo-alexa",
    "amazon-devices-fire-tablets",
    "amazon-devices-fire-tv",
    "amazon-devices-ring",
    "amazon-devices-device-accessories",
]


def referenced_by(category):
    """The names of the relations that still point at `category` (empty means it is safe to delete)."""
    found = []
    for rel in type(category)._meta.get_fields(include_hidden=True):
        if not (rel.auto_created and not rel.concrete and rel.is_relation):
            continue  # only reverse relations
        if rel.name == "children" or rel.related_model._meta.model_name == "categoryvisit":
            continue
        try:
            manager = getattr(category, rel.get_accessor_name() or "")
            exists = manager.exists()
        except Exception:
            # Cannot look (e.g. a "+" relation has no accessor): query the table directly; still unsure -> keep.
            try:
                exists = rel.related_model._base_manager.filter(**{rel.field.name: category.pk}).exists()
            except Exception:
                exists = True
        if exists:
            found.append(f"{rel.related_model._meta.app_label}.{rel.related_model._meta.model_name}")
    return found


def remove_amazon_devices(apps, schema_editor):
    Category = apps.get_model("listings", "Category")
    for slug in CHILD_SLUGS + [DEPARTMENT_SLUG]:
        category = Category.objects.filter(slug=slug).first()
        if category is None:
            continue
        if Category.objects.filter(parent=category).exists():
            print(f"Kept category {slug}: it still has sub-categories")
            continue
        used_by = referenced_by(category)
        if used_by:
            print(f"Kept category {slug}: referenced by {', '.join(sorted(set(used_by)))}")
            continue
        category.delete()


class Migration(migrations.Migration):

    dependencies = [
        ("listings", "0037_wishlistitem"),
        ("accounts", "0069_customer_address"),
        ("events", "0010_event_created_by_staff"),
        ("marketing", "0014_waiver_budget_cap"),
    ]

    operations = [
        migrations.RunPython(remove_amazon_devices, migrations.RunPython.noop),
    ]
