"""The `marketing.delivery_promo_funding` approval (plan 7F-E Task 4, Ruling R2): a free-delivery promo that AshantiHub pays
for. Marketing creates it (delivery_promo.fund); it ALWAYS waits for Operations or a Super Admin (there is no threshold
shortcut, it spends AshantiHub's money), the maker never decides their own, and a Super Admin's own promo applies at once
(the engine's rule). Operations is modelled by the pool permission `delivery_promo.approve` (seeded to operations and
super_admin); the chain is pool then Super Admin, with no manager stage. Approving needs the password again."""
from decimal import Decimal

from django.utils import timezone

from activity.services import record
from approvals.models import ApprovalRequest
from approvals.registry import ApprovalKind
from approvals.services import ApprovalError
from notifications.services import notify_business_owner

from . import waivers
from .models_waivers import DeliveryWaiver

KEY = "marketing.delivery_promo_funding"
APPROVE_PERM = "delivery_promo.approve"
FUND_PERM = "delivery_promo.fund"


def _approvers(request):
    return [(ApprovalRequest.POOL, None), (ApprovalRequest.SUPER_ADMIN, None)]


def _waiver(request):
    return DeliveryWaiver.objects.select_related("business_owner").get(pk=request.payload["waiver"])


def _state(request):
    w = _waiver(request)
    return {"status": w.status, "budget_cap": str(w.budget_cap), "starts_at": w.starts_at.isoformat(), "ends_at": w.ends_at.isoformat()}


def _amount(request):
    return Decimal(str(request.payload["budget_cap"]))


def _validate(request):
    w = _waiver(request)
    if w.status != DeliveryWaiver.PENDING:
        raise ApprovalError("This promo is no longer waiting for approval.")
    if w.ends_at <= timezone.now():
        raise ApprovalError("This promo's window has already ended.")
    blocker = waivers.owner_blocker(w.business_owner)
    if blocker:
        raise ApprovalError(blocker)


def _apply(request):
    w = DeliveryWaiver.objects.select_for_update().select_related("business_owner").get(pk=request.payload["waiver"])
    decider = request.decided_by or request.maker
    w.status, w.reviewed_by, w.reviewed_at, w.rejection_reason = DeliveryWaiver.ACTIVE, decider, timezone.now(), ""
    w.save(update_fields=["status", "reviewed_by", "reviewed_at", "rejection_reason", "updated_at"])
    notify_business_owner(w.business_owner, "delivery_promo_approved", "AshantiHub is covering delivery on your items",
                          body=f"The free-delivery promo “{w.name}” is on.", icon="🚚")
    # Last: the event is the history of who turned AshantiHub's money on.
    record(decider, "marketing.delivery_promo_funded", target=w, summary=f"AshantiHub-funded free delivery approved: {w.name}",
           after={"business_id": w.business_owner_id, "name": w.name, "budget_cap": str(w.budget_cap), "funded_by": w.funded_by})


def _on_rejected(request):
    w = DeliveryWaiver.objects.select_for_update().filter(pk=request.payload["waiver"], status=DeliveryWaiver.PENDING).first()
    if w is None:
        return
    w.status, w.reviewed_by, w.reviewed_at = DeliveryWaiver.REJECTED, request.decided_by, timezone.now()
    w.rejection_reason = (request.decision_note or "")[:300]
    w.save(update_fields=["status", "reviewed_by", "reviewed_at", "rejection_reason", "updated_at"])


def _diff(request):
    w = _waiver(request)
    items = "Every item" if w.all_items else ", ".join(l.name for l in w.listings.all()) or "No items"
    return [
        {"field": "Promo", "before": "Not live", "after": f"{w.name} for {w.business_owner.display_name}"},
        {"field": "Items", "before": "", "after": items},
        {"field": "Runs", "before": "", "after": f"{w.starts_at:%d %b %Y %H:%M} to {w.ends_at:%d %b %Y %H:%M}"},
        {"field": "Most it can cost AshantiHub", "before": "", "after": f"GH₵ {w.budget_cap}"},
    ]


def _consequences(request):
    cap = request.payload["budget_cap"]
    return [
        f"AshantiHub pays the delivery fee on each covered order when the rider is owed, up to GH₵ {cap}.",
        "Customers see free delivery on the covered items once it is on.",
        "It stops waiving by itself when the cap is used up.",
    ]


DELIVERY_PROMO_FUNDING = ApprovalKind(
    key=KEY, label="Approve an AshantiHub-funded free-delivery promo", pool_permission=APPROVE_PERM, current_state=_state, apply=_apply,
    response_hours=48, chain_note="Operations or Super Admin", resolve_approver=_approvers, render_diff=_diff, validate=_validate,
    on_rejected=_on_rejected, consequences=_consequences, requires_sudo=True, amount_of=_amount,
)
