"""Super Admin oversight of businesses (SA-5, screens 16 and 17): the header
counts, a CSV of the list, and the figures the one-page business detail adds
to the portfolio detail. Everything is read from records that exist; nothing
that has no table behind it (settlements, held money, on-time handover) is
returned."""
import csv

from django.conf import settings
from django.db.models import Avg, Count, DecimalField, Q, Sum
from django.http import StreamingHttpResponse
from django.utils import timezone
from rest_framework import generics
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import BusinessOwner
from accounts.permissions import HasRolePermission
from activity.services import record
from billing.clock import pause_enabled
from billing.models import Transaction
from disputes.models import Dispute
from fraud.models import FraudFlag
from messaging.models import Conversation
from orders.models import Order, OrderItem
from reports.exports import _Echo, escape_cell
from reviews.models import Review

from . import health
from .views import PORTFOLIO_MANAGE, _filtered_rows, _portfolio_sort_key

OPEN_DISPUTES = (Dispute.OPEN, Dispute.INVESTIGATING)


def payments_simulated():
    return settings.PAYMENTS_PROVIDER != "hubtel"


class BusinessCountsView(APIView):
    """GET /api/portfolio/businesses/counts/ — the Businesses header strip:
    live, KYC waiting, overdue, paused, at risk, fraud open, suspended. Over
    every business that is not rejected, whatever the list filters say."""

    def get_permissions(self):
        return [HasRolePermission(PORTFOLIO_MANAGE)]

    def get(self, request):
        now = timezone.now()
        owners = BusinessOwner.objects.exclude(kyc_status=BusinessOwner.REJECTED)
        rows = health.rate_all(owners, now)
        month_start = timezone.localtime(now).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        states = [row.subscription["state"] for row in rows]
        suspended = [row for row in rows if row.owner.is_suspended]
        fraud_names = sorted(row.owner.display_name for row in rows if row.owner.open_fraud_flags > 0)
        return Response({
            "total": len(rows),
            "live": sum(1 for row in rows if row.owner.kyc_status == BusinessOwner.VERIFIED and not row.owner.is_suspended),
            "activated_this_month": sum(
                1 for row in rows
                if row.owner.kyc_status == BusinessOwner.VERIFIED and row.owner.reviewed_at and row.owner.reviewed_at >= month_start
            ),
            "kyc_waiting": sum(1 for row in rows if row.owner.kyc_status == BusinessOwner.PENDING),
            "overdue": states.count("overdue"),
            "paused": states.count("paused"),
            "at_risk": sum(1 for row in rows if row.rating == health.AT_RISK),
            "fraud_open": len(fraud_names),
            "fraud_open_names": fraud_names[:3],
            "suspended": len(suspended),
            "pause_enabled": pause_enabled(),
        })


EXPORT_HEADER = [
    "Business", "Area", "KYC", "Suspended", "Plan", "Subscription", "Account manager", "Health",
    "Open fraud cases", "Open disputes", "Last order",
]


class BusinessExportView(APIView):
    """GET /api/portfolio/businesses/export/?<the list's filters> — a CSV of the
    filtered list. Business-level facts only: no owner name, phone or email,
    so it holds no personal data (and the export is recorded as such)."""

    def get_permissions(self):
        return [HasRolePermission(PORTFOLIO_MANAGE)]

    def get(self, request):
        now = timezone.now()
        rows = _filtered_rows(request, now)
        health_filter = request.query_params.get("health") or ""
        if health_filter in health.RATINGS:
            rows = [row for row in rows if row.rating == health_filter]
        rows.sort(key=_portfolio_sort_key)
        lines = []
        for row in rows:
            owner = row.owner
            profile = getattr(owner, "profile", None)
            zone = getattr(getattr(profile, "zone", None), "name", "") if profile is not None else ""
            lines.append([
                owner.display_name, zone, owner.get_kyc_status_display(), "Yes" if owner.is_suspended else "No",
                row.subscription.get("plan_name") or "", row.subscription["state"],
                owner.account_manager.full_name if owner.account_manager else "",
                row.rating, owner.open_fraud_flags, owner.open_disputes,
                timezone.localtime(owner.last_order_at).strftime("%Y-%m-%d") if owner.last_order_at else "",
            ])
        record(
            request.user, "report.exported", summary=f"Exported businesses ({len(lines)} rows)",
            after={"format": "csv", "kind": "businesses", "rows": len(lines), "personal_data": False,
                   "filters": {k: v for k, v in request.query_params.items() if v}},
            request=request,
        )

        def chunks():
            writer = csv.writer(_Echo())
            yield "﻿"
            yield writer.writerow(EXPORT_HEADER)
            for line in lines:
                yield writer.writerow([escape_cell(cell) for cell in line])

        response = StreamingHttpResponse(chunks(), content_type="text/csv; charset=utf-8")
        response["Content-Disposition"] = 'attachment; filename="businesses.csv"'
        return response


class BusinessOversightView(APIView):
    """GET /api/portfolio/businesses/<pk>/oversight/ — what the Super Admin
    business page adds to the portfolio detail: this month's sales from paid
    orders, the rating, disputes about the business, the owner's conversations
    with Support, the subscription and other payments. Money is labelled
    simulated while payments are."""

    def get_permissions(self):
        return [HasRolePermission(PORTFOLIO_MANAGE)]

    def get(self, request, pk):
        owner = generics.get_object_or_404(BusinessOwner, pk=pk)
        now = timezone.now()
        month_start = timezone.localtime(now).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        lines = OrderItem.objects.filter(listing__business_owner=owner, order__status=Order.PAID)
        month = lines.filter(order__placed_at__gte=month_start).aggregate(
            total=Sum("line_total", output_field=DecimalField()), orders=Count("order", distinct=True),
        )
        reviews = Review.objects.filter(business_owner=owner, target_type=Review.SELLER, status=Review.PUBLISHED)
        rating = reviews.aggregate(avg=Avg("rating"), count=Count("id"))
        order_filter = Q(order__items__listing__business_owner=owner)
        disputes = (
            Dispute.objects.filter(order_filter).distinct()
            .select_related("order", "raised_by", "resolved_by", "flagged_by").order_by("-created_at")
        )
        orders = (
            Order.objects.filter(status=Order.PAID, items__listing__business_owner=owner).distinct()
            .select_related("customer", "delivery_assignment__dispatch").prefetch_related("items__listing")
            .order_by("-placed_at", "-id")
        )
        total_orders = orders.count()
        conversations = Conversation.objects.filter(business_owner=owner).order_by("-updated_at")
        payments = Transaction.objects.filter(business_owner=owner).order_by("-created_at")
        return Response({
            "payments_simulated": payments_simulated(),
            "sales_month": {
                "amount": str(month["total"] or 0), "orders": month["orders"] or 0,
            },
            # A rating row is hidden when nobody has rated (CLAUDE.md): avg is None then.
            "rating": {"average": round(rating["avg"], 1) if rating["count"] else None, "count": rating["count"]},
            "open_disputes": sum(1 for d in disputes if d.status in OPEN_DISPUTES),
            "orders_total": total_orders,
            "orders": [
                {
                    "id": order.pk,
                    "customer": order.customer.full_name,
                    "amount": str(sum(i.line_total for i in order.items.all() if i.listing.business_owner_id == owner.pk)),
                    "status": order.status,
                    "delivery_status": order.delivery_status,
                    "delivery_method": order.delivery_method,
                    "rider": (
                        order.delivery_assignment.dispatch.full_name
                        if getattr(order, "delivery_assignment", None) and order.delivery_assignment.dispatch else None
                    ),
                    "placed_at": order.placed_at,
                }
                for order in orders[:10]
            ],
            "disputes": [
                {
                    "id": d.pk, "order": d.order_id, "reason": d.get_reason_display(), "status": d.status,
                    "customer": d.raised_by.full_name if d.raised_by else None,
                    "created_at": d.created_at, "updated_at": d.updated_at,
                    "resolved_by": d.resolved_by.full_name if d.resolved_by else None,
                    "refund_amount": str(d.refund_amount) if d.refund_amount is not None else None,
                }
                for d in disputes[:20]
            ],
            "conversations": [
                {"id": c.pk, "subject": c.subject, "status": c.status, "updated_at": c.updated_at}
                for c in conversations[:10]
            ],
            "payments": [
                {"id": t.pk, "purpose": t.purpose, "amount": str(t.amount), "status": t.status, "at": t.created_at, "reference": t.reference}
                for t in payments[:20]
            ],
            "open_fraud_flags": FraudFlag.objects.filter(business_owner=owner, status=FraudFlag.OPEN).count(),
        })
