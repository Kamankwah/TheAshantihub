"""The `marketing.coupon` approval: a coupon whose budget cap is above the campaign threshold
(ApprovalSettings.campaign_threshold) goes live only when Super Admin approves it. Under the
threshold it is activated directly (marketing/coupons.py). A Super Admin's own coupon applies at
once (the engine's rule). Same shape as marketing.send_policy."""
from decimal import Decimal

from approvals.models import ApprovalRequest
from approvals.registry import ApprovalKind
from approvals.services import ApprovalError

from . import coupons
from .models_promos import Coupon


def _super_admin_only(request):
    return [(ApprovalRequest.SUPER_ADMIN, None)]


def _coupon(request):
    return Coupon.objects.get(pk=request.payload["coupon"])


def _state(request):
    c = _coupon(request)
    return {"status": c.status, "code": c.code, "kind": c.kind, "value": str(c.value), "usage_limit": c.usage_limit, "budget_cap": str(c.budget_cap)}


def _amount(request):
    return Decimal(str(request.payload["budget_cap"]))


def _validate(request):
    c = _coupon(request)
    if c.status != Coupon.WAITING:
        raise ApprovalError("This coupon is no longer waiting for approval.")


def _apply(request):
    c = Coupon.objects.select_for_update().get(pk=request.payload["coupon"])
    coupons.go_live(c, request.decided_by or request.maker)


def _on_rejected(request):
    c = Coupon.objects.select_for_update().filter(pk=request.payload["coupon"], status=Coupon.WAITING).first()
    if c:
        c.status = Coupon.DRAFT
        c.save(update_fields=["status", "updated_at"])


def _diff(request):
    c = _coupon(request)
    off = f"{c.value}% off" + (f", up to GH₵ {c.max_discount}" if c.max_discount else "") if c.kind == Coupon.PERCENT else f"GH₵ {c.value} off"
    return [
        {"field": "Coupon", "before": "Not live", "after": f"{c.code} ({'single-use codes' if c.code_mode == Coupon.SINGLE_USE else 'one shared code'})"},
        {"field": "Discount", "before": "", "after": f"{off}, minimum spend GH₵ {c.min_spend}"},
        {"field": "Most it can cost", "before": "", "after": f"GH₵ {c.budget_cap}"},
    ]


def _consequences(request):
    return [
        "Customers can use the code at checkout once checkout promotions are switched on.",
        "AshantiHub pays the discount; the seller is paid the full price.",
        "It pauses itself when the budget cap is reached.",
    ]


COUPON_KIND = ApprovalKind(
    key=coupons.KIND_KEY, label="Approve a discount coupon", pool_permission="", current_state=_state, apply=_apply,
    response_hours=48, chain_note="Super Admin only", resolve_approver=_super_admin_only, render_diff=_diff,
    validate=_validate, on_rejected=_on_rejected, consequences=_consequences, amount_of=_amount, money=True,
)
