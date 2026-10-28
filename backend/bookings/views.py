from decimal import Decimal

from django.db import transaction as db_transaction
from django.utils import timezone
from django.utils.dateparse import parse_date
from rest_framework import generics, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.views import IsBusinessOwner, IsCustomer
from listings.models import Listing
from notifications.services import notify_business_owner, notify_customer
from ledger import posting, sales
from ledger.models import BookingSale
from ledger.money import from_pesewas
from payments import booking_pay
from payments.models import CheckoutSession
from storefront.permissions import MarketplaceOpen

from .availability import is_available, min_units_free
from .models import Booking
from .serializers import BookingCreateSerializer, BookingSerializer


def stay_total(nightly_rate, nights, units):
    """The price of a stay: nightly rate x nights x units. One place, so what
    availability quotes is what booking charges."""
    return nightly_rate * nights * units


class BookingAvailabilityView(APIView):
    """GET /api/bookings/availability/?listing=&check_in=&check_out= — how many
    units are free across a date range, for the customer's date-picker. Public
    to any authenticated caller. Optional `units` (a whole number, 1 or more,
    default 1) also quotes the server-priced `total_price`.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        listing = generics.get_object_or_404(Listing, pk=request.query_params.get("listing"))
        check_in = parse_date(request.query_params.get("check_in") or "")
        check_out = parse_date(request.query_params.get("check_out") or "")
        if not check_in or not check_out or check_out <= check_in:
            return Response({"detail": "Valid check_in and check_out dates are required."}, status=400)
        raw_units = request.query_params.get("units")
        units = 1
        if raw_units is not None:
            if not raw_units.isascii() or not raw_units.isdigit() or len(raw_units) > 9 or int(raw_units) < 1:
                return Response({"units": "Enter a whole number of units, 1 or more."}, status=400)
            units = int(raw_units)
        free = min_units_free(listing, check_in, check_out)
        nights = (check_out - check_in).days
        rate = listing.price_amount
        return Response({
            "units_free": free,
            "available": free > 0,
            "nights": nights,
            "nightly_rate": str(rate) if rate is not None else None,
            "units": units,
            "total_price": str(stay_total(rate, nights, units)) if rate is not None else None,
        })


class BookingCreateView(APIView):
    """POST /api/bookings/ — a customer books an accommodation listing for a
    date range. Availability is re-checked under a row lock, the total is
    priced server-side (nights × nightly rate × units), and payment runs in the
    same call (simulated mode confirms synchronously). Body: {listing,
    check_in, check_out, units}.
    """

    permission_classes = [IsAuthenticated, IsCustomer, MarketplaceOpen]

    def post(self, request):
        serializer = BookingCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            method = booking_pay.method_from(request.data)
        except booking_pay.Refused as exc:
            return Response(exc.body, status=exc.status_code)

        today = timezone.now().date()
        if data["check_in"] < today:
            return Response({"check_in": "Check-in can't be in the past."}, status=400)

        try:
            with db_transaction.atomic():
                listing = generics.get_object_or_404(
                    Listing.objects.select_for_update(), pk=data["listing"]
                )
                if listing.status != Listing.PUBLISHED:
                    return Response({"listing": "This listing isn't available."}, status=400)
                if not (listing.category and listing.category.is_accommodation):
                    return Response({"listing": "This listing isn't a bookable accommodation."}, status=400)
                if listing.price_amount is None:
                    return Response({"listing": "This listing has no nightly rate set."}, status=400)

                if not is_available(listing, data["check_in"], data["check_out"], data["units"]):
                    return Response(
                        {"detail": "Those dates aren't available for the number of units requested."},
                        status=status.HTTP_409_CONFLICT,
                    )

                nights = (data["check_out"] - data["check_in"]).days
                total = stay_total(listing.price_amount, nights, data["units"])
                booking = Booking.objects.create(
                    customer=request.user,
                    listing=listing,
                    business_owner=listing.business_owner,
                    check_in=data["check_in"],
                    check_out=data["check_out"],
                    units=data["units"],
                    nightly_rate=listing.price_amount,
                    total_price=total,
                    status=Booking.PENDING,
                )

                result, processing = booking_pay.pay(
                    kind=CheckoutSession.BOOKING,
                    amount=total,
                    purpose=f"Booking: {listing.name} ({data['check_in']} → {data['check_out']})",
                    customer=request.user,
                    metadata={"booking_id": booking.id},
                    method=method,
                )
                if result["mode"] == "redirect":
                    return Response(booking_pay.redirect_body(result, processing), status=status.HTTP_200_OK)
                booking.refresh_from_db()
        except posting.InsufficientFunds as exc:
            return booking_pay.too_low(exc)  # the booking rolled back with the payment: its nights stay free

        notify_business_owner(
            listing.business_owner, "booking", "New booking",
            body=f"A customer booked “{listing.name}” for {nights} night(s).",
            link="/business-dashboard", icon="🏨",
        )
        return Response(booking_pay.with_terms(BookingSerializer(booking).data, processing, method=method), status=201)


class MyBookingsView(generics.ListAPIView):
    """GET /api/bookings/mine/ — the customer's own bookings."""

    serializer_class = BookingSerializer
    permission_classes = [IsAuthenticated, IsCustomer]

    def get_queryset(self):
        return Booking.objects.filter(customer=self.request.user).select_related("listing")


class IncomingBookingsView(generics.ListAPIView):
    """GET /api/bookings/incoming/ — the owner's bookings for their listings."""

    serializer_class = BookingSerializer
    permission_classes = [IsAuthenticated, IsBusinessOwner]

    def get_queryset(self):
        return Booking.objects.filter(business_owner=self.request.user).select_related(
            "listing", "customer"
        )


class BookingCancelView(APIView):
    """POST /api/bookings/{id}/cancel/ — the customer cancels their own booking, freeing the dates. Only before
    check-in. With the ledger on, a paid booking goes back to the customer's AshantiHub wallet in full at once
    (ledger.sales.refund; the payment-processing charge stays with the provider: the customer asked), and the customer
    is told how much. The booking row is locked, so a cancel and a check-in never cross.
    """

    permission_classes = [IsAuthenticated, IsCustomer]

    def post(self, request, pk):
        refund = None
        with db_transaction.atomic():
            booking = generics.get_object_or_404(Booking.objects.select_for_update(), pk=pk, customer=request.user)
            if booking.status not in (Booking.PENDING, Booking.CONFIRMED):
                return Response({"detail": "This booking can no longer be cancelled."}, status=400)
            sale = BookingSale.objects.filter(booking=booking).first()
            if sale is not None:
                # A paid stay follows the cancellation policy it was paid under; a refusal rolls nothing back (no writes).
                try:
                    refund = sales.cancel_by_customer(sale)
                except sales.CancelError as exc:
                    return Response({"detail": exc.message}, status=exc.status_code)
                booking.refresh_from_db()
            else:
                booking.status = Booking.CANCELLED
                booking.cancelled_at = timezone.now()
                booking.save(update_fields=["status", "cancelled_at"])
        notify_business_owner(
            booking.business_owner, "booking", "Booking cancelled",
            body=f"A booking for “{booking.listing.name}” was cancelled.",
            link="/business-dashboard", icon="⚠️",
        )
        body = BookingSerializer(booking).data
        if refund is not None:
            back = from_pesewas(refund.amount_pesewas)
            notify_customer(
                booking.customer, "booking", "Your booking was cancelled",
                body=f"Your booking for “{booking.listing.name}” was cancelled. GH₵ {back} went back to your AshantiHub wallet.",
                link="/my-account", icon="🧾",
            )
            body = {**body, "wallet_refund": str(back)}
        return Response(body)


class BookingCheckInView(APIView):
    """POST /api/bookings/{id}/check-in/ — the owner checks a confirmed guest in."""

    permission_classes = [IsAuthenticated, IsBusinessOwner]

    def post(self, request, pk):
        with db_transaction.atomic():
            # Locked, so a check-in and a cancel (with its refund) never cross (ledger Plan 1b S15).
            booking = generics.get_object_or_404(Booking.objects.select_for_update(), pk=pk, business_owner=request.user)
            if booking.status != Booking.CONFIRMED:
                return Response({"detail": "Only a confirmed booking can be checked in."}, status=400)
            booking.status = Booking.CHECKED_IN
            booking.checked_in_at = timezone.now()
            booking.save(update_fields=["status", "checked_in_at"])
        return Response(BookingSerializer(booking).data)


class BookingCheckOutView(APIView):
    """POST /api/bookings/{id}/check-out/ — the owner checks a guest out,
    freeing the unit.
    """

    permission_classes = [IsAuthenticated, IsBusinessOwner]

    def post(self, request, pk):
        booking = generics.get_object_or_404(Booking, pk=pk, business_owner=request.user)
        if booking.status != Booking.CHECKED_IN:
            return Response({"detail": "Only a checked-in booking can be checked out."}, status=400)
        booking.status = Booking.CHECKED_OUT
        booking.checked_out_at = timezone.now()
        booking.save(update_fields=["status", "checked_out_at"])
        return Response(BookingSerializer(booking).data)
