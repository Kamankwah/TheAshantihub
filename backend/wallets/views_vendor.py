"""A business's own money for its dashboard (spec §6; vendor plan 4), at /api/wallet/vendor/: the overview (Pending,
Available, the lifetime fee cap), one row per sale, the daily summary, the statement export, the platform fees in force
and the texts about its money. Business owners only: a customer (whatever their id) or a staff member gets 403, so a
platform fee never reaches a customer (spec §3.2). Read-only, except the digest choice. Every endpoint answers
409 ledger_off while LEDGER_ENABLED is off."""
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.views import IsBusinessOwner
from ledger import escrow

from . import vendor
from .views import Pagination, ledger_off

SALE_STATUSES = ("all", *vendor.STATUSES)


class VendorOverviewView(APIView):
    """GET vendor/ — Pending, Available (may be negative after a late refund), what can be withdrawn, how many sales
    wait for Support's call, and the lifetime fee cap used and left."""

    permission_classes = [IsBusinessOwner]

    def get(self, request):
        if not escrow.enabled():
            return ledger_off()
        return Response(vendor.overview(request.user))


class VendorSalesView(APIView):
    """GET vendor/sales/?status=all|awaiting_call|released|refunded&date_from=&date_to= — one row per order the business
    sold into (its own lines only), newest first, 20 a page."""

    permission_classes = [IsBusinessOwner]

    def get(self, request):
        if not escrow.enabled():
            return ledger_off()
        wanted = request.query_params.get("status") or "all"
        if wanted not in SALE_STATUSES:
            return Response({"status": "Choose all, awaiting_call, released or refunded."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            date_from, date_to = vendor.optional_dates(request.query_params)
        except vendor.RangeError as exc:
            return Response(exc.body(), status=status.HTTP_400_BAD_REQUEST)
        groups = vendor.sale_groups(
            request.user, status=None if wanted == "all" else wanted, date_from=date_from, date_to=date_to,
        )
        paginator = Pagination()
        page = paginator.paginate_queryset(groups, request, view=self)
        return paginator.get_paginated_response(vendor.rows(request.user, page))
