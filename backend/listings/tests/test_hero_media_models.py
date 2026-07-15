import io
import tempfile

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.utils import timezone
from PIL import Image

from accounts.models import BusinessOwner
from billing.models import Subscription, SubscriptionPlan
from listings.models import HeroMediaSubmission

TEST_MEDIA_ROOT = tempfile.mkdtemp()


def _image(name="hero.jpg"):
    buf = io.BytesIO()
    Image.new("RGB", (1, 1)).save(buf, format="JPEG")
    return SimpleUploadedFile(name, buf.getvalue(), content_type="image/jpeg")


@override_settings(MEDIA_ROOT=TEST_MEDIA_ROOT)
class HeroMediaSubmissionModelTests(TestCase):
    def setUp(self):
        self.owner = BusinessOwner.objects.create(
            full_name="Ama Trader", login_phone="+233207991122", password_hash="x",
        )

    def test_status_defaults_to_pending(self):
        submission = HeroMediaSubmission.objects.create(
            business_owner=self.owner, media=_image(), caption="Best kente in town",
        )
        self.assertEqual(submission.status, HeroMediaSubmission.PENDING)

    def test_media_type_defaults_to_image(self):
        submission = HeroMediaSubmission.objects.create(
            business_owner=self.owner, media=_image(), caption="Best kente in town",
        )
        self.assertEqual(submission.media_type, HeroMediaSubmission.IMAGE)

    def test_approved_at_expires_at_and_extended_days_default_to_unset(self):
        submission = HeroMediaSubmission.objects.create(
            business_owner=self.owner, media=_image(), caption="Best kente in town",
        )
        self.assertIsNone(submission.approved_at)
        self.assertIsNone(submission.expires_at)
        self.assertEqual(submission.extended_days, 0)

    def test_spoofed_media_upload_is_rejected(self):
        submission = HeroMediaSubmission(
            business_owner=self.owner,
            media=SimpleUploadedFile(
                "fake.jpg", b"MZ\x90\x00\x03\x00\x00\x00fake-executable-bytes",
                content_type="image/jpeg",
            ),
            caption="Best kente in town",
        )
        with self.assertRaises(Exception):
            submission.full_clean()

    def test_ordering_is_most_recently_submitted_first(self):
        older = HeroMediaSubmission.objects.create(
            business_owner=self.owner, media=_image("a.jpg"), caption="First",
        )
        newer = HeroMediaSubmission.objects.create(
            business_owner=self.owner, media=_image("b.jpg"), caption="Second",
        )
        self.assertEqual(list(HeroMediaSubmission.objects.all()), [newer, older])

    def test_str_includes_business_owner_and_status(self):
        submission = HeroMediaSubmission.objects.create(
            business_owner=self.owner, media=_image(), caption="Best kente in town",
        )
        self.assertIn(self.owner.full_name, str(submission))
        self.assertIn(submission.status, str(submission))
