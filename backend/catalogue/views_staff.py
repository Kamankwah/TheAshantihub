"""Staff side of catalogue grouping (catalogue plan 6): the queue of grouping requests and ungrouping a listing.

Follows the moderated-queue contract (backend/CLAUDE.md): the historical .../pending/ URL with
?status=pending|approved|rejected (an unknown value falls back to pending), pending oldest first, history newest decision
first with a -created_at/-id fallback, approve and reject set reviewed_by/reviewed_at, re-review only from rejected.
Every action needs listings.moderate (the listing moderators). StaffActivityMiddleware records every POST here, the
reason included."""
from django.db.models import F
from rest_framework import generics
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import HasRolePermission
from listings.models import Listing

from . import attach
from .errors import CatalogueError
from .models import CatalogueAttachRequest, product_row

PERMISSION = "listings.moderate"
ATTACH_STATUS_MAP = {
    "pending": CatalogueAttachRequest.PENDING,
    "approved": CatalogueAttachRequest.APPROVED,
    "rejected": CatalogueAttachRequest.REJECTED,
}
ROW_RELATED = ("listing__business_owner__profile", "listing__catalogue_product", "catalogue_product", "reviewed_by")


class Pagination(PageNumberPagination):
    page_size = 50


def _body(request):
    return request.data if isinstance(request.data, dict) else {}


def _reason(request):
    return str(_body(request).get("reason") or "").strip()


class ModeratorView(APIView):
    queryset = CatalogueAttachRequest.objects.all()  # the audit middleware reads the target type from here

    def get_permissions(self):
        return [HasRolePermission(PERMISSION)]


class RequestQueueView(generics.ListAPIView):
    """GET staff/requests/pending/?status=pending|approved|rejected&page=N."""

    queryset = CatalogueAttachRequest.objects.all()

    pagination_class = Pagination

    def get_permissions(self):
        return [HasRolePermission(PERMISSION)]

    def get_queryset(self):
        status = ATTACH_STATUS_MAP.get(self.request.query_params.get("status", "pending"), CatalogueAttachRequest.PENDING)
        queryset = CatalogueAttachRequest.objects.filter(status=status).select_related(*ROW_RELATED)
        if status == CatalogueAttachRequest.PENDING:
            return queryset.order_by("created_at", "id")
        return queryset.order_by(F("reviewed_at").desc(nulls_last=True), "-created_at", "-id")

    def list(self, request, *args, **kwargs):
        page = self.paginate_queryset(self.get_queryset())
        found = attach.matches_for(page)  # one query for the whole page, not one per row
        return self.get_paginated_response([attach.staff_row(row, found.get(row.pk, [])) for row in page])


class RequestDetailView(ModeratorView):
    """GET staff/requests/<id>/."""

    def get(self, request, pk):
        row = CatalogueAttachRequest.objects.select_related(*ROW_RELATED).filter(pk=pk).first()
        if row is None:
            return Response({"detail": attach.NOT_FOUND, "code": "not_found"}, status=404)
        return Response(attach.staff_row(row))


class RequestApproveView(ModeratorView):
    """POST staff/requests/<id>/approve/ {} or {catalogue_product} or {brand?, name?}."""

    def post(self, request, pk):
        try:
            decided, product = attach.approve(pk, request.user, _body(request))
        except CatalogueError as exc:
            return Response(exc.body(), status=exc.status_code)
        return Response({"request": attach.staff_row(decided), "catalogue_product": product_row(product)})


class RequestRejectView(ModeratorView):
    """POST staff/requests/<id>/reject/ {reason}."""

    def post(self, request, pk):
        reason = _reason(request)
        if not reason:
            return Response({"reason": attach.REASON_REQUIRED}, status=400)
        try:
            decided = attach.reject(pk, request.user, reason)
        except CatalogueError as exc:
            return Response(exc.body(), status=exc.status_code)
        return Response(attach.staff_row(decided))


class RequestReReviewView(ModeratorView):
    """POST staff/requests/<id>/re-review/ — a rejected request back to pending."""

    def post(self, request, pk):
        try:
            reopened = attach.re_review(pk)
        except CatalogueError as exc:
            return Response(exc.body(), status=exc.status_code)
        return Response(attach.staff_row(reopened))


class ListingDetachView(ModeratorView):
    """POST staff/listings/<pk>/detach/ {reason} — ungroup a listing; the business is told why."""

    queryset = Listing.objects.all()

    def post(self, request, pk):
        reason = _reason(request)
        if not reason:
            return Response({"reason": attach.REASON_REQUIRED}, status=400)
        try:
            listing = attach.detach(pk, reason, request.user)
        except CatalogueError as exc:
            return Response(exc.body(), status=exc.status_code)
        return Response({"listing": listing.pk, "catalogue_product": None})
