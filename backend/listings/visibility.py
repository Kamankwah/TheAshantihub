"""Which businesses public browse hides — one rule for every public place.

A business is hidden while staff have it suspended (BusinessOwner.is_suspended)
or while the subscription clock has it paused (billing.Subscription.paused_at,
see billing/clock.py). Both are query-time filters: nothing is unpublished or
deleted, so unsuspending or paying brings everything back at once.

Used by PublicListingListView, PublicListingDetailView, RelatedListingsView,
events.views._live_events_queryset and adding to a cart.
"""
from django.db.models import Q


def hidden_business_q(prefix="business_owner__"):
    """A Q matching rows whose business is hidden. `prefix` is the lookup path
    from the queried model to its BusinessOwner, ending in "__" ("" when the
    queried model is BusinessOwner itself). An owner with no subscription row
    is never matched by the pause half."""
    return Q(**{f"{prefix}is_suspended": True}) | Q(**{f"{prefix}subscription__paused_at__isnull": False})
