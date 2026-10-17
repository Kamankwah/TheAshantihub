"""Catalogue API for businesses and customers (catalogue plan 6). Every business endpoint reads the listing through
`business_owner=request.user`, so another business's listing is a 404 and nothing changes."""
from rest_framework import generics
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from accounts.views import IsBusinessOwner
from listings.models import Listing
from listings.visibility import hidden_business_q

from . import attach, offers, stock
from .errors import CatalogueError
from .models import CatalogueProduct


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
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "catalogue_request"

    def post(self, request, listing_id):
        listing = _own_listing(request, listing_id)
        if request.user.is_suspended:
            return Response(CatalogueError(attach.ACCOUNT_SUSPENDED, "account_suspended", 403).body(), status=403)
        try:
            attach.propose(listing, _body(request))
        except CatalogueError as exc:
            return Response(exc.body(), status=exc.status_code)
        return Response(attach.state(listing), status=201)


class MineWithdrawView(APIView):
    """POST mine/requests/<id>/withdraw/ — take back a request still waiting."""

    permission_classes = [IsAuthenticated, IsBusinessOwner]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "catalogue_withdraw"

    def post(self, request, pk):
        try:
            withdrawn = attach.withdraw(request.user, pk)
        except CatalogueError as exc:
            return Response(exc.body(), status=exc.status_code)
        return Response(attach.request_row(withdrawn))


class OtherSellersView(APIView):
    """GET listings/<listing_id>/other-sellers/?ordering=price|availability&lat=&lng= — public: the other businesses'
    live offers of the same catalogue product, and the featured offer. An ungrouped listing answers an empty list; a
    listing customers cannot see is a 404."""

    permission_classes = [AllowAny]

    def get(self, request, listing_id):
        listing = generics.get_object_or_404(
            Listing.objects.filter(status=Listing.PUBLISHED).exclude(hidden_business_q()).select_related("catalogue_product"),
            pk=listing_id,
        )
        return Response(offers.other_sellers(listing, request.query_params))


def _suspended_refusal(request):
    if request.user.is_suspended:
        return Response(CatalogueError(LOOKUP_SUSPENDED, "account_suspended", 403).body(), status=403)
    return None


LOOKUP_SUSPENDED = "Your account is suspended, so it cannot look up other businesses' offers."


class ProductSearchView(APIView):
    """GET products/?q=words or ?barcode=digits — catalogue products, how many live offers each has, and the lowest live
    price (null when nobody offers it now). Business owners only; suspended owners are refused."""

    permission_classes = [IsAuthenticated, IsBusinessOwner]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "catalogue_lookup"

    def get(self, request):
        refused = _suspended_refusal(request)
        if refused is not None:
            return refused
        try:
            results = offers.search(request.query_params)
        except CatalogueError as exc:
            return Response(exc.body(), status=exc.status_code)
        return Response({"results": results})


class ProductOffersView(APIView):
    """GET products/<id>/offers/ — other businesses' live offers of one product, cheapest first. Read-only; business
    owners only; suspended owners are refused."""

    permission_classes = [IsAuthenticated, IsBusinessOwner]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "catalogue_lookup"

    def get(self, request, pk):
        refused = _suspended_refusal(request)
        if refused is not None:
            return refused
        product = generics.get_object_or_404(CatalogueProduct, pk=pk)
        return Response(offers.sourcing(product, request.user))


class StockView(APIView):
    """GET stock/ — the business's offers that need restocking (sold out first), the numbers behind each, and how many
    of its offers are counted and not counted. Works whatever STOCK_ALERTS_ENABLED says."""

    permission_classes = [IsAuthenticated, IsBusinessOwner]

    def get(self, request):
        return Response(stock.needs_restocking(request.user))


class StockLineView(APIView):
    """PUT stock/<listing_id>/line/ {"units": n or null} — the business's own low-stock line for one offer (null: the
    default). Changing it re-arms the low alert."""

    permission_classes = [IsAuthenticated, IsBusinessOwner]

    def put(self, request, listing_id):
        listing = _own_listing(request, listing_id)
        try:
            units = stock.parse_line(_body(request).get("units"))
        except ValueError:
            return Response({"units": stock.LINE_MESSAGE}, status=400)
        if not attach.groupable(listing):
            return Response({"detail": stock.NOT_A_PRODUCT, "code": "not_a_product"}, status=400)
        if listing.stock_quantity is None:
            return Response({"detail": stock.NOT_COUNTED, "code": "not_counted"}, status=409)
        stock.set_own_line(listing, units)
        return Response({"listing_id": listing.pk, "line": units, "cover": stock.row(listing, stock.cover_of(listing))})
