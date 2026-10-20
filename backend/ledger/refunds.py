"""Giving a customer money back for a paid product order (spec §2.2 steps 3-4, §5; §13 Stage 3 carry-forward).

A refund always goes to the customer's AshantiHub wallet and is recorded as an `OrderRefund`, one per order and source
(so the same request can never refund twice), with one journal `order-refund-<order>-<source>`:

* Before release the vendor's share comes back out of Vendor Pending, the delivery fee out of the order's Delivery
  payable. After release it comes out of Vendor Available (which may go negative; later sales recover it), the platform
  fee taken at release is returned in proportion (Dr platform fee income, Cr Vendor Available), and a delivery fee
  already taken as platform delivery income comes back from there.
* Fees are snapshotted per (order, vendor, category). A refund raises the snapshot's `refunded_base_pesewas` and
  `refunded_fee_pesewas`; the fee share is cumulative and rounded half up, so the fee given back never exceeds the fee
  taken and reaches it exactly when the whole base is refunded. That frees the lifetime cap (fees.charged_to_date), and
  release pays only what is left. A snapshot refunded in full gets `reversed_at`.
* A refund never exceeds what the customer actually paid, net of the coupon, minus the delivery fee kept for the rider
  (ruling R1). `Left.customer` is what a whole refund gives the customer now (the fee included when it is not kept);
  `Left.partial` is what a partial or shop-scoped refund may give: the delivery fee still held is reserved from the very
  first refund, whether or not a pickup has happened yet, so a partial refund can never hand back money the fee needs.
  `OrderRefund.amount_pesewas` is the customer's real credit from order money, never the kept fee; `refundable(order)`
  is what staff see as "can still be refunded".
* A partial refund of R comes out of the item lines in proportion to what is left of each (largest remainder); the
  customer gets R and the vendors give R. The delivery fee comes back only with the whole order. A scoped refund that
  takes every item leaves it held until the order is released (escrow.release_verified then releases the Delivery
  payable balance) or refunded whole. A free-delivery promo (Order.delivery_fee 0, WaivedFeeCharge) has no fee to reserve. The refund that empties the order ("whole") also returns the rest of any coupon to AshantiHub (Cr promo
  subsidy), so the customer never gets back more than they paid.
* The delivery fee belongs to the rider once any pickup is done (ledger.riders.delivery_kept: a collected stop, else the
  assignment's `picked_up_at`; a delivery that failed after a pickup counts). A refund of goods, partial or whole, never
  returns it: `Left.delivery` is 0, the customer is given what they paid net of the coupon less the kept fee, and
  `OrderRefund.delivery_kept_pesewas` records it. A coupon can leave the customer having paid less than the kept fee
  (`Left.shortfall`): a whole refund then still pays the rider in full, the customer's credit from order money is 0, and
  AshantiHub's cost is only that gap, taken off the promo subsidy that would have gone back (subsidy - shortfall). A
  processing charge given back is never eaten by the kept fee. A whole refund before release settles the fee there and then, since the release will never run (escrow.settle_delivery, first: the fee leaves the Delivery
  payable and a third-party rider is paid as at a release); a partial or shop-scoped refund moves nothing, and the held fee
  still goes to the rider at the usual release. After release a whole refund takes nothing back from the rider. With no
  pickup, a whole refund returns the fee as usual and the rider is paid nothing. A delivery earned also keeps the
  free-delivery promo charged to its owner (the promo is not returned).
* A re-delivery fee (Plan 7F-E Task 7) is not part of the order total, so `left` never counts it. A whole refund returns
  it to the wallet before the second trip's rider collected anything and settles it to platform delivery income after
  (delivery.redelivery.close_for_whole_refund); a partial or shop-scoped refund never touches it. The first trip of a
  re-delivered order was completed, so its original delivery fee is kept (riders.delivery_earned).
* The provider's collection charge ("payment processing") is not refunded, except when staff say AshantiHub or a vendor
  was at fault (`refund_processing=True`): AshantiHub then bears it (Dr provider fees, Cr wallet). A partial refund
  gives back only its share of the charge (its share of the order total, half up, never more than is left); the refund
  that empties the order gives back whatever is left of it.

Callers: Support's cancel (orders.support), the uncollected-pickup job (ledger.verification), dispute resolution
(disputes.views) and the delivery-case refund approval (delivery.config); the last two can also ask for a whole refund
with no amount when nothing is left to give the customer (whole_at_zero_refusal). Lock order (the canonical one, orders/locks.py):
the order row, its fee snapshots, then the delivery assignment row, the order's open re-delivery row (a whole refund closes
it: delivery.redelivery.for_whole_refund) and the rider's row (a whole refund before release of a picked-up order:
ledger.riders.rider_for_settle), then every account the transaction posts to, in one sorted pass before the first posting
(`_post` locks them; `extra_locks` carries the accounts of a later posting, such as the promo return)."""
from dataclasses import dataclass

from django.db import transaction
from django.db.models import Sum
from django.utils import timezone

from . import escrow, posting, riders
from .models import Account, Journal, OrderFeeSnapshot, OrderRefund
from .money import from_pesewas, to_pesewas


class RefundError(Exception):
    def __init__(self, message, status_code=400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


@dataclass(frozen=True)
class Left:
    """What can still be refunded on an order, in pesewas. `customer`: what a whole refund gives the customer now, net of
    the coupon and of the kept fee; `partial`: what a partial or shop-scoped refund may give (the held fee reserved);
    `shortfall`: the part of the kept fee the customer did not pay, which AshantiHub covers out of the subsidy."""

    customer: int
    delivery: int
    subsidy: int
    processing: int
    partial: int
    shortfall: int


def is_wholly_refunded(order):
    """True once a whole refund (one that emptied the order) was given: it can no longer be delivered or collected."""
    return OrderRefund.objects.filter(order=order, whole=True).exists()


def refund_key(order, source):
    return f"order-refund-{order.pk}-{source}"


def processing_paid(order):
    """The collection charge the customer paid on top for this order (0 for a wallet payment or none recorded)."""
    from payments.models import CheckoutSession

    session = CheckoutSession.objects.filter(
        kind=CheckoutSession.ORDER_CHECKOUT, metadata__order_id=order.pk, status=CheckoutSession.SUCCESS,
    ).first()
    return to_pesewas(session.processing_fee) if session is not None else 0


def left(order, *, kept=None):
    """What can still be refunded. `kept` is the delivery fee kept for the rider (riders.delivery_kept); a caller holding the
    delivery assignment row's lock passes the value it read under it, otherwise it is read here (an unlocked read, fine for
    the display and pre-check callers)."""
    kept = riders.delivery_kept(order) if kept is None else kept
    done = OrderRefund.objects.filter(order=order).aggregate(
        customer=Sum("amount_pesewas"), delivery=Sum("delivery_pesewas"), subsidy=Sum("subsidy_pesewas"),
        processing=Sum("processing_pesewas"),
    )
    paid_left = to_pesewas(order.total_amount) - (done["customer"] or 0)
    fee_held = to_pesewas(order.delivery_fee or 0) - (done["delivery"] or 0)
    return Left(
        customer=max(0, paid_left - kept),
        delivery=max(0, fee_held - kept),
        subsidy=to_pesewas(order.discount_amount or 0) - (done["subsidy"] or 0),
        processing=processing_paid(order) - (done["processing"] or 0),
        partial=max(0, paid_left - fee_held),
        shortfall=max(0, kept - paid_left),
    )


def refundable(order, owner_ids=None):
    """What can still be refunded to the customer on this order, in pesewas: what a whole refund would give now, or with
    `owner_ids` (a shop-scoped case: scope_for_dispute) what a scoped refund with no amount would give, the room left on
    those shops' lines capped by `Left.partial`. None while the ledger is off or for an order whose payment was never
    recorded in it. An unlocked read, for display only."""
    if not escrow.enabled() or not Journal.objects.filter(key=escrow.pay_key(order)).exists():
        return None
    remaining = left(order)
    if owner_ids is None:
        return remaining.customer
    return min(_items_room(order, owner_ids), remaining.partial)


def _items_room(order, owner_ids):
    """The item money not yet refunded on the order's lines (those vendors' lines only when `owner_ids` is given)."""
    snaps = OrderFeeSnapshot.objects.filter(order=order, reversed_at__isnull=True)
    if owner_ids is not None:
        snaps = snaps.filter(business_owner_id__in=owner_ids)
    return sum(s.base_pesewas - s.refunded_base_pesewas for s in snaps)


def _partial_limits(customer, remaining, items_room, scoped):
    """Raise RefundError when a partial or shop-scoped refund of `customer` pesewas cannot be given (refund_order and
    check share it, so the pre-check never disagrees with the refund)."""
    if customer > remaining.customer:
        raise RefundError(f"Only GH₵ {from_pesewas(remaining.customer)} of this order can still be refunded.")
    if scoped and customer > items_room:
        raise RefundError(f"Only GH₵ {from_pesewas(items_room)} of those items can still be refunded.")
    if not scoped and customer > items_room:
        fee = (
            "The delivery fee comes back only with the whole order:" if remaining.delivery
            else "The delivery fee is not refunded (it is kept for the rider or there is none): a whole-order refund gives"
        )
        raise RefundError(
            f"The items left are worth GH₵ {from_pesewas(items_room)}. {fee} GH₵ {from_pesewas(remaining.customer)}."
        )
    if customer > remaining.partial:
        raise RefundError(
            f"Only GH₵ {from_pesewas(remaining.partial)} of this order can be refunded before the whole order (the "
            f"delivery fee is kept back)."
        )


def allocate(amount, rooms):
    """Split `amount` over [(key, room)] in proportion to each room: floor shares, then the pesewas left over to the
    largest remainders (ties to the earlier key). Every share stays within its room; `amount` must not exceed the rooms'
    total."""
    total = sum(room for _, room in rooms)
    if amount <= 0 or total <= 0:
        return {key: 0 for key, _ in rooms}
    shares = {key: amount * room // total for key, room in rooms}
    spare = amount - sum(shares.values())
    by_remainder = sorted(range(len(rooms)), key=lambda i: (-(amount * rooms[i][1] % total), i))
    for i in by_remainder[:spare]:
        shares[rooms[i][0]] += 1
    return shares


def fee_share(snapshot, refunded_base):
    """The part of the snapshot's charged fee that belongs to `refunded_base` pesewas of its base, rounded half up."""
    if refunded_base >= snapshot.base_pesewas:
        return snapshot.charged_pesewas
    return (2 * snapshot.charged_pesewas * refunded_base + snapshot.base_pesewas) // (2 * snapshot.base_pesewas)


def _check_amount(amount_pesewas):
    if amount_pesewas is None:
        return
    if isinstance(amount_pesewas, bool) or not isinstance(amount_pesewas, int) or amount_pesewas <= 0:
        raise RefundError("The refund must be more than GH₵ 0.00.")


def refund_order(order, amount_pesewas=None, *, source, by=None, owner_ids=None, refund_processing=False, note="", now=None):
    """Refund `amount_pesewas` of `order` to the customer's wallet (None: everything still refundable in the scope).
    `owner_ids` limits it to those vendors' lines (a shop that could not hand over): never the delivery fee or the
    coupon. Returns the OrderRefund (the existing one when this source already refunded), or None while the ledger is
    off, when the order's payment was never recorded in the ledger (paid before it was on), or when nothing is left.
    Raises RefundError, writing nothing, for an amount it cannot give."""
    from delivery import redelivery as redelivery_rules
    from orders import locks

    if not escrow.enabled():
        return None
    if not source or len(source) > 60 or len(refund_key(order, source)) > 120:  # OrderRefund.source is 60, the key 120
        raise ValueError(f"Bad refund source {source!r}")
    _check_amount(amount_pesewas)
    now = now or timezone.now()
    with transaction.atomic():
        order = locks.lock_order(order.pk)
        existing = OrderRefund.objects.filter(order=order, source=source).first()
        if existing is not None:
            return existing
        if not Journal.objects.filter(key=escrow.pay_key(order)).exists():
            return None
        snapshots = list(
            OrderFeeSnapshot.objects.select_for_update(of=("self",))
            .filter(order=order, reversed_at__isnull=True).select_related("business_owner").order_by("pk")
        )
        # The delivery assignment row next (the canonical order, orders/locks.py), before anything reads whether a pickup
        # was made: a pickup confirmation locks the order row and then this row, so it either finished before this
        # refund took the order row or waits for the refund. The fee kept for the rider is read once, here, and passed on.
        locks.lock_assignment(order)
        earned = riders.delivery_earned(order)
        kept_fee = riders.delivery_kept(order) if earned else 0
        remaining = left(order, kept=kept_fee)
        released = Journal.objects.filter(key=escrow.release_key(order)).exists()
        unreversed = snapshots
        if owner_ids is not None:
            wanted = set(owner_ids)
            snapshots = [snap for snap in snapshots if snap.business_owner_id in wanted]
        rooms = [(snap.pk, snap.base_pesewas - snap.refunded_base_pesewas) for snap in snapshots]
        items_room = sum(room for _, room in rooms)
        processing = remaining.processing if refund_processing else 0
        whole = owner_ids is None and (amount_pesewas is None or amount_pesewas == remaining.customer)
        # A re-delivery fee (not part of the order total) is closed by a whole refund only: returned before the second
        # trip's rider collected anything, settled after (delivery.redelivery). Its row is locked now, after the assignment
        # and before the rider row (orders/locks.py).
        redo = redelivery_rules.for_whole_refund(order) if whole else (None, None)
        redo_accounts = redelivery_rules.refund_accounts(*redo)
        if whole:
            if not (remaining.customer or remaining.delivery or remaining.subsidy or items_room or processing):
                if not earned:                          # an earned delivery keeps its promo charge: the promo's owner pays
                    _free_promo(order, redo_accounts, now)  # nothing left to refund, but the business must not stay charged for the promo
                elif not released:                      # earned, never released: settle it now (the promo's owner pays the rider)
                    rider = riders.rider_for_settle(order)
                    posting.lock(*escrow.settle_accounts(order, rider), *redo_accounts)
                    escrow.settle_delivery(order, now, rider=rider)
                else:
                    posting.lock(*redo_accounts)
                redelivery_rules.close_for_whole_refund(*redo, now=now)
                return None
            customer, delivery, subsidy, shares = remaining.customer, remaining.delivery, remaining.subsidy, dict(rooms)
            shortfall = remaining.shortfall
        else:
            # A scoped refund with no amount takes what its shops' lines hold, capped by what a partial refund may give
            # (the vendor debit equals the customer credit; the unrefunded coupon share returns with the whole refund).
            customer = min(items_room, remaining.partial) if amount_pesewas is None else amount_pesewas
            _partial_limits(customer, remaining, items_room, owner_ids is not None)
            if customer <= 0 and items_room > 0 and remaining.partial <= 0:
                raise RefundError(
                    "No partial refund can be given on this order: after the coupon, what the customer paid is held back "
                    "for the delivery fee. Only a whole-order refund is possible."
                )
            if customer <= 0:
                raise RefundError("Nothing is left to refund on those items.")
            delivery, subsidy, shortfall, shares = 0, 0, 0, allocate(customer, rooms)
            if processing:
                # A partial refund gives back only its share of the charge, half up; the refund that empties the order
                # gives back whatever is left of it (spec §1 row 14: AshantiHub bears only what went wrong).
                paid = to_pesewas(order.total_amount)
                processing = min(processing, (2 * processing_paid(order) * customer + paid) // (2 * paid)) if paid else 0
        # The refund leaves the order with no item at all: if nothing was delivered either, the business owes no promo.
        # A delivery already earned (a pickup was made) keeps its promo charge: the promo's owner pays the rider.
        clears_promo = not earned and (whole or (
            all(shares.get(snap.pk, 0) >= snap.base_pesewas - snap.refunded_base_pesewas for snap in unreversed)
            and not _delivery_made(order)
        ))
        refund = _post(
            order, snapshots, shares, customer=customer, delivery=delivery, subsidy=subsidy, processing=processing,
            whole=whole, source=source, by=by, note=note, now=now, earned=earned, kept_fee=kept_fee, shortfall=shortfall,
            extra_locks=(*(escrow.waiver_return_accounts(order) if clears_promo else ()), *redo_accounts),
        )
        redelivery_rules.close_for_whole_refund(*redo, now=now)   # its accounts were in the refund's up-front lock
        if clears_promo:
            escrow.return_waiver(order)               # charged at release: the business owes nothing for a refunded order
            from marketing.waivers import reverse_for_order

            reverse_for_order(order, "order_refunded")
        if whole:
            _cancel_if_not_handed_over(order)
        return refund


def _cancel_if_not_handed_over(order):
    """A whole refund of an order the customer never received cancels it and puts its stock back, in the refund's own
    transaction, as Support's cancel and the pickup job do: otherwise it stays paid and could still be delivered or
    collected (customer gets goods and money, the vendor nothing). An order already cancelled by the caller (those two)
    or already handed over is left alone."""
    from orders.models import Order
    from orders.support import return_stock

    if order.status != Order.PAID or _delivery_made(order):
        return
    return_stock(order)
    order.status = Order.CANCELLED
    order.save(update_fields=["status"])


def _delivery_made(order):
    """True once the goods reached the customer (or the pickup desk handed them over), so the delivery was made."""
    from . import verification
    from .models import FulfilmentCheck

    return verification.handed_over(order, FulfilmentCheck.objects.filter(order=order).first() or FulfilmentCheck(order=order))


def _free_promo(order, extra, now=None):
    """Give a charged free-delivery promo back and reverse an owed one (locks first: spec W7). Never called for a delivery
    already earned (riders.delivery_earned): then the promo's owner keeps paying and the rider keeps the fee."""
    from marketing.waivers import reverse_for_order

    posting.lock(*escrow.waiver_return_accounts(order), *extra)
    escrow.return_waiver(order)
    reverse_for_order(order, "order_refunded")


def _post(order, snapshots, shares, *, customer, delivery, subsidy, processing, whole, source, by, note, now, earned, kept_fee, shortfall,
          extra_locks=()):
    released = Journal.objects.filter(key=escrow.release_key(order)).exists()
    # The delivery fee belongs to the rider once any pickup is done: a whole refund never returns it (`delivery` is already 0
    # then). Before release it is settled here, since the release will never run: the delivery assignment and rider rows are
    # locked now, after the order row and its snapshots and before any account (ledger.riders lock order).
    kept = kept_fee if whole else 0       # read under the assignment row's lock by refund_order
    settling = whole and not released and earned
    settle_rider = riders.rider_for_settle(order) if settling else None
    # `customer` is already net of the kept fee (Left.customer). A coupon may have left the customer having paid less than
    # that fee: the rider is paid in full anyway, and the gap (`shortfall`) comes off the promo subsidy that would have gone
    # back (AshantiHub bears it). A processing charge given back is never eaten by the kept fee.
    wallet_credit = customer + processing
    by_vendor, allocation = {}, []
    for snap in snapshots:
        base = shares.get(snap.pk, 0)
        if base <= 0 and not whole:
            continue
        after = snap.refunded_base_pesewas + base
        fee_after = fee_share(snap, after)
        fee = fee_after - snap.refunded_fee_pesewas
        entry = by_vendor.setdefault(snap.business_owner_id, {"owner": snap.business_owner, "pending": 0, "available": 0, "fee": 0})
        if snap.released_at is None:
            entry["pending"] += base          # the fee was never taken: release will simply charge less
        else:
            entry["available"] += base
            entry["fee"] += fee
        allocation.append({
            "snapshot": snap.pk, "business_owner": snap.business_owner_id, "category": snap.category,
            "base": base, "fee": fee, "released": snap.released_at is not None,
        })
        snap.refunded_base_pesewas, snap.refunded_fee_pesewas = after, fee_after
        if after >= snap.base_pesewas:
            snap.reversed_at = now
        snap.save(update_fields=["refunded_base_pesewas", "refunded_fee_pesewas", "reversed_at"])

    debits, credits = [], []
    for vendor_id in sorted(by_vendor):
        entry = by_vendor[vendor_id]
        if entry["pending"]:
            debits.append(posting.debit(posting.account_for(Account.VENDOR_PENDING, entry["owner"]), entry["pending"]))
        if entry["available"]:
            debits.append(posting.debit(posting.account_for(Account.VENDOR_AVAILABLE, entry["owner"]), entry["available"]))
        if entry["fee"]:
            debits.append(posting.debit(posting.account_for(Account.PLATFORM_FEE_INCOME), entry["fee"]))
            credits.append(posting.credit(posting.account_for(Account.VENDOR_AVAILABLE, entry["owner"]), entry["fee"]))
    if delivery:
        holder = (
            posting.account_for(Account.PLATFORM_DELIVERY_INCOME) if released
            else posting.account_for(Account.DELIVERY_PAYABLE, order)
        )
        debits.append(posting.debit(holder, delivery))
    if processing:
        debits.append(posting.debit(posting.account_for(Account.PROVIDER_FEES), processing))
    if subsidy - shortfall:
        credits.append(posting.credit(posting.account_for(Account.PLATFORM_PROMO_SUBSIDY), subsidy - shortfall))
    if wallet_credit:
        credits.append(posting.credit(posting.account_for(Account.CUSTOMER_WALLET, order.customer), wallet_credit))
    # Every account this transaction posts to, in one sorted pass before the first posting (spec W7); `extra_locks`
    # are the accounts a later posting in the same transaction touches (Task 6: the promo return).
    posting.lock(*(line.account for line in debits + credits), *extra_locks, *(escrow.settle_accounts(order, settle_rider) if settling else ()))
    if settling:
        escrow.settle_delivery(order, now, rider=settle_rider)   # first: the fee leaves the payable (and the rider is paid) before the refund journal
    journal = None
    if len(debits) + len(credits) >= 2:
        journal = posting.post(
            key=refund_key(order, source), kind="order_refund", lines=debits + credits,
            reference_type="orders.order", reference_id=str(order.pk), memo=f"Refund for order #{order.pk} ({source})",
        )
    items = sum(entry["pending"] + entry["available"] for entry in by_vendor.values())
    refund = OrderRefund.objects.create(
        order=order, source=source, whole=whole, amount_pesewas=customer, items_pesewas=items, delivery_pesewas=delivery,
        delivery_kept_pesewas=kept,
        subsidy_pesewas=subsidy, processing_pesewas=processing, allocation=allocation, journal=journal, created_by=by,
        note=(note or "")[:300],
    )
    from wallets import vendor_texts

    for entry in by_vendor.values():  # each business is told what came off its balance (text and in-app copy; never raises)
        vendor_texts.refund_text(
            order, entry["owner"], entry["pending"] + entry["available"] - entry["fee"],
            "Available balance" if entry["available"] else "Pending balance",
        )
    return refund


def scope_for_dispute(dispute):
    """The vendors a dispute's refund may come from: the businesses whose stop a rider skipped and whose skip opened this
    case (that shop's lines only, delivery.services.open_case_for_skipped_stop), or None for the whole order."""
    from delivery.models import DeliveryEvent

    owners = set(
        DeliveryEvent.objects.filter(dispute=dispute, step=DeliveryEvent.SKIPPED_STOP, stop__isnull=False)
        .values_list("stop__business_owner_id", flat=True)
    )
    return owners or None


def whole_at_zero_refusal(order, owner_ids=None):
    """Why a whole refund cannot be asked for without an amount, or None when it can. Every refund door takes an amount
    above 0, and a whole refund is asked for by typing what is left (`Left.customer`). A coupon can leave that at 0 once
    the delivery fee is kept for the rider (ruling R1: the customer paid no more than the fee), yet the whole refund must
    still be possible (the rider paid in full, the vendor's money and the subsidy reversed, the order cancelled). So dispute
    resolution and the delivery-case refund ask for it with an explicit whole-refund flag, allowed only here: the ledger
    on and the payment recorded, the whole order (no shop scope), not already refunded whole, and nothing left to give the
    customer. An unlocked read: refund_order(order, None) is correct whatever happened meanwhile."""
    if not escrow.enabled() or not Journal.objects.filter(key=escrow.pay_key(order)).exists():
        return "A whole-order refund with nothing to give back is only possible once the wallet ledger is on: enter the refund amount."
    if owner_ids is not None:
        return "This case refunds the skipped shop's items only, never the whole order: enter the amount for those items."
    if is_wholly_refunded(order):
        return "This order has already been refunded in full."
    customer = left(order).customer
    if customer:
        return f"GH₵ {from_pesewas(customer)} can still be refunded: enter that amount for a whole-order refund."
    return None


def check_whole(order, *, owner_ids=None):
    """Raise RefundError unless a whole refund may be asked for without an amount (whole_at_zero_refusal)."""
    refusal = whole_at_zero_refusal(order, owner_ids)
    if refusal:
        raise RefundError(refusal)


def check(order, amount_pesewas, *, owner_ids=None):
    """Raise RefundError when refund_order could not give `amount_pesewas` now; writes nothing. A pre-check for a
    decision approved later (the delivery-case refund), so a case is never closed on a refund the ledger will refuse.
    Nothing to check while the ledger is off or for an order paid before it was on."""
    if not escrow.enabled() or not Journal.objects.filter(key=escrow.pay_key(order)).exists():
        return
    _check_amount(amount_pesewas)
    remaining = left(order)
    if owner_ids is None and amount_pesewas == remaining.customer:
        return                                              # a whole refund: refund_order gives it
    items_room = _items_room(order, owner_ids)
    _partial_limits(amount_pesewas, remaining, items_room, owner_ids is not None)
