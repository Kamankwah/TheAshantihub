"""Paying for a service request, a stay or event tickets (ledger Plan 1b) the way order checkout pays
(orders.views.OrderCheckoutView). While the ledger is on, a mobile-money payment carries the provider's collection
charge on top ("payment processing", spec §1 row 14) and the session is marked metadata["ledger"], so the nightly
reconciliation expects its journal (wallets plan 3b). Tickets for an event no business organises stay outside the
ledger (`in_ledger=False`): no charge, no mark. With the ledger off this is exactly process_payment."""
from decimal import Decimal

from ledger import escrow
from ledger.money import from_pesewas, to_pesewas

from .providers import get_provider
from .services import process_payment

MOMO, WALLET = "momo", "wallet"


def _recorded(in_ledger):
    return in_ledger and escrow.enabled()


def pay(*, kind, amount, purpose, customer, metadata, method=MOMO, in_ledger=True):
    """process_payment for a booking, with the charge and the mark above. Returns (result, processing): the GH₵
    processing charge added on top (Decimal 0.00 when none). Call it inside the caller's transaction.atomic(), so a
    payment the ledger refuses leaves nothing behind."""
    processing = Decimal("0.00")
    if _recorded(in_ledger):
        if method == MOMO:
            processing = from_pesewas(get_provider().collection_charge(to_pesewas(amount)))
        metadata = {**metadata, "ledger": True}
    result = process_payment(
        kind=kind, amount=amount + processing, processing_fee=processing, purpose=purpose, customer=customer,
        metadata=metadata, wallet=method == WALLET,
    )
    return result, processing


def with_terms(body, processing, *, method=MOMO, in_ledger=True):
    """A paid booking's answer plus how it was paid, while the ledger records it (checkout's payment_method and
    payment_processing). Unchanged otherwise."""
    if not _recorded(in_ledger):
        return body
    return {**body, "payment_method": method, "payment_processing": str(processing)}


def redirect_body(result, processing, *, in_ledger=True):
    """The answer that sends the customer to the provider's checkout (Hubtel), with the charge while the ledger is on."""
    body = {"mode": "redirect", "checkout_url": result["checkout_url"], "reference": result["reference"]}
    if _recorded(in_ledger):
        body["payment_processing"] = str(processing)
    return body
