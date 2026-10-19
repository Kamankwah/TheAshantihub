"""Holding an order until its vendors open (Africa/Accra opening hours, accounts.hours)."""
from django.utils import timezone

from accounts import hours


def ready_not_before(owner_ids, at=None):
    """The latest next opening among the vendors, or None when every vendor is open at `at`.
    A vendor with no hours uses the platform window inside accounts.hours.next_open."""
    from accounts.models import BusinessOwner

    at = at or timezone.now()
    latest = None
    for owner in BusinessOwner.objects.filter(pk__in=set(owner_ids)):
        opening = hours.next_open(owner, at)
        if opening == at:
            continue
        if latest is None or opening > latest:
            latest = opening
    return latest


def for_items(items, at=None):
    """For cart lines (checkout and the cart quote): their listings' businesses."""
    return ready_not_before([i.listing.business_owner_id for i in items], at)


def quote(items, delivery_method, at=None):
    """{"delivery_from": ISO string with the Accra offset or None, "deferred": bool}. Only delivery is deferred."""
    from accounts.hours import ACCRA
    from orders.models import Order

    opening = for_items(items, at) if delivery_method == Order.DOOR_TO_DOOR and items else None
    return {"delivery_from": opening.astimezone(ACCRA).isoformat() if opening else None, "deferred": opening is not None}
