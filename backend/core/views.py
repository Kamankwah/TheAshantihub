from django.conf import settings
from django.db.models import Count
from rest_framework import generics
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, BasePermission
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import BusinessOwner, Customer, Role, StaffUser
from accounts.permissions import HasRolePermission
from accounts.sessions import require_sudo
from events.models import Event
from activity.models import ActivityEvent
from activity.services import record as activity_record
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


def _redis_state():
    """For System health (phase 7). The API itself never depends on Redis."""
    if not settings.REDIS_URL:
        return "not_configured"
    try:
        import redis

        with redis.Redis.from_url(settings.REDIS_URL, socket_connect_timeout=1, socket_timeout=1) as client:
            client.ping()
    except Exception:
        return "down"
    return "ok"


@api_view(["GET"])
@permission_classes([AllowAny])
def health_check(request):
    return Response({"status": "ok", "redis": _redis_state()})


SITE_SETTINGS_FIELDS = {
    "contact_email": "Contact email",
    "contact_phone": "Contact phone",
    "contact_address": "Contact address",
    "facebook_url": "Facebook link",
    "instagram_url": "Instagram link",
    "linkedin_url": "LinkedIn link",
    "twitter_url": "Twitter / X link",
    "tiktok_url": "TikTok link",
    "youtube_url": "YouTube link",
    "whatsapp_number": "WhatsApp support number",
    "support_hours": "Support hours",
    "warranty_returns_policy": "Warranty & returns policy",
    "service_dispute_policy": "Service satisfaction & dispute policy",
    "pickup_office_address": "Pickup office address",
}


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

    def perform_update(self, serializer):
        instance = serializer.instance
        before = {f: getattr(instance, f) for f in SITE_SETTINGS_FIELDS}
        settings_row = serializer.save()
        after = {f: getattr(settings_row, f) for f in SITE_SETTINGS_FIELDS}
        changed = [f for f in SITE_SETTINGS_FIELDS if before[f] != after[f]]
        if changed:
            activity_record(
                self.request.user, "site_settings.updated", target=settings_row,
                summary=", ".join(SITE_SETTINGS_FIELDS[f] for f in changed),
                before={f: before[f] for f in changed}, after={f: after[f] for f in changed},
                method=self.request.method, request=self.request,
            )


class IsSuperAdmin(BasePermission):
    def has_permission(self, request, view):
        user = request.user
        return isinstance(user, StaffUser) and user.role.name == Role.SUPER_ADMIN


class PickupAddressView(APIView):
    """PATCH /api/core/site-settings/pickup-address/ {pickup_office_address} -- where a store-pickup customer collects
    their order. A Super Admin only, who re-enters their password (require_sudo); the general site-settings PATCH
    cannot change it. Blank is allowed (back to "address to be confirmed"); the change is recorded in the site-settings
    history like any other."""

    permission_classes = [IsSuperAdmin]

    def patch(self, request):
        require_sudo(request)
        value = request.data.get("pickup_office_address")
        if not isinstance(value, str):
            return Response({"pickup_office_address": ["Enter the address as text, or leave it blank."]}, status=400)
        value = value.strip()
        if len(value) > 300:
            return Response({"pickup_office_address": ["Use at most 300 characters."]}, status=400)
        row = SiteSettings.load()
        before = row.pickup_office_address
        if before != value:
            row.pickup_office_address = value
            row.save(update_fields=["pickup_office_address"])
            activity_record(
                request.user, "site_settings.updated", target=row, summary=SITE_SETTINGS_FIELDS["pickup_office_address"],
                before={"pickup_office_address": before}, after={"pickup_office_address": value},
                method=request.method, request=request,
            )
        return Response({"pickup_office_address": value})


class SiteSettingsHistoryView(APIView):
    """GET /api/core/site-settings/history/ -- only the saves that were actually
    recorded, with what each field was and became."""

    def get_permissions(self):
        return [HasRolePermission("site_settings.manage")]

    def get(self, request):
        events = ActivityEvent.objects.filter(verb="site_settings.updated").order_by("-id")[:20]
        out = []
        for e in events:
            before, after = e.before or {}, e.after or {}
            changes = [
                {"field": f, "label": SITE_SETTINGS_FIELDS[f], "before": before.get(f, ""), "after": after.get(f, "")}
                for f in SITE_SETTINGS_FIELDS if f in after or f in before
            ]
            out.append({"id": e.pk, "at": e.occurred_at, "who": e.actor_label, "changes": changes})
        return Response(out)


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
