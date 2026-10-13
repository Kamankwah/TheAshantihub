"""Who a segment reaches (Marketing M2). Counts only: contact details never leave here.

Only people whose latest consent record for the segment's channel is 'opted in' are ever
counted or sent to. A person who was never asked has no record and is never counted."""
from datetime import timedelta

from django.db.models import Exists, OuterRef, Q
from django.utils import timezone

from accounts.models import BusinessOwner, Customer
from bookings.models import Booking
from listings.models import Category, Listing, Zone
from orders.models import Order, OrderItem

from .consent import latest_status_subquery
from .models_consent import BUSINESS, CHANNEL_LABELS, CUSTOMER, ConsentRecord

ACTIVITIES = {
    CUSTOMER: {"any": "Any customer", "active": "Ordered or booked in the last N days", "signed_up": "Signed up in the last N days", "inactive": "Has not ordered or booked in the last N days"},
    BUSINESS: {"any": "Any business", "live": "Has a live listing", "signed_up": "Signed up in the last N days"},
}
MAX_DAYS = 730


class AudienceError(Exception):
    def __init__(self, message):
        super().__init__(message)
        self.message = message


def clean_filters(audience, data):
    """Validated filters: {"zones": [ids], "categories": [ids], "activity": key, "days": int}."""
    if audience not in (CUSTOMER, BUSINESS):
        raise AudienceError("Choose customers or businesses.")
    data = data if isinstance(data, dict) else {}

    def ids(key, model):
        raw = data.get(key) or []
        if not isinstance(raw, list) or any(isinstance(i, bool) or not isinstance(i, int) for i in raw):
            raise AudienceError(f"Pick {key} from the list.")
        found = set(model.objects.filter(pk__in=raw).values_list("pk", flat=True))
        if found != set(raw):
            raise AudienceError(f"One of the {key} no longer exists.")
        return sorted(found)

    activity = data.get("activity") or "any"
    if activity not in ACTIVITIES[audience]:
        raise AudienceError("Choose one of the activity options.")
    days = data.get("days", 90)
    if isinstance(days, bool) or not isinstance(days, int) or not 1 <= days <= MAX_DAYS:
        raise AudienceError(f"Days must be between 1 and {MAX_DAYS}.")
    return {"zones": ids("zones", Zone), "categories": ids("categories", Category), "activity": activity, "days": days}


def _customer_matches(filters):
    """Customers matching the filters, before any consent check."""
    since = timezone.now() - timedelta(days=filters["days"])
    qs = Customer.objects.filter(is_suspended=False)
    lines = OrderItem.objects.filter(order__customer=OuterRef("pk")).exclude(order__status=Order.CANCELLED)
    bookings = Booking.objects.filter(customer=OuterRef("pk")).exclude(status=Booking.CANCELLED)
    if filters["zones"]:
        lines, bookings = lines.filter(listing__zone_id__in=filters["zones"]), bookings.filter(listing__zone_id__in=filters["zones"])
    if filters["categories"]:
        lines, bookings = lines.filter(listing__category_id__in=filters["categories"]), bookings.filter(listing__category_id__in=filters["categories"])
    activity = filters["activity"]
    recent_lines, recent_bookings = lines.filter(order__placed_at__gte=since), bookings.filter(created_at__gte=since)
    if activity == "active":
        qs = qs.filter(Exists(recent_lines) | Exists(recent_bookings))
    elif activity == "inactive":
        every_line = OrderItem.objects.filter(order__customer=OuterRef("pk"), order__placed_at__gte=since).exclude(order__status=Order.CANCELLED)
        every_booking = Booking.objects.filter(customer=OuterRef("pk"), created_at__gte=since).exclude(status=Booking.CANCELLED)
        qs = qs.exclude(Exists(every_line) | Exists(every_booking))
        if filters["zones"] or filters["categories"]:
            qs = qs.filter(Exists(lines) | Exists(bookings))   # bought there before, not lately
    else:
        if filters["zones"] or filters["categories"]:
            qs = qs.filter(Exists(lines) | Exists(bookings))
        if activity == "signed_up":
            qs = qs.filter(created_at__gte=since)
    return qs


def _business_matches(filters):
    since = timezone.now() - timedelta(days=filters["days"])
    qs = BusinessOwner.objects.filter(is_suspended=False)
    if filters["zones"]:
        qs = qs.filter(profile__zone_id__in=filters["zones"])
    if filters["categories"]:
        qs = qs.filter(profile__business_category_id__in=filters["categories"])
    if filters["activity"] == "live":
        qs = qs.filter(Exists(Listing.objects.filter(business_owner=OuterRef("pk"), status=Listing.PUBLISHED)))
    elif filters["activity"] == "signed_up":
        qs = qs.filter(created_at__gte=since)
    return qs


def matching(audience, filters):
    return _customer_matches(filters) if audience == CUSTOMER else _business_matches(filters)


def reachable(audience, filters, channel):
    """The people the filters match who are opted in to `channel` right now."""
    field = "customer" if audience == CUSTOMER else "business_owner"
    return matching(audience, filters).annotate(_consent=latest_status_subquery(field, channel)).filter(_consent=ConsentRecord.OPTED_IN)


def recently_messaged_ids(audience, days, now=None):
    """Ids of people who got a marketing message (any channel) in the last `days` days: the per-person cap."""
    from .models_campaigns import CampaignRecipient

    field = "customer_id" if audience == CUSTOMER else "business_owner_id"
    now = now or timezone.now()
    rows = CampaignRecipient.objects.filter(status__in=[CampaignRecipient.SENT, CampaignRecipient.DELIVERED, CampaignRecipient.SIMULATED], sent_at__gte=now - timedelta(days=days), sent_at__lte=now)
    return set(rows.exclude(**{field: None}).values_list(field, flat=True))


def failing_ids(audience, channel):
    """People whose last two sends on `channel` failed: left out of later sends."""
    from .models_campaigns import CampaignRecipient

    field = "customer_id" if audience == CUSTOMER else "business_owner_id"
    out = set()
    rows = CampaignRecipient.objects.filter(campaign__channel=channel).exclude(**{field: None}).exclude(status=CampaignRecipient.SKIPPED).exclude(status=CampaignRecipient.QUEUED).order_by(field, "-id")
    last = {}
    for pk, status in rows.values_list(field, "status")[:20000]:
        seen = last.setdefault(pk, [])
        if len(seen) < 2:
            seen.append(status)
    for pk, seen in last.items():
        if len(seen) == 2 and all(s == CampaignRecipient.FAILED for s in seen):
            out.add(pk)
    return out


def count_for(audience, filters, channel):
    """The live count: {"count", "matched", "no_opt_in", "skipped_by_cap", "by_zone": [...]}. Counts only."""
    filters = clean_filters(audience, filters)
    matched = matching(audience, filters).count()
    people = reachable(audience, filters, channel)
    count = people.count()
    from .models import SendPolicy

    cap_days = SendPolicy.current().per_person_cap_days
    recent = recently_messaged_ids(audience, cap_days)
    skipped = people.filter(pk__in=recent).count() if recent else 0
    by_zone = []
    for zone in Zone.objects.filter(pk__in=filters["zones"]).order_by("name"):
        by_zone.append({"zone_id": zone.pk, "label": zone.name, "count": reachable(audience, {**filters, "zones": [zone.pk]}, channel).count()})
    return {
        "count": count, "matched": matched, "no_opt_in": matched - count, "skipped_by_cap": skipped, "by_zone": by_zone,
        "channel": channel, "channel_label": CHANNEL_LABELS[channel], "audience": audience, "filters": filters,
    }
