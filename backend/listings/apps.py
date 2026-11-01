from django.apps import AppConfig


class ListingsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "listings"

    def ready(self):
        from django.db.models.signals import post_save, pre_save

        from . import image_variants
        from .models import Listing, ListingPhoto

        pre_save.connect(image_variants.mark_photo, sender=ListingPhoto, dispatch_uid="listing-photo-new-image")
        pre_save.connect(image_variants.mark_listing, sender=Listing, dispatch_uid="listing-main-new-image")
        post_save.connect(image_variants.on_photo_saved, sender=ListingPhoto, dispatch_uid="listing-photo-variants")
        post_save.connect(image_variants.on_listing_saved, sender=Listing, dispatch_uid="listing-main-variants")
