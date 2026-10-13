from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import HasAnyRolePermission, HasRolePermission
from activity.models import ActivityEvent
from approvals import services as approvals
from approvals.models import ApprovalRequest

from . import overview as overview_service
from . import policy as policy_rules
from .approval_kinds import SEND_POLICY

# Anyone who works in Marketing may read the overview and the rules.
READ = ("campaigns.manage", "promotions.manage", "analytics.view", "hero_media.approve", "event.approve", "consent.view", "coupons.manage", "site_promo.manage")


class OverviewView(APIView):
    """GET overview/?days=7|30"""

    def get_permissions(self):
        return [HasAnyRolePermission(*READ)]

    def get(self, request):
        try:
            days = int(request.query_params.get("days", 7))
        except ValueError:
            days = 7
        return Response(overview_service.overview(request.user, days))


def _pending_proposal():
    row = ApprovalRequest.objects.filter(kind=SEND_POLICY, status=ApprovalRequest.PENDING).select_related("maker").order_by("-created_at").first()
    if not row:
        return None
    return {"id": row.pk, "title": row.title, "maker": row.maker.full_name, "created_at": row.created_at, "payload": row.payload}


def _history():
    """Past changes: applied (activity log) and turned down (approvals)."""
    out = []
    for event in ActivityEvent.objects.filter(verb="marketing.send_policy_applied").order_by("-occurred_at")[:10]:
        out.append({"at": event.occurred_at, "kind": "applied", "who": event.actor_label, "before": event.before, "after": event.after})
    for row in ApprovalRequest.objects.filter(kind=SEND_POLICY, status=ApprovalRequest.REJECTED).select_related("maker").order_by("-created_at")[:5]:
        out.append({"at": row.decided_at or row.created_at, "kind": "rejected", "who": row.maker.full_name, "before": row.before, "after": row.payload, "note": row.decision_note})
    return sorted(out, key=lambda r: r["at"], reverse=True)[:10]


class PolicyView(APIView):
    """GET policy/ — the send window and limits, the approval limit (read-only here), any proposal waiting, history.
    POST policy/ — propose a change. It goes to Super Admin; a Super Admin's own proposal applies at once."""

    def get_permissions(self):
        if self.request.method == "POST":
            return [HasRolePermission("campaigns.manage")]
        return [HasAnyRolePermission(*READ)]

    def get(self, request):
        return Response({
            "policy": policy_rules.serialize(),
            "threshold": overview_service._money(policy_rules.approval_threshold()),
            "threshold_meta": policy_rules.threshold_meta(),
            "pending": _pending_proposal(),
            "history": _history(),
            "can_propose": "campaigns.manage" in request.user.effective_permission_codenames(),
            "weekday_names": policy_rules.WEEKDAY_NAMES,
            "limits": {"earliest": f"{policy_rules.EARLIEST:%H:%M}", "latest": f"{policy_rules.LATEST:%H:%M}", "max_cap_days": policy_rules.MAX_CAP_DAYS},
        })

    def post(self, request):
        data = request.data if isinstance(request.data, dict) else {}
        try:
            clean = policy_rules.clean_proposal(data)
        except policy_rules.PolicyError as exc:
            return Response({"detail": exc.message}, status=status.HTTP_400_BAD_REQUEST)
        if _pending_proposal():
            return Response({"detail": "A change to the sending rules is already waiting for approval."}, status=status.HTTP_409_CONFLICT)
        try:
            approval = approvals.submit(
                request.user, SEND_POLICY, title="Change the marketing send window and limits",
                target_type="marketing.sendpolicy", target_id="1", target_label="Quiet hours and limits",
                payload=clean, maker_note=str(data.get("note", ""))[:500], request=request,
            )
        except approvals.ApprovalError as exc:
            return Response({"detail": exc.message}, status=getattr(exc, "status_code", 400))
        return Response({"approval_id": approval.pk, "status": approval.status}, status=status.HTTP_201_CREATED)
