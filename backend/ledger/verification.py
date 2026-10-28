"""Support's verification of a product order that has reached the customer, and the release it triggers. A positive
result releases the money immediately; a negative one raises a dispute due within `verification_overdue_hours` of
purchase and releases nothing; "could not reach" is only recorded (the order stays on Support's list)."""
import logging
from datetime import timedelta

from django.db import transaction
from django.db.models import CharField, Exists, OuterRef, Q, Value
from django.db.models.functions import Cast, Coalesce, Concat, Greatest
from django.utils import timezone

from . import escrow, settings_store
from .models import Account, FulfilmentCheck, Journal, OrderFeeSnapshot
from .money import from_pesewas

logger = logging.getLogger(__name__)


class VerificationError(Exception):
    def __init__(self, message, status_code=409, code=None):
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.code = code


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
            if escrow.has_open_dispute(order):
                raise VerificationError("A dispute is open on this order. It must be settled first.")
            if escrow.enabled() and escrow.has_pending_refund(order):
                raise VerificationError("A refund waiting for approval is open on this order. It must be settled first.")
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


def awaiting_queryset(now=None):
    """Paid orders that have reached the customer and still have something left to release, oldest first. The hand-over
    rule is `handed_over()` in SQL: a collected store pickup, or any other order whose delivery was marked done and did
    not fail."""
    from orders.models import DeliveryAssignment, Order

    return (
        # A snapshot neither released nor refunded in full, or (every item refunded, the order not wholly) a delivery
        # fee still held in the order's Delivery payable: both wait for Support's call. A wholly refunded order holds nothing.
        Order.objects.annotate(delivery_held=Exists(Account.objects.filter(
            kind=Account.DELIVERY_PAYABLE, owner_type="orders.order", net_credit__gt=0,
            owner_id=Cast(OuterRef("pk"), CharField()),
        ))).filter(status=Order.PAID).filter(
            Q(fee_snapshots__released_at__isnull=True, fee_snapshots__reversed_at__isnull=True) | Q(delivery_held=True)
        ).filter(
            Q(delivery_method=Order.STORE_PICKUP, fulfilment_check__collected_at__isnull=False)
            | (
                ~Q(delivery_method=Order.STORE_PICKUP) & Q(delivery_assignment__delivered_at__isnull=False)
                & ~Q(delivery_assignment__status=DeliveryAssignment.FAILED)
            )
        ).distinct()
        .select_related("customer", "fulfilment_check", "delivery_assignment")
        .prefetch_related("items__listing__business_owner__profile").order_by("placed_at", "id")
    )


def _overdue_limit(now):
    return timedelta(hours=settings_store.current("verification_overdue_hours", now))


def awaiting_row(order, now, limit=None):
    """What Support needs on the call for one order. The order comes from `awaiting_queryset`, so its check and
    delivery are already loaded; a caller building many rows passes `limit` (`_overdue_limit`) so it is read once."""
    limit = limit if limit is not None else _overdue_limit(now)
    check = getattr(order, "fulfilment_check", None) or FulfilmentCheck(order=order)
    return {
        "order_id": order.pk, "placed_at": order.placed_at, "due_by": order.placed_at + limit,
        "overdue": now > order.placed_at + limit, "delivery_method": order.delivery_method,
        "customer_name": order.customer.full_name, "customer_phone": order.delivery_phone or order.customer.phone,
        "items": [
            {"name": item.listing.name, "quantity": item.quantity, "business": item.listing.business_owner.display_name}
            for item in order.items.all()
        ],
        "customer_confirmed": customer_confirmed(order, check),
        "outcome": check.outcome, "outcome_note": check.outcome_note, "released": False,
    }


def awaiting(now=None):
    """The awaiting rows, oldest first. `overdue` means more than `verification_overdue_hours` have passed since purchase."""
    now = now or timezone.now()
    limit = _overdue_limit(now)
    return [awaiting_row(order, now, limit) for order in awaiting_queryset(now)]


def mark_collected(order, staff, now=None):
    """The pickup desk hands a paid store-pickup order to the customer. Idempotent: a second call keeps the first stamp."""
    from orders.models import Order

    now = now or timezone.now()
    with transaction.atomic():
        order = Order.objects.select_for_update().get(pk=order.pk)
        if order.status != Order.PAID or order.delivery_method != Order.STORE_PICKUP:
            raise VerificationError("Only a paid store-pickup order can be marked collected.")
        from . import refunds

        if refunds.is_wholly_refunded(order):
            raise VerificationError("This order was refunded in full, so it cannot be handed over.")
        check = check_for(order)
        if check.collected_at is None:
            check.collected_at, check.collected_by = now, staff
            check.save(update_fields=["collected_at", "collected_by", "updated_at"])
            # A pickup order has no delivery to finish, so collection is its delivery: Support can no longer cancel it.
            order.delivery_status = Order.DELIVERED
            order.save(update_fields=["delivery_status"])
        return check


def _clock_start(order):
    """When the pickup window starts: purchase, or the vendor's opening when the order was bought while they were closed."""
    return max(order.placed_at, order.ready_not_before) if order.ready_not_before else order.placed_at


def pickup_queryset(now=None, q=""):
    """Paid store-pickup orders not yet collected, oldest first, that the ledger recorded the payment of (an older
    order stays for a person, as in `expire_uncollected`). `q`: a number (`#` allowed, at most 9 digits) finds an order
    by its number, any other text a customer by name."""
    from orders.models import Order

    queryset = (
        Order.objects.annotate(pay_key=Concat(Value("order-pay-"), Cast("pk", CharField())))
        .filter(Exists(Journal.objects.filter(key=OuterRef("pay_key"))))
        .filter(status=Order.PAID, delivery_method=Order.STORE_PICKUP)
        .exclude(fulfilment_check__collected_at__isnull=False).exclude(refunds__whole=True)
        .select_related("customer").prefetch_related("items__listing__business_owner__profile").order_by("placed_at", "id")
    )
    q = (q or "").strip()
    if q:
        number = q.lstrip("#").strip()
        if number.isascii() and number.isdigit():
            queryset = queryset.filter(pk=int(number)) if len(number) <= 9 else queryset.none()
        else:
            queryset = queryset.filter(customer__full_name__icontains=q)
    return queryset


def _pickup_window(now):
    return timedelta(hours=settings_store.current("pickup_window_hours", now))


def pickup_row(order, now, window=None):
    """One desk row (a caller building many passes `window`, `_pickup_window`, so it is read once). Deliberately
    carries no phone number: the desk hands over goods, it does not call customers."""
    window = window if window is not None else _pickup_window(now)
    return {
        "order_id": order.pk, "placed_at": order.placed_at, "collect_by": _clock_start(order) + window,
        "overdue": now > _clock_start(order) + window, "customer_name": order.customer.full_name,
        "items": [
            {"name": item.listing.name, "quantity": item.quantity, "business": item.listing.business_owner.display_name}
            for item in order.items.all()
        ],
    }


def pickup_queue(now=None):
    """The pickup rows, oldest first."""
    now = now or timezone.now()
    window = _pickup_window(now)
    return [pickup_row(order, now, window) for order in pickup_queryset(now)]


def expire_uncollected(now=None):
    """Refund and cancel paid store-pickup orders nobody collected within `pickup_window_hours` of purchase (spec §4.3,
    Stage 3): the whole order goes back to the customer's AshantiHub wallet (not the payment-processing charge: the
    customer did not come), its stock back on the shelf, and the customer is told. Only orders whose payment the ledger
    recorded (older ones stay on the desk's list for a person) and never one with an open dispute. The desk's collection
    and `expire_one` both lock the order row, so a collected order is never refunded. One order the ledger refuses is
    logged and skipped, so it never stops the others. Returns how many were refunded."""
    from orders.models import Order

    if not escrow.enabled():
        return 0
    now = now or timezone.now()
    hours = settings_store.current("pickup_window_hours", now)
    # Only orders the ledger recorded are selected (in SQL), so a pre-ledger order is never row-locked every hour.
    due = list(
        Order.objects.annotate(pay_key=Concat(Value("order-pay-"), Cast("pk", CharField())))
        .filter(Exists(Journal.objects.filter(key=OuterRef("pay_key"))))
        .annotate(window_start=Greatest("placed_at", Coalesce("ready_not_before", "placed_at")))
        .filter(status=Order.PAID, delivery_method=Order.STORE_PICKUP, window_start__lt=now - timedelta(hours=hours))
        .exclude(fulfilment_check__collected_at__isnull=False).order_by("placed_at", "id").values_list("pk", flat=True)
    )
    done = 0
    for pk in due:
        try:
            done += expire_one(pk, hours)
        except Exception:  # one order the ledger refuses must not stop every later customer's refund
            logger.exception("Uncollected-pickup refund failed for order %s", pk)
    return done


def expire_one(pk, hours):
    """Refund, cancel and restock one uncollected pickup under its order row lock. Returns 1, or 0 when it no longer
    qualifies (collected by the desk, disputed, not paid, or paid before the ledger was on)."""
    from notifications.services import notify_customer
    from orders.models import Order
    from orders.support import return_stock

    from . import refunds

    with transaction.atomic():
        order = Order.objects.select_for_update(of=("self",)).select_related("customer").get(pk=pk)
        if order.status != Order.PAID or not Journal.objects.filter(key=escrow.pay_key(order)).exists():
            return 0
        if FulfilmentCheck.objects.filter(order=order, collected_at__isnull=False).exists() or escrow.has_open_dispute(order):
            return 0
        return_stock(order)
        order.status = Order.CANCELLED
        order.save(update_fields=["status"])
        refund = refunds.refund_order(order, source="pickup_expired", note=f"Not collected within {hours} hours")
        back = (
            f" GH₵ {from_pesewas(refund.amount_pesewas)} went back to your AshantiHub wallet."
            if refund is not None and refund.amount_pesewas > 0 else ""
        )
        notify_customer(
            order.customer, "order_status", "Your order was not collected",
            body=f"Order #{order.pk} was not collected within {hours} hours of purchase, so it was cancelled.{back}",
            link="/my-account", icon="🧾",
        )
    return 1
