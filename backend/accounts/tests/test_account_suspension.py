from django.contrib.auth.hashers import make_password
from django.core.cache import cache
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.testing import staff_token
from activity.models import ActivityEvent
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

    def _token(self, role_name, suffix="1", sudo=False):
        staff = StaffUser.objects.create(
            full_name=f"{role_name} Person", email=f"{role_name}-{suffix}@example.com",
            password_hash="x", role=Role.objects.get(name=role_name),
        )
        return staff_token(staff, sudo=sudo)

    def _auth(self, role_name, suffix="1", sudo=False):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self._token(role_name, suffix, sudo)}")

    # ── Permission gating ──────────────────────────────────────────────────
    def test_admin_has_users_manage_permission(self):
        admin = Role.objects.get(name="operations")
        self.assertTrue(admin.permissions.filter(codename="users.manage").exists())

    def test_super_admin_has_users_manage_permission(self):
        super_admin = Role.objects.get(name="super_admin")
        self.assertTrue(super_admin.permissions.filter(codename="users.manage").exists())

    def test_support_lacks_users_manage_permission(self):
        support = Role.objects.get(name="support")
        self.assertFalse(support.permissions.filter(codename="users.manage").exists())

    # Reading a detail needs only users.view (support holds it, not
    # users.manage); every write stays on users.manage.
    def test_users_view_only_staffer_can_read_customer_and_owner_detail(self):
        self._auth("support")
        customer = self.client.get(f"/api/accounts/customers/{self.customer.id}/")
        self.assertEqual(customer.status_code, 200)
        self.assertEqual(customer.json()["full_name"], "Ama Owusu")
        owner = self.client.get(f"/api/accounts/business-owners/{self.owner.id}/")
        self.assertEqual(owner.status_code, 200)

    def test_users_view_only_staffer_cannot_edit_customer_or_owner(self):
        self._auth("support")
        customer = self.client.patch(
            f"/api/accounts/customers/{self.customer.id}/", {"full_name": "Changed"}, format="json"
        )
        self.assertEqual(customer.status_code, 403)
        owner = self.client.patch(
            f"/api/accounts/business-owners/{self.owner.id}/", {"full_name": "Changed"}, format="json"
        )
        self.assertEqual(owner.status_code, 403)
        self.customer.refresh_from_db()
        self.assertEqual(self.customer.full_name, "Ama Owusu")

    def test_staffer_without_users_view_or_manage_cannot_read_detail(self):
        self._auth("marketing")
        self.assertEqual(self.client.get(f"/api/accounts/customers/{self.customer.id}/").status_code, 403)
        self.assertEqual(self.client.get(f"/api/accounts/business-owners/{self.owner.id}/").status_code, 403)

    def test_support_cannot_suspend_customer(self):
        self._auth("support")
        response = self.client.post(
            f"/api/accounts/customers/{self.customer.id}/suspend/", {"reason": "x"}, format="json"
        )
        self.assertEqual(response.status_code, 403)

    # ── Detail / edit ──────────────────────────────────────────────────────
    def test_admin_can_view_customer_detail(self):
        self._auth("operations")
        response = self.client.get(f"/api/accounts/customers/{self.customer.id}/")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["full_name"], "Ama Owusu")
        self.assertFalse(body["is_suspended"])
        self.assertNotIn("password_hash", body)

    def test_admin_can_edit_customer_fields(self):
        self._auth("operations")
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
        self._auth("operations")
        self.client.patch(
            f"/api/accounts/customers/{self.customer.id}/",
            {"is_suspended": True, "suspension_reason": "sneaky"},
            format="json",
        )
        self.customer.refresh_from_db()
        self.assertFalse(self.customer.is_suspended)
        self.assertEqual(self.customer.suspension_reason, "")

    def test_admin_can_view_and_edit_business_owner(self):
        self._auth("operations")
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
        self._auth("operations", sudo=True)
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
        self._auth("operations", sudo=True)
        self.client.post(
            f"/api/accounts/customers/{self.customer.id}/suspend/",
            {"reason": "Abuse"}, format="json",
        )
        self.assertTrue(
            Notification.objects.filter(customer=self.customer, kind="account_suspended").exists()
        )

    def test_admin_can_suspend_business_owner_and_notify(self):
        self._auth("operations", sudo=True)
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

    # ── Password again, a reason, and a record (Super Admin marketplace screens) ──
    def test_suspending_and_lifting_need_the_password_again(self):
        self._auth("operations")
        for url in (
            f"/api/accounts/customers/{self.customer.id}/suspend/",
            f"/api/accounts/customers/{self.customer.id}/unsuspend/",
            f"/api/accounts/business-owners/{self.owner.id}/suspend/",
            f"/api/accounts/business-owners/{self.owner.id}/unsuspend/",
        ):
            response = self.client.post(url, {"reason": "x"}, format="json")
            self.assertEqual(response.status_code, 403, url)
            self.assertEqual(response.json()["code"], "sudo_required")
        self.customer.refresh_from_db()
        self.assertFalse(self.customer.is_suspended)

    def test_a_suspension_needs_a_reason(self):
        self._auth("operations", sudo=True)
        for url in (
            f"/api/accounts/customers/{self.customer.id}/suspend/",
            f"/api/accounts/business-owners/{self.owner.id}/suspend/",
        ):
            for body in ({}, {"reason": "   "}):
                self.assertEqual(self.client.post(url, body, format="json").status_code, 400)
        self.customer.refresh_from_db()
        self.assertFalse(self.customer.is_suspended)

    def test_suspending_and_lifting_are_recorded_with_the_reason(self):
        self._auth("operations", sudo=True)
        self.client.post(f"/api/accounts/customers/{self.customer.id}/suspend/", {"reason": "Abuse of refunds"}, format="json")
        self.client.post(f"/api/accounts/customers/{self.customer.id}/unsuspend/", {}, format="json")
        self.client.post(f"/api/accounts/business-owners/{self.owner.id}/suspend/", {"reason": "Duplicate business"}, format="json")
        self.client.post(f"/api/accounts/business-owners/{self.owner.id}/unsuspend/", {}, format="json")
        verbs = list(ActivityEvent.objects.filter(verb__in=[
            "customer.suspended", "customer.reinstated", "business.suspended", "business.reinstated",
        ]).order_by("id").values_list("verb", flat=True))
        self.assertEqual(verbs, ["customer.suspended", "customer.reinstated", "business.suspended", "business.reinstated"])
        suspended = ActivityEvent.objects.get(verb="customer.suspended")
        self.assertEqual(suspended.after["reason"], "Abuse of refunds")
        self.assertEqual(suspended.target_id, str(self.customer.pk))
        # The generic middleware event is not added on top.
        self.assertEqual(ActivityEvent.objects.filter(verb__startswith="staff-customer").count(), 0)
