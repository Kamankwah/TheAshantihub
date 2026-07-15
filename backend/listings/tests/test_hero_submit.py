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
from listings.models import Category, HeroMediaSubmission, Listing, ListingPhoto, Zone

TEST_MEDIA_ROOT = tempfile.mkdtemp()


def _image(name="photo.jpg"):
    buf = io.BytesIO()
    Image.new("RGB", (1, 1)).save(buf, format="JPEG")
    return SimpleUploadedFile(name, buf.getvalue(), content_type="image/jpeg")


@override_settings(MEDIA_ROOT=TEST_MEDIA_ROOT)
class HeroSubmitViewTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.owner = BusinessOwner.objects.create(
            full_name="Ama Trader", login_phone="+233207991188", password_hash="x",
        )
        self.other_owner = BusinessOwner.objects.create(
            full_name="Yaw Trader", login_phone="+233207991199", password_hash="x",
        )
        self.token = issue_token(self.owner, "business_owner")

        self.hotels = Category.objects.get(slug="hotels")
        self.manhyia = Zone.objects.get(name="Manhyia")

        self.listing = Listing.objects.create(
            business_owner=self.owner, category=self.hotels, zone=self.manhyia,
            name="Ama's Lodge", description="A lovely lodge.", contact_phone="+233207991188",
        )
        self.photo = ListingPhoto.objects.create(listing=self.listing, image=_image(), order=1)

        self.other_listing = Listing.objects.create(
            business_owner=self.other_owner, category=self.hotels, zone=self.manhyia,
            name="Yaw's Lodge", description="Another lodge.", contact_phone="+233207991199",
        )
        self.other_photo = ListingPhoto.objects.create(
            listing=self.other_listing, image=_image("other.jpg"), order=1
        )

    def _auth(self, token):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")

    def test_owner_can_submit_own_gallery_photo(self):
        self._auth(self.token)
        response = self.client.post(
            "/api/hero/submit/",
            {"listing_photo": self.photo.id, "caption": "Best lodge in town"},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(HeroMediaSubmission.objects.count(), 1)
        submission = HeroMediaSubmission.objects.get()
        self.assertEqual(submission.business_owner, self.owner)
        self.assertEqual(submission.status, HeroMediaSubmission.PENDING)
        self.assertEqual(submission.caption, "Best lodge in town")
        self.assertEqual(submission.media_type, HeroMediaSubmission.IMAGE)
        self.assertTrue(submission.media.name)

    def test_submitted_media_is_a_copy_not_a_reference_to_the_same_file(self):
        self._auth(self.token)
        self.client.post(
            "/api/hero/submit/",
            {"listing_photo": self.photo.id, "caption": "Best lodge in town"},
            format="json",
        )
        submission = HeroMediaSubmission.objects.get()
        self.assertNotEqual(submission.media.name, self.photo.image.name)

    def test_cannot_submit_someone_elses_photo(self):
        self._auth(self.token)
        response = self.client.post(
            "/api/hero/submit/",
            {"listing_photo": self.other_photo.id, "caption": "Sneaky submission"},
            format="json",
        )
        self.assertEqual(response.status_code, 403, response.content)
        self.assertEqual(HeroMediaSubmission.objects.count(), 0)

    def test_nonexistent_listing_photo_returns_404(self):
        self._auth(self.token)
        response = self.client.post(
            "/api/hero/submit/",
            {"listing_photo": 999999, "caption": "Ghost photo"},
            format="json",
        )
        self.assertEqual(response.status_code, 404)

    def test_cannot_submit_while_a_pending_submission_is_outstanding(self):
        HeroMediaSubmission.objects.create(
            business_owner=self.owner, media=_image("existing.jpg"), caption="Already pending",
        )
        self._auth(self.token)
        response = self.client.post(
            "/api/hero/submit/",
            {"listing_photo": self.photo.id, "caption": "New one"},
            format="json",
        )
        self.assertEqual(response.status_code, 400, response.content)
        self.assertEqual(HeroMediaSubmission.objects.count(), 1)

    def test_cannot_submit_while_an_approved_unexpired_submission_is_outstanding(self):
        now = timezone.now()
        HeroMediaSubmission.objects.create(
            business_owner=self.owner, media=_image("existing.jpg"), caption="Already live",
            status=HeroMediaSubmission.APPROVED, approved_at=now - timedelta(days=1),
            expires_at=now + timedelta(days=5),
        )
        self._auth(self.token)
        response = self.client.post(
            "/api/hero/submit/",
            {"listing_photo": self.photo.id, "caption": "New one"},
            format="json",
        )
        self.assertEqual(response.status_code, 400, response.content)
        self.assertEqual(HeroMediaSubmission.objects.count(), 1)

    def test_can_submit_after_previous_approved_submission_has_expired(self):
        now = timezone.now()
        HeroMediaSubmission.objects.create(
            business_owner=self.owner, media=_image("existing.jpg"), caption="Long expired",
            status=HeroMediaSubmission.APPROVED, approved_at=now - timedelta(days=20),
            expires_at=now - timedelta(days=1),
        )
        self._auth(self.token)
        response = self.client.post(
            "/api/hero/submit/",
            {"listing_photo": self.photo.id, "caption": "New one"},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(HeroMediaSubmission.objects.count(), 2)

    def test_can_submit_after_previous_submission_was_rejected(self):
        HeroMediaSubmission.objects.create(
            business_owner=self.owner, media=_image("existing.jpg"), caption="Rejected one",
            status=HeroMediaSubmission.REJECTED, rejection_reason="Blurry",
        )
        self._auth(self.token)
        response = self.client.post(
            "/api/hero/submit/",
            {"listing_photo": self.photo.id, "caption": "New one"},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(HeroMediaSubmission.objects.count(), 2)

    def test_another_owners_outstanding_submission_does_not_block_this_owner(self):
        HeroMediaSubmission.objects.create(
            business_owner=self.other_owner, media=_image("existing.jpg"), caption="Someone else's",
        )
        self._auth(self.token)
        response = self.client.post(
            "/api/hero/submit/",
            {"listing_photo": self.photo.id, "caption": "New one"},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)

    def test_customer_cannot_submit(self):
        customer = Customer.objects.create(full_name="Ama", phone="+233200004444", password_hash="x")
        self._auth(issue_token(customer, "customer"))
        response = self.client.post(
            "/api/hero/submit/",
            {"listing_photo": self.photo.id, "caption": "Not allowed"},
            format="json",
        )
        self.assertEqual(response.status_code, 403)

    def test_unauthenticated_cannot_submit(self):
        response = self.client.post(
            "/api/hero/submit/",
            {"listing_photo": self.photo.id, "caption": "Not allowed"},
            format="json",
        )
        self.assertEqual(response.status_code, 401)

    def test_caption_is_required(self):
        self._auth(self.token)
        response = self.client.post(
            "/api/hero/submit/", {"listing_photo": self.photo.id}, format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_caption_over_140_chars_is_rejected(self):
        self._auth(self.token)
        response = self.client.post(
            "/api/hero/submit/",
            {"listing_photo": self.photo.id, "caption": "x" * 141},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
