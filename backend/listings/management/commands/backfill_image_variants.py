from django.core.management.base import BaseCommand

from listings import image_variants
from listings.models import Category, Listing, ListingPhoto, Zone


class Command(BaseCommand):
    help = "Make resized WebP variants for listing photos, category and zone pictures that do not have them yet (safe to re-run)."

    def add_arguments(self, parser):
        parser.add_argument("--force", action="store_true", help="Rebuild variants that already exist too.")

    def handle(self, *args, **options):
        made = 0
        force = options["force"]
        for photo in ListingPhoto.objects.exclude(image="").iterator():
            before = dict(photo.variants or {})
            if before and not force:
                continue
            image_variants.refresh(photo, "image", "variants")
            made += photo.variants != before
        for listing in Listing.objects.exclude(main_photo="").exclude(main_photo__isnull=True).iterator():
            before = dict(listing.main_photo_variants or {})
            if before and not force:
                continue
            image_variants.refresh(listing, "main_photo", "main_photo_variants")
            made += listing.main_photo_variants != before
        for model in (Category, Zone):
            for row in model.objects.exclude(image="").exclude(image__isnull=True).iterator():
                before = dict(row.image_variants or {})
                if before and not force:
                    continue
                image_variants.refresh(row, "image", "image_variants")
                made += row.image_variants != before
        self.stdout.write(f"Made variants for {made} images.")
