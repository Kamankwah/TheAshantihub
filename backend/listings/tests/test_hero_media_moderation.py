import io
import tempfile
from datetime import timedelta

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.utils import timezone
from PIL import Image

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, Role, StaffUser
from billing.models import Subscription, SubscriptionPlan
from listings.models import HeroMediaSubmission

TEST_MEDIA_ROOT = tempfile.mkdtemp()


def _image(name="hero.jpg"):
    buf = io.BytesIO()
    Image.new("RGB", (1, 1)).save(buf, format="JPEG")
    return SimpleUploadedFile(name, buf.getvalue(), content_type="image/jpeg")


@override_settings(MEDIA_ROOT=TEST_MEDIA_ROOT)
class HeroMediaModerationTests(TestCase):
    def setUp(self):
        from rest_framework.test import APIClient

        self.client = APIClient()
        self.marketing = StaffUser.objects.create(
            full_name="Marketing Person", email="marketing-hero@example.com", password_hash="x",
            role=Role.objects.get(name="marketing"),
        )
        self.marketing_token = issue_token(self.marketing, "staff")

        self.admin = StaffUser.objects.create(
            full_name="Admin Person", email="admin-hero@example.com", password_hash="x",
            role=Role.objects.get(name="admin"),
        )
        self.admin_token = issue_token(self.admin, "staff")

        self.owner = BusinessOwner.objects.create(
            full_name="Ama Trader", login_phone="+233207991133", password_hash="x",
        )
        self.standard_plan = SubscriptionPlan.objects.get(tier="service")
        now = timezone.now()
        Subscription.objects.create(
            business_owner=self.owner, plan=self.standard_plan,
            current_period_start=now, current_period_end=now + timedelta(days=30),
        )

        self.submission = HeroMediaSubmission.objects.create(
            business_owner=self.owner, media=_image(), caption="Best kente in town",
        )

    def _auth(self, token):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")

    def test_pending_queue_lists_pending_submissions(self):
        self._auth(self.marketing_token)
        response = self.client.get("/api/listings/hero/pending/")
        self.assertEqual(response.status_code, 200, response.content)
        ids = [item["id"] for item in response.json()]
        self.assertIn(self.submission.id, ids)

    def test_pending_queue_excludes_non_pending_submissions(self):
        approved = HeroMediaSubmission.objects.create(
            business_owner=self.owner, media=_image("b.jpg"), caption="Already approved",
            status=HeroMediaSubmission.APPROVED,
        )
        self._auth(self.marketing_token)
        response = self.client.get("/api/listings/hero/pending/")
        ids = [item["id"] for item in response.json()]
        self.assertNotIn(approved.id, ids)

    def test_detail_view_returns_submission(self):
        self._auth(self.admin_token)
        response = self.client.get(f"/api/listings/hero/{self.submission.id}/")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["id"], self.submission.id)

    def test_marketing_can_approve_and_expires_at_is_computed_from_plan_hero_days(self):
        self._auth(self.marketing_token)
        before = timezone.now()
        response = self.client.post(f"/api/listings/hero/{self.submission.id}/approve/")
        self.assertEqual(response.status_code, 200, response.content)
        self.submission.refresh_from_db()
        self.assertEqual(self.submission.status, HeroMediaSubmission.APPROVED)
        self.assertIsNotNone(self.submission.approved_at)
        self.assertIsNotNone(self.submission.expires_at)
        expected_min = before + timedelta(days=self.standard_plan.hero_days)
        expected_max = timezone.now() + timedelta(days=self.standard_plan.hero_days)
        self.assertGreaterEqual(self.submission.expires_at, expected_min)
        self.assertLessEqual(self.submission.expires_at, expected_max)

    def test_admin_can_approve(self):
        self._auth(self.admin_token)
        response = self.client.post(f"/api/listings/hero/{self.submission.id}/approve/")
        self.assertEqual(response.status_code, 200, response.content)

    def test_approve_with_no_subscription_grants_zero_hero_days(self):
        no_sub_owner = BusinessOwner.objects.create(
            full_name="No Sub Trader", login_phone="+233207991144", password_hash="x",
        )
        submission = HeroMediaSubmission.objects.create(
            business_owner=no_sub_owner, media=_image("c.jpg"), caption="No plan",
        )
        self._auth(self.admin_token)
        before = timezone.now()
        response = self.client.post(f"/api/listings/hero/{submission.id}/approve/")
        self.assertEqual(response.status_code, 200, response.content)
        submission.refresh_from_db()
        self.assertLessEqual(submission.expires_at - submission.approved_at, timedelta(seconds=1))
        self.assertGreaterEqual(submission.expires_at, before)

    def test_marketing_can_reject_with_reason(self):
        self._auth(self.marketing_token)
        response = self.client.post(
            f"/api/listings/hero/{self.submission.id}/reject/",
            {"reason": "Blurry photo"}, format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.submission.refresh_from_db()
        self.assertEqual(self.submission.status, HeroMediaSubmission.REJECTED)
        self.assertEqual(self.submission.rejection_reason, "Blurry photo")

    def test_reject_requires_non_blank_reason(self):
        self._auth(self.marketing_token)
        response = self.client.post(
            f"/api/listings/hero/{self.submission.id}/reject/",
            {"reason": ""}, format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_accountant_cannot_approve(self):
        accountant = StaffUser.objects.create(
            full_name="Accountant Person", email="acc-hero@example.com", password_hash="x",
            role=Role.objects.get(name="accountant"),
        )
        self._auth(issue_token(accountant, "staff"))
        response = self.client.post(f"/api/listings/hero/{self.submission.id}/approve/")
        self.assertEqual(response.status_code, 403)

    def test_accountant_cannot_view_pending_queue(self):
        accountant = StaffUser.objects.create(
            full_name="Accountant Person Two", email="acc-hero2@example.com", password_hash="x",
            role=Role.objects.get(name="accountant"),
        )
        self._auth(issue_token(accountant, "staff"))
        response = self.client.get("/api/listings/hero/pending/")
        self.assertEqual(response.status_code, 403)

    def test_business_owner_cannot_approve(self):
        self._auth(issue_token(self.owner, "business_owner"))
        response = self.client.post(f"/api/listings/hero/{self.submission.id}/approve/")
        self.assertEqual(response.status_code, 403)

    def test_unauthenticated_cannot_approve(self):
        response = self.client.post(f"/api/listings/hero/{self.submission.id}/approve/")
        self.assertEqual(response.status_code, 401)
