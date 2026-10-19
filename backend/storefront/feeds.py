"""Public feeds for the storefront (Plan M1). Deals: live product listings with a real discount, plus sponsored ones.

A discount counts only while `sale_price < price_amount`. `was_price` and `discount_percent` appear only when the
listing really held its regular price for the previous 7 days (listings.pricing); otherwise the row shows the sale
price alone. Rows carry no phone, email or business detail (businesses are never contacted directly)."""
from django.db.models import F, Q
from django.utils import timezone

from catalogue.offers import live_q
from listings import pricing
from listings.models import Category, Listing, ListingPriceHistory
from listings.views import _with_rating_annotations

from .search import _url

DEFAULT_LIMIT = 24
MAX_LIMIT = 48


def deals(limit=DEFAULT_LIMIT, request=None):
    limit = max(1, min(int(limit), MAX_LIMIT))
    discounted = Q(sale_price__isnull=False, sale_price__lt=F("price_amount"))
    queryset = (
        _with_rating_annotations(Listing.objects.filter(live_q(), category__kind=Category.PRODUCT))
        .filter(discounted | Q(sponsored=True))
        .select_related("category")
        .order_by("-created_at", "-pk")[:limit]
    )
    listings = list(queryset)
    started = dict(
        ListingPriceHistory.objects.filter(listing_id__in=[item.pk for item in listings], ended_at__isnull=True)
        .values_list("listing_id", "started_at")
    )
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
