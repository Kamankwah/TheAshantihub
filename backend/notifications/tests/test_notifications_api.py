from django.db import IntegrityError, transaction
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, Customer, Role, StaffUser

from notifications.models import Notification
from notifications.services import (
    notify_business_owner,
    notify_customer,
    notify_staff,
    notify_staff_role,
)

LIST_URL = "/api/notifications/"
READ_ALL_URL = "/api/notifications/read-all/"
BADGES_URL = "/api/notifications/staff-badges/"


class NotificationModelTests(TestCase):
    def setUp(self):
        self.customer = Customer.objects.create(
            full_name="Ama Buyer", phone="+233200000001", password_hash="x"
        )
        self.owner = BusinessOwner.objects.create(
            full_name="Kofi Trader", login_phone="+233200000002", password_hash="x"
        )

    def test_exactly_one_recipient_allowed(self):
        note = Notification.objects.create(
            customer=self.customer, kind=Notification.ORDER_STATUS, title="Hi"
        )
        self.assertIsNotNone(note.id)

    def test_two_recipients_violates_constraint(self):
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                Notification.objects.create(
                    customer=self.customer, business_owner=self.owner,
                    kind=Notification.ORDER_STATUS, title="Bad",
                )

    def test_zero_recipients_violates_constraint(self):
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                Notification.objects.create(kind=Notification.ORDER_STATUS, title="Bad")


class NotifyServiceTests(TestCase):
    def setUp(self):
        self.customer = Customer.objects.create(
            full_name="Ama Buyer", phone="+233200000010", password_hash="x"
        )
        self.owner = BusinessOwner.objects.create(
            full_name="Kofi Trader", login_phone="+233200000011", password_hash="x"
        )
        self.super_admin = StaffUser.objects.create(
            full_name="Super", email="super-notify@example.com", password_hash="x",
            role=Role.objects.get(name="super_admin"),
        )
        self.admin = StaffUser.objects.create(
            full_name="Admin", email="admin-notify@example.com", password_hash="x",
            role=Role.objects.get(name="admin"),
        )
        self.marketing = StaffUser.objects.create(
            full_name="Marketing", email="marketing-notify@example.com", password_hash="x",
            role=Role.objects.get(name="marketing"),
        )

    def test_notify_customer_creates_row(self):
        note = notify_customer(self.customer, Notification.ORDER_STATUS, "Order", body="B", icon="🚚")
        self.assertEqual(note.customer, self.customer)
        self.assertEqual(note.icon, "🚚")
        self.assertFalse(note.is_read)

    def test_notify_business_owner_creates_row(self):
        note = notify_business_owner(self.owner, Notification.KYC_APPROVED, "Verified")
        self.assertEqual(note.business_owner, self.owner)

    def test_notify_none_recipient_is_noop(self):
        self.assertIsNone(notify_customer(None, Notification.ORDER_STATUS, "x"))
        self.assertIsNone(notify_staff(None, Notification.ORDER_STATUS, "x"))

    def test_notify_staff_role_fans_out_to_permission_holders_only(self):
        created = notify_staff_role(
            "kyc.approve", Notification.KYC_NEEDS_APPROVAL, "New KYC"
        )
        recipients = {n.staff_id for n in created}
        # kyc.approve is held by admin and super_admin (seed), not marketing.
        self.assertIn(self.admin.id, recipients)
        self.assertIn(self.super_admin.id, recipients)
        self.assertNotIn(self.marketing.id, recipients)


class NotificationEndpointTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.customer = Customer.objects.create(
            full_name="Ama Buyer", phone="+233200000020", password_hash="x"
        )
        self.other_customer = Customer.objects.create(
            full_name="Efua Other", phone="+233200000021", password_hash="x"
        )
        self.n1 = Notification.objects.create(
            customer=self.customer, kind=Notification.ORDER_STATUS, title="One"
        )
        self.n2 = Notification.objects.create(
            customer=self.customer, kind=Notification.ORDER_STATUS, title="Two"
        )
        # Belongs to someone else — must never leak into self.customer's list.
        self.foreign = Notification.objects.create(
            customer=self.other_customer, kind=Notification.ORDER_STATUS, title="Not yours"
        )

    def _auth(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.customer, 'customer')}")

    def test_list_requires_auth(self):
        self.assertEqual(self.client.get(LIST_URL).status_code, 401)

    def test_list_scoped_to_caller_with_unread_count(self):
        self._auth()
        data = self.client.get(LIST_URL).json()
        self.assertEqual(data["unread_count"], 2)
        titles = [n["title"] for n in data["results"]]
        self.assertCountEqual(titles, ["One", "Two"])
        self.assertNotIn("Not yours", titles)

    def test_mark_one_read(self):
        self._auth()
        resp = self.client.post(f"/api/notifications/{self.n1.id}/read/")
        self.assertEqual(resp.status_code, 200)
        self.n1.refresh_from_db()
        self.assertTrue(self.n1.is_read)
        self.assertEqual(self.client.get(LIST_URL).json()["unread_count"], 1)

    def test_cannot_mark_another_users_notification(self):
        self._auth()
        resp = self.client.post(f"/api/notifications/{self.foreign.id}/read/")
        self.assertEqual(resp.status_code, 404)
        self.foreign.refresh_from_db()
        self.assertFalse(self.foreign.is_read)

    def test_read_all(self):
        self._auth()
        resp = self.client.post(READ_ALL_URL)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["unread_count"], 0)
        self.assertEqual(self.client.get(LIST_URL).json()["unread_count"], 0)
        # Did not touch the other customer's notification.
        self.foreign.refresh_from_db()
        self.assertFalse(self.foreign.is_read)


class StaffBadgesTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.super_admin = StaffUser.objects.create(
            full_name="Super", email="super-badge@example.com", password_hash="x",
            role=Role.objects.get(name="super_admin"),
        )
        self.marketing = StaffUser.objects.create(
            full_name="Marketing", email="marketing-badge@example.com", password_hash="x",
            role=Role.objects.get(name="marketing"),
        )
        self.customer = Customer.objects.create(
            full_name="Ama Buyer", phone="+233200000030", password_hash="x"
        )
        # A pending KYC owner → kyc badge should count it.
        BusinessOwner.objects.create(
            full_name="Pending Trader", login_phone="+233200000031", password_hash="x",
            kyc_status=BusinessOwner.PENDING,
        )

    def _auth(self, staff):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(staff, 'staff')}")

    def test_non_staff_forbidden(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.customer, 'customer')}")
        self.assertEqual(self.client.get(BADGES_URL).status_code, 403)

    def test_super_admin_sees_all_keys_and_pending_kyc_counted(self):
        self._auth(self.super_admin)
        data = self.client.get(BADGES_URL).json()
        for key in ["kyc", "listings", "events", "hero", "reviews",
                    "plan_approvals", "contact_messages", "escrow"]:
            self.assertIn(key, data)
        self.assertGreaterEqual(data["kyc"], 1)

    def test_permission_gated_counts_zero_without_permission(self):
        self._auth(self.marketing)
        data = self.client.get(BADGES_URL).json()
        # Marketing holds none of the queue permissions → every count 0.
        self.assertEqual(data["kyc"], 0)
        self.assertEqual(data["listings"], 0)
        self.assertEqual(data["contact_messages"], 0)
