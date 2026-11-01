from django.core.management.base import BaseCommand

from listings import image_variants
from listings.models import Listing, ListingPhoto


class Command(BaseCommand):
    help = "Make resized WebP variants for listing photos that do not have them yet (safe to re-run)."

    def handle(self, *args, **options):
        made = 0
        for photo in ListingPhoto.objects.exclude(image="").iterator():
            before = dict(photo.variants or {})
            image_variants.refresh(photo, "image", "variants")
            made += photo.variants != before
        for listing in Listing.objects.exclude(main_photo="").exclude(main_photo__isnull=True).iterator():
            before = dict(listing.main_photo_variants or {})
            image_variants.refresh(listing, "main_photo", "main_photo_variants")
            made += listing.main_photo_variants != before
        self.stdout.write(f"Made variants for {made} images.")
