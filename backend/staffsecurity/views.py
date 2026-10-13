from datetime import timedelta

from django.db import transaction
from django.db.models import Count, Q
from django.utils import timezone
from django.utils.dateparse import parse_date
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts import sessions
from accounts.models import Role, StaffSession, StaffTwoFactor, StaffUser
from accounts.permissions import HasRolePermission, RequiresSudo
from activity.models import ActivityEvent
from activity.services import record
from notifications.services import notify_staff
from reports.models import ReportExport

from . import policy
from .models import StaffSignInRecord

PAGE_SIZE = 50
MANAGE = "security.manage"
LINK_HOURS = 24
# An export line that never said whether it held personal data (older lines).
_unrecorded = Q(after__isnull=True) | ~Q(after__has_key="personal_data")
ROLE_LABELS = dict(Role.NAME_CHOICES)


def _date(params, name):
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


def _page(params):
    raw = params.get("page", "1")
    return int(raw) if raw.isdecimal() and raw.isascii() and 0 < int(raw) < 100000 else 1


def _staff_id(params, name):
    raw = params.get(name)
    if not raw:
        return None
    if not (raw.isdecimal() and raw.isascii()) or int(raw) > 2**31:
        raise ValidationError({name: "Use a staff id."})
    return int(raw)


class SignInHistoryView(APIView):
    """GET staff-security/sign-ins/?kind=a,b&staff=&since=&until=&page= — the
    sign-in history (Super Admin 11), newest first, 50 a page, with the figures
    the screen shows. It starts on the day it shipped: `history_starts` is the
    oldest line, or null while there is none."""

    def get_permissions(self):
        return [HasRolePermission(MANAGE)]

    def get(self, request):
        params = request.query_params
        lines = StaffSignInRecord.objects.select_related("staff__role")
        kinds = [k for k in params.get("kind", "").split(",") if k in dict(StaffSignInRecord.KIND_CHOICES)]
        if kinds:
            lines = lines.filter(kind__in=kinds)
        staff_id = _staff_id(params, "staff")
        if staff_id:
            lines = lines.filter(staff_id=staff_id)
        since, until = _date(params, "since"), _date(params, "until")
        if since:
            lines = lines.filter(at__date__gte=since)
        if until:
            lines = lines.filter(at__date__lte=until)
        count = lines.count()
        page = _page(params)
        window = list(lines[(page - 1) * PAGE_SIZE: page * PAGE_SIZE])

        now = timezone.now()
        day_ago = now - timedelta(hours=24)
        everything = StaffSignInRecord.objects
        first = everything.order_by("id").values_list("at", flat=True).first()
        failed = (
            everything.filter(at__gte=day_ago, kind__in=[StaffSignInRecord.SIGN_IN_FAILED, StaffSignInRecord.TWO_STEP_FAILED])
            .values("kind", "identifier_masked", "staff__full_name")
            .annotate(attempts=Count("id"))
            .order_by("-attempts")[:10]
        )
        return Response({
            "count": count,
            "page": page,
            "has_next": page * PAGE_SIZE < count,
            "results": [_line(row) for row in window],
            "history_starts": first,
            "summary": {
                "signed_in_24h": everything.filter(at__gte=day_ago, kind=StaffSignInRecord.SIGNED_IN).count(),
                "refused_24h": everything.filter(at__gte=day_ago, kind=StaffSignInRecord.SIGN_IN_FAILED).count(),
                "two_step_failed_24h": everything.filter(at__gte=day_ago, kind=StaffSignInRecord.TWO_STEP_FAILED).count(),
                "signed_in_now": sessions.live(StaffSession.objects.all(), now).values("staff_id").distinct().count(),
            },
            "failed_recent": [
                {"kind": row["kind"], "who": row["staff__full_name"] or "", "identifier": row["identifier_masked"], "attempts": row["attempts"]}
                for row in failed
            ],
            "people": list(
                StaffUser.objects.filter(is_active=True).order_by("full_name").values("id", "full_name")
            ),
        })


def _line(row):
    return {
        "id": row.id, "at": row.at, "kind": row.kind, "kind_label": row.get_kind_display(),
        "who": None if row.staff is None else {"id": row.staff.id, "name": row.staff.full_name, "role": row.staff.role.name},
        "identifier": row.identifier_masked, "two_factor": row.two_factor, "note": row.note,
        "ip": row.ip, "device": row.device_label,
    }


def _link_status(event, exports, now):
    after = event.after or {}
    export_id = after.get("export")
    if isinstance(export_id, int) and export_id in exports:
        export = exports[export_id]
        if export.status == ReportExport.READY and export.expires_at and export.expires_at <= now:
            return "expired", "Link expired"
        return export.status, {
            ReportExport.QUEUED: "Being prepared", ReportExport.RUNNING: "Being prepared", ReportExport.READY: "Link ready",
            ReportExport.FAILED: "Failed", ReportExport.EXPIRED: "Link expired",
        }.get(export.status, export.status)
    if after.get("source") == "scheduled":
        if event.occurred_at + timedelta(hours=LINK_HOURS) <= now:
            return "expired", "Link expired"
        return "ready", f"Link sent to {after.get('recipient') or 'the recipient'}"
    return "direct", "Downloaded straight away, no link"


class ExportsLogView(APIView):
    """GET staff-security/exports/?actor=&personal=yes|no|unknown&since=&until=&page=
    — every export in the activity record (verb report.exported), by hand or
    scheduled. Read-only: the lines are activity events nobody can edit or
    remove. `personal_data` is null for older lines that never recorded it."""

    def get_permissions(self):
        return [HasRolePermission("activity.view_all")]

    def get(self, request):
        params = request.query_params
        events = ActivityEvent.objects.filter(verb="report.exported")
        actor = _staff_id(params, "actor")
        if actor:
            events = events.filter(actor_type=ActivityEvent.STAFF, actor_id=actor)
        personal = params.get("personal", "")
        if personal == "yes":
            events = events.filter(after__personal_data=True)
        elif personal == "no":
            events = events.filter(after__personal_data=False)
        elif personal == "unknown":
            events = events.filter(_unrecorded)
        since, until = _date(params, "since"), _date(params, "until")
        if since:
            events = events.filter(occurred_at__date__gte=since)
        if until:
            events = events.filter(occurred_at__date__lte=until)
        count = events.count()
        page = _page(params)
        window = list(events.order_by("-id")[(page - 1) * PAGE_SIZE: page * PAGE_SIZE])
        ids = [e.after.get("export") for e in window if isinstance(e.after, dict) and isinstance(e.after.get("export"), int)]
        exports = ReportExport.objects.in_bulk(ids)
        now = timezone.now()
        rows = []
        for event in window:
            after = event.after if isinstance(event.after, dict) else {}
            state, label = _link_status(event, exports, now)
            rows.append({
                "id": event.id, "at": event.occurred_at,
                "who": event.actor_label or "System", "role": event.actor_role, "scheduled": after.get("source") == "scheduled",
                "what": event.summary or after.get("export") or after.get("kind") or "Export",
                "filters": after.get("filters") if isinstance(after.get("filters"), dict) else {},
                "format": after.get("format") or "", "rows": after.get("rows"),
                "personal_data": after["personal_data"] if isinstance(after.get("personal_data"), bool) else None,
                "link_state": state, "link": label,
            })
        base = ActivityEvent.objects.filter(verb="report.exported")
        month = base.filter(occurred_at__gte=now - timedelta(days=30))
        return Response({
            "count": count, "page": page, "has_next": page * PAGE_SIZE < count, "results": rows,
            "summary": {
                "last_30_days": month.count(),
                "personal_30_days": month.filter(after__personal_data=True).count(),
                "scheduled_30_days": month.filter(after__source="scheduled").count(),
                "not_recorded_30_days": month.filter(_unrecorded).count(),
            },
            "people": list(
                base.filter(actor_type=ActivityEvent.STAFF, actor_id__isnull=False).values("actor_id", "actor_label").distinct().order_by("actor_label")[:200]
            ),
        })


def _policy_payload():
    required = policy.required_roles()
    using = dict(
        StaffTwoFactor.objects.filter(confirmed_at__isnull=False, staff__is_active=True).exclude(secret_encrypted="")
        .values_list("staff__role__name").annotate(n=Count("staff", distinct=True))
    )
    people = dict(StaffUser.objects.filter(is_active=True).values_list("role__name").annotate(n=Count("id")))
    roles = []
    for name, label in Role.NAME_CHOICES:
        roles.append({
            "name": name, "label": label, "people": people.get(name, 0), "using": using.get(name, 0),
            "required": name == Role.SUPER_ADMIN or name in required, "locked": name == Role.SUPER_ADMIN,
        })
    current = policy.current()
    return {
        "roles": roles,
        "limits": policy.limits(),
        "password_protected": [{"title": t, "body": b} for t, b in policy.PASSWORD_PROTECTED],
        "updated_at": current.updated_at if current else None,
        "updated_by": current.updated_by.full_name if current and current.updated_by else None,
        "other_super_admins": StaffUser.objects.filter(role__name=Role.SUPER_ADMIN, is_active=True).count() - 1,
    }


class PolicyView(APIView):
    """GET staff-security/policy/ — who must use 2-step sign-in, how many do,
    the session limits and what asks for the password. PATCH {two_factor_roles:
    [role names]} changes the required roles (Super Admin always stays); it
    needs the password again, is recorded with before and after, and tells any
    other Super Admin."""

    def get_permissions(self):
        if self.request.method == "PATCH":
            return [HasRolePermission(MANAGE), RequiresSudo()]
        return [HasRolePermission(MANAGE)]

    def get(self, request):
        return Response(_policy_payload())

    def patch(self, request):
        wanted = request.data.get("two_factor_roles") if isinstance(request.data, dict) else None
        if not isinstance(wanted, list) or not all(isinstance(r, str) for r in wanted):
            raise ValidationError({"two_factor_roles": "Send a list of role names."})
        valid = {name for name, _ in Role.NAME_CHOICES}
        unknown = sorted(set(wanted) - valid)
        if unknown:
            raise ValidationError({"two_factor_roles": f"Unknown role: {unknown[0]}."})
        roles = set(wanted) - {Role.SUPER_ADMIN}
        with transaction.atomic():
            before = sorted(policy.required_roles())
            policy.set_roles(roles, request.user)
            after = sorted(roles)
            added = sorted(set(after) - set(before))
            removed = sorted(set(before) - set(after))
            if added or removed:
                summary = "; ".join(filter(None, [
                    f"Now required: {', '.join(ROLE_LABELS[r] for r in added)}" if added else "",
                    f"No longer required: {', '.join(ROLE_LABELS[r] for r in removed)}" if removed else "",
                ]))
                for other in StaffUser.objects.filter(role__name=Role.SUPER_ADMIN, is_active=True).exclude(pk=request.user.pk):
                    notify_staff(other, "security_policy_changed", f"{request.user.full_name} changed the 2-step sign-in rules",
                                 body=summary, link="security", icon="🔐")
            # Last, because record() holds the chain lock until commit.
            record(request.user, "security.policy_changed", target_type="security.policy", target_id="1", target_label="2-step sign-in by role",
                   summary=f"2-step sign-in required for: {', '.join(ROLE_LABELS[r] for r in ['super_admin', *after])}",
                   before={"two_factor_roles": before}, after={"two_factor_roles": after}, method="PATCH", request=request)
        return Response(_policy_payload())
