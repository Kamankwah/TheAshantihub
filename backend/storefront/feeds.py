"""Public feeds for the storefront (Plan M1). Deals: live goods and food listings (cart.guard.deliverable_q, the same
listings a sale price can apply to) with a real discount, plus sponsored ones.

A discount counts only while it is live (listings.pricing.live_discount_q: sale price below the regular price, not past its end date). `was_price` and `discount_percent` appear only when the
listing really held its regular price for the previous 7 days (listings.pricing); otherwise the row shows the sale
price alone. Rows carry no phone, email or business detail (businesses are never contacted directly)."""
from django.db.models import Q
from django.utils import timezone

from cart.guard import deliverable_q
from catalogue.offers import live_q
from listings import pricing
from listings.models import Listing, ListingPriceHistory
from listings.serializers import PublicListingSerializer
from listings.views import _with_rating_annotations

from .search import _url

DEFAULT_LIMIT = 24
MAX_LIMIT = 48
SPONSORED_DEFAULT_LIMIT = 12
SPONSORED_MAX_LIMIT = 24


def sponsored(limit=SPONSORED_DEFAULT_LIMIT, category_id=None, exclude_id=None, request=None):
    """Live sponsored listings (the Deals feed's live_q rule) as the public list's card rows. `category_id` keeps that
    category and its descendants (storefront.search.category_ids, the browse helper); 0 or an unknown id matches nothing."""
    from .search import category_ids

    limit = max(1, min(int(limit), SPONSORED_MAX_LIMIT))
    queryset = Listing.objects.filter(live_q()).filter(sponsored=True)
    if category_id is not None:
        queryset = queryset.filter(category_id__in=category_ids(category_id) if category_id else [])
    if exclude_id is not None:
        queryset = queryset.exclude(pk=exclude_id)
    ids = list(queryset.order_by("-updated_at", "-pk").values_list("pk", flat=True)[:limit])
    rows = _with_rating_annotations(
        Listing.objects.filter(pk__in=ids).select_related("category", "zone", "business_owner__profile").prefetch_related("photos")
    )
    by_id = {row.pk: row for row in rows}
    return PublicListingSerializer([by_id[i] for i in ids if i in by_id], many=True, context={"request": request}).data


def deals(limit=DEFAULT_LIMIT, request=None):
    limit = max(1, min(int(limit), MAX_LIMIT))
    discounted = pricing.live_discount_q()
    queryset = (
        _with_rating_annotations(Listing.objects.filter(live_q()).filter(deliverable_q()))
        .filter(discounted | Q(sponsored=True))
        .select_related("category")
        .order_by("-created_at", "-pk")[:limit]
    )
    listings = list(queryset)
    price_of = {item.pk: pricing.dec(item.price_amount) for item in listings}
    started = {
        listing_id: started_at
        for listing_id, price, started_at in ListingPriceHistory.objects
        .filter(listing_id__in=list(price_of), variant__isnull=True, ended_at__isnull=True).order_by("started_at")
        .values_list("listing_id", "price", "started_at")
        if price == price_of[listing_id]
    }
    now = timezone.now()
    rows = []
    for item in listings:
        real = pricing.is_discounted(item)
        was = pricing.was_price_since(item, started.get(item.pk), now)
        rows.append({
            "id": item.pk,
            "name": item.name,
            "photo": _url(item.main_photo, request),
            "category_label": item.category.label,
            "price_amount": str(pricing.dec(item.price_amount)),
            "sale_price": str(pricing.dec(item.sale_price)) if real else None,
            "was_price": None if was is None else str(was),
            "discount_percent": pricing.discount_percent(was, item.effective_price),
            "sponsored": item.sponsored,
            "review_count": item.review_count,
            "avg_rating": None if not item.review_count else round(float(item.avg_rating), 1),
        })
    return rows
