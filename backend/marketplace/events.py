"""Events & tickets (SA-5 screen 21): real ticket and escrow records only.
Ticket money is "held" until the ticket is checked in at the door (released
automatically) or an accountant releases or refunds it by hand; nothing is
paid out to organisers by any process yet, and payments are simulated."""
from django.db.models import Count, Q, Sum
from django.utils import timezone
from rest_framework import generics
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import HasAnyRolePermission
from events.models import Event, EventTicketType, Ticket

from . import sales_counts
from .common import OversightPagination, choice_param, csv_export

PERMISSIONS = ("escrow.view", "event.approve")
SHOWS = ("on_sale", "ended", "waiting", "not_live")
ZERO = "0.00"


def event_state(event, now):
    """(code, label): what the event is, from its review, payment and date."""
    if event.status == Event.PENDING:
        return "waiting", "Waiting for review"
    if event.status == Event.REJECTED:
        return "rejected", "Rejected"
    if event.status == Event.EXPIRED:
        return "expired", "Listing expired"
    if event.status == Event.CANCELLED:
        return "cancelled", "Cancelled by the organiser" if event.cancelled_by_staff_id is None else "Cancelled by AshantiHub"
    if event.event_date < now:
        return "ended", "Ended"
    if event.paid_at is None:
        return "unpaid", "Approved, listing fee not paid"
    if event.expires_at is not None and event.expires_at <= now:
        return "expired", "Listing expired"
    return "on_sale", "On sale"


def organiser(event):
    if event.submitted_by_business_id:
        owner = event.submitted_by_business
        return {"kind": "business", "id": owner.pk, "name": owner.display_name, "verified": owner.kyc_status == "verified"}
    customer = event.submitted_by_customer
    return {"kind": "customer", "id": customer.pk, "name": customer.full_name, "verified": None}


def base_queryset():
    return Event.objects.select_related(
        "submitted_by_business__profile", "submitted_by_customer", "zone",
    ).prefetch_related("ticket_types")


def ticket_figures(event_ids):
    """{event id: money and counts} over the events' tickets, one query."""
    rows = (
        Ticket.objects.filter(ticket_type__event_id__in=event_ids)
        .values("ticket_type__event_id")
        .annotate(
            sold=Count("id", filter=Q(refunded_at__isnull=True)),
            sales=Sum("price", filter=Q(refunded_at__isnull=True)),
            held=Sum("price", filter=Q(refunded_at__isnull=True, escrow_status=Ticket.HELD)),
            released=Sum("price", filter=Q(refunded_at__isnull=True, escrow_status=Ticket.RELEASED)),
            refunded=Sum("price", filter=Q(refunded_at__isnull=False)),
            checked_in=Count("id", filter=Q(refunded_at__isnull=True, delivered_at__isnull=False)),
        )
    )
    return {row["ticket_type__event_id"]: row for row in rows}


def item(event, figures, now, counts):
    code, label = event_state(event, now)
    row = figures.get(event.pk) or {}
    types = [t for t in event.ticket_types.all()]
    totals = [t.quantity_total for t in types if t.is_active]
    capacity = None if (not totals or any(t is None for t in totals)) else sum(totals)
    prices = [t.price for t in types if t.is_active]
    return {
        "id": event.pk,
        "name": event.name,
        "organiser": organiser(event),
        "event_date": event.event_date,
        "address": event.address,
        "zone": event.zone.name,
        "state": code,
        "state_label": label,
        "tickets_sold": row.get("sold", 0),
        "capacity": capacity,
        "checked_in": row.get("checked_in", 0),
        "price_min": str(min(prices)) if prices else None,
        "price_max": str(max(prices)) if prices else None,
        "sales": str(row.get("sales") or ZERO),
        "held": str(row.get("held") or ZERO),
        "released": str(row.get("released") or ZERO),
        "refunded": str(row.get("refunded") or ZERO),
        "paid_count": counts[0],
        "refunded_count": counts[1],
        "ticket_types": [
            {"id": t.pk, "name": t.name, "price": str(t.price), "sold": t.quantity_sold, "total": t.quantity_total, "active": t.is_active}
            for t in types
        ],
        "paid_at": event.paid_at,
    }


def filtered(request, now):
    params = request.query_params
    events = base_queryset()
    show = choice_param(params, "show", SHOWS)
    if show == "waiting":
        events = events.filter(status=Event.PENDING)
    elif show == "ended":
        events = events.filter(Q(status=Event.APPROVED, event_date__lt=now) | Q(status=Event.CANCELLED))
    elif show == "on_sale":
        events = events.filter(status=Event.APPROVED, event_date__gte=now, paid_at__isnull=False, expires_at__gt=now)
    elif show == "not_live":
        events = events.filter(Q(status__in=[Event.REJECTED, Event.EXPIRED]) | Q(status=Event.APPROVED, paid_at__isnull=True, event_date__gte=now))
    business = params.get("business") or ""
    if business.isdecimal():
        events = events.filter(submitted_by_business_id=int(business))
    text = (params.get("q") or "").strip()
    if text:
        events = events.filter(
            Q(name__icontains=text) | Q(submitted_by_business__profile__business_name__icontains=text)
            | Q(submitted_by_business__full_name__icontains=text) | Q(submitted_by_customer__full_name__icontains=text)
        )
    return events.order_by("-event_date", "-id")


class EventListView(generics.ListAPIView):
    """GET /api/marketplace/events/?q=&show=on_sale|ended|waiting|not_live&business=<id>&page="""

    pagination_class = OversightPagination

    def get_permissions(self):
        return [HasAnyRolePermission(*PERMISSIONS)]

    def get_queryset(self):
        return filtered(self.request, timezone.now())

    def list(self, request, *args, **kwargs):
        now = timezone.now()
        page = self.paginate_queryset(self.get_queryset())
        figures = ticket_figures([event.pk for event in page])
        counts = sales_counts.for_events([event.pk for event in page])
        return self.get_paginated_response([item(event, figures, now, counts[event.pk]) for event in page])


class EventCountsView(APIView):
    """GET /api/marketplace/events/counts/ — the header strip, over every event."""

    def get_permissions(self):
        return [HasAnyRolePermission(*PERMISSIONS)]

    def get(self, request):
        now = timezone.now()
        local = timezone.localtime(now)
        month_start = local.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        quarter_month = ((local.month - 1) // 3) * 3 + 1
        quarter_start = local.replace(month=quarter_month, day=1, hour=0, minute=0, second=0, microsecond=0)
        on_sale = Event.objects.filter(status=Event.APPROVED, event_date__gte=now, paid_at__isnull=False, expires_at__gt=now)
        sold = Ticket.objects.filter(ticket_type__event__in=on_sale, refunded_at__isnull=True)
        types = EventTicketType.objects.filter(event__in=on_sale, is_active=True)
        capacities = list(types.values_list("quantity_total", flat=True))
        capacity = None if (not capacities or any(c is None for c in capacities)) else sum(capacities)
        next_event = on_sale.order_by("event_date").values_list("event_date", flat=True).first()
        tickets = Ticket.objects.all()
        return Response({
            "on_sale": on_sale.count(),
            "next_event_at": next_event,
            "tickets_sold": sold.count(),
            "capacity": capacity,
            "held": str(tickets.filter(refunded_at__isnull=True, escrow_status=Ticket.HELD).aggregate(t=Sum("price"))["t"] or ZERO),
            "released_this_month": str(
                tickets.filter(refunded_at__isnull=True, escrow_status=Ticket.RELEASED, escrow_released_at__gte=month_start)
                .aggregate(t=Sum("price"))["t"] or ZERO
            ),
            "refunded_this_quarter": str(
                tickets.filter(refunded_at__gte=quarter_start).aggregate(t=Sum("price"))["t"] or ZERO
            ),
            "waiting_for_review": Event.objects.filter(status=Event.PENDING).count(),
        })


class EventExportView(APIView):
    """GET /api/marketplace/events/export/?<the list's filters> — ticket sales
    per event as CSV: totals only, no buyers (no personal data)."""

    def get_permissions(self):
        return [HasAnyRolePermission(*PERMISSIONS)]

    def get(self, request):
        now = timezone.now()
        events = list(filtered(request, now))
        figures = ticket_figures([event.pk for event in events])
        counts = sales_counts.for_events([event.pk for event in events])
        rows = []
        for event in events:
            row = item(event, figures, now, counts[event.pk])
            rows.append([
                row["name"], row["organiser"]["name"], timezone.localtime(row["event_date"]).strftime("%Y-%m-%d %H:%M"),
                row["state_label"], row["tickets_sold"], row["capacity"] if row["capacity"] is not None else "",
                row["sales"], row["held"], row["released"], row["refunded"],
                row["paid_count"], row["refunded_count"],
            ])
        return csv_export(
            request, stem="ticket-sales", kind="ticket sales", personal_data=False,
            filters={k: v for k, v in request.query_params.items() if v},
            header=["Event", "Organiser", "When", "Status", "Tickets sold", "Capacity", "Sales (GH₵)", "Held (GH₵)", "Released (GH₵)", "Refunded (GH₵)", "Tickets paid", "Tickets refunded"],
            rows=rows,
        )
