import datetime

from django.contrib.auth.hashers import check_password
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import Role, StaffUser


class StaffInviteTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.super_admin = StaffUser.objects.create(
            full_name="Kwame Super",
            email="kwame@example.com",
            password_hash="x",
            role=Role.objects.get(name="super_admin"),
        )
        self.token = issue_token(self.super_admin, "staff")

    def test_super_admin_can_invite_staff(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.token}")
        response = self.client.post(
            "/api/accounts/staff/invite/",
            {"full_name": "Akosua Support", "email": "akosua@example.com", "role": "support"},
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        invited = StaffUser.objects.get(email="akosua@example.com")
        self.assertEqual(invited.role.name, "support")
        self.assertEqual(invited.invited_by, self.super_admin)

    def test_support_staff_cannot_invite_staff(self):
        support = StaffUser.objects.create(
            full_name="Akosua Support",
            email="akosua2@example.com",
            password_hash="x",
            role=Role.objects.get(name="support"),
        )
        token = issue_token(support, "staff")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        response = self.client.post(
            "/api/accounts/staff/invite/",
            {"full_name": "New Person", "email": "new@example.com", "role": "marketing"},
            format="json",
        )
        self.assertEqual(response.status_code, 403)

    def test_invite_sets_a_7_day_expiring_token(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.token}")
        self.client.post(
            "/api/accounts/staff/invite/",
            {"full_name": "Akosua Support", "email": "akosua3@example.com", "role": "support"},
            format="json",
        )
        invited = StaffUser.objects.get(email="akosua3@example.com")
        self.assertIsNotNone(invited.invite_token)
        expected_expiry = timezone.now() + datetime.timedelta(days=7)
        self.assertAlmostEqual(
            invited.invite_expires_at, expected_expiry, delta=datetime.timedelta(minutes=1)
        )

    def test_activation_with_valid_token_sets_password_and_clears_token(self):
        invited = StaffUser.objects.create(
            full_name="New Hire",
            email="newhire@example.com",
            password_hash="unusable",
            role=Role.objects.get(name="support"),
            invited_by=self.super_admin,
            invite_token="valid-token-123",
            invite_expires_at=timezone.now() + datetime.timedelta(days=7),
        )
        response = self.client.post(
            "/api/accounts/staff/activate/",
            {"token": "valid-token-123", "password": "correct-horse-battery-staple"},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        invited.refresh_from_db()
        self.assertIsNone(invited.invite_token)
        self.assertIsNone(invited.invite_expires_at)
        self.assertTrue(check_password("correct-horse-battery-staple", invited.password_hash))

    def test_activation_with_expired_token_is_rejected(self):
        StaffUser.objects.create(
            full_name="Stale Hire",
            email="stale@example.com",
            password_hash="unusable",
            role=Role.objects.get(name="support"),
            invited_by=self.super_admin,
            invite_token="expired-token-456",
            invite_expires_at=timezone.now() - datetime.timedelta(days=1),
        )
        response = self.client.post(
            "/api/accounts/staff/activate/",
            {"token": "expired-token-456", "password": "correct-horse-battery-staple"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_resend_invite_generates_a_new_token(self):
        invited = StaffUser.objects.create(
            full_name="Waiting Hire",
            email="waiting@example.com",
            password_hash="unusable",
            role=Role.objects.get(name="support"),
            invited_by=self.super_admin,
            invite_token="old-token-789",
            invite_expires_at=timezone.now() - datetime.timedelta(days=1),
        )
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.token}")
        response = self.client.post(f"/api/accounts/staff/{invited.id}/resend-invite/")
        self.assertEqual(response.status_code, 200)
        invited.refresh_from_db()
        self.assertNotEqual(invited.invite_token, "old-token-789")
        self.assertGreater(invited.invite_expires_at, timezone.now())
