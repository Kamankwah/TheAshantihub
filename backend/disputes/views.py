from rest_framework import generics
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import HasAnyRolePermission, HasRolePermission

from .models import Dispute
from .serializers import DisputeResolveSerializer, DisputeSerializer


class DisputePagination(PageNumberPagination):
    page_size = 20


# Disputes have four states but the queue shows three tabs. `open` and
# `investigating` both mean "still being worked", so they share the Pending
# tab — the row itself shows which of the two it is. `resolved` is the
# Approved-equivalent and `rejected` its counterpart.
DISPUTE_STATUS_MAP = {
    "pending": [Dispute.OPEN, Dispute.INVESTIGATING],
    "approved": [Dispute.RESOLVED],
    "rejected": [Dispute.REJECTED],
}


class DisputeListView(generics.ListAPIView):
    """GET /api/disputes/?status=pending|approved|rejected — the staff dispute
    queue, restructured onto Pending/Approved/Rejected tabs (punch-list item
    7). Defaults to pending; an unknown value falls back to pending.

    Viewable by a session holding EITHER disputes.flag (intake/triage,
    `support` role) OR disputes.resolve_financial (the `accountant` role
    that actually resolves the financial side) — same OR-gating pattern as
    EscrowLedgerPanel's escrow.view||escrow.release||escrow.refund
    (see CLAUDE.md's Escrow Ledger paragraph).
    """

    serializer_class = DisputeSerializer
    pagination_class = DisputePagination

    def get_permissions(self):
        return [HasAnyRolePermission("disputes.flag", "disputes.resolve_financial")]

    def get_queryset(self):
        tab = self.request.query_params.get("status", "pending")
        statuses = DISPUTE_STATUS_MAP.get(tab, DISPUTE_STATUS_MAP["pending"])
        queryset = Dispute.objects.filter(status__in=statuses).select_related(
            "order", "raised_by", "flagged_by", "resolved_by"
        )
        if tab == "pending" or tab not in DISPUTE_STATUS_MAP:
            # A work queue — oldest first.
            return queryset.order_by("created_at")
        # History — most recently actioned first. A dispute in a final state
        # can't be re-actioned, so updated_at IS its resolution time.
        return queryset.order_by("-updated_at")


class DisputeFlagView(APIView):
    """POST /api/disputes/{id}/flag/ — requires disputes.flag. Moves a
    dispute into `investigating` and records who flagged it. A dispute
    already in a final state (resolved/rejected) cannot be re-flagged —
    mirrors ContactMessage's "resolved is final" rule, extended to both of
    Dispute's two final states.
    """

    def get_permissions(self):
        return [HasRolePermission("disputes.flag")]

    def post(self, request, pk):
        dispute = generics.get_object_or_404(Dispute, pk=pk)
        if dispute.status in Dispute.FINAL_STATUSES:
            return Response(
                {"detail": "This dispute has already been resolved and cannot be re-flagged."},
                status=400,
            )
        dispute.status = Dispute.INVESTIGATING
        dispute.flagged_by = request.user
        dispute.save(update_fields=["status", "flagged_by", "updated_at"])
        return Response(DisputeSerializer(dispute).data)


class DisputeResolveView(APIView):
    """POST /api/disputes/{id}/resolve/ — requires disputes.resolve_financial.
    Body: optional refund_amount, resolution_notes, and outcome ("resolved"
    default, or "rejected"). A dispute already in a final state cannot be
    re-actioned here (mirrors ContactMessage's "resolved is final" rule).
    """

    def get_permissions(self):
        return [HasRolePermission("disputes.resolve_financial")]

    def post(self, request, pk):
        dispute = generics.get_object_or_404(Dispute, pk=pk)
        if dispute.status in Dispute.FINAL_STATUSES:
            return Response({"detail": "This dispute has already been resolved."}, status=400)

        serializer = DisputeResolveSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        dispute.status = Dispute.RESOLVED if data["outcome"] == "resolved" else Dispute.REJECTED
        dispute.refund_amount = data.get("refund_amount")
        dispute.resolution_notes = data.get("resolution_notes", "")
        dispute.resolved_by = request.user
        dispute.save(
            update_fields=["status", "refund_amount", "resolution_notes", "resolved_by", "updated_at"]
        )
        return Response(DisputeSerializer(dispute).data)


class DisputeReReviewView(APIView):
    """POST /api/disputes/{id}/re-review/ — reopens a rejected dispute,
    clearing the rejection and returning it to the Pending tab.

    This is the one deliberate exception to the "a final dispute cannot be
    re-actioned" rule enforced by DisputeFlagView/DisputeResolveView: a
    wrongly-rejected dispute would otherwise be unrecoverable. Only `rejected`
    can be reopened — a *resolved* dispute may have moved money (refund_amount),
    so reopening it is not a safe no-op and is not offered.

    Gated on disputes.resolve_financial rather than the broader
    disputes.flag — reversing a rejection is the financial side's call.
    """

    def get_permissions(self):
        return [HasRolePermission("disputes.resolve_financial")]

    def post(self, request, pk):
        dispute = generics.get_object_or_404(Dispute, pk=pk)
        if dispute.status != Dispute.REJECTED:
            return Response(
                {"detail": "Only a rejected dispute can be reopened."}, status=400
            )
        dispute.status = Dispute.OPEN
        dispute.resolution_notes = ""
        dispute.resolved_by = None
        dispute.save(
            update_fields=["status", "resolution_notes", "resolved_by", "updated_at"]
        )
        return Response(DisputeSerializer(dispute).data)
