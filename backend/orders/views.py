from decimal import Decimal

from django.db import transaction as db_transaction
from django.utils.crypto import get_random_string
from rest_framework import generics, status
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import HasRolePermission
from accounts.views import IsCustomer
from billing.models import Transaction
from cart.models import Cart
from disputes.models import Dispute
from disputes.serializers import DisputeSerializer

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
