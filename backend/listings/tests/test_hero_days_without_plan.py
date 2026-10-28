import io
import tempfile
from datetime import timedelta

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.utils import timezone
from PIL import Image
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, Role, StaffUser
from billing.models import Subscription, SubscriptionPlan
from listings.models import HeroMediaSubmission

TEST_MEDIA_ROOT = tempfile.mkdtemp()


def _image():
    buf = io.BytesIO()
    Image.new("RGB", (1, 1)).save(buf, format="JPEG")
    return SimpleUploadedFile("hero.jpg", buf.getvalue(), content_type="image/jpeg")


@override_settings(MEDIA_ROOT=TEST_MEDIA_ROOT)
class HeroDaysWithoutPlanTests(TestCase):
    """Director ruling 4: a business with no plan gets 7 banner days; no run exceeds 30."""

    def setUp(self):
        self.client = APIClient()
        marketing = StaffUser.objects.create(
            full_name="Marketing Person", email="mkt-herodays@example.com", password_hash="x",
            role=Role.objects.get(name="marketing"),
        )
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(marketing, 'staff')}")
        self.owner = BusinessOwner.objects.create(
            full_name="Ama Trader", login_phone="+233207991155", password_hash="x",
        )

    def _approve(self):
        submission = HeroMediaSubmission.objects.create(
            business_owner=self.owner, media=_image(), caption="Fresh stock",
            status=HeroMediaSubmission.PENDING,
        )
        response = self.client.post(f"/api/listings/hero/{submission.id}/approve/")
        self.assertEqual(response.status_code, 200, response.content)
        submission.refresh_from_db()
        return submission

    def _subscribe(self, hero_days):
        plan = SubscriptionPlan.objects.create(
            tier=f"hero_{hero_days}", name=f"Hero {hero_days}", kind="product",
            monthly_price="10.00", hero_days=hero_days,
        )
        now = timezone.now()
        Subscription.objects.create(
            business_owner=self.owner, plan=plan,
            current_period_start=now, current_period_end=now + timedelta(days=30),
        )

    def test_an_approved_hero_without_a_plan_runs_seven_days(self):
        submission = self._approve()
        self.assertEqual(submission.expires_at, submission.approved_at + timedelta(days=7))

    def test_a_plan_keeps_its_own_hero_days(self):
        self._subscribe(14)
        submission = self._approve()
        self.assertEqual(submission.expires_at, submission.approved_at + timedelta(days=14))

    def test_no_run_exceeds_thirty_days(self):
        self._subscribe(45)
        submission = self._approve()
        self.assertEqual(submission.expires_at, submission.approved_at + timedelta(days=30))
