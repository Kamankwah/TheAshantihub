"""Catalogue API for businesses and customers (catalogue plan 6). Every business endpoint reads the listing through
`business_owner=request.user`, so another business's listing is a 404 and nothing changes."""
from rest_framework import generics
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.views import IsBusinessOwner
from listings.models import Listing

from . import attach
from .errors import CatalogueError


def _own_listing(request, listing_id):
    return generics.get_object_or_404(
        Listing.objects.select_related("category", "catalogue_product"), pk=listing_id, business_owner=request.user,
    )


def _body(request):
    return request.data if isinstance(request.data, dict) else {}


class MineGroupingView(APIView):
    """GET mine/<listing_id>/ — what the business's listing can do and where its grouping stands."""

    permission_classes = [IsAuthenticated, IsBusinessOwner]

    def get(self, request, listing_id):
        return Response(attach.state(_own_listing(request, listing_id)))


class MineRequestView(APIView):
    """POST mine/<listing_id>/requests/ {catalogue_product} or {brand?, name?} — ask AshantiHub to group the listing.
    Answers 201 with the listing's state; nothing is grouped until staff decide."""

    permission_classes = [IsAuthenticated, IsBusinessOwner]

    def post(self, request, listing_id):
        listing = _own_listing(request, listing_id)
        try:
            attach.propose(listing, _body(request))
        except CatalogueError as exc:
            return Response(exc.body(), status=exc.status_code)
        return Response(attach.state(listing), status=201)


class MineWithdrawView(APIView):
    """POST mine/requests/<id>/withdraw/ — take back a request still waiting."""

    permission_classes = [IsAuthenticated, IsBusinessOwner]

    def post(self, request, pk):
        try:
            withdrawn = attach.withdraw(request.user, pk)
        except CatalogueError as exc:
            return Response(exc.body(), status=exc.status_code)
        return Response(attach.request_row(withdrawn))
