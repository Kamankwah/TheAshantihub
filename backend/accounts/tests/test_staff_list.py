import datetime

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import Role, StaffUser


class StaffListTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.super_admin = StaffUser.objects.create(
            full_name="Kwame Super", email="kwame-list@example.com", password_hash="x",
            role=Role.objects.get(name="super_admin"),
        )
        self.token = issue_token(self.super_admin, "staff")

        StaffUser.objects.create(
            full_name="Active Person", email="active@example.com", password_hash="realhash",
            role=Role.objects.get(name="admin"), invite_token=None, invite_expires_at=None,
        )
        StaffUser.objects.create(
            full_name="Invited Person", email="invited@example.com", password_hash="unusable",
            role=Role.objects.get(name="support"), invite_token="tok-1",
            invite_expires_at=timezone.now() + datetime.timedelta(days=7),
        )
        StaffUser.objects.create(
            full_name="Expired Person", email="expired@example.com", password_hash="unusable",
            role=Role.objects.get(name="marketing"), invite_token="tok-2",
            invite_expires_at=timezone.now() - datetime.timedelta(days=1),
        )

    def test_super_admin_can_list_staff(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.token}")
        response = self.client.get("/api/accounts/staff/")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["count"], 4)

    def test_admin_cannot_list_staff(self):
        admin = StaffUser.objects.create(
            full_name="Regular Admin", email="regular-admin@example.com", password_hash="x",
            role=Role.objects.get(name="admin"),
        )
        token = issue_token(admin, "staff")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        response = self.client.get("/api/accounts/staff/")
        self.assertEqual(response.status_code, 403)

    def test_status_field_reflects_activation_state(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.token}")
        response = self.client.get("/api/accounts/staff/")
        by_name = {item["full_name"]: item["status"] for item in response.json()["results"]}
        self.assertEqual(by_name["Active Person"], "active")
        self.assertEqual(by_name["Invited Person"], "invited")
        self.assertEqual(by_name["Expired Person"], "invite_expired")

    def test_role_field_is_the_role_name(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.token}")
        response = self.client.get("/api/accounts/staff/")
        by_name = {item["full_name"]: item["role"] for item in response.json()["results"]}
        self.assertEqual(by_name["Active Person"], "admin")

    def test_password_hash_never_leaked(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.token}")
        response = self.client.get("/api/accounts/staff/")
        for item in response.json()["results"]:
            self.assertNotIn("password_hash", item)
            self.assertNotIn("invite_token", item)
