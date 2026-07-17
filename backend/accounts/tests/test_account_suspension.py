from django.contrib.auth.hashers import make_password
from django.core.cache import cache
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, Customer, Role, StaffUser
from notifications.models import Notification


class SuspensionLoginBlockTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.customer = Customer.objects.create(
            full_name="Ama Owusu", phone="+233241234567", email="ama@example.com",
            password_hash=make_password("correct-horse-battery-staple"),
        )
        self.owner = BusinessOwner.objects.create(
            full_name="Kwame Business", login_phone="+233201112233", email="kwame@example.com",
            password_hash=make_password("correct-horse-battery-staple"),
        )

    def test_suspended_customer_cannot_log_in(self):
        self.customer.is_suspended = True
        self.customer.save(update_fields=["is_suspended"])
        response = self.client.post(
            "/api/accounts/customers/login/",
            {"identifier": "ama@example.com", "password": "correct-horse-battery-staple"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("suspended", response.json()["non_field_errors"][0].lower())

    def test_unsuspended_customer_can_log_in_again(self):
        self.customer.is_suspended = True
        self.customer.save(update_fields=["is_suspended"])
        self.customer.is_suspended = False
        self.customer.save(update_fields=["is_suspended"])
        response = self.client.post(
            "/api/accounts/customers/login/",
            {"identifier": "ama@example.com", "password": "correct-horse-battery-staple"},
            format="json",
        )
        self.assertEqual(response.status_code, 200)

    def test_suspended_business_owner_cannot_log_in(self):
        self.owner.is_suspended = True
        self.owner.save(update_fields=["is_suspended"])
        response = self.client.post(
            "/api/accounts/business-owners/login/",
            {"identifier": "kwame@example.com", "password": "correct-horse-battery-staple"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("suspended", response.json()["non_field_errors"][0].lower())

    def test_suspended_account_with_wrong_password_gets_generic_error(self):
        # Suspension must not leak via the error message to someone who
        # doesn't hold the right password.
        self.customer.is_suspended = True
        self.customer.save(update_fields=["is_suspended"])
        response = self.client.post(
            "/api/accounts/customers/login/",
            {"identifier": "ama@example.com", "password": "wrong-password"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json(), {"non_field_errors": ["Invalid credentials"]})


class StaffUserManagementTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.customer = Customer.objects.create(
            full_name="Ama Owusu", phone="+233241234567", email="ama@example.com",
            password_hash="x",
        )
        self.owner = BusinessOwner.objects.create(
            full_name="Kwame Business", login_phone="+233201112233", email="kwame@example.com",
            password_hash="x",
        )

    def _token(self, role_name, suffix="1"):
        staff = StaffUser.objects.create(
            full_name=f"{role_name} Person", email=f"{role_name}-{suffix}@example.com",
            password_hash="x", role=Role.objects.get(name=role_name),
        )
        return issue_token(staff, "staff")

    def _auth(self, role_name, suffix="1"):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self._token(role_name, suffix)}")

    # ── Permission gating ──────────────────────────────────────────────────
    def test_admin_has_users_manage_permission(self):
        admin = Role.objects.get(name="admin")
        self.assertTrue(admin.permissions.filter(codename="users.manage").exists())

    def test_super_admin_has_users_manage_permission(self):
        super_admin = Role.objects.get(name="super_admin")
        self.assertTrue(super_admin.permissions.filter(codename="users.manage").exists())

    def test_support_lacks_users_manage_permission(self):
        support = Role.objects.get(name="support")
        self.assertFalse(support.permissions.filter(codename="users.manage").exists())

    def test_support_cannot_view_customer_detail(self):
        self._auth("support")
        response = self.client.get(f"/api/accounts/customers/{self.customer.id}/")
        self.assertEqual(response.status_code, 403)

    def test_support_cannot_suspend_customer(self):
        self._auth("support")
        response = self.client.post(
            f"/api/accounts/customers/{self.customer.id}/suspend/", {"reason": "x"}, format="json"
        )
        self.assertEqual(response.status_code, 403)

    # ── Detail / edit ──────────────────────────────────────────────────────
    def test_admin_can_view_customer_detail(self):
        self._auth("admin")
        response = self.client.get(f"/api/accounts/customers/{self.customer.id}/")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["full_name"], "Ama Owusu")
        self.assertFalse(body["is_suspended"])
        self.assertNotIn("password_hash", body)

    def test_admin_can_edit_customer_fields(self):
        self._auth("admin")
        response = self.client.patch(
            f"/api/accounts/customers/{self.customer.id}/",
            {"full_name": "Ama Owusu-Mensah", "phone": "+233249999999"},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.customer.refresh_from_db()
        self.assertEqual(self.customer.full_name, "Ama Owusu-Mensah")
        self.assertEqual(self.customer.phone, "+233249999999")

    def test_edit_cannot_change_suspension_via_patch(self):
        self._auth("admin")
        self.client.patch(
            f"/api/accounts/customers/{self.customer.id}/",
            {"is_suspended": True, "suspension_reason": "sneaky"},
            format="json",
        )
        self.customer.refresh_from_db()
        self.assertFalse(self.customer.is_suspended)
        self.assertEqual(self.customer.suspension_reason, "")

    def test_admin_can_view_and_edit_business_owner(self):
        self._auth("admin")
        detail = self.client.get(f"/api/accounts/business-owners/{self.owner.id}/")
        self.assertEqual(detail.status_code, 200)
        self.assertEqual(detail.json()["kyc_status"], "pending")
        patched = self.client.patch(
            f"/api/accounts/business-owners/{self.owner.id}/",
            {"full_name": "Kwame Mensah"}, format="json",
        )
        self.assertEqual(patched.status_code, 200)
        self.owner.refresh_from_db()
        self.assertEqual(self.owner.full_name, "Kwame Mensah")

    # ── Suspend / unsuspend ────────────────────────────────────────────────
    def test_admin_can_suspend_and_unsuspend_customer(self):
        self._auth("admin")
        suspend = self.client.post(
            f"/api/accounts/customers/{self.customer.id}/suspend/",
            {"reason": "Fraudulent activity"}, format="json",
        )
        self.assertEqual(suspend.status_code, 200)
        self.customer.refresh_from_db()
        self.assertTrue(self.customer.is_suspended)
        self.assertEqual(self.customer.suspension_reason, "Fraudulent activity")

        unsuspend = self.client.post(f"/api/accounts/customers/{self.customer.id}/unsuspend/")
        self.assertEqual(unsuspend.status_code, 200)
        self.customer.refresh_from_db()
        self.assertFalse(self.customer.is_suspended)
        self.assertEqual(self.customer.suspension_reason, "")

    def test_suspend_customer_creates_notification(self):
        self._auth("admin")
        self.client.post(
            f"/api/accounts/customers/{self.customer.id}/suspend/",
            {"reason": "Abuse"}, format="json",
        )
        self.assertTrue(
            Notification.objects.filter(customer=self.customer, kind="account_suspended").exists()
        )

    def test_admin_can_suspend_business_owner_and_notify(self):
        self._auth("admin")
        response = self.client.post(
            f"/api/accounts/business-owners/{self.owner.id}/suspend/",
            {"reason": "Policy breach"}, format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.owner.refresh_from_db()
        self.assertTrue(self.owner.is_suspended)
        self.assertTrue(
            Notification.objects.filter(
                business_owner=self.owner, kind="account_suspended"
            ).exists()
        )
