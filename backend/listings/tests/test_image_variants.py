import io
import shutil
import tempfile

from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
from django.test import TestCase, override_settings
from PIL import Image
from rest_framework.test import APIClient

from accounts.models import BusinessOwner
from listings import image_variants
from listings.models import Category, Listing, ListingPhoto, Zone

MEDIA = tempfile.mkdtemp(prefix="variants-test-")


def jpeg(width, height):
    buffer = io.BytesIO()
    Image.new("RGB", (width, height), (212, 160, 23)).save(buffer, "JPEG")
    return ContentFile(buffer.getvalue(), name="photo.jpg")


@override_settings(MEDIA_ROOT=MEDIA)
class ImageVariantTests(TestCase):
    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        shutil.rmtree(MEDIA, ignore_errors=True)

    def setUp(self):
        self.client = APIClient()
        owner = BusinessOwner.objects.create(full_name="Kwame Trader", login_phone="+233207886600", password_hash="x")
        self.listing = Listing.objects.create(
            business_owner=owner, category=Category.objects.filter(kind="product").first(),
            zone=Zone.objects.get(name="Manhyia"), name="Kente Cloth", description="D.",
            contact_phone="+233207886600", price_amount="100.00", status=Listing.PUBLISHED,
        )

    def test_widths_are_the_spec_values(self):
        self.assertEqual(image_variants.WIDTHS, {"thumb": 320, "medium": 800, "large": 1600})

    def test_build_makes_webp_at_each_width(self):
        stored = image_variants.build(jpeg(2000, 1000))
        self.assertEqual(set(stored), {"thumb", "medium", "large"})
        for name, width in image_variants.WIDTHS.items():
            with default_storage.open(stored[name]) as handle:
                image = Image.open(handle)
                self.assertEqual(image.format, "WEBP")
                self.assertEqual(image.width, width)

    def test_small_source_skips_larger_variants_but_urls_fall_back(self):
        photo = ListingPhoto.objects.create(listing=self.listing, image=jpeg(500, 400), order=0)
        self.assertEqual(set(photo.variants) - {"src"}, {"thumb"})
        request = type("R", (), {"build_absolute_uri": staticmethod(lambda path: "http://testserver" + path)})()
        urls = image_variants.urls(request, photo.variants, photo.image)
        self.assertEqual(set(urls), {"thumb", "medium", "large"})
        self.assertEqual(urls["medium"], urls["large"])
        self.assertTrue(urls["medium"].endswith(photo.image.url))

    def test_corrupt_image_returns_empty_and_serializer_still_has_keys(self):
        photo = ListingPhoto.objects.create(
            listing=self.listing, image=ContentFile(b"not an image at all", name="bad.jpg"), order=0,
        )
        self.assertEqual(set(photo.variants) - {"src"}, set())
        body = self.client.get(f"/api/listings/{self.listing.pk}/").json()
        variants = body["photos"][0]["variants"]
        self.assertEqual(set(variants), {"thumb", "medium", "large"})
        self.assertEqual(variants["thumb"], body["photos"][0]["image"])

    def test_listing_detail_json_has_variants_for_each_photo(self):
        ListingPhoto.objects.create(listing=self.listing, image=jpeg(2000, 1500), order=0)
        ListingPhoto.objects.create(listing=self.listing, image=jpeg(1200, 900), order=1)
        self.listing.main_photo = jpeg(1800, 1200)
        self.listing.save()
        body = self.client.get(f"/api/listings/{self.listing.pk}/").json()
        self.assertEqual(len(body["photos"]), 2)
        for photo in body["photos"]:
            self.assertEqual(set(photo["variants"]), {"thumb", "medium", "large"})
            self.assertTrue(all(url.startswith("http") for url in photo["variants"].values()))
        self.assertEqual(set(body["main_photo_variants"]), {"thumb", "medium", "large"})
        self.assertTrue(body["photos"][0]["variants"]["thumb"].endswith(".webp"))
