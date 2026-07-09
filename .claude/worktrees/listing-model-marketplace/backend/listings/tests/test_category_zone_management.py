from django.test import TestCase
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import Role, StaffUser
from listings.models import Category, Zone


class CategoryZoneManagementTests(TestCase):
    def setUp(self):
        self.client = APIClient()

    def _staff(self, role_name, suffix):
        staff = StaffUser.objects.create(
            full_name=f"{role_name} Person", email=f"{role_name}-{suffix}@example.com",
            password_hash="x", role=Role.objects.get(name=role_name),
        )
        return issue_token(staff, "staff")

    def test_marketing_can_create_category(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self._staff('marketing', 1)}")
        response = self.client.post(
            "/api/listings/categories/",
            {"slug": "new-cat", "icon": "🆕", "label": "New Category", "color": "#123456"},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        self.assertTrue(Category.objects.filter(slug="new-cat").exists())

    def test_admin_cannot_create_category(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self._staff('admin', 1)}")
        response = self.client.post(
            "/api/listings/categories/",
            {"slug": "blocked-cat", "icon": "🚫", "label": "Blocked", "color": "#000000"},
            format="json",
        )
        self.assertEqual(response.status_code, 403)

    def test_admin_can_create_zone(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self._staff('admin', 2)}")
        response = self.client.post("/api/listings/zones/", {"name": "New Zone"}, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        self.assertTrue(Zone.objects.filter(name="New Zone").exists())

    def test_marketing_can_create_zone(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self._staff('marketing', 2)}")
        response = self.client.post("/api/listings/zones/", {"name": "Another Zone"}, format="json")
        self.assertEqual(response.status_code, 201, response.content)

    def test_accountant_cannot_create_zone(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self._staff('accountant', 1)}")
        response = self.client.post("/api/listings/zones/", {"name": "Nope Zone"}, format="json")
        self.assertEqual(response.status_code, 403)
