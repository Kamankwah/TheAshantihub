"""Cancelling an event (Plan 7F-C, ruling R4): every unrefunded ticket is refunded in full, scanned or not, from the
organiser's side.

With a ledger sale the ticket's price goes back to the buyer's AshantiHub wallet through `ledger.sales.refund` with
`refund_processing=True`: the organiser is at fault, so the buyer also gets their share of the payment-processing charge
and AshantiHub bears it (Dr provider fees). Before release it comes out of the organiser's Pending; after release out of
their Available, which may go negative as every late refund does. A ticket with no sale (a customer-organised event, or
one bought while the ledger was off) is only marked refunded with today's REFUNDED billing.Transaction row: no wallet
credit, Support refunds it outside the app.

Lock order: the event row alone, released before any refund; then per ticket, in its own transaction, the ticket rows
and sale through `sales.lock(sale)` (ticket rows, then the sale, then accounts), as every other ticket refund takes them.
A refund that fails leaves its ticket for the next call (the organiser's repeat, or the hourly sweep)."""
import logging
from dataclasses import dataclass

from django.db import transaction
from django.utils import timezone

from accounts.models import StaffUser
from ledger import escrow, sales
from ledger.models import BookingRefund, BookingSale
from ledger.money import from_pesewas, to_pesewas
from ledger.refunds import RefundError

from .models import Event, Ticket

logger = logging.getLogger(__name__)

CODE = "event_cancelled"
DETAIL = "This event was cancelled."


class EventCancelledError(Exception):
    """A payment for an event that was cancelled meanwhile: raised by the ticket finalizer to roll the payment back."""


@dataclass(frozen=True)
class CancelResult:
    event: Event
    tickets_refunded: int  # the event's tickets refunded since it was cancelled (the same on a repeat call)
    tickets_left: int  # the event's tickets still to refund (a failed refund, waiting for the sweep)


def cancel_event(event, *, by, reason, now=None, refunded=None):
    """Cancel `event` (by its organiser or a staff member) and refund its tickets. Idempotent: a second call changes
    nothing on the event (the first reason, time and staff member stay) and only retries tickets still unrefunded.
    `refunded`, when a list, receives the ids of the tickets this call refunded (for the notices)."""
    now = now or timezone.now()
    with transaction.atomic():
        locked = Event.objects.select_for_update().get(pk=event.pk)
        if locked.status != Event.CANCELLED:
            locked.status = Event.CANCELLED
            locked.cancelled_at = now
            locked.cancel_reason = (reason or "").strip()[:300]
            locked.cancelled_by_staff = by if isinstance(by, StaffUser) else None
            locked.save(update_fields=["status", "cancelled_at", "cancel_reason", "cancelled_by_staff", "updated_at"])
    refund_unrefunded(locked, by=by, reason=locked.cancel_reason, now=now, refunded=refunded)
    return result_of(locked)


def result_of(event):
    tickets = Ticket.objects.filter(ticket_type__event=event)
    refunded = tickets.filter(refunded_at__isnull=False)
    if event.cancelled_at is not None:
        refunded = refunded.filter(refunded_at__gte=event.cancelled_at)
    return CancelResult(event, refunded.count(), tickets.filter(refunded_at__isnull=True).count())


def _sale_of(ticket):
    """The ledger sale the ticket was bought in, or None (ledger off, bought before it, or a customer organiser)."""
    if not escrow.enabled():
        return None
    return BookingSale.objects.filter(session__transaction_id=ticket.transaction_id, kind=BookingSale.TICKETS).first()


def _refund_one(ticket_id, *, by, reason, now):
    """Inside transaction.atomic(): refund one ticket unless it already is. True when this call refunded it.

    With a sale, the ticket gets its price or what is left on the sale, whichever is less: a sale partly refunded
    before the cancel (a dispute refund not tied to a ticket) cannot give every ticket its full price, and asking for
    more than is left would raise RefundError on every retry. A ticket with nothing left on its sale is marked refunded
    with no money moved and no REFUNDED row (the buyer already has that money back)."""
    sale = _sale_of(Ticket.objects.get(pk=ticket_id))
    if sale is not None:
        sale = sales.lock(sale)  # the purchase's tickets, then the sale: the order refund_ticket and the scan use
    ticket = Ticket.objects.select_for_update(of=("self",)).select_related("ticket_type__event", "purchased_by").get(pk=ticket_id)
    if ticket.refunded_at is not None:
        return False
    if sale is None:
        sales._ticket_refund_row(ticket)
    else:
        source = f"ticket-{ticket.pk}"
        already = BookingRefund.objects.filter(sale=sale, source=source).first()
        amount = already.amount_pesewas if already is not None else min(to_pesewas(ticket.price), sale.base_pesewas - sale.refunded_base_pesewas)
        if amount > 0:
            sales.refund(sale, amount, source=source, by=by, refund_processing=True, note=reason, now=now)
            sales._ticket_refund_row(ticket, amount=from_pesewas(amount))
        else:
            logger.warning("Cancelled event ticket %s: nothing left on its sale %s; marked refunded with no money moved", ticket.pk, sale.pk)
    Ticket.objects.filter(pk=ticket.pk).update(
        refunded_at=now, refunded_by_staff=by if isinstance(by, StaffUser) else None, refund_reason=(reason or "")[:500],
    )
    return True


def refund_unrefunded(event, *, by, reason, now=None, refunded=None):
    """Refund every unrefunded ticket of `event`, each in its own transaction. Returns how many this call refunded (their
    ids appended to `refunded` when it is a list). A RefundError on one ticket is logged (by type only) and leaves it for
    a later call; the rest carry on."""
    now = now or timezone.now()
    ids = list(Ticket.objects.filter(ticket_type__event=event, refunded_at__isnull=True).order_by("pk").values_list("pk", flat=True))
    count = 0
    for ticket_id in ids:
        try:
            with transaction.atomic():
                if _refund_one(ticket_id, by=by, reason=reason, now=now):
                    count += 1
                    if refunded is not None:
                        refunded.append(ticket_id)
        except RefundError as exc:
            logger.warning(
                "Cancelled event %s: refund of ticket %s failed (%s); left for the sweep", event.pk, ticket_id, type(exc).__name__,
            )
    return count
