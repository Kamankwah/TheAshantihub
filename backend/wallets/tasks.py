from celery import shared_task

from ledger import escrow

from . import payouts


@shared_task
def poll_withdrawals():
    """Every 5 minutes: send held withdrawals nobody sent and ask the provider about sent ones (a no-op while the
    ledger is off). The beat entry makes core.jobs keep a JobRun heartbeat for it."""
    if not escrow.enabled():
        return 0
    return payouts.poll()
