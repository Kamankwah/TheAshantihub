from django.db import IntegrityError
from django.test import TestCase

from listings.models import Category

SEEDED_SLUGS = {
    "hotels", "tours", "food", "crafts", "transport", "pharmacy", "shops",
    "funeral", "suame", "grocery", "wedding", "petrol", "pubs", "lifestyle", "health",
}

# kind=event categories seeded by 0012_seed_event_categories.py
# (docs/BUSINESS_EVENTS_ROADMAP.md Phase 6) — distinct slugs from the
# kind=service "funeral"/"wedding" vendor categories above.
EVENT_SLUGS = {"festivals", "durbar", "funeral-events", "wedding-events", "concerts"}

# Expected backfilled `kind` per seeded category slug — mirrors the
# classification performed by 0009_backfill_category_kind.py.
SEEDED_KINDS = {
    "hotels": Category.SERVICE,
    "tours": Category.SERVICE,
    "food": Category.SERVICE,
    "crafts": Category.SERVICE,
    "transport": Category.SERVICE,
    "pharmacy": Category.PRODUCT,
    "shops": Category.PRODUCT,
    "funeral": Category.SERVICE,
    "suame": Category.SERVICE,
    "grocery": Category.PRODUCT,
    "wedding": Category.SERVICE,
    "petrol": Category.PRODUCT,
    "pubs": Category.SERVICE,
    "lifestyle": Category.SERVICE,
    "health": Category.SERVICE,
}


class CategoryModelTests(TestCase):
    def test_all_fifteen_categories_are_seeded(self):
        self.assertEqual(
            set(Category.objects.values_list("slug", flat=True)), SEEDED_SLUGS | EVENT_SLUGS
        )

    def test_event_categories_are_seeded_with_kind_event(self):
        for slug in EVENT_SLUGS:
            category = Category.objects.get(slug=slug)
            self.assertEqual(category.kind, Category.EVENT)

    def test_hotels_category_has_expected_fields(self):
        hotels = Category.objects.get(slug="hotels")
        self.assertEqual(hotels.icon, "🏨")
        self.assertEqual(hotels.label, "Hotels")
        self.assertEqual(hotels.color, "#000080")

    def test_slug_is_unique(self):
        Category.objects.create(slug="unique-test", icon="🧪", label="Test", color="#000000")
        with self.assertRaises(IntegrityError):
            Category.objects.create(slug="unique-test", icon="🧪", label="Duplicate", color="#111111")

    def test_kind_defaults_to_product_for_new_categories(self):
        category = Category.objects.create(slug="kind-default-test", icon="🧪", label="Test", color="#000000")
        self.assertEqual(category.kind, Category.PRODUCT)

    def test_kind_choices_are_enforced(self):
        self.assertEqual(
            {choice for choice, _ in Category.KIND_CHOICES},
            {"product", "service", "event"},
        )

    def test_seeded_categories_are_backfilled_with_expected_kind(self):
        for slug, expected_kind in SEEDED_KINDS.items():
            category = Category.objects.get(slug=slug)
            self.assertEqual(
                category.kind, expected_kind,
                f"expected {slug!r} to be classified as {expected_kind!r}, got {category.kind!r}",
            )
