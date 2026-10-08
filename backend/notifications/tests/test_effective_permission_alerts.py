from types import SimpleNamespace

from django.test import TestCase
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, Permission, Role, StaffUser
from events.permissions import IsEventOwnerOrCanApproveEvents
from notifications.models import Notification
from notifications.services import notify_staff_role


def make_staff(role, email, **extra):
    return StaffUser.objects.create(
        full_name=email.split("@")[0].title(), email=email, password_hash="x",
        role=Role.objects.get(name=role), **extra,
    )


class EffectivePermissionAlertTests(TestCase):
    def setUp(self):
        kyc = Permission.objects.get(codename="kyc.approve")
        self.ops = make_staff("operations", "ama@example.com")
        self.granted = make_staff("marketing", "akua@example.com")
        self.granted.extra_permissions.add(kyc)
        self.revoked = make_staff("operations", "kojo@example.com")
        self.revoked.revoked_permissions.add(kyc)
        self.suspended = make_staff("operations", "yaw@example.com", is_suspended=True)
        self.left = make_staff("operations", "efua@example.com", is_active=False)

    def test_alerts_follow_effective_permissions_and_skip_inactive_staff(self):
        notify_staff_role("kyc.approve", Notification.KYC_NEEDS_APPROVAL, "New KYC")
        emails = set(Notification.objects.filter(staff__isnull=False).values_list("staff__email", flat=True))
        self.assertEqual(emails, {"ama@example.com", "akua@example.com"})

    def test_badges_follow_effective_permissions(self):
        BusinessOwner.objects.create(full_name="Akosua Ntoma", login_phone="0200000101", password_hash="x")
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.granted, 'staff')}")
        self.assertEqual(client.get("/api/notifications/staff-badges/").json()["kyc"], 1)
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.revoked, 'staff')}")
        self.assertEqual(client.get("/api/notifications/staff-badges/").json()["kyc"], 0)

    def test_attendee_access_follows_effective_permissions(self):
        event_approve = Permission.objects.get(codename="event.approve")
        support = make_staff("support", "esi@example.com")
        perm = IsEventOwnerOrCanApproveEvents()
        self.assertFalse(perm.has_object_permission(SimpleNamespace(user=support), None, object()))
        support.extra_permissions.add(event_approve)
        self.assertTrue(perm.has_object_permission(SimpleNamespace(user=support), None, object()))
