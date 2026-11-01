import io
import shutil
import tempfile

from unittest import mock

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

    def test_saving_an_unchanged_listing_does_not_rebuild_or_build_for_legacy_rows(self):
        self.listing.main_photo = jpeg(1800, 1200)
        self.listing.save()
        built = dict(self.listing.main_photo_variants)
        self.assertIn("thumb", built)
        self.listing.save()
        self.assertEqual(self.listing.main_photo_variants, built)
        # A row from before this feature (photo present, variants empty) is left alone by ordinary saves.
        Listing.objects.filter(pk=self.listing.pk).update(main_photo_variants={})
        legacy = Listing.objects.get(pk=self.listing.pk)
        legacy.price_amount = "120.00"
        legacy.save()
        self.assertEqual(Listing.objects.get(pk=self.listing.pk).main_photo_variants, {})

    def test_storage_error_does_not_break_the_save(self):
        real_save = default_storage.save

        def fail_for_variants(name, *args, **kwargs):
            if name.startswith(image_variants.FOLDER):
                raise OSError("disk full")
            return real_save(name, *args, **kwargs)

        with mock.patch.object(default_storage, "save", side_effect=fail_for_variants):
            photo = ListingPhoto.objects.create(listing=self.listing, image=jpeg(2000, 1000), order=0)
        self.assertTrue(ListingPhoto.objects.filter(pk=photo.pk).exists())
        self.assertEqual(photo.variants, {})

    def test_very_large_image_is_skipped(self):
        with mock.patch.object(image_variants, "MAX_PIXELS", 1_000_000):
            self.assertEqual(image_variants.build(jpeg(1500, 1000)), {})
