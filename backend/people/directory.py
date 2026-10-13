"""Staff directory (SA-4 screen 04): every staff account with role, manager,
team, status, last sign-in and 2-step state; the filters, the header counts,
"Worth a look" and the CSV (password again, recorded as an export of personal
data). Only facts the tables hold are shown."""
from datetime import timedelta

from django.db.models import Count, Q
from django.utils import timezone
from rest_framework import generics
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import Role, StaffSession, StaffUser
from accounts.permissions import HasRolePermission, RequiresSudo
from accounts.phones import filter_by_phone, phone_key
from marketplace.common import csv_export
from portfolio.areas import scout_areas
from targets.models import Leave

from .common import (
    ACTIVE, DEACTIVATED, DECIDING_PERMISSIONS, INVITE_EXPIRED, INVITED, ROLE_LABELS, ROLE_ORDER, STATUSES, SUSPENDED,
    PeoplePagination, effective, role_rank, status_of, two_step_label, with_directory_columns,
)

SOON = timedelta(days=3)


def _status_q(status, now):
    if status == DEACTIVATED:
        return Q(is_active=False)
    live = Q(is_active=True)
    if status == SUSPENDED:
        return live & Q(is_suspended=True)
    open_ = live & Q(is_suspended=False)
    if status == ACTIVE:
        return open_ & Q(invite_token__isnull=True)
    pending = open_ & Q(invite_token__isnull=False)
    if status == INVITE_EXPIRED:
        return pending & Q(invite_expires_at__lt=now)
    return pending & ~Q(invite_expires_at__lt=now)


def filtered(params, now=None):
    """The directory's rows for ?q= &role= &manager= &status= &two_step=on|off &last_sign_in=today|stale7|never."""
    now = now or timezone.now()
    staff = with_directory_columns(StaffUser.objects.select_related("role", "manager"))
    status = params.get("status")
    if status in STATUSES:
        staff = staff.filter(_status_q(status, now))
    if params.get("role") in dict(Role.NAME_CHOICES):
        staff = staff.filter(role__name=params["role"])
    manager = params.get("manager") or ""
    if manager.isdecimal() and len(manager) < 10:
        staff = staff.filter(manager_id=int(manager))
    if params.get("two_step") in ("on", "off"):
        staff = staff.filter(has_two_step=params["two_step"] == "on", invite_token__isnull=True)
    when = params.get("last_sign_in")
    today = timezone.localtime(now).replace(hour=0, minute=0, second=0, microsecond=0)
    if when == "today":
        staff = staff.filter(last_sign_in_at__gte=today)
    elif when == "stale7":
        staff = staff.filter(last_sign_in_at__lt=now - timedelta(days=7))
    elif when == "never":
        staff = staff.filter(last_sign_in_at__isnull=True)
    text = (params.get("q") or "").strip()
    if text:
        match = Q(full_name__icontains=text) | Q(email__icontains=text)
        if phone_key(text):
            match |= Q(pk__in=filter_by_phone(StaffUser.objects.all(), "phone", text).values("pk"))
        staff = staff.filter(match)
    return staff.annotate(report_count=Count("direct_reports", filter=Q(direct_reports__is_active=True), distinct=True)).order_by(role_rank(), "full_name", "pk")


def _leave_now(ids, today):
    return {l.staff_id: l for l in Leave.objects.filter(staff_id__in=ids, start__lte=today, end__gte=today).order_by("end")}


def rows_for(staff_list, now=None):
    """Directory rows for a page of staff (with_directory_columns applied)."""
    now = now or timezone.now()
    today = timezone.localdate(now)
    scouts = [s for s in staff_list if s.role.name == Role.SCOUT]
    areas = scout_areas(scouts) if scouts else {}
    leave = _leave_now([s.pk for s in staff_list], today)
    rows = []
    for s in staff_list:
        status = status_of(s, now)
        note = ""
        if status == SUSPENDED:
            note = s.suspension_reason or ""
        elif status in (INVITED, INVITE_EXPIRED):
            note = "invite"
        rows.append({
            "id": s.pk, "name": s.full_name, "email": s.email,
            "role": s.role.name, "role_label": ROLE_LABELS.get(s.role.name, s.role.name),
            "manager": {"id": s.manager_id, "name": s.manager.full_name} if s.manager_id else None,
            "areas": areas.get(s.pk, sorted(z.name for z in s.areas.all())) if s.role.name == Role.SCOUT else [],
            "reports": s.report_count,
            "status": status, "status_note": note, "invite_expires_at": s.invite_expires_at if note == "invite" else None,
            "on_leave_to": leave[s.pk].end if s.pk in leave else None,
            "last_sign_in_at": s.last_sign_in_at,
            "two_step": two_step_label(s), "two_step_required": s.role.name == Role.SUPER_ADMIN,
        })
    return rows


class StaffDirectoryView(generics.ListAPIView):
    """GET /api/people/staff/?q=&role=&manager=&status=&two_step=&last_sign_in=&page="""

    pagination_class = PeoplePagination

    def get_permissions(self):
        return [HasRolePermission("staff.manage")]

    def get_queryset(self):
        return filtered(self.request.query_params)

    def list(self, request, *args, **kwargs):
        page = self.paginate_queryset(self.get_queryset().prefetch_related("areas"))
        return self.get_paginated_response(rows_for(list(page)))


def worth_a_look(now):
    """Four kinds of thing the directory points out, each from a stored fact."""
    items = []
    people = list(with_directory_columns(
        StaffUser.objects.select_related("role", "manager").prefetch_related("role__permissions", "extra_permissions", "revoked_permissions")
    ))
    for s in people:
        status = status_of(s, now)
        if status == SUSPENDED:
            items.append({"kind": "suspended", "staff": s.pk, "name": s.full_name, "text": f"is suspended{': ' + s.suspension_reason if s.suspension_reason else ''}."})
        elif status == INVITE_EXPIRED:
            items.append({"kind": "invite_expired", "staff": s.pk, "name": s.full_name, "text": "was invited and the link has run out. Send a new one or remove the invite."})
        elif status == INVITED and s.invite_expires_at and s.invite_expires_at - now <= SOON and s.invite_opened_at is None:
            items.append({"kind": "invite_ending", "staff": s.pk, "name": s.full_name, "text": "hasn't opened the invite yet and it ends soon.", "expires_at": s.invite_expires_at})
        elif status == ACTIVE and not s.has_two_step and s.role.name != Role.SUPER_ADMIN and effective(s) & set(DECIDING_PERMISSIONS):
            items.append({"kind": "no_two_step", "staff": s.pk, "name": s.full_name, "text": "decides requests and does not use 2-step sign-in. You could ask them to turn it on."})
    # A new kind of device today: the first session today with a device label the person has not used before.
    today = timezone.localtime(now).replace(hour=0, minute=0, second=0, microsecond=0)
    for session in StaffSession.objects.filter(created_at__gte=today, staff__is_active=True).select_related("staff").order_by("created_at"):
        earlier = StaffSession.objects.filter(staff=session.staff, created_at__lt=today)
        if earlier.exists() and not earlier.filter(device_label=session.device_label).exists():
            if not any(i["kind"] == "new_device" and i["staff"] == session.staff_id for i in items):
                items.append({"kind": "new_device", "staff": session.staff_id, "name": session.staff.full_name, "text": f"signed in on a new kind of device today ({session.device_label})."})
    return items[:12]


class StaffDirectoryCountsView(APIView):
    """GET /api/people/staff/counts/ — the header chips, counts by role, the
    2-step line and "Worth a look". Whole staff, whatever the list filters say."""

    def get_permissions(self):
        return [HasRolePermission("staff.manage")]

    def get(self, request):
        now = timezone.now()
        staff = list(with_directory_columns(StaffUser.objects.select_related("role")))
        counts = {s: 0 for s in STATUSES}
        by_role = {name: {"role": name, "label": ROLE_LABELS.get(name, name), **{s: 0 for s in STATUSES}, "total": 0} for name in ROLE_ORDER}
        two_step_on = active = 0
        for s in staff:
            status = status_of(s, now)
            counts[status] += 1
            row = by_role.setdefault(s.role.name, {"role": s.role.name, "label": s.role.name, **{x: 0 for x in STATUSES}, "total": 0})
            row[status] += 1
            row["total"] += 1
            if status == ACTIVE:
                active += 1
                two_step_on += 1 if s.has_two_step else 0
        managers = [
            {"id": s.pk, "name": s.full_name, "role": s.role.name}
            for s in StaffUser.objects.filter(direct_reports__isnull=False).select_related("role").distinct().order_by("full_name")
        ]
        return Response({
            "all": len(staff), **counts,
            "by_role": [row for row in by_role.values() if row["total"]],
            "two_step": {"on": two_step_on, "active": active},
            "managers": managers,
            "worth_a_look": worth_a_look(now),
        })


EXPORT_HEADER = ["Name", "Email", "Phone", "Role", "Manager", "Status", "Last sign-in", "2-step sign-in"]


class StaffDirectoryExportView(APIView):
    """GET /api/people/staff/export/ — CSV of the filtered directory. Holds names,
    emails and phone numbers: password again, and the export is recorded as personal data."""

    def get_permissions(self):
        return [HasRolePermission("staff.manage"), RequiresSudo()]

    def get(self, request):
        params = request.query_params
        now = timezone.now()
        rows = []
        for s in filtered(params, now):
            rows.append([
                s.full_name, s.email, s.phone or "", ROLE_LABELS.get(s.role.name, s.role.name),
                s.manager.full_name if s.manager_id else "", status_of(s, now),
                timezone.localtime(s.last_sign_in_at).strftime("%Y-%m-%d %H:%M") if s.last_sign_in_at else "",
                {"on": "On", "off": "Off", None: ""}[two_step_label(s)],
            ])
        filters = {k: params[k] for k in ("q", "role", "manager", "status", "two_step", "last_sign_in") if params.get(k)}
        return csv_export(request, stem="staff-directory", header=EXPORT_HEADER, rows=rows, kind="staff directory", personal_data=True, filters=filters)
