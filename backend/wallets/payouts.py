"""Sending a held withdrawal to the provider and settling it (spec §2.2 step 5, §2.3).

A withdrawal is claimed (PENDING → PROCESSING under its row lock) before the provider is asked, so it is sent once even
when the request and the poll race. Before sending, a held one is re-checked (holder suspended or gone, destination
removed, still inside its cooling period, name or KYC no longer matching) and returned instead if any fails. No provider
call runs inside a transaction (claim is durable and raises RuntimeError when nested). A provider that raises
NotConnected sent nothing, so the hold goes back at once; any other failure leaves the outcome unknown and the
withdrawal PROCESSING. `apply_result` is the one way a withdrawal ends,
whoever reports it - the provider's answer, the 5-minute poll, a payout webhook (Plan 7), staff asking the provider -
and `close` the one way its money goes back (a failure, the holder's cancel, staff failing a stuck one). Both lock the
row first; the journal keys are per reference, so a report applied twice posts once. A final status never changes: a
"paid" report on a withdrawal already failed or cancelled is never posted (its money went back), a "failed" report on
one already paid changes nothing, and a report on one never sent is not applied; each opens a fraud case, but only
when such a report reaches `apply_result`. Nothing asks the provider again after staff fail a stuck withdrawal by hand
(staff may do so only when the provider did not say it is still processing), so a late "paid" is caught only by a
payout webhook or the next night's reconciliation, once Plan 7 builds them. A paid report whose amount (as the
provider states it) differs from what was sent, a failed report carrying a non-zero amount (money may have left), or a
paid report that names none from a provider other than the simulated one, is not applied and opens a
`withdrawal-amount-<ref>` case (a failed report carrying 0 or none is honest: nothing reached the destination); while that case is open
neither `apply_result` nor `close` ends the withdrawal, and the poll never asks about one that ever had such a case:
staff resolve it. The provider's own message is never stored or shown, and nothing here logs an account number."""
import logging
from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from accounts.models import BusinessOwner, Customer
from fraud import services as fraud
from fraud.models import FraudFlag
from ledger import posting
from ledger.models import Account
from notifications.services import notify_business_owner, notify_customer
from payments import providers

from . import names
from .models import PayoutDestination, Withdrawal
from .services import money
from .withdrawals import paid_key, reversed_key

logger = logging.getLogger(__name__)
RESEND_AFTER = timedelta(minutes=2)    # a held withdrawal nobody sent (the process died) is sent by the poll
ASK_AFTER = timedelta(minutes=2)       # a sent one is asked about after this
STUCK_AFTER = timedelta(minutes=30)    # staff may fail one sent this long ago with no answer (views_staff)
STUCK_PENDING = timedelta(minutes=10)  # ...or one held and never sent for this long
FAILED_REASON = "The provider could not pay it."  # what the holder sees, never the provider's own message
UNAVAILABLE_REASON = "Payouts are not available right now, so nothing was sent."


def _holder_model(withdrawal):
    return Customer if withdrawal.holder_type == "customer" else BusinessOwner


def holder_of(withdrawal):
    """The customer or business owner the withdrawal belongs to, or None when that account is gone."""
    return _holder_model(withdrawal).objects.filter(pk=withdrawal.holder_id).first()


def source_account(withdrawal):
    """The ledger account the money came from, found from the withdrawal alone: money goes back to it even when the
    holder's account row is gone, instead of staying in transit."""
    return Account.objects.get(
        kind=withdrawal.source_kind, owner_type=_holder_model(withdrawal)._meta.label_lower, owner_id=str(withdrawal.holder_id),
    )


def _case_owner(withdrawal):
    """The business a withdrawal case is related to (a vendor's withdrawal), else None. Passed as related_business_owner, never
    business_owner: that one holds promotions and marks the business at risk, which a payout question must not do."""
    return holder_of(withdrawal) if withdrawal.holder_type == "business_owner" else None


def _tell(withdrawal, title, body):
    holder = holder_of(withdrawal)
    if isinstance(holder, Customer):
        notify_customer(holder, "withdrawal", title, body=body, link="/my-account", icon="💸")
    elif holder is not None:
        notify_business_owner(holder, "withdrawal", title, body=body, link="/business", icon="💸")


def claim(withdrawal_pk, now=None):
    """PENDING → PROCESSING under the row lock (and the destination's). Returns the withdrawal if this caller won it,
    else None. Re-checks what request() checked: the holder is not suspended (and exists), the destination is not
    removed and is past its cooling period, and its name still matches the holder's verified name (which includes
    business KYC). If any fails the money goes back (CANCELLED) and None is returned. Raises RuntimeError inside an
    open transaction (durable)."""
    now = timezone.now()  # real time: a poll that started minutes ago must not backdate the send
    # durable: a caller's open transaction would hold these locks across the provider call and could roll back after it
    with transaction.atomic(durable=True):
        withdrawal = Withdrawal.objects.select_for_update().filter(pk=withdrawal_pk, status=Withdrawal.PENDING).first()
        if withdrawal is None:
            return None
        holder = holder_of(withdrawal)
        destination = PayoutDestination.objects.select_for_update().get(pk=withdrawal.destination_id)
        # A held withdrawal may be sent minutes later by the poll: everything request() checked is checked again.
        if (
            holder is None or holder.is_suspended or destination.removed_at is not None or destination.usable_from > now
            or names.matching_name(destination.account_name, holder) is None
        ):
            close(withdrawal, Withdrawal.CANCELLED, "Stopped before it was sent: the account or the destination changed.", now)
            return None
        withdrawal.status, withdrawal.submitted_at = Withdrawal.PROCESSING, now
        withdrawal.save(update_fields=["status", "submitted_at"])
        return withdrawal


def submit(withdrawal_pk, now=None):
    """Send a held withdrawal to the provider once, then apply what it answered. A provider problem never raises: a
    send that failed or got no answer stays PROCESSING for the poll (or staff) to settle, except NotConnected (nothing
    was sent), which returns the hold. Raises RuntimeError when called inside a transaction (claim is durable).
    Returns the withdrawal as it now is."""
    withdrawal = claim(withdrawal_pk, now)
    if withdrawal is None:
        return Withdrawal.objects.get(pk=withdrawal_pk)
    destination = withdrawal.destination
    try:
        result = providers.get_provider(withdrawal.provider).payout(
            reference=withdrawal.reference, rail=destination.rail, institution=destination.institution,
            account_number=destination.account_number, amount_pesewas=withdrawal.net_pesewas,
        )
    except providers.NotConnected:
        return _unsent(withdrawal)  # the provider cannot pay out at all: nothing was sent, so the hold goes back
    except Exception as exc:
        # Outcome unknown (a timeout may still have paid): stays PROCESSING for the poll. Only the type is logged.
        logger.warning("Payout %s could not be sent (%s); the poll will ask about it", withdrawal.reference, type(exc).__name__)
        return Withdrawal.objects.get(pk=withdrawal.pk)
    applied = apply_result(
        withdrawal.reference, result.status, provider_reference=result.provider_reference,
        amount_pesewas=result.amount_pesewas, now=now,
    )
    return applied or Withdrawal.objects.get(pk=withdrawal.pk)


def _unsent(withdrawal):
    """The provider refused to even take the payout (NotConnected): return the hold, exactly once (close refuses when
    an amount case is open)."""
    with transaction.atomic():
        locked = Withdrawal.objects.select_for_update().get(pk=withdrawal.pk)
        if locked.status == Withdrawal.PROCESSING:
            close(locked, Withdrawal.FAILED, UNAVAILABLE_REASON, timezone.now())
    return Withdrawal.objects.get(pk=withdrawal.pk)


def apply_result(reference, status, *, provider_reference="", amount_pesewas=None, now=None):
    """End a withdrawal from a report: SUCCEEDED posts the payout, FAILED returns the money, PROCESSING changes nothing.
    `amount_pesewas` is what the provider says reached the destination; None means the report did not say (the
    simulated status). A Hubtel report must carry it (spec §13 (xxvii)). The provider's own message text is never passed
    in: it may hold an account number. Returns the withdrawal, or None for an unknown reference."""
    now = now or timezone.now()
    if status not in (providers.SUCCEEDED, providers.FAILED):
        if provider_reference:
            with transaction.atomic():
                open_one = Withdrawal.objects.select_for_update().filter(
                    reference=reference, status=Withdrawal.PROCESSING, provider_reference="",
                ).first()
                if open_one is not None:
                    open_one.provider_reference = provider_reference[:128]
                    open_one.save(update_fields=["provider_reference"])
        return Withdrawal.objects.filter(reference=reference).first()
    with transaction.atomic():
        withdrawal = Withdrawal.objects.select_for_update().filter(reference=reference).first()
        if withdrawal is None:
            logger.warning("A payout report names an unknown withdrawal %s", reference)
            return None
        if withdrawal.status in Withdrawal.FINAL:
            if status == providers.SUCCEEDED and withdrawal.status != Withdrawal.SUCCEEDED:
                fraud.raise_flag(
                    FraudFlag.OTHER, title=f"Withdrawal {withdrawal.reference} reported paid after its money was returned",
                    detail=(f"The provider reported withdrawal {withdrawal.reference} paid, but it was already "
                            f"{withdrawal.get_status_display().lower()} and GH₵ {money(withdrawal.amount_pesewas)} went back to the "
                            "holder. Nothing was posted. Check with the provider."),
                    dedupe_key=f"withdrawal-late-paid-{withdrawal.reference}", related_business_owner=_case_owner(withdrawal),
                )
            elif status == providers.FAILED and withdrawal.status == Withdrawal.SUCCEEDED:
                fraud.raise_flag(
                    FraudFlag.OTHER, title=f"Withdrawal {withdrawal.reference} reported failed after it was paid",
                    detail=(f"The provider reported withdrawal {withdrawal.reference} failed, but it was already paid and "
                            "posted. Nothing was returned to the holder. Check with the provider whether the money came back."),
                    dedupe_key=f"withdrawal-late-failed-{withdrawal.reference}", related_business_owner=_case_owner(withdrawal),
                )
            return withdrawal
        if withdrawal.status == Withdrawal.PENDING:
            # Never sent (not claimed): no provider can have an answer for it, so the report is misrouted or forged.
            fraud.raise_flag(
                FraudFlag.OTHER, title=f"Withdrawal {withdrawal.reference} reported before it was sent",
                detail=(f"A {status} report arrived for withdrawal {withdrawal.reference}, which was never sent to the "
                        "provider. Nothing was posted. Check with the provider."),
                dedupe_key=f"withdrawal-unsent-report-{withdrawal.reference}", related_business_owner=_case_owner(withdrawal),
            )
            return withdrawal
        if FraudFlag.objects.filter(dedupe_key=f"withdrawal-amount-{withdrawal.reference}", status=FraudFlag.OPEN).exists():
            return withdrawal  # an unresolved amount case freezes it: staff decide, no later report settles or returns it
        if amount_pesewas is None and status == providers.SUCCEEDED and withdrawal.provider != "simulated":
            fraud.raise_flag(
                FraudFlag.OTHER, title=f"Withdrawal {withdrawal.reference}: a paid report without an amount",
                detail=f"A paid report for GH₵ {money(withdrawal.net_pesewas)} arrived without the amount it paid. Not applied.",
                dedupe_key=f"withdrawal-amount-{withdrawal.reference}", related_business_owner=_case_owner(withdrawal),
            )
            return withdrawal
        if status == providers.SUCCEEDED:
            amount_differs = amount_pesewas is not None and amount_pesewas != withdrawal.net_pesewas
        else:
            amount_differs = bool(amount_pesewas)  # a failed report carrying 0 or none means nothing reached the destination
        if amount_differs:
            said = "paid" if status == providers.SUCCEEDED else "FAILED"
            fraud.raise_flag(
                FraudFlag.OTHER, title=f"Withdrawal {withdrawal.reference}: the provider reported a different amount",
                detail=(f"Sent GH₵ {money(withdrawal.net_pesewas)}; the provider's {said} report carried GH₵ {money(amount_pesewas)}"
                        + (" (money may have left although it says failed)" if status == providers.FAILED else "") + ". Not applied."),
                dedupe_key=f"withdrawal-amount-{withdrawal.reference}", related_business_owner=_case_owner(withdrawal),
            )
            return withdrawal
        if provider_reference and not withdrawal.provider_reference:
            withdrawal.provider_reference = provider_reference[:128]
        if status == providers.FAILED:
            logger.info("Payout %s failed at the provider", withdrawal.reference)
            return close(withdrawal, Withdrawal.FAILED, FAILED_REASON, now)
        posting.post(
            key=paid_key(withdrawal.reference), kind="withdrawal_paid",
            lines=[
                posting.debit(posting.account_for(Account.WITHDRAWAL_IN_TRANSIT), withdrawal.amount_pesewas),
                posting.credit(posting.account_for(Account.PROVIDER_CLEARING), withdrawal.amount_pesewas),
            ],
            reference_type="wallets.withdrawal", reference_id=withdrawal.reference, memo=f"Withdrawal {withdrawal.reference} paid",
            allow_negative={Account.PROVIDER_CLEARING},  # the provider confirmed it: a fact to record (spec §13 xxvi)
        )
        withdrawal.status, withdrawal.settled_at = Withdrawal.SUCCEEDED, timezone.now()
        withdrawal.save(update_fields=["status", "settled_at", "provider_reference"])
        destination = withdrawal.destination
        _tell(withdrawal, "Your withdrawal was paid",
              f"GH₵ {money(withdrawal.net_pesewas)} was sent to your {destination.get_rail_display().lower()} ({destination.institution}).")
        return withdrawal


def amount_case_key(withdrawal):
    return f"withdrawal-amount-{withdrawal.reference}"


def close(withdrawal, status, reason, now):
    """Return a held withdrawal's money to its source (FAILED or CANCELLED). The caller holds the row lock. `reason` is
    shown to the holder: AshantiHub's own words, never the provider's message or a staff member's note. A PROCESSING
    withdrawal with an OPEN amount case is NOT closed: the provider may have paid, so the withdrawal is returned
    unchanged (status still PROCESSING) and callers must not assume it ended. Staff resolve the case first."""
    if withdrawal.status == Withdrawal.PROCESSING and FraudFlag.objects.filter(
        dedupe_key=amount_case_key(withdrawal), status=FraudFlag.OPEN,
    ).exists():
        logger.warning("Withdrawal %s has an open amount case; not returned", withdrawal.reference)
        return withdrawal
    source = source_account(withdrawal)
    posting.post(
        key=reversed_key(withdrawal.reference), kind="withdrawal_reversed",
        lines=[
            posting.debit(posting.account_for(Account.WITHDRAWAL_IN_TRANSIT), withdrawal.amount_pesewas),
            posting.credit(source, withdrawal.amount_pesewas),
        ],
        reference_type="wallets.withdrawal", reference_id=withdrawal.reference, memo=f"Withdrawal {withdrawal.reference} returned",
    )
    withdrawal.status, withdrawal.settled_at, withdrawal.failure_reason = status, timezone.now(), (reason or "")[:300]
    withdrawal.save(update_fields=["status", "settled_at", "failure_reason", "provider_reference"])
    title = "Your withdrawal was cancelled" if status == Withdrawal.CANCELLED else "Your withdrawal didn't go through"
    _tell(withdrawal, title, f"GH₵ {money(withdrawal.amount_pesewas)} is back in your balance. {withdrawal.failure_reason}")
    return withdrawal


def stuck(withdrawal, now=None):
    """Staff may fail it by hand: sent STUCK_AFTER ago with no answer, or held and never sent for STUCK_PENDING."""
    now = now or timezone.now()
    if withdrawal.status == Withdrawal.PROCESSING:
        return withdrawal.submitted_at is not None and withdrawal.submitted_at <= now - STUCK_AFTER
    if withdrawal.status == Withdrawal.PENDING:
        return withdrawal.created_at <= now - STUCK_PENDING
    return False


def poll(now=None):
    """Send held withdrawals nobody sent, and ask the provider about sent ones. Returns how many it looked at. A provider
    that cannot report (NotConnected) leaves them for staff. One withdrawal that fails (a provider error, a bad row) is
    logged and skipped, so it never stops the poll for everyone else."""
    now = now or timezone.now()
    looked = 0
    for pk in Withdrawal.objects.filter(status=Withdrawal.PENDING, created_at__lt=now - RESEND_AFTER).values_list("pk", flat=True):
        try:
            submit(pk, now)
        except Exception as exc:
            logger.error("Could not send withdrawal %s (%s); the next poll tries again", pk, type(exc).__name__)
            continue
        looked += 1
    prefix = "withdrawal-amount-"  # one that ever had an amount case (any status) is left to staff
    held_for_staff = {key[len(prefix):] for key in FraudFlag.objects.filter(dedupe_key__startswith=prefix).values_list("dedupe_key", flat=True)}
    for withdrawal in Withdrawal.objects.filter(status=Withdrawal.PROCESSING, submitted_at__lt=now - ASK_AFTER).exclude(reference__in=held_for_staff):
        try:
            result = providers.get_provider(withdrawal.provider).status(withdrawal.reference)
            apply_result(
                withdrawal.reference, result.status, provider_reference=result.provider_reference,
                amount_pesewas=result.amount_pesewas, now=now,
            )
        except Exception as exc:
            logger.error("Could not settle payout %s (%s); the next poll asks again", withdrawal.reference, type(exc).__name__)
            continue
        looked += 1
    return looked
