"""Orders & deliveries (SA-5 screen 20). Only what the records hold: the order,
its lines and businesses, the simulated payment status, the delivery status
and the rider who was assigned, with the times the courier recorded. There is
no delivery fee, rider pay, cash-on-delivery or check-in-code field on an
order yet, so none is shown or invented."""
from datetime import datetime, time, timedelta

from django.db.models import Exists, OuterRef, Q, Sum
from django.utils import timezone
from rest_framework import generics
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import HasRolePermission
from disputes.models import Dispute
from orders.models import DeliveryAssignment, Order

from .common import OversightPagination, choice_param, csv_export

PERMISSION = "orders.manage_delivery"
PAYMENTS = tuple(code for code, _ in Order.STATUS_CHOICES)
DELIVERIES = tuple(code for code, _ in Order.DELIVERY_STATUS_CHOICES) + ("waiting_for_rider",)
OPEN_DISPUTES = (Dispute.OPEN, Dispute.INVESTIGATING)


def _start_of(day):
    return timezone.make_aware(datetime.combine(day, time.min))


def day_window(params):
    """(start, end) for ?day=today|yesterday|week|range&from=&to=, or None."""
    today = timezone.localdate()
    choice = params.get("day") or ""
    if choice == "today":
        return _start_of(today), _start_of(today + timedelta(days=1))
    if choice == "yesterday":
        return _start_of(today - timedelta(days=1)), _start_of(today)
    if choice == "week":
        return _start_of(today - timedelta(days=today.weekday())), _start_of(today + timedelta(days=1))
    if choice == "range":
        try:
            start = datetime.strptime(params.get("from") or "", "%Y-%m-%d").date()
            end = datetime.strptime(params.get("to") or "", "%Y-%m-%d").date()
        except ValueError:
            return None
        return _start_of(start), _start_of(end + timedelta(days=1))
    return None


def base_queryset():
    open_case = Dispute.objects.filter(order=OuterRef("pk"), status__in=OPEN_DISPUTES)
    return (
        Order.objects.select_related("customer", "delivery_assignment__dispatch")
        .prefetch_related("items__listing__business_owner__profile")
        .annotate(has_open_case=Exists(open_case))
    )


def filtered(request):
    params = request.query_params
    orders = base_queryset()
    payment = choice_param(params, "payment", PAYMENTS)
    if payment:
        orders = orders.filter(status=payment)
    delivery = choice_param(params, "delivery", DELIVERIES)
    if delivery == "waiting_for_rider":
        orders = orders.filter(
            status=Order.PAID, delivery_method=Order.DOOR_TO_DOOR, delivery_assignment__isnull=True,
        ).exclude(delivery_status=Order.DELIVERED)
    elif delivery:
        orders = orders.filter(delivery_status=delivery)
    if params.get("case") in ("1", "true"):
        orders = orders.filter(has_open_case=True)
    rider = params.get("rider") or ""
    if rider.isdecimal():
        orders = orders.filter(delivery_assignment__dispatch_id=int(rider))
    window = day_window(params)
    if window:
        orders = orders.filter(placed_at__gte=window[0], placed_at__lt=window[1])
    text = (params.get("q") or "").strip()
    if text:
        match = (
            Q(customer__full_name__icontains=text)
            | Q(items__listing__business_owner__profile__business_name__icontains=text)
            | Q(items__listing__business_owner__full_name__icontains=text)
        )
        number = text.lstrip("#")
        if number.isdecimal() and len(number) < 10:
            match |= Q(pk=int(number))
        orders = orders.filter(match).distinct()
    return orders.order_by("-placed_at", "-id")


def item(order):
    assignment = getattr(order, "delivery_assignment", None)
    lines = list(order.items.all())
    businesses = sorted({line.listing.business_owner.display_name for line in lines})
    return {
        "id": order.pk,
        "customer": order.customer.full_name,
        "businesses": businesses,
        "items": [{"name": line.listing.name, "quantity": line.quantity} for line in lines],
        "total": str(order.total_amount),
        "status": order.status,
        "delivery_status": order.delivery_status,
        "delivery_method": order.delivery_method,
        "placed_at": order.placed_at,
        "open_case": order.has_open_case,
        "rider": assignment.dispatch.full_name if assignment is not None and assignment.dispatch else None,
        "rider_id": assignment.dispatch_id if assignment is not None else None,
        "assignment_status": assignment.status if assignment is not None else None,
        "waiting_for_rider": (
            order.status == Order.PAID and order.delivery_method == Order.DOOR_TO_DOOR
            and assignment is None and order.delivery_status != Order.DELIVERED
        ),
    }


class OrderListView(generics.ListAPIView):
    """GET /api/marketplace/orders/?q=&payment=pending|paid|cancelled
    &delivery=processing|shipped|out_for_delivery|delivered|waiting_for_rider
    &case=1&rider=<staff id>&day=today|yesterday|week|range(&from=&to=)&page="""

    pagination_class = OversightPagination

    def get_permissions(self):
        return [HasRolePermission(PERMISSION)]

    def get_queryset(self):
        return filtered(self.request)

    def list(self, request, *args, **kwargs):
        page = self.paginate_queryset(self.get_queryset())
        return self.get_paginated_response([item(order) for order in page])


class OrderCountsView(APIView):
    """GET /api/marketplace/orders/counts/ — today's orders (paid), what is in
    flight and what was delivered today, from the couriers' recorded times."""

    def get_permissions(self):
        return [HasRolePermission(PERMISSION)]

    def get(self, request):
        today = timezone.localdate()
        start, end = _start_of(today), _start_of(today + timedelta(days=1))
        paid = Order.objects.filter(status=Order.PAID)
        todays = paid.filter(placed_at__gte=start, placed_at__lt=end)
        in_flight = paid.exclude(delivery_status=Order.DELIVERED).filter(delivery_method=Order.DOOR_TO_DOOR)
        waiting = in_flight.filter(delivery_assignment__isnull=True)
        return Response({
            "orders_today": todays.count(),
            "items_value_today": str(todays.aggregate(total=Sum("total_amount"))["total"] or "0.00"),
            "in_flight": in_flight.count(),
            "waiting_for_rider": waiting.count(),
            "delivered_today": DeliveryAssignment.objects.filter(delivered_at__gte=start, delivered_at__lt=end).count(),
            "with_open_case": Order.objects.filter(disputes__status__in=OPEN_DISPUTES).distinct().count(),
            # Everyone who has ever been assigned a delivery, for the Rider filter.
            "riders": [
                {"id": rider_id, "name": name}
                for rider_id, name in DeliveryAssignment.objects.filter(dispatch__isnull=False)
                .values_list("dispatch_id", "dispatch__full_name").distinct().order_by("dispatch__full_name")
            ],
        })


class OrderDetailView(APIView):
    """GET /api/marketplace/orders/<pk>/ — one order's lines and the courier's
    recorded times (assigned, picked up, delivered, confirmed by the customer)."""

    def get_permissions(self):
        return [HasRolePermission(PERMISSION)]

    def get(self, request, pk):
        order = generics.get_object_or_404(base_queryset(), pk=pk)
        assignment = getattr(order, "delivery_assignment", None)
        data = item(order)
        steps = [{"at": order.placed_at, "text": f"Placed ({order.get_status_display().lower()})"}]
        if assignment is not None:
            who = assignment.dispatch.full_name if assignment.dispatch else "a rider"
            by = f" by {assignment.assigned_by.full_name}" if assignment.assigned_by else ""
            steps.append({"at": assignment.assigned_at, "text": f"Assigned to {who}{by}"})
            if assignment.picked_up_at:
                steps.append({"at": assignment.picked_up_at, "text": "Picked up from the business"})
            if assignment.delivered_at:
                steps.append({"at": assignment.delivered_at, "text": "Delivered to the customer"})
            if assignment.confirmed_at:
                steps.append({"at": assignment.confirmed_at, "text": "Receipt confirmed by the customer"})
        data.update({
            "delivery_address": order.delivery_address,
            "lines": [
                {
                    "name": line.listing.name, "quantity": line.quantity, "line_total": str(line.line_total),
                    "business": line.listing.business_owner.display_name,
                }
                for line in order.items.all()
            ],
            "steps": steps,
            "notes": assignment.notes if assignment is not None else "",
        })
        return Response(data)


class OrderExportView(APIView):
    """GET /api/marketplace/orders/export/?<the list's filters> — a CSV of the
    filtered orders: numbers, businesses, totals and statuses. The customer is
    left out (no personal data)."""

    def get_permissions(self):
        return [HasRolePermission(PERMISSION)]

    def get(self, request):
        rows = []
        for order in filtered(request):
            row = item(order)
            rows.append([
                row["id"], row["placed_at"].strftime("%Y-%m-%d %H:%M"), "; ".join(row["businesses"]),
                "; ".join(f"{i['quantity']} x {i['name']}" for i in row["items"]), row["total"],
                row["status"], row["delivery_status"], row["delivery_method"], row["rider"] or "",
                "Yes" if row["open_case"] else "No",
            ])
        return csv_export(
            request, stem="orders", kind="orders", personal_data=False,
            filters={k: v for k, v in request.query_params.items() if v},
            header=["Order", "Placed", "Businesses", "Items", "Total (GH₵)", "Payment", "Delivery", "Method", "Rider", "Open case"],
            rows=rows,
        )
