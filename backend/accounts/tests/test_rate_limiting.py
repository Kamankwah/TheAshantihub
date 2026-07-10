from django.core.cache import cache
from django.test import TestCase
from rest_framework.test import APIClient


class RateLimitingTests(TestCase):
    def setUp(self):
        # DRF's ScopedRateThrottle tracks request counts via Django's cache framework,
        # keyed by (scope, client IP). Django's test runner does NOT clear the cache
        # between test methods (unlike the database, which rolls back per test) — without
        # this, whichever test method runs first would exhaust the shared-IP budget for a
        # scope, and every subsequent test method touching that same scope would see a
        # pre-throttled state instead of a fresh one.
        cache.clear()
        self.client = APIClient()

    def test_customer_register_throttles_after_five_requests_per_minute(self):
        for i in range(5):
            response = self.client.post(
                "/api/accounts/customers/register/",
                {"full_name": "Test User", "phone": f"+23320000{i:04d}", "password": "correct-horse-battery-staple"},
                format="json",
            )
            self.assertNotEqual(response.status_code, 429)
        response = self.client.post(
            "/api/accounts/customers/register/",
            {"full_name": "Test User", "phone": "+233200009999", "password": "correct-horse-battery-staple"},
            format="json",
        )
        self.assertEqual(response.status_code, 429)

    def test_staff_activate_throttles_after_five_requests_per_minute(self):
        for _ in range(5):
            response = self.client.post(
                "/api/accounts/staff/activate/",
                {"token": "nonexistent-token", "password": "correct-horse-battery-staple"},
                format="json",
            )
            self.assertNotEqual(response.status_code, 429)
        response = self.client.post(
            "/api/accounts/staff/activate/",
            {"token": "nonexistent-token", "password": "correct-horse-battery-staple"},
            format="json",
        )
        self.assertEqual(response.status_code, 429)

    def test_customer_and_staff_endpoints_have_independent_throttle_budgets(self):
        for i in range(5):
            self.client.post(
                "/api/accounts/customers/register/",
                {"full_name": "Test User", "phone": f"+23321000{i:04d}", "password": "correct-horse-battery-staple"},
                format="json",
            )
        # Customer endpoint is now throttled, but staff/activate should still have its own full budget.
        response = self.client.post(
            "/api/accounts/staff/activate/",
            {"token": "nonexistent-token", "password": "correct-horse-battery-staple"},
            format="json",
        )
        self.assertNotEqual(response.status_code, 429)
