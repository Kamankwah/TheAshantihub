"""Support's verification of a product order that has reached the customer, and the release it triggers. A positive
result releases the money immediately; a negative one raises a dispute due within `verification_overdue_hours` of
purchase and releases nothing; "could not reach" is only recorded (the order stays on Support's list)."""
from datetime import timedelta

from django.db import transaction
from django.db.models import CharField, Exists, OuterRef, Q
from django.db.models.functions import Cast
from django.utils import timezone

from . import escrow, settings_store
from .models import Account, FulfilmentCheck, Journal, OrderFeeSnapshot


class VerificationError(Exception):
    def __init__(self, message, status_code=409):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def check_for(order):
    check, _ = FulfilmentCheck.objects.get_or_create(order=order)
    return check


def handed_over(order, check):
    """True once the goods have reached the customer: a rider marked the delivery done, or the pickup desk marked a
    store-pickup order collected."""
    from orders.models import DeliveryAssignment, Order

    if order.delivery_method == Order.STORE_PICKUP:
        return check.collected_at is not None
    assignment = getattr(order, "delivery_assignment", None)
    return assignment is not None and assignment.status != DeliveryAssignment.FAILED and assignment.delivered_at is not None


def customer_confirmed(order, check):
    from orders.models import Order

    if order.delivery_method == Order.STORE_PICKUP:
        return True  # the customer took the goods at the desk
    assignment = getattr(order, "delivery_assignment", None)
    return bool(assignment and assignment.confirmed_at) or check.phone_confirmed_at is not None


def record(order, staff, outcome, *, note="", customer_confirmed_by_phone=False, now=None):
    from disputes.models import Dispute
    from orders.models import Order

    now = now or timezone.now()
    if outcome not in (FulfilmentCheck.MATCHES, FulfilmentCheck.DOES_NOT_MATCH, FulfilmentCheck.UNREACHABLE):
        raise VerificationError("Pick matches, does not match, or could not reach.", 400)
    if note is not None and not isinstance(note, str):
        raise VerificationError("The note must be text.", 400)
    note = (note or "").strip()[:500]
    if outcome == FulfilmentCheck.DOES_NOT_MATCH and not note:
        raise VerificationError("Say what does not match.", 400)
    with transaction.atomic():
        order = Order.objects.select_for_update().get(pk=order.pk)
        if order.status != Order.PAID:
            raise VerificationError("This order has not been paid.")
        if Journal.objects.filter(key=escrow.release_key(order)).exists():
            raise VerificationError("This order has already been released to the vendor.")
        check = check_for(order)
        if not handed_over(order, check):
            raise VerificationError("This order has not been delivered or collected yet.")
        if outcome == FulfilmentCheck.MATCHES:
            if escrow.has_open_dispute(order) or escrow.has_pending_refund(order):
                raise VerificationError("A dispute, or a refund waiting for approval, is open on this order. It must be settled first.")
            if customer_confirmed_by_phone and check.phone_confirmed_at is None:
                check.phone_confirmed_at = now
            if not customer_confirmed(order, check):
                raise VerificationError("Record the customer's confirmation of receipt first.")
        if outcome == FulfilmentCheck.DOES_NOT_MATCH and not escrow.has_open_dispute(order):
            hours = settings_store.current("verification_overdue_hours", now)
            check.dispute = Dispute.objects.create(
                order=order, raised_by=order.customer, logged_by=staff, reason=Dispute.ORDER_ISSUE,
                problem_type=Dispute.WRONG_OR_MISSING, description=note, status=Dispute.OPEN,
                answer_due_at=order.placed_at + timedelta(hours=hours),
            )
        check.outcome, check.outcome_note, check.outcome_at, check.outcome_by = outcome, note, now, staff
        check.save()
        if outcome == FulfilmentCheck.MATCHES:
            escrow.release_verified(order, now)
            if (
                escrow.enabled()
                and Journal.objects.filter(key=escrow.pay_key(order)).exists()
                and not Journal.objects.filter(key=escrow.release_key(order)).exists()
                and OrderFeeSnapshot.objects.filter(order=order, released_at__isnull=True, reversed_at__isnull=True).exists()
            ):
                raise VerificationError("The order could not be released. Check for an open dispute and try again.", 409)
        return check


def awaiting(now=None):
    """Paid orders that have reached the customer and are not yet verified positive, oldest first, with what Support
    needs on the call. `overdue` means more than `verification_overdue_hours` have passed since purchase."""
    from orders.models import Order

    now = now or timezone.now()
    limit = timedelta(hours=settings_store.current("verification_overdue_hours", now))
    orders = (
        # A snapshot neither released nor refunded in full, or (every item refunded, the order not wholly) a delivery
        # fee still held in the order's Delivery payable: both wait for Support's call. A wholly refunded order holds nothing.
        Order.objects.annotate(delivery_held=Exists(Account.objects.filter(
            kind=Account.DELIVERY_PAYABLE, owner_type="orders.order", net_credit__gt=0,
            owner_id=Cast(OuterRef("pk"), CharField()),
        ))).filter(status=Order.PAID).filter(
            Q(fee_snapshots__released_at__isnull=True, fee_snapshots__reversed_at__isnull=True) | Q(delivery_held=True)
        ).distinct()
        .select_related("customer").prefetch_related("items__listing__business_owner").order_by("placed_at", "id")
    )
    rows = []
    for order in orders:
        check = FulfilmentCheck.objects.filter(order=order).first() or FulfilmentCheck(order=order)
        if not handed_over(order, check):
            continue
        rows.append({
            "order_id": order.pk, "placed_at": order.placed_at, "due_by": order.placed_at + limit,
            "overdue": now > order.placed_at + limit, "delivery_method": order.delivery_method,
            "customer_name": order.customer.full_name, "customer_phone": order.delivery_phone or order.customer.phone,
            "items": [
                {"name": item.listing.name, "quantity": item.quantity, "business": item.listing.business_owner.display_name}
                for item in order.items.all()
            ],
            "customer_confirmed": customer_confirmed(order, check),
            "outcome": check.outcome, "outcome_note": check.outcome_note, "released": False,
        })
    return rows


def mark_collected(order, staff, now=None):
    """The pickup desk hands a paid store-pickup order to the customer. Idempotent: a second call keeps the first stamp."""
    from orders.models import Order

    now = now or timezone.now()
    with transaction.atomic():
        order = Order.objects.select_for_update().get(pk=order.pk)
        if order.status != Order.PAID or order.delivery_method != Order.STORE_PICKUP:
            raise VerificationError("Only a paid store-pickup order can be marked collected.")
        check = check_for(order)
        if check.collected_at is None:
            check.collected_at, check.collected_by = now, staff
            check.save(update_fields=["collected_at", "collected_by", "updated_at"])
            # A pickup order has no delivery to finish, so collection is its delivery: Support can no longer cancel it.
            order.delivery_status = Order.DELIVERED
            order.save(update_fields=["delivery_status"])
        return check


def pickup_queue(now=None):
    """Paid store-pickup orders not yet collected, oldest first. Deliberately carries no phone number: the desk
    hands over goods, it does not call customers."""
    from orders.models import Order

    now = now or timezone.now()
    window = timedelta(hours=settings_store.current("pickup_window_hours", now))
    orders = (
        Order.objects.filter(status=Order.PAID, delivery_method=Order.STORE_PICKUP)
        .exclude(fulfilment_check__collected_at__isnull=False)
        .select_related("customer").prefetch_related("items__listing__business_owner").order_by("placed_at", "id")
    )
    return [
        {
            "order_id": order.pk, "placed_at": order.placed_at, "collect_by": order.placed_at + window,
            "overdue": now > order.placed_at + window, "customer_name": order.customer.full_name,
            "items": [
                {"name": item.listing.name, "quantity": item.quantity, "business": item.listing.business_owner.display_name}
                for item in order.items.all()
            ],
        }
        for order in orders
    ]
