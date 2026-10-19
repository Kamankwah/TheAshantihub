import logging
from datetime import date, timedelta

from celery import shared_task
from django.utils import timezone

from ledger import escrow

from . import payouts, vendor_texts

logger = logging.getLogger(__name__)


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


def _digest_batch(day, after_pk):
    """One batch of `day`'s digests; if more businesses remain, hand the cursor to a new run of the task so no one run
    is long. A broker that cannot be reached is logged and left to the 10:00 catch-up, which skips whoever has theirs."""
    queued, cursor = vendor_texts.run_digests(day, after_pk=after_pk)
    if cursor is not None:
        try:
            queue_vendor_digests.delay(after_pk=cursor, day=day.isoformat())
        except Exception as exc:  # noqa: BLE001
            logger.error("Digest batch after %s not handed on: %s", cursor, type(exc).__name__)
    return queued


@shared_task
def queue_vendor_digests(after_pk=0, day=None):
    """07:00 every day: yesterday's digest for each business that asked for one (a no-op while the ledger is off), in
    batches: each run handles one batch and enqueues the next with its cursor (`day` is carried so a batch that runs after
    midnight still works on the same day). Returns how many this batch queued. The beat entry makes core.jobs keep a
    JobRun heartbeat for it."""
    if not escrow.enabled():
        return 0
    return _digest_batch(date.fromisoformat(day) if day else timezone.localdate() - timedelta(days=1), after_pk)


@shared_task
def catch_up_digests():
    """10:00 every day: yesterday's digests again, from the start. Idempotent (a business already sent its digest is
    skipped), so it only covers what a 07:00 run killed or lost part-way did not reach."""
    if not escrow.enabled():
        return 0
    return _digest_batch(timezone.localdate() - timedelta(days=1), 0)
