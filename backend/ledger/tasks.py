from celery import shared_task

from . import riders, verification


@shared_task
def refund_uncollected_pickups():
    """Hourly: store-pickup orders not collected within the pickup window go back to the customer's wallet (a no-op
    while the ledger is off). The beat entry makes core.jobs keep a JobRun heartbeat for it."""
    return verification.expire_uncollected()


@shared_task
def post_rider_commission():
    """00:20 every day: third-party riders' commission held for earlier days goes to AshantiHub's commission income (a
    no-op while the ledger is off; a missed night is caught up by the next run). The beat entry makes core.jobs keep a
    JobRun heartbeat for it."""
    return riders.post_commission()
