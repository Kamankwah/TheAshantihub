from rest_framework import generics
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Listing, ListingPhoto
from .permissions import IsListingOwner
from .serializers import ListingPhotoSerializer


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
