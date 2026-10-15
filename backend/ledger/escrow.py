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
from .models import Account, Journal, OrderFeeSnapshot
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

        delivery = to_pesewas(order.delivery_fee or 0)
        paid = to_pesewas(order.total_amount)
        subsidy = to_pesewas(order.discount_amount or 0)
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
