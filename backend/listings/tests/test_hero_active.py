import io
import tempfile
from datetime import timedelta

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.utils import timezone
from PIL import Image
from rest_framework.test import APIClient

from accounts.models import BusinessOwner
from listings.models import HeroMediaSubmission

TEST_MEDIA_ROOT = tempfile.mkdtemp()


def _image(name="hero.jpg"):
    buf = io.BytesIO()
    Image.new("RGB", (1, 1)).save(buf, format="JPEG")
    return SimpleUploadedFile(name, buf.getvalue(), content_type="image/jpeg")


@override_settings(MEDIA_ROOT=TEST_MEDIA_ROOT)
class HeroActiveListViewTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.owner = BusinessOwner.objects.create(
            full_name="Ama Trader", login_phone="+233207991155", password_hash="x",
        )
        now = timezone.now()

        self.active = HeroMediaSubmission.objects.create(
            business_owner=self.owner, media=_image("active.jpg"), caption="Live and well",
            status=HeroMediaSubmission.APPROVED, approved_at=now - timedelta(days=1),
            expires_at=now + timedelta(days=5),
        )
        self.pending = HeroMediaSubmission.objects.create(
            business_owner=self.owner, media=_image("pending.jpg"), caption="Still waiting",
            status=HeroMediaSubmission.PENDING,
        )
        self.rejected = HeroMediaSubmission.objects.create(
            business_owner=self.owner, media=_image("rejected.jpg"), caption="Rejected one",
            status=HeroMediaSubmission.REJECTED, rejection_reason="Too blurry",
        )
        self.expired = HeroMediaSubmission.objects.create(
            business_owner=self.owner, media=_image("expired.jpg"), caption="Already expired",
            status=HeroMediaSubmission.APPROVED, approved_at=now - timedelta(days=10),
            expires_at=now - timedelta(days=1),
        )

    def test_is_public_and_unauthenticated(self):
        response = self.client.get("/api/hero/active/")
        self.assertEqual(response.status_code, 200, response.content)

    def test_only_approved_unexpired_submissions_are_returned(self):
        response = self.client.get("/api/hero/active/")
        ids = [item["id"] for item in response.json()]
        self.assertEqual(ids, [self.active.id])

    def test_pending_submissions_are_excluded(self):
        response = self.client.get("/api/hero/active/")
        ids = [item["id"] for item in response.json()]
        self.assertNotIn(self.pending.id, ids)

    def test_rejected_submissions_are_excluded(self):
        response = self.client.get("/api/hero/active/")
        ids = [item["id"] for item in response.json()]
        self.assertNotIn(self.rejected.id, ids)

    def test_expired_submissions_are_excluded(self):
        response = self.client.get("/api/hero/active/")
        ids = [item["id"] for item in response.json()]
        self.assertNotIn(self.expired.id, ids)

    def test_response_includes_expected_public_fields(self):
        response = self.client.get("/api/hero/active/")
        item = response.json()[0]
        for field in ("id", "media", "media_type", "caption", "business_name", "approved_at", "expires_at"):
            self.assertIn(field, item)
        self.assertEqual(item["business_name"], self.owner.full_name)

    def test_most_recently_approved_first(self):
        newer = HeroMediaSubmission.objects.create(
            business_owner=self.owner, media=_image("newer.jpg"), caption="Newer",
            status=HeroMediaSubmission.APPROVED, approved_at=timezone.now(),
            expires_at=timezone.now() + timedelta(days=5),
        )
        response = self.client.get("/api/hero/active/")
        ids = [item["id"] for item in response.json()]
        self.assertEqual(ids[0], newer.id)
