"""Fixtures for the Super Admin People tests."""
from django.core.cache import cache
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.testing import make_staff, staff_token


class PeopleTestCase(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.boss = make_staff("super_admin", "boss@example.com")
        self.ama = make_staff("operations", "ama@example.com", manager=self.boss)
        self.kojo = make_staff("operations", "kojo@example.com", manager=self.boss)
        self.kwame = make_staff("scout", "kwame@example.com", manager=self.ama)
        self.esi = make_staff("support", "esi@example.com", manager=self.ama)

    def sign_in(self, staff=None, *, sudo=False):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(staff or self.boss, sudo=sudo)}")

    def results(self, response):
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()["results"]
