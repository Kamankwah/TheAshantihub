"""Which businesses public browse hides — one rule for every public place.

A business is hidden while staff have it suspended (BusinessOwner.is_suspended)
or, only while settings.SUBSCRIPTION_PAUSE_ENABLED is on, while the
subscription clock has it paused (billing.Subscription.paused_at, see
billing/clock.py). With the pause off (the default) an unpaid subscription
hides nothing — not even a row the clock paused before it was switched off.
Both are query-time filters: nothing is unpublished or deleted, so
unsuspending or paying brings everything back at once.

Used by PublicListingListView, PublicListingDetailView, RelatedListingsView,
events.views._live_events_queryset, adding to a cart, catalogue.offers (other sellers),
and catalogue.views.OtherSellersView.
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


def sold_out_q(prefix=""):
    """A Q matching counted goods with nothing left (catalogue plan 6; spec §1 row 15, §10 "zero stock hides the
    offer"). Public search and the related list leave them out while settings.SOLD_OUT_HIDDEN_ENABLED is on (env,
    default off until the Plan 6F screens tell a business to leave the count empty when it does not count stock).
    Matches nothing while it is off, and never a service, stay or event: only products and food are offers with a stock
    count."""
    if not settings.SOLD_OUT_HIDDEN_ENABLED:
        return Q(pk__in=[])
    from cart.guard import deliverable_q  # cart.guard imports this module

    return Q(**{f"{prefix}stock_quantity": 0}) & deliverable_q(prefix)
