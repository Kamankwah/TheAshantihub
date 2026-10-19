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


@shared_task
def release_due_booking_sales():
    """Hourly: services, stays and tickets whose release time has passed pay the business out (Plan 7E): a service on the
    customer's accept or 48 h after it was marked done, a stay 24 h after the check-in time, tickets 48 h after the event.
    A no-op while the ledger is off. The beat entry makes core.jobs keep a JobRun heartbeat for it."""
    from . import sales

    return sales.release_due()
