"""Seed the Amazon department tree and place the old product categories under it (Plan M1, Task 4).

Departments are the Amazon.com shop-by-department departments and sub-categories, except Prime Video, Amazon Music,
Kindle E-readers & Books and Amazon Appstore (the data is in listings/department_seed.py). Existing service, stay and
event categories are not touched.

Mapping of the old product categories (migrations 0002/0009/0020) to departments. Nothing is re-written on any
Listing: the old category keeps its row and its listings, and its `parent` is set to the department, so every listing
still has its category (nothing becomes uncategorised) and the PROTECT on Listing.category never fires.

    old slug    old label          -> department (slug)
    shops       Shops              -> Home & Kitchen (home-kitchen)         general retail; closest broad department
    pharmacy    Pharmacy           -> Health & Household (health-household)
    grocery     Grocery Concierge  -> Grocery & Gourmet Food (grocery-gourmet-food)
    beverages   Beverages          -> Grocery & Gourmet Food (grocery-gourmet-food)
    petrol      Petrol Stations    -> Automotive (automotive)

If an old slug equals a seeded sub-category slug the existing row is reused (get_or_create by slug) rather than
duplicated. Reverse: clears the parents set here and deletes only the seeded department/sub-category rows that have no
listings or events (and no remaining children)."""
from django.db import migrations

from listings.department_seed import DEPARTMENTS, OLD_TO_DEPARTMENT, sub_slug


def seed(apps, schema_editor):
    Category = apps.get_model("listings", "Category")
    for order, (slug, label, icon, color, subs) in enumerate(DEPARTMENTS, start=1):
        department, _ = Category.objects.get_or_create(
            slug=slug, defaults={"icon": icon, "label": label, "color": color, "kind": "product", "sort_order": order},
        )
        for sub_order, sub_label in enumerate(subs, start=1):
            child, _ = Category.objects.get_or_create(
                slug=sub_slug(slug, sub_label),
                defaults={
                    "icon": icon, "label": sub_label, "color": color, "kind": "product",
                    "parent": department, "sort_order": sub_order,
                },
            )
    for old_slug, department_slug in OLD_TO_DEPARTMENT.items():
        department = Category.objects.get(slug=department_slug)
        Category.objects.filter(slug=old_slug).exclude(pk=department.pk).update(parent=department)


def _used(apps, category):
    if category.listings.exists():
        return True
    try:
        Event = apps.get_model("events", "Event")
    except LookupError:  # cannot tell whether events use it: fail closed and keep the row
        return True
    return Event.objects.filter(category=category).exists()


def unseed(apps, schema_editor):
    Category = apps.get_model("listings", "Category")
    Category.objects.filter(slug__in=list(OLD_TO_DEPARTMENT)).update(parent=None)
    for slug, _label, _icon, _color, subs in DEPARTMENTS:
        for sub_label in subs:
            child = Category.objects.filter(slug=sub_slug(slug, sub_label)).first()
            if child is not None and not child.children.exists() and not _used(apps, child):
                child.delete()
        department = Category.objects.filter(slug=slug).first()
        if department is not None and not department.children.exists() and not _used(apps, department):
            department.delete()


class Migration(migrations.Migration):
    dependencies = [("listings", "0023_category_tree")]
    operations = [migrations.RunPython(seed, unseed)]
