"""Order money in the ledger: record_order_payment (this task) and release_order (Task 8).

Payment journal for an order, in pesewas:
    Dr provider clearing   what the customer paid (order.total_amount)
    Dr promo subsidy       the coupon discount, funded by AshantiHub (order.discount_amount)
    Cr vendor pending      each vendor's item subtotal (Σ line_total)
    Cr delivery payable    the delivery fee, held until the delivery is paid out
The two debits always equal the credits for a consistent order; if they do not, nothing is written."""
from django.conf import settings
from django.db import transaction
from django.utils import timezone

from . import fees, posting, settings_store
from .models import Account, FulfilmentCheck, Journal, OrderFeeSnapshot
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


def record_order_payment(order, *, at=None):
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
        pendings = {pk: posting.account_for(Account.VENDOR_PENDING, g["owner"]) for pk, g in groups.items()}
        # Lock every vendor's pending account in primary-key order before reading fees charged so far,
        # so two payments for one vendor cannot both see the same cap remainder.
        list(Account.objects.select_for_update().filter(pk__in=[a.pk for a in pendings.values()]).order_by("pk"))
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
            credits.append(posting.credit(posting.account_for(Account.DELIVERY_PAYABLE, order), delivery))
        debits = []
        if paid:
            debits.append(posting.debit(posting.account_for(Account.PROVIDER_CLEARING), paid))
        if subsidy:
            debits.append(posting.debit(posting.account_for(Account.PLATFORM_PROMO_SUBSIDY), subsidy))
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
    verification; there is no timer. Returns the journal, or None when the ledger is off, the order has no positive
    verification or an open dispute, or it was already released."""
    if not enabled():
        return None
    now = now or timezone.now()
    with transaction.atomic():
        if Journal.objects.filter(key=release_key(order)).exists() or has_open_dispute(order):
            return None
        if not FulfilmentCheck.objects.filter(order=order, outcome=FulfilmentCheck.MATCHES).exists():
            return None
        snapshots = list(
            OrderFeeSnapshot.objects.select_for_update()
            .filter(order=order, released_at__isnull=True, reversed_at__isnull=True).select_related("business_owner")
        )
        if not snapshots or not Journal.objects.filter(key=pay_key(order)).exists():
            return None
        income = posting.account_for(Account.PLATFORM_FEE_INCOME)
        by_vendor = {}
        for snap in snapshots:
            entry = by_vendor.setdefault(snap.business_owner_id, {"owner": snap.business_owner, "base": 0, "fee": 0})
            entry["base"] += snap.base_pesewas
            entry["fee"] += snap.charged_pesewas

        # The owner's order: AshantiHub first (fee, delivery), then each vendor, then any third-party rider (Stage 5).
        debits, credits = [], []
        for vendor_id in sorted(by_vendor):
            entry = by_vendor[vendor_id]
            debits.append(posting.debit(posting.account_for(Account.VENDOR_PENDING, entry["owner"]), entry["base"]))
            if entry["fee"]:
                credits.append(posting.credit(income, entry["fee"]))
        delivery = to_pesewas(order.delivery_fee or 0)
        if delivery:
            debits.append(posting.debit(posting.account_for(Account.DELIVERY_PAYABLE, order), delivery))
            credits.append(posting.credit(posting.account_for(Account.PLATFORM_DELIVERY_INCOME), delivery))
        for vendor_id in sorted(by_vendor):
            entry = by_vendor[vendor_id]
            payable = entry["base"] - entry["fee"]
            if payable:
                credits.append(posting.credit(posting.account_for(Account.VENDOR_AVAILABLE, entry["owner"]), payable))
        journal = posting.post(
            key=release_key(order), kind="order_release", lines=debits + credits,
            reference_type="orders.order", reference_id=str(order.pk), memo=f"Release of order #{order.pk}",
        )
        OrderFeeSnapshot.objects.filter(pk__in=[s.pk for s in snapshots]).update(released_at=now)
        return journal
