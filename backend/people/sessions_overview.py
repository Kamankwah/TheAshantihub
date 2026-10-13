"""Sessions & devices (SA-4 screen 09): everyone signed in now, with the facts a
session row holds. There is only an IP address, no network name or location, so
none is claimed. "New device" means the first session today whose kind of device
(the browser-and-system label) the person has not signed in on before."""

from django.utils import timezone
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts import sessions
from accounts.models import Role, StaffSession, StaffUser
from accounts.permissions import HasRolePermission, RequiresSudo
from activity.services import record

from .common import ROLE_LABELS


def _new_device_ids(live_rows, today_start):
    """Session ids that are a person's first of the day on a device label they never used before today."""
    flagged = set()
    for s in live_rows:
        if s.created_at < today_start:
            continue
        earlier = StaffSession.objects.filter(staff_id=s.staff_id, created_at__lt=today_start)
        if earlier.exists() and not earlier.filter(device_label=s.device_label).exists():
            flagged.add(s.pk)
    return flagged


class SessionsOverviewView(APIView):
    """GET /api/people/sessions/"""

    def get_permissions(self):
        return [HasRolePermission("staff.manage")]

    def get(self, request):
        now = timezone.now()
        today_start = timezone.localtime(now).replace(hour=0, minute=0, second=0, microsecond=0)
        live = list(
            sessions.live(StaffSession.objects.filter(staff__is_active=True, staff__is_suspended=False), now)
            .select_related("staff__role").order_by("staff__full_name", "-last_seen_at")
        )
        current = sessions.current(request)
        new_ids = _new_device_ids(live, today_start)
        people = {s.staff_id for s in live}
        two_step_people = {s.staff_id for s in live if s.two_factor}
        rows = [
            {
                "id": s.pk, "staff": {"id": s.staff_id, "full_name": s.staff.full_name, "role": s.staff.role.name, "role_label": ROLE_LABELS.get(s.staff.role.name, s.staff.role.name)},
                "device_label": s.device_label, "ip": s.ip, "two_factor": s.two_factor,
                "created_at": s.created_at, "last_seen_at": s.last_seen_at,
                "idle_ends_at": s.last_seen_at + sessions.IDLE_LIMIT, "ends_at": s.created_at + sessions.ABSOLUTE_LIMIT,
                "is_current": bool(current and current.pk == s.pk), "new_device": s.pk in new_ids,
                "sudo_until": s.sudo_until if s.sudo_until and s.sudo_until > now and current and current.pk == s.pk else None,
            }
            for s in live
        ]
        return Response({
            "kpis": {
                "sessions": len(live), "people": len(people), "with_two_step": len(two_step_people),
                "new_devices_today": len(new_ids),
                "new_device_people": sorted({s.staff.full_name for s in live if s.pk in new_ids}),
            },
            "rules": {
                "idle_minutes": int(sessions.IDLE_LIMIT.total_seconds() // 60),
                "longest_hours": int(sessions.ABSOLUTE_LIMIT.total_seconds() // 3600),
                "sudo_minutes": int(sessions.SUDO_WINDOW.total_seconds() // 60),
                "two_step_required_for": ROLE_LABELS[Role.SUPER_ADMIN],
            },
            "sessions": rows,
        })


class SignOutEveryoneView(APIView):
    """POST /api/people/sessions/sign-out-all/ — ends every staff session except this one."""

    def get_permissions(self):
        return [HasRolePermission("staff.manage"), RequiresSudo()]

    def post(self, request):
        keep = sessions.current(request)
        ids = list(
            StaffSession.objects.filter(revoked_at__isnull=True).exclude(pk=keep.pk if keep else None)
            .exclude(staff=request.user).values_list("staff_id", flat=True).distinct()
        )
        ended = 0
        for staff in StaffUser.objects.filter(pk__in=ids):
            ended += sessions.revoke_all(staff, StaffSession.SIGNED_OUT_EVERYWHERE)
        record(
            request.user, "staff.signed_out_everyone", summary=f"Signed every other staff member out ({ended} sessions)",
            after={"sessions": ended, "people": len(ids)}, request=request,
        )
        return Response({"ended": ended, "people": len(ids)})
