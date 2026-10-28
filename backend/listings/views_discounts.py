"""The owner's discounts (Plan M2 Task 8, ruling R6). A discount is a sale price (and optional end date) on a listing or
on one of its variants; it goes live at once and expires at read time (listings.pricing).

  GET  /api/listings/mine/<pk>/discounts/        the live discounts of the listing and its variants
  POST /api/listings/mine/<pk>/discounts/        {"variant"?, "sale_price" | "percent_off", "ends_at"?}
  POST /api/listings/mine/<pk>/discounts/end/    {"variant"?}
"""
from rest_framework import generics, serializers
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.views import IsBusinessOwner

from . import pricing
from .models import Listing
from .views_revisions import _owner

_DATE = serializers.DateTimeField()


def _present(rows):
    return [{**row, "ends_at": None if row["ends_at"] is None else _DATE.to_representation(row["ends_at"])} for row in rows]


class _OwnerDiscountView(APIView):
    permission_classes = [IsAuthenticated, IsBusinessOwner]
    scope = None

    def listing(self, request, pk):
        # Another business's listing is a 404, so nobody learns it exists.
        return generics.get_object_or_404(Listing, pk=pk, business_owner=_owner(request, self.scope))

    @staticmethod
    def body(request):
        return request.data if isinstance(request.data, dict) else {}


class ListingDiscountsView(_OwnerDiscountView):
    def get(self, request, pk):
        listing = self.listing(request, pk)
        return Response(_present(pricing.live_discounts(listing)))

    def post(self, request, pk):
        listing = self.listing(request, pk)
        data = self.body(request)
        try:
            pricing.start_discount(
                listing.pk, variant=data.get("variant"), sale_price=data.get("sale_price"),
                percent_off=data.get("percent_off"), ends_at=data.get("ends_at"),
            )
        except pricing.PricingError as exc:
            return Response(exc.payload, status=exc.status)
        return Response(_present(pricing.live_discounts(Listing.objects.get(pk=listing.pk))), status=201)


class ListingDiscountEndView(_OwnerDiscountView):
    def post(self, request, pk):
        listing = self.listing(request, pk)
        try:
            pricing.end_discount(listing.pk, variant=self.body(request).get("variant"))
        except pricing.PricingError as exc:
            return Response(exc.payload, status=exc.status)
        return Response(_present(pricing.live_discounts(Listing.objects.get(pk=listing.pk))))
