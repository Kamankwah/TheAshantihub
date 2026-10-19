"""Public search across products, services, stays and events (Plan M1).

Rows carry only what a result card needs: id, kind, name, price, photo, category_label. Never a phone, email, address
or business contact (CLAUDE.md: businesses are not contacted directly). Visibility is the same as public browse:
published listings from a business browse shows (listings.visibility, sold-out rule while its switch is on), and the
one shared live-events rule (events.views._live_events_queryset)."""
from django.db.models import Min, Q

from listings.models import Category, Listing
from listings.visibility import hidden_business_q, sold_out_q

MIN_QUERY = 2
MAX_LIMIT = 20
GROUPS = ("products", "services", "stays", "events")
KINDS = {"products": "products", "product": "products", "services": "services", "service": "services",
         "stays": "stays", "stay": "stays", "events": "events", "event": "events"}
ROW_KIND = {"products": "product", "services": "service", "stays": "stay", "events": "event"}


def empty():
    return {group: [] for group in GROUPS}


def category_ids(department):
    """Ids of the category matching a slug or an id, and all its descendants; empty when none matches."""
    value = str(department).strip()
    node = Category.objects.filter(slug=value).first()
    if node is None and value.isdigit():
        node = Category.objects.filter(pk=int(value)).first()
    if node is None:
        return []
    found, frontier = {node.pk}, [node.pk]
    while frontier:
        frontier = [pk for pk in Category.objects.filter(parent_id__in=frontier).values_list("pk", flat=True) if pk not in found]
        found.update(frontier)
    return list(found)


def _text_q(q):
    return Q(name__icontains=q) | Q(description__icontains=q)


def _order(rows, q):
    """Name matches first, then newest: a stable sort over rows already newest first."""
    needle = q.lower()
    return sorted(rows, key=lambda row: needle not in row["name"].lower())


def _url(file_field, request):
    if not file_field:
        return None
    url = file_field.url
    return request.build_absolute_uri(url) if request is not None else url


def _price(value):
    return None if value is None else str(value)


def _listing_rows(queryset, kind, q, limit, request):
    queryset = queryset.select_related("category").order_by("-created_at", "-pk")[: limit * 3]
    rows = [{"id": item.pk, "kind": kind, "name": item.name, "price": _price(item.effective_price),
             "photo": _url(item.main_photo, request), "category_label": item.category.label} for item in queryset]
    return _order(rows, q)[:limit]


def _event_rows(queryset, q, limit, request):
    queryset = (queryset.select_related("category").prefetch_related("media")
                .annotate(lowest=Min("ticket_types__price", filter=Q(ticket_types__is_active=True)))
                .order_by("-created_at", "-pk")[: limit * 3])
    rows = []
    for event in queryset:
        media = list(event.media.all())
        rows.append({"id": event.pk, "kind": "event", "name": event.name, "price": _price(event.lowest),
                     "photo": _url(media[0].media, request) if media else None, "category_label": event.category.label})
    return _order(rows, q)[:limit]


def run(q, department=None, kind=None, limit=MAX_LIMIT, request=None):
    from events.views import _live_events_queryset  # the one rule for which events are public

    result = empty()
    q = (q or "").strip()
    if len(q) < MIN_QUERY:
        return result
    limit = max(1, min(int(limit), MAX_LIMIT))
    wanted = {kind} if kind else set(GROUPS)
    ids = category_ids(department) if department else None
    if ids == []:
        return result

    listings = (Listing.objects.filter(status=Listing.PUBLISHED).filter(_text_q(q))
                .exclude(hidden_business_q()).exclude(sold_out_q()))
    if ids is not None:
        listings = listings.filter(category_id__in=ids)
    if "products" in wanted:
        result["products"] = _listing_rows(listings.filter(category__kind=Category.PRODUCT), "product", q, limit, request)
    if "services" in wanted:
        result["services"] = _listing_rows(
            listings.filter(category__kind=Category.SERVICE, category__is_accommodation=False), "service", q, limit, request)
    if "stays" in wanted:
        result["stays"] = _listing_rows(listings.filter(category__is_accommodation=True), "stay", q, limit, request)
    if "events" in wanted:
        events = _live_events_queryset().filter(_text_q(q))
        if ids is not None:
            events = events.filter(category_id__in=ids)
        result["events"] = _event_rows(events, q, limit, request)
    return result
