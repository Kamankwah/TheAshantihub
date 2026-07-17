from django.db.models import Count
from rest_framework import generics
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import BusinessOwner, Customer
from accounts.permissions import HasRolePermission
from events.models import Event
from listings.models import Category, Listing
from orders.models import Order

from .models import SiteSettings
from .serializers import SiteSettingsSerializer


def _count_by(queryset, field, keys):
    """Count rows grouped by `field`, returned as a dict with every value in
    `keys` present (defaulting to 0) so the frontend always sees a complete,
    stable set of buckets rather than only the ones that happen to be non-empty.
    """
    counts = {row[field]: row["n"] for row in queryset.values(field).annotate(n=Count("id"))}
    return {key: counts.get(key, 0) for key in keys}


@api_view(["GET"])
@permission_classes([AllowAny])
def health_check(request):
    return Response({"status": "ok"})


class SiteSettingsView(generics.RetrieveUpdateAPIView):
    """GET is public; PATCH (partial update) requires site_settings.manage.

    Always operates on the singleton row via SiteSettings.load(), which
    self-heals (get_or_create) if the row doesn't exist yet rather than
    ever 404ing.
    """

    serializer_class = SiteSettingsSerializer

    def get_permissions(self):
        if self.request.method in ("PATCH", "PUT"):
            return [HasRolePermission("site_settings.manage")]
        return [AllowAny()]

    def get_object(self):
        return SiteSettings.load()


class AnalyticsOverviewView(APIView):
    """GET /api/core/analytics/ — staff-only (analytics.view) marketplace
    snapshot. Every number here is a real count derived from existing models
    (accounts, listings, orders, events) — no fabricated/placeholder data, no
    invented time-series. It's a live headcount of what's actually in the
    platform, shaped for the Analytics tab's KPI row + status donuts.
    """

    def get_permissions(self):
        return [HasRolePermission("analytics.view")]

    def get(self, request):
        return Response(
            {
                "customers": Customer.objects.count(),
                "business_owners": BusinessOwner.objects.count(),
                "business_owners_by_kyc": _count_by(
                    BusinessOwner.objects.all(),
                    "kyc_status",
                    [BusinessOwner.PENDING, BusinessOwner.VERIFIED, BusinessOwner.REJECTED],
                ),
                "listings_total": Listing.objects.count(),
                "listings_by_status": _count_by(
                    Listing.objects.all(),
                    "status",
                    [Listing.DRAFT, Listing.PENDING_REVIEW, Listing.PUBLISHED, Listing.REJECTED],
                ),
                # Kind breakdown of PUBLISHED listings only — i.e. what's
                # actually live in the marketplace, split product/service/event.
                "listings_by_kind": _count_by(
                    Listing.objects.filter(status=Listing.PUBLISHED),
                    "category__kind",
                    [Category.PRODUCT, Category.SERVICE, Category.EVENT],
                ),
                "orders_total": Order.objects.count(),
                "orders_by_status": _count_by(
                    Order.objects.all(),
                    "status",
                    [Order.PENDING, Order.PAID, Order.CANCELLED],
                ),
                "events_total": Event.objects.count(),
                "events_by_status": _count_by(
                    Event.objects.all(),
                    "status",
                    [Event.PENDING, Event.APPROVED, Event.REJECTED],
                ),
            }
        )
