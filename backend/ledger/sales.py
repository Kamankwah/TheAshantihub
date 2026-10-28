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
does, so a product payment and a booking payment for one business never both see the same cap remainder.

Release journal booking-release-<sale> (kind booking_release), in pesewas, for what refunds left (base B, fee F):
    Dr vendor pending B; Cr platform fee income F; Cr vendor available B - F.
Refund journal booking-refund-<sale>-<source> (kind booking_refund), always to the customer's wallet:
    before release  Dr vendor pending (amount)
    after release   Dr vendor available (amount); Dr platform fee income / Cr vendor available (the fee share returned)
    on fault only   Dr provider fees (the processing charge returned)
    both            Cr customer wallet (amount + processing charge)."""
from datetime import datetime, time, timedelta, timezone as dt_timezone

from django.db import transaction
from django.db.models import Exists, OuterRef, Q, Sum
from django.utils import timezone

from . import cancellation, escrow, fees, posting, settings_store
from .models import Account, BookingRefund, BookingSale, FeeRuleSet, FulfilmentCheck, Journal
from .money import from_pesewas, to_pesewas
from .refunds import RefundError, _check_amount, fee_share
from .verification import VerificationError

# Spec §1 row 11: stays count as services; tickets use the events table, whatever category the listing or event is in.
CATEGORY = {BookingSale.SERVICE: FeeRuleSet.SERVICE, BookingSale.STAY: FeeRuleSet.SERVICE, BookingSale.TICKETS: FeeRuleSet.EVENT}
SUBJECT = {BookingSale.SERVICE: "service_request", BookingSale.STAY: "booking", BookingSale.TICKETS: "event"}


def _text(which, sale, *args):
    """The business's text for this step (wallets.vendor_texts: never raises, nothing while the ledger is off). Imported
    here because wallets.vendor imports this module."""
    from wallets import vendor_texts

    getattr(vendor_texts, which)(sale, *args)


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


def policy_of(kind, subject):
    """The cancellation policy a booking is being paid under, as stored on the sale (Plan 7E): the listing's for a service
    or stay; for tickets none, unless the organiser offers refunds until some days before the event."""
    if kind == BookingSale.TICKETS:
        days = subject.refund_until_days_before
        return cancellation.snapshot(cancellation.NONE) if days is None else cancellation.until_days_before(days)
    return cancellation.snapshot(subject.listing.cancellation_policy)


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
            charged_pesewas=quote.charged, cap_pesewas=cap, paid_at=at, policy_snapshot=policy_of(kind, subject),
            **{SUBJECT[kind]: subject},
        )
        posting.post(
            key=pay_key(session), kind="booking_payment", lines=[posting.debit(source, base), posting.credit(pending, base)],
            reference_type="ledger.bookingsale", reference_id=str(sale.pk), memo=f"Payment for {sale.label()}",
        )
        _text("booking_paid", sale)
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


STAY_CHECK_IN_TIME = time(14, 0)  # Accra time; no listing carries its own check-in time yet


def release_hours(now=None):
    """The three settings `release_at` reads, at `now`, so a list of sales can read them once."""
    now = now or timezone.now()
    return {key: settings_store.current(key, now) for key in ("service_auto_accept_hours", "stay_issue_window_hours", "event_release_delay_hours")}


def release_at(sale, now=None, *, hours=None):
    """When a booking's money releases by itself (Plan 7E), or None while its milestone has not happened. Accra time is
    UTC all year. Service: the customer's accept, else the business marking it done plus `service_auto_accept_hours`.
    Stay: the scheduled check-in time plus `stay_issue_window_hours` (a no-show is released the same way). Tickets: the
    end of the event's day plus `event_release_delay_hours` (an event carries no end time). The settings are read at
    `now`, so a change applies to every sale not yet released. `hours` (release_hours(now)) saves the lookups for a list."""
    now = now or timezone.now()
    key = {
        BookingSale.SERVICE: "service_auto_accept_hours", BookingSale.STAY: "stay_issue_window_hours",
    }.get(sale.kind, "event_release_delay_hours")
    setting = hours[key] if hours is not None else settings_store.current(key, now)  # one lookup, only the one needed
    if sale.kind == BookingSale.SERVICE:
        done = sale.service_request.completed_at
        if done is None:
            return None
        auto = done + timedelta(hours=setting)
        accepted = sale.customer_accepted_at
        return min(auto, accepted) if accepted is not None else auto
    if sale.kind == BookingSale.STAY:
        start = datetime.combine(sale.booking.check_in, STAY_CHECK_IN_TIME, tzinfo=dt_timezone.utc)
        return start + timedelta(hours=setting)
    event_day = sale.event.event_date.astimezone(dt_timezone.utc).date()
    day_end = datetime.combine(event_day + timedelta(days=1), time(0, 0), tzinfo=dt_timezone.utc)
    return day_end + timedelta(hours=setting)


def release_due(now=None):
    """The hourly job: release every booking whose `release_at` has passed, not released or refunded in full, with no
    open dispute and no negative call from Support. Each release is recorded as a "matches" outcome with no staff member
    and says it was automatic. Returns how many were released; a no-op while the ledger is off. A sale that cannot be
    released now (a dispute is open) is left for a later run."""
    from events.models import Event

    if not escrow.enabled():
        return 0
    now = now or timezone.now()
    candidates = (
        BookingSale.objects.filter(released_at__isnull=True, reversed_at__isnull=True)
        .filter(Q(outcome__in=["", UNREACHABLE]) | Q(outcome=DOES_NOT_MATCH, dispute__isnull=False))
        .select_related("service_request", "booking", "event")
    )
    released = 0
    hours = release_hours(now)
    for candidate in candidates:
        due = release_at(candidate, now, hours=hours)
        if due is None or due > now:
            continue
        if candidate.kind == BookingSale.TICKETS and candidate.event.status in (Event.PENDING, Event.REJECTED):
            continue  # an event sent back for review or rejected is not paid out; one merely past its listing window is
        if candidate.kind == BookingSale.TICKETS and candidate.event.status == Event.CANCELLED:
            continue  # a cancelled event's tickets are being refunded (events.cancellation), never paid out
        try:
            with transaction.atomic():
                sale = lock(candidate)
                due = release_at(sale, now, hours=hours)
                if due is None or due > now:
                    continue
                if _release_on_clock(sale, now, f"Released automatically at {timezone.localtime(now):%Y-%m-%d %H:%M}."):
                    released += 1
        except _NotReleasable:
            continue
    return released


def _release_on_clock(sale, now, note):
    """Inside `lock(sale)`: record a "matches" outcome by no staff member and release. False when it is already released,
    refunded in full or has a negative call; raises _NotReleasable (rolling back the caller's atomic block) when a
    dispute is open."""
    if sale.released_at is not None or sale.reversed_at is not None:
        return False
    if sale.outcome not in ("", UNREACHABLE) and not (sale.outcome == DOES_NOT_MATCH and sale.dispute_id is not None):
        return False  # a negative call stands until its dispute is closed (has_open_dispute then decides in release)
    sale.outcome, sale.outcome_at, sale.outcome_by, sale.outcome_note = MATCHES, now, None, note
    sale.save(update_fields=["outcome", "outcome_at", "outcome_by", "outcome_note"])
    if release(sale, now) is None:
        raise _NotReleasable
    return True


class _NotReleasable(Exception):
    """A due sale could not be released now (a dispute is open): the attempt is rolled back."""


class AcceptError(Exception):
    def __init__(self, message, status_code=409):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def accept(sale, customer, now=None):
    """The customer accepts a delivered service in the app (Plan 7E): it releases at once. 403 for another customer, 409
    before the business marked it done, once released or refunded, or while a problem is open. Returns the sale."""
    now = now or timezone.now()
    if not escrow.enabled():
        raise AcceptError("The ledger is off.")
    with transaction.atomic():
        sale = lock(sale)
        if sale.customer_id != customer.pk or sale.kind != BookingSale.SERVICE:
            raise AcceptError("This is not your service.", 403)
        if sale.released_at is not None or sale.reversed_at is not None:
            raise AcceptError("This has already been settled.")
        if sale.service_request.completed_at is None:
            raise AcceptError("The business has not marked this service done yet.")
        if has_open_dispute(sale):
            raise AcceptError("A problem is open on this service. Support will settle it first.")
        sale.customer_accepted_at = sale.customer_accepted_at or now
        sale.save(update_fields=["customer_accepted_at"])
        try:
            with transaction.atomic():
                if not _release_on_clock(sale, now, "Accepted by the customer in the app."):
                    raise _NotReleasable
        except _NotReleasable:
            raise AcceptError("This could not be released now: a problem is open or Support has a negative call on it.") from None
        return sale


def report_problem(sale, customer, reason, now=None):
    """The customer reports a problem with a service, stay or tickets before the money is released (Plan 7E): a dispute
    that stops the automatic release, and Support is told. 403 for another customer; 409 once released or refunded in
    full, or when an earlier dispute was already settled; a problem already open takes the new words as a note.
    Returns the sale."""
    from disputes.models import Dispute

    now = now or timezone.now()
    reason = (reason or "").strip()[:500]
    if len(reason) < 5:
        raise AcceptError("Say what went wrong (at least 5 characters).", 400)
    if not escrow.enabled():
        raise AcceptError("The ledger is off.")
    with transaction.atomic():
        if sale.dispute_id is not None:
            Dispute.objects.select_for_update().get(pk=sale.dispute_id)
        sale = lock(sale)
        if sale.customer_id != customer.pk:
            raise AcceptError("This is not your booking.", 403)
        if sale.released_at is not None or sale.reversed_at is not None:
            raise AcceptError("This has already been settled. Contact Support if something is wrong.")
        if sale.dispute_id is not None:
            existing = sale.dispute
            if existing.status in Dispute.FINAL_STATUSES:
                raise AcceptError("A problem on this booking was already settled.")
            existing.description = f"{existing.description}\n[{timezone.localtime(now):%Y-%m-%d %H:%M}] Customer: {reason}"
            existing.save(update_fields=["description"])
            return sale
        auto_at = release_at(sale, now)
        answer_due = auto_at if auto_at is not None and auto_at > now else now + timedelta(hours=24)
        sale.dispute = Dispute.objects.create(
            order=None, raised_by=customer, reason=Dispute.QUALITY_ISSUE, status=Dispute.OPEN,
            description=f"{sale.label().capitalize()}: {reason}", answer_due_at=answer_due,
        )
        sale.save(update_fields=["dispute"])
        _text("booking_on_hold", sale)
    return sale


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
    _text("booking_released", sale, journal)
    return journal


def record_verification(sale, staff, outcome, *, note="", customer_confirmed_by_phone=False, now=None):
    """Support's verification call for a booking (spec §4.2). "matches" releases the money at once; "does not match"
    opens a dispute due `verification_overdue_hours` after hand-over (S7) and releases nothing; "could not reach" is only
    recorded. Raises VerificationError, saving nothing, when the ledger is off or the booking cannot be verified now.
    A repeat "does not match" while the dispute is open adds its note to that dispute; if the earlier dispute was
    rejected a new one is refused (it is reopened instead), and if it was resolved (final) a new one is refused too
    (the Support lead logs it), so the sale's linked dispute is never replaced or silently ignored. The dispute row is
    locked before the sale, as disputes resolve. The dispute's due time is hand-over + verification_overdue_hours: provisional, owner to
    confirm (spec gate (lvii)). Returns the sale."""
    from disputes.models import Dispute

    now = now or timezone.now()
    if not escrow.enabled():
        raise VerificationError("The ledger is off.", 409, code="ledger_off")
    if outcome not in (MATCHES, DOES_NOT_MATCH, UNREACHABLE):
        raise VerificationError("Pick matches, does not match, or could not reach.", 400)
    if note is not None and not isinstance(note, str):
        raise VerificationError("The note must be text.", 400)
    note = (note or "").strip()[:500]
    if outcome == DOES_NOT_MATCH and not note:
        raise VerificationError("Say what does not match.", 400)
    with transaction.atomic():
        locked_dispute_id = sale.dispute_id
        if sale.dispute_id is not None:  # dispute → subject → sale, the order disputes resolve in (no deadlock with it)
            Dispute.objects.select_for_update().get(pk=sale.dispute_id)
        sale = lock(sale)
        if sale.dispute_id is not None and sale.dispute_id != locked_dispute_id:
            # Another call linked a dispute after we read the sale: we hold no lock on it, so touch nothing; retry.
            raise VerificationError("Another call just logged a dispute — try again.", 409)
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
            if existing.status == Dispute.RESOLVED:
                raise VerificationError("The earlier dispute was resolved — ask the Support lead to log a new one.")
            if existing.status not in Dispute.FINAL_STATUSES:
                existing.description = f"{existing.description}\n[{timezone.localtime(now):%Y-%m-%d %H:%M}] Still does not match: {note}"
                existing.save(update_fields=["description"])
        elif outcome == DOES_NOT_MATCH:
            # Support has until the automatic release time to answer, or a day when that has gone by (Plan 7E ruling).
            auto_at = release_at(sale, now)
            answer_due = auto_at if auto_at is not None and auto_at > now else now + timedelta(hours=24)
            # Logged by staff on the customer's behalf: raised_by stays null (the disputes convention, S8).
            sale.dispute = Dispute.objects.create(
                order=None, raised_by=None, logged_by=staff, reason=Dispute.QUALITY_ISSUE, status=Dispute.OPEN,
                description=f"{sale.label().capitalize()} does not match: {note}", answer_due_at=answer_due,
            )
        sale.outcome, sale.outcome_note, sale.outcome_at, sale.outcome_by = outcome, note, now, staff
        sale.save(update_fields=["phone_confirmed_at", "outcome", "outcome_note", "outcome_at", "outcome_by", "dispute"])
        if outcome == MATCHES and release(sale, now) is None:
            raise VerificationError("The booking could not be released. Check for an open dispute and try again.", 409)
        return sale


# --- Support's list (Plan 1b; paginated from the start, unlike the products list, spec §13 (ii)) --------------------

def description(sale, *, live_tickets=None):
    """What was bought, in words, for Support's call and the business's sales list. `live_tickets`: the purchase's
    unrefunded ticket count when the caller already has it (a list does it in one query)."""
    if sale.kind == BookingSale.SERVICE:
        return sale.service_request.listing.name
    if sale.kind == BookingSale.STAY:
        booking = sale.booking
        units = f", {booking.units} units" if booking.units != 1 else ""
        return f"{booking.listing.name}, {booking.check_in:%d %b} to {booking.check_out:%d %b}{units}"
    if live_tickets is None:
        live_tickets = tickets_of(sale).filter(refunded_at__isnull=True).count()
    quantity = live_tickets or int(sale.session.metadata.get("quantity") or 0)
    noun = "ticket" if quantity == 1 else "tickets"
    return f"{quantity} {noun} for {sale.event.name}, {timezone.localtime(sale.event.event_date):%d %b %Y}"


def awaiting(now=None):
    """Bookings handed over (S5) and waiting for Support's call: not released and not refunded in full, longest since
    hand-over first (so every overdue one comes before any that is not: overdue is hand-over + hours < now), then oldest
    paid. A queryset, for a paginated screen."""
    from django.db.models import Case, DateTimeField, Min, Subquery, When
    from django.db.models.functions import Coalesce
    from events.models import Ticket

    now = now or timezone.now()
    scanned = Ticket.objects.filter(transaction_id=OuterRef("session__transaction_id"), delivered_at__isnull=False)
    return (
        BookingSale.objects.filter(released_at__isnull=True, reversed_at__isnull=True)
        .annotate(scanned=Exists(scanned))
        .annotate(first_scan=Subquery(
            Ticket.objects.filter(transaction_id=OuterRef("session__transaction_id"), delivered_at__isnull=False)
            .values("transaction_id").annotate(first=Min("delivered_at")).values("first")[:1]
        ))
        .annotate(handed_at=Case(
            When(kind=BookingSale.SERVICE, then="service_request__completed_at"),
            When(kind=BookingSale.STAY, then="booking__checked_in_at"),
            default=Coalesce("first_scan", "event__event_date"),
            output_field=DateTimeField(),
        ))
        .filter(
            Q(kind=BookingSale.SERVICE, service_request__completed_at__isnull=False)
            | Q(kind=BookingSale.STAY, booking__checked_in_at__isnull=False)
            | Q(kind=BookingSale.TICKETS, scanned=True)
            | Q(kind=BookingSale.TICKETS, event__event_date__lte=now)
        )
        .select_related(
            "session", "customer", "business_owner__profile", "service_request__listing", "booking__listing", "event",
        )
        .order_by("handed_at", "paid_at", "id")
    )


def queue_row(sale, now):
    """One row of Support's list. `due_by` is when the booking releases by itself (Plan 7E), `overdue` once that time has
    passed and it still has not. Carries the customer's phone: only for the orders.verify screen."""
    handed = handed_over_at(sale, now)
    due = release_at(sale, now)
    return {
        "sale_id": sale.pk, "kind": sale.kind, "label": sale.label(), "what": description(sale), "paid_at": sale.paid_at,
        "handed_over_at": handed, "due_by": due, "overdue": due is not None and now > due,
        "business": sale.business_owner.display_name, "customer_name": sale.customer.full_name,
        "customer_phone": sale.customer.phone,
        "amount": str(from_pesewas(sale.base_pesewas - sale.refunded_base_pesewas)),
        "customer_confirmed": customer_confirmed(sale), "outcome": sale.outcome, "outcome_note": sale.outcome_note,
        "dispute_id": sale.dispute_id,
    }


def lookup(q, now=None):
    """Support's booking search (gate (lxxiii)): sales neither released nor reversed, newest paid first, whose number,
    customer, business, listing or phone matches `q`. A number (# stripped, at most 9 digits) is the sale, service
    request or booking id; text matches the customer, business, service, stay or event name; a phone matches the
    customer's. No `q`: all of them. A queryset; the view caps it."""
    from accounts.phones import filter_by_phone, phone_key

    qs = (
        BookingSale.objects.filter(released_at__isnull=True, reversed_at__isnull=True)
        .select_related(
            "session", "customer", "business_owner__profile", "service_request__listing", "booking__listing", "event",
        )
        .order_by("-paid_at", "-id")
    )
    q = (q or "").strip()
    if not q:
        return qs
    found = Q()
    number = q.lstrip("#")
    if number.isascii() and number.isdigit() and len(number) <= 9:
        found |= Q(pk=int(number)) | Q(service_request_id=int(number)) | Q(booking_id=int(number))
    found |= (
        Q(customer__full_name__icontains=q)
        | Q(business_owner__profile__business_name__icontains=q)
        | Q(business_owner__full_name__icontains=q)
        | Q(service_request__listing__name__icontains=q)
        | Q(booking__listing__name__icontains=q)
        | Q(event__name__icontains=q)
    )
    if phone_key(q):
        found |= Q(pk__in=filter_by_phone(BookingSale.objects.all(), "customer__phone", q).values("pk"))
    return qs.filter(found)


def lookup_row(sale, now):
    """One row of the lookup. Only the masked phone: the full number is for the orders.verify screens."""
    from accounts.phones import mask_phone

    handed = handed_over_at(sale, now)
    return {
        "sale_id": sale.pk, "kind": sale.kind, "what": description(sale), "paid_at": sale.paid_at,
        "business": sale.business_owner.display_name, "customer_name": sale.customer.full_name,
        "customer_phone": mask_phone(sale.customer.phone) if sale.customer.phone else "",
        "amount": str(from_pesewas(sale.base_pesewas - sale.refunded_base_pesewas)),
        "handed_over_at": handed, "cancellable": handed is None, "release_at": release_at(sale, now),
    }


# --- refunds, always to the customer's wallet (spec §2.2 steps 3-4, §5; Plan 1b S12) -------------------------------

def _processing_share(sale, customer, whole):
    """The payment-processing charge to give back with `customer` pesewas of the price: what is left of it on the refund
    that empties the sale, else its share of the price, half up, never more than is left (3a W2)."""
    paid = to_pesewas(sale.session.processing_fee or 0)
    done = BookingRefund.objects.filter(sale=sale).aggregate(total=Sum("processing_pesewas"))["total"] or 0
    remaining = paid - done
    if remaining <= 0:
        return 0
    if whole:
        return remaining
    return min(remaining, (2 * paid * customer + sale.base_pesewas) // (2 * sale.base_pesewas))


def _cancel_if_not_handed_over(sale, by, note, now):
    """A booking refunded in full that never reached the customer is cancelled in the refund's own transaction, so it
    can no longer be done, checked into or used (the customer would have the money and the booking): a service request
    still accepted or in progress, a stay not yet checked in (its nights are freed). For tickets, every ticket of the
    purchase not yet scanned is marked refunded. The caller holds lock(sale)."""
    from accounts.models import StaffUser
    from bookings.models import Booking
    from services.models import ServiceRequest

    if sale.kind == BookingSale.SERVICE:
        ServiceRequest.objects.filter(
            pk=sale.service_request_id, status__in=(ServiceRequest.ACCEPTED, ServiceRequest.IN_PROGRESS),
        ).update(status=ServiceRequest.CANCELLED)
    elif sale.kind == BookingSale.STAY:
        Booking.objects.filter(pk=sale.booking_id, status__in=(Booking.PENDING, Booking.CONFIRMED)).update(
            status=Booking.CANCELLED, cancelled_at=now,
        )
    else:
        tickets_of(sale).filter(delivered_at__isnull=True, refunded_at__isnull=True).update(
            refunded_at=now, refunded_by_staff=by if isinstance(by, StaffUser) else None,
            refund_reason=(note or "Refunded with the purchase")[:500],
        )


def refund(sale, amount_pesewas=None, *, source, by=None, refund_processing=False, note="", now=None):
    """Give `amount_pesewas` of a booking back to the customer's AshantiHub wallet (None: all that is left). Returns the
    BookingRefund (the one already made when this source refunded before), or None while the ledger is off or when
    nothing is left. Raises RefundError, writing nothing, for an amount it cannot give.

    Before release the money comes out of the business's Pending (the fee on it is simply never charged); after release
    it comes out of the business's Available, which may go negative (later sales recover it), and the platform fee
    taken on it comes back in proportion (Dr platform fee income, Cr Available). The fee share is cumulative and half up
    (refunds.fee_share), so parts add up exactly to the fee taken, and it frees the lifetime cap. The payment-processing
    charge comes back only when staff say AshantiHub or the business was at fault (`refund_processing`): AshantiHub
    bears it (Dr provider fees), its share on a partial refund. The refund that empties the sale ("whole") marks it
    reversed and cancels a booking not yet handed over (_cancel_if_not_handed_over)."""
    if not escrow.enabled():
        return None
    if not source or len(source) > 60 or len(refund_key(sale, source)) > 120:  # BookingRefund.source is 60, the key 120
        raise ValueError(f"Bad refund source {source!r}")
    _check_amount(amount_pesewas)
    now = now or timezone.now()
    from accounts.models import StaffUser

    caller_sale = sale
    with transaction.atomic():
        sale = lock(sale)
        existing = BookingRefund.objects.filter(sale=sale, source=source).first()
        if existing is not None:
            return existing
        room = sale.base_pesewas - sale.refunded_base_pesewas
        if room <= 0:
            if amount_pesewas is not None:
                raise RefundError("Nothing is left to refund on this booking.")
            return None
        customer = room if amount_pesewas is None else amount_pesewas
        if customer > room:
            raise RefundError(f"Only GH₵ {from_pesewas(room)} of this booking can still be refunded.")
        whole = customer == room
        processing = _processing_share(sale, customer, whole) if refund_processing else 0
        after = sale.refunded_base_pesewas + customer
        fee_after = fee_share(sale, after)
        fee = fee_after - sale.refunded_fee_pesewas
        released = sale.released_at is not None
        owner = sale.business_owner
        lines = []
        if released:
            available = posting.account_for(Account.VENDOR_AVAILABLE, owner)
            lines.append(posting.debit(available, customer))
            if fee:
                lines += [posting.debit(posting.account_for(Account.PLATFORM_FEE_INCOME), fee), posting.credit(available, fee)]
        else:
            lines.append(posting.debit(posting.account_for(Account.VENDOR_PENDING, owner), customer))
        if processing:
            lines.append(posting.debit(posting.account_for(Account.PROVIDER_FEES), processing))
        lines.append(posting.credit(posting.account_for(Account.CUSTOMER_WALLET, sale.customer), customer + processing))
        posting.lock(*(line.account for line in lines))
        journal = posting.post(
            key=refund_key(sale, source), kind="booking_refund", lines=lines,
            reference_type="ledger.bookingsale", reference_id=str(sale.pk), memo=f"Refund for {sale.label()} ({source})",
        )
        sale.refunded_base_pesewas, sale.refunded_fee_pesewas = after, fee_after
        if whole:
            sale.reversed_at = now
        sale.save(update_fields=["refunded_base_pesewas", "refunded_fee_pesewas", "reversed_at"])
        given = BookingRefund.objects.create(
            sale=sale, source=source, whole=whole, released=released, amount_pesewas=customer, fee_pesewas=fee,
            processing_pesewas=processing, journal=journal, created_by=by if isinstance(by, StaffUser) else None, note=(note or "")[:300],
        )
        if whole:
            _cancel_if_not_handed_over(sale, by, note, now)
            for held in (sale, caller_sale):  # the cancel was an UPDATE: drop the cached rows so callers re-read the status
                for name in ("service_request", "booking"):
                    held._state.fields_cache.pop(name, None)
        return given


# --- cancels and ticket refunds (Plan 1b S9, S13) ----------------------------------------------------------------

class CancelError(Exception):
    def __init__(self, message, status_code=409):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


CUSTOMER_SOURCE = "cancel-customer"
ALREADY_HANDED_OVER = {
    BookingSale.SERVICE: "The business has already marked this service done. Open a dispute instead.",
    BookingSale.STAY: "The guest has already checked in. Open a dispute instead.",
    BookingSale.TICKETS: "The event has taken place or a ticket was scanned. Open a dispute instead.",
}


def cancel(sale, staff, reason, now=None):
    """Support cancels a paid booking the customer has not received yet (S13): refunded whole to the customer's wallet
    (not the processing charge: the customer asked) and cancelled with it (_cancel_if_not_handed_over). Raises
    CancelError, changing nothing, once it was refunded in full, released, or handed over (that is a dispute). Returns
    the BookingRefund."""
    now = now or timezone.now()
    with transaction.atomic():
        sale = lock(sale)
        if sale.reversed_at is not None:
            raise CancelError("This booking was already refunded in full.")
        if sale.released_at is not None:
            raise CancelError("This booking's money was already released to the business. Open a dispute instead.")
        if handed_over_at(sale, now) is not None:
            raise CancelError(ALREADY_HANDED_OVER[sale.kind])
        cancelling = list(tickets_of(sale).filter(refunded_at__isnull=True, delivered_at__isnull=True).select_related("ticket_type__event", "purchased_by"))
        given = refund(sale, source="cancel", by=staff, note=reason, now=now)
        for ticket in cancelling:  # the same REFUNDED billing.Transaction row the Accountant's per-ticket refund writes
            _ticket_refund_row(ticket)
        return given


def _policy_start(sale):
    """When the booking starts, for its cancellation policy: the stay's check-in time, the event's date; None for a
    service, which has no scheduled time."""
    if sale.kind == BookingSale.STAY:
        return datetime.combine(sale.booking.check_in, STAY_CHECK_IN_TIME, tzinfo=dt_timezone.utc)
    if sale.kind == BookingSale.TICKETS:
        return sale.event.event_date
    return None


def cancel_by_customer(sale, now=None):
    """The customer cancels their own paid booking under the policy it was paid under (Plan 7E): they get back
    `refund_share` of what is left of the price (the cut-off instant itself counts for them) plus the platform fee's
    proportional share, through `refund`, and the booking is cancelled even when the host keeps a part. Raises
    CancelError (409), changing nothing, for a sale paid before policies existed (only Support cancels it), one already
    cancelled or refunded in full, released, handed over or past its release milestone (that is a dispute, not a cancel),
    with a dispute open, or when the policy gives nothing back now. Returns the BookingRefund."""
    now = now or timezone.now()
    if not escrow.enabled():
        raise CancelError("The ledger is off.")
    with transaction.atomic():
        sale = lock(sale)
        if sale.policy_snapshot is None:
            raise CancelError("This booking can only be cancelled by AshantiHub Support. Use Contact Support.")
        if sale.reversed_at is not None or BookingRefund.objects.filter(sale=sale, source=CUSTOMER_SOURCE).exists():
            raise CancelError("This booking was already cancelled.")
        due = release_at(sale, now)
        if handed_over_at(sale, now) is not None:
            raise CancelError(ALREADY_HANDED_OVER[sale.kind])
        if sale.released_at is not None or (due is not None and due <= now):
            raise CancelError("This booking is past its cancellation window. Open a dispute instead.")
        if has_open_dispute(sale):
            raise CancelError("A problem is open on this booking. Support will settle it first.")
        share = cancellation.refund_share(sale.policy_snapshot, _policy_start(sale), now)
        room = sale.base_pesewas - sale.refunded_base_pesewas
        amount = room * share // cancellation.WHOLE if share < cancellation.WHOLE else room
        if share == 0 or amount <= 0:
            raise CancelError(f"Under this booking's cancellation policy nothing can be refunded now. {sale.policy_snapshot.get('text', '')}".strip())
        cancelling = list(tickets_of(sale).filter(refunded_at__isnull=True, delivered_at__isnull=True).select_related("ticket_type__event", "purchased_by"))
        note = "Cancelled by the customer"
        given = refund(sale, None if amount == room else amount, source=CUSTOMER_SOURCE, note=note, now=now)
        if not given.whole:  # the host keeps a share, but the booking itself is over
            _cancel_if_not_handed_over(sale, None, note, now)
        for ticket in cancelling:
            _ticket_refund_row(ticket)
        return given


def tell_cancelled(sale, given):
    """Tell the customer how much went back to their wallet, and the business that it was cancelled."""
    from notifications.services import notify_business_owner, notify_customer

    what = description(sale)
    back = from_pesewas(given.amount_pesewas)
    notify_customer(
        sale.customer, "booking", "Your booking was cancelled",
        body=f"You cancelled your booking ({what}). GH₵ {back} went back to your AshantiHub wallet.",
        link="/my-account", icon="🧾",
    )
    notify_business_owner(
        sale.business_owner, "booking", "Booking cancelled",
        body=f"A customer cancelled a booking ({what}) before it took place.", link="/business-dashboard", icon="⚠️",
    )


def _ticket_refund_row(ticket, amount=None):
    """Today's REFUNDED billing.Transaction for one ticket, as the Accountant's per-ticket refund has always written it
    (`amount`, in cedis, when less than the price was refunded: an event cancel on a partly refunded sale)."""
    from billing.models import Transaction
    from django.utils.crypto import get_random_string

    Transaction.objects.create(
        customer=ticket.purchased_by, amount=-(ticket.price if amount is None else amount), status=Transaction.REFUNDED,
        purpose=f"Refund for ticket {ticket.code} ('{ticket.ticket_type.event.name}')",
        reference=f"AH-REFUND-{ticket.id}-{get_random_string(8).upper()}",
    )


class TicketRefundError(Exception):
    def __init__(self, message):
        super().__init__(message)
        self.message = message


def refund_ticket(sale, ticket_id, *, by, reason, now=None):
    """The Accountant's refund of one ticket of a purchase (S9): its price back to the buyer's AshantiHub wallet (source
    ticket-<id>), with today's REFUNDED billing.Transaction and the ticket marked refunded. Takes lock(sale) first (the
    purchase's tickets, then the sale), so it never deadlocks with a scan, the call or another ticket's refund. A scanned
    or already refunded ticket cannot be refunded (TicketRefundError); RefundError when the ledger cannot give it.
    Returns (ticket, BookingRefund)."""
    from events.models import Ticket

    now = now or timezone.now()
    with transaction.atomic():
        sale = lock(sale)
        ticket = Ticket.objects.select_related("ticket_type__event", "purchased_by").get(
            pk=ticket_id, transaction_id=sale.session.transaction_id,
        )
        if ticket.delivered_at is not None:
            raise TicketRefundError("This ticket has already been delivered and cannot be refunded.")
        if ticket.refunded_at is not None:
            raise TicketRefundError("This ticket has already been refunded.")
        given = refund(sale, to_pesewas(ticket.price), source=f"ticket-{ticket.pk}", by=by, note=reason, now=now)
        _ticket_refund_row(ticket)
        Ticket.objects.filter(pk=ticket.pk).update(refunded_at=now, refunded_by_staff=by, refund_reason=reason)
        ticket.refresh_from_db()
        return ticket, given
