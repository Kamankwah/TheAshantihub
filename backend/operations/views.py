"""Operations' own aggregates (canvas screens 01, 04, 06). Read-only except
where noted; every write elsewhere stays with the app that owns the data."""
from datetime import timedelta

from django.utils import timezone
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import Role, StaffUser
from accounts.permissions import HasAnyRolePermission, HasRolePermission
from accounts.serializers import invite_state
from listings.models import Zone
from portfolio.areas import scout_areas

from . import service_issues
from .overview import overview
from .scoreboard import scouts_scoreboard

JOINED_DAYS = 60


class ScoutsView(APIView):
    """GET scouts/?scope=team|all — the scoreboard (operations.scoreboard)."""

    def get_permissions(self):
        return [HasRolePermission("portfolio.manage")]

    def get(self, request):
        return Response(scouts_scoreboard(request.user, request.query_params.get("scope", "team")))


class OverviewView(APIView):
    """GET overview/?period=today|week|month — the Operations overview (operations.overview)."""

    def get_permissions(self):
        return [HasRolePermission("portfolio.manage")]

    def get(self, request):
        return Response(overview(request.user, request.query_params.get("period", "today")))


class InvitesView(APIView):
    """GET invites/ — what the Invite screen needs beside the form: the
    pending invites the caller sent or leads, who joined in the last 60 days,
    and the zones a scout can be invited to with the scouts who work them."""

    def get_permissions(self):
        return [HasAnyRolePermission("staff.manage", "staff.invite_team")]

    def get(self, request):
        user = request.user
        mine = StaffUser.objects.filter(manager=user) | StaffUser.objects.filter(invited_by=user)
        mine = mine.exclude(pk=user.pk).select_related("role", "invited_by").prefetch_related("areas").distinct()
        pending = []
        for staff in mine.filter(invite_token__isnull=False, is_active=True).order_by("-invite_sent_at", "-created_at"):
            pending.append({
                "id": staff.pk, "full_name": staff.full_name, "email": staff.email, "role": staff.role.name,
                "sent_at": staff.invite_sent_at or staff.created_at, "expires_at": staff.invite_expires_at,
                "state": invite_state(staff), "start_date": staff.start_date,
                "areas": sorted(z.name for z in staff.areas.all()),
            })
        since = timezone.now() - timedelta(days=JOINED_DAYS)
        joined = []
        for staff in mine.filter(invite_token__isnull=True, invited_by__isnull=False).order_by("-created_at"):
            when = staff.activated_at or staff.created_at
            if when >= since:
                joined.append({
                    "id": staff.pk, "full_name": staff.full_name, "role": staff.role.name, "joined_at": when,
                    "areas": sorted(z.name for z in staff.areas.all()),
                    "invited_by_me": staff.invited_by_id == user.pk, "invited_by": staff.invited_by.full_name,
                })
        joined.sort(key=lambda row: row["joined_at"], reverse=True)

        scouts = list(StaffUser.objects.filter(role__name=Role.SCOUT, is_active=True))
        covering = {}
        for scout_id, names in scout_areas(scouts).items():
            for name in names:
                covering.setdefault(name, []).append(scout_id)
        first = {s.pk: s.full_name.split()[0] for s in scouts}
        zones = [
            {"id": z.pk, "name": z.name, "scouts": sorted(first[i] for i in covering.get(z.name, []))}
            for z in Zone.objects.order_by("name")
        ]
        return Response({"pending": pending, "joined": joined, "zones": zones, "link_days": 7})


class ServiceIssuesView(APIView):
    """GET service-issues/?type=&manager=&status=open|resolved — contact messages,
    disputes and owner conversations on the team's businesses (read-only)."""

    def get_permissions(self):
        return [HasRolePermission("service_issues.view")]

    def get(self, request):
        params = request.query_params
        manager = params.get("manager")
        return Response(service_issues.issues_payload(
            request.user, kind=params.get("type", "all"), manager=int(manager) if (manager or "").isdigit() else None,
            status=params.get("status", "open"),
        ))


class DeliveriesView(APIView):
    """GET deliveries/ — today's delivery assignments and the open disputes, every business (read-only)."""

    def get_permissions(self):
        return [HasRolePermission("service_issues.view")]

    def get(self, request):
        return Response(service_issues.deliveries_payload())


class SupportTeamView(APIView):
    """GET support-team/ — the support agents reporting to the caller and the
    support conversation queue (counts only; conversations have no assignee)."""

    def get_permissions(self):
        return [HasRolePermission("staff.invite_team")]

    def get(self, request):
        return Response(service_issues.support_team_payload(request.user))
