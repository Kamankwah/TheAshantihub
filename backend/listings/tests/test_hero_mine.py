import io
import tempfile
from datetime import timedelta

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.utils import timezone
from PIL import Image
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, Customer
from listings.models import HeroMediaSubmission

TEST_MEDIA_ROOT = tempfile.mkdtemp()


def _image(name="hero.jpg"):
    buf = io.BytesIO()
    Image.new("RGB", (1, 1)).save(buf, format="JPEG")
    return SimpleUploadedFile(name, buf.getvalue(), content_type="image/jpeg")


@override_settings(MEDIA_ROOT=TEST_MEDIA_ROOT)
class HeroMineViewTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.owner = BusinessOwner.objects.create(
            full_name="Ama Trader", login_phone="+233207991211", password_hash="x",
        )
        self.other_owner = BusinessOwner.objects.create(
            full_name="Yaw Trader", login_phone="+233207991222", password_hash="x",
        )
        self.token = issue_token(self.owner, "business_owner")

    def _auth(self, token):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")

    def test_unauthenticated_cannot_fetch(self):
        response = self.client.get("/api/hero/mine/")
        self.assertEqual(response.status_code, 401)

    def test_customer_cannot_fetch(self):
        customer = Customer.objects.create(full_name="Ama", phone="+233200005555", password_hash="x")
        self._auth(issue_token(customer, "customer"))
        response = self.client.get("/api/hero/mine/")
        self.assertEqual(response.status_code, 403)

    def test_no_submission_returns_empty_object(self):
        self._auth(self.token)
        response = self.client.get("/api/hero/mine/")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json(), {})

    def test_pending_submission_is_returned(self):
        submission = HeroMediaSubmission.objects.create(
            business_owner=self.owner, media=_image(), caption="Waiting for review",
        )
        self._auth(self.token)
        response = self.client.get("/api/hero/mine/")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["id"], submission.id)
        self.assertEqual(response.json()["status"], HeroMediaSubmission.PENDING)

    def test_approved_unexpired_submission_is_returned(self):
        now = timezone.now()
        submission = HeroMediaSubmission.objects.create(
            business_owner=self.owner, media=_image(), caption="Live now",
            status=HeroMediaSubmission.APPROVED, approved_at=now - timedelta(days=1),
            expires_at=now + timedelta(days=5),
        )
        self._auth(self.token)
        response = self.client.get("/api/hero/mine/")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["id"], submission.id)
        self.assertEqual(response.json()["status"], HeroMediaSubmission.APPROVED)

    def test_expired_only_submission_is_still_returned_as_most_recent(self):
        now = timezone.now()
        submission = HeroMediaSubmission.objects.create(
            business_owner=self.owner, media=_image(), caption="Long gone",
            status=HeroMediaSubmission.APPROVED, approved_at=now - timedelta(days=20),
            expires_at=now - timedelta(days=1),
        )
        self._auth(self.token)
        response = self.client.get("/api/hero/mine/")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["id"], submission.id)

    def test_rejected_only_submission_is_still_returned_as_most_recent(self):
        submission = HeroMediaSubmission.objects.create(
            business_owner=self.owner, media=_image(), caption="Rejected",
            status=HeroMediaSubmission.REJECTED, rejection_reason="Blurry",
        )
        self._auth(self.token)
        response = self.client.get("/api/hero/mine/")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["id"], submission.id)

    def test_outstanding_submission_takes_priority_over_older_rejected_one(self):
        HeroMediaSubmission.objects.create(
            business_owner=self.owner, media=_image("old.jpg"), caption="Old rejected",
            status=HeroMediaSubmission.REJECTED, rejection_reason="Nope",
        )
        pending = HeroMediaSubmission.objects.create(
            business_owner=self.owner, media=_image("new.jpg"), caption="New pending",
        )
        self._auth(self.token)
        response = self.client.get("/api/hero/mine/")
        self.assertEqual(response.json()["id"], pending.id)

    def test_only_returns_own_submission(self):
        HeroMediaSubmission.objects.create(
            business_owner=self.other_owner, media=_image(), caption="Not yours",
        )
        self._auth(self.token)
        response = self.client.get("/api/hero/mine/")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json(), {})

    def test_most_recent_of_multiple_non_outstanding_submissions_is_returned(self):
        HeroMediaSubmission.objects.create(
            business_owner=self.owner, media=_image("a.jpg"), caption="First rejected",
            status=HeroMediaSubmission.REJECTED, rejection_reason="Nope",
        )
        newest = HeroMediaSubmission.objects.create(
            business_owner=self.owner, media=_image("b.jpg"), caption="Second rejected",
            status=HeroMediaSubmission.REJECTED, rejection_reason="Still nope",
        )
        self._auth(self.token)
        response = self.client.get("/api/hero/mine/")
        self.assertEqual(response.json()["id"], newest.id)
