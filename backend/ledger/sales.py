"""Services, stays and event tickets in the ledger (Plan 1b; spec §4.2, §1 rows 2, 3 and 11, §3.2).

A paid service request, stay booking or ticket purchase is one `BookingSale`: one customer, one business and one fee
category (services and stays use the services table, tickets the events table: spec §1 row 11), with its platform fee
fixed on the row at payment (spec §3.2 step 4). The lifetime cap is counted across every category (fees.charged_to_date).

Payment journal booking-pay-<session reference> (kind booking_payment), in pesewas:
    Dr provider clearing   what the customer paid less the payment-processing charge (Dr customer wallet instead when
                           they paid from it)
    Cr vendor pending      the same amount: a booking has no delivery fee and no coupon
The key names the checkout session, so the nightly reconciliation can expect it from the session alone.

Lock order (spec W7, extended to bookings): the service request or stay booking row (tickets: the purchase's ticket
rows, in primary-key order), then the sale row, then the ledger accounts in primary-key order in one pass
(posting.lock). A business's Pending account is locked before its fees so far are read, as escrow.record_order_payment
does, so a product payment and a booking payment for one business never both see the same cap remainder."""
from datetime import timedelta

from django.db import transaction
from django.db.models import Exists, OuterRef, Q
from django.utils import timezone

from . import escrow, fees, posting, settings_store
from .models import Account, BookingSale, FeeRuleSet, FulfilmentCheck, Journal
from .money import from_pesewas, to_pesewas
from .verification import VerificationError

# Spec §1 row 11: stays count as services; tickets use the events table, whatever category the listing or event is in.
CATEGORY = {BookingSale.SERVICE: FeeRuleSet.SERVICE, BookingSale.STAY: FeeRuleSet.SERVICE, BookingSale.TICKETS: FeeRuleSet.EVENT}
SUBJECT = {BookingSale.SERVICE: "service_request", BookingSale.STAY: "booking", BookingSale.TICKETS: "event"}


def pay_key(session):
    return f"booking-pay-{session.reference}"


def release_key(sale):
    return f"booking-release-{sale.pk}"


def refund_key(sale, source):
    return f"booking-refund-{sale.pk}-{source}"


def price_of(kind, subject, session):
    """What the business is owed, in pesewas, from what the server priced (never the client): a service request's agreed
    price, a stay's total, or the ticket unit price times the quantity the purchase view put on the session."""
    if kind == BookingSale.SERVICE:
        amount = subject.agreed_price
    elif kind == BookingSale.STAY:
        amount = subject.total_price
    else:
        return to_pesewas(session.metadata["unit_price"]) * int(session.metadata["quantity"])
    if amount is None:
        raise posting.PostingError(f"Booking payment {session.reference} has no price to record")
    return to_pesewas(amount)


def record_payment(session, kind, subject, business_owner, *, at=None):
    """Record a paid booking: the sale with its fee snapshot, and the payment journal. `subject` is the ServiceRequest,
    the Booking or (tickets) the Event; the payment finalizer holds its row lock. Returns the sale; the one already
    recorded for this session when called again (a retried webhook); None while the ledger is off and for a GH₵ 0.00
    booking. Raises posting.PostingError, writing nothing, when what was paid is not the price (or the price is below
    zero), and posting.InsufficientFunds, writing nothing, when a wallet paying for it is too low."""
    from payments.models import CheckoutSession

    if not escrow.enabled() or business_owner is None:
        return None  # ledger off, or a customer-organised event: no business is owed anything
    at = at or timezone.now()
    with transaction.atomic():
        existing = BookingSale.objects.filter(session=session).first()
        if existing is not None:
            return existing
        if session.provider == CheckoutSession.WALLET and to_pesewas(session.processing_fee or 0):
            raise posting.PostingError(f"Booking payment {session.reference} is from the wallet but carries a processing charge")
        base = price_of(kind, subject, session)
        paid = to_pesewas(session.amount) - to_pesewas(session.processing_fee or 0)
        if base < 0 or paid != base:
            raise posting.PostingError(f"Booking payment {session.reference} does not match its price: paid {paid}, price {base}")
        if base == 0:
            return None  # nothing to hold for a free booking: neither a sale nor a journal
        pending = posting.account_for(Account.VENDOR_PENDING, business_owner)
        source = (
            posting.account_for(Account.CUSTOMER_WALLET, session.customer) if session.provider == CheckoutSession.WALLET
            else posting.account_for(Account.PROVIDER_CLEARING)
        )
        posting.lock(pending, source)
        cap = settings_store.current("fee_cap_pesewas", at)
        category = CATEGORY[kind]
        quote = fees.quote(category, base, cap=cap, already_charged=fees.charged_to_date(business_owner), at=at)
        sale = BookingSale.objects.create(
            kind=kind, session=session, customer=session.customer, business_owner=business_owner,
            category=category, rule_set_id=quote.rule_set_id, base_pesewas=base, computed_pesewas=quote.computed,
            charged_pesewas=quote.charged, cap_pesewas=cap, paid_at=at, **{SUBJECT[kind]: subject},
        )
        posting.post(
            key=pay_key(session), kind="booking_payment", lines=[posting.debit(source, base), posting.credit(pending, base)],
            reference_type="ledger.bookingsale", reference_id=str(sale.pk), memo=f"Payment for {sale.label()}",
        )
        return sale


# --- after payment: hand-over, Support's call and the release (spec §4.2; Plan 1b S5–S9) ---------------------------

MATCHES, DOES_NOT_MATCH, UNREACHABLE = FulfilmentCheck.MATCHES, FulfilmentCheck.DOES_NOT_MATCH, FulfilmentCheck.UNREACHABLE
NOT_HANDED_OVER = {
    BookingSale.SERVICE: "The business has not marked this service done yet.",
    BookingSale.STAY: "The guest has not checked in yet.",
    BookingSale.TICKETS: "The event has not taken place yet and no ticket was scanned.",
}


def tickets_of(sale):
    """A ticket purchase's tickets (those bought on its checkout session's transaction); none for another kind."""
    from events.models import Ticket

    if sale.kind != BookingSale.TICKETS:
        return Ticket.objects.none()
    return Ticket.objects.filter(transaction_id=sale.session.transaction_id)


def handed_over_at(sale, now=None):
    """When the booking reached the customer, or None (spec §4.2, settled in Plan 1b S5): the business marked the
    service done; the guest checked in; for tickets, the first scan at the door, or else the event's date once it has
    passed."""
    now = now or timezone.now()
    if sale.kind == BookingSale.SERVICE:
        return sale.service_request.completed_at
    if sale.kind == BookingSale.STAY:
        return sale.booking.checked_in_at
    first_scan = (
        tickets_of(sale).filter(delivered_at__isnull=False).order_by("delivered_at").values_list("delivered_at", flat=True).first()
    )
    if first_scan is not None:
        return first_scan
    return sale.event.event_date if sale.event.event_date <= now else None


def customer_confirmed(sale):
    """Support recorded the customer's confirmation on the call, or a ticket of the purchase was scanned at the door."""
    if sale.phone_confirmed_at is not None:
        return True
    return tickets_of(sale).filter(delivered_at__isnull=False).exists()


def has_open_dispute(sale):
    from disputes.models import Dispute

    return sale.dispute_id is not None and Dispute.objects.filter(pk=sale.dispute_id).exclude(status__in=Dispute.FINAL_STATUSES).exists()


def lock(sale):
    """Take the locks a money step on `sale` needs, in the one order every path uses (module docstring): the service
    request or stay booking row (tickets: the purchase's tickets in primary-key order), then the sale row. Returns the
    sale fresh from its locked row. Call inside transaction.atomic()."""
    from bookings.models import Booking
    from events.models import Ticket
    from services.models import ServiceRequest

    if sale.kind == BookingSale.SERVICE:
        ServiceRequest.objects.select_for_update().get(pk=sale.service_request_id)
    elif sale.kind == BookingSale.STAY:
        Booking.objects.select_for_update().get(pk=sale.booking_id)
    else:
        list(Ticket.objects.select_for_update().filter(transaction_id=sale.session.transaction_id).order_by("pk"))
    return BookingSale.objects.select_for_update(of=("self",)).select_related(
        "session", "service_request", "booking", "event", "customer", "business_owner",
    ).get(pk=sale.pk)


def release(sale, now=None):
    """Pay a verified booking's held money out (spec §4.2 and §2.2 step 2): AshantiHub's fee first, then the business's
    Available, only what refunds left. Never by a timer: record_verification, on "matches", is the only caller and holds
    lock(sale). Returns the journal, or None while the ledger is off, without a positive call, with a dispute open, or
    once released or refunded in full. It also marks the purchase's tickets released (their old escrow flag, S9)."""
    from events.models import Ticket

    if not escrow.enabled():
        return None
    now = now or timezone.now()
    if sale.outcome != MATCHES or sale.released_at is not None or sale.reversed_at is not None or has_open_dispute(sale):
        return None
    if Journal.objects.filter(key=release_key(sale)).exists() or not Journal.objects.filter(key=pay_key(sale.session)).exists():
        return None
    base = sale.base_pesewas - sale.refunded_base_pesewas
    if base <= 0:
        return None
    fee = sale.charged_pesewas - sale.refunded_fee_pesewas
    pending = posting.account_for(Account.VENDOR_PENDING, sale.business_owner)
    income = posting.account_for(Account.PLATFORM_FEE_INCOME)
    available = posting.account_for(Account.VENDOR_AVAILABLE, sale.business_owner)
    posting.lock(pending, income, available)
    lines = [posting.debit(pending, base)]
    if fee > 0:
        lines.append(posting.credit(income, fee))
    if base - fee > 0:
        lines.append(posting.credit(available, base - fee))
    journal = posting.post(
        key=release_key(sale), kind="booking_release", lines=lines,
        reference_type="ledger.bookingsale", reference_id=str(sale.pk), memo=f"Release of {sale.label()}",
    )
    sale.released_at = now
    sale.save(update_fields=["released_at"])
    tickets_of(sale).filter(refunded_at__isnull=True, escrow_status=Ticket.HELD).update(
        escrow_status=Ticket.RELEASED, escrow_released_at=now,
    )
    return journal


def record_verification(sale, staff, outcome, *, note="", customer_confirmed_by_phone=False, now=None):
    """Support's verification call for a booking (spec §4.2). "matches" releases the money at once; "does not match"
    opens a dispute due `verification_overdue_hours` after hand-over (S7) and releases nothing; "could not reach" is only
    recorded. Raises VerificationError, saving nothing, when the ledger is off or the booking cannot be verified now.
    A repeat "does not match" while the dispute is open adds its note to that dispute; if the earlier dispute was
    rejected a new one is refused (it is reopened instead), so the sale's linked dispute is never replaced while it
    could still be reopened. The dispute's due time is hand-over + verification_overdue_hours: provisional, owner to
    confirm (spec gate (lvii)). Returns the sale."""
    from disputes.models import Dispute

    now = now or timezone.now()
    if not escrow.enabled():
        raise VerificationError("The ledger is off.", 409)
    if outcome not in (MATCHES, DOES_NOT_MATCH, UNREACHABLE):
        raise VerificationError("Pick matches, does not match, or could not reach.", 400)
    if note is not None and not isinstance(note, str):
        raise VerificationError("The note must be text.", 400)
    note = (note or "").strip()[:500]
    if outcome == DOES_NOT_MATCH and not note:
        raise VerificationError("Say what does not match.", 400)
    with transaction.atomic():
        sale = lock(sale)
        if sale.reversed_at is not None:
            raise VerificationError("This booking was refunded in full.")
        if sale.released_at is not None:
            raise VerificationError("This booking has already been released to the business.")
        handed = handed_over_at(sale, now)
        if handed is None:
            raise VerificationError(NOT_HANDED_OVER[sale.kind])
        if outcome == MATCHES:
            if has_open_dispute(sale):
                raise VerificationError("A dispute is open on this booking. It must be settled first.")
            if customer_confirmed_by_phone and sale.phone_confirmed_at is None:
                sale.phone_confirmed_at = now
            if not customer_confirmed(sale):
                raise VerificationError("Record the customer's confirmation first.")
        if outcome == DOES_NOT_MATCH and sale.dispute_id is not None:
            existing = sale.dispute
            if existing.status == Dispute.REJECTED:
                raise VerificationError("The earlier dispute was rejected — reopen it instead of logging a new one.")
            if existing.status not in Dispute.FINAL_STATUSES:
                existing.description = f"{existing.description}\n[{timezone.localtime(now):%Y-%m-%d %H:%M}] Still does not match: {note}"
                existing.save(update_fields=["description"])
        elif outcome == DOES_NOT_MATCH:
            hours = settings_store.current("verification_overdue_hours", now)
            # Logged by staff on the customer's behalf: raised_by stays null (the disputes convention, S8).
            sale.dispute = Dispute.objects.create(
                order=None, raised_by=None, logged_by=staff, reason=Dispute.QUALITY_ISSUE, status=Dispute.OPEN,
                description=f"{sale.label().capitalize()} does not match: {note}", answer_due_at=handed + timedelta(hours=hours),  # provisional, owner to confirm (gate (lvii))
            )
        sale.outcome, sale.outcome_note, sale.outcome_at, sale.outcome_by = outcome, note, now, staff
        sale.save(update_fields=["phone_confirmed_at", "outcome", "outcome_note", "outcome_at", "outcome_by", "dispute"])
        if outcome == MATCHES and release(sale, now) is None:
            raise VerificationError("The booking could not be released. Check for an open dispute and try again.", 409)
        return sale


# --- Support's list (Plan 1b; paginated from the start, unlike the products list, spec §13 (ii)) --------------------

def description(sale):
    """What was bought, in words, for Support's call and the business's sales list."""
    if sale.kind == BookingSale.SERVICE:
        return sale.service_request.listing.name
    if sale.kind == BookingSale.STAY:
        booking = sale.booking
        units = f", {booking.units} units" if booking.units != 1 else ""
        return f"{booking.listing.name}, {booking.check_in:%d %b} to {booking.check_out:%d %b}{units}"
    quantity = int(sale.session.metadata.get("quantity") or 0)
    noun = "ticket" if quantity == 1 else "tickets"
    return f"{quantity} {noun} for {sale.event.name}, {timezone.localtime(sale.event.event_date):%d %b %Y}"


def awaiting(now=None):
    """Bookings handed over (S5) and waiting for Support's call: not released and not refunded in full, oldest paid
    first. A queryset, for a paginated screen."""
    from events.models import Ticket

    now = now or timezone.now()
    scanned = Ticket.objects.filter(transaction_id=OuterRef("session__transaction_id"), delivered_at__isnull=False)
    return (
        BookingSale.objects.filter(released_at__isnull=True, reversed_at__isnull=True)
        .annotate(scanned=Exists(scanned))
        .filter(
            Q(kind=BookingSale.SERVICE, service_request__completed_at__isnull=False)
            | Q(kind=BookingSale.STAY, booking__checked_in_at__isnull=False)
            | Q(kind=BookingSale.TICKETS, scanned=True)
            | Q(kind=BookingSale.TICKETS, event__event_date__lte=now)
        )
        .select_related(
            "session", "customer", "business_owner__profile", "service_request__listing", "booking__listing", "event",
        )
        .order_by("paid_at", "id")
    )


def queue_row(sale, now, hours):
    """One row of Support's list. `due_by` and `overdue` count `hours` (verification_overdue_hours) from hand-over (S7).
    Carries the customer's phone: only for the orders.verify screen."""
    handed = handed_over_at(sale, now)
    due = handed + timedelta(hours=hours) if handed is not None else None
    return {
        "sale_id": sale.pk, "kind": sale.kind, "label": sale.label(), "what": description(sale), "paid_at": sale.paid_at,
        "handed_over_at": handed, "due_by": due, "overdue": due is not None and now > due,
        "business": sale.business_owner.display_name, "customer_name": sale.customer.full_name,
        "customer_phone": sale.customer.phone,
        "amount": str(from_pesewas(sale.base_pesewas - sale.refunded_base_pesewas)),
        "customer_confirmed": customer_confirmed(sale), "outcome": sale.outcome, "outcome_note": sale.outcome_note,
        "dispute_id": sale.dispute_id,
    }
