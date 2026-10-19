"""wallets.withdrawal_resolution (wallet rulings 7C, Task 4; spec §13 (xxxv), (xxxvi)): ending a stuck withdrawal by hand
takes two people. A holder of wallets.manage proposes "failed" (return the money) or "paid" (it reached the destination)
with evidence (a provider reference, a statement note: 10+ characters); another holder of wallets.manage (or a Super
Admin) approves with the password again; a request nobody answers moves up to a Super Admin. Nobody ends one alone: the kind is two_people, so not even a Super Admin's own
request applies at once, the maker never approves their own, and a staff member who is the withdrawal's holder (a
third-party rider) never takes part. Every hand resolution therefore ends as the provider confirmed it, or as an
approved evidence request.

The provider is asked again when the request is approved (validate, and again in apply under the row lock): an answer
opposite to the proposal refuses it (409 provider_changed) and changes nothing, so the poll's next check settles it as
the provider says; an answer of PROCESSING (or anything unmapped) refuses "failed" (409 provider_processing), because
nothing asks the provider again after a hand fail and returned money could be withdrawn twice. "paid" stays possible
while the provider says PROCESSING: it is the way out for a payout the provider keeps reporting in progress when its
statement shows it paid. A provider that is not wired to report (NotConnected) leaves the evidence standing for either
outcome; one that cannot be reached answers 503 provider_unreachable and changes nothing. An answer that agrees with the
proposal is applied as the provider's own report.

Approving "failed" returns the held money through payouts.close (the reversed journal, once); approving "paid" posts the
paid journal under its paid_key through payouts.apply_result, exactly as a provider report would, so a webhook arriving
later posts nothing again. No provider text and no whole account or phone number is kept: the evidence is stored with
any 6+ digit run masked."""
import logging
import re
from decimal import Decimal

from django.utils import timezone

from activity.services import record
from approvals.models import ApprovalRequest
from approvals.registry import ApprovalKind
from approvals.services import ApprovalError
from fraud.models import FraudFlag
from payments import providers

from . import payouts
from .models import Withdrawal
from .services import money

logger = logging.getLogger(__name__)

KEY = "wallets.withdrawal_resolution"
MANAGE = "wallets.manage"
FAILED, PAID = "failed", "paid"
OUTCOMES = (FAILED, PAID)
MIN_EVIDENCE = 10
STAFF_FAILED_REASON = "AshantiHub could not complete it."  # what the holder sees, never staff text
EVIDENCE_MESSAGE = (f"Give the evidence for this (a provider reference or what the provider's statement shows), "
                    f"at least {MIN_EVIDENCE} characters.")
OUTCOME_MESSAGE = "Choose failed (return the money) or paid (it reached the destination)."


class Refused(ApprovalError):
    """A refusal the API answers with a code beside the message."""

    def __init__(self, message, code, status_code=409):
        super().__init__(message)
        self.code = code
        self.status_code = status_code


_NUMBER = re.compile(r"\d(?:[\s-]?\d){5,}")


def mask_numbers(text):
    """Staff text lives in the append-only activity log and the approval for good: any run of 6+ digits (spaces or
    dashes between them allowed, as a phone or MoMo number is written) keeps only its last 3 digits."""
    def hide(match):
        digits = re.sub(r"\D", "", match.group())
        return "*" * (len(digits) - 3) + digits[-3:]
    return _NUMBER.sub(hide, text)


def clean_evidence(raw):
    evidence = str(raw or "").strip()
    if len(evidence) < MIN_EVIDENCE:
        raise Refused(EVIDENCE_MESSAGE, "evidence_required", status_code=400)
    return mask_numbers(evidence)[:500]


def own_withdrawal(user, withdrawal):
    """A staff member who is also a third-party rider holder never settles their own withdrawal (self-dealing)."""
    return user is not None and withdrawal.holder_type == "staff" and withdrawal.holder_id == user.pk


def amount_case_open(withdrawal):
    """The provider reported a different amount for it (so money may have left) and fraud staff have not resolved the case."""
    return FraudFlag.objects.filter(dedupe_key=payouts.amount_case_key(withdrawal), status=FraudFlag.OPEN).exists()


def gate(withdrawal):
    """What every hand resolution needs, at request and at approval: stuck, and no open amount case."""
    if not payouts.stuck(withdrawal):
        raise Refused(
            "Only a withdrawal stuck (sent 30+ minutes ago with no answer, or held and never sent for 10+ minutes) "
            "can be resolved by hand.", "not_stuck",
        )
    if amount_case_open(withdrawal):
        raise Refused(
            "A payout report for this withdrawal needs a person to review it first. Resolve that case, then try again.",
            "amount_case_open",
        )


def ask_provider(withdrawal):
    """The provider's answer for a sent withdrawal, or None: one never sent is not asked, and a provider not wired to
    report (NotConnected) leaves staff's evidence standing. Any other failure says nothing about the payout: 503."""
    if withdrawal.status != Withdrawal.PROCESSING:
        return None
    try:
        return providers.get_provider(withdrawal.provider).status(withdrawal.reference)
    except providers.NotConnected:
        return None
    except Exception as exc:
        logger.warning("Provider status for %s unreachable (%s)", withdrawal.reference, type(exc).__name__)  # only the type
        raise Refused(
            "The provider could not be reached to check this withdrawal. Nothing was changed; try again shortly.",
            "provider_unreachable", status_code=503,
        ) from exc


def final(answer):
    return answer is not None and answer.status in (providers.SUCCEEDED, providers.FAILED)


def check(withdrawal, outcome, answer):
    """Refuse a proposal the provider's answer contradicts. An agreeing final answer, or none, lets it through."""
    if outcome == PAID and withdrawal.status == Withdrawal.PENDING:
        raise Refused("This withdrawal was never sent to the provider, so it cannot have been paid. Fail it instead.", "never_sent")
    if answer is None:
        return
    said = {providers.SUCCEEDED: PAID, providers.FAILED: FAILED}.get(answer.status)
    if said is not None and said != outcome:
        raise Refused(
            f"The provider now says this withdrawal {'was paid' if said == PAID else 'failed'}, the opposite of this request. "
            "Nothing was changed; the provider's next check settles it as it says.", "provider_changed",
        )
    if said is None and outcome == FAILED:  # fail closed: PROCESSING or anything unmapped
        raise Refused(
            "The provider says this payout is still in progress, so it cannot be failed. Nothing was changed; try again "
            "later, or settle it as paid if the provider's statement shows it paid.", "provider_processing",
        )


def _withdrawal(request, lock=False):
    rows = Withdrawal.objects.select_for_update() if lock else Withdrawal.objects
    return rows.get(pk=request.payload.get("withdrawal_id"))  # DoesNotExist: the engine answers "stale"


def _outcome(request):
    outcome = request.payload.get("outcome")
    if outcome not in OUTCOMES:
        raise Refused(OUTCOME_MESSAGE, "bad_outcome", status_code=400)
    return outcome


def current_state(request):
    return {"status": _withdrawal(request).status}


def amount_of(request):
    return Decimal(_withdrawal(request).amount_pesewas) / Decimal(100)


def validate(request):
    outcome = _outcome(request)
    clean_evidence(request.payload.get("evidence"))
    withdrawal = _withdrawal(request)
    gate(withdrawal)
    check(withdrawal, outcome, ask_provider(withdrawal))


def apply(request):
    outcome = _outcome(request)
    evidence = clean_evidence(request.payload.get("evidence"))
    withdrawal = _withdrawal(request, lock=True)
    people = [request.maker] + [decision.staff for decision in request.decisions.select_related("staff")]
    if any(own_withdrawal(person, withdrawal) for person in people):
        raise Refused("You cannot resolve your own withdrawal. Ask another member of staff.", "own_withdrawal", status_code=403)
    gate(withdrawal)
    answer = ask_provider(withdrawal)  # again, under the row lock: the answer this approval acts on
    check(withdrawal, outcome, answer)
    before = withdrawal.status
    if final(answer):  # the provider agrees: its own report settles it
        payouts.apply_result(
            withdrawal.reference, answer.status, provider_reference=answer.provider_reference,
            amount_pesewas=answer.amount_pesewas,
        )
    elif outcome == FAILED:
        payouts.close(withdrawal, Withdrawal.FAILED, STAFF_FAILED_REASON, timezone.now())
    else:  # as if the provider's report had arrived: the paid journal under its paid_key, posted once
        payouts.apply_result(withdrawal.reference, providers.SUCCEEDED, amount_pesewas=withdrawal.net_pesewas)
    withdrawal.refresh_from_db()
    if withdrawal.status != (Withdrawal.FAILED if outcome == FAILED else Withdrawal.SUCCEEDED):
        # A case opened (a report with a different amount) or the row moved: never claim it ended.
        raise Refused(
            "A payout report for this withdrawal needs a person to review it first. Nothing was changed.", "amount_case_open",
        )
    decider = request.decided_by or request.maker
    verb, said = ("wallets.withdrawal_failed", "failed, GH₵ {} returned") if outcome == FAILED else ("wallets.withdrawal_paid", "settled as paid, GH₵ {}")
    # Last: record() holds the activity chain lock until commit. No account number, ever; the evidence stays here.
    record(
        decider, verb, target=withdrawal,
        summary=f"Withdrawal {withdrawal.reference} {said.format(money(withdrawal.amount_pesewas))} by two people"
                + (" (the provider confirmed it)" if final(answer) else " on evidence"),
        before={"status": before},
        after={"status": withdrawal.status, "evidence": evidence[:300], "approval_id": request.pk,
               "proposed_by": request.maker_id, "provider_confirmed": final(answer)},
    )


def render_diff(request):
    try:
        withdrawal = _withdrawal(request)
    except Withdrawal.DoesNotExist:
        return []
    after = "Paid" if request.payload.get("outcome") == PAID else "Failed, money returned"
    return [
        {"field": f"Withdrawal {withdrawal.reference} (GH₵ {money(withdrawal.amount_pesewas)})",
         "before": (request.before or {}).get("status"), "after": after},
        {"field": "Evidence", "before": None, "after": request.payload.get("evidence")},
    ]


def consequences(request):
    try:
        amount = money(_withdrawal(request).amount_pesewas)
    except Withdrawal.DoesNotExist:
        return []
    asked = "The provider is asked again when you approve; if it now says the opposite, nothing changes."
    if request.payload.get("outcome") == PAID:
        return [f"Records GH₵ {amount} as paid out, as if the provider had confirmed it. Nothing goes back to the holder.", asked]
    return [f"Returns GH₵ {amount} to the holder's balance. If the provider pays it later, that payment is not posted and a "
            "fraud case opens.", asked]


def chain(request):
    return [(ApprovalRequest.POOL, None), (ApprovalRequest.SUPER_ADMIN, None)]


WITHDRAWAL_RESOLUTION = ApprovalKind(
    key=KEY, label="Resolve a stuck withdrawal", pool_permission=MANAGE, current_state=current_state, apply=apply,
    response_hours=4, resolve_approver=chain, render_diff=render_diff, validate=validate, consequences=consequences,
    requires_sudo=True, amount_of=amount_of, two_people=True,
    chain_note="One approval from another holder of wallets.manage, or a Super Admin (it moves to a Super Admin if unanswered); never the person who asked",
)
