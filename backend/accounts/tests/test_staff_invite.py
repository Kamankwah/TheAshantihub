import datetime

from django.contrib.auth.hashers import check_password
from django.core import mail
from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import Permission, Role, StaffUser


class StaffInviteTests(TestCase):
    def setUp(self):
        cache.clear()
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

        self.assertEqual(len(mail.outbox), 1)
        sent = mail.outbox[0]
        self.assertEqual(sent.to, ["akosua@example.com"])
        self.assertIn(invited.invite_token, sent.body)
        self.assertIn("https://theashantihub.com/staff/activate?token=", sent.body)

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

        self.assertEqual(len(mail.outbox), 1)
        sent = mail.outbox[0]
        self.assertEqual(sent.to, ["waiting@example.com"])
        self.assertIn(invited.invite_token, sent.body)

    def test_non_super_admin_cannot_invite_super_admin(self):
        # admin doesn't have staff.manage by default; grant it explicitly for
        # this test to prove that having staff.manage alone is not enough to
        # mint a super_admin account.
        admin_role = Role.objects.get(name="admin")
        staff_manage = Permission.objects.get(codename="staff.manage")
        admin_role.permissions.add(staff_manage)

        admin_staff = StaffUser.objects.create(
            full_name="Adwoa Admin",
            email="adwoa-admin@example.com",
            password_hash="x",
            role=admin_role,
        )
        token = issue_token(admin_staff, "staff")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        response = self.client.post(
            "/api/accounts/staff/invite/",
            {
                "full_name": "Wannabe Super",
                "email": "wannabe-super@example.com",
                "role": "super_admin",
            },
            format="json",
        )
        self.assertIn(response.status_code, (400, 403))
        self.assertFalse(
            StaffUser.objects.filter(email="wannabe-super@example.com").exists()
        )
        self.assertFalse(StaffUser.objects.filter(role__name="super_admin").exclude(
            pk=self.super_admin.pk
        ).exists())

    def test_resend_invite_rejected_for_already_activated_staff(self):
        activated = StaffUser.objects.create(
            full_name="Already Active",
            email="already-active@example.com",
            password_hash="a-real-password-hash",
            role=Role.objects.get(name="support"),
            invited_by=self.super_admin,
            invite_token=None,
            invite_expires_at=None,
        )
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.token}")
        response = self.client.post(f"/api/accounts/staff/{activated.id}/resend-invite/")
        self.assertEqual(response.status_code, 400)
        activated.refresh_from_db()
        self.assertIsNone(activated.invite_token)

    def test_activation_response_includes_a_working_token(self):
        StaffUser.objects.create(
            full_name="Token Hire",
            email="tokenhire@example.com",
            password_hash="unusable",
            role=Role.objects.get(name="support"),
            invited_by=self.super_admin,
            invite_token="token-hire-abc",
            invite_expires_at=timezone.now() + datetime.timedelta(days=7),
        )
        response = self.client.post(
            "/api/accounts/staff/activate/",
            {"token": "token-hire-abc", "password": "correct-horse-battery-staple"},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        token = response.json()["token"]
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        me_response = self.client.get("/api/accounts/me/")
        self.assertEqual(me_response.status_code, 200)
        self.assertEqual(me_response.json()["account_type"], "staff")
