"""The customer wishlist (marketplace Plan 4, contract A3): /api/wishlist/.

GET lists the caller's saved listings, newest first, as the same card rows the public list serves. POST {"listing": id}
saves one (idempotent). DELETE /api/wishlist/<listing_id>/ removes one. Customers only; not gated on the marketplace
opening, so a shopper can save things before it opens.
"""
from django.db import IntegrityError, transaction
from rest_framework import serializers, status
from rest_framework.generics import get_object_or_404
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.views import IsCustomer

from .models import Listing, WishlistItem
from .serializers import PublicListingSerializer
from .views import _with_rating_annotations
from .visibility import hidden_business_q

CANT_SAVE = "This item can't be saved."


def _saveable():
    """Listings a shopper may see and save: the public detail view's rule (published, business not hidden)."""
    return Listing.objects.filter(status=Listing.PUBLISHED).exclude(hidden_business_q())


def _rows(request, item_ids):
    """Wishlist rows (in the order of `item_ids`) with their listing as an annotated public card row."""
    items = {i.pk: i for i in WishlistItem.objects.filter(pk__in=item_ids)}
    listings = {
        row.pk: row for row in _with_rating_annotations(
            Listing.objects.filter(wishlist_items__in=item_ids)
            .select_related("category", "zone", "business_owner__profile").prefetch_related("photos")
        )
    }
    out = []
    for pk in item_ids:
        item = items.get(pk)
        if item and item.listing_id in listings:
            out.append({
                "id": item.pk,
                "listing": PublicListingSerializer(listings[item.listing_id], context={"request": request}).data,
                "added_at": serializers.DateTimeField().to_representation(item.added_at),
            })
    return out


class WishlistView(APIView):
    permission_classes = [IsAuthenticated, IsCustomer]

    def get(self, request):
        ids = list(
            WishlistItem.objects.filter(customer=request.user, listing__in=_saveable().values("pk"))
            .values_list("pk", flat=True)
        )
        return Response(_rows(request, ids))

    def post(self, request):
        raw = request.data.get("listing") if hasattr(request.data, "get") else None
        try:
            listing = _saveable().get(pk=int(raw))
        except (TypeError, ValueError, Listing.DoesNotExist):
            return Response({"listing": [CANT_SAVE]}, status=status.HTTP_400_BAD_REQUEST)
        try:
            with transaction.atomic():
                item, created = WishlistItem.objects.get_or_create(customer=request.user, listing=listing)
        except IntegrityError:  # the same save arrived twice at once
            item, created = WishlistItem.objects.get(customer=request.user, listing=listing), False
        return Response(_rows(request, [item.pk])[0], status=201 if created else 200)


class WishlistItemView(APIView):
    permission_classes = [IsAuthenticated, IsCustomer]

    def delete(self, request, listing_id):
        item = get_object_or_404(WishlistItem, customer=request.user, listing_id=listing_id)
        item.delete()
        return Response(status=204)
