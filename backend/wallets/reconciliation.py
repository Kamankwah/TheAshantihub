"""The nightly reconciliation (spec §2: "A nightly reconciliation compares the ledger to the provider statement and
flags differences"). Read-only: it never posts or corrects anything. For a day it checks, by provider reference:

* every collection or payout on the provider's statement has its journal, for the same amount (missing_in_ledger,
  amount_differs), skipping what the ledger was never asked to record: payments made while it was off (no
  metadata["ledger"]), kinds it does not record (subscriptions, event listing fees...) and GH₵ 0.00 payments;
* every journal of the day that moved provider clearing names a movement the provider confirms, on any day
  (missing_on_statement; so a payment confirmed a second before midnight is not a false alarm);

and, as it runs, that withdrawal in transit equals the open withdrawals (in_transit_differs; this needs no provider, so
it runs even without a statement) and that the provider's unconfirmed payouts equal ours (pending_differs). Every
provider call (statement, find, pending payouts) runs outside any transaction: for a real provider each is a network
call, and the in-transit lock must never be held across one. The totals cover the movements compared, so a matched day
shows equal totals. A difference opens one fraud case per day and tells wallets.view holders once. A provider that
cannot give a statement (Hubtel until Plan 7) is recorded as unavailable, or mismatched when in transit differs."""
import logging

from django.db import transaction
from django.db.models import Sum
from django.utils import timezone

from fraud import services as fraud
from fraud.models import FraudFlag
from ledger import escrow, posting, sales
from ledger.models import Account, JournalLine
from notifications.services import notify_staff_role
from payments import providers
from orders.models import Order
from payments.models import CheckoutSession

from .models import ReconciliationRun, Withdrawal
from .services import topup_key
from .withdrawals import paid_key

logger = logging.getLogger(__name__)
# Services, stays and ticket purchases are recorded since ledger Plan 1b (booking-pay-<reference>).
BOOKING_KINDS = (CheckoutSession.SERVICE_REQUEST, CheckoutSession.BOOKING, CheckoutSession.TICKET_PURCHASE)
LEDGER_KINDS = (CheckoutSession.ORDER_CHECKOUT, CheckoutSession.WALLET_TOPUP, *BOOKING_KINDS)


def _difference(reference, kind, problem, ledger, statement):
    return {"reference": reference, "kind": kind, "problem": problem, "ledger": ledger, "statement": statement}


def expected_key(line):
    """(journal key, problem): the journal a statement line should have; (None, None) when the ledger was never asked to
    record it; (None, "unknown_reference") for a collection that matches none of our checkout sessions."""
    if line.kind == providers.PAYOUT:
        return paid_key(line.reference), None
    session = CheckoutSession.objects.filter(reference=line.reference).first()
    if session is None:
        return None, "unknown_reference"
    if session.kind not in LEDGER_KINDS or not session.metadata.get("ledger") or line.amount_pesewas <= 0:
        return None, None
    if session.provider == CheckoutSession.WALLET:      # paid from the wallet: the provider moved no money
        return None, None
    if session.kind == CheckoutSession.WALLET_TOPUP:
        return topup_key(session.reference), None
    if session.kind in BOOKING_KINDS:
        return sales.pay_key(session), None
    return escrow.pay_key(Order(pk=session.metadata.get("order_id"))), None


def provider_reference(journal):
    """The provider reference a journal that moved provider clearing stands for, or None."""
    if journal.key.startswith(("wallet-topup-", "withdrawal-paid-")):
        return journal.reference_id
    if journal.key.startswith("booking-pay-"):
        return journal.key[len("booking-pay-"):]
    if journal.key.startswith("order-pay-") and journal.reference_id.isdigit():
        session = CheckoutSession.objects.filter(
            kind=CheckoutSession.ORDER_CHECKOUT, metadata__order_id=int(journal.reference_id), status=CheckoutSession.SUCCESS,
        ).first()
        return session.reference if session is not None else None
    return None


def clearing_amount(key, side):
    line = JournalLine.objects.filter(journal__key=key, account__kind=Account.PROVIDER_CLEARING, side=side).first()
    return line.amount if line is not None else None


def _in_transit():
    """(withdrawal in transit, the open withdrawals' total), counted together under the in-transit lock so no hold or
    settlement moves in between. Asks no provider. Never creates the account: a missing one is a balance of 0."""
    with transaction.atomic(durable=True):
        transit = Account.objects.filter(kind=Account.WITHDRAWAL_IN_TRANSIT, owner_type="", owner_id="").first()
        in_transit = posting.lock(transit)[transit.pk].balance if transit is not None else 0
        open_total = Withdrawal.objects.filter(status__in=Withdrawal.OPEN).aggregate(total=Sum("amount_pesewas"))["total"] or 0
    return in_transit, open_total


def _ours_sent(provider):
    return Withdrawal.objects.filter(status=Withdrawal.PROCESSING, provider=provider.name).aggregate(total=Sum("amount_pesewas"))["total"] or 0


def _call(unavailable, name, fn):
    """Run one provider call (outside any transaction). (True, result), or (False, None) with `name` noted as unavailable:
    NotConnected is the provider saying it cannot; anything else is logged by exception type only (a provider's own
    words may hold an account number) and treated the same, so one bad call never loses the run."""
    try:
        return True, fn()
    except providers.NotConnected:
        pass
    except Exception as exc:  # noqa: BLE001 - a provider failing must not stop the run being recorded
        logger.warning("Reconciliation: provider %s failed (%s)", name, type(exc).__name__)
    unavailable.append(name)
    return False, None


def reconcile(day, now=None):
    now = now or timezone.now()
    provider = providers.get_provider()
    differences, unavailable = [], []
    in_transit, open_total = _in_transit()
    if in_transit != open_total:
        differences.append(_difference("withdrawal_in_transit", providers.PAYOUT, "in_transit_differs", in_transit, open_total))
    got, lines = _call(unavailable, "statement", lambda: provider.statement(day))
    if not got:
        # No statement to compare (Hubtel until Plan 7, or the provider failed); the in-transit check needs none.
        status = ReconciliationRun.MISMATCHED if differences else ReconciliationRun.UNAVAILABLE
        return _record(day, provider, status, differences, now, in_transit=in_transit, unavailable=unavailable)

    seen = set()
    statement_in = statement_out = ledger_in = ledger_out = 0
    for line in lines:
        key, problem = expected_key(line)
        if problem is not None:
            statement_in += line.amount_pesewas
            differences.append(_difference(line.reference, line.kind, problem, None, line.amount_pesewas))
            continue
        if key is None:
            continue
        if key in seen:
            differences.append(_difference(line.reference, line.kind, "duplicate_on_statement", None, line.amount_pesewas))
            continue
        seen.add(key)
        side = JournalLine.DEBIT if line.kind == providers.COLLECTION else JournalLine.CREDIT
        booked = clearing_amount(key, side)
        if line.kind == providers.COLLECTION:
            statement_in += line.amount_pesewas
            ledger_in += booked or 0
        else:
            statement_out += line.amount_pesewas
            ledger_out += booked or 0
        if booked is None:
            differences.append(_difference(line.reference, line.kind, "missing_in_ledger", None, line.amount_pesewas))
        elif booked != line.amount_pesewas:
            differences.append(_difference(line.reference, line.kind, "amount_differs", booked, line.amount_pesewas))

    start, end = providers.day_bounds(day)
    entries = JournalLine.objects.filter(
        account__kind=Account.PROVIDER_CLEARING, journal__created_at__gte=start, journal__created_at__lt=end,
    ).select_related("journal").order_by("id")
    find_works = True
    for entry in entries:
        if entry.journal.key in seen:
            continue                                   # compared above, against this day's statement
        reference = provider_reference(entry.journal)
        if reference is not None and find_works:
            found, line = _call(unavailable, "find", lambda: provider.find(reference))
            if not found:
                find_works = False                     # asked once; the rest of this check is skipped
            elif line is not None:
                continue                               # the provider confirms it on another day's statement
        if not find_works:
            continue
        kind = providers.COLLECTION if entry.side == JournalLine.DEBIT else providers.PAYOUT
        if entry.side == JournalLine.DEBIT:
            ledger_in += entry.amount
        else:
            ledger_out += entry.amount
        differences.append(_difference(reference or entry.journal.key, kind, "missing_on_statement", entry.amount, None))

    # The provider is asked outside any transaction; ours is counted right after, and both once more if they differ,
    # so a payout confirmed in between is not a false alarm.
    pending_gap = None                                 # (ours, theirs) from the last attempt that got an answer
    for _attempt in range(2):
        got, theirs_sent = _call(unavailable, "pending_payouts", provider.pending_payouts)
        if not got:
            break                                      # a failing retry keeps what the first attempt found
        ours_sent = _ours_sent(provider)
        pending_gap = None if theirs_sent == ours_sent else (ours_sent, theirs_sent)
        if pending_gap is None:
            break
    if pending_gap is not None:
        differences.append(_difference("pending_payouts", providers.PAYOUT, "pending_differs", *pending_gap))

    if differences:
        status = ReconciliationRun.MISMATCHED
    elif unavailable:
        status = ReconciliationRun.UNAVAILABLE         # a skipped check never makes a green row
    else:
        status = ReconciliationRun.MATCHED
    return _record(day, provider, status, differences, now, in_transit=in_transit, unavailable=unavailable,
                   totals=(ledger_in, statement_in, ledger_out, statement_out))


def _record(day, provider, status, differences, now, *, in_transit, unavailable=(), totals=(0, 0, 0, 0)):
    """Write the day's run (a re-run replaces it) and, when there is a difference, raise its case."""
    ledger_in, statement_in, ledger_out, statement_out = totals
    defaults = {
        "provider": provider.name, "status": status, "differences": differences, "ran_at": now,
        "ledger_in_pesewas": ledger_in, "statement_in_pesewas": statement_in, "ledger_out_pesewas": ledger_out,
        "statement_out_pesewas": statement_out, "in_transit_pesewas": in_transit, "unavailable": list(unavailable),
    }
    if not differences:
        defaults["flag"] = None  # a re-run that now matches drops the link; the case itself stays open for staff
    run, _ = ReconciliationRun.objects.update_or_create(day=day, defaults=defaults)
    if differences:
        _raise(run, provider, differences)
    return run


def _raise(run, provider, differences):
    """One fraud case per day (dedupe key) and one notice to wallets.view holders, however often the day is re-run.
    References only: no account number ever reaches a case or a notice."""
    flag = fraud.raise_flag(
        FraudFlag.OTHER, title=f"Money reconciliation for {run.day:%d %b %Y} does not match",
        detail=(f"{len(differences)} difference(s) found reconciling the ledger ({provider.name}). "
                "Nothing was corrected; see Wallets, Reconciliation."),
        evidence=[f"{d['problem']}: {d['reference']}" for d in differences[:20]],
        dedupe_key=f"reconciliation-{run.day.isoformat()}",
    )
    if run.flag_id != flag.pk:
        run.flag = flag
        run.save(update_fields=["flag"])
        notify_staff_role(
            "wallets.view", "reconciliation_mismatch",
            f"Reconciliation for {run.day:%d %b %Y} found {len(differences)} difference(s)",
            body="Nothing was corrected. Open Wallets, Reconciliation.", link="wallets-reconciliation", icon="🧮",
        )
