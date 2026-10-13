import time
from unittest import mock

from django.contrib.auth.hashers import make_password
from django.core.cache import cache
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.testing import make_staff, staff_token

PASSWORD = "correct-horse-1"
HASHED = make_password(PASSWORD)


class SecurityBase(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.boss = make_staff("super_admin", "boss@example.com", password_hash=HASHED)
        self.esi = make_staff("support", "esi@example.com", password_hash=HASHED)
        self.ama = make_staff("operations", "ama@example.com", password_hash=HASHED)
        self.t0 = int(time.time())

    def as_staff(self, staff, sudo=False):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(staff, sudo=sudo)}")

    def clock(self, offset=0):
        return mock.patch("accounts.two_factor._clock", return_value=self.t0 + offset)

    def login(self, identifier, password=PASSWORD, **headers):
        return self.client.post("/api/accounts/staff/login/", {"identifier": identifier, "password": password}, format="json", **headers)
