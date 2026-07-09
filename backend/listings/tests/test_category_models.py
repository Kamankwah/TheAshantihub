from django.db import IntegrityError
from django.test import TestCase

from listings.models import Category

SEEDED_SLUGS = {
    "hotels", "tours", "food", "crafts", "transport", "pharmacy", "shops",
    "funeral", "suame", "grocery", "wedding", "petrol", "pubs", "lifestyle", "health",
}


class CategoryModelTests(TestCase):
    def test_all_fifteen_categories_are_seeded(self):
        self.assertEqual(set(Category.objects.values_list("slug", flat=True)), SEEDED_SLUGS)

    def test_hotels_category_has_expected_fields(self):
        hotels = Category.objects.get(slug="hotels")
        self.assertEqual(hotels.icon, "🏨")
        self.assertEqual(hotels.label, "Hotels")
        self.assertEqual(hotels.color, "#000080")

    def test_slug_is_unique(self):
        Category.objects.create(slug="unique-test", icon="🧪", label="Test", color="#000000")
        with self.assertRaises(IntegrityError):
            Category.objects.create(slug="unique-test", icon="🧪", label="Duplicate", color="#111111")
