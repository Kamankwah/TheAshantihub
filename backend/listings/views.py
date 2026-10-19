import os
from datetime import timedelta
from decimal import Decimal

from django.core.files.base import ContentFile
from django.db import transaction as db_transaction
from django.db.models import Avg, Case, Count, Exists, F, FloatField, IntegerField, OuterRef, Q, Value, When
from django.db.models import ProtectedError
from django.utils import timezone
from django.utils.crypto import get_random_string
from rest_framework import filters, generics, serializers
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import BusinessOwner
from activity.services import record as activity_record
from accounts.permissions import HasRolePermission
from accounts.views import IsBusinessOwner
from billing.models import Transaction
from notifications.services import notify_business_owner, notify_staff_role

from .moderation_checks import (
    CONTACT_DETAILS_MESSAGE,
    blocking_failures,
    fraud_hold_message,
    hero_checks,
    open_fraud_flag,
    open_fraud_flags,
)
from .category_tree import build_tree
from .models import Category, HeroMediaSubmission, Listing, ListingPhoto, Promotion, Zone
from .permissions import IsHeroMediaOwner, IsListingOwner, IsListingPhotoOwner
from .serializers import (
    CartTieredListingSerializer,
    CategorySerializer,
    CategoryStaffSerializer,
    HeroActiveSerializer,
    HeroMediaModerationSerializer,
    HeroMediaStaffSerializer,
    HeroSubmitSerializer,
    ListingPhotoSerializer,
    ModerationListingSerializer,
    OwnerListingManageSerializer,
    OwnerListingSerializer,
    PromotionAdminSerializer,
    PromotionPurchaseSerializer,
    PromotionSerializer,
    PublicListingSerializer,
    ZoneSerializer,
)
from .pricing import effective_price_expr
from .visibility import hidden_business_q, sold_out_q
from .visits import record_visit


def _with_rating_annotations(queryset):
    """Adds avg_rating/review_count to a Listing queryset, sourced from
    published Review rows (reviews/ratings/Q&A plan, docs/PROJECT_SCOPE.md).
    `distinct=True` on the Count guards against inflation from any other
    join the queryset might already have — checked directly: none of this
    file's PublicListingSerializer-backing querysets (PublicListingListView,
    PublicListingDetailView, RelatedListingsView) join anything else at the
    DB level (`photos` is fetched by the serializer as its own nested query,
    not joined into this queryset; `is_promoted` uses an EXISTS subquery, not
    a join), so `distinct=True` isn't strictly load-bearing today — kept as a
    defensive measure regardless, per the reviews plan's explicit ask.
    """
    return queryset.annotate(
        avg_rating=Avg("reviews__rating", filter=Q(reviews__status="published")),
        review_count=Count("reviews", filter=Q(reviews__status="published"), distinct=True),
    )


class ListingPhotoCreateView(generics.CreateAPIView):
    serializer_class = ListingPhotoSerializer
    permission_classes = [IsAuthenticated, IsListingOwner]

    def get_listing(self):
        listing = generics.get_object_or_404(Listing, pk=self.kwargs["pk"])
        self.check_object_permissions(self.request, listing)
        return listing

    def perform_create(self, serializer):
        serializer.save(listing=self.get_listing())


class ListingPhotoDeleteView(APIView):
    permission_classes = [IsAuthenticated, IsListingOwner]

    def delete(self, request, pk, photo_id):
        listing = generics.get_object_or_404(Listing, pk=pk)
        self.check_object_permissions(request, listing)
        photo = generics.get_object_or_404(ListingPhoto, pk=photo_id, listing=listing)
        photo.delete()
        return Response(status=204)


class CategoryListView(generics.ListCreateAPIView):
    queryset = Category.objects.all()
    serializer_class = CategorySerializer

    def _is_staff_read(self):
        from accounts.models import StaffUser

        return self.request.method == "GET" and isinstance(self.request.user, StaffUser)

    def get_serializer_class(self):
        return CategoryStaffSerializer if self._is_staff_read() else CategorySerializer

    def get_queryset(self):
        if self._is_staff_read():
            # Usage counts for the staff Categories screen, in the same query.
            return Category.objects.annotate(
                listing_count=Count("listings", distinct=True), event_count=Count("events", distinct=True),
            )
        return Category.objects.all()

    def get_permissions(self):
        if self.request.method == "POST":
            return [HasRolePermission("categories.manage")]
        return [AllowAny()]


class CategoryTreeView(APIView):
    """GET categories/tree/: public. The shopper view lists only nodes with a live listing or event in them or below
    them. ?full=1 is the whole tree for a business creating a listing, and needs a signed-in business owner or staff."""

    permission_classes = [AllowAny]

    def get(self, request):
        from accounts.models import StaffUser

        full = request.query_params.get("full") in ("1", "true")
        if full and not isinstance(request.user, (BusinessOwner, StaffUser)):
            return Response({"detail": "The full category tree is for businesses and staff."}, status=403)
        return Response(build_tree(full=full))


class CategoryVisitView(APIView):
    """POST categories/<id>/visit/: public beacon, one visit counted per call, answers 204."""

    permission_classes = [AllowAny]
    throttle_scope = "category_visit"

    def post(self, request, pk):
        record_visit(generics.get_object_or_404(Category, pk=pk))
        return Response(status=204)


class CategoryDetailView(generics.RetrieveUpdateDestroyAPIView):
    """GET is public; PATCH/DELETE require categories.manage (roadmap: the
    staff Categories panel's edit + delete actions). DELETE is guarded
    against removing a category that still has listings — Listing.category is
    on_delete=PROTECT, so an unguarded delete would raise ProtectedError
    (a 500); this returns a clear 400 explaining how many listings block it.
    """

    queryset = Category.objects.all()
    serializer_class = CategorySerializer
    http_method_names = ["get", "patch", "delete"]

    def get_permissions(self):
        if self.request.method in ("PATCH", "DELETE"):
            return [HasRolePermission("categories.manage")]
        return [AllowAny()]

    def destroy(self, request, *args, **kwargs):
        category = self.get_object()
        listing_count = category.listings.count()
        event_count = category.events.count()
        child_count = category.children.count()
        if listing_count or event_count or child_count:
            parts = []
            if child_count:
                parts.append(f"{child_count} {'sub-category' if child_count == 1 else 'sub-categories'}")
            if listing_count:
                parts.append(f"{listing_count} {'listing' if listing_count == 1 else 'listings'}")
            if event_count:
                parts.append(f"{event_count} {'event' if event_count == 1 else 'events'}")
            return Response(
                {
                    "detail": (
                        f"{' and '.join(parts)} use this category. Reassign or "
                        "remove them before deleting it."
                    )
                },
                status=400,
            )
        return super().destroy(request, *args, **kwargs)


class ZoneListView(generics.ListCreateAPIView):
    queryset = Zone.objects.all()
    serializer_class = ZoneSerializer

    def get_permissions(self):
        if self.request.method == "POST":
            return [HasRolePermission("zones.manage")]
        return [AllowAny()]

    def perform_create(self, serializer):
        zone = serializer.save()
        activity_record(
            self.request.user, "zone.created", target=zone, summary=f"Added {zone.name}",
            after={"name": zone.name}, method="POST", request=self.request,
        )


def _zone_usage(zone):
    """What still depends on a zone: its listings, the businesses whose profile
    sits in it, and the scouts invited to work it."""
    from accounts.models import BusinessOwner, StaffUser
    from field.models import Prospect

    return {
        "listings": zone.listings.count(),
        "events": zone.events.count(),
        # Every business, rejected ones included: deleting the zone would blank their profile.
        "businesses": BusinessOwner.objects.filter(profile__zone=zone).count(),
        "prospects": Prospect.objects.filter(zone=zone).count(),
        "invited_scouts": StaffUser.areas.through.objects.filter(zone=zone).count(),
    }


class ZoneDetailView(generics.RetrieveUpdateDestroyAPIView):
    """PATCH renames, DELETE removes a zone nothing uses (409 otherwise)."""

    queryset = Zone.objects.all()
    serializer_class = ZoneSerializer
    http_method_names = ["get", "patch", "delete"]

    def get_permissions(self):
        if self.request.method in ("PATCH", "DELETE"):
            return [HasRolePermission("zones.manage")]
        return [AllowAny()]

    def perform_update(self, serializer):
        before = serializer.instance.name
        zone = serializer.save()
        if zone.name != before:
            activity_record(
                self.request.user, "zone.renamed", target=zone,
                summary=f"Renamed \u201c{before}\u201d to {zone.name}",
                before={"name": before}, after={"name": zone.name}, method="PATCH", request=self.request,
            )

    def destroy(self, request, *args, **kwargs):
        zone = self.get_object()
        usage = _zone_usage(zone)
        if any(usage.values()):
            parts = []
            if usage["listings"]:
                parts.append(f"{usage['listings']} listing{'s' if usage['listings'] != 1 else ''}")
            if usage["events"]:
                parts.append(f"{usage['events']} event{'s' if usage['events'] != 1 else ''}")
            if usage["prospects"]:
                parts.append(f"{usage['prospects']} prospect{'s' if usage['prospects'] != 1 else ''}")
            if usage["businesses"]:
                parts.append(f"{usage['businesses']} business{'es' if usage['businesses'] != 1 else ''}")
            if usage["invited_scouts"]:
                parts.append(f"{usage['invited_scouts']} scout invite{'s' if usage['invited_scouts'] != 1 else ''}")
            return Response(
                {"detail": f"{zone.name} is still used by {', '.join(parts)}. Rename it instead."},
                status=409,
            )
        name, pk = zone.name, zone.pk
        try:
            zone.delete()
        except ProtectedError:
            return Response({"detail": f"{name} is still used by listings or events. Rename it instead."}, status=409)
        activity_record(
            request.user, "zone.deleted", target_type="listings.zone", target_id=pk, target_label=name,
            summary=f"Deleted {name}", before={"name": name}, method="DELETE", request=request,
        )
        return Response(status=204)


class ZoneSummaryView(APIView):
    """GET /api/listings/zones/summary/ -- the Zones screen: every zone with its
    listing and business counts and the scouts working it (derived from the
    zones their businesses sit in, portfolio.areas), plus the recorded changes."""

    def get_permissions(self):
        return [HasRolePermission("zones.manage")]

    def get(self, request):
        from accounts.models import BusinessOwner, StaffUser
        from activity.models import ActivityEvent
        from portfolio.areas import scout_areas

        listing_counts = dict(
            Zone.objects.annotate(n=Count("listings")).values_list("pk", "n")
        )
        business_counts = {}
        for zone_id in (
            BusinessOwner.objects.filter(profile__zone__isnull=False)
            .exclude(kyc_status=BusinessOwner.REJECTED)
            .values_list("profile__zone_id", flat=True)
        ):
            business_counts[zone_id] = business_counts.get(zone_id, 0) + 1
        scouts = list(StaffUser.objects.filter(role__name="scout", is_active=True, is_suspended=False))
        by_zone = {}
        areas = scout_areas(scouts)
        for scout in scouts:
            for name in areas.get(scout.pk, []):
                by_zone.setdefault(name, []).append(scout.full_name)
        zones = [
            {
                "id": z.pk, "name": z.name,
                "listings": listing_counts.get(z.pk, 0),
                "businesses": business_counts.get(z.pk, 0),
                "scouts": sorted(by_zone.get(z.name, [])),
            }
            for z in Zone.objects.order_by("name")
        ]
        events = ActivityEvent.objects.filter(verb__in=("zone.created", "zone.renamed", "zone.deleted")).order_by("-id")[:10]
        changes = [
            {"id": e.pk, "what": e.summary, "who": e.actor_label, "at": e.occurred_at,
             "mine": e.actor_type == ActivityEvent.STAFF and e.actor_id == request.user.pk}
            for e in events
        ]
        return Response({"zones": zones, "changes": changes})


class ListingPagination(PageNumberPagination):
    page_size = 20


class PublicListingListView(generics.ListAPIView):
    serializer_class = PublicListingSerializer
    permission_classes = [AllowAny]
    pagination_class = ListingPagination
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ["name", "description"]
    ordering_fields = ["price_amount", "created_at"]

    def get_queryset(self):
        # Suspended and paused businesses' listings drop out of public browse
        # (listings.visibility) — enforced here rather than at suspend/pause
        # time, so unsuspending or paying reverses it at once. While
        # SOLD_OUT_HIDDEN_ENABLED is on, counted goods with nothing left drop
        # out too (spec §1 row 15, catalogue plan 6); an uncounted one
        # (stock_quantity null) and any service or stay stay, and the
        # listing's own page still opens.
        queryset = (
            Listing.objects.filter(status=Listing.PUBLISHED)
            .exclude(hidden_business_q())
            .exclude(sold_out_q())
            .select_related("category", "zone", "business_owner__profile")
            .prefetch_related("photos")
            .order_by("-created_at")
        )

        category_slug = self.request.query_params.get("category")
        if category_slug:
            queryset = queryset.filter(category__slug=category_slug)

        zone_name = self.request.query_params.get("zone")
        if zone_name:
            queryset = queryset.filter(zone__name=zone_name)

        queryset = queryset.annotate(price_effective=effective_price_expr())
        min_price = self.request.query_params.get("min_price")
        if min_price:
            queryset = queryset.filter(price_effective__gte=min_price)

        max_price = self.request.query_params.get("max_price")
        if max_price:
            queryset = queryset.filter(price_effective__lte=max_price)

        kind = self.request.query_params.get("kind")
        if kind:
            queryset = queryset.filter(category__kind=kind)

        verified = self.request.query_params.get("verified")
        if verified and verified.lower() in ("true", "1"):
            queryset = queryset.filter(business_owner__kyc_status=BusinessOwner.VERIFIED)

        queryset = queryset.annotate(is_promoted=Exists(self._promoted_subquery()))
        ctx = self._cart_guard()
        if ctx is not None:
            queryset = self._with_tiers(queryset, ctx)
        return _with_rating_annotations(queryset)

    def _cart_guard(self):
        """The cart guard context (cart.guard) for ?cart_tiers=1 from a customer whose cart has something in it, its
        near-shop map measured once here for every row; else None, and search is exactly as it was."""
        if not hasattr(self, "_guard_ctx"):
            self._guard_ctx = None
            if self.request.query_params.get("cart_tiers") in ("1", "true"):
                from accounts.models import Customer
                from cart import guard
                from cart.models import CartItem

                if isinstance(self.request.user, Customer):
                    lines = list(CartItem.objects.filter(cart__customer=self.request.user)
                                 .select_related("listing__business_owner__profile", "listing__category"))
                    if lines:
                        ctx = guard.context(lines)
                        guard.near(ctx)
                        self._guard_ctx = ctx
        return self._guard_ctx

    @staticmethod
    def _with_tiers(queryset, ctx):
        """cart_tier: 1 for the cart's businesses, 2 for businesses near them, else 3 (services, stays and events sort
        with tier 3 and show no tier); cart_km: the tier-2 distance, to put the nearest first."""
        from cart import guard

        whens = [When(~guard.deliverable_q(), then=Value(3))]
        if ctx["ids"]:
            whens.append(When(business_owner_id__in=sorted(ctx["ids"]), then=Value(1)))
        if ctx["near"]:
            whens.append(When(business_owner_id__in=sorted(ctx["near"]), then=Value(2)))
        km = [When(business_owner_id=oid, then=Value(v["km"])) for oid, v in sorted(ctx["near"].items())]
        return queryset.annotate(
            cart_tier=Case(*whens, default=Value(3), output_field=IntegerField()),
            cart_km=Case(*km, default=Value(None), output_field=FloatField()) if km else Value(None, output_field=FloatField()),
        )

    def get_serializer_class(self):
        return CartTieredListingSerializer if self._cart_guard() is not None else PublicListingSerializer

    def get_serializer_context(self):
        return {**super().get_serializer_context(), "cart_guard": self._cart_guard()}

    def _promoted_subquery(self):
        """Active Promotion rows that should push their listing to the front
        of the results (docs/BUSINESS_EVENTS_ROADMAP.md Phase 5): any active
        `featured` promotion, or an active `boost` promotion whose keywords
        match the current `search` query param (case-insensitive substring
        match — deliberately not a relevance-scored/tokenized match, per the
        roadmap's "don't over-engineer" note).
        """
        now = timezone.now()
        search = (self.request.query_params.get("search") or "").strip()

        boost_match = Q(kind=Promotion.BOOST, keywords__icontains=search) if search else Q(pk__in=[])
        return Promotion.objects.filter(
            listing=OuterRef("pk"), status=Promotion.ACTIVE, starts_at__lte=now, ends_at__gte=now,
        ).filter(Q(kind=Promotion.FEATURED) | boost_match)

    def filter_queryset(self, queryset):
        # SearchFilter/OrderingFilter (filter_backends) run inside
        # super().filter_queryset() and, when an explicit `?ordering=` param
        # is present, replace get_queryset()'s `.order_by("-created_at")`
        # entirely. Re-derive whatever ordering ended up in effect (explicit
        # or default) and prepend `-is_promoted` to it, rather than hardcoding
        # a fresh order_by call here that would silently drop the `ordering`
        # query param's effect.
        queryset = super().filter_queryset(queryset)
        existing_order = queryset.query.order_by or ("-created_at",)
        # Price ordering and filters use the price the customer pays (sale price while a real discount).
        existing_order = tuple(
            {"price_amount": "price_effective", "-price_amount": "-price_effective"}.get(term, term) for term in existing_order
        )
        if self._cart_guard() is not None:
            return queryset.order_by("cart_tier", F("cart_km").asc(nulls_last=True), "-is_promoted", *existing_order)
        return queryset.order_by("-is_promoted", *existing_order)


class PublicListingDetailView(generics.RetrieveAPIView):
    serializer_class = PublicListingSerializer
    permission_classes = [AllowAny]

    def get_queryset(self):
        return _with_rating_annotations(
            Listing.objects.filter(status=Listing.PUBLISHED).exclude(hidden_business_q())
        )


class RelatedListingsView(generics.ListAPIView):
    """GET /api/listings/{id}/related/ — public, unauthenticated. Other
    published listings sharing the anchor listing's category and/or zone,
    excluding the anchor itself, for the PDP's related-items rail
    (docs/BUSINESS_EVENTS_ROADMAP.md Phase 3). Not paginated — capped at a
    fixed small count instead.
    """

    RELATED_LIMIT = 8

    serializer_class = PublicListingSerializer
    permission_classes = [AllowAny]
    pagination_class = None

    def get_queryset(self):
        anchor = generics.get_object_or_404(
            Listing.objects.filter(status=Listing.PUBLISHED), pk=self.kwargs["pk"]
        )
        queryset = (
            Listing.objects.filter(status=Listing.PUBLISHED)
            .exclude(hidden_business_q())
            .exclude(sold_out_q())  # sold out: hidden like search while the switch is on (catalogue plan 6)
            .filter(Q(category=anchor.category) | Q(zone=anchor.zone))
            .exclude(pk=anchor.pk)
            .order_by("-created_at")
        )
        return _with_rating_annotations(queryset)[: self.RELATED_LIMIT]


class OwnerListingCreateListView(generics.ListCreateAPIView):
    serializer_class = OwnerListingSerializer
    permission_classes = [IsAuthenticated, IsBusinessOwner]

    def get_queryset(self):
        return Listing.objects.filter(business_owner=self.request.user)


class OwnerListingUpdateView(generics.UpdateAPIView):
    queryset = Listing.objects.all()
    serializer_class = OwnerListingSerializer
    permission_classes = [IsAuthenticated, IsListingOwner]
    http_method_names = ["patch"]


class ListingManageView(generics.UpdateAPIView):
    """PATCH /api/listings/mine/{id}/manage/ — light edit of a listing's
    operational fields (business item 2), allowed on a published listing
    without re-moderation. See OwnerListingManageSerializer for what's in vs
    out of scope. Status is never touched here.
    """

    queryset = Listing.objects.all()
    serializer_class = OwnerListingManageSerializer
    permission_classes = [IsAuthenticated, IsListingOwner]
    http_method_names = ["patch"]


class ListingSponsoredView(APIView):
    """POST /api/listings/<id>/sponsored/ {"sponsored": bool} - flag or unflag a listing as sponsored so it appears
    in Deals without a discount (Plan M1). Marketing, operations and super admin (`deals.manage`)."""

    def get_permissions(self):
        return [HasRolePermission("deals.manage")]

    def post(self, request, pk):
        flag = request.data.get("sponsored") if isinstance(request.data, dict) else None
        if not isinstance(flag, bool):
            return Response({"sponsored": "Send true or false."}, status=400)
        listing = generics.get_object_or_404(Listing, pk=pk)
        listing.sponsored = flag
        listing.sponsored_by = request.user if flag else None
        listing.save(update_fields=["sponsored", "sponsored_by", "updated_at"])
        return Response({"id": listing.pk, "sponsored": listing.sponsored})


class ListingRestockView(APIView):
    """POST /api/listings/mine/{id}/restock/ — a business owner sets a
    listing's stock count (Wave F). Unlike the general edit endpoint (which
    blocks editing a *published* listing), restock deliberately works on a
    published, live listing — that's the whole point of restocking, and it's
    the one stock mutation an owner makes routinely.

    Body: {"stock_quantity": <int>} sets an absolute count, or {"add": <int>}
    adds to the current count. Passing "add" on an untracked listing
    (stock_quantity=None) starts tracking it from that quantity.
    """

    permission_classes = [IsAuthenticated, IsListingOwner]

    def post(self, request, pk):
        listing = generics.get_object_or_404(Listing, pk=pk)
        self.check_object_permissions(request, listing)

        if "stock_quantity" in request.data:
            try:
                value = int(request.data["stock_quantity"])
            except (TypeError, ValueError):
                return Response({"stock_quantity": "Must be a whole number."}, status=400)
            if value < 0:
                return Response({"stock_quantity": "Cannot be negative."}, status=400)
            listing.stock_quantity = value
        elif "add" in request.data:
            try:
                add = int(request.data["add"])
            except (TypeError, ValueError):
                return Response({"add": "Must be a whole number."}, status=400)
            if add <= 0:
                return Response({"add": "Must be greater than zero."}, status=400)
            listing.stock_quantity = (listing.stock_quantity or 0) + add
        else:
            return Response(
                {"detail": "Provide either stock_quantity (absolute) or add (increment)."},
                status=400,
            )

        listing.save(update_fields=["stock_quantity"])
        return Response({"id": listing.id, "stock_quantity": listing.stock_quantity})


class ListingSubmitView(APIView):
    permission_classes = [IsAuthenticated, IsListingOwner]

    def post(self, request, pk):
        listing = generics.get_object_or_404(Listing, pk=pk)
        self.check_object_permissions(request, listing)
        if listing.status not in (Listing.DRAFT, Listing.REJECTED):
            return Response(
                {"status": "Only draft or rejected listings can be submitted for review."}, status=400
            )
        listing.status = Listing.PENDING_REVIEW
        listing.save(update_fields=["status"])
        notify_staff_role(
            "listings.moderate", "listing_needs_moderation", "New listing for review",
            body=f"“{listing.name}” has been submitted for moderation.",
            link="moderation", icon="📋",
        )
        return Response({"id": listing.id, "status": listing.status})


# Simulated per-day GHS pricing for a promotion purchase (roadmap Phase 5
# doesn't specify a figure, and no PromotionPlan/pricing model exists
# anywhere in the codebase — mirrors how SubscriptionPlan carries its own
# static prices rather than deriving them). `featured` is priced above
# `boost` since it always ranks first regardless of search term, while
# `boost` only wins for matching searches.
PROMOTION_DAILY_RATES = {
    Promotion.FEATURED: Decimal("5.00"),
    Promotion.BOOST: Decimal("3.00"),
}


class ListingPromoteView(APIView):
    """POST /api/listings/{id}/promote/ — a business owner pays to promote
    one of their own listings (roadmap Phase 5), distinct from subscription
    tier. Mirrors OrderCheckoutView/HeroExtendView's simulated-payment
    pattern: the caller is expected to have already "paid" via the
    frontend's MoMoModal-style simulated flow, and this endpoint persists
    the resulting Promotion + billing.Transaction in one atomic write.

    Body: {"kind": "featured"|"boost", "days": <int>, "keywords": "<string,
    boost only>"}. Rejects (400) if the listing isn't published, or if it
    already has a pending or active Promotion of the same kind (no stacking two
    simultaneous `featured` — or two `boost` — promotions on one listing).

    The promotion is created ``pending`` (bug fix 7): the owner has paid, but it
    does not affect ranking until a staffer with promotions.manage approves it
    (PromotionApproveView), at which point its live window is reset to start
    then. The paid days are preserved as the starts_at..ends_at span here and
    re-based to "now" at approval, so approval lag doesn't eat the paid window.
    """

    permission_classes = [IsAuthenticated, IsListingOwner]

    def post(self, request, pk):
        listing = generics.get_object_or_404(Listing, pk=pk)
        self.check_object_permissions(request, listing)

        serializer = PromotionPurchaseSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        kind = serializer.validated_data["kind"]
        days = serializer.validated_data["days"]
        keywords = serializer.validated_data["keywords"]

        if listing.status != Listing.PUBLISHED:
            return Response(
                {"detail": "Only a published listing can be promoted."}, status=400
            )

        now = timezone.now()
        # A pending OR live promotion of the same kind blocks a new purchase.
        has_outstanding_same_kind = Promotion.objects.filter(
            listing=listing, kind=kind,
        ).filter(
            Q(status=Promotion.PENDING)
            | Q(status=Promotion.ACTIVE, ends_at__gte=now)
        ).exists()
        if has_outstanding_same_kind:
            return Response(
                {
                    "detail": (
                        f"This listing already has a pending or active {kind} "
                        "promotion. Wait for it to finish before purchasing another."
                    )
                },
                status=400,
            )

        amount = PROMOTION_DAILY_RATES[kind] * days
        with db_transaction.atomic():
            promotion = Promotion.objects.create(
                listing=listing,
                kind=kind,
                starts_at=now,
                ends_at=now + timedelta(days=days),
                keywords=keywords if kind == Promotion.BOOST else "",
                amount_paid=amount,
                status=Promotion.PENDING,
            )
            Transaction.objects.create(
                business_owner=request.user,
                amount=amount,
                purpose=f"{kind.capitalize()} promotion for listing #{listing.id} ({days} days)",
                status=Transaction.SUCCESS,
                reference=f"AH-PROMO-{promotion.id}-{get_random_string(8).upper()}",
            )
        return Response(PromotionSerializer(promotion).data, status=201)


# Staff moderation-queue restructuring — the canonical three-state queue
# convention (see accounts.views.KYC_STATUS_MAP): one ListAPIView serves
# Pending/Approved/Rejected via a `?status=` query param (default "pending"),
# on the existing `.../pending/` URL. For listings "approved" == published.
LISTING_STATUS_MAP = {
    "pending": Listing.PENDING_REVIEW,
    "approved": Listing.PUBLISHED,
    "rejected": Listing.REJECTED,
}


class ModerationPendingQueueView(generics.ListAPIView):
    serializer_class = ModerationListingSerializer

    def get_permissions(self):
        return [HasRolePermission("listings.moderate")]

    def get_queryset(self):
        tab = self.request.query_params.get("status", "pending")
        listing_status = LISTING_STATUS_MAP.get(tab, Listing.PENDING_REVIEW)
        queryset = Listing.objects.filter(status=listing_status).select_related(
            "business_owner__subscription__plan", "reviewed_by",
        )
        # Item 2: group by owning business so a reviewer sees a business's
        # listings together. Within a business, pending is oldest-first (work
        # queue); approved/rejected are most-recently-actioned first (history).
        if listing_status == Listing.PENDING_REVIEW:
            return queryset.order_by("business_owner__full_name", "created_at")
        return queryset.order_by("business_owner__full_name", "-reviewed_at", "-created_at")


class ModerationStatsView(APIView):
    """GET /api/listings/moderation/stats/ — listings published and rejected
    since Monday (the queue's "This week" line)."""

    def get_permissions(self):
        return [HasRolePermission("listings.moderate")]

    def get(self, request):
        monday = timezone.localtime().replace(hour=0, minute=0, second=0, microsecond=0)
        monday -= timedelta(days=monday.weekday())
        week = Listing.objects.filter(reviewed_at__gte=monday)
        return Response({
            "week_published": week.filter(status=Listing.PUBLISHED).count(),
            "week_rejected": week.filter(status=Listing.REJECTED).count(),
        })


class ModerationListingDetailView(generics.RetrieveAPIView):
    queryset = Listing.objects.all()
    serializer_class = ModerationListingSerializer

    def get_permissions(self):
        return [HasRolePermission("listings.moderate")]


class ModerationApproveView(APIView):
    def get_permissions(self):
        return [HasRolePermission("listings.moderate")]

    def post(self, request, pk):
        listing = generics.get_object_or_404(Listing, pk=pk)
        if listing.business_owner.kyc_status != BusinessOwner.VERIFIED:
            return Response(
                {"detail": "Cannot publish a listing whose owner is not KYC-verified."}, status=400
            )
        listing.status = Listing.PUBLISHED
        listing.rejection_reason = None
        listing.reviewed_by = request.user
        listing.reviewed_at = timezone.now()
        listing.save(update_fields=["status", "rejection_reason", "reviewed_by", "reviewed_at"])
        notify_business_owner(
            listing.business_owner, "listing_approved", "Listing published",
            body=f"“{listing.name}” is now live on AshantiHub.",
            link="/business-dashboard", icon="✅",
        )
        return Response({"id": listing.id, "status": listing.status})


class ModerationRejectView(APIView):
    def get_permissions(self):
        return [HasRolePermission("listings.moderate")]

    def post(self, request, pk):
        reason = (request.data.get("reason") or "").strip()
        if not reason:
            return Response({"reason": "A rejection reason is required."}, status=400)
        listing = generics.get_object_or_404(Listing, pk=pk)
        listing.status = Listing.REJECTED
        listing.rejection_reason = reason
        listing.reviewed_by = request.user
        listing.reviewed_at = timezone.now()
        listing.save(update_fields=["status", "rejection_reason", "reviewed_by", "reviewed_at"])
        notify_business_owner(
            listing.business_owner, "listing_rejected", "Listing needs changes",
            body=f"“{listing.name}” was rejected: {reason}",
            link="/business-dashboard", icon="⚠️",
        )
        return Response({"id": listing.id, "status": listing.status})


class ModerationReReviewView(APIView):
    """POST /api/listings/moderation/{id}/re-review/ — the canonical re-review
    action (staff moderation-queue restructuring): move a REJECTED listing back
    to PENDING_REVIEW, clearing the rejection reason and approver attribution,
    and re-notify staff who can moderate listings. Gated by listings.moderate.
    """

    def get_permissions(self):
        return [HasRolePermission("listings.moderate")]

    def post(self, request, pk):
        listing = generics.get_object_or_404(Listing, pk=pk)
        if listing.status != Listing.REJECTED:
            return Response(
                {"detail": "Only a rejected listing can be sent back for re-review."}, status=400
            )
        listing.status = Listing.PENDING_REVIEW
        listing.rejection_reason = None
        listing.reviewed_by = None
        listing.reviewed_at = None
        listing.save(update_fields=["status", "rejection_reason", "reviewed_by", "reviewed_at"])
        notify_staff_role(
            "listings.moderate", "listing_needs_moderation", "Listing re-opened for review",
            body=f"“{listing.name}” has been re-opened and needs moderation again.",
            link="moderation", icon="📋",
        )
        return Response({"id": listing.id, "status": listing.status})


def _hero_days_for(business_owner):
    """The business's current plan's hero_days entitlement, i.e. the visibility
    window an approved hero-media submission gets. 0 if the business has no
    active subscription — mirrors how Subscription is an optional OneToOne on
    BusinessOwner (see billing.SubscriptionMeView's "no subscription yet"
    handling).
    """
    subscription = getattr(business_owner, "subscription", None)
    if subscription is None:
        return 0
    return subscription.plan.hero_days


def _hero_slots_for(business_owner):
    """How many hero-media submissions this business may have live/pending at
    once — their current plan's hero_slots. Defaults to 1 with no subscription,
    so a business can always feature at least one listing.
    """
    subscription = getattr(business_owner, "subscription", None)
    if subscription is None:
        return 1
    return subscription.plan.hero_slots


class HeroSubmitView(APIView):
    """POST /api/hero/submit/ — a business owner submits one of their existing
    ListingPhoto gallery items + a caption for hero consideration (roadmap
    Phase 2's "Submit for Hero" action: reuses the ListingPhoto gallery
    already on Listing rather than a fresh upload).

    The image bytes are copied into HeroMediaSubmission.media (a new file),
    not referenced/shared with the original ListingPhoto — the simplest
    approach that keeps the two records independent (e.g. the business owner
    deleting the original gallery photo later can't silently break an
    in-flight or already-live hero submission).

    Only one submission may be outstanding (pending, or approved-and-not-yet-
    expired) per business at a time, per the roadmap's "just one media will
    be showcased" rule — enforced here at creation time.
    """

    permission_classes = [IsAuthenticated, IsBusinessOwner, IsListingPhotoOwner]

    def post(self, request):
        serializer = HeroSubmitSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        listing_photo = generics.get_object_or_404(
            ListingPhoto, pk=serializer.validated_data["listing_photo"]
        )
        self.check_object_permissions(request, listing_photo)

        now = timezone.now()
        # Outstanding = pending, or approved-and-not-yet-expired.
        outstanding = HeroMediaSubmission.objects.filter(business_owner=request.user).filter(
            Q(status=HeroMediaSubmission.PENDING)
            | Q(status=HeroMediaSubmission.APPROVED, expires_at__gt=now)
        )
        # One hero per listing at a time.
        if outstanding.filter(listing=listing_photo.listing_id).exists():
            return Response(
                {"detail": "This listing already has a pending or active hero submission."},
                status=400,
            )
        # Up to the subscription tier's hero_slots concurrent submissions.
        slots = _hero_slots_for(request.user)
        if outstanding.count() >= slots:
            return Response(
                {
                    "detail": (
                        f"Your plan allows {slots} hero submission{'s' if slots != 1 else ''} "
                        "at a time. Upgrade your subscription to feature more listings."
                    )
                },
                status=400,
            )

        submission = HeroMediaSubmission(
            business_owner=request.user,
            listing=listing_photo.listing,
            media_type=HeroMediaSubmission.IMAGE,
            caption=serializer.validated_data["caption"],
        )
        listing_photo.image.open("rb")
        try:
            submission.media.save(
                os.path.basename(listing_photo.image.name),
                ContentFile(listing_photo.image.read()),
                save=False,
            )
        finally:
            listing_photo.image.close()
        submission.save()
        notify_staff_role(
            "hero_media.approve", "hero_needs_approval", "New hero submission",
            body=f"{request.user.full_name} submitted hero media for review.",
            link="hero", icon="🌟",
        )
        return Response(HeroMediaModerationSerializer(submission).data, status=201)


class HeroMineView(APIView):
    """GET /api/hero/mine/ — the calling business owner's most relevant
    HeroMediaSubmission, so the frontend can recover submission status after
    a page reload (rather than only learning it from the response of
    POST /api/hero/submit/ or /extend/).

    Priority: the outstanding submission (status=pending, or status=approved
    and not yet expired) if one exists; otherwise the most recent submission
    of any status (e.g. an expired-approved or rejected one), so a business
    owner can still see "what happened last time"; otherwise nothing at all.

    "Nothing at all" is a 200 with `{}`, not a 404 — mirrors
    billing.SubscriptionMeView's "no subscription yet" convention: DRF's
    JSONRenderer turns `Response(None)` into an empty (zero-length) body
    rather than JSON `null`, which would break `response.json()` on the
    frontend. Absence of an `id` field is the "nothing yet" signal.
    """

    permission_classes = [IsAuthenticated, IsBusinessOwner]

    def get(self, request):
        now = timezone.now()
        submission = (
            HeroMediaSubmission.objects.filter(business_owner=request.user)
            .filter(
                Q(status=HeroMediaSubmission.PENDING)
                | Q(status=HeroMediaSubmission.APPROVED, expires_at__gt=now)
            )
            .order_by("-submitted_at")
            .first()
        )
        if submission is None:
            submission = (
                HeroMediaSubmission.objects.filter(business_owner=request.user)
                .order_by("-submitted_at")
                .first()
            )
        if submission is None:
            return Response({})
        return Response(HeroMediaModerationSerializer(submission).data)


HERO_STATUS_MAP = {
    "pending": HeroMediaSubmission.PENDING,
    "approved": HeroMediaSubmission.APPROVED,
    "rejected": HeroMediaSubmission.REJECTED,
}


class HeroPendingQueueView(generics.ListAPIView):
    """Clones ModerationPendingQueueView's shape for hero-media submissions,
    including the `?status=` three-state param (staff moderation-queue
    restructuring). Pending rows carry the server-computed `checks`."""

    serializer_class = HeroMediaStaffSerializer

    def get_permissions(self):
        return [HasRolePermission("hero_media.approve")]

    def get_queryset(self):
        tab = self.request.query_params.get("status", "pending")
        hero_status = HERO_STATUS_MAP.get(tab, HeroMediaSubmission.PENDING)
        queryset = HeroMediaSubmission.objects.filter(status=hero_status).select_related(
            "business_owner__subscription__plan", "listing", "reviewed_by__role",
        ).prefetch_related("listing__photos")
        if hero_status == HeroMediaSubmission.PENDING:
            return queryset.order_by("submitted_at")
        return queryset.order_by("-reviewed_at", "-submitted_at")


class HeroMediaDetailView(generics.RetrieveAPIView):
    queryset = HeroMediaSubmission.objects.all()
    serializer_class = HeroMediaStaffSerializer

    def get_permissions(self):
        return [HasRolePermission("hero_media.approve")]


class HeroApproveView(APIView):
    def get_permissions(self):
        return [HasRolePermission("hero_media.approve")]

    def post(self, request, pk):
        submission = generics.get_object_or_404(HeroMediaSubmission, pk=pk)
        # The no-direct-contact rule is enforced here, not only on the screen.
        blocked = blocking_failures(hero_checks(submission))
        if blocked:
            return Response(
                {"detail": CONTACT_DETAILS_MESSAGE, "code": "contact_details_in_caption", "checks": blocked},
                status=400,
            )
        now = timezone.now()
        hero_days = _hero_days_for(submission.business_owner)
        submission.status = HeroMediaSubmission.APPROVED
        submission.rejection_reason = None
        submission.approved_at = now
        submission.expires_at = now + timedelta(days=hero_days)
        submission.reviewed_by = request.user
        submission.reviewed_at = now
        submission.save(
            update_fields=[
                "status", "rejection_reason", "approved_at", "expires_at",
                "reviewed_by", "reviewed_at",
            ]
        )
        notify_business_owner(
            submission.business_owner, "hero_approved", "Hero media approved",
            body="Your hero submission is now featured on the Business homepage.",
            link="/business-dashboard", icon="🌟",
        )
        return Response(
            {"id": submission.id, "status": submission.status, "expires_at": submission.expires_at}
        )


class HeroRejectView(APIView):
    def get_permissions(self):
        return [HasRolePermission("hero_media.approve")]

    def post(self, request, pk):
        reason = (request.data.get("reason") or "").strip()
        if not reason:
            return Response({"reason": "A rejection reason is required."}, status=400)
        submission = generics.get_object_or_404(HeroMediaSubmission, pk=pk)
        submission.status = HeroMediaSubmission.REJECTED
        submission.rejection_reason = reason
        submission.reviewed_by = request.user
        submission.reviewed_at = timezone.now()
        submission.save(update_fields=["status", "rejection_reason", "reviewed_by", "reviewed_at"])
        notify_business_owner(
            submission.business_owner, "hero_rejected", "Hero media not approved",
            body=f"Your hero submission was rejected: {reason}",
            link="/business-dashboard", icon="⚠️",
        )
        return Response({"id": submission.id, "status": submission.status})


class HeroMyDecisionsView(generics.ListAPIView):
    """GET /api/listings/hero/my-decisions/ — the calling staff member's own
    most recent hero decisions (approved or rejected), newest first (canvas 14,
    "recent decisions by you")."""

    serializer_class = HeroMediaStaffSerializer
    pagination_class = None
    LIMIT = 10

    def get_permissions(self):
        return [HasRolePermission("hero_media.approve")]

    def get_queryset(self):
        return (
            HeroMediaSubmission.objects.filter(
                reviewed_by=self.request.user,
                status__in=[HeroMediaSubmission.APPROVED, HeroMediaSubmission.REJECTED],
            )
            .select_related("business_owner", "listing", "reviewed_by__role")
            .order_by("-reviewed_at", "-id")[: self.LIMIT]
        )


class HeroReReviewView(APIView):
    """POST /api/listings/hero/{id}/re-review/ — the canonical re-review action
    (staff moderation-queue restructuring): move a REJECTED hero submission
    back to PENDING, clearing the rejection reason and approver attribution,
    and re-notify staff who can approve hero media. Gated by hero_media.approve.
    """

    def get_permissions(self):
        return [HasRolePermission("hero_media.approve")]

    def post(self, request, pk):
        submission = generics.get_object_or_404(HeroMediaSubmission, pk=pk)
        if submission.status != HeroMediaSubmission.REJECTED:
            return Response(
                {"detail": "Only a rejected hero submission can be sent back for re-review."},
                status=400,
            )
        submission.status = HeroMediaSubmission.PENDING
        submission.rejection_reason = None
        submission.reviewed_by = None
        submission.reviewed_at = None
        submission.save(update_fields=["status", "rejection_reason", "reviewed_by", "reviewed_at"])
        notify_staff_role(
            "hero_media.approve", "hero_needs_approval", "Hero submission re-opened",
            body=f"{submission.business_owner.full_name}'s hero submission has been re-opened and needs review again.",
            link="hero", icon="🌟",
        )
        return Response({"id": submission.id, "status": submission.status})


class HeroActiveListView(generics.ListAPIView):
    """GET /api/hero/active/ — public, unauthenticated feed for the hero
    slider: approved submissions that haven't expired yet, most-recently-
    approved first.
    """

    serializer_class = HeroActiveSerializer
    permission_classes = [AllowAny]

    def get_queryset(self):
        return HeroMediaSubmission.objects.filter(
            status=HeroMediaSubmission.APPROVED, expires_at__gt=timezone.now()
        ).order_by("-approved_at")


class HeroExtendSerializer(serializers.Serializer):
    days = serializers.IntegerField(min_value=1)


class HeroExtendView(APIView):
    """POST /api/hero/{id}/extend/ — simulated-payment style, mirrors
    billing.SubscriptionMeView/TransactionMineListCreateView: the caller is
    expected to have already "paid" via the frontend's MoMoModal-style
    simulated flow, and this endpoint just persists the resulting state.
    """

    permission_classes = [IsAuthenticated, IsHeroMediaOwner]

    def post(self, request, pk):
        submission = generics.get_object_or_404(HeroMediaSubmission, pk=pk)
        self.check_object_permissions(request, submission)

        serializer = HeroExtendSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        days = serializer.validated_data["days"]

        # An extension only tops up an already-live grant. A submission that
        # was never approved, or one whose grant has already lapsed, must be
        # resubmitted/re-approved rather than "revived" via extension —
        # mirrors ListingSubmitView's DRAFT/REJECTED-only guard in spirit
        # (a narrow, explicit allowed-state check rather than a silent no-op).
        if submission.status != HeroMediaSubmission.APPROVED:
            return Response(
                {"detail": "Only an approved hero submission can be extended."}, status=400
            )
        if submission.expires_at is None or submission.expires_at <= timezone.now():
            return Response(
                {"detail": "This hero submission has already expired and cannot be extended."},
                status=400,
            )

        submission.extended_days += days
        submission.expires_at += timedelta(days=days)
        submission.save(update_fields=["extended_days", "expires_at"])
        return Response(
            {
                "id": submission.id,
                "extended_days": submission.extended_days,
                "expires_at": submission.expires_at,
            }
        )


# ─── Promotions management (staff) ────────────────────────────────────────
# A purchased promotion is now moderated before it ranks (bug fix 7): the
# queue exposes Pending/Active/Rejected/Expired/Cancelled tabs. A pending
# promotion is paid-but-not-yet-approved and does NOT affect ranking.
#
# "Expired" is derived from the time window, never read off `status`: as
# Promotion's own docstring explains, nothing in this app transitions a row to
# status="expired", so a finished promotion still reads status="active". The
# legacy EXPIRED value is still matched so any hand-set row shows up rather
# than vanishing from every tab.
def _promotions_for_tab(tab):
    now = timezone.now()
    queryset = Promotion.objects.select_related("listing", "listing__business_owner")
    if tab == "pending":
        return queryset.filter(status=Promotion.PENDING).order_by("created_at")
    if tab == "rejected":
        return queryset.filter(status=Promotion.REJECTED).order_by("-created_at")
    if tab == "cancelled":
        return queryset.filter(status=Promotion.CANCELLED).order_by("-starts_at")
    if tab == "expired":
        return queryset.filter(
            Q(status=Promotion.ACTIVE, ends_at__lt=now) | Q(status=Promotion.EXPIRED)
        ).order_by("-ends_at")
    # Active — approved and not yet finished. Includes a promotion whose
    # starts_at is still in the future, which is live-but-not-yet-running.
    return queryset.filter(status=Promotion.ACTIVE, ends_at__gte=now).order_by("-starts_at")


class PromotionAdminListView(generics.ListAPIView):
    """GET /api/listings/promotions/?status=pending|active|rejected|expired|
    cancelled — staff-only (promotions.manage). Before this, `promotions.manage`
    gated a nav tab with no backend view behind it at all.
    """

    serializer_class = PromotionAdminSerializer

    def get_permissions(self):
        return [HasRolePermission("promotions.manage")]

    def get_queryset(self):
        return _promotions_for_tab(self.request.query_params.get("status", "pending")).select_related(
            "listing__business_owner__subscription__plan",
        )

    def get_serializer_context(self):
        context = super().get_serializer_context()
        if self.request.query_params.get("status", "pending") == "pending":
            # One query for every open fraud case on the page's owners (no N+1).
            owners = {p.listing.business_owner_id for p in self.get_queryset()}
            context["fraud_flags"] = open_fraud_flags(owners)
        return context


class PromotionApproveView(APIView):
    """POST /api/listings/promotions/{id}/approve/ — staff-only
    (promotions.manage). Approves a pending promotion so it starts affecting
    ranking, re-basing its paid window to start now (so approval lag doesn't
    eat the paid days the owner purchased).
    """

    def get_permissions(self):
        return [HasRolePermission("promotions.manage")]

    def post(self, request, pk):
        with db_transaction.atomic():
            promotion = generics.get_object_or_404(
                Promotion.objects.select_for_update(of=("self",)).select_related("listing__business_owner"), pk=pk
            )
            if promotion.status != Promotion.PENDING:
                return Response(
                    {"detail": "Only a pending promotion can be approved."}, status=400
                )
            # An open fraud case on the owner holds the promotion until it is decided.
            flag = open_fraud_flag(promotion.listing.business_owner_id)
            if flag is not None:
                return Response(
                    {"detail": fraud_hold_message(flag), "code": "fraud_hold"}, status=409
                )
            return self._approve(promotion)

    def _approve(self, promotion):
        now = timezone.now()
        duration = promotion.ends_at - promotion.starts_at
        promotion.starts_at = now
        promotion.ends_at = now + duration
        promotion.status = Promotion.ACTIVE
        promotion.rejection_reason = ""
        promotion.save(update_fields=["starts_at", "ends_at", "status", "rejection_reason"])
        return Response(PromotionAdminSerializer(promotion).data)


class PromotionRejectView(APIView):
    """POST /api/listings/promotions/{id}/reject/ {reason} — staff-only
    (promotions.manage). Rejects a pending promotion (it never ranks).

    Refunds are out of scope: rejection stops the promotion going live, it does
    not reverse the amount_paid. There is no refund path here to pretend otherwise.
    """

    def get_permissions(self):
        return [HasRolePermission("promotions.manage")]

    def post(self, request, pk):
        promotion = generics.get_object_or_404(Promotion, pk=pk)
        if promotion.status != Promotion.PENDING:
            return Response(
                {"detail": "Only a pending promotion can be rejected."}, status=400
            )
        promotion.status = Promotion.REJECTED
        promotion.rejection_reason = (request.data.get("reason") or "").strip()
        promotion.save(update_fields=["status", "rejection_reason"])
        return Response(PromotionAdminSerializer(promotion).data)


class PromotionCancelView(APIView):
    """POST /api/listings/promotions/{id}/cancel/ — staff-only
    (promotions.manage). Stops a promotion early; the model reserved
    `cancelled` for exactly this.

    Refunds are out of scope: cancelling stops the ranking boost, it does not
    reverse the amount_paid. There is no refund path here to pretend otherwise.
    """

    def get_permissions(self):
        return [HasRolePermission("promotions.manage")]

    def post(self, request, pk):
        promotion = generics.get_object_or_404(Promotion, pk=pk)
        if promotion.status != Promotion.ACTIVE:
            return Response(
                {"detail": "Only an active promotion can be cancelled."}, status=400
            )
        if promotion.ends_at < timezone.now():
            return Response(
                {"detail": "This promotion has already finished."}, status=400
            )
        promotion.status = Promotion.CANCELLED
        promotion.save(update_fields=["status"])
        return Response(PromotionAdminSerializer(promotion).data)
