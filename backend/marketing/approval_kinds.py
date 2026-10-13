"""Marketing's approval kinds. Each is Super Admin only (`chain_note`); the maker is
Marketing and never decides. A Super Admin's own proposal applies at once (the
engine's direct-apply rule). Campaign, coupon and banner kinds register from their
own modules and are appended to KINDS there."""
from django.utils import timezone

from activity.services import record
from approvals.models import ApprovalRequest
from approvals.registry import ApprovalKind
from approvals.services import ApprovalError

from . import policy as policy_rules
from .models import SendPolicy

SEND_POLICY = "marketing.send_policy"
FIELDS = ("window_start", "window_end", "send_days", "per_person_cap_days", "quiet_public_holidays")


def _super_admin_only(request):
    return [(ApprovalRequest.SUPER_ADMIN, None)]


def _state(policy):
    data = policy_rules.serialize(policy)
    return {field: data[field] for field in FIELDS}


def _policy_current_state(request):
    return _state(SendPolicy.current())


def _policy_validate(request):
    try:
        policy_rules.clean_proposal(request.payload)
    except policy_rules.PolicyError as exc:
        raise ApprovalError(exc.message) from exc


def _policy_apply(request):
    clean = policy_rules.clean_proposal(request.payload)
    policy = SendPolicy.current()
    before = _state(policy)
    policy.window_start = policy_rules.parse_time(clean["window_start"], "")
    policy.window_end = policy_rules.parse_time(clean["window_end"], "")
    policy.send_days = clean["send_days"]
    policy.per_person_cap_days = clean["per_person_cap_days"]
    policy.quiet_public_holidays = clean["quiet_public_holidays"]
    policy.updated_by = request.decided_by or request.maker
    policy.updated_at = timezone.now()
    policy.save()
    # Last: the event is the history list on the Quiet hours screen.
    record(
        policy.updated_by, "marketing.send_policy_applied", target=policy,
        summary="Marketing send window and limits changed", before=before, after=_state(policy),
    )


LABELS = {
    "window_start": "Window opens", "window_end": "Window closes", "send_days": "Send days",
    "per_person_cap_days": "One message per person every (days)", "quiet_public_holidays": "Public holidays are quiet days",
}


def _show(field, value):
    if field == "send_days":
        return ", ".join(policy_rules.WEEKDAY_NAMES[d][:3] for d in value)
    if field == "quiet_public_holidays":
        return "Yes" if value else "No"
    return str(value)


def _policy_diff(request):
    before = request.before or {}
    clean = policy_rules.clean_proposal(request.payload)
    return [
        {"field": LABELS[f], "before": _show(f, before.get(f)), "after": _show(f, clean[f])}
        for f in FIELDS if before.get(f) != clean[f]
    ]


def _policy_consequences(request):
    return ["Applies to every marketing send from now on.", "Service and transactional messages are not affected."]


SEND_POLICY_KIND = ApprovalKind(
    key=SEND_POLICY, label="Change the marketing send window or limits", pool_permission="", current_state=_policy_current_state,
    apply=_policy_apply, response_hours=48, chain_note="Super Admin only", resolve_approver=_super_admin_only,
    render_diff=_policy_diff, validate=_policy_validate, consequences=_policy_consequences,
)

# Appended to by the campaign, coupon and banner modules as they land.
KINDS = [SEND_POLICY_KIND]

from .approval_kinds_banners import BANNER_KIND  # noqa: E402

KINDS.append(BANNER_KIND)

from .approval_kinds_coupons import COUPON_KIND  # noqa: E402

KINDS.append(COUPON_KIND)

from .approval_kinds_campaigns import CAMPAIGN_KIND  # noqa: E402

KINDS.append(CAMPAIGN_KIND)
