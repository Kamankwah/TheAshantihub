from django.conf import settings
from decimal import Decimal

from django.db import transaction as db_transaction
from django.db.models import Prefetch
from django.utils import timezone
from rest_framework import generics, status
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import StaffUser
from accounts.permissions import HasRolePermission
from accounts.views import IsBusinessOwner, IsCustomer
from cart import guard as cart_guard
from cart.models import Cart
from delivery.models import DeliveryEvent
from disputes.models import Dispute
from listings.models import Listing
from disputes.serializers import DisputeSerializer
from notifications.services import notify_customer
from payments.models import CheckoutSession
from storefront.permissions import MarketplaceOpen
from marketing import checkout as promo_checkout
from marketing import code_guard
from marketing import promos
from marketing import waivers
from ledger import escrow, posting
from ledger.models import Account
from ledger.money import from_pesewas, to_pesewas
from payments.providers import get_provider
from payments.services import process_payment

from . import hold, locks
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


# How a customer pays at checkout (wallets plan 3a): by mobile money through the provider (the default, today's path)
# or from their AshantiHub wallet, which needs LEDGER_ENABLED.
MOMO, WALLET = "momo", "wallet"
PAYMENT_METHODS = (MOMO, WALLET)
WALLET_OFF = "Paying from your AshantiHub wallet isn't switched on yet."
WALLET_TOO_LOW = "Your AshantiHub wallet doesn't hold enough for this order."


class DeliveryPreviewView(APIView):
    """GET /api/orders/delivery-preview/?fulfilment=door_to_door — read from the caller's cart, independent of promotions:
    when delivery would wait for a closed vendor to open ({delivery_from, delivered_from, deferred, source})."""

    permission_classes = [IsAuthenticated, IsCustomer]

    def get(self, request):
        cart = Cart.objects.filter(customer=request.user).first()
        items = list(cart.items.select_related("listing")) if cart is not None else []
        return Response(hold.quote(items, request.query_params.get("fulfilment") or Order.DOOR_TO_DOOR))


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

    permission_classes = [IsAuthenticated, IsCustomer, MarketplaceOpen]

    def post(self, request):
        cart = Cart.objects.filter(customer=request.user).first()
        items = list(cart.items.select_related("listing__business_owner__profile", "listing__category")) if cart is not None else []
        if not items:
            return Response({"detail": "Your cart is empty."}, status=status.HTTP_400_BAD_REQUEST)

        payment_method = request.data.get("payment_method") or MOMO
        if payment_method not in PAYMENT_METHODS:
            return Response({"payment_method": "Pay by mobile money or from your AshantiHub wallet."}, status=status.HTTP_400_BAD_REQUEST)
        if payment_method == WALLET and not escrow.enabled():
            return Response({"detail": WALLET_OFF, "code": "ledger_off"}, status=status.HTTP_409_CONFLICT)
        processing = Decimal("0.00")

        # Delivery method + address (Wave F). Defaults to store pickup so an
        # older client that sends no delivery fields still checks out.
        delivery_method = request.data.get("delivery_method") or Order.STORE_PICKUP
        if delivery_method not in dict(Order.DELIVERY_METHOD_CHOICES):
            return Response(
                {"delivery_method": "Choose door-to-door delivery or store pickup."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        # The cart guard (cart.guard): a service or stay line refuses every method (the row may predate the rule); more
        # shops or food places than one delivery allows refuse door-to-door only, and so does a food place with no other
        # cart shop within the radius (checked below, from the planned route). The cart is left exactly as it is.
        try:
            cart_guard.check_checkout(items, delivery_method)
        except cart_guard.GuardError as exc:
            return Response(exc.body(), status=status.HTTP_400_BAD_REQUEST)
        delivery_address = (request.data.get("delivery_address") or "").strip()
        delivery_phone = (request.data.get("delivery_phone") or "").strip()
        if delivery_method == Order.DOOR_TO_DOOR and (not delivery_address or not delivery_phone):
            return Response(
                {"detail": "Door-to-door delivery needs a delivery address and phone number."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if delivery_method == Order.DOOR_TO_DOOR:
            from routing import region

            lat, lng = request.data.get("delivery_lat"), request.data.get("delivery_lng")
            if lat not in (None, "") and lng not in (None, "") and not region.in_service_area(lat, lng):
                return Response({"detail": region.OUT_OF_AREA_MESSAGE, "code": "out_of_area"}, status=status.HTTP_400_BAD_REQUEST)

        # The pickup route and the fee may call the road-routing service (a network round trip), so both are worked out
        # before the transaction opens: they need no row lock and must not hold a database transaction open while they wait.
        plan = None
        if delivery_method == Order.DOOR_TO_DOOR:
            from delivery.stops import plan_with_distances

            plan, distances = plan_with_distances(items, request.data.get("delivery_lat"), request.data.get("delivery_lng"))
            try:
                # The food radius from the planner's own table: no second routing call (cart.guard.check_food_radius).
                cart_guard.check_food_radius(items, distances=distances)
            except cart_guard.GuardError as exc:
                return Response(exc.body(), status=status.HTTP_400_BAD_REQUEST)
        quoted = None
        if settings.DELIVERY_FEE_ENABLED and delivery_method == Order.DOOR_TO_DOOR:
            from delivery.rates import checkout_fee

            quoted = checkout_fee(items, request.data.get("delivery_lat"), request.data.get("delivery_lng"), plan=plan)

        with db_transaction.atomic():
            # Checkout promotions (marketing): off unless settings.MARKETING_PROMOS_ENABLED, and
            # then priced here, before anything is reserved or written, under the flash-sale and
            # coupon row locks. With the switch off `promo` stays None and nothing below changes.
            promo = None
            if promos.enabled():
                if promo_checkout.normalise_code(request.data.get("coupon_code")) and code_guard.blocked(request):
                    return Response({"detail": code_guard.TOO_MANY}, status=status.HTTP_429_TOO_MANY_REQUESTS)
                try:
                    promo = promo_checkout.price(
                        request.user, items, request.data.get("coupon_code"), lock=True,
                        delivery_phone=delivery_phone if delivery_method == Order.DOOR_TO_DOOR else "",
                    )
                except promo_checkout.PromoError as exc:
                    code_guard.record_failure(request)
                    return Response({"detail": exc.message}, status=status.HTTP_400_BAD_REQUEST)

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
            if promo:
                total = promo.total  # net of any coupon
            # Delivery fee from the rate card in force, only when switched on (settings.DELIVERY_FEE_ENABLED,
            # default off). Fixed here, on the order; later card changes never touch it.
            fee_card, fee_quote, charged, waiver = None, None, None, None
            if quoted is not None:
                fee_card, fee_quote = quoted
                # A live free-delivery promo covering every line waives the fee (marketing.waivers);
                # the original amount stays in the breakdown. An AshantiHub-funded promo waives it only when the fee
                # fits in its budget cap, decided under the promo's row lock (a hard cap: concurrent checkouts wait).
                waiver = waivers.covering_waiver([i.listing for i in items], timezone.now(), fee=fee_quote["total"], lock=True)
                charged, fee_quote = waivers.apply_to_fee(waiver, fee_quote)
                total += charged
            order = Order.objects.create(
                customer=request.user, status=Order.PENDING, total_amount=total, ready_not_before=hold.for_items(items),
                delivery_fee=charged if fee_quote else None, delivery_fee_breakdown=fee_quote, rate_card=fee_card, route_plan=plan,
                **(promo.order_extras() if promo else {}),
                delivery_method=delivery_method,
                delivery_address=delivery_address if delivery_method == Order.DOOR_TO_DOOR else "",
                delivery_phone=delivery_phone if delivery_method == Order.DOOR_TO_DOOR else "",
                delivery_lat=request.data.get("delivery_lat") if delivery_method == Order.DOOR_TO_DOOR else None,
                delivery_lng=request.data.get("delivery_lng") if delivery_method == Order.DOOR_TO_DOOR else None,
            )
            if waiver is not None and fee_quote and fee_quote.get("waived"):
                waivers.record_charge(order, waiver, Decimal(fee_quote["waived"]["amount"]))
            if promo:
                promo_checkout.create_lines(order, promo)
                promo_checkout.record_redemption(order, promo, request.user)
            else:
                for item in items:
                    line_total = item.unit_price_snapshot * item.quantity
                    OrderItem.objects.create(
                        order=order,
                        listing=item.listing,
                        quantity=item.quantity,
                        unit_price=item.unit_price_snapshot,
                        line_total=line_total,
                    )

            # The provider's collection charge ("payment processing", spec §1 row 14) is paid on top of a MoMo payment
            # while the ledger is on; a wallet payment carries none. With the ledger off nothing is added.
            if escrow.enabled() and payment_method == MOMO:
                processing = from_pesewas(get_provider().collection_charge(to_pesewas(total)))
            try:
                with db_transaction.atomic():
                    result = process_payment(
                        kind=CheckoutSession.ORDER_CHECKOUT,
                        amount=total + processing,
                        processing_fee=processing,
                        wallet=payment_method == WALLET,
                        purpose=f"AshantiHub Order #{order.id}",
                        customer=request.user,
                        # stock_reservations lets _fail_order_checkout put the stock
                        # back if a (Hubtel-mode) payment later fails/expires. "ledger" tells the nightly
                        # reconciliation (wallets plan 3b) that the ledger was asked to record this payment.
                        metadata={
                            "order_id": order.id, "stock_reservations": reservations,
                            **({"promos": True} if promo else {}), **({"ledger": True} if escrow.enabled() else {}),
                        },
                    )
            except posting.InsufficientFunds as exc:
                if exc.account.kind != Account.CUSTOMER_WALLET:
                    raise
                # Nothing is paid in part: the order, its lines, the stock reservation and any coupon use all roll back.
                db_transaction.set_rollback(True)
                return Response({"detail": WALLET_TOO_LOW, "code": "insufficient_funds"}, status=status.HTTP_409_CONFLICT)

            if result["mode"] == "redirect":
                redirect = {
                    "mode": "redirect",
                    "checkout_url": result["checkout_url"],
                    "reference": result["reference"],
                }
                if escrow.enabled():
                    redirect["payment_processing"] = str(processing)
                return Response(redirect, status=status.HTTP_200_OK)

            # Immediate/simulated mode — process_payment() has already
            # created the Transaction and run _finalize_order_checkout
            # (order.status = PAID) synchronously, exactly matching this
            # view's pre-existing behavior.
            order.refresh_from_db()
            cart.items.all().delete()

        body = OrderSerializer(order).data
        if escrow.enabled():
            body = {**body, "payment_method": payment_method, "payment_processing": str(processing)}
        return Response(body, status=status.HTTP_201_CREATED)


class OrderListView(generics.ListAPIView):
    """GET /api/orders/ — the caller's own order history."""

    serializer_class = OrderSerializer
    permission_classes = [IsAuthenticated, IsCustomer]

    def get_queryset(self):
        return _customer_orders(self.request.user)


class OrderDetailView(generics.RetrieveAPIView):
    """GET /api/orders/{id}/ — confirmation-page detail. 404s for another
    customer's order (the queryset is scoped to the caller).
    """

    serializer_class = OrderSerializer
    permission_classes = [IsAuthenticated, IsCustomer]

    def get_queryset(self):
        return _customer_orders(self.request.user)


# The delivery fields read the saved stops; a job from before multi-stop delivery has none and is read as one stop at
# its first item's business (its pin and category). Prefetched so a page costs the same number of queries however many
# orders it holds.
_LEGACY_STOP_READS = ("items__listing__business_owner__profile", "items__listing__category")


def _customer_orders(customer):
    return (
        Order.objects.filter(customer=customer).select_related("delivery_assignment", "coupon", "fulfilment_check")
        .prefetch_related("delivery_assignment__stops", *_LEGACY_STOP_READS, _open_redeliveries())
    )


def _open_redeliveries():
    """An order's open re-delivery request (Plan 7F-E Task 7), read by OrderSerializer, in one query for the whole list."""
    from django.db.models import Prefetch

    from delivery.models import Redelivery

    return Prefetch(
        "redeliveries", queryset=Redelivery.objects.filter(status__in=Redelivery.OPEN_STATUSES).order_by("-attempt"),
        to_attr="open_redeliveries",
    )


def _assignment_of(order):
    return (
        DeliveryAssignment.objects.select_related("order", "dispatch", "dispatch__rider")
        .prefetch_related("stops__business_owner__profile", "order__items__listing__business_owner__profile", "order__items__listing__category")
        .filter(order=order).first()
    )


class OrderTrackingView(APIView):
    """GET /api/orders/{id}/tracking/ - the buyer's map. Scoped to the caller's own orders (another
    customer's order is a 404); the rider shows only after pickup, as a first name and vehicle type."""

    permission_classes = [IsAuthenticated, IsCustomer]

    def get(self, request, pk):
        from delivery import tracking

        order = generics.get_object_or_404(Order, pk=pk, customer=request.user)
        assignment = _assignment_of(order)
        if assignment is None:
            return Response({"stage": "not_assigned"})
        return Response(tracking.customer_map(assignment))


class OwnerOrderTrackingView(APIView):
    """GET /api/orders/owner/{id}/tracking/ - the vendor's map. Scoped like OwnerOrderListView (a paid order
    with one of the caller's listings; anything else is a 404). Never carries the customer's address, pin or phone,
    and shows only the caller's own pickup stop (tracking.business_map)."""

    permission_classes = [IsAuthenticated, IsBusinessOwner]

    def get(self, request, pk):
        from delivery import tracking

        order = generics.get_object_or_404(
            Order.objects.filter(status=Order.PAID, items__listing__business_owner=request.user).distinct(), pk=pk
        )
        assignment = _assignment_of(order)
        if assignment is None:
            return Response({"stage": "not_assigned"})
        return Response(tracking.business_map(assignment, request.user))


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
            .select_related("customer", "delivery_assignment", "delivery_assignment__dispatch")
            .prefetch_related(
                "delivery_assignment__stops__business_owner__profile", *_LEGACY_STOP_READS,
                # Only the skip events are read (the rider's report at this owner's stop).
                Prefetch("delivery_assignment__events", queryset=DeliveryEvent.objects.filter(step=DeliveryEvent.SKIPPED_STOP)),
            )
            .distinct()
            .order_by("-placed_at")
        )

    def get_serializer_context(self):
        return {**super().get_serializer_context(), "owner": self.request.user}


# ── Owner sales report (business item 4 / Wave I) ──────────────────────────
class _OwnerSalesReportBase(APIView):
    """Shared query for the owner's sales report: their own OrderItems in PAID
    orders, with date-range and product/service-kind filters. The owner sees
    the customer *sales* of their listings here — distinct from the outgoing
    subscription/promotion spend on their own transactions ledger.
    """

    permission_classes = [IsAuthenticated, IsBusinessOwner]

    def _rows(self, request):
        from django.utils.dateparse import parse_date

        qs = (
            OrderItem.objects.filter(
                order__status=Order.PAID, listing__business_owner=request.user
            )
            .select_related("order", "order__customer", "listing", "listing__category")
            .order_by("-order__placed_at")
        )
        date_from = parse_date(request.query_params.get("date_from") or "")
        if date_from:
            qs = qs.filter(order__placed_at__date__gte=date_from)
        date_to = parse_date(request.query_params.get("date_to") or "")
        if date_to:
            qs = qs.filter(order__placed_at__date__lte=date_to)
        kind = request.query_params.get("kind")
        if kind in ("product", "service"):
            qs = qs.filter(listing__category__kind=kind)
        return [
            {
                "order_id": item.order_id,
                "date": item.order.placed_at.isoformat(),
                "customer": item.order.customer.full_name,
                "item": item.listing.name,
                "kind": item.listing.category.kind if item.listing.category else "",
                "quantity": item.quantity,
                "line_total": str(item.line_total),
            }
            for item in qs
        ]


class OwnerSalesReportView(_OwnerSalesReportBase):
    """GET /api/orders/owner/report/?date_from=&date_to=&kind= — aggregate
    sales summary + a monthly series + the (capped) rows for the UI table.
    """

    def get(self, request):
        rows = self._rows(request)
        total = sum((Decimal(r["line_total"]) for r in rows), Decimal("0.00"))
        series = {}
        for r in rows:
            month = r["date"][:7]
            series[month] = series.get(month, Decimal("0.00")) + Decimal(r["line_total"])
        return Response({
            "summary": {
                "total_sales": str(total),
                "order_count": len({r["order_id"] for r in rows}),
                "item_count": len(rows),
            },
            "series": [{"month": m, "amount": str(a)} for m, a in sorted(series.items())],
            # The table shows a capped preview; the CSV export carries every row.
            "rows": rows[:200],
        })


class OwnerSalesReportExportView(_OwnerSalesReportBase):
    """GET /api/orders/owner/report/export/?... — the same filtered sales data
    as a CSV download (business item 4). First CSV export in the codebase.
    """

    def get(self, request):
        import csv

        from django.http import HttpResponse

        response = HttpResponse(content_type="text/csv")
        response["Content-Disposition"] = 'attachment; filename="ashantihub-sales.csv"'
        writer = csv.writer(response)
        writer.writerow(["Order", "Date", "Customer", "Item", "Kind", "Quantity", "Line total (GHS)"])
        for r in self._rows(request):
            writer.writerow([r["order_id"], r["date"][:10], r["customer"], r["item"], r["kind"], r["quantity"], r["line_total"]])
        return response


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


def _task_the_account_managers(dispute):
    """A delivery dispute tasks the business's account manager. Best effort: a
    failure here never costs the customer their dispute."""
    import logging

    from portfolio.delivery import task_for_dispute

    try:
        with db_transaction.atomic():
            task_for_dispute(dispute)
    except Exception:
        logging.getLogger(__name__).exception("Delivery-problem task for dispute %s failed", dispute.pk)


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
        _task_the_account_managers(dispute)
        return Response(DisputeSerializer(dispute).data, status=status.HTTP_201_CREATED)


# ── Door-to-door delivery (punch-list item 11) ─────────────────────────────
class DeliveryPagination(PageNumberPagination):
    page_size = 20


def _sync_order_delivery_status(order, assignment_status):
    """Keep Order.delivery_status roughly in step with the courier's progress
    so the customer's existing delivery stepper reflects reality.
    """
    stub = DeliveryAssignment(order=order, status=assignment_status)
    stub.sync_order()


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
        from django.http import Http404

        from delivery import services as delivery_services

        with db_transaction.atomic():
            try:
                order = locks.lock_order(pk)  # the order row before its assignment (orders/locks.py)
            except Order.DoesNotExist:
                raise Http404 from None
            if order.status != Order.PAID or order.delivery_method != Order.DOOR_TO_DOOR:
                return Response(
                    {"detail": "Only a paid door-to-door order can be assigned a dispatch."},
                    status=400,
                )
            if delivery_services.is_held(order):
                return Response(delivery_services.not_due_error(order).body(), status=409)
            dispatch = generics.get_object_or_404(StaffUser, pk=request.data.get("dispatch"))
            if dispatch.role.name != "dispatch":
                return Response({"dispatch": "That staff member is not a dispatch."}, status=400)
            try:
                assignment = delivery_services.assign(order, dispatch, request.user, mode=DeliveryAssignment.MANUAL)
            except delivery_services.DeliveryError as exc:
                return Response(exc.body(), status=exc.status_code)
            _sync_order_delivery_status(order, assignment.status)
        notify_customer(
            order.customer, "order_status", "Your delivery is on its way",
            body=f"A courier has been assigned to Order #{order.id}.",
            link="/my-account", icon="🚚",
        )
        return Response(DeliveryOrderSerializer(order).data)


class DispatchMapView(APIView):
    """GET /api/orders/dispatch/<pk>/map/ — the map for the dispatch's own assignment (delivery.dispatch);
    another dispatcher's assignment is a 404."""

    def get_permissions(self):
        return [HasRolePermission("delivery.dispatch")]

    def get(self, request, pk):
        from django.shortcuts import get_object_or_404

        from delivery import tracking

        assignment = get_object_or_404(
            DeliveryAssignment.objects.select_related("order", "order__customer", "dispatch", "dispatch__rider")
            .prefetch_related("order__items__listing__business_owner__profile", "order__items__listing__category", "stops__business_owner__profile"),
            pk=pk, dispatch=request.user,
        )
        return Response(tracking.manager_job_map(assignment))


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
        from delivery import services as delivery_services

        assignment = locks.lock_job_or_404(pk, dispatch_id=request.user.pk)  # the order row first (orders/locks.py)
        try:
            delivery_services.legacy_pickup(assignment, request.user, request.data.get("code"))
        except delivery_services.DeliveryError as exc:
            return Response(exc.body(), status=exc.status_code)
        return Response(DispatchDeliverySerializer(assignment).data)


class DeliveryDeliverView(APIView):
    """POST /api/orders/delivery/{id}/deliver/ — the dispatch confirms they've
    delivered to the customer (delivery.dispatch). picked_up → delivered. The
    customer then confirms receipt separately.
    """

    def get_permissions(self):
        return [HasRolePermission("delivery.dispatch")]

    def post(self, request, pk):
        from delivery import services as delivery_services

        assignment = locks.lock_job_or_404(pk, dispatch_id=request.user.pk)  # the order row first (orders/locks.py)
        try:
            delivery_services.legacy_deliver(assignment, request.user, request.data.get("code"))
        except delivery_services.DeliveryError as exc:
            return Response(exc.body(), status=exc.status_code)
        return Response(DispatchDeliverySerializer(assignment).data)


class ConfirmReceiptView(APIView):
    """POST /api/orders/{id}/confirm-receipt/ — the customer confirms they
    received a delivered order (IsCustomer, owns the order). delivered →
    confirmed. Closes the loop the dispatch's "deliver" opened.
    """

    permission_classes = [IsAuthenticated, IsCustomer]

    def post(self, request, pk):
        generics.get_object_or_404(Order, pk=pk, customer=request.user)
        with db_transaction.atomic():
            order = locks.lock_order(pk)  # it writes the assignment and the order: the order row first (orders/locks.py)
            assignment = locks.lock_assignment(order)
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
