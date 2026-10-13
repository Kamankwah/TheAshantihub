"""Start and end a Super Admin's step-in (accounts/view_as.py has the rules).

GET  /api/accounts/staff/view-as/      who can be opened, by team, and the view
                                       this session is in now
POST /api/accounts/staff/view-as/      {"staff": id}: start (or switch) the view
POST /api/accounts/staff/view-as/end/  end it

All three are sent as the Super Admin, without X-View-As (a write carrying it
is refused before it gets here).
"""
from django.db import transaction
from django.utils import timezone
from rest_framework.permissions import BasePermission
from rest_framework.response import Response
from rest_framework.views import APIView

from activity.services import record as record_activity

from . import sessions, view_as
from .models import Role, StaffSession, StaffUser
from .permissions import IsStaff

ROLE_LABELS = dict(Role.NAME_CHOICES)


class CanViewAs(BasePermission):
    message = "Only a Super Admin can step into a team's workspace."

    def has_permission(self, request, view):
        return view_as.is_viewer(request.user)


def person_payload(staff):
    return {
        "id": staff.pk,
        "full_name": staff.full_name,
        "role": staff.role.name,
        "role_label": ROLE_LABELS.get(staff.role.name, staff.role.name),
        "team": view_as.TEAM_OF_ROLE.get(staff.role.name),
        "manager": staff.manager.full_name if staff.manager_id else None,
    }


def current_payload(session):
    if session is None or session.view_as_target_id is None:
        return None
    target = StaffUser.objects.select_related("role", "manager").filter(pk=session.view_as_target_id).first()
    if target is None:
        return None
    return {"staff": person_payload(target), "started_at": session.view_as_started_at}


def _record_end(viewer, target_id, started_at, session, request, *, reason):
    """Record the end of a view (the caller has already cleared it)."""
    target = StaffUser.objects.select_related("role").filter(pk=target_id).first()
    if target is None:
        return
    view_as.forget_screen(session, target)
    minutes = int((timezone.now() - started_at).total_seconds() // 60) if started_at else None
    record_activity(
        viewer, "view_as.ended", target=target, on_behalf_of=target, method="POST", request=request,
        summary=f"Stopped viewing as {target.full_name} ({reason})",
        after={"reason": reason, "started_at": started_at.isoformat() if started_at else None, "minutes": minutes},
    )


class ViewAsView(APIView):
    def get_permissions(self):
        return [IsStaff(), CanViewAs()]

    def get(self, request):
        return Response({
            "current": current_payload(sessions.current(request)),
            "people": [person_payload(staff) for staff in view_as.people()],
            "teams": {team: list(roles) for team, roles in view_as.TEAMS.items()},
        })

    def post(self, request):
        session = sessions.current(request)
        if session is None or not session.two_factor:
            return Response(
                {"detail": "Stepping in needs a session signed in with 2-step sign-in.", "code": "view_as_refused"},
                status=403,
            )
        raw = request.data.get("staff") if isinstance(request.data, dict) else None
        target_id = raw if isinstance(raw, int) and not isinstance(raw, bool) else None
        if target_id is None and isinstance(raw, str) and raw.strip().isdigit():
            target_id = int(raw.strip())
        target = (
            StaffUser.objects.select_related("role", "manager").filter(pk=target_id).first()
            if target_id is not None and 0 < target_id < 2**63 else None
        )
        problem = view_as.target_problem(request.user, target)
        if problem:
            return Response({"detail": problem, "code": "view_as_refused"}, status=400)
        with transaction.atomic():
            locked = StaffSession.objects.select_for_update().get(pk=session.pk)
            if locked.view_as_target_id == target.pk:
                # Already viewing this person (a reload): nothing new to record.
                return Response({"current": current_payload(locked)})
            previous_id, previous_start = locked.view_as_target_id, locked.view_as_started_at
            locked.view_as_target = target
            locked.view_as_started_at = timezone.now()
            locked.save(update_fields=["view_as_target", "view_as_started_at"])
            view_as.forget_screen(locked, target)
            # The activity records come last: record() holds the chain lock until commit.
            if previous_id is not None:
                _record_end(request.user, previous_id, previous_start, locked, request, reason="switched person")
            record_activity(
                request.user, "view_as.started", target=target, on_behalf_of=target, method="POST",
                request=request, summary=f"Started viewing as {target.full_name} ({person_payload(target)['role_label']}), read-only",
                after={"role": target.role.name},
            )
        return Response({"current": current_payload(locked)}, status=201)


class ViewAsEndView(APIView):
    def get_permissions(self):
        return [IsStaff(), CanViewAs()]

    def post(self, request):
        session = sessions.current(request)
        if session is None:
            return Response({"current": None})
        with transaction.atomic():
            locked = StaffSession.objects.select_for_update().get(pk=session.pk)
            if locked.view_as_target_id is not None:
                previous_id, previous_start = locked.view_as_target_id, locked.view_as_started_at
                locked.view_as_target = None
                locked.view_as_started_at = None
                locked.save(update_fields=["view_as_target", "view_as_started_at"])
                _record_end(request.user, previous_id, previous_start, locked, request, reason="exited")
        return Response({"current": None})
