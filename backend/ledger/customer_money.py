"""The read-only `money` block a customer sees on their own stays, service requests and tickets (Plan 7G).

One function builds it from the BookingSale, so every list carries the same keys and the screens never work out a
release time, refund or allowed action themselves. `can_cancel` is `sales.cancel_quote` raising nothing, i.e. the very
check the cancel makes."""
from django.utils import timezone
from rest_framework import serializers

from . import escrow, sales
from .money import from_pesewas


def _iso(value):
    return serializers.DateTimeField().to_representation(value) if value is not None else None


def money_block(sale, now=None):
    """The block for `sale`, or None when there is no sale or the ledger is off."""
    from disputes.models import Dispute

    if sale is None or not escrow.enabled():
        return None
    now = now or timezone.now()
    refunds = list(sale.refunds.all())
    refunded = sum(r.amount_pesewas + r.processing_pesewas for r in refunds)
    customer_cancelled = any(r.source == sales.CUSTOMER_SOURCE for r in refunds)
    settled = sale.released_at is not None or sale.reversed_at is not None

    problem = None
    if sale.dispute_id is not None:
        problem = "closed" if sale.dispute.status in Dispute.FINAL_STATUSES else "open"

    try:
        sales.cancel_quote(sale, now)
        can_cancel = True
    except sales.CancelError:
        can_cancel = False

    return {
        "sale": sale.pk,
        "release_at": None if settled else _iso(sales.release_at(sale, now)),
        "released_at": _iso(sale.released_at),
        "accepted_at": _iso(sale.customer_accepted_at),
        "refunded": str(from_pesewas(refunded)) if refunded else None,
        "refunded_whole": sale.reversed_at is not None,
        "problem": problem,
        "policy": sale.policy_snapshot,
        "start": _iso(sales._policy_start(sale)),
        "can_cancel": can_cancel,
        "cancelled_by_you": customer_cancelled,
        "can_report": not settled and sale.dispute_id is None and not customer_cancelled,
    }
