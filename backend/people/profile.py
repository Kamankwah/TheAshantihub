"""Staff profile (SA-4 screen 05): one read for the Overview, Performance,
Reports, Approvals and Access tabs. Activity uses GET /api/activity/?actor=, and
the commission lines GET /api/commission/accruals/?staff=. There is no pay
profile, payslip or staff payout account anywhere in the data, so none is shown."""
from datetime import timedelta

from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import Role, StaffSession, StaffUser
from accounts.permissions import HasRolePermission
from accounts.phones import mask_phone
from accounts import sessions as staff_sessions
from approvals.models import ApprovalRequest
from commission.models import CommissionAccrual
from operations.scoreboard import scouts_scoreboard
from portfolio.areas import scout_areas
from reports.models import StaffReport
from targets.models import Leave

from .common import ROLE_LABELS, effective, status_of, two_step_label, with_directory_columns

REPORT_DAYS = 10
APPROVAL_ROWS = 12


def _person(staff):
    return {"id": staff.pk, "name": staff.full_name, "role": staff.role.name, "role_label": ROLE_LABELS.get(staff.role.name, staff.role.name)}


def _permissions(staff):
    role = {p.codename for p in staff.role.permissions.all()}
    extra = {p.codename for p in staff.extra_permissions.all()}
    revoked = {p.codename for p in staff.revoked_permissions.all()}
    return {
        "role": sorted(role), "extra": sorted(extra - role), "revoked": sorted(revoked & (role | extra)),
        "effective": sorted(effective(staff)),
    }


def _sessions(staff, request):
    rows = staff_sessions.live(StaffSession.objects.filter(staff=staff)).order_by("-last_seen_at")
    current = staff_sessions.current(request)
    return [
        {
            "id": s.pk, "device_label": s.device_label, "ip": s.ip, "two_factor": s.two_factor,
            "created_at": s.created_at, "last_seen_at": s.last_seen_at,
            "idle_ends_at": s.last_seen_at + staff_sessions.IDLE_LIMIT, "ends_at": s.created_at + staff_sessions.ABSOLUTE_LIMIT,
            "is_current": bool(current and current.pk == s.pk),
        }
        for s in rows
    ]


def _reports(staff, today):
    rows = StaffReport.objects.filter(
        staff=staff, period=StaffReport.DAY, period_start__gte=today - timedelta(days=REPORT_DAYS), period_start__lte=today,
    ).exclude(status=StaffReport.DRAFT).order_by("-period_start")
    return [{"date": r.period_start, "status": r.status, "is_late": r.is_late, "submitted_at": r.submitted_at} for r in rows]


def _approvals(staff):
    made = ApprovalRequest.objects.filter(maker=staff).order_by("-created_at")[:APPROVAL_ROWS]
    decided = ApprovalRequest.objects.filter(decided_by=staff).exclude(maker=staff).order_by("-decided_at")[:APPROVAL_ROWS]
    waiting = ApprovalRequest.objects.filter(status=ApprovalRequest.PENDING, assigned_to=staff).order_by("due_at")[:APPROVAL_ROWS]
    shape = lambda r: {"id": r.pk, "title": r.title, "kind": r.kind, "status": r.status, "created_at": r.created_at, "decided_at": r.decided_at, "due_at": r.due_at}
    return {
        "made": [shape(r) for r in made], "decided": [shape(r) for r in decided], "waiting": [shape(r) for r in waiting],
    }


def _commission(staff):
    """Per-status totals of this person's commission lines. Only scouts earn any."""
    lines = CommissionAccrual.objects.filter(staff=staff)
    if not lines.exists():
        return None
    out = {}
    for status_value, _label in CommissionAccrual.STATUS_CHOICES:
        picked = [a for a in lines if a.status == status_value]
        out[status_value] = {"count": len(picked), "amount": str(sum((a.amount for a in picked), 0) or "0.00")}
    return out


def _live(staff, row, today):
    """What this person is doing now, from records only: signed in, on leave, and a scout's latest check-in today."""
    leave = Leave.objects.filter(staff=staff, start__lte=today, end__gte=today).order_by("end").first()
    live = staff_sessions.live(StaffSession.objects.filter(staff=staff)).order_by("-last_seen_at").first()
    return {
        "signed_in": live is not None, "last_seen_at": live.last_seen_at if live else None,
        "on_leave_to": leave.end if leave else None,
        "check_in": row["check_in"] if row else None,
    }


class StaffProfileView(APIView):
    """GET /api/people/staff/<id>/"""

    def get_permissions(self):
        return [HasRolePermission("staff.manage")]

    def get(self, request, pk):
        queryset = with_directory_columns(
            StaffUser.objects.select_related("role", "manager__role", "invited_by")
            .prefetch_related("role__permissions", "extra_permissions", "revoked_permissions", "areas")
        )
        staff = get_object_or_404(queryset, pk=pk)
        now = timezone.now()
        today = timezone.localdate(now)
        scout_row = None
        if staff.role.name == Role.SCOUT and staff.is_active and staff.invite_token is None:
            scout_row = next((r for r in scouts_scoreboard(request.user, "all")["scouts"] if r["id"] == staff.pk), None)
        areas = scout_areas([staff]).get(staff.pk, []) if staff.role.name == Role.SCOUT else []
        reports_to = [_person(p) for p in StaffUser.objects.filter(manager=staff, is_active=True).select_related("role").order_by("full_name")]
        return Response({
            "id": staff.pk, "full_name": staff.full_name, "email": staff.email,
            "phone": mask_phone(staff.phone) if staff.phone else None,
            "role": staff.role.name, "role_label": ROLE_LABELS.get(staff.role.name, staff.role.name),
            "status": status_of(staff, now), "suspension_reason": staff.suspension_reason or "",
            "manager": _person(staff.manager) if staff.manager_id else None,
            "invited_by": staff.invited_by.full_name if staff.invited_by_id else None,
            "areas": areas or sorted(z.name for z in staff.areas.all()),
            "reports_to_them": reports_to,
            "joined_at": staff.activated_at or staff.created_at, "start_date": staff.start_date,
            "invite_expires_at": staff.invite_expires_at, "invite_opened_at": staff.invite_opened_at,
            "last_sign_in_at": staff.last_sign_in_at,
            "two_step": two_step_label(staff), "two_step_required": staff.role.name == Role.SUPER_ADMIN,
            "live": _live(staff, scout_row, today),
            "performance": scout_row,
            "permissions": _permissions(staff),
            "sessions": _sessions(staff, request),
            "reports": _reports(staff, today),
            "approvals": _approvals(staff),
            "pay": {
                "commission": _commission(staff),
                # Honest gap: no pay profile, payslip or staff payout account exists yet.
                "pay_profile": None,
            },
            "is_me": request.user.pk == staff.pk,
        })
