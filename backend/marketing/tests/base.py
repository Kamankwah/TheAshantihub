from django.core.cache import cache
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.testing import make_staff, staff_token


class MarketingBase(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.boss = make_staff("super_admin", "boss@example.com")
        self.akua = make_staff("marketing", "akua@example.com")
        self.scout = make_staff("scout", "kwame@example.com")
        self.accountant = make_staff("accountant", "kofi@example.com")

    def as_staff(self, staff, sudo=False):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(staff, sudo=sudo)}")
