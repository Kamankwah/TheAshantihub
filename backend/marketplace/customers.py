"""Customers (SA-5 screen 18). Phones are masked in the list; showing one in
full is a password-protected, recorded action. There is no marketing-SMS
consent record anywhere (Customer.sms_notifications_enabled is a service-
message preference), so no consent column or filter exists."""
from datetime import timedelta

from django.db.models import Count, DecimalField, IntegerField, OuterRef, Q, Subquery, Sum
from django.db.models.functions import Coalesce
from django.utils import timezone
from rest_framework import generics
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import Customer
from accounts.permissions import HasRolePermission, RequiresSudo
from accounts.phones import filter_by_phone, mask_phone, phone_key
from activity.services import record
from disputes.models import Dispute
from orders.models import Order

from .common import OversightPagination, choice_param, csv_export

OPEN_DISPUTES = (Dispute.OPEN, Dispute.INVESTIGATING)


class _Count(Subquery):
    template = "(SELECT COUNT(*) FROM (%(subquery)s) AS counted)"
    output_field = IntegerField()


def annotated(customers):
    paid = Order.objects.filter(customer=OuterRef("pk"), status=Order.PAID)
    disputes = Dispute.objects.filter(raised_by=OuterRef("pk"))
    return customers.annotate(
        orders_count=_Count(paid.order_by().values("pk")),
        orders_spend=Coalesce(
            Subquery(
                paid.order_by().values("customer").annotate(total=Sum("total_amount")).values("total")[:1],
                output_field=DecimalField(),
            ),
            0, output_field=DecimalField(),
        ),
        disputes_count=_Count(disputes.order_by().values("pk")),
        open_disputes=_Count(disputes.filter(status__in=OPEN_DISPUTES).order_by().values("pk")),
        last_order_at=Subquery(paid.order_by("-placed_at").values("placed_at")[:1]),
    )


def filtered(request):
    params = request.query_params
    customers = annotated(Customer.objects.all())
    status = choice_param(params, "status", ("active", "suspended"))
    if status:
        customers = customers.filter(is_suspended=(status == "suspended"))
    case = choice_param(params, "case", ("open", "none"))
    if case == "open":
        customers = customers.filter(open_disputes__gt=0)
    elif case == "none":
        customers = customers.filter(open_disputes=0)
    text = (params.get("q") or "").strip()
    if text:
        match = Q(full_name__icontains=text) | Q(email__iexact=text)
        if phone_key(text):
            match |= Q(pk__in=filter_by_phone(Customer.objects.all(), "phone", text).values("pk"))
        # "#17" or "17": the customer who placed that order.
        number = text.lstrip("#")
        if number.isdecimal() and len(number) < 10:
            match |= Q(pk__in=Order.objects.filter(pk=int(number)).values("customer_id"))
        customers = customers.filter(match)
    return customers.order_by("full_name", "pk")


def item(customer):
    return {
        "id": customer.pk,
        "name": customer.full_name,
        "phone": mask_phone(customer.phone) if customer.phone else None,
        "joined_at": customer.created_at,
        "orders": customer.orders_count,
        "spend": str(customer.orders_spend),
        "disputes": customer.disputes_count,
        "open_disputes": customer.open_disputes,
        "last_order_at": customer.last_order_at,
        "is_suspended": customer.is_suspended,
        "suspension_reason": customer.suspension_reason,
    }


class CustomerListView(generics.ListAPIView):
    """GET /api/marketplace/customers/?q=&status=active|suspended&case=open|none&page="""

    pagination_class = OversightPagination

    def get_permissions(self):
        return [HasRolePermission("users.view")]

    def get_queryset(self):
        return filtered(self.request)

    def list(self, request, *args, **kwargs):
        page = self.paginate_queryset(self.get_queryset())
        return self.get_paginated_response([item(customer) for customer in page])


class CustomerCountsView(APIView):
    """GET /api/marketplace/customers/counts/ — the header strip."""

    def get_permissions(self):
        return [HasRolePermission("users.view")]

    def get(self, request):
        now = timezone.now()
        month_start = timezone.localtime(now).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        total = Customer.objects.count()
        ordered = (
            Order.objects.filter(status=Order.PAID, placed_at__gte=now - timedelta(days=90))
            .values("customer").distinct().count()
        )
        return Response({
            "total": total,
            "joined_this_month": Customer.objects.filter(created_at__gte=month_start).count(),
            "ordered_90_days": ordered,
            "with_open_case": Dispute.objects.filter(status__in=OPEN_DISPUTES, raised_by__isnull=False)
            .values("raised_by").distinct().count(),
            "suspended": Customer.objects.filter(is_suspended=True).count(),
        })


class CustomerDetailView(APIView):
    """GET /api/marketplace/customers/<pk>/ — the side panel: recent orders and
    every dispute the customer raised. The phone stays masked."""

    def get_permissions(self):
        return [HasRolePermission("users.view")]

    def get(self, request, pk):
        customer = generics.get_object_or_404(annotated(Customer.objects.all()), pk=pk)
        orders = Order.objects.filter(customer=customer).prefetch_related("items__listing__business_owner").order_by("-placed_at")[:8]
        disputes = Dispute.objects.filter(raised_by=customer).select_related("order").order_by("-created_at")[:10]
        data = item(customer)
        data.update({
            "email": customer.email,
            "orders_recent": [
                {
                    "id": order.pk, "total": str(order.total_amount), "status": order.status,
                    "delivery_status": order.delivery_status, "placed_at": order.placed_at,
                    "businesses": sorted({line.listing.business_owner.display_name for line in order.items.all()}),
                }
                for order in orders
            ],
            "disputes_recent": [
                {"id": d.pk, "order": d.order_id, "reason": d.get_reason_display(), "status": d.status, "created_at": d.created_at}
                for d in disputes
            ],
        })
        return Response(data)


class CustomerRevealPhoneView(APIView):
    """POST /api/marketplace/customers/<pk>/reveal-phone/ — the full phone,
    after the password is asked again; the reveal is recorded (who, whose),
    never the number."""

    def get_permissions(self):
        return [HasRolePermission("users.view"), RequiresSudo()]

    def post(self, request, pk):
        customer = generics.get_object_or_404(Customer, pk=pk)
        record(
            request.user, "customer.phone_revealed", target=customer, method="POST",
            summary=f"Showed the full phone of {customer.full_name}", request=request,
        )
        return Response({"phone": customer.phone})


class CustomerExportView(APIView):
    """GET /api/marketplace/customers/export/?<the list's filters> — personal
    data (names, phones, emails): users.manage and the password again; the
    export is recorded as holding personal data."""

    def get_permissions(self):
        return [HasRolePermission("users.manage"), RequiresSudo()]

    def get(self, request):
        customers = filtered(request)
        rows = [
            [
                c.full_name, c.phone or "", c.email or "", c.created_at.strftime("%Y-%m-%d"), c.orders_count,
                c.orders_spend, c.disputes_count, c.open_disputes,
                c.last_order_at.strftime("%Y-%m-%d") if c.last_order_at else "",
                "Suspended" if c.is_suspended else "Active",
            ]
            for c in customers
        ]
        return csv_export(
            request, stem="customers", kind="customers", personal_data=True,
            filters={k: v for k, v in request.query_params.items() if v},
            header=["Name", "Phone", "Email", "Joined", "Paid orders", "Spent (GH₵)", "Disputes", "Open disputes", "Last order", "Status"],
            rows=rows,
        )
