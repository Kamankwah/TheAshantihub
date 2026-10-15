"""The only door through which a ledger balance changes. `post` writes one balanced journal
atomically, idempotently on its key, locking the accounts it touches in primary-key order so
concurrent postings serialise instead of deadlocking."""
from dataclasses import dataclass

from django.db import transaction

from .models import Account, Journal, JournalLine


class PostingError(Exception):
    pass


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


def post(*, key, kind, lines, reference_type="", reference_id="", memo=""):
    lines = list(lines)
    _validate(key, kind, lines)
    with transaction.atomic():
        ids = sorted({line.account.pk for line in lines})
        locked = {a.pk: a for a in Account.objects.select_for_update().filter(pk__in=ids).order_by("pk")}
        existing = Journal.objects.filter(key=key).first()
        if existing is not None:
            return existing
        journal = Journal.objects.create(key=key, kind=kind, reference_type=reference_type, reference_id=str(reference_id), memo=memo[:300])
        for line in lines:
            JournalLine.objects.create(journal=journal, account_id=line.account.pk, side=line.side, amount=line.amount)
            delta = line.amount if line.side == JournalLine.CREDIT else -line.amount
            locked[line.account.pk].net_credit += delta
        for account in locked.values():
            if account.balance < 0 and account.kind not in Account.MAY_GO_NEGATIVE:
                raise PostingError(f"{account} would go below zero")
            account.save(update_fields=["net_credit"])
        return journal
