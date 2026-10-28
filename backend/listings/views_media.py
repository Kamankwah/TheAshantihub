"""The owner's media endpoints: images and videos on a listing (rules in listings/media.py).

POST   /api/listings/mine/<pk>/photos/                multipart `image` (+ `order`)        -> 201 photo
DELETE /api/listings/mine/<pk>/photos/<photo_id>/                                          -> 204 gone, 202 queued
POST   /api/listings/mine/<pk>/videos/                multipart `file` or JSON {"youtube_url"} -> 201 video
DELETE /api/listings/mine/<pk>/videos/<video_id>/                                          -> 204 gone, 202 queued

On a published or dropped listing new media is staged in the open edit and removals are queued until staff approve
(202); 400 {"detail": plain words} for every refusal. Another owner's listing or media is a 404."""
from rest_framework import generics
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.views import IsBusinessOwner

from . import media
from .models import Listing, ListingPhoto, ListingVideo
from .serializers import ListingPhotoSerializer, OwnerPhotoSerializer, OwnerVideoSerializer
from .views_revisions import _owner

QUEUED = "Removal is waiting for approval: it takes effect when staff approve your edit."


class _OwnerMediaView(APIView):
    permission_classes = [IsAuthenticated, IsBusinessOwner]
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    scope = None

    def owner(self, request):
        return _owner(request, self.scope)

    def listing(self, request, pk):
        # Another business's listing is a 404, so nobody learns it exists.
        return generics.get_object_or_404(Listing, pk=pk, business_owner=self.owner(request))

    @staticmethod
    def refused(exc):
        return Response({"detail": str(exc)}, status=400)

    @staticmethod
    def removed(gone):
        return Response(status=204) if gone else Response({"detail": QUEUED, "queued": True}, status=202)


class ListingPhotoCreateView(_OwnerMediaView):
    def post(self, request, pk):
        listing = self.listing(request, pk)
        serializer = ListingPhotoSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        try:
            photo = media.add_image(
                listing, self.owner(request), serializer.validated_data["image"], serializer.validated_data.get("order", 0),
            )
        except media.MediaError as exc:
            return self.refused(exc)
        return Response(OwnerPhotoSerializer(photo, context={"request": request}).data, status=201)


class ListingPhotoDeleteView(_OwnerMediaView):
    def delete(self, request, pk, photo_id):
        listing = self.listing(request, pk)
        photo = generics.get_object_or_404(ListingPhoto, pk=photo_id, listing=listing)
        try:
            return self.removed(media.remove_photo(listing, photo, self.owner(request)))
        except media.MediaError as exc:
            return self.refused(exc)


class ListingVideoCreateView(_OwnerMediaView):
    def post(self, request, pk):
        listing = self.listing(request, pk)
        owner = self.owner(request)
        try:
            if request.FILES.get("file") is not None:
                video = media.add_video_upload(listing, owner, request.FILES["file"])
            else:
                video = media.add_youtube(listing, owner, request.data.get("youtube_url"))
        except media.MediaError as exc:
            return self.refused(exc)
        return Response(OwnerVideoSerializer(video, context={"request": request}).data, status=201)


class ListingVideoDeleteView(_OwnerMediaView):
    def delete(self, request, pk, video_id):
        listing = self.listing(request, pk)
        video = generics.get_object_or_404(ListingVideo, pk=video_id, listing=listing)
        try:
            return self.removed(media.remove_video(listing, video, self.owner(request)))
        except media.MediaError as exc:
            return self.refused(exc)
