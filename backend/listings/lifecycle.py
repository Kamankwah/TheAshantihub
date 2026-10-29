"""Drop (reversible) and discontinue (permanent): the owner's two ways to take a listing off sale.

Public queries already filter on `status=PUBLISHED`, so a dropped or discontinued listing leaves every public
surface with no extra filter. Each function locks the row, checks the move is allowed and answers the listing; a
refused move raises LifecycleError, which the view answers as 400 {"status": message}."""
from django.db import transaction
from django.utils import timezone

from . import revisions
from .models import Listing

DISCONTINUABLE = (Listing.PUBLISHED, Listing.DROPPED, Listing.DRAFT, Listing.REJECTED)


class LifecycleError(Exception):
    """A drop, restore or discontinue the listing's current status does not allow."""


def _locked(listing):
    return Listing.objects.select_for_update().get(pk=listing.pk)


def drop(listing):
    """Hide a published listing. It returns with `restore`, with no new approval."""
    with transaction.atomic():
        row = _locked(listing)
        if row.status != Listing.PUBLISHED:
            raise LifecycleError("Only a published listing can be dropped.")
        row.status = Listing.DROPPED
        row.dropped_at = timezone.now()
        row.save(update_fields=["status", "dropped_at", "updated_at"])
    return row


def restore(listing):
    """Put a dropped listing back on sale; nothing about its content changed, so it is not re-approved."""
    with transaction.atomic():
        row = _locked(listing)
        if row.status != Listing.DROPPED:
            raise LifecycleError("Only a dropped listing can be restored.")
        # Dropping frees a plan slot, so restoring must fit under the cap again (same rule as creating).
        from .serializers import LISTING_LIMIT_MESSAGE, active_listing_cap_reached, subscriptions_on

        if subscriptions_on() and active_listing_cap_reached(row.business_owner):
            raise LifecycleError(LISTING_LIMIT_MESSAGE)
        row.status = Listing.PUBLISHED
        row.dropped_at = None
        row.save(update_fields=["status", "dropped_at", "updated_at"])
    return row


def discontinue(listing):
    """Take a listing off sale for good. Old orders keep showing it. An open edit (revision) is deleted."""
    with transaction.atomic():
        row = _locked(listing)
        if row.status not in DISCONTINUABLE:
            raise LifecycleError("This listing cannot be discontinued while it waits for review.")
        revisions.delete_open(row)  # the open edit goes, with the files it staged
        row.status = Listing.DISCONTINUED
        row.discontinued_at = timezone.now()
        row.save(update_fields=["status", "discontinued_at", "updated_at"])
    return row
