from django.test import TestCase
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import Role, StaffUser

from contact.models import ContactMessage

LIST_URL = "/api/core/contact-messages/"


class ContactMessageModerationTestsBase(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.message = ContactMessage.objects.create(
            category=ContactMessage.SUPPORT,
            name="Ama Buyer",
            email="ama@example.com",
            subject="Help",
            message="I need help with my order.",
        )
        self.admin = StaffUser.objects.create(
            full_name="Admin Person", email="admin-contact-mod@example.com", password_hash="x",
            role=Role.objects.get(name="admin"),
        )
        self.support = StaffUser.objects.create(
            full_name="Support Person", email="support-contact-mod@example.com", password_hash="x",
            role=Role.objects.get(name="support"),
        )
        self.marketing = StaffUser.objects.create(
            full_name="Marketing Person", email="marketing-contact-mod@example.com", password_hash="x",
            role=Role.objects.get(name="marketing"),
        )

    def _auth_staff(self, staff):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(staff, 'staff')}")

    def _read_url(self, pk=None):
        return f"/api/core/contact-messages/{pk or self.message.id}/read/"

    def _resolve_url(self, pk=None):
        return f"/api/core/contact-messages/{pk or self.message.id}/resolve/"


class ContactMessageListTests(ContactMessageModerationTestsBase):
    def test_list_unauthenticated_is_401(self):
        response = self.client.get(LIST_URL)
        self.assertEqual(response.status_code, 401)

    def test_list_without_permission_is_403(self):
        self._auth_staff(self.marketing)
        response = self.client.get(LIST_URL)
        self.assertEqual(response.status_code, 403)

    def test_list_with_permission_succeeds_and_is_paginated(self):
        self._auth_staff(self.admin)
        response = self.client.get(LIST_URL)
        self.assertEqual(response.status_code, 200, response.content)
        data = response.json()
        self.assertIn("results", data)
        ids = [m["id"] for m in data["results"]]
        self.assertIn(self.message.id, ids)

    def test_support_role_also_has_permission(self):
        self._auth_staff(self.support)
        response = self.client.get(LIST_URL)
        self.assertEqual(response.status_code, 200, response.content)


class ContactMessageReadTests(ContactMessageModerationTestsBase):
    def test_read_unauthenticated_is_401(self):
        response = self.client.post(self._read_url())
        self.assertEqual(response.status_code, 401)

    def test_read_without_permission_is_403(self):
        self._auth_staff(self.marketing)
        response = self.client.post(self._read_url())
        self.assertEqual(response.status_code, 403)

    def test_read_transitions_new_to_read(self):
        self._auth_staff(self.admin)
        response = self.client.post(self._read_url())
        self.assertEqual(response.status_code, 200, response.content)
        self.message.refresh_from_db()
        self.assertEqual(self.message.status, ContactMessage.READ)

    def test_read_is_noop_when_already_resolved(self):
        self._auth_staff(self.admin)
        self.client.post(self._resolve_url())
        self.message.refresh_from_db()
        self.assertEqual(self.message.status, ContactMessage.RESOLVED)
        resolved_by = self.message.resolved_by
        resolved_at = self.message.resolved_at

        response = self.client.post(self._read_url())
        self.assertEqual(response.status_code, 200, response.content)
        self.message.refresh_from_db()
        self.assertEqual(self.message.status, ContactMessage.RESOLVED)
        self.assertEqual(self.message.resolved_by, resolved_by)
        self.assertEqual(self.message.resolved_at, resolved_at)


class ContactMessageResolveTests(ContactMessageModerationTestsBase):
    def test_resolve_unauthenticated_is_401(self):
        response = self.client.post(self._resolve_url())
        self.assertEqual(response.status_code, 401)

    def test_resolve_without_permission_is_403(self):
        self._auth_staff(self.marketing)
        response = self.client.post(self._resolve_url())
        self.assertEqual(response.status_code, 403)

    def test_resolve_transitions_new_to_resolved(self):
        self._auth_staff(self.admin)
        response = self.client.post(self._resolve_url())
        self.assertEqual(response.status_code, 200, response.content)
        self.message.refresh_from_db()
        self.assertEqual(self.message.status, ContactMessage.RESOLVED)
        self.assertEqual(self.message.resolved_by, self.admin)
        self.assertIsNotNone(self.message.resolved_at)

    def test_resolve_transitions_read_to_resolved(self):
        self._auth_staff(self.admin)
        self.client.post(self._read_url())
        self.message.refresh_from_db()
        self.assertEqual(self.message.status, ContactMessage.READ)

        response = self.client.post(self._resolve_url())
        self.assertEqual(response.status_code, 200, response.content)
        self.message.refresh_from_db()
        self.assertEqual(self.message.status, ContactMessage.RESOLVED)
