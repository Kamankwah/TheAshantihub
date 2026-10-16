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
* A partial refund of R comes out of the item lines in proportion to what is left of each (largest remainder); the
  customer gets R. The delivery fee comes back only with the whole order. A scoped refund that takes every item
  leaves it held until the order is released (escrow.release_verified then releases the Delivery payable balance) or
  refunded whole. The refund that empties the order ("whole") also returns the rest of any coupon to AshantiHub (Cr promo
  subsidy), so the customer never gets back more than they paid.
* The provider's collection charge ("payment processing") is not refunded, except when staff say AshantiHub or a vendor
  was at fault (`refund_processing=True`): AshantiHub then bears it (Dr provider fees, Cr wallet). A partial refund
  gives back only its share of the charge (its share of the order total, half up, never more than is left); the refund
  that empties the order gives back whatever is left of it.

Callers: Support's cancel (orders.support), the uncollected-pickup job (ledger.verification), dispute resolution
(disputes.views) and the delivery-case refund approval (delivery.config). Lock order: the order row, its fee
snapshots, then every account the transaction posts to, in one sorted pass before the first posting (`_post` locks them;
`extra_locks` carries the accounts of a later posting, such as the promo return)."""
from dataclasses import dataclass

from django.db import transaction
from django.db.models import Sum
from django.utils import timezone

from . import escrow, posting
from .models import Account, Journal, OrderFeeSnapshot, OrderRefund
from .money import from_pesewas, to_pesewas


class RefundError(Exception):
    def __init__(self, message, status_code=400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


@dataclass(frozen=True)
class Left:
    """What can still be refunded on an order, in pesewas."""

    customer: int
    delivery: int
    subsidy: int
    processing: int


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


def left(order):
    done = OrderRefund.objects.filter(order=order).aggregate(
        customer=Sum("amount_pesewas"), delivery=Sum("delivery_pesewas"), subsidy=Sum("subsidy_pesewas"),
        processing=Sum("processing_pesewas"),
    )
    return Left(
        customer=to_pesewas(order.total_amount) - (done["customer"] or 0),
        delivery=to_pesewas(order.delivery_fee or 0) - (done["delivery"] or 0),
        subsidy=to_pesewas(order.discount_amount or 0) - (done["subsidy"] or 0),
        processing=processing_paid(order) - (done["processing"] or 0),
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
    from orders.models import Order

    if not escrow.enabled():
        return None
    if not source or len(source) > 60 or len(refund_key(order, source)) > 120:  # OrderRefund.source is 60, the key 120
        raise ValueError(f"Bad refund source {source!r}")
    _check_amount(amount_pesewas)
    now = now or timezone.now()
    with transaction.atomic():
        order = Order.objects.select_for_update(of=("self",)).get(pk=order.pk)
        existing = OrderRefund.objects.filter(order=order, source=source).first()
        if existing is not None:
            return existing
        if not Journal.objects.filter(key=escrow.pay_key(order)).exists():
            return None
        remaining = left(order)
        snapshots = list(
            OrderFeeSnapshot.objects.select_for_update(of=("self",))
            .filter(order=order, reversed_at__isnull=True).select_related("business_owner").order_by("pk")
        )
        unreversed = snapshots
        if owner_ids is not None:
            wanted = set(owner_ids)
            snapshots = [snap for snap in snapshots if snap.business_owner_id in wanted]
        rooms = [(snap.pk, snap.base_pesewas - snap.refunded_base_pesewas) for snap in snapshots]
        items_room = sum(room for _, room in rooms)
        processing = remaining.processing if refund_processing else 0
        whole = owner_ids is None and (amount_pesewas is None or amount_pesewas == remaining.customer)
        if whole:
            if not (remaining.customer or remaining.delivery or remaining.subsidy or items_room or processing):
                _free_promo(order, [])  # nothing left to refund, but the business must not stay charged for the promo
                return None
            customer, delivery, subsidy, shares = remaining.customer, remaining.delivery, remaining.subsidy, dict(rooms)
        else:
            customer = items_room if amount_pesewas is None else amount_pesewas
            if customer > remaining.customer:
                raise RefundError(f"Only GH₵ {from_pesewas(remaining.customer)} of this order can still be refunded.")
            if owner_ids is not None and customer > items_room:
                raise RefundError(f"Only GH₵ {from_pesewas(items_room)} of those items can still be refunded.")
            if customer > items_room:
                raise RefundError(
                    f"The items left are worth GH₵ {from_pesewas(items_room)}. The delivery fee comes back only with the "
                    f"whole order: GH₵ {from_pesewas(remaining.customer)}."
                )
            if customer <= 0:
                raise RefundError("Nothing is left to refund on those items.")
            delivery, subsidy, shares = 0, 0, allocate(customer, rooms)
            if processing:
                # A partial refund gives back only its share of the charge, half up; the refund that empties the order
                # gives back whatever is left of it (spec §1 row 14: AshantiHub bears only what went wrong).
                paid = to_pesewas(order.total_amount)
                processing = min(processing, (2 * processing_paid(order) * customer + paid) // (2 * paid)) if paid else 0
        # The refund leaves the order with no item at all: if nothing was delivered either, the business owes no promo.
        clears_promo = whole or (
            all(shares.get(snap.pk, 0) >= snap.base_pesewas - snap.refunded_base_pesewas for snap in unreversed)
            and not _delivery_made(order)
        )
        refund = _post(
            order, snapshots, shares, customer=customer, delivery=delivery, subsidy=subsidy, processing=processing,
            whole=whole, source=source, by=by, note=note, now=now,
            extra_locks=escrow.waiver_return_accounts(order) if clears_promo else (),
        )
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


def _free_promo(order, extra):
    """Give a charged free-delivery promo back and reverse an owed one (locks first: spec W7)."""
    from marketing.waivers import reverse_for_order

    posting.lock(*escrow.waiver_return_accounts(order), *extra)
    escrow.return_waiver(order)
    reverse_for_order(order, "order_refunded")


def _post(order, snapshots, shares, *, customer, delivery, subsidy, processing, whole, source, by, note, now, extra_locks=()):
    released = Journal.objects.filter(key=escrow.release_key(order)).exists()
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
    if subsidy:
        credits.append(posting.credit(posting.account_for(Account.PLATFORM_PROMO_SUBSIDY), subsidy))
    if customer + processing:
        credits.append(posting.credit(posting.account_for(Account.CUSTOMER_WALLET, order.customer), customer + processing))
    # Every account this transaction posts to, in one sorted pass before the first posting (spec W7); `extra_locks`
    # are the accounts a later posting in the same transaction touches (Task 6: the promo return).
    posting.lock(*(line.account for line in debits + credits), *extra_locks)
    journal = None
    if len(debits) + len(credits) >= 2:
        journal = posting.post(
            key=refund_key(order, source), kind="order_refund", lines=debits + credits,
            reference_type="orders.order", reference_id=str(order.pk), memo=f"Refund for order #{order.pk} ({source})",
        )
    items = sum(entry["pending"] + entry["available"] for entry in by_vendor.values())
    return OrderRefund.objects.create(
        order=order, source=source, whole=whole, amount_pesewas=customer, items_pesewas=items, delivery_pesewas=delivery,
        subsidy_pesewas=subsidy, processing_pesewas=processing, allocation=allocation, journal=journal, created_by=by,
        note=(note or "")[:300],
    )


def scope_for_dispute(dispute):
    """The vendors a dispute's refund may come from: the businesses whose stop a rider skipped and whose skip opened this
    case (that shop's lines only, delivery.services.open_case_for_skipped_stop), or None for the whole order."""
    from delivery.models import DeliveryEvent

    owners = set(
        DeliveryEvent.objects.filter(dispute=dispute, step=DeliveryEvent.SKIPPED_STOP, stop__isnull=False)
        .values_list("stop__business_owner_id", flat=True)
    )
    return owners or None


def check(order, amount_pesewas, *, owner_ids=None):
    """Raise RefundError when refund_order could not give `amount_pesewas` now; writes nothing. A pre-check for a
    decision approved later (the delivery-case refund), so a case is never closed on a refund the ledger will refuse.
    Nothing to check while the ledger is off or for an order paid before it was on."""
    if not escrow.enabled() or not Journal.objects.filter(key=escrow.pay_key(order)).exists():
        return
    _check_amount(amount_pesewas)
    remaining = left(order)
    snaps = OrderFeeSnapshot.objects.filter(order=order, reversed_at__isnull=True)
    if owner_ids is not None:
        snaps = snaps.filter(business_owner_id__in=owner_ids)
    items_room = sum(s.base_pesewas - s.refunded_base_pesewas for s in snaps)
    if amount_pesewas > remaining.customer:
        raise RefundError(f"Only GH₵ {from_pesewas(remaining.customer)} of this order can still be refunded.")
    if owner_ids is not None and amount_pesewas > items_room:
        raise RefundError(f"Only GH₵ {from_pesewas(items_room)} of those items can still be refunded.")
    if owner_ids is None and amount_pesewas != remaining.customer and amount_pesewas > items_room:
        raise RefundError(
            f"The items left are worth GH₵ {from_pesewas(items_room)}. The delivery fee comes back only with the "
            f"whole order: GH₵ {from_pesewas(remaining.customer)}."
        )
