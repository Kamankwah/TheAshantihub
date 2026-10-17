from datetime import timedelta

from celery import shared_task
from django.utils import timezone

from ledger import escrow

from . import payouts, vendor_texts


@shared_task
def poll_withdrawals():
    """Every 5 minutes: send held withdrawals nobody sent and ask the provider about sent ones (a no-op while the
    ledger is off). The beat entry makes core.jobs keep a JobRun heartbeat for it."""
    if not escrow.enabled():
        return 0
    return payouts.poll()


@shared_task
def reconcile_yesterday():
    """02:30 every night: compare yesterday's ledger with the provider's statement (a no-op while the ledger is off).
    Read-only: it never corrects a balance."""
    if not escrow.enabled():
        return None
    from .reconciliation import reconcile

    return reconcile(timezone.localdate() - timedelta(days=1)).status


@shared_task
def send_vendor_text(pk):
    """Send one business money text right after the payment or release that queued it committed."""
    return vendor_texts.deliver(pk)


@shared_task
def send_due_vendor_texts():
    """Every 5 minutes: business money texts not sent yet (a first try lost after commit, or a retry). Runs whatever
    LEDGER_ENABLED says now: a text exists only if the ledger was on when it was queued, and a business told of a sale
    should hear of it. The beat entry makes core.jobs keep a JobRun heartbeat for it."""
    return vendor_texts.send_due()


@shared_task
def queue_vendor_digests():
    """07:00 every day: yesterday's digest for each business that asked for one (a no-op while the ledger is off). A
    missed 07:00 run is not caught up. The beat entry makes core.jobs keep a JobRun heartbeat for it."""
    if not escrow.enabled():
        return 0
    return vendor_texts.queue_digests(timezone.localdate() - timedelta(days=1))
