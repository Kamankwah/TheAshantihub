"""The only door through which a ledger balance changes. `post` writes one balanced journal
atomically, idempotently on its key, locking the accounts it touches in primary-key order so
concurrent postings serialise instead of deadlocking. A caller that must read a balance before it
posts (a withdrawal's limits, a payment's fee cap) takes the same locks first with `lock`; every
money path takes them in one sorted pass, after the order row and its fee snapshots."""
from dataclasses import dataclass

from django.db import transaction

from .models import Account, Journal, JournalLine


class PostingError(Exception):
    pass


class InsufficientFunds(PostingError):
    """A balance that may not go below zero would have. `account` names it (a wallet, a pending balance...); it is the
    locked copy carrying the would-be balance, not the committed one (nothing was written)."""

    def __init__(self, account):
        super().__init__(f"{account} would go below zero")
        self.account = account


@dataclass(frozen=True)
class Line:
    account: Account
    side: str
    amount: int


def debit(account, amount):
    return Line(account, JournalLine.DEBIT, amount)


def credit(account, amount):
    return Line(account, JournalLine.CREDIT, amount)


def account_for(kind, owner=None):
    """The account of `kind` held by `owner` (any model instance), created on first use."""
    owner_type, owner_id = ("", "") if owner is None else (owner._meta.label_lower, str(owner.pk))
    account, _ = Account.objects.get_or_create(kind=kind, owner_type=owner_type, owner_id=owner_id)
    return account


def balance_of(kind, owner=None):
    """`owner`'s balance on its `kind` account, 0 when that account was never opened. Never creates one. An unlocked
    read, for display only: a decision on a balance uses `lock(...)[pk].balance` inside the transaction."""
    owner_type, owner_id = ("", "") if owner is None else (owner._meta.label_lower, str(owner.pk))
    account = Account.objects.filter(kind=kind, owner_type=owner_type, owner_id=owner_id).first()
    return account.balance if account is not None else 0


def lock(*accounts):
    """Lock these accounts in primary-key order (the order every posting takes them) and return them fresh from the
    database: {pk: Account}. Call inside transaction.atomic(); None entries are skipped."""
    ids = sorted({account.pk for account in accounts if account is not None})
    return {account.pk: account for account in Account.objects.select_for_update().filter(pk__in=ids).order_by("pk")}


def _validate(key, kind, lines):
    if not key or not kind:
        raise PostingError("A posting needs a key and a kind")
    if len(lines) < 2:
        raise PostingError("A posting needs at least two lines")
    for line in lines:
        if line.side not in (JournalLine.DEBIT, JournalLine.CREDIT):
            raise PostingError(f"Unknown side {line.side!r}")
        if isinstance(line.amount, bool) or not isinstance(line.amount, int) or line.amount <= 0:
            raise PostingError(f"Amounts are positive whole pesewas, got {line.amount!r}")
    debits = sum(line.amount for line in lines if line.side == JournalLine.DEBIT)
    credits = sum(line.amount for line in lines if line.side == JournalLine.CREDIT)
    if debits != credits:
        raise PostingError(f"Unbalanced posting: debits {debits} != credits {credits}")


def post(*, key, kind, lines, reference_type="", reference_id="", memo="", allow_negative=()):
    """Write one balanced journal, or return the journal already posted under `key`. Raises InsufficientFunds (and
    writes nothing) when an account that may not go below zero would. `allow_negative` names account kinds this one
    posting may drive below zero: a payout the provider has already confirmed is a fact to record, whatever the
    provider-clearing balance says (Plan 3b)."""
    if isinstance(allow_negative, str):
        raise TypeError("allow_negative is a collection of account kinds, not a string")
    allow_negative = frozenset(allow_negative)
    lines = list(lines)
    _validate(key, kind, lines)
    with transaction.atomic():
        locked = lock(*(line.account for line in lines))
        existing = Journal.objects.filter(key=key).first()
        if existing is not None:
            return existing
        journal = Journal.objects.create(key=key, kind=kind, reference_type=reference_type, reference_id=str(reference_id), memo=memo[:300])
        before = {pk: account.balance for pk, account in locked.items()}
        for line in lines:
            JournalLine.objects.create(journal=journal, account_id=line.account.pk, side=line.side, amount=line.amount)
            delta = line.amount if line.side == JournalLine.CREDIT else -line.amount
            locked[line.account.pk].net_credit += delta
        for account in locked.values():
            lowered_below_zero = account.balance < 0 and account.balance < before[account.pk]
            if lowered_below_zero and account.kind not in Account.MAY_GO_NEGATIVE and account.kind not in allow_negative:
                raise InsufficientFunds(account)
            account.save(update_fields=["net_credit"])
        from wallets import vendor_texts

        vendor_texts.after_posting(locked.values(), before)  # a business whose Available just fell below zero or low is texted; never raises
        return journal
