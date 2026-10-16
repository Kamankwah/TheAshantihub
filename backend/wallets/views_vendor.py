"""A business's own money for its dashboard (spec §6; vendor plan 4), at /api/wallet/vendor/: the overview (Pending,
Available, the lifetime fee cap), one row per sale, the daily summary, the statement export, the platform fees in force
and the texts about its money. Business owners only: a customer (whatever their id) or a staff member gets 403, so a
platform fee never reaches a customer (spec §3.2). Read-only, except the digest choice. Every endpoint answers
409 ledger_off while LEDGER_ENABLED is off."""
import csv

from django.http import HttpResponse
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


class VendorDailyView(APIView):
    """GET vendor/daily/?date_from=&date_to= — the business's money day by day (Accra days, newest first; the last 30
    by default, at most 92), only days when something moved, and the range's totals: sold (item subtotals paid into
    Pending), fees (platform fees taken at release), released (moved to Available), refunded, free_delivery_promo,
    withdrawn, other and net_change, where sold − fees − refunded − free_delivery_promo − withdrawn + other = net_change."""

    permission_classes = [IsBusinessOwner]

    def get(self, request):
        if not escrow.enabled():
            return ledger_off()
        try:
            first, last = vendor.date_range(request.query_params, default_days=30, max_days=92)
        except vendor.RangeError as exc:
            return Response(exc.body(), status=status.HTTP_400_BAD_REQUEST)
        return Response(vendor.daily(request.user, first, last))


class VendorStatementExportView(APIView):
    """GET vendor/statement/export/?date_from=&date_to= — the statement as a CSV download (the last 30 days by default,
    at most 366). Always CSV: it takes no ?format=, which is DRF's renderer override (backend/CLAUDE.md). Built in the
    request (no throttle, unlike the staff reports' background exports). A client sending `Accept: text/csv` gets DRF's
    406 before this view, as with OwnerSalesReportExportView: the screen must request `*/*`."""

    permission_classes = [IsBusinessOwner]

    def get(self, request):
        if not escrow.enabled():
            return ledger_off()
        try:
            first, last = vendor.date_range(request.query_params, default_days=30, max_days=366)
        except vendor.RangeError as exc:
            return Response(exc.body(), status=status.HTTP_400_BAD_REQUEST)
        response = HttpResponse(content_type="text/csv")
        response["Content-Disposition"] = f'attachment; filename="ashantihub-statement-{first.isoformat()}-to-{last.isoformat()}.csv"'
        writer = csv.writer(response)
        writer.writerow(vendor.STATEMENT_HEADER)
        writer.writerows(vendor.statement(request.user, first, last))
        return response
