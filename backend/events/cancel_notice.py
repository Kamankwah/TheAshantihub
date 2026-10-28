"""The notices an event's cancellation sends (Plan 7F-C, task 2).

One in-app notice to each distinct buyer whose tickets this cancel (or the sweep resuming it) refunded: with the money
back in their AshantiHub wallet it says how much; a ticket with no ledger sale (a customer-organised event, or one
bought while the ledger was off) has no wallet credit, so it says Support will refund them. One summary to the
organiser. Every text names the event through `mask_numbers(_plain(name))`, as the scan notice does, so it never
carries a phone number. Sent after the surrounding transaction commits; never raises."""
import logging

from django.db import transaction

from ledger.models import BookingRefund, BookingSale
from ledger.money import from_pesewas
from wallets.approval_kinds import mask_numbers

from .models import Ticket
from .scan_notice import MAX_EVENT_NAME, _plain

logger = logging.getLogger(__name__)

KIND = "event_cancelled"
BUYER_TITLE = "Event cancelled"
ORGANISER_TITLE = "Your event was cancelled"


def event_label(event):
    return mask_numbers(_plain(event.name))[:MAX_EVENT_NAME] or "the event"


def unrefunded_ids(event):
    """The event's tickets not yet refunded: taken before a cancel, so `refunded_by_ticket` can name what it refunded."""
    return set(Ticket.objects.filter(ticket_type__event=event, refunded_at__isnull=True).values_list("pk", flat=True))


def refunded_by_ticket(event, ticket_ids):
    """{ticket id: pesewas that went to the buyer's wallet} for those of `ticket_ids` now refunded. None: the ticket has
    no ledger sale (ledger off, bought before it, or a customer organiser), so Support refunds it; 0: it has a sale but
    nothing was left on it (an earlier refund already returned that money)."""
    from .cancellation import _sale_of

    tickets = Ticket.objects.filter(pk__in=ticket_ids, ticket_type__event=event, refunded_at__isnull=False)
    out = {}
    for ticket in tickets:
        given = BookingRefund.objects.filter(
            source=f"ticket-{ticket.pk}", sale__kind=BookingSale.TICKETS, sale__session__transaction_id=ticket.transaction_id,
        ).first()
        if given is not None:
            out[ticket.pk] = given.amount_pesewas + given.processing_pesewas
        else:
            out[ticket.pk] = 0 if _sale_of(ticket) is not None else None
    return out


ALREADY_RETURNED = "was already returned to you by an earlier refund, so nothing more goes to your wallet"


def buyer_body(label, wallet_pesewas, without_sale, already_returned):
    """`without_sale`: some ticket has no ledger sale (Support refunds it). `already_returned`: some ticket had nothing
    left on its sale (an earlier refund returned it)."""
    text = f"“{label}” was cancelled."
    if wallet_pesewas > 0:
        text += f" GH₵ {from_pesewas(wallet_pesewas):.2f} went back to your AshantiHub wallet."
        if already_returned:
            text += f" The rest of your payment {ALREADY_RETURNED}."
        if without_sale:
            text += " Support will refund you for the rest."
        return text
    if already_returned:
        text += f" Your payment {ALREADY_RETURNED}."
        if without_sale:
            text += " Support will refund you for the rest."
        return text
    return text + " Support will refund you."


def organiser_body(label, tickets_refunded, tickets_left, from_account=True):
    """`from_account`: the refunds come out of the organiser's AshantiHub account (ledger on, business-organised)."""
    text = f"“{label}” was cancelled."
    if not tickets_refunded and not tickets_left:
        return text + " It had no tickets to refund."
    plural = "" if tickets_refunded == 1 else "s"
    if from_account:
        text += f" {tickets_refunded} ticket{plural} refunded in full from your account."
    else:
        text += f" {tickets_refunded} ticket{plural} marked refunded. No money left your account: AshantiHub Support refunds the buyers."
    if tickets_left:
        text += f" {tickets_left} more will be refunded shortly."
    return text


def send(event, refunded_by_ticket, *, result=None):
    """Queue the cancellation notices for `refunded_by_ticket` ({ticket id: wallet pesewas, 0 or None}) and, when `result` (the
    CancelResult) is given, the organiser's summary; they go out after the surrounding transaction commits (at once
    outside one). Never raises."""
    try:
        label = event_label(event)
        per_buyer = {}
        for ticket in Ticket.objects.filter(pk__in=list(refunded_by_ticket)).select_related("purchased_by"):
            wallet, without, returned = per_buyer.get(ticket.purchased_by_id, (0, False, False))
            given = refunded_by_ticket[ticket.pk]
            per_buyer[ticket.purchased_by_id] = (wallet + (given or 0), without or given is None, returned or given == 0)
        buyers = [(customer_id, buyer_body(label, *state)) for customer_id, state in per_buyer.items()]
        organiser = None
        if result is not None:
            from ledger import escrow

            from_account = escrow.enabled() and event.submitted_by_business_id is not None
            organiser = organiser_body(label, result.tickets_refunded, result.tickets_left, from_account)
        transaction.on_commit(lambda: _deliver(event.pk, buyers, organiser), robust=True)
    except Exception as exc:  # noqa: BLE001 - a notice never stops a cancel
        logger.error("Event %s cancel notices not queued: %s", event.pk, type(exc).__name__)


def _deliver(event_pk, buyers, organiser):
    from accounts.models import Customer
    from notifications.services import notify_customer

    from .models import Event

    for customer_id, body in buyers:
        try:
            notify_customer(Customer.objects.get(pk=customer_id), KIND, BUYER_TITLE, body=body, link="/my-account", icon="🎟️")
        except Exception as exc:  # noqa: BLE001
            logger.error("Event %s cancel notice to a buyer not sent: %s", event_pk, type(exc).__name__)
    if organiser is None:
        return
    try:
        from .views import _notify_event_organizer

        event = Event.objects.select_related("submitted_by_business", "submitted_by_customer").get(pk=event_pk)
        _notify_event_organizer(event, KIND, ORGANISER_TITLE, body=organiser, link="/events", icon="⚠️")
    except Exception as exc:  # noqa: BLE001
        logger.error("Event %s cancel notice to the organiser not sent: %s", event_pk, type(exc).__name__)
