"""Commission API (spec S8). A scout reads only their own statement; Accounting
and Super Admin read every record and export it. Amounts are strings of Decimal
GH₵; no payout number or customer detail appears anywhere here."""
import csv
from decimal import Decimal

from django.db.models import Count, Sum
from django.http import StreamingHttpResponse
from django.utils import timezone
from rest_framework import status
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import BusinessOwner
from accounts.permissions import HasAnyRolePermission, HasRolePermission
from activity.services import record
from approvals import services as approvals
from approvals.models import ApprovalRequest
from billing.clock import day_number
from reports.exports import ExportNegotiation, escape_cell

from . import services
from .approval_kinds import KEY as POLICY_KIND
from .models import CommissionAccrual, CommissionPolicy

VIEW_OWN, VIEW_ALL, POLICY = "commission.view_own", "commission.view_all", "commission.policy"
BONUS_ROWS = 10


class Pagination(PageNumberPagination):
    page_size = 4
    page_size_query_param = "page_size"
    max_page_size = 100


def money(value):
    return str((value or Decimal("0")).quantize(Decimal("0.01")))


def line(accrual, *, with_staff=False):
    row = {
        "id": accrual.pk,
        "business": accrual.business_owner.display_name,
        "business_id": accrual.business_owner_id,
        "kind": accrual.kind,
        "kind_label": accrual.get_kind_display(),
        "amount": money(accrual.amount),
        "status": accrual.status,
        "status_label": accrual.get_status_display(),
        "earned_at": accrual.earned_at,
        "hold_until": accrual.hold_until,
        "reversed_reason": accrual.reversed_reason or None,
        "reversed_label": services.REVERSAL_LABELS.get(accrual.reversed_reason),
        "reversed_at": accrual.reversed_at,
    }
    if with_staff:
        row["staff"] = accrual.staff.full_name
        row["staff_id"] = accrual.staff_id
    return row


def totals(queryset):
    out = {}
    for status_value, _label in CommissionAccrual.STATUS_CHOICES:
        out[status_value] = {"amount": "0.00", "count": 0, "registrations": 0, "bonuses": 0}
    for row in queryset.values("status").annotate(total=Sum("amount"), n=Count("id")):
        out[row["status"]].update(amount=money(row["total"]), count=row["n"])
    for row in queryset.values("status", "kind").annotate(n=Count("id")):
        key = "registrations" if row["kind"] == CommissionPolicy.REGISTRATION else "bonuses"
        out[row["status"]][key] = row["n"]
    reasons = {}
    for row in queryset.filter(status=CommissionAccrual.REVERSED).values("reversed_reason").annotate(n=Count("id")):
        reasons[services.REVERSAL_LABELS.get(row["reversed_reason"], row["reversed_reason"] or "other")] = row["n"]
    out["reversed"]["reasons"] = reasons
    return out


def policy_amounts():
    out = {}
    for kind, _label in CommissionPolicy.KIND_CHOICES:
        policy = services.policy_in_force(kind)
        out[kind] = {"amount": money(policy.amount), "effective_from": policy.effective_from} if policy else None
    return out


def bonus_rows(staff, now):
    """The managed businesses whose bonus has not been earned yet, nearest to 3 paid months first."""
    from billing.models import Subscription

    earned = set(CommissionAccrual.objects.filter(kind=CommissionPolicy.BONUS).values_list("business_owner_id", flat=True))
    owners = list(
        BusinessOwner.objects.filter(account_manager=staff).exclude(pk__in=earned).select_related("profile", "subscription")
    )
    months = services.paid_months_by_owner([o.pk for o in owners])
    rows = []
    for owner in owners:
        sub = getattr(owner, "subscription", None)
        if sub is None:
            state = {"kind": "none"}
        elif sub.is_trial:
            state = {"kind": "trial_until", "date": sub.current_period_end}
        elif sub.overdue_since:
            state = {"kind": "overdue", "day": day_number(sub.overdue_since, now)}
        else:
            state = {"kind": "next_renewal", "date": sub.current_period_end}
        rows.append({"business": owner.display_name, "business_id": owner.pk, "paid_months": min(months[owner.pk], 3), "state": state})
    rows.sort(key=lambda r: (-r["paid_months"], r["business"]))
    return rows[:BONUS_ROWS], max(0, len(rows) - BONUS_ROWS)


class MyCommissionView(APIView):
    """GET /api/commission/me/[?page=&page_size=] — the caller's own statement."""

    def get_permissions(self):
        return [HasRolePermission(VIEW_OWN)]

    def get(self, request):
        mine = CommissionAccrual.objects.filter(staff=request.user)
        now = timezone.now()
        first = mine.order_by("earned_at").values_list("earned_at", flat=True).first()
        start = timezone.localtime(first).date().replace(day=1) if first else timezone.localdate().replace(day=1)
        paginator = Pagination()
        page = paginator.paginate_queryset(mine.select_related("business_owner__profile").order_by("-earned_at", "-id"), request, view=self)
        bonus, more = bonus_rows(request.user, now)
        body = paginator.get_paginated_response([line(a) for a in page]).data
        body.update({
            "statement": {"from": start, "to": timezone.localdate()},
            "totals": totals(mine),
            "bonus": bonus,
            "bonus_more": more,
            "policy": policy_amounts(),
        })
        return Response(body)


class AccrualsView(APIView):
    """GET /api/commission/accruals/[?status=&staff=&format=csv] — every record."""

    content_negotiation_class = ExportNegotiation

    def get_permissions(self):
        return [HasRolePermission(VIEW_ALL)]

    def get(self, request):
        queryset = CommissionAccrual.objects.select_related("business_owner__profile", "staff")
        params = request.query_params
        if params.get("status") in dict(CommissionAccrual.STATUS_CHOICES):
            queryset = queryset.filter(status=params["status"])
        if params.get("staff", "").isdecimal() and len(params["staff"]) < 10:
            queryset = queryset.filter(staff_id=int(params["staff"]))
        queryset = queryset.order_by("-earned_at", "-id")
        if params.get("format") == "csv":
            return export_csv(request, queryset)
        paginator = Pagination()
        paginator.page_size = 25
        page = paginator.paginate_queryset(queryset, request, view=self)
        body = paginator.get_paginated_response([line(a, with_staff=True) for a in page]).data
        body["totals"] = totals(queryset)
        return Response(body)


class _Echo:
    def write(self, value):
        return value


CSV_COLUMNS = ["Staff", "Business", "Kind", "Amount (GH₵)", "Status", "Earned", "Held until", "Reversed reason"]


def export_csv(request, queryset):
    def rows():
        writer = csv.writer(_Echo())
        yield "﻿"
        yield writer.writerow(CSV_COLUMNS)
        for a in queryset.iterator():
            yield writer.writerow([escape_cell(v) for v in [
                a.staff.full_name, a.business_owner.display_name, a.get_kind_display(), money(a.amount), a.get_status_display(),
                timezone.localtime(a.earned_at).strftime("%Y-%m-%d"), timezone.localtime(a.hold_until).strftime("%Y-%m-%d"),
                services.REVERSAL_LABELS.get(a.reversed_reason, ""),
            ]])

    record(request.user, "commission.exported", summary="Commission records exported (CSV)", after={"rows": queryset.count()}, request=request)
    response = StreamingHttpResponse(rows(), content_type="text/csv; charset=utf-8")
    response["Content-Disposition"] = 'attachment; filename="commission.csv"'
    return response


def _pending():
    return [
        {
            "id": r.pk, "kind": r.payload.get("kind"), "amount": r.payload.get("amount"),
            "effective_from": r.payload.get("effective_from"), "maker": r.maker.full_name, "created_at": r.created_at,
        }
        for r in ApprovalRequest.objects.filter(kind=POLICY_KIND, status=ApprovalRequest.PENDING).select_related("maker").order_by("-pk")
    ]


class PoliciesView(APIView):
    """GET policies/ — the amounts in force, history and proposals waiting for
    a Super Admin. POST policies/ {kind, amount, effective_from, note} — propose
    a new amount (maker-checker; a Super Admin's own change applies at once)."""

    def get_permissions(self):
        if self.request.method == "POST":
            return [HasRolePermission(POLICY)]
        return [HasAnyRolePermission(VIEW_ALL, POLICY)]

    def get(self, request):
        history = CommissionPolicy.objects.select_related("proposed_by", "approved_by").order_by("-effective_from", "-id")[:20]
        return Response({
            "current": policy_amounts(),
            "pending": _pending(),
            "history": [
                {"kind": p.kind, "kind_label": p.get_kind_display(), "amount": money(p.amount), "effective_from": p.effective_from,
                 "proposed_by": p.proposed_by.full_name, "approved_by": p.approved_by.full_name}
                for p in history
            ],
        })

    def post(self, request):
        data = request.data if isinstance(request.data, dict) else {}
        try:
            kind, amount, day = services.clean_proposal(data.get("kind"), data.get("amount"), data.get("effective_from"))
        except services.PolicyError as exc:
            return Response({"detail": exc.message}, status=exc.status_code)
        if ApprovalRequest.objects.filter(
            kind=POLICY_KIND, status=ApprovalRequest.PENDING, payload__kind=kind
        ).exists():
            return Response({"detail": "A change to this amount is already waiting for approval."}, status=status.HTTP_409_CONFLICT)
        label = dict(CommissionPolicy.KIND_CHOICES)[kind]
        try:
            approval = approvals.submit(
                request.user, POLICY_KIND, title=f"Commission: {label} to GH₵ {amount}",
                target_type="commission.policy", target_id=kind, target_label=label,
                payload={"kind": kind, "amount": str(amount), "effective_from": day.isoformat()},
                maker_note=str(data.get("note", ""))[:500], request=request,
            )
        except approvals.ApprovalError as exc:
            return Response({"detail": exc.message}, status=getattr(exc, "status_code", 400))
        return Response({"approval_id": approval.pk, "status": approval.status}, status=status.HTTP_201_CREATED)
