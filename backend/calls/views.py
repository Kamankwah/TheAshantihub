import datetime as dt

from django.db.models import Q
from django.utils import timezone
from rest_framework import generics
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import StaffUser
from accounts.permissions import HasAnyRolePermission, IsStaff

from .models import CallLog, purposes_for
from .serializers import CallLogSerializer

EDIT_WINDOW = dt.timedelta(hours=24)
READ_PERMISSIONS = ("calls.log", "calls.view_team", "calls.view_all")


def visible_calls(user):
    perms = user.effective_permission_codenames()
    calls = CallLog.objects.select_related("staff")
    if "calls.view_all" in perms:
        return calls
    scope = Q(staff=user)
    if "calls.view_team" in perms:
        scope |= Q(staff__in=StaffUser.objects.filter(manager=user))
    return calls.filter(scope)


class CallPagination(PageNumberPagination):
    page_size = 50

    summary = None

    def get_paginated_response(self, data):
        response = super().get_paginated_response(data)
        if self.summary is not None:
            response.data["summary"] = self.summary
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
        calls = visible_calls(self.request.user)
        for field in ("direction", "outcome", "related_type", "related_id"):
            if params.get(field):
                calls = calls.filter(**{field: params[field]})
        if params.get("staff"):
            if not (params["staff"].isdecimal() and params["staff"].isascii()):
                raise ValidationError({"staff": "Use a staff id."})
            calls = calls.filter(staff_id=params["staff"])
        if params.get("day") == "today":
            start, end = today_bounds(timezone.now())
            calls = calls.filter(started_at__gte=start, started_at__lt=end)
            self.paginator.summary = {
                "logged": calls.count(), "connected": calls.filter(outcome="connected").count(),
            }
        return calls


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
