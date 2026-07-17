import io
import tempfile

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.utils import timezone
from PIL import Image

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, Role, StaffUser
from listings.models import HeroMediaSubmission

TEST_MEDIA_ROOT = tempfile.mkdtemp()


def _image(name="hero.jpg"):
    buf = io.BytesIO()
    Image.new("RGB", (1, 1)).save(buf, format="JPEG")
    return SimpleUploadedFile(name, buf.getvalue(), content_type="image/jpeg")


@override_settings(MEDIA_ROOT=TEST_MEDIA_ROOT)
class HeroModerationQueueTests(TestCase):
    """Staff moderation-queue restructuring (items 1 & 3) — three-state
    (?status=) hero queue, approver attribution, and re-review."""

    def setUp(self):
        from rest_framework.test import APIClient

        self.client = APIClient()
        self.marketing = StaffUser.objects.create(
            full_name="Marketing Person", email="mkt-heroq@example.com", password_hash="x",
            role=Role.objects.get(name="marketing"),
        )
        self.marketing_token = issue_token(self.marketing, "staff")

        self.owner = BusinessOwner.objects.create(
            full_name="Ama Trader", login_phone="+233207991144", password_hash="x",
        )
        self.pending = HeroMediaSubmission.objects.create(
            business_owner=self.owner, media=_image(), caption="Pending one",
            status=HeroMediaSubmission.PENDING,
        )
        self.approved = HeroMediaSubmission.objects.create(
            business_owner=self.owner, media=_image(), caption="Approved one",
            status=HeroMediaSubmission.APPROVED,
        )
        self.rejected = HeroMediaSubmission.objects.create(
            business_owner=self.owner, media=_image(), caption="Rejected one",
            status=HeroMediaSubmission.REJECTED, rejection_reason="Blurry",
        )

    def _auth(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.marketing_token}")

    def test_default_queue_is_pending(self):
        self._auth()
        response = self.client.get("/api/listings/hero/pending/")
        self.assertEqual([s["id"] for s in response.json()], [self.pending.id])

    def test_approved_tab_lists_approved(self):
        self._auth()
        response = self.client.get("/api/listings/hero/pending/?status=approved")
        self.assertEqual([s["id"] for s in response.json()], [self.approved.id])

    def test_rejected_tab_lists_rejected_with_reason(self):
        self._auth()
        response = self.client.get("/api/listings/hero/pending/?status=rejected")
        body = response.json()
        self.assertEqual([s["id"] for s in body], [self.rejected.id])
        self.assertEqual(body[0]["rejection_reason"], "Blurry")

    def test_approve_records_reviewer_and_is_surfaced(self):
        self._auth()
        self.client.post(f"/api/listings/hero/{self.pending.id}/approve/")
        self.pending.refresh_from_db()
        self.assertEqual(self.pending.reviewed_by, self.marketing)
        self.assertIsNotNone(self.pending.reviewed_at)
        response = self.client.get("/api/listings/hero/pending/?status=approved")
        row = next(s for s in response.json() if s["id"] == self.pending.id)
        self.assertEqual(row["reviewed_by_name"], "Marketing Person")

    def test_reject_records_reviewer(self):
        self._auth()
        self.client.post(
            f"/api/listings/hero/{self.pending.id}/reject/",
            {"reason": "No good"}, format="json",
        )
        self.pending.refresh_from_db()
        self.assertEqual(self.pending.reviewed_by, self.marketing)
        self.assertIsNotNone(self.pending.reviewed_at)

    def test_re_review_moves_rejected_back_to_pending_and_clears(self):
        self.rejected.reviewed_by = self.marketing
        self.rejected.reviewed_at = timezone.now()
        self.rejected.save(update_fields=["reviewed_by", "reviewed_at"])
        self._auth()
        response = self.client.post(f"/api/listings/hero/{self.rejected.id}/re-review/")
        self.assertEqual(response.status_code, 200)
        self.rejected.refresh_from_db()
        self.assertEqual(self.rejected.status, HeroMediaSubmission.PENDING)
        self.assertIsNone(self.rejected.rejection_reason)
        self.assertIsNone(self.rejected.reviewed_by)
        self.assertIsNone(self.rejected.reviewed_at)

    def test_re_review_rejects_a_non_rejected_submission(self):
        self._auth()
        response = self.client.post(f"/api/listings/hero/{self.approved.id}/re-review/")
        self.assertEqual(response.status_code, 400)

    def test_re_review_requires_hero_approve_permission(self):
        support = StaffUser.objects.create(
            full_name="Support Person", email="sup-heroq@example.com", password_hash="x",
            role=Role.objects.get(name="support"),
        )
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(support, 'staff')}")
        response = self.client.post(f"/api/listings/hero/{self.rejected.id}/re-review/")
        self.assertEqual(response.status_code, 403)
