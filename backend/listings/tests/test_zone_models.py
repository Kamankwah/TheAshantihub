from django.db import IntegrityError
from django.test import TestCase

from listings.models import Zone

SEEDED_ZONES = {
    "Manhyia", "Adum", "Kejetia", "Asokwa", "Nhyiaeso", "Bantama", "Suame", "Bonwire", "Citywide",
}


class ZoneModelTests(TestCase):
    def test_all_nine_zones_are_seeded(self):
        self.assertEqual(set(Zone.objects.values_list("name", flat=True)), SEEDED_ZONES)

    def test_name_is_unique(self):
        with self.assertRaises(IntegrityError):
            Zone.objects.create(name="Manhyia")
