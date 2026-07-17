from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import Customer, Role, StaffUser
from listings.models import Category, Zone

from events.models import Event

QUEUE_URL = "/api/events/moderation/pending/"


class EventModerationQueueTests(TestCase):
    """Pending/Approved/Rejected tabs + re-review (punch-list item 4).
    Mirrors accounts/tests/test_kyc_moderation_queue.py's shape.
    """

    def setUp(self):
        self.client = APIClient()
        self.admin = StaffUser.objects.create(
            full_name="Admin Person", email="admin-event-queue@example.com", password_hash="x",
            role=Role.objects.get(name="admin"),
        )
        self.accountant = StaffUser.objects.create(
            full_name="Accountant Person", email="acct-event-queue@example.com", password_hash="x",
            role=Role.objects.get(name="accountant"),
        )
        self.customer = Customer.objects.create(
            full_name="Ama Buyer", phone="+233200771155", password_hash="x",
        )
        self.category = Category.objects.get(slug="festivals")
        self.zone = Zone.objects.get(name="Manhyia")

        def make(name, status, **extra):
            return Event.objects.create(
                category=self.category, zone=self.zone, submitted_by_customer=self.customer,
                name=name, description="A test event.", address="Manhyia Palace",
                event_date=timezone.now() + timezone.timedelta(days=30),
                visibility_days=14, status=status, **extra,
            )

        self.pending_event = make("Pending Festival", Event.PENDING)
        self.approved_event = make("Approved Festival", Event.APPROVED)
        self.rejected_event = make(
            "Rejected Festival", Event.REJECTED, rejection_reason="Venue unclear",
        )
        # Expiry is a lapsed visibility window, not a moderation outcome — this
        # row must not appear on any tab.
        self.expired_event = make("Expired Festival", Event.EXPIRED)

    def _auth(self, staff):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(staff, 'staff')}")

    def test_default_queue_is_pending(self):
        self._auth(self.admin)
        response = self.client.get(QUEUE_URL)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual([e["id"] for e in response.json()], [self.pending_event.id])

    def test_approved_tab_lists_approved_events(self):
        self._auth(self.admin)
        response = self.client.get(f"{QUEUE_URL}?status=approved")
        self.assertEqual([e["id"] for e in response.json()], [self.approved_event.id])

    def test_rejected_tab_lists_rejected_events_with_reason(self):
        self._auth(self.admin)
        response = self.client.get(f"{QUEUE_URL}?status=rejected")
        body = response.json()
        self.assertEqual([e["id"] for e in body], [self.rejected_event.id])
        self.assertEqual(body[0]["rejection_reason"], "Venue unclear")

    def test_expired_events_appear_on_no_tab(self):
        self._auth(self.admin)
        for tab in ("pending", "approved", "rejected"):
            ids = [e["id"] for e in self.client.get(f"{QUEUE_URL}?status={tab}").json()]
            self.assertNotIn(self.expired_event.id, ids, f"expired event leaked onto {tab}")

    def test_approve_records_reviewer(self):
        self._auth(self.admin)
        response = self.client.post(f"/api/events/moderation/{self.pending_event.id}/approve/")
        self.assertEqual(response.status_code, 200, response.content)
        self.pending_event.refresh_from_db()
        self.assertEqual(self.pending_event.status, Event.APPROVED)
        self.assertEqual(self.pending_event.reviewed_by, self.admin)
        self.assertIsNotNone(self.pending_event.reviewed_at)
        # approved_by keeps its own meaning alongside the canonical pair.
        self.assertEqual(self.pending_event.approved_by, self.admin)

    def test_reject_records_reviewer(self):
        self._auth(self.admin)
        response = self.client.post(
            f"/api/events/moderation/{self.pending_event.id}/reject/",
            {"reason": "Not suitable"}, format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.pending_event.refresh_from_db()
        self.assertEqual(self.pending_event.status, Event.REJECTED)
        self.assertEqual(self.pending_event.reviewed_by, self.admin)
        self.assertIsNotNone(self.pending_event.reviewed_at)

    def test_approved_list_surfaces_reviewer_name(self):
        self._auth(self.admin)
        self.client.post(f"/api/events/moderation/{self.pending_event.id}/approve/")
        response = self.client.get(f"{QUEUE_URL}?status=approved")
        row = next(e for e in response.json() if e["id"] == self.pending_event.id)
        self.assertEqual(row["reviewed_by_name"], "Admin Person")
        self.assertIsNotNone(row["reviewed_at"])

    def test_re_review_moves_rejected_back_to_pending_and_clears_rejection(self):
        self._auth(self.admin)
        response = self.client.post(f"/api/events/moderation/{self.rejected_event.id}/re-review/")
        self.assertEqual(response.status_code, 200, response.content)
        self.rejected_event.refresh_from_db()
        self.assertEqual(self.rejected_event.status, Event.PENDING)
        self.assertIsNone(self.rejected_event.rejection_reason)
        self.assertIsNone(self.rejected_event.reviewed_by)
        self.assertIsNone(self.rejected_event.reviewed_at)

    def test_re_review_rejects_a_non_rejected_event(self):
        self._auth(self.admin)
        response = self.client.post(f"/api/events/moderation/{self.pending_event.id}/re-review/")
        self.assertEqual(response.status_code, 400)

    def test_re_review_requires_event_approve_permission(self):
        self._auth(self.accountant)
        response = self.client.post(f"/api/events/moderation/{self.rejected_event.id}/re-review/")
        self.assertEqual(response.status_code, 403)

    def test_queue_requires_event_approve_permission(self):
        self._auth(self.accountant)
        self.assertEqual(self.client.get(QUEUE_URL).status_code, 403)

    def test_unknown_status_falls_back_to_pending(self):
        self._auth(self.admin)
        response = self.client.get(f"{QUEUE_URL}?status=nonsense")
        self.assertEqual([e["id"] for e in response.json()], [self.pending_event.id])
