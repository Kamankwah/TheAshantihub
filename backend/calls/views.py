import datetime as dt

from django.db.models import Avg, Q
from django.utils import timezone
from rest_framework import generics
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import StaffUser
from accounts.permissions import HasAnyRolePermission, IsStaff

from activity.services import record

from . import exports
from .models import CallLog, purposes_for
from .serializers import CallLogSerializer

EDIT_WINDOW = dt.timedelta(hours=24)
READ_PERMISSIONS = ("calls.log", "calls.view_team", "calls.view_all", "calls.view_peers")
NOT_REACHED = ("no_answer", "busy", "voicemail")


def visible_calls(user):
    perms = user.effective_permission_codenames()
    calls = CallLog.objects.select_related("staff")
    if "calls.view_all" in perms:
        return calls
    scope = Q(staff=user)
    if "calls.view_team" in perms:
        scope |= Q(staff__in=StaffUser.objects.filter(manager=user))
    if "calls.view_peers" in perms:
        # Support sees what same-role teammates logged (the "Support team" filter).
        scope |= Q(staff__role_id=user.role_id)
    return calls.filter(scope)


def _local_day(value, field):
    try:
        day = dt.date.fromisoformat(value)
    except ValueError:
        raise ValidationError({field: "Use a date like 2026-10-07."})
    return day


def filter_calls(user, params):
    """The calls `user` may see, narrowed by the query string. Shared by the
    list and the export so both mean the same thing by every filter."""
    calls = visible_calls(user)
    for field in ("direction", "outcome", "related_type", "related_id", "purpose", "counterpart_type"):
        if params.get(field):
            calls = calls.filter(**{field: params[field]})
    for field in ("staff", "counterpart_id"):
        if params.get(field):
            if not (params[field].isdecimal() and params[field].isascii()):
                raise ValidationError({field: "Use a number."})
            calls = calls.filter(**{"staff_id" if field == "staff" else field: params[field]})
    # scope=mine: only my own calls; scope=team: only my direct reports'
    # (calls.view_team), never mine; scope=peers: same-role teammates, never mine
    # (calls.view_peers). visible_calls already bounds all three.
    scope = params.get("scope")
    if scope == "mine":
        calls = calls.filter(staff=user)
    elif scope == "team":
        calls = calls.filter(staff__manager=user)
    elif scope == "peers":
        calls = calls.filter(staff__role_id=user.role_id).exclude(staff=user)
    if params.get("day") == "today":
        start, end = today_bounds(timezone.now())
        calls = calls.filter(started_at__gte=start, started_at__lt=end)
    zone = timezone.get_current_timezone()
    if params.get("from"):
        low = timezone.make_aware(dt.datetime.combine(_local_day(params["from"], "from"), dt.time.min), zone)
        calls = calls.filter(started_at__gte=low)
    if params.get("to"):
        high = timezone.make_aware(dt.datetime.combine(_local_day(params["to"], "to") + dt.timedelta(days=1), dt.time.min), zone)
        calls = calls.filter(started_at__lt=high)
    return calls


def day_summary(calls):
    """The KPI row over `calls`: counts, the not-reached count (no answer, busy
    or voicemail) and the average length of connected calls that have a typed
    length (calls with no length are left out of the average, not counted as 0)."""
    now = timezone.now()
    day_start, day_end = today_bounds(now)
    connected = calls.filter(outcome="connected")
    measured = connected.filter(duration_seconds__gt=0)
    average = measured.aggregate(avg=Avg("duration_seconds"))["avg"]
    with_follow_up = calls.filter(follow_up_at__isnull=False)
    return {
        "logged": calls.count(), "connected": connected.count(),
        "inbound": calls.filter(direction="in").count(), "outbound": calls.filter(direction="out").count(),
        "not_reached": calls.filter(outcome__in=NOT_REACHED).count(),
        "avg_connected_seconds": round(average) if average is not None else None,
        "follow_ups": with_follow_up.count(),
        "follow_ups_due_today": with_follow_up.filter(follow_up_at__gte=day_start, follow_up_at__lt=day_end).count(),
    }


class CallPagination(PageNumberPagination):
    page_size = 50

    summary = None
    extra = None

    def get_paginated_response(self, data):
        response = super().get_paginated_response(data)
        if self.summary is not None:
            response.data["summary"] = self.summary
        if self.extra is not None:
            response.data.update(self.extra)
        return response


def today_bounds(now):
    start = timezone.localtime(now).replace(hour=0, minute=0, second=0, microsecond=0)
    return start, start + dt.timedelta(days=1)


class CallLogListCreateView(generics.ListCreateAPIView):
    serializer_class = CallLogSerializer
    pagination_class = CallPagination

    def get_permissions(self):
        if self.request.method == "POST":
            return [HasAnyRolePermission("calls.log")]
        return [HasAnyRolePermission(*READ_PERMISSIONS)]

    def get_queryset(self):
        params = self.request.query_params
        calls = filter_calls(self.request.user, params)
        user = self.request.user
        # The summary covers today, or whatever date range was asked for.
        ranged = params.get("from") or params.get("to")
        if params.get("day") == "today" or ranged:
            # `summary` keeps its two original keys; `kpis` is the richer Support row.
            self.paginator.summary = {"logged": calls.count(), "connected": calls.filter(outcome="connected").count()}
            self.paginator.extra = {"kpis": day_summary(calls)}
        if params.get("day") == "today":
            start, end = today_bounds(timezone.now())
            # The Call log screen's strip: my own day, and my team's count.
            own = visible_calls(user).filter(staff=user, started_at__gte=start, started_at__lt=end)
            self.paginator.extra["strip"] = {
                "mine": own.count(), "out": own.filter(direction="out").count(), "in": own.filter(direction="in").count(),
                "connected": own.filter(outcome="connected").count(), "no_answer": own.filter(outcome="no_answer").count(),
                "follow_ups": own.filter(follow_up_task__isnull=False).count(),
                "team": visible_calls(user).filter(staff__manager=user, started_at__gte=start, started_at__lt=end).count()
                if "calls.view_team" in user.effective_permission_codenames() else None,
            }
        return calls


class CallLogExportView(APIView):
    """GET /api/calls/export/?format=csv|xlsx[&same filters as the list] — the
    calls the caller may see, as a file, with counterpart numbers masked (see
    calls.exports). Recorded as report.exported so the export is auditable."""

    content_negotiation_class = exports.ExportNegotiation

    def get_permissions(self):
        return [HasAnyRolePermission(*READ_PERMISSIONS)]

    def get(self, request):
        fmt = request.query_params.get("format", "")
        if fmt not in ("csv", "xlsx"):
            raise ValidationError({"format": "Use csv or xlsx."})
        calls = filter_calls(request.user, request.query_params).select_related("staff")
        count = calls.count()
        if count > exports.MAX_ROWS:
            raise ValidationError({"detail": f"That is {count} calls. Narrow the dates to export {exports.MAX_ROWS} or fewer."})
        record(request.user, "report.exported", after={"kind": "calls", "format": fmt, "rows": count, "personal_data": True}, request=request)
        return exports.export_response(calls, fmt, request.user, f"ashantihub-calls-{timezone.localdate()}")


class CallLogDetailView(generics.RetrieveUpdateAPIView):
    serializer_class = CallLogSerializer
    http_method_names = ["get", "patch"]

    def get_permissions(self):
        return [HasAnyRolePermission(*READ_PERMISSIONS)]

    def get_queryset(self):
        return visible_calls(self.request.user)

    def perform_update(self, serializer):
        call = serializer.instance
        if call.staff_id != self.request.user.id:
            raise PermissionDenied("Only the person who logged a call can edit it.")
        if timezone.now() - call.created_at > EDIT_WINDOW:
            raise PermissionDenied("Calls can be edited for 24 hours after they're logged.")
        serializer.save()


class CallPurposesView(APIView):
    def get_permissions(self):
        return [IsStaff()]

    def get(self, request):
        return Response([{"value": value, "label": label} for value, label in purposes_for(request.user.role.name)])


class CallCounterpartsView(APIView):
    """GET counterparts/ — who a scout can pick in "Log a call": their
    businesses (phone masked, "from the business record") and their open
    prospects. The server fills the name and phone in when the call is saved."""

    def get_permissions(self):
        return [HasAnyRolePermission("calls.log")]

    def get(self, request):
        from accounts.models import BusinessOwner
        from field.models import Prospect
        from field.prospects import masked_phone

        if request.query_params.get("q") is not None:
            return self._search(request)

        owners = BusinessOwner.objects.filter(account_manager=request.user).exclude(
            kyc_status=BusinessOwner.REJECTED).select_related("profile").order_by("pk")
        businesses = [
            {
                "id": owner.pk, "business_name": getattr(getattr(owner, "profile", None), "business_name", "") or owner.full_name,
                "owner_name": owner.full_name, "phone_masked": masked_phone(owner.login_phone),
            }
            for owner in owners
        ]
        prospects = [
            {"id": p.pk, "name": p.name, "phone_masked": masked_phone(p.phone), "status": p.status}
            for p in Prospect.objects.filter(scout=request.user).exclude(status=Prospect.REGISTERED).order_by("name")
        ]
        businesses.sort(key=lambda item: item["business_name"].lower())
        return Response({"businesses": businesses, "prospects": prospects})

    SEARCH_LIMIT = 8

    def _search(self, request):
        """?q= — Support's "Find them": customers (name, phone, order number), business
        owners (name, business name, number) and orders by number. Phones always come
        back masked; a business is only ever a name and a masked number, never a way to
        contact it. Staff without the lookup permissions get nothing back."""
        from accounts.models import BusinessOwner, Customer
        from field.prospects import masked_phone
        from orders.models import Order

        perms = set(request.user.effective_permission_codenames())
        text = request.query_params["q"].strip()[:60]
        empty = {"customers": [], "businesses": [], "orders": [], "prospects": []}
        if not ({"calls.view_peers", "users.view"} <= perms) or len(text) < 2:
            return Response(empty)
        digits = "".join(ch for ch in text if ch.isdigit())
        order_id = int(text.lstrip("#")) if text.lstrip("#").isdecimal() and len(text.lstrip("#")) < 10 else None
        customers = Q(full_name__icontains=text)
        owners = Q(full_name__icontains=text) | Q(profile__business_name__icontains=text)
        # Numbers are only ever matched on what the screen shows (the last 3-4 digits) or on the
        # whole number, never on a fragment from the middle: a fragment search would let the
        # masked digits be guessed one at a time.
        if len(digits) in (3, 4):
            customers |= Q(phone__endswith=digits)
            owners |= Q(login_phone__endswith=digits)
        elif len(digits) >= 9:
            customers |= Q(phone__endswith=digits[-9:])
            owners |= Q(login_phone__endswith=digits[-9:])
        if len(digits) >= 3 and not getattr(request, "view_as_viewer", None):
            # Audited without the number itself.
            record(request.user, "call.counterpart_phone_search", after={"digits": len(digits)}, request=request)
        if order_id is not None:
            customers |= Q(orders__pk=order_id)
        limit = self.SEARCH_LIMIT
        found_customers = Customer.objects.filter(customers).distinct().order_by("full_name")[:limit]
        found_owners = BusinessOwner.objects.filter(owners).select_related("profile").distinct().order_by("full_name")[:limit]
        found_orders = (
            Order.objects.filter(pk=order_id).select_related("customer")[:1] if order_id is not None else []
        )
        return Response({
            "customers": [
                {"id": c.pk, "name": c.full_name, "phone_masked": masked_phone(c.phone), "orders": c.orders.count()}
                for c in found_customers
            ],
            "businesses": [
                {"id": o.pk, "business_name": getattr(getattr(o, "profile", None), "business_name", "") or o.full_name,
                 "owner_name": o.full_name, "phone_masked": masked_phone(o.login_phone)}
                for o in found_owners
            ],
            "orders": [
                {"id": o.pk, "customer_id": o.customer_id, "customer_name": o.customer.full_name,
                 "total_amount": str(o.total_amount), "label": f"Order #{o.pk}"}
                for o in found_orders
            ],
            "prospects": [],
        })
