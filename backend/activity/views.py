import csv
import io

from django.db.models import Q
from django.http import HttpResponse
from django.utils import timezone
from django.utils.dateparse import parse_date
from rest_framework import generics
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.exceptions import ValidationError
from rest_framework.pagination import PageNumberPagination

from accounts.models import StaffUser
from accounts.permissions import IsStaff
from reports.exports import ExportNegotiation, FORMATS

from .models import ActivityEvent, ChainCheck
from .serializers import ActivityEventSerializer
from .services import record

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


class FilteredEventsMixin:
    """The filters every activity view shares, applied to what the caller may see."""

    def filtered_events(self):
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
            # Comma-separated prefixes: an action group on the screen is several verb families.
            prefixes = [part for part in params["verb"].split(",") if part][:12]
            if prefixes:
                match = Q()
                for prefix in prefixes:
                    match |= Q(verb__startswith=prefix)
                events = events.filter(match)
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


class ActivityListView(FilteredEventsMixin, generics.ListAPIView):
    serializer_class = ActivityEventSerializer
    pagination_class = ActivityPagination

    def get_permissions(self):
        return [IsStaff()]

    def get_queryset(self):
        return self.filtered_events()


EXPORT_LIMIT = 5000
EXPORT_COLUMNS = ["Time", "Role", "Who", "Action", "On", "Detail"]
FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


def _cell(value):
    text = "" if value is None else str(value)
    return "'" + text if text.startswith(FORMULA_PREFIXES) else text


def _export_row(event):
    local = timezone.localtime(event.occurred_at)
    on = " ".join(part for part in (event.target_type, event.target_label) if part)
    return [local.strftime("%Y-%m-%d %H:%M:%S"), event.actor_role, event.actor_label, event.verb, on, event.summary]


class ActivityExportView(FilteredEventsMixin, APIView):
    """GET activity/export/?format=csv|xlsx plus the list's filters: the same
    view the caller sees, newest first, at most 5,000 rows (the response says
    when it was cut). The export is itself recorded as report.exported."""

    content_negotiation_class = ExportNegotiation

    def get_permissions(self):
        return [IsStaff()]

    def get(self, request):
        fmt = request.query_params.get("format", "csv")
        if fmt not in ("csv", "xlsx"):
            raise ValidationError({"format": "Use csv or xlsx."})
        events = list(self.filtered_events()[: EXPORT_LIMIT + 1])
        truncated = len(events) > EXPORT_LIMIT
        events = events[:EXPORT_LIMIT]
        # Recorded after the read, so the export does not list itself.
        record(request.user, "report.exported", after={"format": fmt, "kind": "staff-activity", "rows": len(events), "truncated": truncated}, request=request)
        rows = [_export_row(event) for event in events]
        stem = f"ashantihub-staff-activity-{timezone.localdate().isoformat()}"
        if fmt == "csv":
            buffer = io.StringIO()
            writer = csv.writer(buffer)
            writer.writerow(EXPORT_COLUMNS)
            for row in rows:
                writer.writerow([_cell(value) for value in row])
            response = HttpResponse("\ufeff" + buffer.getvalue(), content_type=FORMATS["csv"])
        else:
            import xlsxwriter

            target = io.BytesIO()
            workbook = xlsxwriter.Workbook(target, {"in_memory": True, "strings_to_formulas": False, "strings_to_urls": False, "strings_to_numbers": False})
            sheet = workbook.add_worksheet("Staff activity")
            bold = workbook.add_format({"bold": True})
            for col, label in enumerate(EXPORT_COLUMNS):
                sheet.write_string(0, col, label, bold)
            for number, row in enumerate(rows, start=1):
                for col, value in enumerate(row):
                    sheet.write_string(number, col, str(value))
            workbook.close()
            response = HttpResponse(target.getvalue(), content_type=FORMATS["xlsx"])
        response["Content-Disposition"] = f'attachment; filename="{stem}.{fmt}"'
        response["X-Export-Truncated"] = "1" if truncated else "0"
        return response


class ActivityPeopleView(APIView):
    """GET activity/people/ — the staff whose actions the caller can see, for
    the Person filter. Only people who have an event in the visible record."""

    def get_permissions(self):
        return [IsStaff()]

    def get(self, request):
        rows = (
            visible_events(request.user).filter(actor_type=ActivityEvent.STAFF, actor_id__isnull=False)
            .values("actor_id", "actor_label", "actor_role").distinct().order_by("actor_label")
        )
        seen, people = set(), []
        for row in rows[:500]:
            if row["actor_id"] in seen:
                continue
            seen.add(row["actor_id"])
            people.append({"id": row["actor_id"], "name": row["actor_label"], "role": row["actor_role"]})
        return Response(people)


class ChainStatusView(APIView):
    """GET activity/chain-status/ — the last stored result of the nightly chain
    check, or {checked: false} when none has run. Never a guess."""

    def get_permissions(self):
        return [IsStaff()]

    def get(self, request):
        check = ChainCheck.objects.first()
        if check is None:
            return Response({"checked": False})
        return Response({"checked": True, "checked_at": check.checked_at, "ok": check.ok, "events": check.events})
