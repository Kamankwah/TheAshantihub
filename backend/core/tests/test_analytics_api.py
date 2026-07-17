from django.test import TestCase
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, Customer, Role, StaffUser
from listings.models import Category, Listing, Zone

URL = "/api/core/analytics/"


class AnalyticsOverviewAPITests(TestCase):
    def setUp(self):
        self.client = APIClient()

    def _staff(self, role_name, suffix):
        staff = StaffUser.objects.create(
            full_name=f"{role_name} Person",
            email=f"{role_name}-{suffix}@example.com",
            password_hash="x",
            role=Role.objects.get(name=role_name),
        )
        return issue_token(staff, "staff")

    def _auth(self, role_name, suffix):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self._staff(role_name, suffix)}")

    # --- permission gating ---

    def test_requires_authentication(self):
        self.assertEqual(self.client.get(URL).status_code, 401)

    def test_marketing_has_analytics_view(self):
        self._auth("marketing", 1)
        self.assertEqual(self.client.get(URL).status_code, 200)

    def test_role_without_analytics_view_is_forbidden(self):
        # support role is not seeded with analytics.view (test_roles_seed.py).
        self._auth("support", 1)
        self.assertEqual(self.client.get(URL).status_code, 403)

    # --- real-derived counts ---

    def test_returns_real_counts(self):
        Customer.objects.create(full_name="Cust", phone="+233201000001", password_hash="x")
        verified = BusinessOwner.objects.create(
            full_name="Verified Owner", login_phone="+233201000002", password_hash="x",
            kyc_status=BusinessOwner.VERIFIED,
        )
        BusinessOwner.objects.create(
            full_name="Pending Owner", login_phone="+233201000003", password_hash="x",
            kyc_status=BusinessOwner.PENDING,
        )
        category = Category.objects.create(
            slug="analytics-product", icon="📦", label="A Product", color="#123456",
            kind=Category.PRODUCT,
        )
        zone = Zone.objects.get(name="Manhyia")
        Listing.objects.create(
            business_owner=verified, category=category, zone=zone,
            name="Live One", description="x", contact_phone="+233201000002",
            status=Listing.PUBLISHED,
        )
        Listing.objects.create(
            business_owner=verified, category=category, zone=zone,
            name="Draft One", description="x", contact_phone="+233201000002",
            status=Listing.DRAFT,
        )

        self._auth("marketing", 2)
        response = self.client.get(URL)
        self.assertEqual(response.status_code, 200, response.content)
        data = response.json()

        self.assertEqual(data["customers"], 1)
        self.assertEqual(data["business_owners"], 2)
        self.assertEqual(data["business_owners_by_kyc"]["verified"], 1)
        self.assertEqual(data["business_owners_by_kyc"]["pending"], 1)
        self.assertEqual(data["business_owners_by_kyc"]["rejected"], 0)
        self.assertEqual(data["listings_total"], 2)
        self.assertEqual(data["listings_by_status"]["published"], 1)
        self.assertEqual(data["listings_by_status"]["draft"], 1)
        self.assertEqual(data["listings_by_kind"]["product"], 1)
        # Every documented bucket is always present, defaulted to 0.
        self.assertIn("cancelled", data["orders_by_status"])
        self.assertIn("approved", data["events_by_status"])
