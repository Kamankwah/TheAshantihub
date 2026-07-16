from decimal import Decimal

from django.db import transaction as db_transaction
from rest_framework import generics, status
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import HasRolePermission
from accounts.views import IsCustomer
from cart.models import Cart
from disputes.models import Dispute
from disputes.serializers import DisputeSerializer
from payments.models import CheckoutSession
from payments.services import process_payment

from .models import Order, OrderItem
from .serializers import (
    OrderDeliveryStatusUpdateSerializer,
    OrderDisputeCreateSerializer,
    OrderSerializer,
    StaffOrderSerializer,
)


class OrderCheckoutView(APIView):
    """POST /api/orders/checkout/ — takes the caller's current cart, requires
    it to be non-empty, creates an Order + OrderItems snapshotting each cart
    line, computes total_amount, and routes the payment through
    payments.services.process_payment() (docs/HUBTEL_INTEGRATION.md, plan
    Workstream E) rather than writing a billing.Transaction directly.

    In simulated mode (PAYMENTS_PROVIDER != "hubtel", the only mode exercised
    until real Hubtel credentials exist) this behaves exactly as before:
    the Transaction is created and the Order is marked `paid` and the cart
    emptied, all synchronously, in the same 201 response.

    In Hubtel mode, the Order is still created (PENDING) and the cart is
    left alone — nothing is paid for yet — and the response is instead
    `{"mode": "redirect", "checkout_url": ..., "reference": ...}` for the
    frontend to redirect to. The Order only moves to PAID, and the cart is
    only emptied, once payments.views.HubtelWebhookView confirms payment
    (see payments.services._finalize_order_checkout).
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

            result = process_payment(
                kind=CheckoutSession.ORDER_CHECKOUT,
                amount=total,
                purpose=f"AshantiHub Order #{order.id}",
                customer=request.user,
                metadata={"order_id": order.id},
            )

            if result["mode"] == "redirect":
                return Response(
                    {
                        "mode": "redirect",
                        "checkout_url": result["checkout_url"],
                        "reference": result["reference"],
                    },
                    status=status.HTTP_200_OK,
                )

            # Immediate/simulated mode — process_payment() has already
            # created the Transaction and run _finalize_order_checkout
            # (order.status = PAID) synchronously, exactly matching this
            # view's pre-existing behavior.
            order.refresh_from_db()
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


class OrderStaffPagination(PageNumberPagination):
    page_size = 20


class OrderStaffListView(generics.ListAPIView):
    """GET /api/orders/staff/ — all customer orders, staff-only
    (orders.manage_delivery), for delivery-status management.
    """

    serializer_class = StaffOrderSerializer
    queryset = Order.objects.select_related("customer").prefetch_related(
        "items__listing"
    ).order_by("-placed_at")
    pagination_class = OrderStaffPagination

    def get_permissions(self):
        return [HasRolePermission("orders.manage_delivery")]


class OrderDeliveryStatusUpdateView(generics.UpdateAPIView):
    """PATCH /api/orders/{id}/delivery-status/ — staff-only
    (orders.manage_delivery) update of an order's fulfillment status.
    """

    serializer_class = OrderDeliveryStatusUpdateSerializer
    queryset = Order.objects.all()
    http_method_names = ["patch"]

    def get_permissions(self):
        return [HasRolePermission("orders.manage_delivery")]


class OrderDisputeCreateView(APIView):
    """POST /api/orders/{id}/dispute/ — a signed-in customer who owns this
    order raises a dispute against it (reason + description). 404s for
    another customer's order (the lookup is pre-scoped to the caller, same
    convention as OrderDetailView above) rather than leaking a 403/whether
    the order exists at all. Creates the disputes.Dispute row directly:
    raised_by=request.user, status=Dispute.OPEN — this is what actually
    populates the staff dispute queue (disputes.views.DisputeListView).
    No restriction on how many disputes a customer can raise against the
    same order, or on the order's own status — a dispute can legitimately
    be raised over, e.g., a pending order's stuck payment too.
    """

    permission_classes = [IsAuthenticated, IsCustomer]

    def post(self, request, pk):
        order = generics.get_object_or_404(Order, pk=pk, customer=request.user)
        serializer = OrderDisputeCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        dispute = Dispute.objects.create(
            order=order,
            raised_by=request.user,
            reason=serializer.validated_data["reason"],
            description=serializer.validated_data["description"],
            status=Dispute.OPEN,
        )
        return Response(DisputeSerializer(dispute).data, status=status.HTTP_201_CREATED)
