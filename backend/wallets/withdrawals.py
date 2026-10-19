"""Asking for money out (spec §2.2 step 5, §6, §8). `request` checks everything and holds the amount in withdrawal in
transit inside the caller's transaction (the one that also spends the step-up code); wallets.payouts then sends it and
settles it. The checks, in order: the holder is not suspended; the destination is theirs, live, past its cooling period
and still matches their verified name; the provider can pay out; the amount is above the provider's charge and within
the per-withdrawal limit; then, with the holder's balance and the in-transit account locked together in primary-key
order (posting.lock), the balance covers it (a negative vendor Available or rider balance blocks any withdrawal) and today's
withdrawals stay within the daily limit. Customers withdraw their wallet, vendors their Available, third-party riders
their balance (never the commission reserve; wallets Plan 5); a negative Available or rider balance blocks any
withdrawal."""
from django.db import IntegrityError, transaction
from django.db.models import Sum
from django.utils import timezone

from accounts.models import BusinessOwner, Customer, StaffUser
from ledger import posting, settings_store
from ledger.models import Account
from ledger.money import from_pesewas
from otp.identity import ref
from payments import providers

from . import destinations, names
from .models import PayoutDestination, Withdrawal
from .services import money


class WithdrawalError(Exception):
    def __init__(self, message, code, status_code=409, **extra):
        super().__init__(message)
        self.message, self.code, self.status_code, self.extra = message, code, status_code, extra

    def body(self):
        return {"detail": self.message, "code": self.code, **self.extra}


def hold_key(reference):
    return f"withdrawal-hold-{reference}"


def paid_key(reference):
    return f"withdrawal-paid-{reference}"


def reversed_key(reference):
    return f"withdrawal-reversed-{reference}"


# A balance below zero after a refund blocks every withdrawal until later money covers it.
NEGATIVE = {
    Account.VENDOR_AVAILABLE: "Your available balance is below zero after a refund. It recovers from your next sales.",
    Account.RIDER_BALANCE: "Your balance is below zero after a refund. It recovers from your next deliveries.",
}


def source_kind(holder):
    if isinstance(holder, Customer):
        return Account.CUSTOMER_WALLET
    if isinstance(holder, BusinessOwner):
        return Account.VENDOR_AVAILABLE
    if isinstance(holder, StaffUser):
        from delivery import employment

        if employment.wallet_rider(holder) is None:
            raise WithdrawalError(employment.WALLET_DISABLED, "wallet_disabled", 409)
        return Account.RIDER_BALANCE  # never the reserve: AshantiHub's commission, taken at the end of the day
    raise WithdrawalError("Only customers, businesses and third-party riders can withdraw.", "not_a_holder", 403)


def start_of_day(now):
    """Midnight of `now`'s day in AshantiHub's time zone (Africa/Accra): the daily limit's day."""
    return timezone.localtime(now).replace(hour=0, minute=0, second=0, microsecond=0)


def clean_request_id(raw):
    if not isinstance(raw, str) or not 8 <= len(raw.strip()) <= 64:
        raise WithdrawalError(
            "Send a request_id of 8 to 64 characters, the same on every retry, so a retry is never paid twice.",
            "invalid", 400, field="request_id",
        )
    return raw.strip()


def mine(holder):
    holder_type, holder_id = ref(holder)
    return Withdrawal.objects.filter(holder_type=holder_type, holder_id=holder_id)


def existing(holder, request_id):
    return mine(holder).filter(request_id=request_id).first()


def request(holder, *, destination_id, amount_pesewas, request_id, now=None):
    """Hold `amount_pesewas` of the holder's balance for a payout to `destination_id` and return the new PENDING
    Withdrawal. Call inside transaction.atomic(); raises WithdrawalError, writing nothing, when anything is wrong."""
    now = now or timezone.now()
    if getattr(holder, "is_suspended", False) or (isinstance(holder, StaffUser) and not holder.is_active):
        raise WithdrawalError("This account is suspended.", "suspended", 403)
    kind = source_kind(holder)
    holder_type, holder_id = ref(holder)
    if isinstance(amount_pesewas, bool) or not isinstance(amount_pesewas, int) or amount_pesewas <= 0:
        raise WithdrawalError("The amount must be more than GH₵ 0.00.", "invalid", 400, field="amount")
    destination = None
    if isinstance(destination_id, int) and not isinstance(destination_id, bool):
        destination = PayoutDestination.objects.select_for_update().filter(
            pk=destination_id, holder_type=holder_type, holder_id=holder_id, removed_at__isnull=True,
        ).first()
    if destination is None:
        raise WithdrawalError("Choose one of your payout destinations.", "unknown_destination", 404)
    if destination.usable_from > now:
        raise WithdrawalError(
            "A new payout destination can't receive money yet.", "destination_cooling", 409,
            usable_from=destination.usable_from.isoformat(),
        )
    if isinstance(holder, StaffUser) and not names.verified_names(holder):  # the Ghana Card lapsed or was withdrawn
        raise WithdrawalError(
            "Your Ghana Card must be approved, and in date, before money can be paid out to you. Ask your delivery manager.",
            "id_required", 409,
        )
    if names.matching_name(destination.account_name, holder) is None:
        raise WithdrawalError("That destination no longer matches the name we have verified for you. Add it again.", "name_mismatch", 409)
    provider = providers.get_provider()
    if not provider.payouts_available():
        raise WithdrawalError("Withdrawals aren't available yet.", "payouts_unavailable", 409)
    charge = provider.payout_charge(amount_pesewas, destination.rail)
    if isinstance(charge, bool) or not isinstance(charge, int) or charge < 0:
        raise WithdrawalError("Withdrawals aren't available yet.", "payouts_unavailable", 409)
    if amount_pesewas <= charge:
        raise WithdrawalError(f"The amount must be more than the GH₵ {from_pesewas(charge)} withdrawal charge.", "below_charge", 400)
    per_withdrawal = settings_store.current("withdrawal_per_tx_limit_pesewas", now)
    if amount_pesewas > per_withdrawal:
        raise WithdrawalError(f"One withdrawal can be at most GH₵ {from_pesewas(per_withdrawal)}.", "over_limit", 409)
    source = posting.account_for(kind, holder)
    transit = posting.account_for(Account.WITHDRAWAL_IN_TRANSIT)
    balance = posting.lock(source, transit)[source.pk].balance
    if kind in NEGATIVE and balance < 0:
        raise WithdrawalError(NEGATIVE[kind], "negative_balance", 409)
    if amount_pesewas > balance:
        raise WithdrawalError(f"You have GH₵ {from_pesewas(max(balance, 0))} to withdraw.", "insufficient_funds", 409)
    today = mine(holder).filter(status__in=Withdrawal.COUNTED, created_at__gte=start_of_day(now)).aggregate(total=Sum("amount_pesewas"))["total"] or 0
    daily = settings_store.current("withdrawal_daily_limit_pesewas", now)
    if today + amount_pesewas > daily:
        raise WithdrawalError(f"You can withdraw GH₵ {from_pesewas(max(daily - today, 0))} more today.", "daily_limit", 409)
    try:
        with transaction.atomic():
            withdrawal = Withdrawal.objects.create(
                holder_type=holder_type, holder_id=holder_id, source_kind=kind, destination=destination, request_id=request_id,
                amount_pesewas=amount_pesewas, charge_pesewas=charge, net_pesewas=amount_pesewas - charge, provider=provider.name,
            )
    except IntegrityError as exc:
        diag = getattr(exc.__cause__, "diag", None)
        if getattr(diag, "constraint_name", None) != "wallets_one_withdrawal_per_request":
            raise
        raise WithdrawalError("This withdrawal was already asked for.", "duplicate_request", 409) from None
    posting.post(
        key=hold_key(withdrawal.reference), kind="withdrawal_hold",
        lines=[posting.debit(source, amount_pesewas), posting.credit(transit, amount_pesewas)],
        reference_type="wallets.withdrawal", reference_id=withdrawal.reference, memo=f"Withdrawal {withdrawal.reference}",
    )
    from .vendor_texts import withdrawal_text

    withdrawal_text(withdrawal, "requested")  # a business is texted (never raises; none while suspended)
    return withdrawal


def cancel(holder, withdrawal_id, now=None):
    """The holder takes back a withdrawal not sent to the provider yet: the hold goes back to their balance."""
    from .payouts import close

    now = now or timezone.now()
    with transaction.atomic():
        withdrawal = mine(holder).select_for_update().filter(pk=withdrawal_id).first()
        if withdrawal is None:
            raise WithdrawalError("No such withdrawal.", "not_found", 404)
        if withdrawal.status != Withdrawal.PENDING:
            raise WithdrawalError("Only a withdrawal not sent yet can be cancelled.", "not_pending", 409)
        return close(withdrawal, Withdrawal.CANCELLED, "Cancelled by you.", now)


def event_amount(withdrawal):
    """The amount fields every withdrawal activity event carries (owner ruling: events show the amount). Never the payout
    number: the destination is not read here."""
    shown = money(withdrawal.amount_pesewas)
    return {"amount": shown, "amount_label": f"GH₵ {shown}"}


def row(withdrawal):
    """What the holder (and staff) see: amounts in GH₵, the destination masked."""
    return {
        "id": withdrawal.pk, "reference": withdrawal.reference, "amount": money(withdrawal.amount_pesewas),
        "charge": money(withdrawal.charge_pesewas), "you_receive": money(withdrawal.net_pesewas), "status": withdrawal.status,
        "status_label": withdrawal.get_status_display(), "destination": destinations.row(withdrawal.destination),
        "created_at": withdrawal.created_at, "settled_at": withdrawal.settled_at, "failure_reason": withdrawal.failure_reason,
    }
