from rest_framework import generics
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import HasAnyRolePermission, HasRolePermission

from .models import Dispute
from .serializers import DisputeResolveSerializer, DisputeSerializer


class DisputePagination(PageNumberPagination):
    page_size = 20


class DisputeListView(generics.ListAPIView):
    """GET /api/disputes/ — the staff dispute queue, every dispute
    regardless of status (a full reactive-triage queue, same convention as
    reviews.ReviewModerationListView / EscrowLedgerPanel's backing view).
    Viewable by a session holding EITHER disputes.flag (intake/triage,
    `support` role) OR disputes.resolve_financial (the `accountant` role
    that actually resolves the financial side) — same OR-gating pattern as
    EscrowLedgerPanel's escrow.view||escrow.release||escrow.refund
    (see CLAUDE.md's Escrow Ledger paragraph).
    """

    serializer_class = DisputeSerializer
    queryset = Dispute.objects.all().select_related("order", "raised_by", "flagged_by", "resolved_by")
    pagination_class = DisputePagination

    def get_permissions(self):
        return [HasAnyRolePermission("disputes.flag", "disputes.resolve_financial")]


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
