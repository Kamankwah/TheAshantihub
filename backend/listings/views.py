from rest_framework import filters, generics
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Category, Listing, ListingPhoto, Zone
from .permissions import IsListingOwner
from .serializers import (
    CategorySerializer,
    ListingPhotoSerializer,
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


class CategoryListView(generics.ListAPIView):
    queryset = Category.objects.all()
    serializer_class = CategorySerializer
    permission_classes = [AllowAny]


class ZoneListView(generics.ListAPIView):
    queryset = Zone.objects.all()
    serializer_class = ZoneSerializer
    permission_classes = [AllowAny]


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
