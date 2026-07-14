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
class HeroExtendViewTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.owner = BusinessOwner.objects.create(
            full_name="Ama Trader", login_phone="+233207991166", password_hash="x",
        )
        self.other_owner = BusinessOwner.objects.create(
            full_name="Yaw Trader", login_phone="+233207991177", password_hash="x",
        )
        self.token = issue_token(self.owner, "business_owner")

        now = timezone.now()
        self.expires_at = now + timedelta(days=5)
        self.approved = HeroMediaSubmission.objects.create(
            business_owner=self.owner, media=_image(), caption="Live and well",
            status=HeroMediaSubmission.APPROVED, approved_at=now - timedelta(days=1),
            expires_at=self.expires_at,
        )
        self.pending = HeroMediaSubmission.objects.create(
            business_owner=self.owner, media=_image("p.jpg"), caption="Still pending",
            status=HeroMediaSubmission.PENDING,
        )
        self.expired = HeroMediaSubmission.objects.create(
            business_owner=self.owner, media=_image("e.jpg"), caption="Already expired",
            status=HeroMediaSubmission.APPROVED, approved_at=now - timedelta(days=10),
            expires_at=now - timedelta(days=1),
        )

    def _auth(self, token):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")

    def test_owner_can_extend_an_approved_submission(self):
        self._auth(self.token)
        response = self.client.post(
            f"/api/hero/{self.approved.id}/extend/", {"days": 10}, format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.approved.refresh_from_db()
        self.assertEqual(self.approved.extended_days, 10)
        self.assertEqual(self.approved.expires_at, self.expires_at + timedelta(days=10))

    def test_extending_twice_accumulates(self):
        self._auth(self.token)
        self.client.post(f"/api/hero/{self.approved.id}/extend/", {"days": 3}, format="json")
        self.client.post(f"/api/hero/{self.approved.id}/extend/", {"days": 4}, format="json")
        self.approved.refresh_from_db()
        self.assertEqual(self.approved.extended_days, 7)
        self.assertEqual(self.approved.expires_at, self.expires_at + timedelta(days=7))

    def test_cannot_extend_pending_submission(self):
        self._auth(self.token)
        response = self.client.post(
            f"/api/hero/{self.pending.id}/extend/", {"days": 5}, format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_cannot_extend_already_expired_submission(self):
        self._auth(self.token)
        response = self.client.post(
            f"/api/hero/{self.expired.id}/extend/", {"days": 5}, format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_other_business_owner_cannot_extend(self):
        other_token = issue_token(self.other_owner, "business_owner")
        self._auth(other_token)
        response = self.client.post(
            f"/api/hero/{self.approved.id}/extend/", {"days": 5}, format="json",
        )
        self.assertEqual(response.status_code, 403)
        self.approved.refresh_from_db()
        self.assertEqual(self.approved.extended_days, 0)

    def test_customer_cannot_extend(self):
        customer = Customer.objects.create(full_name="Ama", phone="+233200003333", password_hash="x")
        self._auth(issue_token(customer, "customer"))
        response = self.client.post(
            f"/api/hero/{self.approved.id}/extend/", {"days": 5}, format="json",
        )
        self.assertEqual(response.status_code, 403)

    def test_unauthenticated_cannot_extend(self):
        response = self.client.post(
            f"/api/hero/{self.approved.id}/extend/", {"days": 5}, format="json",
        )
        self.assertEqual(response.status_code, 401)

    def test_days_must_be_positive(self):
        self._auth(self.token)
        response = self.client.post(
            f"/api/hero/{self.approved.id}/extend/", {"days": 0}, format="json",
        )
        self.assertEqual(response.status_code, 400)
