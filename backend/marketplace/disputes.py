"""Disputes & returns (SA-5 screen 22), across teams, from the dispute records.
A dispute has four states, so only the stages those states support are shown:
open (with Support, intake), investigating (with Accounting, who decide the
refund) and closed. There are no returns, no answer-due timers and no Delivery
stage yet, so none is invented."""
from django.db.models import Count, Q, Sum
from django.utils import timezone
from rest_framework import generics
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import HasAnyRolePermission
from disputes.models import Dispute
from disputes.serializers import DisputeSerializer

from .common import OversightPagination, choice_param, csv_export

PERMISSIONS = ("disputes.flag", "disputes.resolve_financial")
TEAMS = ("support", "accounting")
REASONS = tuple(code for code, _ in Dispute.REASON_CHOICES)
SCOPES = ("open", "closed", "all")
TEAM_OF = {Dispute.OPEN: ("support", "Support", "Intake"), Dispute.INVESTIGATING: ("accounting", "Accounting", "Decision")}


def base_queryset():
    return Dispute.objects.select_related("order__customer", "raised_by", "flagged_by", "resolved_by").prefetch_related(
        "order__items__listing__business_owner__profile",
    )


def filtered(request):
    params = request.query_params
    disputes = base_queryset()
    scope = choice_param(params, "scope", SCOPES) or "open"
    if scope == "open":
        disputes = disputes.filter(status__in=[Dispute.OPEN, Dispute.INVESTIGATING])
    elif scope == "closed":
        disputes = disputes.filter(status__in=Dispute.FINAL_STATUSES)
    team = choice_param(params, "team", TEAMS)
    if team == "support":
        disputes = disputes.filter(status=Dispute.OPEN)
    elif team == "accounting":
        disputes = disputes.filter(status=Dispute.INVESTIGATING)
    reason = choice_param(params, "reason", REASONS)
    if reason:
        disputes = disputes.filter(reason=reason)
    business = params.get("business") or ""
    if business.isdecimal():
        disputes = disputes.filter(order__items__listing__business_owner_id=int(business)).distinct()
    text = (params.get("q") or "").strip()
    if text:
        match = Q(raised_by__full_name__icontains=text) | Q(description__icontains=text)
        number = text.lstrip("#")
        if number.isdecimal() and len(number) < 10:
            match |= Q(pk=int(number)) | Q(order_id=int(number))
        disputes = disputes.filter(match)
    # Open work: oldest first; history: latest first.
    return disputes.order_by("created_at" if scope == "open" else "-updated_at", "id")


def item(dispute):
    data = dict(DisputeSerializer(dispute).data)
    team, team_label, stage = TEAM_OF.get(dispute.status, (None, None, "Closed"))
    businesses = []
    if dispute.order_id:
        businesses = sorted({line.listing.business_owner.display_name for line in dispute.order.items.all()})
    data.update({
        "reason_label": dispute.get_reason_display(),
        "team": team,
        "team_label": team_label,
        "stage": stage,
        "businesses": businesses,
        "at_stake": data["order_total_amount"] if dispute.status in TEAM_OF else None,
    })
    return data


class DisputeListView(generics.ListAPIView):
    """GET /api/marketplace/disputes/?scope=open|closed|all&team=support|accounting
    &reason=&business=<id>&q=&page="""

    pagination_class = OversightPagination

    def get_permissions(self):
        return [HasAnyRolePermission(*PERMISSIONS)]

    def get_queryset(self):
        return filtered(self.request)

    def list(self, request, *args, **kwargs):
        page = self.paginate_queryset(self.get_queryset())
        return self.get_paginated_response([item(dispute) for dispute in page])


class DisputeCountsView(APIView):
    def get_permissions(self):
        return [HasAnyRolePermission(*PERMISSIONS)]

    def get(self, request):
        local = timezone.localtime()
        today = local.replace(hour=0, minute=0, second=0, microsecond=0)
        month_start = today.replace(day=1)
        disputes = Dispute.objects.all()
        open_ = disputes.filter(status__in=[Dispute.OPEN, Dispute.INVESTIGATING])
        stake = open_.filter(order__isnull=False).aggregate(total=Sum("order__total_amount"))["total"]
        return Response({
            "open": open_.count(),
            "opened_today": open_.filter(created_at__gte=today).count(),
            "with_support": disputes.filter(status=Dispute.OPEN).count(),
            "with_accounting": disputes.filter(status=Dispute.INVESTIGATING).count(),
            "closed_this_month": disputes.filter(status__in=Dispute.FINAL_STATUSES, updated_at__gte=month_start).count(),
            "order_value_at_stake": str(stake or "0.00"),
        })


class DisputeExportView(APIView):
    """GET /api/marketplace/disputes/export/?<the list's filters> — CSV with no
    customer names or descriptions (no personal data)."""

    def get_permissions(self):
        return [HasAnyRolePermission(*PERMISSIONS)]

    def get(self, request):
        rows = []
        for dispute in filtered(request):
            row = item(dispute)
            rows.append([
                row["id"], row["order"] or "", "; ".join(row["businesses"]), row["reason_label"], row["status"],
                row["team_label"] or "", row["stage"], row["at_stake"] or "", row["refund_amount"] or "",
                dispute.created_at.strftime("%Y-%m-%d"), dispute.updated_at.strftime("%Y-%m-%d"),
            ])
        return csv_export(
            request, stem="disputes", kind="disputes", personal_data=False,
            filters={k: v for k, v in request.query_params.items() if v},
            header=["Case", "Order", "Businesses", "Reason", "Status", "With", "Stage", "Order total (GH₵)", "Refund (GH₵)", "Opened", "Last change"],
            rows=rows,
        )
