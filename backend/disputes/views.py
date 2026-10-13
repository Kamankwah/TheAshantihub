from datetime import timedelta

from django.db import transaction
from django.utils import timezone
from rest_framework import generics
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import HasAnyRolePermission, HasRolePermission, RequiresSudo

from messaging.models import Conversation
from notifications.services import notify_customer, notify_staff_role
from orders.models import Order

from .models import Dispute, DisputeEvidence
from .serializers import (
    DisputeDetailSerializer, DisputeEvidenceInputSerializer, DisputeEvidenceSerializer,
    DisputeIntakeSerializer, DisputeLogSerializer, DisputeResolveSerializer, DisputeSerializer,
    DisputeStaffSerializer,
)


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

    serializer_class = DisputeStaffSerializer
    pagination_class = DisputePagination

    def get_permissions(self):
        return [HasAnyRolePermission("disputes.flag", "disputes.resolve_financial")]

    def get_queryset(self):
        tab = self.request.query_params.get("status", "pending")
        statuses = DISPUTE_STATUS_MAP.get(tab, DISPUTE_STATUS_MAP["pending"])
        queryset = Dispute.objects.filter(status__in=statuses).select_related(
            "order__customer", "raised_by", "flagged_by", "resolved_by", "logged_by", "conversation"
        ).prefetch_related("order__items__listing__business_owner__profile")
        order = self.request.query_params.get("order")
        if order and order.isdecimal():
            queryset = queryset.filter(order_id=int(order))
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
        summary = str(request.data.get("intake_summary") or "").strip()
        with transaction.atomic():
            dispute = generics.get_object_or_404(Dispute.objects.select_for_update(), pk=pk)
            if dispute.status in Dispute.FINAL_STATUSES:
                return Response(
                    {"detail": "This dispute has already been resolved and cannot be re-flagged."},
                    status=400,
                )
            summary = summary or dispute.intake_summary.strip()
            if not summary:
                return Response({"intake_summary": "Write a summary for Accounting before flagging."}, status=400)
            dispute.intake_summary = summary
            dispute.status = Dispute.INVESTIGATING
            dispute.flagged_by = request.user
            dispute.save(update_fields=["status", "flagged_by", "intake_summary", "updated_at"])
        notify_staff_role(
            "disputes.resolve_financial", "dispute_flagged", "Dispute flagged for investigation",
            body=f"Dispute #{dispute.pk} was flagged by Support.", link="disputes", icon="⚖️",
        )
        return Response(DisputeStaffSerializer(dispute).data)


class DisputeResolveView(APIView):
    """POST /api/disputes/{id}/resolve/ — requires disputes.resolve_financial.
    Body: optional refund_amount, resolution_notes, and outcome ("resolved"
    default, or "rejected"). A dispute already in a final state cannot be
    re-actioned here (mirrors ContactMessage's "resolved is final" rule).
    """

    def get_permissions(self):
        # A resolution can refund money, so the password is asked again.
        return [HasRolePermission("disputes.resolve_financial"), RequiresSudo()]

    def post(self, request, pk):
        serializer = DisputeResolveSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        # Two staff resolving at once must not both book a refund: lock the row.
        with transaction.atomic():
            dispute = generics.get_object_or_404(Dispute.objects.select_for_update(), pk=pk)
            if dispute.status in Dispute.FINAL_STATUSES:
                return Response({"detail": "This dispute has already been resolved."}, status=400)
            dispute.status = Dispute.RESOLVED if data["outcome"] == "resolved" else Dispute.REJECTED
            # A rejected dispute never moves money: drop any refund_amount sent
            # with outcome="rejected" so a Rejected row can't show a refund.
            dispute.refund_amount = data.get("refund_amount") if data["outcome"] == "resolved" else None
            dispute.resolution_notes = data.get("resolution_notes", "")
            dispute.resolved_by = request.user
            dispute.save(
                update_fields=["status", "refund_amount", "resolution_notes", "resolved_by", "updated_at"]
            )
            # A full refund of the order also reverses the delivery fee its business covered through a
            # free-delivery promo; a partial one leaves that charge standing.
            if dispute.order_id and dispute.refund_amount and dispute.refund_amount >= dispute.order.total_amount:
                from marketing.waivers import reverse_for_order

                reverse_for_order(dispute.order, "order_refunded")
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


def _detail_queryset():
    return Dispute.objects.select_related(
        "order__customer", "raised_by", "flagged_by", "resolved_by", "logged_by", "conversation"
    ).prefetch_related("order__items__listing__business_owner__profile", "evidence__added_by")


class DisputeDetailView(APIView):
    """GET /api/disputes/<id>/ — one dispute with its evidence and the records
    that attach themselves."""

    def get_permissions(self):
        return [HasAnyRolePermission("disputes.flag", "disputes.resolve_financial")]

    def get(self, request, pk):
        dispute = generics.get_object_or_404(_detail_queryset(), pk=pk)
        return Response(DisputeDetailSerializer(dispute, context={"request": request}).data)


class DisputeCountsView(APIView):
    """GET /api/disputes/counts/ — the header line on Dispute intake."""

    def get_permissions(self):
        return [HasAnyRolePermission("disputes.flag", "disputes.resolve_financial")]

    def get(self, request):
        week = timezone.now() - timedelta(days=7)
        return Response({
            "needs_intake": Dispute.objects.filter(status=Dispute.OPEN).count(),
            "with_accounting": Dispute.objects.filter(status=Dispute.INVESTIGATING).count(),
            "decided_this_week": Dispute.objects.filter(status__in=Dispute.FINAL_STATUSES, updated_at__gte=week).count(),
        })


def _conversation_for(customer, conversation_id):
    """The conversation a dispute may link to: one of the dispute's own
    customer's. Returns (conversation, error)."""
    conversation = Conversation.objects.filter(pk=conversation_id).first()
    if conversation is None or customer is None or conversation.customer_id != customer.pk:
        return None, "That conversation is not with this dispute's customer."
    return conversation, None


class DisputeIntakeView(APIView):
    """PATCH /api/disputes/<id>/intake/ — Support records what went wrong, what
    the customer asks for, the summary for Accounting and the linked
    conversation. Only while the dispute is still open (before it is flagged)."""

    http_method_names = ["patch", "options"]

    def get_permissions(self):
        return [HasRolePermission("disputes.flag")]

    def patch(self, request, pk):
        serializer = DisputeIntakeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        with transaction.atomic():
            dispute = generics.get_object_or_404(Dispute.objects.select_for_update(of=("self",)), pk=pk)
            if dispute.status != Dispute.OPEN:
                return Response({"detail": "Intake closes once the dispute is flagged."}, status=409)
            if "conversation" in data:
                if data["conversation"] is None:
                    dispute.conversation = None
                else:
                    customer = dispute.raised_by or (dispute.order.customer if dispute.order_id else None)
                    dispute.conversation, error = _conversation_for(customer, data["conversation"])
                    if error:
                        return Response({"conversation": error}, status=400)
            for field in ("problem_type", "customer_ask", "intake_summary"):
                if field in data:
                    setattr(dispute, field, data[field])
            dispute.save()
        dispute = generics.get_object_or_404(_detail_queryset(), pk=pk)
        return Response(DisputeDetailSerializer(dispute, context={"request": request}).data)


class DisputeEvidenceAddView(APIView):
    """POST /api/disputes/<id>/evidence/ — add a note or a file. Append-only:
    there is no edit or delete route."""

    parser_classes = [JSONParser, MultiPartParser, FormParser]

    def get_permissions(self):
        return [HasRolePermission("disputes.flag")]

    def post(self, request, pk):
        serializer = DisputeEvidenceInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        with transaction.atomic():
            dispute = generics.get_object_or_404(Dispute.objects.select_for_update(of=("self",)), pk=pk)
            if dispute.status in Dispute.FINAL_STATUSES:
                return Response({"detail": "This dispute is decided; evidence can no longer be added."}, status=409)
            evidence = DisputeEvidence.objects.create(
                dispute=dispute, kind=DisputeEvidence.FILE if data.get("file") else DisputeEvidence.NOTE,
                title=data["title"].strip(), body=data.get("body", "").strip(), file=data.get("file"),
                added_by=request.user,
            )
        return Response(DisputeEvidenceSerializer(evidence, context={"request": request}).data, status=201)


class DisputeLogView(APIView):
    """POST /api/disputes/log/ {order, description, problem_type?, customer_ask?,
    intake_summary?, conversation?} — Support logs a dispute for an order on the
    customer's behalf (for example after a call). raised_by stays empty; the
    row says it was logged by staff, and the customer is told in-app."""

    def get_permissions(self):
        return [HasRolePermission("disputes.flag")]

    def post(self, request):
        serializer = DisputeLogSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        order = Order.objects.select_related("customer").filter(pk=data["order"]).first()
        if order is None:
            return Response({"order": "No such order."}, status=400)
        conversation = None
        if data.get("conversation"):
            conversation, error = _conversation_for(order.customer, data["conversation"])
            if error:
                return Response({"conversation": error}, status=400)
        problem = data.get("problem_type", "")
        dispute = Dispute.objects.create(
            order=order, logged_by=request.user, reason=Dispute.REASON_FOR_PROBLEM.get(problem, Dispute.OTHER),
            description=data["description"], problem_type=problem, customer_ask=data.get("customer_ask", ""),
            intake_summary=data.get("intake_summary", ""), conversation=conversation, status=Dispute.OPEN,
        )
        notify_customer(
            order.customer, "dispute_logged", "We opened a dispute on your order",
            body=f"AshantiHub Support opened a dispute about your order #{order.pk} for you.",
            link="/my-account", icon="⚖️",
        )
        from orders.views import _task_the_account_managers

        _task_the_account_managers(dispute)
        dispute = generics.get_object_or_404(_detail_queryset(), pk=dispute.pk)
        return Response(DisputeDetailSerializer(dispute, context={"request": request}).data, status=201)
