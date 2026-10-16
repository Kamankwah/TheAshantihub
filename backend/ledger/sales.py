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
from django.db import transaction
from django.utils import timezone

from . import escrow, fees, posting, settings_store
from .models import Account, BookingSale, FeeRuleSet
from .money import to_pesewas

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
