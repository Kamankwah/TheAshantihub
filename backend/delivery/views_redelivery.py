"""Re-delivery at the customer's request (Plan 7F-E Task 7; rules in delivery.redelivery).

Staff holding `orders.redeliver` (Support, the Pickup Desk, a Super Admin):
    GET  /api/delivery/redeliveries/?order=<id>     the order's requests, newest first (an empty list while none exist)
    POST /api/delivery/redeliveries/ {order, reason}  ask for a second trip (201)
    POST /api/delivery/redeliveries/<id>/cancel/     cancel before the second trip is assigned (a paid fee goes back to the
                                                     wallet)
The customer who owns the order:
    POST /api/orders/<id>/redelivery/pay/ {method: "wallet" | "momo"}   pay the fee (payments.services.process_payment
         through payments.booking_pay.pay: a wallet payment is immediate; mobile money adds the provider's processing charge
         on top and returns the redirect shape, finalised by the webhook; the simulated provider finalises at once)

While LEDGER_ENABLED is off the POSTs answer 409 `ledger_off` and nothing is written; the list answers an empty list (no
request can exist). Assigning the second trip stays on the Dispatch / Delivery Manager's screens (delivery.manage)."""
from django.db import transaction
from django.shortcuts import get_object_or_404
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import HasRolePermission
from accounts.views import IsCustomer
from ledger import escrow
from ledger.money import from_pesewas
from ledger.posting import InsufficientFunds
from orders.models import Order
from payments import booking_pay
from payments.models import CheckoutSession

from . import redelivery
from .models import Redelivery

PERMISSION = "orders.redeliver"
LEDGER_OFF = {"detail": "Re-delivery fees aren't switched on yet.", "code": "ledger_off"}


class RedeliveryListCreateView(APIView):
    def get_permissions(self):
        return [HasRolePermission(PERMISSION)]

    def get(self, request):
        order_id = request.query_params.get("order", "")
        if not str(order_id).isdecimal():
            return Response({"order": "Give the order number."}, status=400)
        rows = Redelivery.objects.filter(order_id=int(order_id)).select_related("requested_by", "rider").order_by("-attempt")
        return Response({"results": [redelivery.staff_row(r) for r in rows]})

    def post(self, request):
        if not escrow.enabled():
            return Response(LEDGER_OFF, status=409)
        data = request.data if hasattr(request.data, "get") else {}
        order_id = data.get("order")
        if not str(order_id or "").isdecimal():
            return Response({"order": "Give the order number."}, status=400)
        order = get_object_or_404(Order, pk=int(order_id))
        try:
            row = redelivery.request(order, request.user, data.get("reason"), http_request=request)
        except redelivery.RedeliveryError as exc:
            return Response(exc.body(), status=exc.status_code)
        return Response(redelivery.staff_row(Redelivery.objects.select_related("requested_by", "rider").get(pk=row.pk)), status=201)


class RedeliveryCancelView(APIView):
    def get_permissions(self):
        return [HasRolePermission(PERMISSION)]

    def post(self, request, pk):
        if not escrow.enabled():
            return Response(LEDGER_OFF, status=409)
        try:
            row = redelivery.cancel(pk, request.user, http_request=request)
        except Redelivery.DoesNotExist:
            return Response({"detail": "Not found."}, status=404)
        except redelivery.RedeliveryError as exc:
            return Response(exc.body(), status=exc.status_code)
        return Response(redelivery.staff_row(Redelivery.objects.select_related("requested_by", "rider").get(pk=row.pk)))


class RedeliveryPayView(APIView):
    """POST /api/orders/<id>/redelivery/pay/ {method} — the customer pays the re-delivery fee of their own order."""

    permission_classes = [IsCustomer]

    def post(self, request, pk):
        from orders import locks

        if not escrow.enabled():
            return Response(LEDGER_OFF, status=409)
        data = request.data if hasattr(request.data, "get") else {}
        method = data.get("method")
        if method not in (booking_pay.MOMO, booking_pay.WALLET):
            return Response({"method": "Pay from your AshantiHub wallet or by mobile money."}, status=400)
        get_object_or_404(Order, pk=pk, customer=request.user)        # another customer's order is a 404
        try:
            with transaction.atomic():
                order = locks.lock_order(pk)
                row = Redelivery.objects.select_for_update(of=("self",)).filter(
                    order=order, status=Redelivery.AWAITING_PAYMENT,
                ).first()
                if row is None:
                    return Response({"detail": "There is no re-delivery fee waiting to be paid on this order.", "code": "nothing_to_pay"}, status=409)
                result, processing = booking_pay.pay(
                    kind=CheckoutSession.REDELIVERY_FEE, amount=from_pesewas(row.fee_pesewas),
                    purpose=f"Re-delivery of order #{order.pk}", customer=request.user,
                    metadata={"redelivery_id": row.pk}, method=method,
                )
                if result["mode"] == "redirect":
                    Redelivery.objects.filter(pk=row.pk).update(checkout_session=result["session"])
        except InsufficientFunds as exc:
            return booking_pay.too_low(exc)
        if result["mode"] == "redirect":
            return Response(booking_pay.redirect_body(result, processing), status=200)
        row.refresh_from_db()
        return Response({
            "mode": "immediate", "payment_method": method, "payment_processing": str(processing),
            "redelivery": redelivery.customer_row(row),
        }, status=200)
