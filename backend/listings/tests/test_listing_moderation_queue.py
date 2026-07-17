from django.test import TestCase
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, Role, StaffUser
from listings.models import Category, Listing, Zone


class ListingModerationQueueTests(TestCase):
    """Staff moderation-queue restructuring (items 1 & 2) — three-state
    (?status=) queue, approver attribution, business grouping, and re-review."""

    def setUp(self):
        self.client = APIClient()
        self.admin = StaffUser.objects.create(
            full_name="Admin Person", email="admin-modq@example.com", password_hash="x",
            role=Role.objects.get(name="admin"),
        )
        self.admin_token = issue_token(self.admin, "staff")

        self.owner = BusinessOwner.objects.create(
            full_name="Verified Trader", login_phone="+233207550001", password_hash="x",
            kyc_status=BusinessOwner.VERIFIED,
        )
        self.hotels = Category.objects.get(slug="hotels")
        self.manhyia = Zone.objects.get(name="Manhyia")

        self.pending = self._listing("Pending Lodge", Listing.PENDING_REVIEW)
        self.published = self._listing("Published Lodge", Listing.PUBLISHED)
        self.rejected = self._listing(
            "Rejected Lodge", Listing.REJECTED, rejection_reason="Too short"
        )

    def _listing(self, name, status, rejection_reason=None):
        return Listing.objects.create(
            business_owner=self.owner, category=self.hotels, zone=self.manhyia,
            name=name, description="D.", contact_phone="+233207550001",
            status=status, rejection_reason=rejection_reason,
        )

    def _auth(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.admin_token}")

    def test_default_queue_is_pending(self):
        self._auth()
        response = self.client.get("/api/listings/moderation/pending/")
        self.assertEqual([l["id"] for l in response.json()], [self.pending.id])

    def test_approved_tab_lists_published(self):
        self._auth()
        response = self.client.get("/api/listings/moderation/pending/?status=approved")
        self.assertEqual([l["id"] for l in response.json()], [self.published.id])

    def test_rejected_tab_lists_rejected_with_reason(self):
        self._auth()
        response = self.client.get("/api/listings/moderation/pending/?status=rejected")
        body = response.json()
        self.assertEqual([l["id"] for l in body], [self.rejected.id])
        self.assertEqual(body[0]["rejection_reason"], "Too short")

    def test_serializer_exposes_business_owner_name(self):
        self._auth()
        response = self.client.get("/api/listings/moderation/pending/")
        self.assertEqual(response.json()[0]["business_owner_name"], "Verified Trader")

    def test_approve_records_reviewer_and_is_surfaced(self):
        self._auth()
        self.client.post(f"/api/listings/moderation/{self.pending.id}/approve/")
        self.pending.refresh_from_db()
        self.assertEqual(self.pending.reviewed_by, self.admin)
        self.assertIsNotNone(self.pending.reviewed_at)
        response = self.client.get("/api/listings/moderation/pending/?status=approved")
        row = next(l for l in response.json() if l["id"] == self.pending.id)
        self.assertEqual(row["reviewed_by_name"], "Admin Person")

    def test_reject_records_reviewer(self):
        self._auth()
        self.client.post(
            f"/api/listings/moderation/{self.pending.id}/reject/",
            {"reason": "Needs work"}, format="json",
        )
        self.pending.refresh_from_db()
        self.assertEqual(self.pending.reviewed_by, self.admin)
        self.assertIsNotNone(self.pending.reviewed_at)

    def test_re_review_moves_rejected_back_to_pending_and_clears(self):
        self.rejected.reviewed_by = self.admin
        self.rejected.save(update_fields=["reviewed_by"])
        self._auth()
        response = self.client.post(f"/api/listings/moderation/{self.rejected.id}/re-review/")
        self.assertEqual(response.status_code, 200)
        self.rejected.refresh_from_db()
        self.assertEqual(self.rejected.status, Listing.PENDING_REVIEW)
        self.assertIsNone(self.rejected.rejection_reason)
        self.assertIsNone(self.rejected.reviewed_by)
        self.assertIsNone(self.rejected.reviewed_at)

    def test_re_review_rejects_a_non_rejected_listing(self):
        self._auth()
        response = self.client.post(f"/api/listings/moderation/{self.published.id}/re-review/")
        self.assertEqual(response.status_code, 400)

    def test_re_review_requires_moderate_permission(self):
        accountant = StaffUser.objects.create(
            full_name="Accountant", email="acc-modq@example.com", password_hash="x",
            role=Role.objects.get(name="accountant"),
        )
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(accountant, 'staff')}")
        response = self.client.post(f"/api/listings/moderation/{self.rejected.id}/re-review/")
        self.assertEqual(response.status_code, 403)
