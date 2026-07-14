import os
from datetime import timedelta

from django.core.files.base import ContentFile
from django.db.models import Q
from django.utils import timezone
from rest_framework import filters, generics, serializers
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import BusinessOwner
from accounts.permissions import HasRolePermission
from accounts.views import IsBusinessOwner

from .models import Category, HeroMediaSubmission, Listing, ListingPhoto, Zone
from .permissions import IsHeroMediaOwner, IsListingOwner, IsListingPhotoOwner
from .serializers import (
    CategorySerializer,
    HeroActiveSerializer,
    HeroMediaModerationSerializer,
    HeroSubmitSerializer,
    ListingPhotoSerializer,
    ModerationListingSerializer,
    OwnerListingSerializer,
    PublicListingSerializer,
    ZoneSerializer,
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

    def get_permissions(self):
        if self.request.method == "POST":
            return [HasRolePermission("categories.manage")]
        return [AllowAny()]


class ZoneListView(generics.ListCreateAPIView):
    queryset = Zone.objects.all()
    serializer_class = ZoneSerializer

    def get_permissions(self):
        if self.request.method == "POST":
            return [HasRolePermission("zones.manage")]
        return [AllowAny()]


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
        queryset = Listing.objects.filter(status=Listing.PUBLISHED).order_by("-created_at")

        category_slug = self.request.query_params.get("category")
        if category_slug:
            queryset = queryset.filter(category__slug=category_slug)

        zone_name = self.request.query_params.get("zone")
        if zone_name:
            queryset = queryset.filter(zone__name=zone_name)

        min_price = self.request.query_params.get("min_price")
        if min_price:
            queryset = queryset.filter(price_amount__gte=min_price)

        max_price = self.request.query_params.get("max_price")
        if max_price:
            queryset = queryset.filter(price_amount__lte=max_price)

        kind = self.request.query_params.get("kind")
        if kind:
            queryset = queryset.filter(category__kind=kind)

        verified = self.request.query_params.get("verified")
        if verified and verified.lower() in ("true", "1"):
            queryset = queryset.filter(business_owner__kyc_status=BusinessOwner.VERIFIED)

        return queryset


class PublicListingDetailView(generics.RetrieveAPIView):
    queryset = Listing.objects.filter(status=Listing.PUBLISHED)
    serializer_class = PublicListingSerializer
    permission_classes = [AllowAny]


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
        return (
            Listing.objects.filter(status=Listing.PUBLISHED)
            .filter(Q(category=anchor.category) | Q(zone=anchor.zone))
            .exclude(pk=anchor.pk)
            .order_by("-created_at")[: self.RELATED_LIMIT]
        )


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
        return Response({"id": listing.id, "status": listing.status})


class ModerationPendingQueueView(generics.ListAPIView):
    serializer_class = ModerationListingSerializer
    queryset = Listing.objects.filter(status=Listing.PENDING_REVIEW).order_by("created_at")

    def get_permissions(self):
        return [HasRolePermission("listings.moderate")]


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
        listing.save(update_fields=["status", "rejection_reason"])
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
        listing.save(update_fields=["status", "rejection_reason"])
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
        has_outstanding = HeroMediaSubmission.objects.filter(business_owner=request.user).filter(
            Q(status=HeroMediaSubmission.PENDING)
            | Q(status=HeroMediaSubmission.APPROVED, expires_at__gt=now)
        ).exists()
        if has_outstanding:
            return Response(
                {
                    "detail": (
                        "You already have a pending or active hero submission. "
                        "Only one hero submission may be outstanding at a time."
                    )
                },
                status=400,
            )

        submission = HeroMediaSubmission(
            business_owner=request.user,
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


class HeroPendingQueueView(generics.ListAPIView):
    """Clones ModerationPendingQueueView's shape for hero-media submissions."""

    serializer_class = HeroMediaModerationSerializer
    queryset = HeroMediaSubmission.objects.filter(status=HeroMediaSubmission.PENDING).order_by(
        "submitted_at"
    )

    def get_permissions(self):
        return [HasRolePermission("hero_media.approve")]


class HeroMediaDetailView(generics.RetrieveAPIView):
    queryset = HeroMediaSubmission.objects.all()
    serializer_class = HeroMediaModerationSerializer

    def get_permissions(self):
        return [HasRolePermission("hero_media.approve")]


class HeroApproveView(APIView):
    def get_permissions(self):
        return [HasRolePermission("hero_media.approve")]

    def post(self, request, pk):
        submission = generics.get_object_or_404(HeroMediaSubmission, pk=pk)
        now = timezone.now()
        hero_days = _hero_days_for(submission.business_owner)
        submission.status = HeroMediaSubmission.APPROVED
        submission.rejection_reason = None
        submission.approved_at = now
        submission.expires_at = now + timedelta(days=hero_days)
        submission.save(
            update_fields=["status", "rejection_reason", "approved_at", "expires_at"]
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
        submission.save(update_fields=["status", "rejection_reason"])
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
