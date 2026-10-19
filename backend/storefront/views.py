from django.shortcuts import get_object_or_404
from django.utils.dateparse import parse_datetime
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import Customer
from accounts.permissions import HasRolePermission, RequiresSudo

from . import opening
from .models import TestAccount

MANAGE = "opening.manage"


class OpeningView(APIView):
    """GET: the opening time and the server's clock (the countdown never trusts the device clock)."""

    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request):
        response = Response(opening.snapshot())
        response["Cache-Control"] = "no-store"
        return response


class DelayOpeningView(APIView):
    def get_permissions(self):
        return [HasRolePermission(MANAGE), RequiresSudo()]

    def post(self, request):
        data = request.data if isinstance(request.data, dict) else {}
        new_time = parse_datetime(str(data.get("opens_at") or ""))
        if new_time is None or new_time.tzinfo is None:
            return Response({"opens_at": "Give the new opening time with a time zone."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            row = opening.delay(request.user, new_time, data.get("reason"))
        except opening.OpeningError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response({"opens_at": row.opens_at.isoformat().replace("+00:00", "Z"), "reason": row.reason}, status=status.HTTP_201_CREATED)


class TestAccountsView(APIView):
    """The customers allowed to buy before opening."""

    def get_permissions(self):
        return [HasRolePermission(MANAGE)]

    def get(self, request):
        rows = TestAccount.objects.select_related("customer")
        return Response([
            {"customer": row.customer_id, "customer_name": row.customer.full_name, "added_at": row.created_at.isoformat()}
            for row in rows
        ])

    def _customer(self, request):
        data = request.data if isinstance(request.data, dict) else {}
        try:
            return Customer.objects.filter(pk=int(data.get("customer"))).first()
        except (TypeError, ValueError):
            return None

    def post(self, request):
        customer = self._customer(request)
        if customer is None:
            return Response({"customer": "No such customer."}, status=status.HTTP_400_BAD_REQUEST)
        _, created = TestAccount.objects.get_or_create(customer=customer, defaults={"added_by": request.user})
        return Response({"customer": customer.pk}, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)

    def delete(self, request):
        customer = self._customer(request)
        if customer is None:
            return Response({"customer": "No such customer."}, status=status.HTTP_400_BAD_REQUEST)
        get_object_or_404(TestAccount, customer=customer).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
