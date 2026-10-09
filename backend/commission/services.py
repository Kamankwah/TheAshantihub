"""Commission accrual (spec S8). Accruals are created only by real events,
inside the event's own transaction (a KYC approval, a subscription payment),
idempotently (one per business and kind), and only while an approved policy is
in force — a policy approved later never backfills earlier events. Each is held
90 days, then released by a daily job; a confirmed fraud case reverses what is
not yet in a payout batch. Paying out is phase 5."""
from datetime import date
from decimal import Decimal, InvalidOperation

from django.db import IntegrityError, transaction
from django.db.models import Q
from django.utils import timezone

from activity.services import record
from fraud.models import FraudFlag

from .models import HOLD_DAYS, CommissionAccrual, CommissionPolicy

PAID_MONTHS_FOR_BONUS = 3
MAX_AMOUNT = Decimal("100000.00")
REVERSING_KINDS = frozenset({FraudFlag.DUPLICATE, FraudFlag.SIMILAR_NEARBY, FraudFlag.FAKE_BUSINESS})
REVERSAL_LABELS = {
    FraudFlag.DUPLICATE: "duplicate business",
    FraudFlag.SIMILAR_NEARBY: "similar business nearby",
    FraudFlag.FAKE_BUSINESS: "fake business",
}


class PolicyError(Exception):
    def __init__(self, message, status_code=400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def policy_in_force(kind, on=None):
    """The latest approved policy for `kind` whose effective date has come."""
    on = on or timezone.localdate()
    return CommissionPolicy.objects.filter(kind=kind, effective_from__lte=on).order_by("-effective_from", "-id").first()


def clean_proposal(kind, amount, effective_from):
    """(kind, Decimal amount, date) from raw input, or PolicyError."""
    if kind not in dict(CommissionPolicy.KIND_CHOICES):
        raise PolicyError("Pick registration or the 3-paid-months bonus.")
    try:
        value = Decimal(str(amount).strip())
    except (InvalidOperation, AttributeError):
        raise PolicyError("Enter the amount in GH₵, like 50.00.") from None
    if not value.is_finite() or value <= 0 or value > MAX_AMOUNT or value != value.quantize(Decimal("0.01")):
        raise PolicyError("The amount must be above 0, to the pesewa, and no more than GH₵ 100,000.00.")
    try:
        day = date.fromisoformat(str(effective_from))
    except ValueError:
        raise PolicyError("Use YYYY-MM-DD for the date it starts.") from None
    return kind, value, day


def _accrue(staff, owner, kind, *, source_type, source_id, now=None):
    """The one accrual for (owner, kind) at the policy in force, or None when
    there is no policy, no recipient, or one already exists. Runs inside the
    caller's transaction; records its activity event."""
    if staff is None or not staff.is_active:
        return None
    now = now or timezone.now()
    policy = policy_in_force(kind, timezone.localtime(now).date())
    if policy is None:
        return None
    try:
        with transaction.atomic():
            accrual, created = CommissionAccrual.objects.get_or_create(
                business_owner=owner, kind=kind,
                defaults={
                    "staff": staff, "amount": policy.amount, "policy": policy, "earned_at": now,
                    "hold_until": CommissionAccrual.hold_end(now), "source_type": source_type, "source_id": str(source_id),
                },
            )
    except IntegrityError:  # a concurrent event created it first
        return None
    if not created:
        return None
    record(
        staff, "commission.accrued", target=owner,
        summary=f"{accrual.get_kind_display()} commission earned, held {HOLD_DAYS} days",
        after={"kind": kind, "amount": str(accrual.amount), "hold_until": accrual.hold_until.isoformat()},
    )
    return accrual


def accrue_registration(owner, *, now=None):
    """KYC was just approved: the registering scout earns the registration commission."""
    if owner.registered_by_id is None:
        return None
    return _accrue(owner.registered_by, owner, CommissionPolicy.REGISTRATION, source_type="accounts.businessowner", source_id=owner.pk, now=now)


def paid_months(owner):
    """The months this business has paid for: cycle_months summed over its
    successful subscription payments. A trial is not a payment."""
    from payments.models import CheckoutSession

    total = 0
    sessions = CheckoutSession.objects.filter(
        business_owner=owner, kind=CheckoutSession.SUBSCRIPTION, status=CheckoutSession.SUCCESS,
    ).values_list("metadata", flat=True)
    for meta in sessions:
        try:
            total += max(0, int((meta or {}).get("cycle_months") or 0))
        except (TypeError, ValueError):
            continue
    return total


def paid_months_by_owner(owner_ids):
    from payments.models import CheckoutSession

    totals = {pk: 0 for pk in owner_ids}
    rows = CheckoutSession.objects.filter(
        business_owner_id__in=owner_ids, kind=CheckoutSession.SUBSCRIPTION, status=CheckoutSession.SUCCESS,
    ).values_list("business_owner_id", "metadata")
    for pk, meta in rows:
        try:
            totals[pk] += max(0, int((meta or {}).get("cycle_months") or 0))
        except (TypeError, ValueError):
            continue
    return totals


def accrue_bonus(owner, session=None, *, now=None):
    """A subscription payment just landed: once the business has paid for 3
    months in total, whoever is its account manager now earns the bonus."""
    if paid_months(owner) < PAID_MONTHS_FOR_BONUS:
        return None
    return _accrue(
        owner.account_manager, owner, CommissionPolicy.BONUS,
        source_type="payments.checkoutsession", source_id=getattr(session, "pk", ""), now=now,
    )


def release_holds(now=None):
    """Daily job: on-hold lines whose 90 days have passed become payable."""
    now = now or timezone.now()
    with transaction.atomic():
        released = CommissionAccrual.objects.filter(status=CommissionAccrual.ON_HOLD, hold_until__lte=now).update(status=CommissionAccrual.PAYABLE)
        if released:
            record(None, "commission.released", summary=f"{released} commission line(s) released after the hold", after={"count": released})
    return released


def reverse_for_flag(flag, staff):
    """fraud.services.ON_CONFIRMED hook: a confirmed duplicate, similar or fake
    case reverses that business's lines that have not been paid out. Lines in
    a payout batch or paid are left (phase 5 nets a clawback)."""
    if flag.kind not in REVERSING_KINDS or flag.business_owner_id is None:
        return 0
    lines = list(CommissionAccrual.objects.select_for_update().filter(
        business_owner_id=flag.business_owner_id, status__in=[CommissionAccrual.ON_HOLD, CommissionAccrual.PAYABLE],
    ))
    if not lines:
        return 0
    now = timezone.now()
    for line in lines:
        line.status = CommissionAccrual.REVERSED
        line.reversed_reason = flag.kind
        line.reversed_at = now
        line.save(update_fields=["status", "reversed_reason", "reversed_at"])
    record(
        staff, "commission.reversed", target_type="accounts.businessowner", target_id=flag.business_owner_id,
        target_label=str(flag.business_owner),
        summary=f"{len(lines)} commission line(s) reversed: {REVERSAL_LABELS[flag.kind]}",
        after={"fraud_flag_id": flag.pk, "reason": flag.kind, "lines": [line.pk for line in lines]},
    )
    return len(lines)
