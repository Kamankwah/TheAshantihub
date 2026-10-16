"""Paying for a service request, a stay or event tickets (ledger Plan 1b) the way order checkout pays
(orders.views.OrderCheckoutView). While the ledger is on, a mobile-money payment carries the provider's collection
charge on top ("payment processing", spec §1 row 14) and the session is marked metadata["ledger"], so the nightly
reconciliation expects its journal (wallets plan 3b). Tickets for an event no business organises stay outside the
ledger (`in_ledger=False`): no charge, no mark. With the ledger off this is exactly process_payment."""
from decimal import Decimal

from rest_framework.response import Response

from ledger import escrow
from ledger.models import Account
from ledger.money import from_pesewas, to_pesewas

from .providers import get_provider
from .services import process_payment

MOMO, WALLET = "momo", "wallet"
WALLET_OFF = "Paying from your AshantiHub wallet isn't switched on yet."
WALLET_TOO_LOW = "Your AshantiHub wallet doesn't hold enough for this."


class Refused(Exception):
    """A payment_method the request cannot use: `body` and `status_code` are the answer to give."""

    def __init__(self, body, status_code):
        super().__init__(body)
        self.body, self.status_code = body, status_code


def method_from(data):
    """`momo` (the default) or `wallet` from the request body. Raises Refused for anything else, and for the wallet while
    the ledger is off (only the ledger can debit it)."""
    method = (data.get("payment_method") if hasattr(data, "get") else None) or MOMO
    if method not in (MOMO, WALLET):
        raise Refused({"payment_method": "Pay by mobile money or from your AshantiHub wallet."}, 400)
    if method == WALLET and not escrow.enabled():
        raise Refused({"detail": WALLET_OFF, "code": "ledger_off"}, 409)
    return method


def too_low(exc):
    """The answer to posting.InsufficientFunds from a wallet payment (the caller's transaction has rolled back). Any other
    account going short is a bug and is raised again."""
    if exc.account.kind != Account.CUSTOMER_WALLET:
        raise exc
    return Response({"detail": WALLET_TOO_LOW, "code": "insufficient_funds"}, status=409)


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
