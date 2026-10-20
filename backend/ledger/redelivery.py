"""A re-delivery fee in the ledger (Plan 7F-E Task 7, owner Rulings R4/R5; the rules are in delivery.redelivery).

The customer pays the fee before the second trip is assigned. It is held in the order's Re-delivery payable (one account
per order, owner orders.order) and leaves it exactly once, in pesewas, by one of:

    redelivery-pay-<id>     Dr provider clearing (mobile money, net of the processing charge) or customer wallet
                            Cr Re-delivery payable                       the fee
    redelivery-settle-<id>  Dr Re-delivery payable / Cr platform delivery income   the second trip's rider collected the
                            goods (completed, failed after the pickup, or a whole refund after that pickup). The second
                            rider is AshantiHub's own (no wallet): what is owed to them is recorded on the Redelivery row
                            and paid outside the app, as an in-house rider's delivery fee is.
    redelivery-refund-<id>  Dr Re-delivery payable / Cr customer wallet  cancelled after payment, or a whole refund of the
                            order before the second rider collected anything.

A payment that arrives for a request that is no longer waiting for one (a second mobile-money payment, or one confirmed
after the request was cancelled) is credited to the customer's wallet instead: redelivery-stray-<session reference>,
Dr provider clearing / Cr customer wallet, so no one is charged for nothing.

The fee is not part of Order.total_amount, so the order's own refund figures (ledger.refunds.left, Ruling R1) never see
it. Every posting locks its accounts in one sorted pass (posting.post); a caller that posts more than one journal in a
transaction takes them up front with `accounts(...)`."""
from . import posting
from .models import Account
from .money import to_pesewas


class RedeliveryPostingError(posting.PostingError):
    pass


def pay_key(redelivery):
    return f"redelivery-pay-{redelivery.pk}"


def settle_key(redelivery):
    return f"redelivery-settle-{redelivery.pk}"


def refund_key(redelivery):
    return f"redelivery-refund-{redelivery.pk}"


def stray_key(session):
    return f"redelivery-stray-{session.reference}"


def payable(order):
    return posting.account_for(Account.REDELIVERY_PAYABLE, order)


def _source(session):
    from payments.models import CheckoutSession

    if session.provider == CheckoutSession.WALLET:
        return posting.account_for(Account.CUSTOMER_WALLET, session.customer)
    return posting.account_for(Account.PROVIDER_CLEARING)


def net_paid(session):
    """What the provider passed on for this session: the amount less the processing charge it kept (pesewas)."""
    return to_pesewas(session.amount) - to_pesewas(session.processing_fee)


def record_payment(redelivery, session):
    """The payment journal. Fails closed (RedeliveryPostingError, rolling the payment back) unless the session paid
    exactly the fee copied onto the request; a wallet too low raises posting.InsufficientFunds."""
    fee = redelivery.fee_pesewas
    if session.customer_id is None or session.customer_id != redelivery.order.customer_id:
        raise RedeliveryPostingError(f"Re-delivery {redelivery.pk}: session {session.reference} is not the order's customer's")
    if net_paid(session) != fee or fee <= 0:
        raise RedeliveryPostingError(f"Re-delivery {redelivery.pk}: session {session.reference} did not pay the fee")
    return posting.post(
        key=pay_key(redelivery), kind="redelivery_payment",
        lines=[posting.debit(_source(session), fee), posting.credit(payable(redelivery.order), fee)],
        reference_type="delivery.redelivery", reference_id=str(redelivery.pk),
        memo=f"Re-delivery fee for order #{redelivery.order_id} (attempt {redelivery.attempt})",
    )


def record_stray(session):
    """A paid session whose request no longer waits for payment: credit what the provider passed on to the wallet."""
    amount = net_paid(session)
    if amount <= 0:
        return None
    return posting.post(
        key=stray_key(session), kind="redelivery_payment_returned",
        lines=[
            posting.debit(posting.account_for(Account.PROVIDER_CLEARING), amount),
            posting.credit(posting.account_for(Account.CUSTOMER_WALLET, session.customer), amount),
        ],
        reference_type="payments.checkoutsession", reference_id=session.reference,
        memo="Re-delivery payment received after the request closed, credited to the wallet",
    )


def accounts(redelivery, action):
    """The accounts `settle` ("settle") or `refund` ("refund") posts to, for a caller's up-front lock."""
    if action == "settle":
        return payable(redelivery.order), posting.account_for(Account.PLATFORM_DELIVERY_INCOME)
    if action == "refund":
        return payable(redelivery.order), posting.account_for(Account.CUSTOMER_WALLET, redelivery.order.customer)
    return ()


def settle(redelivery):
    """The fee is earned by the second trip: Dr Re-delivery payable / Cr platform delivery income. Idempotent on its key."""
    if not redelivery.fee_pesewas or redelivery.pay_journal_id is None:
        return None
    return posting.post(
        key=settle_key(redelivery), kind="redelivery_settle",
        lines=[
            posting.debit(payable(redelivery.order), redelivery.fee_pesewas),
            posting.credit(posting.account_for(Account.PLATFORM_DELIVERY_INCOME), redelivery.fee_pesewas),
        ],
        reference_type="delivery.redelivery", reference_id=str(redelivery.pk),
        memo=f"Re-delivery of order #{redelivery.order_id} done (attempt {redelivery.attempt})",
    )


def refund(redelivery):
    """The fee goes back to the customer's wallet: Dr Re-delivery payable / Cr customer wallet. Idempotent on its key."""
    if not redelivery.fee_pesewas or redelivery.pay_journal_id is None:
        return None
    return posting.post(
        key=refund_key(redelivery), kind="redelivery_refund",
        lines=[
            posting.debit(payable(redelivery.order), redelivery.fee_pesewas),
            posting.credit(posting.account_for(Account.CUSTOMER_WALLET, redelivery.order.customer), redelivery.fee_pesewas),
        ],
        reference_type="delivery.redelivery", reference_id=str(redelivery.pk),
        memo=f"Re-delivery fee for order #{redelivery.order_id} returned (attempt {redelivery.attempt})",
    )
