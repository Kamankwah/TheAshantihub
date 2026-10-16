"""Support's booking screens (ledger Plan 1b): the paid services, stays and ticket purchases waiting for the verification
call, and recording the call (a positive one releases the money at once). Every endpoint answers 409
{"code": "ledger_off"} while LEDGER_ENABLED is off: only bookings paid with the ledger on are in the ledger."""
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import HasRolePermission

from . import escrow, sales, settings_store
from .models import BookingSale
from .verification import VerificationError

VERIFY = "orders.verify"
OFF = "The ledger isn't switched on yet."


def ledger_off():
    return Response({"detail": OFF, "code": "ledger_off"}, status=409)


class Pagination(PageNumberPagination):
    page_size = 20


class AwaitingBookingsView(APIView):
    """GET bookings/awaiting-verification/ — handed-over bookings waiting for Support's call, oldest paid first, 20 a
    page, with the customer's phone."""

    def get_permissions(self):
        return [HasRolePermission(VERIFY)]

    def get(self, request):
        if not escrow.enabled():
            return ledger_off()
        now = timezone.now()
        hours = settings_store.current("verification_overdue_hours", now)
        paginator = Pagination()
        page = paginator.paginate_queryset(sales.awaiting(now), request, view=self)
        return paginator.get_paginated_response([sales.queue_row(sale, now, hours) for sale in page])


class BookingVerificationView(APIView):
    """POST bookings/<id>/verification/ {outcome: matches|does_not_match|unreachable, note?, customer_confirmed_by_phone?}.
    A positive outcome releases the booking's money at once."""

    def get_permissions(self):
        return [HasRolePermission(VERIFY)]

    def post(self, request, pk):
        if not escrow.enabled():
            return ledger_off()
        sale = get_object_or_404(BookingSale, pk=pk)
        data = request.data if isinstance(request.data, dict) else {}
        try:
            sale = sales.record_verification(
                sale, request.user, data.get("outcome"), note=data.get("note"),
                customer_confirmed_by_phone=data.get("customer_confirmed_by_phone") is True,
            )
        except VerificationError as exc:
            if exc.message == "The ledger is off.":
                return ledger_off()
            return Response({"detail": exc.message}, status=exc.status_code)
        return Response({
            "sale": sale.pk, "outcome": sale.outcome, "dispute_id": sale.dispute_id, "released": sale.released_at is not None,
        })
