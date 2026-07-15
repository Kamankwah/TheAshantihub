from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, Customer, Role, StaffUser
from listings.models import Category, Zone

from events.models import Event


class EventModerationTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.marketing = StaffUser.objects.create(
            full_name="Marketing Person", email="marketing-event@example.com", password_hash="x",
            role=Role.objects.get(name="marketing"),
        )
        self.marketing_token = issue_token(self.marketing, "staff")

        self.admin = StaffUser.objects.create(
            full_name="Admin Person", email="admin-event@example.com", password_hash="x",
            role=Role.objects.get(name="admin"),
        )
        self.admin_token = issue_token(self.admin, "staff")

        self.customer = Customer.objects.create(
            full_name="Ama Buyer", phone="+233200771144", password_hash="x",
        )
        self.category = Category.objects.get(slug="festivals")
        self.zone = Zone.objects.get(name="Manhyia")

        self.event = Event.objects.create(
            category=self.category, zone=self.zone, submitted_by_customer=self.customer,
            name="Akwasidae Festival", description="Royal durbar.", address="Manhyia Palace",
            event_date=timezone.now() + timezone.timedelta(days=30), visibility_days=14,
        )

    def _auth(self, token):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")

    def test_pending_queue_lists_pending_events(self):
        self._auth(self.marketing_token)
        response = self.client.get("/api/events/moderation/pending/")
        self.assertEqual(response.status_code, 200, response.content)
        ids = [item["id"] for item in response.json()]
        self.assertIn(self.event.id, ids)

    def test_pending_queue_excludes_non_pending_events(self):
        approved = Event.objects.create(
            category=self.category, zone=self.zone, submitted_by_customer=self.customer,
            name="Already approved", description="x", address="x",
            event_date=timezone.now() + timezone.timedelta(days=10), visibility_days=14,
            status=Event.APPROVED,
        )
        self._auth(self.marketing_token)
        response = self.client.get("/api/events/moderation/pending/")
        ids = [item["id"] for item in response.json()]
        self.assertNotIn(approved.id, ids)

    def test_detail_view_returns_event(self):
        self._auth(self.admin_token)
        response = self.client.get(f"/api/events/moderation/{self.event.id}/")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["id"], self.event.id)
        self.assertIn("access_code", response.json())

    def test_marketing_can_approve(self):
        self._auth(self.marketing_token)
        response = self.client.post(f"/api/events/moderation/{self.event.id}/approve/")
        self.assertEqual(response.status_code, 200, response.content)
        self.event.refresh_from_db()
        self.assertEqual(self.event.status, Event.APPROVED)
        self.assertEqual(self.event.approved_by, self.marketing)

    def test_admin_can_approve(self):
        self._auth(self.admin_token)
        response = self.client.post(f"/api/events/moderation/{self.event.id}/approve/")
        self.assertEqual(response.status_code, 200, response.content)

    def test_approval_alone_does_not_set_expires_at(self):
        # Confirms the approve-before-pay sequencing: approval does not by
        # itself start the paid visibility window.
        self._auth(self.marketing_token)
        self.client.post(f"/api/events/moderation/{self.event.id}/approve/")
        self.event.refresh_from_db()
        self.assertIsNone(self.event.paid_at)
        self.assertIsNone(self.event.expires_at)

    def test_approve_computes_expires_at_if_paid_at_already_set(self):
        # Defensive path only — not this app's normal flow.
        now = timezone.now()
        self.event.paid_at = now
        self.event.save(update_fields=["paid_at"])
        self._auth(self.marketing_token)
        response = self.client.post(f"/api/events/moderation/{self.event.id}/approve/")
        self.assertEqual(response.status_code, 200, response.content)
        self.event.refresh_from_db()
        self.assertEqual(self.event.expires_at, self.event.paid_at + timezone.timedelta(days=14))

    def test_marketing_can_reject_with_reason(self):
        self._auth(self.marketing_token)
        response = self.client.post(
            f"/api/events/moderation/{self.event.id}/reject/",
            {"reason": "Insufficient details"}, format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.event.refresh_from_db()
        self.assertEqual(self.event.status, Event.REJECTED)
        self.assertEqual(self.event.rejection_reason, "Insufficient details")

    def test_reject_requires_non_blank_reason(self):
        self._auth(self.marketing_token)
        response = self.client.post(
            f"/api/events/moderation/{self.event.id}/reject/", {"reason": ""}, format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_accountant_cannot_approve(self):
        accountant = StaffUser.objects.create(
            full_name="Accountant Person", email="acc-event@example.com", password_hash="x",
            role=Role.objects.get(name="accountant"),
        )
        self._auth(issue_token(accountant, "staff"))
        response = self.client.post(f"/api/events/moderation/{self.event.id}/approve/")
        self.assertEqual(response.status_code, 403)

    def test_accountant_cannot_view_pending_queue(self):
        accountant = StaffUser.objects.create(
            full_name="Accountant Person Two", email="acc-event2@example.com", password_hash="x",
            role=Role.objects.get(name="accountant"),
        )
        self._auth(issue_token(accountant, "staff"))
        response = self.client.get("/api/events/moderation/pending/")
        self.assertEqual(response.status_code, 403)

    def test_customer_cannot_approve(self):
        self._auth(issue_token(self.customer, "customer"))
        response = self.client.post(f"/api/events/moderation/{self.event.id}/approve/")
        self.assertEqual(response.status_code, 403)

    def test_business_owner_cannot_approve(self):
        owner = BusinessOwner.objects.create(
            full_name="Kofi Trader", login_phone="+233207771155", password_hash="x",
        )
        self._auth(issue_token(owner, "business_owner"))
        response = self.client.post(f"/api/events/moderation/{self.event.id}/approve/")
        self.assertEqual(response.status_code, 403)

    def test_unauthenticated_cannot_approve(self):
        response = self.client.post(f"/api/events/moderation/{self.event.id}/approve/")
        self.assertEqual(response.status_code, 401)
