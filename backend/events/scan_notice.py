"""The notice a ticket's buyer gets when the ticket is scanned at the door (Plan 7C, task 2).

A scan releases and holds nothing: it records evidence (`delivered_at`, `delivered_by_staff`) and tells the buyer, so a
buyer who did not go can reach Support before the automatic release (`ledger.sales.release_at`). `send` queues one
TicketScanNotice (unique key `ticket-scan-<pk>`, written in the caller's transaction, in a savepoint, never raising) and
delivers it after the commit through otp.senders (SMS and email, whichever the buyer has), plus the in-app copy. Only a
ticket bought in a ledger sale gets one, so it is inert while the ledger is off. The text names the event and two times
and holds no phone number or other person's details. Times are UTC (Accra time is UTC all year). The release time is
worked out when the notice is sent; if the organiser edits the event date after the scan, the buyer is not told again
(the notice is once per ticket, unique key above)."""
import logging
import string
from datetime import timezone as dt_timezone

from django.db import transaction
from django.utils import timezone

from otp import senders
from wallets.approval_kinds import mask_numbers
from otp.identity import contacts

from .models import TicketScanNotice

logger = logging.getLogger(__name__)

SUBJECT = "Your AshantiHub ticket was scanned"
PLAIN = frozenset(string.ascii_letters + string.digits + " .,:;#'()-/!?&%+")
MAX_EVENT_NAME = 80


def key_for(ticket):
    return f"ticket-scan-{ticket.pk}"


def _plain(text):
    return "".join(char if char in PLAIN else " " for char in text).strip()


def body_for(ticket, scanned_at, release_at):
    """Never carries a phone number: the event's name is cleaned to plain characters and cut."""
    event = mask_numbers(_plain(ticket.ticket_type.event.name))[:MAX_EVENT_NAME] or "the event"
    at = scanned_at.astimezone(dt_timezone.utc)
    by = release_at.astimezone(dt_timezone.utc)
    return (
        f"Your ticket for {event} was scanned at {at:%d %b %Y %H:%M} UTC. If this was not you, contact AshantiHub Support "
        f"before {by:%d %b %Y %H:%M} UTC."
    )


def send(ticket, sale=None, now=None):
    """Queue the scan notice for `ticket` (once) and deliver it after the surrounding transaction commits. `sale` is the
    ticket's ledger booking sale; None (ledger off, or no sale) sends nothing. Returns the TicketScanNotice, or None.
    Never raises."""
    if sale is None or ticket.delivered_at is None:
        return None
    try:
        from ledger import sales

        due = sales.release_at(sale, now)
        if due is None:
            return None
        body = body_for(ticket, ticket.delivered_at, due)
        with transaction.atomic():  # a savepoint: a failure here must not break the scan
            notice, created = TicketScanNotice.objects.get_or_create(
                key=key_for(ticket), defaults={"ticket": ticket, "body": body},
            )
        if created:
            transaction.on_commit(lambda pk=notice.pk: _deliver(pk), robust=True)
        return notice
    except Exception as exc:  # noqa: BLE001 - a notice never stops a scan
        logger.error("Ticket scan notice not queued: %s", type(exc).__name__)
        return None


def _deliver(pk):
    """After commit: the text and email, and the in-app copy. Never raises; only an error's type is logged."""
    try:
        notice = TicketScanNotice.objects.select_related("ticket__purchased_by").get(pk=pk)
        if notice.sent_at is not None:
            return
        customer = notice.ticket.purchased_by
        for channel, destination in contacts(customer).items():
            senders.deliver(channel, destination, SUBJECT, notice.body)
        from notifications.services import notify_customer

        notify_customer(customer, "ticket", SUBJECT, body=notice.body, link="/my-account", icon="🎟️")
        TicketScanNotice.objects.filter(pk=pk, sent_at__isnull=True).update(sent_at=timezone.now())
    except Exception as exc:  # noqa: BLE001
        logger.error("Ticket scan notice %s not delivered: %s", pk, type(exc).__name__)
