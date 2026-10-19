"""Holding an order until its vendors open (Africa/Accra opening hours, accounts.hours)."""
from django.utils import timezone

from accounts import hours


def decide(owner_ids, at=None):
    """(opening, source). opening is the latest next opening among the vendors, or None when every vendor is open at
    `at`. source is "business_hours" when a vendor that sets that latest time has its own hours, else "platform"
    (every vendor setting it lacks hours, so the platform window decided); None when nothing is held."""
    from accounts.models import BusinessOwner

    at = at or timezone.now()
    latest, setters = None, []
    for owner in BusinessOwner.objects.filter(pk__in=set(owner_ids)):
        opening = hours.next_open(owner, at)
        if opening == at:
            continue
        if latest is None or opening > latest:
            latest, setters = opening, [owner]
        elif opening == latest:
            setters.append(owner)
    if latest is None:
        return None, None
    return latest, "business_hours" if any(hours.has_hours(o) for o in setters) else "platform"


def ready_not_before(owner_ids, at=None):
    """The latest next opening among the vendors, or None when every vendor is open at `at`.
    A vendor with no hours uses the platform window inside accounts.hours.next_open."""
    return decide(owner_ids, at)[0]


def for_items(items, at=None):
    """For cart lines (checkout and the cart quote): their listings' businesses."""
    return ready_not_before([i.listing.business_owner_id for i in items], at)


def quote(items, delivery_method, at=None):
    """{"delivery_from": ISO string with the Accra offset or None, "deferred": bool, "source": ...}. Only delivery is deferred."""
    from accounts.hours import ACCRA
    from orders.models import Order

    opening, source = decide([i.listing.business_owner_id for i in items], at) if delivery_method == Order.DOOR_TO_DOOR and items else (None, None)
    iso = opening.astimezone(ACCRA).isoformat() if opening else None
    return {"delivery_from": iso, "delivered_from": iso, "deferred": opening is not None, "source": source}
