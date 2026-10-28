"""The Support desk's Order status screen: find an order, read where it really
is, and take the two actions Support is allowed (running late, cancelled by the
customer). It never sets Delivered: that stays with the courier's confirmation.

`delivery_events_for(order)` is the one place the order's timeline is built.
It lists only moments that carry a stamp in the data today; the Delivery phase
extends it with check-ins and codes instead of building a second timeline."""
from django.conf import settings
from django.db import transaction
from django.db.models import Q
from rest_framework import generics, serializers
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.claims import mask_email
from accounts.emails import _send
from accounts.permissions import HasRolePermission
from accounts.phones import filter_by_phone, mask_phone, phone_key
from ledger.money import from_pesewas
from notifications.services import notify_customer

from .models import DeliveryAssignment, Order, OrderSupportNote

PERMISSION = "orders.support_update"
SEARCH_CAP = 20
NOT_PICKED_UP = (Order.PROCESSING,)


def delivery_events_for(order):
    """The order's timeline, oldest first: [{"key", "at", "label", "detail"}].
    Placed (with payment state), the courier's recorded times, and Support's own
    notes. A step with no stamp is not listed, so nothing is guessed."""
    events = [{
        "key": "placed", "at": order.placed_at,
        "label": "Placed", "detail": f"Payment {order.get_status_display().lower()}",
    }]
    assignment = getattr(order, "delivery_assignment", None)
    if assignment is not None:
        who = assignment.dispatch.full_name if assignment.dispatch_id else "a rider"
        events.append({"key": "assigned", "at": assignment.assigned_at, "label": "Rider assigned", "detail": who})
        if assignment.picked_up_at:
            events.append({"key": "picked_up", "at": assignment.picked_up_at, "label": "Picked up from the business", "detail": ""})
        if assignment.delivered_at:
            events.append({"key": "delivered", "at": assignment.delivered_at, "label": "Delivered to the customer", "detail": ""})
        if assignment.confirmed_at:
            events.append({"key": "confirmed", "at": assignment.confirmed_at, "label": "Receipt confirmed by the customer", "detail": ""})
    for note in order.support_notes.all():
        label = "Support: running late" if note.kind == OrderSupportNote.RUNNING_LATE else "Cancelled at the customer's request"
        detail = note.reason
        if note.expected_time:
            detail = f"New expected time: {note.expected_time}. {detail}"
        events.append({"key": note.kind, "at": note.created_at, "label": label, "detail": detail})
    return sorted(events, key=lambda event: event["at"])


def _picked_up(order):
    """True once the order has left the business: a courier pickup stamp or any
    delivery status past processing."""
    assignment = getattr(order, "delivery_assignment", None)
    if assignment is not None and assignment.status != DeliveryAssignment.ASSIGNED:
        return True
    return order.delivery_status != Order.PROCESSING


def allowed_actions(order):
    if order.status == Order.CANCELLED or order.delivery_status == Order.DELIVERED:
        return []
    actions = []
    if order.status == Order.PAID:
        actions.append(OrderSupportNote.RUNNING_LATE)
    if not _picked_up(order):
        actions.append(OrderSupportNote.CANCELLED_BY_CUSTOMER)
    return actions


def payments_note():
    """The payments banner, built from settings.PAYMENTS_PROVIDER."""
    provider = settings.PAYMENTS_PROVIDER
    if provider == "hubtel":
        return {"provider": provider, "text": ""}
    return {"provider": provider, "text": f"Payments are {provider} until Hubtel is connected, so no money moves."}


def return_stock(order):
    """Put the stock an order reserved at checkout back on the shelf (tracked listings only). The listing rows are
    locked in one pass in primary-key order, so a cancel or the pickup job never deadlocks with a checkout."""
    from listings import variants
    from listings.models import Listing, ListingVariant

    plain, bought = {}, {}
    for line in order.items.all():
        if line.variant_id is None:
            plain[line.listing_id] = plain.get(line.listing_id, 0) + line.quantity
        else:
            bought[line.variant_id] = (line.listing_id, bought.get(line.variant_id, (0, 0))[1] + line.quantity)
    listing_ids = set(plain) | {listing_id for listing_id, _ in bought.values()}
    listings = {row.pk: row for row in Listing.objects.select_for_update().filter(pk__in=listing_ids).order_by("pk")}
    for listing_id, quantity in plain.items():
        listing = listings[listing_id]
        if listing.stock_quantity is not None:
            listing.stock_quantity += quantity
            listing.save(update_fields=["stock_quantity"])
    touched = set()
    for row in ListingVariant.objects.select_for_update().filter(pk__in=bought).order_by("pk"):
        if row.stock_quantity is not None:
            row.stock_quantity += bought[row.pk][1]
            row.save(update_fields=["stock_quantity"])
        touched.add(row.listing_id)
    for listing_id in sorted(touched):
        variants.sync_listing(listings[listing_id])


def _base():
    return Order.objects.select_related("customer", "delivery_assignment__dispatch").prefetch_related(
        "items__listing__business_owner__profile", "support_notes"
    )


def _businesses(order):
    return sorted({line.listing.business_owner.display_name for line in order.items.all()})


def _row(order):
    return {
        "id": order.pk, "customer": order.customer.full_name,
        "customer_phone": mask_phone(order.customer.phone) if order.customer.phone else "",
        "businesses": _businesses(order), "total": str(order.total_amount), "status": order.status,
        "delivery_status": order.delivery_status, "delivery_method": order.delivery_method,
        "placed_at": order.placed_at,
    }


def _refundable(order):
    """What can still be refunded to the customer, as a string (ledger.refunds.refundable), or None while the ledger is off
    or for an order paid before it was on."""
    from ledger.money import from_pesewas
    from ledger.refunds import refundable

    amount = refundable(order)
    return str(from_pesewas(amount)) if amount is not None else None


class SupportOrderSearchView(APIView):
    """GET /api/orders/support/?q= — by order number, customer name or phone
    (nine or more digits). Without q, the latest orders. Phones come back masked."""

    def get_permissions(self):
        return [HasRolePermission(PERMISSION)]

    def get(self, request):
        text = (request.query_params.get("q") or "").strip()
        orders = _base()
        if text:
            match = Q(customer__full_name__icontains=text)
            number = text.lstrip("#")
            if number.isdecimal() and len(number) < 10:
                match |= Q(pk=int(number))
            found = orders.filter(match)
            if phone_key(text):
                found = found | filter_by_phone(orders, "customer__phone", text) | filter_by_phone(orders, "delivery_phone", text)
            orders = found
        rows = [_row(order) for order in orders.distinct().order_by("-placed_at", "-id")[:SEARCH_CAP]]
        recent = list(
            OrderSupportNote.objects.filter(staff=request.user).order_by("-created_at")
            .values_list("order_id", flat=True)[:20]
        )
        seen = []
        for pk in recent:
            if pk not in seen:
                seen.append(pk)
        return Response({"results": rows, "recent": seen[:5]})


def _redelivery_fields(order):
    """Whether Support may ask for a re-delivery at the customer's request now, and the fee it would carry (the governed
    setting in force; the request copies it). Plan 7F-E Task 7. False and no fee while the ledger is off."""
    from delivery import redelivery
    from ledger import settings_store
    from ledger.money import from_pesewas

    if not redelivery.redeliverable(order):
        return {"redeliverable": False}
    return {"redeliverable": True, "redelivery_fee": str(from_pesewas(settings_store.current(settings_store.REDELIVERY_FEE)))}


class SupportOrderDetailView(APIView):
    """GET /api/orders/support/<pk>/ — one order for the Support screen."""

    def get_permissions(self):
        return [HasRolePermission(PERMISSION)]

    def get(self, request, pk):
        order = generics.get_object_or_404(_base(), pk=pk)
        assignment = getattr(order, "delivery_assignment", None)
        customer = order.customer
        data = _row(order)
        data.update({
            "customer_id": customer.pk,
            "customer_email": mask_email(customer.email) if customer.email else "",
            "delivery_address": order.delivery_address,
            "delivery_phone": mask_phone(order.delivery_phone) if order.delivery_phone else "",
            "lines": [
                {
                    "name": line.listing.name, "quantity": line.quantity, "line_total": str(line.line_total),
                    "business": line.listing.business_owner.display_name,
                }
                for line in order.items.all()
            ],
            "rider": assignment.dispatch.full_name if assignment is not None and assignment.dispatch_id else None,
            "refundable": _refundable(order),
            "timeline": delivery_events_for(order),
            "actions": allowed_actions(order),
            "payments": payments_note(),
            **_redelivery_fields(order),
            "delivery_note": (
                "Arrives with Delivery: arrival and wait stamps, handover codes, the rider's last location "
                "and 'can't deliver' outcomes are not recorded yet."
            ),
        })
        return Response(data)


class SupportStatusInputSerializer(serializers.Serializer):
    status = serializers.CharField()
    reason = serializers.CharField(max_length=1000)
    expected_time = serializers.CharField(max_length=80, required=False, allow_blank=True, default="")


class SupportOrderStatusView(APIView):
    """POST /api/orders/<pk>/support-status/ {status, reason, expected_time?}.

    Two statuses only: running_late (a note and the new expected time as text;
    delivery_status untouched) and cancelled_by_customer (only before pickup).
    Anything else, Delivered included, is a 400. The customer is told in-app
    and by email; the note is kept on the order."""

    def get_permissions(self):
        return [HasRolePermission(PERMISSION)]

    def post(self, request, pk):
        serializer = SupportStatusInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        kind = data["status"]
        if kind not in dict(OrderSupportNote.KIND_CHOICES):
            return Response(
                {"status": "Support can only mark an order running late or cancelled by the customer."}, status=400
            )
        reason = data["reason"].strip()
        if not reason:
            return Response({"reason": "A reason is required."}, status=400)
        expected = data["expected_time"].strip()
        if kind == OrderSupportNote.RUNNING_LATE and not expected:
            return Response({"expected_time": "Say when it is now expected."}, status=400)
        with transaction.atomic():
            order = generics.get_object_or_404(Order.objects.select_for_update(of=("self",)), pk=pk)
            order = _base().get(pk=order.pk)
            if kind not in allowed_actions(order):
                return Response({"detail": "This order can no longer be changed that way."}, status=409)
            note = OrderSupportNote.objects.create(
                order=order, staff=request.user, kind=kind, reason=reason,
                expected_time=expected if kind == OrderSupportNote.RUNNING_LATE else "",
            )
            refund = None
            if kind == OrderSupportNote.CANCELLED_BY_CUSTOMER:
                refund = self._cancel(order, request.user)
        self._tell_customer(order, note, refund)
        order = _base().get(pk=order.pk)
        return Response({
            "id": order.pk, "status": order.status, "delivery_status": order.delivery_status,
            "timeline": delivery_events_for(order), "actions": allowed_actions(order),
        })

    @staticmethod
    def _cancel(order, staff=None):
        """Cancel through the order's own fields: stock reserved at checkout goes
        back on the shelf (tracked listings only), a courier assignment not yet
        picked up is withdrawn. With the ledger on, a paid order's money goes back to
        the customer's AshantiHub wallet in full (ledger.refunds; the payment-processing
        charge stays with the provider, because the customer asked to cancel). Returns
        that OrderRefund, or None (ledger off, not paid, or paid before the ledger was on).
        Must run inside a transaction: it takes the order, fee-snapshot and assignment row locks."""
        from django.utils import timezone

        from delivery.models import DeliveryEvent
        from ledger import riders
        from ledger.models import OrderFeeSnapshot

        from . import locks

        # Canonical lock order (orders/locks.py): order row, fee snapshots, then the assignment; refund_order follows.
        locked = locks.lock_order(order.pk)
        list(OrderFeeSnapshot.objects.select_for_update(of=("self",)).filter(order=order, reversed_at__isnull=True).order_by("pk"))
        return_stock(order)
        # The assignment goes through the canonical lock. After a pickup the row is the evidence
        # ledger.riders.pickup_made / delivery_earned read, so it is kept and failed, never deleted: the rider is paid
        # and the delivery fee is not returned. Before a pickup it is withdrawn, as always.
        assignment = locks.lock_assignment(locked)
        if assignment is not None:
            if riders.pickup_made(order) is None:
                assignment.delete()
            else:
                now = timezone.now()
                assignment.status = DeliveryAssignment.FAILED
                assignment.failed_reason = "order_cancelled"
                assignment.failed_at = now
                assignment.save(update_fields=["status", "failed_reason", "failed_at"])
                DeliveryEvent.objects.create(
                    assignment=assignment, step=DeliveryEvent.CANT_DELIVER, at=now, by=staff,
                    note="Order cancelled by Support after pickup",
                )
        order.status = Order.CANCELLED
        order.save(update_fields=["status"])
        from marketing.waivers import reverse_for_order

        reverse_for_order(order, "order_cancelled")
        from ledger import refunds

        return refunds.refund_order(order, source="cancel", by=staff, note="Cancelled at the customer's request")

    @staticmethod
    def _tell_customer(order, note, refund=None):
        if note.kind == OrderSupportNote.RUNNING_LATE:
            title = "Your order is running late"
            body = f"Your order #{order.pk} is running late. New expected time: {note.expected_time}. Sorry for the wait."
        else:
            title = "Your order was cancelled"
            body = f"Your order #{order.pk} was cancelled at your request. Contact AshantiHub Support with any question."
            if refund is not None and refund.wallet_pesewas > 0:
                body = (
                    f"Your order #{order.pk} was cancelled at your request. GH₵ {from_pesewas(refund.wallet_pesewas)} went back "
                    "to your AshantiHub wallet. Contact AshantiHub Support with any question."
                )
        notify_customer(order.customer, "order_status", title, body=body, link="/my-account", icon="🚚")
        if order.customer.email:
            _send(f"{title} (order #{order.pk})", body, order.customer.email)
