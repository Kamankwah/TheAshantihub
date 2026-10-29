"""The owner-side listing writes, kept apart from the serializers so scouts and staff tools reuse them unchanged."""
from django.utils import timezone

from . import variants
from .models import Listing

DERIVED_FIELDS = ("price_amount", "stock_quantity", "sale_price", "sale_ends_at", "sale_started_at")


def save_sent_fields(instance, validated_data):
    """Write only the fields this request sent (catalogue plan 6). ModelSerializer.update saves the whole row, which would
    write back the catalogue_product and stock_quantity this request read over a staff grouping decision or a
    checkout's decrement that committed meanwhile. A variant listing's price, stock and sale price are derived from its
    variants, so a request that sends them is quietly ignored for those fields."""
    if variants.has_variants(instance):
        validated_data = {k: v for k, v in validated_data.items() if k not in DERIVED_FIELDS}
    if "sale_price" in validated_data:
        # A sale price written here has no end date; its start is now unless it is the sale already running.
        new = validated_data["sale_price"]
        running = new is not None and new == instance.sale_price and instance.sale_started_at is not None
        started = None if new is None else instance.sale_started_at if running else timezone.now()
        validated_data = {**validated_data, "sale_ends_at": None, "sale_started_at": started}
    for attr, value in validated_data.items():
        setattr(instance, attr, value)
    instance.save(update_fields=[*validated_data, "updated_at"])
    return instance


def create_listing(owner, validated_data, staff=None):
    """A new listing for `owner`; the contact phone defaults to the business's own number. `staff` is the staff member
    making it for the business (Ashanti Direct), kept as created_by_staff."""
    if not validated_data.get("contact_phone"):
        validated_data["contact_phone"] = owner.profile.business_contact_phone
    return Listing.objects.create(business_owner=owner, created_by_staff=staff, **validated_data)
