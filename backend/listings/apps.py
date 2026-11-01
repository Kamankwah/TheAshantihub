from django.apps import AppConfig


class ListingsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "listings"

    def ready(self):
        from django.db.models.signals import post_save

        from . import image_variants
        from .models import Listing, ListingPhoto

        post_save.connect(image_variants.on_photo_saved, sender=ListingPhoto, dispatch_uid="listing-photo-variants")
        post_save.connect(image_variants.on_listing_saved, sender=Listing, dispatch_uid="listing-main-variants")
