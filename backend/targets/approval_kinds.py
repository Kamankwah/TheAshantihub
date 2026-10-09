"""targets.cut: lowering a scout's current-month total after the 1st needs a
Super Admin (spec S6)."""
from datetime import date

from django.utils import timezone

from accounts.models import StaffUser
from approvals.registry import ApprovalKind
from approvals.services import ApprovalError
from approvals.models import ApprovalRequest

from . import plans
from .models import METRICS

KEY = "targets.cut"


def _staff(request):
    return StaffUser.objects.get(pk=request.payload["staff"])


def _metrics(request):
    return [m for m in METRICS if m in request.payload["values"]]


def current_state(request):
    # Only the measures in the request: another change to any of them makes it stale.
    return {"staff": request.payload["staff"], "current": plans.current_values(_staff(request), _metrics(request))}


def validate(request):
    try:
        plans.check_limits(request.payload["values"])
    except plans.PlanError as exc:
        raise ApprovalError(exc.message) from exc


def apply(request):
    values = request.payload["values"]
    effective_from = max(date.fromisoformat(request.payload["effective_from"]), timezone.localdate())
    # The maker's change, decided by a Super Admin: the plan records the maker.
    plans.write_plans(_staff(request), values, effective_from, request.maker)


def render_diff(request):
    staff = _staff(request)
    before = request.before.get("current", {}) if request.before else plans.current_values(staff, _metrics(request))
    return [
        {"field": f"{staff.full_name} · {metric} a day", "before": before.get(metric), "after": request.payload["values"][metric]}
        for metric in _metrics(request)
    ]


def resolve_approver(request):
    return [(ApprovalRequest.SUPER_ADMIN, None)]


TARGETS_CUT = ApprovalKind(
    key=KEY,
    label="Lower a scout's targets",
    pool_permission="",
    current_state=current_state,
    apply=apply,
    response_hours=48,
    resolve_approver=resolve_approver,
    render_diff=render_diff,
    validate=validate,
)
