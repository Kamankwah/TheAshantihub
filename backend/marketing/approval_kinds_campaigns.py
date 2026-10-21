"""The `marketing.campaign` approval: a campaign whose estimated cost is above the limit (or unknown). Super Admin only."""
from decimal import Decimal

from approvals.models import ApprovalRequest
from approvals.registry import ApprovalKind
from approvals.services import ApprovalError

from . import campaigns, messages, policy
from .models_campaigns import Campaign

KIND_KEY = campaigns.KIND


def _super_admin_only(request):
    return [(ApprovalRequest.SUPER_ADMIN, None)]


def _campaign(request):
    return Campaign.objects.get(pk=request.payload["campaign"])


def _current_state(request):
    c = _campaign(request)
    return {"status": c.status, "signature": campaigns.signature(c)}


def _validate(request):
    c = _campaign(request)
    if c.status != Campaign.WAITING:
        raise ApprovalError("This campaign is no longer waiting for approval.")
    problems = campaigns.blockers(c)
    if problems:
        raise ApprovalError(problems[0])


def _apply(request):
    c = Campaign.objects.select_for_update().get(pk=request.payload["campaign"])
    if c.status == Campaign.WAITING:
        c.status, c.note = Campaign.SCHEDULED, ""
        c.save()


def _on_rejected(request):
    c = Campaign.objects.filter(pk=request.payload["campaign"], status=Campaign.WAITING).first()
    if c:
        c.status = Campaign.DRAFT
        c.note = f"Returned by Super Admin{': ' + request.decision_note if request.decision_note else ''}."[:300]
        c.save()


def _diff(request):
    c = _campaign(request)
    when = f"{c.send_at:%a %d %b %Y %H:%M}" if c.send_at else "No time set"
    cost = f"GH₵ {c.est_cost}" if c.cost_known else "Unknown (no price is set for this channel)"
    return [
        {"field": "Channel", "before": "", "after": c.get_channel_display() if hasattr(c, "get_channel_display") else c.channel},
        {"field": "People reached", "before": "", "after": f"{c.est_recipients:,}"},
        {"field": "Estimated cost", "before": "", "after": cost},
        {"field": "Send time", "before": "", "after": when},
        {"field": "Message", "before": "", "after": messages.render(c, example=True)},
    ]


def _consequences(request):
    return ["The campaign is scheduled and goes out at its send time, inside the sending window.", "Only people with an opt-in on record are messaged, and anyone who opts out first is dropped."]


def _amount(request):
    return Decimal(str(request.payload.get("cost") or "0"))


CAMPAIGN_KIND = ApprovalKind(
    key=KIND_KEY, label="Send a marketing campaign", pool_permission="", current_state=_current_state, apply=_apply,
    response_hours=24, chain_note="Super Admin or General Manager", resolve_approver=_super_admin_only, render_diff=_diff, validate=_validate,
    on_rejected=_on_rejected, consequences=_consequences, amount_of=_amount,
)
