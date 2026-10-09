"""commission.policy: a new commission amount, proposed by Accounting and
approved by a Super Admin (spec S8). Applying it writes a CommissionPolicy row
from the effective date (never earlier than today: nothing is backfilled)."""
from datetime import date
from decimal import Decimal, InvalidOperation

from django.utils import timezone

from activity.services import record
from approvals.models import ApprovalRequest
from approvals.registry import ApprovalKind
from approvals.services import ApprovalError

from . import services
from .models import CommissionPolicy

KEY = "commission.policy"
KIND_LABELS = dict(CommissionPolicy.KIND_CHOICES)


def current_state(request):
    policy = services.policy_in_force(request.payload.get("kind"))
    return {"kind": request.payload.get("kind"), "amount": str(policy.amount) if policy else None}


def validate(request):
    try:
        services.clean_proposal(request.payload.get("kind"), request.payload.get("amount"), request.payload.get("effective_from"))
    except services.PolicyError as exc:
        raise ApprovalError(exc.message) from exc


def apply(request):
    payload = request.payload
    amount = Decimal(str(payload["amount"]))
    effective_from = max(date.fromisoformat(payload["effective_from"]), timezone.localdate())
    policy = CommissionPolicy.objects.create(
        kind=payload["kind"], amount=amount, effective_from=effective_from,
        proposed_by=request.maker, approved_by=request.decided_by or request.maker, approval_id=request.pk,
    )
    # Last: the event refreshes every open statement and policy screen live.
    record(
        request.decided_by or request.maker, "commission.policy_applied", target=policy,
        summary=f"{KIND_LABELS.get(policy.kind, policy.kind)} commission set to GH₵ {amount} from {effective_from.isoformat()}",
        after={"kind": policy.kind, "amount": str(amount), "effective_from": effective_from.isoformat()},
    )


def render_diff(request):
    before = (request.before or {}).get("amount")
    return [{"field": f"{KIND_LABELS.get(request.payload['kind'], request.payload['kind'])} commission (GH₵)", "before": before, "after": str(request.payload["amount"])}]


def resolve_approver(request):
    return [(ApprovalRequest.SUPER_ADMIN, None)]


COMMISSION_POLICY = ApprovalKind(
    key=KEY, label="Change a commission amount", pool_permission="", current_state=current_state, apply=apply,
    response_hours=48, resolve_approver=resolve_approver, render_diff=render_diff, validate=validate,
)
