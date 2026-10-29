"""Teams & reporting lines (SA-4 screen 06) and the two changes only a Super Admin
makes to a person: who they report to, and their role. Both ask for the password
again, are recorded with before and after, and tell the people they touch."""
from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts import sessions
from accounts.models import BusinessOwner, Role, StaffSession, StaffUser
from accounts.permissions import HasRolePermission, RequiresSudo, can_lead_team, general_manager_manager_problem
from activity.models import ActivityEvent
from activity.services import record
from notifications.services import notify_staff
from portfolio.areas import scout_areas
from staffsecurity import policy
from realtime.publish import force_disconnect_on_commit

from .common import ROLE_LABELS, ROLE_ORDER, status_of

HISTORY_VERBS = ("staff.manager_changed", "staff.role_changed")
HISTORY_ROWS = 12
REASON_MAX = 300


def _node(staff, children, areas, now):
    return {
        "id": staff.pk, "name": staff.full_name, "role": staff.role.name, "role_label": ROLE_LABELS.get(staff.role.name, staff.role.name),
        "status": status_of(staff, now), "areas": areas.get(staff.pk, []),
        "can_lead": can_lead_team(staff), "children": children,
    }


class OrgChartView(APIView):
    """GET /api/people/teams/ — the tree from the top down, who may lead a team,
    and the last reporting-line and role changes."""

    def get_permissions(self):
        return [HasRolePermission("staff.manage")]

    def get(self, request):
        now = timezone.now()
        staff = list(
            StaffUser.objects.filter(is_active=True).select_related("role")
            .prefetch_related("role__permissions", "extra_permissions", "revoked_permissions")
            .order_by("full_name")
        )
        by_manager = {}
        for s in staff:
            by_manager.setdefault(s.manager_id, []).append(s)
        scouts = [s for s in staff if s.role.name == Role.SCOUT]
        areas = scout_areas(scouts) if scouts else {}
        seen = set()

        def build(s):
            seen.add(s.pk)
            kids = sorted(by_manager.get(s.pk, []), key=lambda k: (ROLE_ORDER.index(k.role.name) if k.role.name in ROLE_ORDER else 99, k.full_name))
            return _node(s, [build(k) for k in kids if k.pk not in seen], areas, now)

        roots = sorted(by_manager.get(None, []), key=lambda k: (ROLE_ORDER.index(k.role.name) if k.role.name in ROLE_ORDER else 99, k.full_name))
        tree = [build(r) for r in roots]
        history = [
            {"id": e.pk, "at": e.occurred_at, "verb": e.verb, "summary": e.summary, "by": e.actor_label, "before": e.before, "after": e.after}
            for e in ActivityEvent.objects.filter(verb__in=HISTORY_VERBS).order_by("-id")[:HISTORY_ROWS]
        ]
        leads = [
            {"id": s.pk, "name": s.full_name, "role": s.role.name, "role_label": ROLE_LABELS.get(s.role.name, s.role.name)}
            for s in staff if can_lead_team(s)
        ]
        return Response({
            "people": len(staff), "teams": sum(1 for s in staff if by_manager.get(s.pk)),
            "tree": tree, "leads": leads, "history": history,
        })


def _text(request, key):
    value = request.data.get(key, "") if isinstance(request.data, dict) else ""
    return value.strip() if isinstance(value, str) else ""


class ReassignManagerView(APIView):
    """POST /api/people/teams/reassign/ {staff, manager, reason}. Requests the
    person's old manager still has waiting stay with that manager."""

    def get_permissions(self):
        return [HasRolePermission("staff.manage"), RequiresSudo()]

    def post(self, request):
        data = request.data if isinstance(request.data, dict) else {}
        staff = get_object_or_404(StaffUser.objects.select_related("role", "manager"), pk=data.get("staff") or 0, is_active=True)
        manager = get_object_or_404(StaffUser.objects.select_related("role"), pk=data.get("manager") or 0, is_active=True, is_suspended=False)
        reason = _text(request, "reason")
        if not reason:
            return Response({"detail": "Say why in a few words; it goes in the audit log."}, status=400)
        if len(reason) > REASON_MAX:
            return Response({"detail": f"Keep the reason under {REASON_MAX} characters."}, status=400)
        if staff.pk == manager.pk:
            return Response({"detail": "Someone can't report to themselves."}, status=400)
        if not can_lead_team(manager):
            return Response({"detail": "Choose a manager who can lead a team."}, status=400)
        problem = general_manager_manager_problem(staff.role.name, manager)
        if problem:
            return Response({"detail": problem}, status=400)
        if staff.manager_id == manager.pk:
            return Response({"detail": f"{staff.full_name} already reports to {manager.full_name}."}, status=400)
        node = manager
        while node is not None:
            if node.pk == staff.pk:
                return Response({"detail": "That would make someone their own manager."}, status=400)
            node = node.manager
        old = staff.manager
        with transaction.atomic():
            staff.manager = manager
            staff.save(update_fields=["manager"])
            record(
                request.user, "staff.manager_changed", target=staff,
                summary=f"{staff.full_name} now reports to {manager.full_name}" + (f" (was {old.full_name})" if old else ""),
                before={"manager": {"id": old.pk, "name": old.full_name} if old else None},
                after={"manager": {"id": manager.pk, "name": manager.full_name}, "reason": reason}, request=request,
            )
            notify_staff(staff, "reporting_line_changed", "You have a new manager", f"You now report to {manager.full_name}.", icon="👥")
            notify_staff(manager, "reporting_line_changed", f"{staff.full_name} joins your team", f"{staff.full_name} ({ROLE_LABELS.get(staff.role.name, staff.role.name)}) now reports to you.", icon="👥")
            if old:
                notify_staff(old, "reporting_line_changed", f"{staff.full_name} moved teams", f"{staff.full_name} now reports to {manager.full_name}. Requests already waiting with you stay with you.", icon="👥")
            for who in (staff, manager, old):
                if who:
                    force_disconnect_on_commit(f"staff.{who.pk}")
        return Response({"staff": staff.pk, "manager": {"id": manager.pk, "name": manager.full_name}, "previous": {"id": old.pk, "name": old.full_name} if old else None})


class ChangeRoleView(APIView):
    """POST /api/people/staff/<id>/role/ {role, reason}. Individual grants and
    revokes on the person are kept; they apply on top of the new role."""

    def get_permissions(self):
        return [HasRolePermission("staff.manage"), RequiresSudo()]

    def post(self, request, pk):
        staff = get_object_or_404(StaffUser.objects.select_related("role"), pk=pk)
        name = request.data.get("role") if isinstance(request.data, dict) else None
        role = Role.objects.filter(name=name).first()
        reason = _text(request, "reason")
        if role is None:
            return Response({"detail": "Choose a role."}, status=400)
        if not reason:
            return Response({"detail": "Say why in a few words; it goes in the audit log."}, status=400)
        if staff.pk == request.user.pk:
            return Response({"detail": "You cannot change your own role."}, status=400)
        # Granting or removing Super Admin is a Super Admin's act, whatever else the caller may manage.
        if Role.SUPER_ADMIN in (role.name, staff.role.name) and request.user.role.name != Role.SUPER_ADMIN:
            return Response({"detail": "Only a Super Admin can give or take away the Super Admin role."}, status=403)
        if role.name == Role.GENERAL_MANAGER and request.user.role.name != Role.SUPER_ADMIN:
            return Response({"detail": "Only a Super Admin can make someone a General Manager."}, status=403)
        problem = general_manager_manager_problem(role.name, staff.manager)
        if problem:
            return Response({"detail": f"{problem} Move them under one first."}, status=400)
        if not staff.is_active:
            return Response({"detail": "Reactivate this person before changing their role."}, status=400)
        if staff.role_id == role.pk:
            return Response({"detail": f"{staff.full_name} is already {ROLE_LABELS.get(role.name, role.name)}."}, status=400)
        if staff.role.name == Role.SUPER_ADMIN and not StaffUser.objects.filter(role__name=Role.SUPER_ADMIN, is_active=True).exclude(pk=staff.pk).exists():
            return Response({"detail": "This is the only Super Admin. Invite another before changing this role."}, status=400)
        team = staff.direct_reports.filter(is_active=True).count()
        if team and role.name != Role.SUPER_ADMIN and not role.permissions.filter(codename="staff.invite_team").exists():
            return Response({"detail": f"Reassign {staff.full_name}'s {team} direct report(s) first; {ROLE_LABELS.get(role.name, role.name)} can't lead a team."}, status=400)
        if staff.role.name == Role.SCOUT:
            managed = staff.managed_businesses.exclude(kyc_status=BusinessOwner.REJECTED).count()
            if managed:
                return Response({"detail": f"Reassign {staff.full_name}'s {managed} {'business' if managed == 1 else 'businesses'} first."}, status=400)
        # Co-signer separation: nobody with individual grants becomes the co-signer, and the
        # co-signer never carries any (so leaving the role clears nothing that could exist).
        if role.name == Role.COSIGNER and staff.extra_permissions.exists():
            return Response({"detail": f"Remove {staff.full_name}'s individual permissions first; the co-signer holds nothing beyond its role."}, status=400)
        kept = staff.extra_permissions.count() + staff.revoked_permissions.count()
        old = staff.role
        from delivery import employment  # lazy: delivery imports accounts at load
        with transaction.atomic():
            blocked = employment.block_leaving(staff) if old.name == Role.DISPATCH else None
            if blocked:
                return Response({"detail": blocked, "code": "third_party_rider"}, status=409)
            staff.role = role
            staff.save(update_fields=["role"])
            if old.name == Role.COSIGNER:
                staff.extra_permissions.clear()
                kept = staff.revoked_permissions.count()
            # Super Admin and the roles under the 2-step rule: end the live sign-ins so they sign in again under it.
            if role.name == Role.SUPER_ADMIN or policy.requires_two_factor(role.name):
                sessions.revoke_all(staff, StaffSession.ENDED)
            record(
                request.user, "staff.role_changed", target=staff,
                summary=f"{staff.full_name} changed from {ROLE_LABELS.get(old.name, old.name)} to {ROLE_LABELS.get(role.name, role.name)}",
                before={"role": old.name}, after={"role": role.name, "reason": reason, "individual_exceptions_kept": kept}, request=request,
            )
            notify_staff(staff, "role_changed", "Your role changed", f"You are now {ROLE_LABELS.get(role.name, role.name)}.", icon="🔑")
            force_disconnect_on_commit(f"staff.{staff.pk}")
        return Response({"id": staff.pk, "role": role.name, "individual_exceptions_kept": kept})
