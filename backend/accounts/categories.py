"""A business's categories: an ordered list of 1 to 10 of its kind (product or service).

`BusinessOwnerProfile.business_category` is the main (first) category and stays for older readers; this module is the
only writer of both it and the `BusinessOwnerCategory` links, so they cannot drift apart. Categories only describe a
business: listings are still limited by `business_kind` alone.

Lock order: the profile row only (`of=("self",)`), never the owner row. The owner profile PATCH and the staff identity
decisions lock owner and then profile, so taking the profile alone cannot deadlock with them.
"""
from django.db import transaction

from listings.models import Category

from .models import BusinessOwnerCategory, BusinessOwnerProfile

MIN_CATEGORIES = 1
MAX_CATEGORIES = 10


class InvalidCategories(Exception):
    def __init__(self, message):
        super().__init__(message)
        self.message = message


def set_categories(profile, category_ids):
    """Replace the profile's categories with `category_ids` (in order; the first is the main one).

    Returns the ordered categories. Raises `InvalidCategories` and changes nothing when the list is not valid.
    """
    ids = list(category_ids)
    with transaction.atomic():
        locked = BusinessOwnerProfile.objects.select_for_update(of=("self",)).get(pk=profile.pk)

        by_id = Category.objects.in_bulk(ids)
        if len(by_id) != len(set(ids)):
            raise InvalidCategories("That category doesn't exist.")
        if len(set(ids)) != len(ids):
            raise InvalidCategories("Pick each category once.")
        if len(ids) < MIN_CATEGORIES:
            raise InvalidCategories("Choose at least one category.")
        if len(ids) > MAX_CATEGORIES:
            raise InvalidCategories(f"Choose at most {MAX_CATEGORIES} categories.")
        if not locked.business_kind:
            raise InvalidCategories("Choose products or services first.")
        if any(c.kind != locked.business_kind for c in by_id.values()):
            raise InvalidCategories(f"Choose categories for a {locked.business_kind} business.")

        ordered = [by_id[i] for i in ids]
        # Clear first: the (profile, position) unique constraint would trip on a reorder done row by row.
        BusinessOwnerCategory.objects.filter(profile=locked).delete()
        BusinessOwnerCategory.objects.bulk_create(
            BusinessOwnerCategory(profile=locked, category=category, position=position)
            for position, category in enumerate(ordered)
        )
        locked.business_category = ordered[0]
        locked.save(update_fields=["business_category"])
        # Keep the caller's instance in step with what was saved.
        profile.business_category = ordered[0]
        return ordered


def categories_of(profile):
    """The profile's categories in order. With no links yet, the main category alone (older rows)."""
    links = BusinessOwnerCategory.objects.filter(profile=profile).select_related("category").order_by("position")
    ordered = [link.category for link in links]
    if ordered:
        return ordered
    if profile.business_category_id:
        return [profile.business_category]
    return []


def resync_after_category_delete(profile_ids):
    """Close the gaps a deleted category left and point `business_category` at the first remaining link (or NULL)."""
    for profile_id in profile_ids:
        with transaction.atomic():
            locked = BusinessOwnerProfile.objects.select_for_update(of=("self",)).filter(pk=profile_id).first()
            if locked is None:
                continue
            remaining = list(BusinessOwnerCategory.objects.filter(profile=locked).order_by("position"))
            for position, link in enumerate(remaining):
                if link.position != position:
                    BusinessOwnerCategory.objects.filter(pk=link.pk).update(position=position)
            first_id = remaining[0].category_id if remaining else None
            if locked.business_category_id != first_id:
                BusinessOwnerProfile.objects.filter(pk=locked.pk).update(business_category_id=first_id)
