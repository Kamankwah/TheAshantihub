"""Re-delivery at the customer's request (Plan 7F-E Task 7, owner Rulings R4 and R5).

The first rider completed the trip and the customer was not available (CUSTOMER_UNAVAILABLE_REASONS: the assignment failed
after `arrived_drop_at` with `no_answer`, for which services.cant_deliver enforced the 10-minute wait and two calls, or
with `refused`, the customer turning the order away at the door). The goods came back. At the customer's request Support
or the Pickup Desk (`orders.redeliver`) asks for a second trip (`request`): the governed fee `redelivery_fee_pesewas`
(Ruling R5) is copied onto a Redelivery row and the customer is told to pay it. Nothing is reserved before payment. Once
paid (`record_payment`, the payment finalizer) the Dispatch or Delivery Manager may assign the job again, to an
AshantiHub (in-house) rider while one is available, else to a third-party rider (Director ruling 2, 2026-10-20;
`check_assign` / `link_rider`, called by services.assign). When the second trip's rider has collected the goods the fee
is theirs (`complete`: delivered, or failed after the pickup; a whole refund after that pickup settles it too): an
in-house rider is owed it through payroll, a third-party rider is paid it into their wallet at that moment
(`wallet_payee`, ledger.redelivery.credit_rider; the fee is not part of the order's escrow, so it does not wait for the
order's release). Before that pickup the fee goes back to the
wallet (`cancel` after payment, or inside a whole refund of the order: `close_for_whole_refund`). A goods-only partial
refund never touches it. The first rider keeps the order's original delivery fee: ledger.riders.fee_rider reads
`first_rider` and `first_leg_ended_at` from here.

While the ledger is off nothing here runs: the endpoints answer 409 `ledger_off`, no row is ever created, and
services.assign re-assigns a failed delivery exactly as before (an order that already has an open row keeps its gate).

Lock order (orders/locks.py, extended): the Order row, its fee snapshots, its DeliveryAssignment row, then the order's
Redelivery row, then PickupStop rows, the Rider row (a whole refund: the second-trip rider's, then the original fee
rider's), the ledger accounts in one sorted pass, and last the activity-chain lock. Every function that changes a row takes the Order row first (locks.lock_order).

The activity log records delivery.redelivery_requested / paid / assigned / completed / cancelled with the order id, the
fee and the reason, never the customer's phone and never a payout number."""
from django.db import transaction
from django.utils import timezone

from ledger import escrow, posting, settings_store
from ledger import redelivery as books
from ledger.money import from_pesewas
from notifications.services import notify_customer

from .models import Redelivery
from .services import DeliveryError

# What "the customer was not available" means (Director ruling 3, 2026-10-20): the first rider reached the address
# (arrived_drop_at, so the trip was completed) and the job failed there because nobody answered (services.cant_deliver
# also enforced the 10-minute wait and two calls) or the customer refused the order at the door. A refusal reported
# before the rider reached the address, and every other reason (wrong_address, unsafe, other), is a plain re-assignment
# (Plan 7F-E Task 6), with no extra fee.
CUSTOMER_UNAVAILABLE_REASONS = ("no_answer", "refused")

NOT_REDELIVERABLE = (
    "This order cannot be delivered again at the customer's request: only a paid door-to-door order whose rider reached "
    "the address and found the customer unavailable (no answer, or the order refused at the door) qualifies."
)


class RedeliveryError(DeliveryError):
    """A refusal from these rules; a DeliveryError, so every assigning path (orders AssignDispatchView, the queue's
    force-assign, an offer) answers it the way it answers its own (status code and `code`)."""


def ghs(pesewas):
    return f"GH₵ {from_pesewas(pesewas)}"


def customer_unavailable(assignment):
    """True for a failed trip that reached the address and found no one (see CUSTOMER_UNAVAILABLE_REASONS)."""
    from orders.models import DeliveryAssignment

    return (
        assignment is not None and assignment.status == DeliveryAssignment.FAILED
        and assignment.failed_reason in CUSTOMER_UNAVAILABLE_REASONS and assignment.arrived_drop_at is not None
    )


def open_row(order, *, lock=False):
    """The order's open request (waiting for payment, paid or assigned), or None. `lock` takes its row lock: call after
    the order row (and the assignment row, when the caller holds it)."""
    rows = Redelivery.objects.filter(order_id=order.pk, status__in=Redelivery.OPEN_STATUSES)
    if lock:
        rows = rows.select_for_update(of=("self",))
    return rows.order_by("-attempt").first()


def latest(order):
    return Redelivery.objects.filter(order_id=order.pk).order_by("-attempt").first()


def ledger_paid(order):
    """The order's payment was recorded in the ledger (an order paid before the ledger was on was not: it has no re-delivery
    fee and its failures are re-assigned as before, Plan 7F-E Task 6 only)."""
    from ledger.models import Journal

    return Journal.objects.filter(key=escrow.pay_key(order)).exists()


def _refusal(order, assignment):
    """Why `order` cannot be re-delivered now, or None."""
    from ledger import refunds
    from orders.models import Order

    if order.delivery_method != Order.DOOR_TO_DOOR or order.status != Order.PAID:
        return NOT_REDELIVERABLE
    if not ledger_paid(order) or refunds.is_wholly_refunded(order):
        return NOT_REDELIVERABLE
    if not customer_unavailable(assignment):
        return NOT_REDELIVERABLE
    return None


def redeliverable(order):
    """For the screens (an unlocked read): the ledger is on, the order qualifies and no request is open."""
    if not escrow.enabled():
        return False
    assignment = getattr(order, "delivery_assignment", None)
    return _refusal(order, assignment) is None and open_row(order) is None


def row(redelivery):
    """A request as the staff and customer screens show it (no phone, no payout number)."""
    if redelivery is None:
        return None
    return {
        "id": redelivery.pk, "order": redelivery.order_id, "attempt": redelivery.attempt, "status": redelivery.status,
        "status_label": redelivery.get_status_display(), "fee": str(from_pesewas(redelivery.fee_pesewas)),
        "fee_pesewas": redelivery.fee_pesewas, "reason": redelivery.reason, "created_at": redelivery.created_at,
        "paid_at": redelivery.paid_at, "completed_at": redelivery.completed_at,
    }


def paid_through(redelivery):
    """How the second trip's rider gets the fee: "wallet" (a third-party rider, paid when the trip was done), "payroll" (an
    AshantiHub rider, owed outside the app), or None while nothing is owed yet."""
    from .models import RiderEarning

    if RiderEarning.objects.filter(redelivery_id=redelivery.pk).exists():
        return "wallet"
    return "payroll" if redelivery.owed_through_payroll else None


def staff_row(redelivery):
    data = row(redelivery)
    data.update({
        "requested_by": redelivery.requested_by.full_name if redelivery.requested_by_id else None,
        "rider": redelivery.rider.full_name if redelivery.rider_id else None,
        "paid_through": paid_through(redelivery),
    })
    return data


def customer_row(redelivery):
    """What the customer sees of their own request (no staff names)."""
    data = row(redelivery)
    data.pop("reason")
    return data


def _log(actor, verb, redelivery, *, request=None):
    """The activity event (last in the caller's transaction when it is a staff request; otherwise after commit, so the
    chain lock is never held while a delivery or payment path takes further row locks)."""
    from activity.services import record

    kwargs = dict(
        target_type="delivery.redelivery", target_id=str(redelivery.pk),
        target_label=f"Re-delivery {redelivery.attempt} of order #{redelivery.order_id}",
        # The reason is free text staff typed: it stays out of the summary (which feeds the live feed and notices).
        summary=f"Order #{redelivery.order_id}: re-delivery {redelivery.attempt}, fee {ghs(redelivery.fee_pesewas)}, {redelivery.status}",
        after={"order": redelivery.order_id, "fee_pesewas": redelivery.fee_pesewas, "status": redelivery.status, "reason": redelivery.reason[:500]},
    )
    if request is not None:
        record(actor, verb, request=request, **kwargs)
    else:
        transaction.on_commit(lambda: record(actor, verb, **kwargs))


# ── Support or the Pickup Desk asks ────────────────────────────────────────────────────────────────────────
def request(order, staff, reason, now=None, *, http_request=None):
    """Ask for a second trip at the customer's request. Refuses (RedeliveryError) unless the ledger is on (409
    ledger_off), a reason is given (400), the order is a paid door-to-door ledger order not wholly refunded whose
    assignment failed customer-unavailable (409 not_redeliverable) and no request is open (409 redelivery_open). Copies
    the fee in force now; a GH₵ 0.00 fee needs no payment (the row is paid at once). Tells the customer."""
    from orders import locks

    if not escrow.enabled():
        raise RedeliveryError("Re-delivery fees aren't switched on yet.", 409, "ledger_off")
    reason = (reason or "").strip()
    if not reason:
        raise RedeliveryError("Say why the order is being delivered again.", 400, "invalid", field="reason")
    now = now or timezone.now()
    with transaction.atomic():
        order = locks.lock_order(order.pk)
        assignment = locks.lock_assignment(order)
        refusal = _refusal(order, assignment)
        if refusal is not None:
            raise RedeliveryError(refusal, 409, "not_redeliverable")
        if open_row(order, lock=True) is not None:
            raise RedeliveryError("A re-delivery is already open for this order.", 409, "redelivery_open")
        fee = settings_store.current(settings_store.REDELIVERY_FEE, now)
        previous = latest(order)
        attempt = (previous.attempt if previous else 0) + 1
        redelivery = Redelivery.objects.create(
            order=order, attempt=attempt, first_rider_id=assignment.dispatch_id, first_leg_ended_at=assignment.failed_at or now,
            fee_pesewas=fee, status=Redelivery.PAID if fee == 0 else Redelivery.AWAITING_PAYMENT,
            paid_at=now if fee == 0 else None, requested_by=staff, reason=reason[:2000],
        )
        if fee:
            notify_customer(
                order.customer, "order_status", f"Pay {ghs(fee)} to have Order #{order.pk} delivered again",
                body=(f"We could not hand Order #{order.pk} over at the delivery address. Pay {ghs(fee)} to have it "
                      "delivered again: open your orders to pay from your wallet or by mobile money."),
                link="/my-account", icon="🛵",
            )
        else:
            notify_customer(
                order.customer, "order_status", f"Order #{order.pk} will be delivered again",
                body=f"We could not hand Order #{order.pk} over at the delivery address. It will be delivered again.",
                link="/my-account", icon="🛵",
            )
        _log(staff, "delivery.redelivery_requested", redelivery, request=http_request)
        return redelivery


def cancel(redelivery_id, staff, now=None, *, http_request=None):
    """Cancel a request before the second trip is assigned. Waiting for payment: nothing moves (cancelled). Paid: the fee
    goes back to the wallet (refunded). Assigned or closed: 409 redelivery_not_cancellable (the job is the Dispatch
    manager's; a whole refund of the order still settles or returns the fee)."""
    from orders import locks

    if not escrow.enabled():
        raise RedeliveryError("Re-delivery fees aren't switched on yet.", 409, "ledger_off")
    now = now or timezone.now()
    order_id = Redelivery.objects.filter(pk=redelivery_id).values_list("order_id", flat=True).first()
    if order_id is None:
        raise Redelivery.DoesNotExist
    with transaction.atomic():
        locks.lock_order(order_id)
        redelivery = Redelivery.objects.select_for_update(of=("self",)).select_related("order__customer").get(pk=redelivery_id)
        if redelivery.status == Redelivery.AWAITING_PAYMENT:
            redelivery.status = Redelivery.CANCELLED
        elif redelivery.status == Redelivery.PAID:
            posting.lock(*books.accounts(redelivery, "refund"))
            redelivery.refund_journal = books.refund(redelivery)
            redelivery.status = Redelivery.REFUNDED if redelivery.refund_journal_id else Redelivery.CANCELLED
        else:
            raise RedeliveryError(
                "This re-delivery can no longer be cancelled here: it is already with a rider or closed.", 409,
                "redelivery_not_cancellable",
            )
        redelivery.cancelled_at = now
        redelivery.save(update_fields=["status", "cancelled_at", "refund_journal"])
        if redelivery.status == Redelivery.REFUNDED:
            notify_customer(
                redelivery.order.customer, "order_status", f"Re-delivery of Order #{redelivery.order_id} cancelled",
                body=f"The second delivery was cancelled and the {ghs(redelivery.fee_pesewas)} you paid is back in your AshantiHub wallet.",
                link="/my-account", icon="💳",
            )
        _log(staff, "delivery.redelivery_cancelled", redelivery, request=http_request)
        return redelivery


# ── The customer pays (payments.services._finalize_redelivery) ─────────────────────────────────────────────────
def record_payment(session, now=None):
    """A confirmed payment for `session.metadata["redelivery_id"]`: idempotent on the session. A request still waiting
    for payment becomes paid and the payment journal is posted (books.record_payment, which fails closed on a wrong
    amount); a request that no longer waits (paid by another session, or cancelled) has a mobile-money payment credited
    to the wallet (books.record_stray) and refuses a wallet payment (rolls it back). Records which journal it posted on
    the session (`journal_key`), so the reconciliation expects it."""
    from orders import locks

    now = now or timezone.now()
    redelivery_id = session.metadata.get("redelivery_id")
    order_id = Redelivery.objects.filter(pk=redelivery_id).values_list("order_id", flat=True).first()
    if order_id is None:
        raise books.RedeliveryPostingError(f"Session {session.reference} names no re-delivery")
    with transaction.atomic():
        locks.lock_order(order_id)
        redelivery = Redelivery.objects.select_for_update(of=("self",)).select_related("order__customer").get(pk=redelivery_id)
        if redelivery.checkout_session_id == session.pk and redelivery.pay_journal_id is not None:
            return redelivery                                       # already finalised for this session
        if session.metadata.get("journal_key"):
            return redelivery                                       # this session was already credited to the wallet
        if redelivery.status != Redelivery.AWAITING_PAYMENT:
            from payments.models import CheckoutSession

            if session.provider == CheckoutSession.WALLET:
                raise books.RedeliveryPostingError(f"Re-delivery {redelivery.pk} is not waiting for payment")
            journal = books.record_stray(session)
            if journal is not None:
                session.metadata = {**session.metadata, "journal_key": journal.key}
                session.save(update_fields=["metadata", "updated_at"])
            return redelivery
        journal = books.record_payment(redelivery, session)
        redelivery.status, redelivery.paid_at = Redelivery.PAID, now
        redelivery.checkout_session, redelivery.pay_journal = session, journal
        redelivery.save(update_fields=["status", "paid_at", "checkout_session", "pay_journal"])
        session.metadata = {**session.metadata, "journal_key": journal.key}
        session.save(update_fields=["metadata", "updated_at"])
        _log(session.customer, "delivery.redelivery_paid", redelivery)
        return redelivery


def payment_failed(session):
    """A mobile-money payment failed or expired: nothing was reserved, so the request stays waiting for payment; only the
    link to this session is dropped."""
    Redelivery.objects.filter(
        pk=session.metadata.get("redelivery_id"), checkout_session_id=session.pk, status=Redelivery.AWAITING_PAYMENT,
    ).update(checkout_session=None)


# ── The second trip (services.assign, services.deliver / cant_deliver) ─────────────────────────────────────────
FEE_UNPAID = "The customer has not paid the re-delivery fee yet, so this delivery cannot be given to a rider."


def gate_applies(order):
    """The re-delivery gate holds for an order that can carry a request: the ledger is on and recorded the order's payment
    (the same test request() makes), or a request is already open."""
    return (escrow.enabled() and ledger_paid(order)) or open_row(order) is not None


def check_assign(order, existing, rider):
    """Inside services.assign, after the order and assignment row locks and before any write. Returns the open request
    the assignment will serve (its row locked), or None when no re-delivery is involved. Raises RedeliveryError: a
    customer-unavailable failure needs a paid request (409 redelivery_fee_unpaid), and the second trip (from the failure,
    or a swap of a job already serving a request) goes to an AshantiHub rider while one is available (409
    redelivery_in_house_only); only when none is may a third-party rider take it (Director ruling 2, 2026-10-20), who is
    then paid the re-delivery fee through their wallet (`_settle`)."""
    from .dispatching import in_house_available
    from .models import Rider

    if existing is None or not gate_applies(order):
        return None
    current = open_row(order, lock=True)
    if customer_unavailable(existing):
        if current is None or current.status != Redelivery.PAID:
            raise RedeliveryError(FEE_UNPAID, 409, "redelivery_fee_unpaid")
    elif current is None or current.status != Redelivery.ASSIGNED:
        return None
    if rider is not None and rider.employment != Rider.ASHANTIHUB and in_house_available(order):
        from .services import IN_HOUSE_ONLY_MESSAGE

        raise RedeliveryError(IN_HOUSE_ONLY_MESSAGE, 409, "redelivery_in_house_only")
    return current


def link_rider(redelivery, rider_staff, by=None):
    """The request is now served by `rider_staff` (assigned). Idempotent; call after check_assign in the same transaction."""
    if redelivery is None:
        return None
    changed = redelivery.rider_id != rider_staff.pk or redelivery.status != Redelivery.ASSIGNED
    redelivery.rider, redelivery.status = rider_staff, Redelivery.ASSIGNED
    redelivery.save(update_fields=["rider", "status"])
    if changed:
        _log(by, "delivery.redelivery_assigned", redelivery)
    return redelivery


def complete(assignment, now=None):
    """The second trip's rider delivered, or failed after collecting the goods: the fee is earned (settled to platform
    delivery income) and is that rider's: a third-party rider is paid it into their wallet now (`_settle`), an in-house
    rider is owed it through payroll (rider, completed_at). Call with the order and assignment rows locked (the rider
    steps lock both). A no-op when the delivery serves no assigned request."""
    order = assignment.order
    redelivery = Redelivery.objects.filter(order_id=order.pk, status=Redelivery.ASSIGNED).select_for_update(of=("self",)).first()
    if redelivery is None:
        return None
    now = now or timezone.now()
    return _settle(redelivery, assignment.dispatch_id, now, payee=wallet_payee(order, assignment.dispatch_id, now))


def wallet_payee(order, rider_id, now):
    """The third-party Rider (their row locked) to pay the re-delivery fee through their wallet, or None: no rider, or an
    AshantiHub rider (paid through payroll). Employment is read from the periods at the rider's own pickup on this leg
    (ledger.riders.pickup_made), else now, so a later switch cannot re-label the trip. Call after the order, assignment and
    request row locks and before any account lock (orders/locks.py: the Rider row comes before the accounts)."""
    from ledger import riders

    from . import employment
    from .models import Rider

    rider = Rider.objects.select_related("staff").filter(staff_id=rider_id).first() if rider_id else None
    if rider is None or not employment.third_party_at(rider, riders.pickup_made(order) or now):
        return None
    return Rider.objects.select_related("staff").select_for_update(of=("self",)).get(pk=rider.pk)


def _settle(redelivery, rider_id, now, *, locked=False, payee=None):
    """Settle the earned fee and record who earned it; pay `payee` (a third-party Rider, row locked) through their wallet
    in the same transaction (ledger.redelivery.credit_rider). `locked`: the accounts are already in the caller's lock."""
    if not locked:
        posting.lock(*books.accounts(redelivery, "settle", payee))
    redelivery.settle_journal = books.settle(redelivery)
    redelivery.status, redelivery.completed_at = Redelivery.COMPLETED, now
    if rider_id:
        redelivery.rider_id = rider_id
    redelivery.save(update_fields=["settle_journal", "status", "completed_at", "rider"])
    if payee is not None and redelivery.settle_journal_id is not None:
        books.credit_rider(redelivery, payee, now)
    _log(None, "delivery.redelivery_completed", redelivery)
    return redelivery


# ── A whole refund of the order (ledger.refunds.refund_order) ───────────────────────────────────────────────────
def for_whole_refund(order):
    """(request, action) for a whole refund being made now, the request's row locked (call after the order, snapshot and
    assignment locks): "cancel" (not paid), "refund" (paid, the second rider has collected nothing) or "settle" (the
    second rider collected the goods: the fee is theirs; a third-party second rider's row is locked now, before the
    refund's own rider row and its accounts, and kept on the request as `wallet_payee`), or (None, None)."""
    from ledger import riders
    from orders.models import DeliveryAssignment

    redelivery = open_row(order, lock=True)
    if redelivery is None:
        return None, None
    if redelivery.status == Redelivery.AWAITING_PAYMENT:
        return redelivery, "cancel"
    if redelivery.status == Redelivery.ASSIGNED and riders.pickup_made(order) is not None:
        rider_id = DeliveryAssignment.objects.filter(order_id=order.pk).values_list("dispatch_id", flat=True).first()
        redelivery.wallet_payee = wallet_payee(order, rider_id, timezone.now())
        return redelivery, "settle"                 # a GH₵ 0.00 fee posts nothing but the request still completes
    return redelivery, "refund" if redelivery.pay_journal_id is not None else "cancel"


def refund_accounts(redelivery, action):
    return books.accounts(redelivery, action, getattr(redelivery, "wallet_payee", None)) if redelivery is not None else ()


def close_for_whole_refund(redelivery, action, now=None):
    """Apply for_whole_refund's decision inside the refund's transaction (its accounts already in the refund's lock)."""
    if redelivery is None:
        return None
    now = now or timezone.now()
    if action == "settle":
        from orders.models import DeliveryAssignment

        rider_id = DeliveryAssignment.objects.filter(order_id=redelivery.order_id).values_list("dispatch_id", flat=True).first()
        return _settle(redelivery, rider_id, now, locked=True, payee=getattr(redelivery, "wallet_payee", None))
    if action == "refund":
        redelivery.refund_journal = books.refund(redelivery)
        redelivery.status = Redelivery.REFUNDED
    else:
        redelivery.status = Redelivery.CANCELLED
    redelivery.cancelled_at = now
    redelivery.save(update_fields=["refund_journal", "status", "cancelled_at"])
    _log(None, "delivery.redelivery_cancelled", redelivery)
    return redelivery
