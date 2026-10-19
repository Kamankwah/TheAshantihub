"""Customer wallets and vendor balances as their holders see them (spec §5, §6), over the ledger. Money is integer
pesewas inside and GH₵ strings at the API edge. Reading a balance never opens an account; only a posting does."""
from datetime import timedelta

from django.utils import timezone

from accounts.models import BusinessOwner, Customer
from ledger import posting, settings_store
from ledger.models import Account, JournalLine
from ledger.money import from_pesewas, to_pesewas

# What each journal kind is called on a holder's statement.
LABELS = {
    "order_payment": "Order payment",
    "order_release": "Released to you",
    "order_refund": "Refund",
    "order_waiver_charge": "Free-delivery promo",
    "order_waiver_return": "Free-delivery promo returned",
    "booking_payment": "Booking payment",
    "booking_release": "Released to you",
    "booking_refund": "Refund",
    "wallet_top_up": "Top-up",
    "withdrawal_hold": "Withdrawal",
    "withdrawal_reversed": "Withdrawal returned",
}
ACCOUNT_NAMES = {Account.CUSTOMER_WALLET: "wallet", Account.VENDOR_PENDING: "pending", Account.VENDOR_AVAILABLE: "available"}


def money(pesewas):
    """"12.50" for 1250 pesewas."""
    return str(from_pesewas(pesewas))


def topup_key(reference):
    return f"wallet-topup-{reference}"


def record_top_up(session):
    """Credit a paid top-up session to the customer's wallet: Dr provider clearing, Cr customer wallet, by the amount
    asked for (`metadata["credit_pesewas"]`; the processing charge the provider kept is not in it). Idempotent on the
    session's reference. Posted whatever LEDGER_ENABLED says now: a top-up session exists only if the ledger was on when
    it was created, and a customer who paid must be credited."""
    credit = session.metadata.get("credit_pesewas")
    if isinstance(credit, bool) or not isinstance(credit, int) or credit <= 0 or session.customer_id is None:
        raise posting.PostingError(f"Top-up {session.reference} carries no amount to credit")
    # Fail closed: the credit must be exactly what the customer paid less the provider's processing charge.
    if credit != to_pesewas(session.amount) - to_pesewas(session.processing_fee):
        raise posting.PostingError(f"Top-up {session.reference} credit does not match what was paid")
    return posting.post(
        key=topup_key(session.reference), kind="wallet_top_up",
        lines=[
            posting.debit(posting.account_for(Account.PROVIDER_CLEARING), credit),
            posting.credit(posting.account_for(Account.CUSTOMER_WALLET, session.customer), credit),
        ],
        reference_type="payments.checkoutsession", reference_id=session.reference, memo=f"Wallet top-up {session.reference}",
    )


def account_kinds(holder):
    if isinstance(holder, Customer):
        return (Account.CUSTOMER_WALLET,)
    if isinstance(holder, BusinessOwner):
        return (Account.VENDOR_PENDING, Account.VENDOR_AVAILABLE)
    raise TypeError(f"{type(holder).__name__} holds no wallet")


def held_topups(holder, now=None):
    """(held pesewas, free_at) for a customer: the top-ups credited less than `wallet_topup_hold_minutes` ago cannot be
    withdrawn yet, and `free_at` is when the last of them is free (None when nothing is held). A top-up is free at exactly
    credited_at + hold. Only `wallet_top_up` journals are held: sale proceeds and other credits never are."""
    if not isinstance(holder, Customer):
        return 0, None
    now = now or timezone.now()
    hold = timedelta(minutes=settings_store.current("wallet_topup_hold_minutes", now))
    lines = JournalLine.objects.filter(
        journal__kind="wallet_top_up", side=JournalLine.CREDIT, journal__created_at__gt=now - hold,
        account__kind=Account.CUSTOMER_WALLET, account__owner_type=holder._meta.label_lower, account__owner_id=str(holder.pk),
    ).select_related("journal")
    held, free_at = 0, None
    for line in lines:
        held += line.amount
        at = line.journal.created_at + hold
        free_at = at if free_at is None or at > free_at else free_at
    return held, free_at


def summary(holder):
    """A customer's wallet balance, or a vendor's Pending and Available (Available may be negative after a late refund)."""
    if isinstance(holder, Customer):
        held, free_at = held_topups(holder)
        return {
            "kind": "customer", "balance": money(posting.balance_of(Account.CUSTOMER_WALLET, holder)),
            "held_topup_pesewas": held, "topup_free_at": free_at.isoformat() if free_at else None,
        }
    return {
        "kind": "vendor",
        "pending": money(posting.balance_of(Account.VENDOR_PENDING, holder)),
        "available": money(posting.balance_of(Account.VENDOR_AVAILABLE, holder)),
    }


def statement_lines(holder):
    """Every journal line on the holder's own accounts, newest first."""
    return (
        JournalLine.objects.filter(
            account__kind__in=account_kinds(holder), account__owner_type=holder._meta.label_lower, account__owner_id=str(holder.pk),
        )
        .select_related("journal", "account").order_by("-journal__created_at", "-id")
    )


def line_row(line):
    journal = line.journal
    is_order = journal.reference_type == "orders.order" and journal.reference_id.isdigit()
    is_booking = journal.reference_type == "ledger.bookingsale" and journal.reference_id.isdigit()
    return {
        "id": line.pk, "at": journal.created_at, "account": ACCOUNT_NAMES[line.account.kind], "kind": journal.kind,
        "label": LABELS.get(journal.kind, "Other"),
        # Every holder account grows with credits, so a credit is money in.
        "direction": "in" if line.side == JournalLine.CREDIT else "out",
        "amount": money(line.amount), "order": int(journal.reference_id) if is_order else None,
        "booking_sale": int(journal.reference_id) if is_booking else None,
        "reference": "" if (is_order or is_booking) else journal.reference_id,
    }
