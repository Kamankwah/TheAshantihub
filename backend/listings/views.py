from rest_framework import filters, generics
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import BusinessOwner
from accounts.permissions import HasRolePermission
from accounts.views import IsBusinessOwner

from .models import Category, Listing, ListingPhoto, Zone
from .permissions import IsListingOwner
from .serializers import (
    CategorySerializer,
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


class PublicListingListView(generics.ListAPIView):
    serializer_class = PublicListingSerializer
    permission_classes = [AllowAny]
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ["name", "description"]
    ordering_fields = ["price_amount", "created_at"]

    def get_queryset(self):
        queryset = Listing.objects.filter(status=Listing.PUBLISHED)

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

        return queryset


class PublicListingDetailView(generics.RetrieveAPIView):
    queryset = Listing.objects.filter(status=Listing.PUBLISHED)
    serializer_class = PublicListingSerializer
    permission_classes = [AllowAny]


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
