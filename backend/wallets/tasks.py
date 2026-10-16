from datetime import timedelta

from celery import shared_task
from django.utils import timezone

from ledger import escrow

from . import payouts


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
