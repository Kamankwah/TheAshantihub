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

from accounts.phones import mask_phone
from accounts.views import IsBusinessOwner
from ledger import escrow, fees
from ledger.models import FeeRuleSet

from . import vendor, vendor_texts
from .models import VendorPreference, VendorText
from .views import AmountError, Pagination, ledger_off, parse_amount

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


class VendorBookingsView(APIView):
    """GET vendor/bookings/?status=all|awaiting_call|released|refunded&date_from=&date_to= — one row per service, stay or
    ticket sale of the business, newest paid first, 20 a page. Never a customer's name or phone, nor what a reported
    problem says."""

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
        queryset = vendor.booking_sales(
            request.user, status=None if wanted == "all" else wanted, date_from=date_from, date_to=date_to,
        )
        paginator = Pagination()
        page = paginator.paginate_queryset(queryset, request, view=self)
        return paginator.get_paginated_response(vendor.booking_rows(request.user, page))


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
    request (throttled at 6 a minute, unlike the staff reports' background exports). A client sending `Accept: text/csv` gets DRF's
    406 before this view, as with OwnerSalesReportExportView: the screen must request `*/*`. UTF-8, and ASCII-only by
    design today (every cell is a date, number, fixed word or reference). More than vendor.EXPORT_MAX_ROWS rows is a 400.
    A withdrawal row's Gross is the amount asked for, its Amount the net that arrived."""

    permission_classes = [IsBusinessOwner]
    throttle_scope = "vendor_statement_export"

    def get(self, request):
        if not escrow.enabled():
            return ledger_off()
        try:
            first, last = vendor.date_range(request.query_params, default_days=30, max_days=366)
        except vendor.RangeError as exc:
            return Response(exc.body(), status=status.HTTP_400_BAD_REQUEST)
        try:
            vendor.check_statement_size(request.user, first, last)
        except vendor.RangeError as exc:
            return Response(exc.body(), status=status.HTTP_400_BAD_REQUEST)
        response = HttpResponse(content_type="text/csv; charset=utf-8")
        response["Content-Disposition"] = f'attachment; filename="ashantihub-statement-{first.isoformat()}-to-{last.isoformat()}.csv"'
        writer = csv.writer(response)
        writer.writerow(vendor.STATEMENT_HEADER)
        writer.writerows(vendor.statement(request.user, first, last))
        return response


class VendorFeesView(APIView):
    """GET vendor/fees/ — the platform fees in force for each category (and the next approved change, with when it
    starts; never a proposal still waiting), how the fee is worked out, and the business's lifetime cap.
    ?amount=&category= (category defaults to product) adds `quote`: the fee on a sale of that amount now, cap counted;
    null when no rules are in force."""

    permission_classes = [IsBusinessOwner]

    def get(self, request):
        if not escrow.enabled():
            return ledger_off()
        body = vendor.fee_schedule(request.user)
        params = request.query_params
        if params.get("amount") is not None or params.get("category") is not None:
            category = params.get("category") or FeeRuleSet.PRODUCT
            if category not in dict(FeeRuleSet.CATEGORY_CHOICES):
                return Response({"category": "Choose product, service or event."}, status=status.HTTP_400_BAD_REQUEST)
            try:
                amount = parse_amount(params.get("amount"))
            except AmountError as exc:
                return Response({"amount": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
            try:
                body["quote"] = vendor.fee_quote(request.user, category, amount)
            except fees.FeeError:
                body["quote"] = None
        return Response(body)


class VendorTextsView(APIView):
    """GET vendor/texts/ — the business's money texts: order and release texts always go (spec §6), whether the daily
    digest is on, the masked number they go to (null unless the login phone is a confirmed Ghana mobile; then `note` says why no
    texts can be sent) and its last 20 texts with what happened to each. PATCH {daily_digest: true|false} — turn the digest on or off."""

    permission_classes = [IsBusinessOwner]

    def _body(self, owner):
        phone = vendor_texts.confirmed_phone(owner)
        return {
            "order_texts": True, "daily_digest": vendor_texts.wants_digest(owner),
            "phone": mask_phone(phone) if phone else None, "note": None if phone else vendor_texts.NO_PHONE_NOTE,
            "recent": [vendor_texts.row(text) for text in VendorText.objects.filter(business_owner=owner)[:20]],
        }

    def get(self, request):
        if not escrow.enabled():
            return ledger_off()
        return Response(self._body(request.user))

    def patch(self, request):
        if not escrow.enabled():
            return ledger_off()
        data = request.data if isinstance(request.data, dict) else {}
        if not isinstance(data.get("daily_digest"), bool):
            return Response({"daily_digest": "Choose true or false."}, status=status.HTTP_400_BAD_REQUEST)
        VendorPreference.objects.update_or_create(business_owner=request.user, defaults={"daily_digest": data["daily_digest"]})
        return Response(self._body(request.user))
