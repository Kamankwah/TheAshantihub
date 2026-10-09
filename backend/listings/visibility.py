"""Which businesses public browse hides — one rule for every public place.

A business is hidden while staff have it suspended (BusinessOwner.is_suspended)
or, only while settings.SUBSCRIPTION_PAUSE_ENABLED is on, while the
subscription clock has it paused (billing.Subscription.paused_at, see
billing/clock.py). With the pause off (the default) an unpaid subscription
hides nothing — not even a row the clock paused before it was switched off.
Both are query-time filters: nothing is unpublished or deleted, so
unsuspending or paying brings everything back at once.

Used by PublicListingListView, PublicListingDetailView, RelatedListingsView,
events.views._live_events_queryset and adding to a cart.
"""
from django.conf import settings
from django.db.models import Q


def hidden_business_q(prefix="business_owner__"):
    """A Q matching rows whose business is hidden. `prefix` is the lookup path
    from the queried model to its BusinessOwner, ending in "__" ("" when the
    queried model is BusinessOwner itself). An owner with no subscription row
    is never matched by the pause half, and the pause half applies only while
    SUBSCRIPTION_PAUSE_ENABLED is on."""
    hidden = Q(**{f"{prefix}is_suspended": True})
    if settings.SUBSCRIPTION_PAUSE_ENABLED:
        hidden |= Q(**{f"{prefix}subscription__paused_at__isnull": False})
    return hidden
