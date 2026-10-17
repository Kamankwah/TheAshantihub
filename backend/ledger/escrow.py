"""Order money in the ledger: record_order_payment (the payment journal) and release_verified (the release).

Payment journal for an order, in pesewas:
    Dr provider clearing   what the customer paid (order.total_amount), or Dr customer wallet when paid from the wallet
    Dr promo subsidy       the coupon discount, funded by AshantiHub (order.discount_amount)
    Cr vendor pending      each vendor's item subtotal (Σ line_total)
    Cr delivery payable    the delivery fee, held until the delivery is paid out
The two debits always equal the credits for a consistent order; if they do not, nothing is written.

release_verified moves the held money once Support records a positive verification (no timer): each vendor's Pending is
debited, the snapshotted fee goes to platform fee income, the delivery fee to platform delivery income, and the rest to the
vendor's Available. It is idempotent on its journal key and refuses (returns None) while a dispute or a delivery-case
refund waiting for approval is open, and for an order no longer paid (cancelled). It pays only what refunds left (ledger.refunds):
each snapshot's base and fee less what was refunded, and the delivery fee the order's Delivery payable still holds. A business
that waived the delivery fee through its free-delivery promo pays it from its Available right after (charge_waiver, kind
order_waiver_charge); a whole refund gives it back (return_waiver)."""
from django.conf import settings
from django.db import transaction
from django.utils import timezone

from . import fees, posting, settings_store
from .models import Account, FulfilmentCheck, Journal, JournalLine, OrderFeeSnapshot
from .money import to_pesewas


def enabled():
    return bool(settings.LEDGER_ENABLED)


def pay_key(order):
    return f"order-pay-{order.pk}"


def _vendor_groups(order):
    groups = {}
    for item in order.items.select_related("listing__business_owner", "listing__category"):
        owner = item.listing.business_owner
        entry = groups.setdefault(owner.pk, {"owner": owner, "by_category": {}})
        category = item.listing.category.kind
        entry["by_category"][category] = entry["by_category"].get(category, 0) + to_pesewas(item.line_total)
    return groups


def record_order_payment(order, *, at=None, wallet=False):
    """The payment journal for a paid order (see the module docstring). `wallet=True`: the customer paid from their
    AshantiHub wallet, so the wallet is debited instead of provider clearing; a wallet that is too low raises
    posting.InsufficientFunds and nothing is written. Every account the journal touches is locked up front in
    primary-key order before the fees charged so far are read: two payments for one vendor cannot both see the same
    cap remainder, and a wallet payment cannot deadlock with a refund to the same wallet."""
    if not enabled():
        return None
    at = at or timezone.now()
    with transaction.atomic():
        if Journal.objects.filter(key=pay_key(order)).exists():
            return None
        groups = _vendor_groups(order)
        delivery = to_pesewas(order.delivery_fee or 0)
        paid = to_pesewas(order.total_amount)
        subsidy = to_pesewas(order.discount_amount or 0)
        if not (paid or subsidy or delivery or any(sum(g["by_category"].values()) for g in groups.values())):
            return None  # a GHS 0.00 order has no money to record; write neither snapshots nor a journal
        # Created in primary-key order so two first payments sharing vendors cannot deadlock on the unique index.
        pendings = {pk: posting.account_for(Account.VENDOR_PENDING, groups[pk]["owner"]) for pk in sorted(groups)}
        source = None
        if paid:
            source = (
                posting.account_for(Account.CUSTOMER_WALLET, order.customer) if wallet
                else posting.account_for(Account.PROVIDER_CLEARING)
            )
        payable = posting.account_for(Account.DELIVERY_PAYABLE, order) if delivery else None
        promo = posting.account_for(Account.PLATFORM_PROMO_SUBSIDY) if subsidy else None
        posting.lock(*pendings.values(), source, payable, promo)
        cap = settings_store.current("fee_cap_pesewas", at)

        credits, items_total = [], 0
        for pk in sorted(groups):
            group = groups[pk]
            already = fees.charged_to_date(group["owner"])
            vendor_total = 0
            for category, base in sorted(group["by_category"].items()):
                quote = fees.quote(category, base, cap=cap, already_charged=already, at=at)
                already += quote.charged
                vendor_total += base
                OrderFeeSnapshot.objects.create(
                    order=order, business_owner=group["owner"], category=category, rule_set_id=quote.rule_set_id,
                    base_pesewas=base, computed_pesewas=quote.computed, charged_pesewas=quote.charged, cap_pesewas=cap,
                )
            if vendor_total:
                credits.append(posting.credit(pendings[pk], vendor_total))
            items_total += vendor_total

        if paid + subsidy != items_total + delivery:
            raise posting.PostingError(
                f"Order {order.pk} does not reconcile: paid {paid} + discount {subsidy} != items {items_total} + delivery {delivery}"
            )
        if delivery:
            credits.append(posting.credit(payable, delivery))
        debits = []
        if paid:
            debits.append(posting.debit(source, paid))
        if subsidy:
            debits.append(posting.debit(promo, subsidy))
        return posting.post(
            key=pay_key(order), kind="order_payment", lines=debits + credits,
            reference_type="orders.order", reference_id=str(order.pk), memo=f"Payment for order #{order.pk}",
        )


# --- release ---------------------------------------------------------------------------------------------

def release_key(order):
    return f"order-release-{order.pk}"


def has_open_dispute(order):
    from disputes.models import Dispute

    return Dispute.objects.filter(order=order).exclude(status__in=Dispute.FINAL_STATUSES).exists()


def release_verified(order, now=None):
    """Release an order's held money to the vendor and the platform. Called when Support records a positive
    verification; there is no timer. Returns the journal, or None when the ledger is off, the order is no longer paid
    (cancelled), has no positive verification, an open dispute or a delivery-case refund waiting for approval, or was already released.

    Refunds come first (ledger.refunds): each snapshot pays only the base and fee not yet refunded, a fully refunded one
    (reversed) pays nothing, and the delivery fee released is what the order's Delivery payable still holds. A business
    that waived the delivery fee through its free-delivery promo pays it from its Available right after (charge_waiver)."""
    from orders.models import Order

    if not enabled():
        return None
    now = now or timezone.now()
    with transaction.atomic():
        if Journal.objects.filter(key=release_key(order)).exists() or has_open_dispute(order) or has_pending_refund(order):
            return None
        if not Order.objects.filter(pk=order.pk, status=Order.PAID).exists():
            return None
        if not FulfilmentCheck.objects.filter(order=order, outcome=FulfilmentCheck.MATCHES).exists():
            return None
        snapshots = list(
            OrderFeeSnapshot.objects.select_for_update(of=("self",))  # never lock the vendor's BusinessOwner row (deadlocks with a payment)
            .filter(order=order, released_at__isnull=True, reversed_at__isnull=True).select_related("business_owner")
            .order_by("pk")  # the same order as ledger.refunds, so a release and a refund can never deadlock
        )
        if not Journal.objects.filter(key=pay_key(order)).exists():
            return None
        # No snapshot left (a scoped refund took every item) is not the end: the delivery fee is still held in the
        # order's Delivery payable until the order is released or refunded whole, and is released below. A wholly
        # refunded order holds nothing, so the posting is empty and this returns None.
        income = posting.account_for(Account.PLATFORM_FEE_INCOME)
        by_vendor = {}
        for snap in snapshots:
            entry = by_vendor.setdefault(snap.business_owner_id, {"owner": snap.business_owner, "base": 0, "fee": 0})
            entry["base"] += snap.base_pesewas - snap.refunded_base_pesewas
            entry["fee"] += snap.charged_pesewas - snap.refunded_fee_pesewas

        # Every account this transaction can post to, locked in one sorted pass (spec W7) before anything is decided
        # from a balance: the Delivery payable's is read from the locked row, and the promo charge's accounts (the
        # second posting, charge_waiver) are taken now so it never takes a new lock while the release's are held.
        if to_pesewas(order.delivery_fee or 0) > 0:
            delivery_account = posting.account_for(Account.DELIVERY_PAYABLE, order)
        else:  # no fee: look the account up (a refund may have opened none either) but never create an empty one
            delivery_account = Account.objects.filter(
                kind=Account.DELIVERY_PAYABLE, owner_type="orders.order", owner_id=str(order.pk)
            ).first()
        delivery_income = posting.account_for(Account.PLATFORM_DELIVERY_INCOME)
        pendings = {v: posting.account_for(Account.VENDOR_PENDING, by_vendor[v]["owner"]) for v in by_vendor}
        availables = {v: posting.account_for(Account.VENDOR_AVAILABLE, by_vendor[v]["owner"]) for v in by_vendor}
        locked = posting.lock(income, delivery_account, delivery_income, *pendings.values(), *availables.values(), *waiver_accounts(order))

        # The owner's order: AshantiHub first (fee, delivery), then each vendor, then any third-party rider (Stage 5).
        debits, credits = [], []
        for vendor_id in sorted(by_vendor):
            entry = by_vendor[vendor_id]
            if entry["base"] > 0:
                debits.append(posting.debit(pendings[vendor_id], entry["base"]))
            if entry["fee"] > 0:
                credits.append(posting.credit(income, entry["fee"]))
        delivery = locked[delivery_account.pk].balance if delivery_account is not None else 0
        if delivery > 0:
            debits.append(posting.debit(delivery_account, delivery))
            credits.append(posting.credit(delivery_income, delivery))
        for vendor_id in sorted(by_vendor):
            entry = by_vendor[vendor_id]
            payable = entry["base"] - entry["fee"]
            if payable > 0:
                credits.append(posting.credit(availables[vendor_id], payable))
        if len(debits) + len(credits) < 2:
            OrderFeeSnapshot.objects.filter(pk__in=[s.pk for s in snapshots]).update(released_at=now)
            return None  # nothing to post (every line was zero)
        journal = posting.post(
            key=release_key(order), kind="order_release", lines=debits + credits,
            reference_type="orders.order", reference_id=str(order.pk), memo=f"Release of order #{order.pk}",
        )
        OrderFeeSnapshot.objects.filter(pk__in=[s.pk for s in snapshots]).update(released_at=now)
        charge_waiver(order)
        # Each business paid gets its release text and in-app copy (spec §6), queued in this transaction and sent after it
        # commits. It reads the journals just written, takes no new row lock beyond foreign-key key-share locks, and never raises (vendor plan 4).
        from wallets import vendor_texts

        vendor_texts.order_released(order, journal)
        return journal


# --- the business's free-delivery promo (marketing.WaivedFeeCharge; spec §13 Stage 3 carry-forward) -----------------

def waiver_key(order):
    return f"order-waiver-{order.pk}"


def waiver_return_key(order):
    return f"order-waiver-return-{order.pk}"


def waiver_accounts(order):
    """The accounts charge_waiver would post to (none when no promo charge is owed), for the release's up-front lock."""
    from marketing.models_waivers import WaivedFeeCharge

    charge = WaivedFeeCharge.objects.filter(order=order, status=WaivedFeeCharge.OWED).select_related("business_owner").first()
    if charge is None or to_pesewas(charge.amount) <= 0:
        return ()
    return (posting.account_for(Account.VENDOR_AVAILABLE, charge.business_owner), posting.account_for(Account.PLATFORM_DELIVERY_INCOME))


def waiver_return_accounts(order):
    """The accounts return_waiver would post to (none when no promo was charged), for a whole refund's up-front lock."""
    line = JournalLine.objects.filter(journal__key=waiver_key(order), side=JournalLine.DEBIT).select_related("account").first()
    return () if line is None else (line.account, posting.account_for(Account.PLATFORM_DELIVERY_INCOME))


def has_pending_refund(order):
    """A delivery case on this order whose refund waits for the Super Admin (delivery.refund_request). The case is
    already final, so has_open_dispute does not see it, but its lines must never be paid to the vendor first."""
    from approvals.models import ApprovalRequest
    from disputes.models import Dispute

    ids = [str(pk) for pk in Dispute.objects.filter(order=order).values_list("pk", flat=True)]
    return bool(ids) and ApprovalRequest.objects.filter(
        kind="delivery.refund_request", status=ApprovalRequest.PENDING, target_type="disputes.dispute", target_id__in=ids,
    ).exists()


def charge_waiver(order):
    """A business that waived the delivery fee through its free-delivery promo pays it at release: Dr its Available
    (which may go negative), Cr platform delivery income. Only a charge still owed is taken (a cancel or a whole refund
    reverses it first); idempotent on the key. The customer never paid it, so no refund ever returns it to them."""
    from marketing.models_waivers import WaivedFeeCharge

    if not enabled():
        return None
    charge = WaivedFeeCharge.objects.filter(order=order, status=WaivedFeeCharge.OWED).select_related("business_owner").first()
    amount = to_pesewas(charge.amount) if charge is not None else 0
    if amount <= 0:
        return None
    return posting.post(
        key=waiver_key(order), kind="order_waiver_charge",
        lines=[
            posting.debit(posting.account_for(Account.VENDOR_AVAILABLE, charge.business_owner), amount),
            posting.credit(posting.account_for(Account.PLATFORM_DELIVERY_INCOME), amount),
        ],
        reference_type="orders.order", reference_id=str(order.pk), memo=f"Free-delivery promo on order #{order.pk}, paid by the business",
    )


def return_waiver(order):
    """Give a charged promo back to the business when the order is refunded whole (it owes nothing for a refunded order)."""
    if not enabled():
        return None
    line = JournalLine.objects.filter(journal__key=waiver_key(order), side=JournalLine.DEBIT).select_related("account").first()
    if line is None:
        return None
    return posting.post(
        key=waiver_return_key(order), kind="order_waiver_return",
        lines=[posting.debit(posting.account_for(Account.PLATFORM_DELIVERY_INCOME), line.amount), posting.credit(line.account, line.amount)],
        reference_type="orders.order", reference_id=str(order.pk), memo=f"Free-delivery promo on order #{order.pk} returned (order refunded)",
    )
