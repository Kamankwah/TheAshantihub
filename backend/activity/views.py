from django.db.models import Q
from django.utils.dateparse import parse_date
from rest_framework import generics
from rest_framework.exceptions import ValidationError
from rest_framework.pagination import PageNumberPagination

from accounts.models import StaffUser
from accounts.permissions import IsStaff

from .models import ActivityEvent
from .serializers import ActivityEventSerializer

# activity.view_domains: what each overseeing role sees beyond its own team.
ROLE_ACTIVITY_VISIBILITY = {
    "operations": {
        "roles": ["scout", "support", "dispatch", "marketing"],
        "partial": {
            "accountant": ["commission", "payout"],
            "delivery_manager": ["delivery.dispute", "order-assign-dispatch", "order-delivery-status"],
        },
    },
}


def visible_events(user):
    perms = user.effective_permission_codenames()
    events = ActivityEvent.objects.all()
    if "activity.view_all" in perms:
        return events
    staff = Q(actor_type=ActivityEvent.STAFF)
    scope = staff & Q(actor_id=user.id)
    if "activity.view_team" in perms:
        team = list(StaffUser.objects.filter(manager=user).values_list("id", flat=True))
        scope |= staff & Q(actor_id__in=team)
    if "activity.view_domains" in perms:
        rule = ROLE_ACTIVITY_VISIBILITY.get(user.role.name, {})
        if rule.get("roles"):
            scope |= staff & Q(actor_role__in=rule["roles"])
        for role, prefixes in rule.get("partial", {}).items():
            for prefix in prefixes:
                scope |= staff & Q(actor_role=role, verb__startswith=prefix)
    return events.filter(scope)


class ActivityPagination(PageNumberPagination):
    page_size = 50


def _date_param(params, name):
    raw = params.get(name)
    if not raw:
        return None
    try:
        value = parse_date(raw)
    except ValueError:
        value = None
    if value is None:
        raise ValidationError({name: "Use YYYY-MM-DD."})
    return value


class ActivityListView(generics.ListAPIView):
    serializer_class = ActivityEventSerializer
    pagination_class = ActivityPagination

    def get_permissions(self):
        return [IsStaff()]

    def get_queryset(self):
        user = self.request.user
        params = self.request.query_params
        events = visible_events(user)
        if params.get("mine") == "1":
            events = events.filter(actor_type=ActivityEvent.STAFF, actor_id=user.id)
        if params.get("actor"):
            if not (params["actor"].isdecimal() and params["actor"].isascii()):
                raise ValidationError({"actor": "Use a staff id."})
            events = events.filter(actor_type=ActivityEvent.STAFF, actor_id=params["actor"])
        if params.get("role"):
            events = events.filter(actor_role=params["role"])
        if params.get("verb"):
            events = events.filter(verb__startswith=params["verb"])
        if params.get("target_type"):
            events = events.filter(target_type=params["target_type"])
        if params.get("target_id"):
            events = events.filter(target_id=params["target_id"])
        since = _date_param(params, "since")
        until = _date_param(params, "until")
        if since:
            events = events.filter(occurred_at__date__gte=since)
        if until:
            events = events.filter(occurred_at__date__lte=until)
        return events.order_by("-id")
