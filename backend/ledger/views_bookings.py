"""Support's booking screens (ledger Plan 1b): the paid services, stays and ticket purchases waiting for the verification
call, and recording the call (a positive one releases the money at once). Every endpoint answers 409
{"code": "ledger_off"} while LEDGER_ENABLED is off: only bookings paid with the ledger on are in the ledger."""
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts import sessions
from accounts.permissions import HasRolePermission
from accounts.views import IsCustomer
from notifications.services import notify_business_owner, notify_customer, notify_staff_role

from . import escrow, sales
from .models import BookingSale
from .money import from_pesewas
from .verification import VerificationError

VERIFY = "orders.verify"
SUPPORT = "orders.support_update"  # the permission of Support's order status screen, which cancels orders
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
        paginator = Pagination()
        page = paginator.paginate_queryset(sales.awaiting(now), request, view=self)
        return paginator.get_paginated_response([sales.queue_row(sale, now) for sale in page])


class BookingLookupView(APIView):
    """GET bookings/?q= — Support's search for a paid booking to cancel (gate (lxxiii)): up to 20, newest paid first,
    with the customer's phone masked. `cancellable` is false once the booking was handed over."""

    def get_permissions(self):
        return [HasRolePermission(SUPPORT)]

    def get(self, request):
        if not escrow.enabled():
            return ledger_off()
        now = timezone.now()
        found = sales.lookup(request.query_params.get("q"), now)[:20]
        return Response({"results": [sales.lookup_row(sale, now) for sale in found]})


class BookingVerificationView(APIView):
    """POST bookings/<id>/verification/ {outcome: matches|does_not_match|unreachable, note?, customer_confirmed_by_phone?}.
    A positive outcome releases the booking's money at once, and needs the password re-entered (RequiresSudo)."""

    def get_permissions(self):
        return [HasRolePermission(VERIFY)]

    def post(self, request, pk):
        if not escrow.enabled():
            return ledger_off()
        sale = get_object_or_404(BookingSale, pk=pk)
        data = request.data if isinstance(request.data, dict) else {}
        if data.get("outcome") == "matches":
            sessions.require_sudo(request)  # a positive call releases money by hand: the password is asked again
        try:
            sale = sales.record_verification(
                sale, request.user, data.get("outcome"), note=data.get("note"),
                customer_confirmed_by_phone=data.get("customer_confirmed_by_phone") is True,
            )
        except VerificationError as exc:
            if exc.code == "ledger_off":
                return ledger_off()
            return Response({"detail": exc.message}, status=exc.status_code)
        return Response({
            "sale": sale.pk, "outcome": sale.outcome, "dispute_id": sale.dispute_id, "released": sale.released_at is not None,
        })


class BookingCancelView(APIView):
    """POST bookings/<id>/cancel/ {reason} — Support cancels a paid booking the customer has not received yet: a service
    not done, a stay not checked in, tickets for an event not yet held with none scanned. It goes back to the customer's
    AshantiHub wallet in full (not the processing charge: the customer asked); the customer and the business are told.
    Once handed over it is a dispute, not a cancel (409)."""

    def get_permissions(self):
        return [HasRolePermission(SUPPORT)]

    def post(self, request, pk):
        if not escrow.enabled():
            return ledger_off()
        data = request.data if isinstance(request.data, dict) else {}
        reason = str(data.get("reason") or "").strip()[:300]
        if len(reason) < 3:
            return Response({"reason": "Say why it is cancelled (at least 3 characters)."}, status=400)
        sale = get_object_or_404(BookingSale.objects.select_related("customer", "business_owner"), pk=pk)
        what = sales.description(sale)  # before the cancel: tickets left, not tickets bought
        try:
            refund = sales.cancel(sale, request.user, reason)
        except sales.CancelError as exc:
            return Response({"detail": exc.message}, status=exc.status_code)
        back = from_pesewas(refund.amount_pesewas)
        notify_customer(
            sale.customer, "booking", "Your booking was cancelled",
            body=f"AshantiHub Support cancelled your booking ({what}). GH₵ {back} went back to your AshantiHub wallet.",
            link="/my-account", icon="🧾",
        )
        notify_business_owner(
            sale.business_owner, "booking", "Booking cancelled",
            body=f"AshantiHub Support cancelled a booking ({what}) before it took place. The customer was refunded.",
            link="/business-dashboard", icon="⚠️",
        )
        return Response({"sale": sale.pk, "refunded": str(back)})


class BookingReportProblemView(APIView):
    """POST bookings/<sale id>/report-problem/ {reason} — the customer reports a problem with a stay or tickets (a
    service has its own door under services/requests/). Stops the automatic release and tells Support (Plan 7E)."""

    permission_classes = [IsAuthenticated, IsCustomer]

    def post(self, request, pk):
        sale = get_object_or_404(BookingSale, pk=pk, customer=request.user)
        data = request.data if isinstance(request.data, dict) else {}
        try:
            sale = sales.report_problem(sale, request.user, data.get("reason"))
        except sales.AcceptError as exc:
            return Response({"detail": exc.message}, status=exc.status_code)
        notify_staff_role(
            VERIFY, "booking_problem", "A customer reported a problem",
            body=f"{sale.label().capitalize()} — dispute #{sale.dispute_id}.", link="/staff", icon="⚠️",
        )
        return Response({"dispute_id": sale.dispute_id}, status=201)


class BookingCancelQuoteView(APIView):
    """GET bookings/<sale id>/cancel-quote/ — what the customer's own cancel of this stay or ticket purchase would give
    back to their wallet right now, as {"refund": "150.00", "whole": false}. Computed by the cancel's own function
    (sales.cancel_quote), so the screen never works out a refund; it writes nothing. A refusal is the cancel's own
    {detail} (409); another customer's sale is a 404 (Plan 7G)."""

    permission_classes = [IsAuthenticated, IsCustomer]

    def get(self, request, pk):
        if not escrow.enabled():
            return ledger_off()
        sale = get_object_or_404(BookingSale, pk=pk, customer=request.user)
        try:
            quote = sales.cancel_quote(sale)
        except sales.CancelError as exc:
            return Response({"detail": exc.message}, status=exc.status_code)
        return Response({"refund": str(from_pesewas(quote.amount_pesewas)), "whole": quote.whole})
