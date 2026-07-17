from decimal import Decimal

from django.db import transaction as db_transaction
from django.utils import timezone
from rest_framework import generics, status
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import StaffUser
from accounts.permissions import HasRolePermission
from accounts.views import IsBusinessOwner, IsCustomer
from cart.models import Cart
from disputes.models import Dispute
from listings.models import Listing
from disputes.serializers import DisputeSerializer
from notifications.services import notify_customer
from payments.models import CheckoutSession
from payments.services import process_payment

from .models import DeliveryAssignment, Order, OrderItem
from .serializers import (
    DeliveryOrderSerializer,
    DispatchDeliverySerializer,
    OrderDeliveryStatusUpdateSerializer,
    OrderDisputeCreateSerializer,
    OrderSerializer,
    OwnerOrderSerializer,
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

        # Delivery method + address (Wave F). Defaults to store pickup so an
        # older client that sends no delivery fields still checks out.
        delivery_method = request.data.get("delivery_method") or Order.STORE_PICKUP
        if delivery_method not in dict(Order.DELIVERY_METHOD_CHOICES):
            return Response(
                {"delivery_method": "Choose door-to-door delivery or store pickup."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        delivery_address = (request.data.get("delivery_address") or "").strip()
        delivery_phone = (request.data.get("delivery_phone") or "").strip()
        if delivery_method == Order.DOOR_TO_DOOR and (not delivery_address or not delivery_phone):
            return Response(
                {"detail": "Door-to-door delivery needs a delivery address and phone number."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        with db_transaction.atomic():
            # Lock the tracked listings and check stock before creating
            # anything. A listing with stock_quantity=None isn't inventory-
            # tracked (services, or products the owner hasn't set a count on)
            # and is never decremented. Mirrors the ticket flow's optimistic
            # reserve-at-checkout, rolled back on payment failure below.
            reservations = []
            for item in items:
                listing = Listing.objects.select_for_update().get(pk=item.listing_id)
                if listing.stock_quantity is not None:
                    if listing.stock_quantity < item.quantity:
                        return Response(
                            {"detail": f"Only {listing.stock_quantity} of “{listing.name}” left in stock."},
                            status=status.HTTP_400_BAD_REQUEST,
                        )
                    listing.stock_quantity -= item.quantity
                    listing.save(update_fields=["stock_quantity"])
                    reservations.append({"listing_id": listing.id, "quantity": item.quantity})

            total = sum(
                (item.unit_price_snapshot * item.quantity for item in items), Decimal("0.00")
            )
            order = Order.objects.create(
                customer=request.user, status=Order.PENDING, total_amount=total,
                delivery_method=delivery_method,
                delivery_address=delivery_address if delivery_method == Order.DOOR_TO_DOOR else "",
                delivery_phone=delivery_phone if delivery_method == Order.DOOR_TO_DOOR else "",
                delivery_lat=request.data.get("delivery_lat") if delivery_method == Order.DOOR_TO_DOOR else None,
                delivery_lng=request.data.get("delivery_lng") if delivery_method == Order.DOOR_TO_DOOR else None,
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
                # stock_reservations lets _fail_order_checkout put the stock
                # back if a (Hubtel-mode) payment later fails/expires.
                metadata={"order_id": order.id, "stock_reservations": reservations},
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


class OrderOwnerPagination(PageNumberPagination):
    page_size = 20


class OwnerOrderListView(generics.ListAPIView):
    """GET /api/orders/owner/ — a business owner's own sales: paid orders that
    contain at least one of their listings. The serializer exposes only the
    owner's own line items (a shared order may span multiple businesses), so
    this endpoint never leaks another business's items even though the
    underlying Order row is shared. Foundation for the business Products tab
    (Wave H) and item 11's Delivery Manager.
    """

    serializer_class = OwnerOrderSerializer
    permission_classes = [IsAuthenticated, IsBusinessOwner]
    pagination_class = OrderOwnerPagination

    def get_queryset(self):
        return (
            Order.objects.filter(
                status=Order.PAID, items__listing__business_owner=self.request.user
            )
            .prefetch_related("items__listing")
            .distinct()
            .order_by("-placed_at")
        )

    def get_serializer_context(self):
        return {**super().get_serializer_context(), "owner": self.request.user}


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

    def perform_update(self, serializer):
        order = serializer.save()
        notify_customer(
            order.customer, "order_status", "Order update",
            body=f"Order #{order.id} is now {order.get_delivery_status_display().lower()}.",
            link="/my-account", icon="🚚",
        )


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


# ── Door-to-door delivery (punch-list item 11) ─────────────────────────────
class DeliveryPagination(PageNumberPagination):
    page_size = 20


def _sync_order_delivery_status(order, assignment_status):
    """Keep Order.delivery_status roughly in step with the courier's progress
    so the customer's existing delivery stepper reflects reality.
    """
    mapping = {
        DeliveryAssignment.ASSIGNED: Order.PROCESSING,
        DeliveryAssignment.PICKED_UP: Order.OUT_FOR_DELIVERY,
        DeliveryAssignment.DELIVERED: Order.DELIVERED,
        DeliveryAssignment.CONFIRMED: Order.DELIVERED,
    }
    new_status = mapping.get(assignment_status)
    if new_status and order.delivery_status != new_status:
        order.delivery_status = new_status
        order.save(update_fields=["delivery_status"])


class DeliveryManagerOrderListView(generics.ListAPIView):
    """GET /api/orders/delivery/ — paid door-to-door orders for the Delivery
    Manager (delivery.manage) to assign a dispatch to. Store-pickup orders are
    excluded: they're collected, not delivered.
    """

    serializer_class = DeliveryOrderSerializer
    pagination_class = DeliveryPagination

    def get_permissions(self):
        return [HasRolePermission("delivery.manage")]

    def get_queryset(self):
        return (
            Order.objects.filter(status=Order.PAID, delivery_method=Order.DOOR_TO_DOOR)
            .select_related("customer", "delivery_assignment", "delivery_assignment__dispatch")
            .prefetch_related("items__listing")
            .order_by("-placed_at")
        )


class DispatchListView(generics.ListAPIView):
    """GET /api/orders/dispatches/ — active dispatch staff, so the Delivery
    Manager can pick one to assign (delivery.manage).
    """

    serializer_class = None  # simple hand-built payload below

    def get_permissions(self):
        return [HasRolePermission("delivery.manage")]

    def get(self, request, *args, **kwargs):
        dispatches = StaffUser.objects.filter(
            role__name="dispatch", is_active=True, is_suspended=False
        ).order_by("full_name")
        return Response([{"id": d.id, "full_name": d.full_name} for d in dispatches])


class AssignDispatchView(APIView):
    """POST /api/orders/{id}/assign-dispatch/ — the Delivery Manager assigns a
    dispatch to a paid door-to-door order (delivery.manage). Body: {dispatch}.
    Re-assigning an existing assignment just swaps the dispatch.
    """

    def get_permissions(self):
        return [HasRolePermission("delivery.manage")]

    def post(self, request, pk):
        order = generics.get_object_or_404(Order, pk=pk)
        if order.status != Order.PAID or order.delivery_method != Order.DOOR_TO_DOOR:
            return Response(
                {"detail": "Only a paid door-to-door order can be assigned a dispatch."},
                status=400,
            )
        dispatch = generics.get_object_or_404(StaffUser, pk=request.data.get("dispatch"))
        if dispatch.role.name != "dispatch":
            return Response({"dispatch": "That staff member is not a dispatch."}, status=400)

        assignment, _ = DeliveryAssignment.objects.update_or_create(
            order=order,
            defaults={"dispatch": dispatch, "assigned_by": request.user},
        )
        _sync_order_delivery_status(order, assignment.status)
        notify_customer(
            order.customer, "order_status", "Your delivery is on its way",
            body=f"A courier has been assigned to Order #{order.id}.",
            link="/my-account", icon="🚚",
        )
        return Response(DeliveryOrderSerializer(order).data)


class MyDeliveriesView(generics.ListAPIView):
    """GET /api/orders/dispatch/ — the dispatch's own assigned deliveries
    (delivery.dispatch), with both pickup and drop-off locations.
    """

    serializer_class = DispatchDeliverySerializer
    pagination_class = DeliveryPagination

    def get_permissions(self):
        return [HasRolePermission("delivery.dispatch")]

    def get_queryset(self):
        return (
            DeliveryAssignment.objects.filter(dispatch=self.request.user)
            .select_related("order", "order__customer")
            .prefetch_related("order__items__listing__business_owner")
            .order_by("-assigned_at")
        )


class DeliveryPickupView(APIView):
    """POST /api/orders/delivery/{id}/pickup/ — the dispatch confirms they've
    collected the items from the business (delivery.dispatch). assigned →
    picked_up.
    """

    def get_permissions(self):
        return [HasRolePermission("delivery.dispatch")]

    def post(self, request, pk):
        assignment = generics.get_object_or_404(
            DeliveryAssignment, pk=pk, dispatch=request.user
        )
        if assignment.status != DeliveryAssignment.ASSIGNED:
            return Response({"detail": "This delivery is not awaiting pickup."}, status=400)
        assignment.status = DeliveryAssignment.PICKED_UP
        assignment.picked_up_at = timezone.now()
        assignment.save(update_fields=["status", "picked_up_at"])
        _sync_order_delivery_status(assignment.order, assignment.status)
        return Response(DispatchDeliverySerializer(assignment).data)


class DeliveryDeliverView(APIView):
    """POST /api/orders/delivery/{id}/deliver/ — the dispatch confirms they've
    delivered to the customer (delivery.dispatch). picked_up → delivered. The
    customer then confirms receipt separately.
    """

    def get_permissions(self):
        return [HasRolePermission("delivery.dispatch")]

    def post(self, request, pk):
        assignment = generics.get_object_or_404(
            DeliveryAssignment, pk=pk, dispatch=request.user
        )
        if assignment.status != DeliveryAssignment.PICKED_UP:
            return Response({"detail": "This delivery has not been picked up yet."}, status=400)
        assignment.status = DeliveryAssignment.DELIVERED
        assignment.delivered_at = timezone.now()
        assignment.save(update_fields=["status", "delivered_at"])
        _sync_order_delivery_status(assignment.order, assignment.status)
        notify_customer(
            assignment.order.customer, "order_status", "Your order has been delivered",
            body=f"Order #{assignment.order_id} has been delivered — please confirm you received it.",
            link="/my-account", icon="📦",
        )
        return Response(DispatchDeliverySerializer(assignment).data)


class ConfirmReceiptView(APIView):
    """POST /api/orders/{id}/confirm-receipt/ — the customer confirms they
    received a delivered order (IsCustomer, owns the order). delivered →
    confirmed. Closes the loop the dispatch's "deliver" opened.
    """

    permission_classes = [IsAuthenticated, IsCustomer]

    def post(self, request, pk):
        order = generics.get_object_or_404(Order, pk=pk, customer=request.user)
        assignment = getattr(order, "delivery_assignment", None)
        if assignment is None:
            return Response({"detail": "This order has no delivery to confirm."}, status=400)
        if assignment.status != DeliveryAssignment.DELIVERED:
            return Response(
                {"detail": "You can only confirm receipt once the courier marks it delivered."},
                status=400,
            )
        assignment.status = DeliveryAssignment.CONFIRMED
        assignment.confirmed_at = timezone.now()
        assignment.save(update_fields=["status", "confirmed_at"])
        _sync_order_delivery_status(order, assignment.status)
        return Response({"id": order.id, "status": assignment.status})
