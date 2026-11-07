import logging

from celery import shared_task

from . import riders, verification

logger = logging.getLogger(__name__)


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


def cancelled_events_to_finish():
    """Cancelled events with at least one unrefunded ticket (Exists, not a multi-valued join)."""
    from django.db.models import Exists, OuterRef

    from events.models import Event, Ticket

    unrefunded = Ticket.objects.filter(ticket_type__event=OuterRef("pk"), refunded_at__isnull=True)
    return Event.objects.filter(Exists(unrefunded), status=Event.CANCELLED).order_by("pk")


@shared_task
def finish_cancelled_event_refunds():
    """Hourly: a cancelled event whose cancel was interrupted (a crash, or one ticket's refund failing) has its remaining
    tickets refunded (Plan 7F-C), each buyer told. Returns how many tickets it refunded; a no-op when nothing is left. A
    ticket whose refund keeps failing is logged each hour (by type only) and counted in `tickets_left` until Accounting
    resolves it. The beat entry makes core.jobs keep a JobRun heartbeat for it."""
    from events import cancel_notice, cancellation

    total = 0
    for event in cancelled_events_to_finish():
        refunded = []
        total += cancellation.refund_unrefunded(event, by=None, reason=event.cancel_reason, refunded=refunded)
        if refunded:
            cancel_notice.send(event, cancel_notice.refunded_by_ticket(event, refunded))
    return total


@shared_task
def verify_ledger_integrity():
    """02:00 every day (review DB-06): re-derive every balance from the journal lines and compare (ledger.integrity). Read-only.
    A difference is logged at ERROR (Sentry), opens one fraud case for the day and tells the wallets.view holders; nothing is
    corrected. Runs whether or not the ledger is switched on, so a restore or a hand edit is caught before the switch is turned
    on. The beat entry makes core.jobs keep a JobRun heartbeat for it."""
    from django.utils import timezone

    from fraud import services as fraud
    from fraud.models import FraudFlag
    from notifications.services import notify_staff_role

    from . import integrity

    report = integrity.find_problems()
    if not report["problems"]:
        return {k: report[k] for k in ("journals", "lines", "accounts")} | {"ok": True}
    kinds = sorted(report["problems"])
    logger.error("LEDGER INTEGRITY FAILED: %s", {kind: report["problems"][kind] for kind in kinds})
    today = timezone.localdate()
    fraud.raise_flag(
        FraudFlag.OTHER, title=f"Ledger integrity check failed on {today:%d %b %Y}",
        detail="The nightly re-derivation of ledger balances from the journal lines found differences. Nothing was corrected.",
        evidence=[f"{kind}: {report['problems'][kind]}" for kind in kinds],
        dedupe_key=f"ledger-integrity-{today.isoformat()}",
    )
    notify_staff_role(
        "wallets.view", "ledger_integrity_failed", f"Ledger integrity check failed ({', '.join(kinds)})",
        body="Nothing was corrected. Do not post to the ledger until this is understood.", link="reconciliation", icon="🧮",
    )
    return {k: report[k] for k in ("journals", "lines", "accounts")} | {"ok": False, "problems": kinds}
