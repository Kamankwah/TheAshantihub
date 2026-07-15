from decimal import Decimal

from django.db import transaction as db_transaction
from django.utils.crypto import get_random_string
from rest_framework import generics, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.views import IsCustomer
from billing.models import Transaction
from cart.models import Cart

from .models import Order, OrderItem
from .serializers import OrderSerializer


class OrderCheckoutView(APIView):
    """POST /api/orders/checkout/ — takes the caller's current cart, requires
    it to be non-empty, creates an Order + OrderItems snapshotting each cart
    line, computes total_amount, empties the cart, and — matching this
    codebase's existing simulated-payment pattern (billing.SubscriptionMeView
    / TransactionMineListCreateView) — creates a billing.Transaction and sets
    the new Order's status to `paid` immediately. No real payment gateway
    involved yet.
    """

    permission_classes = [IsAuthenticated, IsCustomer]

    def post(self, request):
        cart = Cart.objects.filter(customer=request.user).first()
        items = list(cart.items.select_related("listing")) if cart is not None else []
        if not items:
            return Response({"detail": "Your cart is empty."}, status=status.HTTP_400_BAD_REQUEST)

        with db_transaction.atomic():
            total = sum(
                (item.unit_price_snapshot * item.quantity for item in items), Decimal("0.00")
            )
            order = Order.objects.create(
                customer=request.user, status=Order.PENDING, total_amount=total,
            )
            for item in items:
                line_total = item.unit_price_snapshot * item.quantity
                OrderItem.objects.create(
                    order=order,
                    listing=item.listing,
                    quantity=item.quantity,
                    unit_price=item.unit_price_snapshot,
                    line_total=line_total,
                )

            Transaction.objects.create(
                customer=request.user,
                amount=total,
                purpose=f"AshantiHub Order #{order.id}",
                status=Transaction.SUCCESS,
                reference=f"AH-ORD-{order.id}-{get_random_string(8).upper()}",
            )
            order.status = Order.PAID
            order.save(update_fields=["status"])

            cart.items.all().delete()

        return Response(OrderSerializer(order).data, status=status.HTTP_201_CREATED)


class OrderListView(generics.ListAPIView):
    """GET /api/orders/ — the caller's own order history."""

    serializer_class = OrderSerializer
    permission_classes = [IsAuthenticated, IsCustomer]

    def get_queryset(self):
        return Order.objects.filter(customer=self.request.user)


class OrderDetailView(generics.RetrieveAPIView):
    """GET /api/orders/{id}/ — confirmation-page detail. 404s for another
    customer's order (the queryset is scoped to the caller).
    """

    serializer_class = OrderSerializer
    permission_classes = [IsAuthenticated, IsCustomer]

    def get_queryset(self):
        return Order.objects.filter(customer=self.request.user)
