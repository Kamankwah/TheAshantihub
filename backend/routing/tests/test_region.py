from django.test import SimpleTestCase

from routing import region


class ServiceAreaTests(SimpleTestCase):
    def test_kumasi_is_inside(self):
        self.assertTrue(region.in_service_area(6.6885, -1.6244))

    def test_obuasi_and_konongo_are_inside(self):
        self.assertTrue(region.in_service_area(6.2000, -1.6667))
        self.assertTrue(region.in_service_area(6.6167, -1.2167))

    def test_accra_and_tamale_are_outside(self):
        self.assertFalse(region.in_service_area(5.6037, -0.1870))
        self.assertFalse(region.in_service_area(9.4034, -0.8424))

    def test_swapped_coordinates_are_outside(self):
        self.assertFalse(region.in_service_area(-1.6244, 6.6885))

    def test_invalid_and_null_island_are_outside(self):
        self.assertFalse(region.in_service_area(None, None))
        self.assertFalse(region.in_service_area(0, 0))
        self.assertFalse(region.in_service_area("abc", 1))
