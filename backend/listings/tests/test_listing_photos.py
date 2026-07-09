from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from rest_framework.test import APIClient
from PIL import Image

import io
import tempfile

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, Customer
from listings.models import Category, Listing, ListingPhoto, Zone

TEST_MEDIA_ROOT = tempfile.mkdtemp()


def _image(name="photo.jpg"):
    # serializers.ImageField validates real image content via Pillow, so the
    # fixture must be genuine image bytes rather than an arbitrary placeholder.
    buf = io.BytesIO()
    Image.new("RGB", (1, 1)).save(buf, format="JPEG")
    return SimpleUploadedFile(name, buf.getvalue(), content_type="image/jpeg")


@override_settings(MEDIA_ROOT=TEST_MEDIA_ROOT)
class ListingPhotoTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.owner = BusinessOwner.objects.create(
            full_name="Ama Trader", login_phone="+233207223344", password_hash="x",
        )
        self.other_owner = BusinessOwner.objects.create(
            full_name="Yaw Trader", login_phone="+233207223355", password_hash="x",
        )
        self.listing = Listing.objects.create(
            business_owner=self.owner, category=Category.objects.get(slug="hotels"),
            zone=Zone.objects.get(name="Manhyia"), name="Test Lodge", description="Desc.",
            contact_phone="+233207223344",
        )
        self.token = issue_token(self.owner, "business_owner")

    def test_owner_can_add_a_photo(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.token}")
        response = self.client.post(
            f"/api/listings/mine/{self.listing.id}/photos/",
            {"image": _image(), "order": 1}, format="multipart",
        )
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(ListingPhoto.objects.filter(listing=self.listing).count(), 1)

    def test_other_owner_cannot_add_a_photo(self):
        other_token = issue_token(self.other_owner, "business_owner")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {other_token}")
        response = self.client.post(
            f"/api/listings/mine/{self.listing.id}/photos/",
            {"image": _image(), "order": 1}, format="multipart",
        )
        self.assertEqual(response.status_code, 403)

    def test_owner_can_delete_own_photo(self):
        photo = ListingPhoto.objects.create(listing=self.listing, image=_image(), order=1)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.token}")
        response = self.client.delete(f"/api/listings/mine/{self.listing.id}/photos/{photo.id}/")
        self.assertEqual(response.status_code, 204)
        self.assertFalse(ListingPhoto.objects.filter(id=photo.id).exists())

    def test_customer_cannot_add_a_photo(self):
        customer = Customer.objects.create(full_name="Ama", phone="+233200009999", password_hash="x")
        token = issue_token(customer, "customer")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        response = self.client.post(
            f"/api/listings/mine/{self.listing.id}/photos/",
            {"image": _image(), "order": 1}, format="multipart",
        )
        self.assertEqual(response.status_code, 403)
