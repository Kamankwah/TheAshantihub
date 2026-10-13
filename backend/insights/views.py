import re
from datetime import date, time, timedelta

from django.http import FileResponse, HttpResponse
from django.utils import timezone
from rest_framework import generics
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import Role, StaffUser
from accounts.permissions import HasAnyRolePermission, HasRolePermission
from accounts.sessions import require_sudo
from activity.services import record
from reports import services as report_services
from reports.exports import ExportNegotiation, FORMATS

from . import accounting, funnel, generators, hub, money, sales, scheduling, tabular
from .models import ScheduledExport, ScheduledExportFile, ScheduledExportRun

MAX_DAYS = 366
SCHEDULE_PERMISSION = "exports.schedule"


def _date(value, name):
    try:
        return date.fromisoformat(str(value))
    except ValueError:
        raise ValidationError({name: "Use YYYY-MM-DD."}) from None


def _range(params, default_start, default_end):
    start = _date(params["from"], "from") if params.get("from") else default_start
    end = _date(params["to"], "to") if params.get("to") else default_end
    if end < start:
        raise ValidationError({"to": "Pick an end date on or after the start."})
    if (end - start).days + 1 > MAX_DAYS:
        raise ValidationError({"from": "Look at a year or less."})
    return start, end


def _id(params, name):
    value = params.get(name)
    if value in (None, "", "all"):
        return None
    if not (value.isdecimal() and value.isascii()) or len(value) > 9:
        raise ValidationError({name: "Use an id."})
    return int(value)


def _format(params):
    fmt = params.get("format")
    if fmt in (None, ""):
        return None
    if fmt not in FORMATS:
        raise ValidationError({"format": "Use csv, xlsx or pdf."})
    return fmt


def send_document(request, doc, fmt, stem, *, kind, personal=False, filters=None):
    """Answer with a file. Personal data needs the password again first; every
    export is written to the activity log (verb report.exported)."""
    if personal:
        require_sudo(request)
    record(
        request.user, "report.exported", summary=f"Exported {doc['title']}",
        after={"source": "download", "export": kind, "format": fmt, "rows": tabular.row_count(doc), "personal_data": personal, "filters": filters or {}},
        request=request,
    )
    data, content_type = tabular.render(doc, fmt)
    response = HttpResponse(data, content_type=content_type)
    response["Content-Disposition"] = f'attachment; filename="{stem}.{fmt}"'
    return response


class _Base(APIView):
    content_negotiation_class = ExportNegotiation
    permission = None

    def get_permissions(self):
        return [HasRolePermission(self.permission)]


class RevenueView(_Base):
    """GET /api/insights/revenue/?from=&to=&zone=&category=[&format=]"""

    permission = "transactions.report"

    def get(self, request):
        params = request.query_params
        today = timezone.localdate()
        start, end = _range(params, sales.month_start(today), today)
        report = sales.revenue_report(start, end, zone=_id(params, "zone"), category=_id(params, "category"), today=today)
        fmt = _format(params)
        if fmt:
            doc = generators.revenue_document(report)
            return send_document(request, doc, fmt, f"ashantihub-revenue-{start}-{end}", kind="revenue", filters={"from": str(start), "to": str(end)})
        return Response(report)


class AnalyticsView(_Base):
    """GET /api/insights/analytics/?zone=[&format=]"""

    permission = "analytics.view"

    def get(self, request):
        today = timezone.localdate()
        report = sales.analytics_report(zone=_id(request.query_params, "zone"), today=today)
        fmt = _format(request.query_params)
        if fmt:
            doc = generators.GENERATORS["analytics"].build({}, request.user, today)
            return send_document(request, doc, fmt, f"ashantihub-analytics-{today}", kind="analytics")
        return Response(report)


class FunnelView(_Base):
    """GET /api/insights/funnel/?team=&from=&to=[&format=]"""

    permission = "analytics.view"

    def get(self, request):
        params = request.query_params
        today = timezone.localdate()
        start, end = _range(params, today - timedelta(days=180), today)
        report = funnel.funnel_report(team=_id(params, "team"), start=start, end=end)
        fmt = _format(params)
        if fmt:
            doc = tabular.document(f"Growth funnel, places first visited {start} to {end}", [tabular.table(*t) for t in funnel.funnel_document(report)])
            return send_document(request, doc, fmt, f"ashantihub-funnel-{start}-{end}", kind="growth_funnel", filters={"team": report["team"], "from": str(start), "to": str(end)})
        return Response(report)


class ReportsHubView(APIView):
    """GET /api/insights/reports-hub/?period=&date=&role=&status=&person="""

    def get_permissions(self):
        return [HasRolePermission(report_services.VIEW_ALL)]

    def get(self, request):
        params = request.query_params
        period = params.get("period") or "day"
        if period not in ("day", "week", "month"):
            raise ValidationError({"period": "Use day, week or month."})
        day = _date(params["date"], "date") if params.get("date") else timezone.localdate() - timedelta(days=1 if period == "day" else 0)
        status = params.get("status")
        if status and status not in ("all", "waiting", "submitted", "late", "missing", "returned", "acknowledged"):
            raise ValidationError({"status": "Unknown status."})
        return Response(hub.hub_report(request.user, period, day, role=params.get("role") or None, status=status, person=(params.get("person") or "")[:80]))


class RefundsView(_Base):
    """GET /api/insights/refunds/?from=&to=&source=[&format=]"""

    permission = "transactions.report"

    def get(self, request):
        params = request.query_params
        today = timezone.localdate()
        start, end = _range(params, sales.month_start(today), today)
        source = params.get("source")
        if source not in (None, "", "all", "dispute", "ticket"):
            raise ValidationError({"source": "Use dispute or ticket."})
        report = money.refunds_report(start, end, source)
        fmt = _format(params)
        if fmt:
            doc = tabular.document(f"Refunds, {start} to {end}", [tabular.table(*t) for t in money.refunds_document(report)])
            return send_document(request, doc, fmt, f"ashantihub-refunds-{start}-{end}", kind="refunds", personal=True, filters={"from": str(start), "to": str(end), "source": source})
        return Response(report)


class CommissionsView(_Base):
    """GET /api/insights/commissions/ — totals and every scout's lines by status."""

    permission = "commission.view_all"

    def get(self, request):
        return Response(money.commission_report())


class CommissionStatementView(_Base):
    """GET /api/insights/commissions/statement/?format=[&staff=] — one scout's
    statement, or every scout's. Scouts' earnings are personal data."""

    permission = "commission.view_all"

    def get(self, request):
        fmt = _format(request.query_params)
        if not fmt:
            raise ValidationError({"format": "Use csv, xlsx or pdf."})
        staff = _id(request.query_params, "staff")
        doc = tabular.document("Commission statement", [tabular.table(*t) for t in money.statement_document([staff] if staff else None)])
        return send_document(request, doc, fmt, f"ashantihub-commission-statement-{timezone.localdate()}", kind="commission_statements", personal=True, filters={"staff": staff})


class AccountingOverviewView(_Base):
    """GET /api/insights/accounting-overview/ — the Accountant's Money desk."""

    permission = "transactions.report"

    def get(self, request):
        return Response(accounting.overview(request.user))


class CollectionsView(_Base):
    """GET /api/insights/collections/?from=&to=&kind=&status=&q=&page=[&format=] — every
    incoming payment attempt. Payers are named, so a file asks for the password."""

    permission = "transactions.report"

    def get(self, request):
        params = request.query_params
        today = timezone.localdate()
        start, end = _range(params, sales.month_start(today), today)
        kind = params.get("kind") or None
        if kind not in (None, "all", *[key for key, *_ in accounting.COLLECTION_TYPES]):
            raise ValidationError({"kind": "Unknown type."})
        status = params.get("status") or None
        if status not in (None, "all", *accounting.STATUSES):
            raise ValidationError({"status": "Unknown status."})
        page = _id(params, "page") or 1
        fmt = _format(params)
        query = (params.get("q") or "")[:80]
        if fmt:
            # A file holds every row of the filter, not just one page.
            rows = [accounting._collection_row(s) for s in accounting.export_rows(start, end, kind=kind, status=status, query=query)]
            doc = tabular.document(f"Collections, {start} to {end}", [tabular.table(*t) for t in accounting.collections_document({"rows": rows})])
            return send_document(request, doc, fmt, f"ashantihub-collections-{start}-{end}", kind="collections", personal=True, filters={"from": str(start), "to": str(end), "kind": kind, "status": status})
        report = accounting.collections(start, end, kind=kind, status=status, query=query, page=page)
        return Response(report)


class MoneyAlertsView(_Base):
    """GET /api/insights/money-alerts/ — alerts computed on read from refunds and fraud
    cases. POST resolves one with a note (recorded in the activity log, nothing else)."""

    permission = "transactions.report"

    def get(self, request):
        return Response(accounting.money_alerts())

    def post(self, request):
        key = str(request.data.get("key") or "")
        note = str(request.data.get("note") or "").strip()
        if len(note) < 5 or len(note) > 280:
            raise ValidationError({"note": "Write a note of 5 to 280 characters."})
        alert = next((a for a in accounting.money_alerts()["alerts"] if a["key"] == key), None)
        if alert is None or not alert["resolvable"]:
            raise ValidationError({"key": "That alert is not open."})
        if alert["resolved"]:
            raise ValidationError({"key": "That alert was already resolved."})
        record(request.user, accounting.RESOLVED_VERB, target_type="insights.moneyalert", target_id=key, target_label=alert["title"], summary=note, after={"note": note}, request=request)
        return Response(accounting.money_alerts())


# ------------------------------------------------------------ scheduled exports

class SchedulePermission:
    @staticmethod
    def classes():
        return [HasRolePermission(SCHEDULE_PERMISSION)]


def _schedule_payload(s, runs=3):
    gen = generators.GENERATORS.get(s.kind)
    recent = list(s.runs.all()[:runs])
    last = recent[0] if recent else None
    return {
        "id": s.pk, "name": s.name, "kind": s.kind, "kind_label": gen.label if gen else s.kind, "description": gen.description if gen else "",
        "filters": s.filters, "format": s.format, "frequency": s.frequency, "weekday": s.weekday, "day_of_month": s.day_of_month,
        "run_time": s.run_time.strftime("%H:%M"), "personal_data": s.personal_data,
        "recipients": [{"id": r.pk, "full_name": r.full_name, "role": r.role.name} for r in s.recipients.all()],
        "status": "paused" if s.paused_at else "active", "paused_at": s.paused_at, "paused_by": s.paused_by.full_name if s.paused_by else None,
        "next_run_at": None if s.paused_at else s.next_run_at, "last_run_at": s.last_run_at,
        "created_by": s.created_by.full_name, "password_confirmed_at": s.password_confirmed_at,
        "last_run": None if last is None else {"id": last.pk, "status": last.status, "started_at": last.started_at, "rows": last.rows, "error": last.error},
        "runs": [{"id": r.pk, "status": r.status, "started_at": r.started_at, "rows": r.rows, "error": r.error} for r in recent],
    }


def _clean(data, existing=None):
    if not isinstance(data, dict):
        raise ValidationError({"detail": "Send the schedule as a JSON object."})
    name = str(data.get("name", existing.name if existing else "")).strip()
    if not name or len(name) > 120:
        raise ValidationError({"name": "Give the schedule a name of up to 120 characters."})
    kind = data.get("kind", existing.kind if existing else None)
    gen = generators.GENERATORS.get(kind)
    if gen is None:
        raise ValidationError({"kind": "Pick one of the exports offered."})
    fmt = data.get("format", existing.format if existing else None)
    if fmt not in FORMATS:
        raise ValidationError({"format": "Use csv, xlsx or pdf."})
    frequency = data.get("frequency", existing.frequency if existing else None)
    if frequency not in dict(ScheduledExport.FREQUENCY_CHOICES):
        raise ValidationError({"frequency": "Pick every day, week or month."})
    weekday = day_of_month = None
    if frequency == ScheduledExport.WEEKLY:
        weekday = data.get("weekday", existing.weekday if existing else None)
        if not isinstance(weekday, int) or isinstance(weekday, bool) or not 0 <= weekday <= 6:
            raise ValidationError({"weekday": "Pick a day of the week."})
    if frequency == ScheduledExport.MONTHLY:
        day_of_month = data.get("day_of_month", existing.day_of_month if existing else None)
        if not isinstance(day_of_month, int) or isinstance(day_of_month, bool) or not 1 <= day_of_month <= 28:
            raise ValidationError({"day_of_month": "Pick a day from 1 to 28, so every month has it."})
    raw_time = str(data.get("run_time", existing.run_time.strftime("%H:%M") if existing else ""))
    if not re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", raw_time):
        raise ValidationError({"run_time": "Use HH:MM, like 07:00."})
    filters = data.get("filters", existing.filters if existing else {})
    if not isinstance(filters, dict):
        raise ValidationError({"filters": "Filters must be an object."})
    period = filters.get("period")
    if gen.presets:
        period = period or gen.presets[0]
        if period not in gen.presets:
            raise ValidationError({"filters": "That period is not offered for this export."})
        filters = {"period": period}
    else:
        filters = {}
    if kind == "growth_funnel" and data.get("filters", {}).get("team") not in (None, ""):
        team = data["filters"]["team"]
        if not isinstance(team, int) or isinstance(team, bool) or not StaffUser.objects.filter(pk=team).exists():
            raise ValidationError({"filters": "Pick a team lead."})
        filters["team"] = team
    ids = data.get("recipients", [r.pk for r in existing.recipients.all()] if existing else [])
    if not isinstance(ids, list) or not ids or len(ids) > scheduling.MAX_RECIPIENTS or any(not isinstance(i, int) or isinstance(i, bool) for i in ids):
        raise ValidationError({"recipients": f"Name between 1 and {scheduling.MAX_RECIPIENTS} people."})
    people = list(StaffUser.objects.filter(pk__in=ids, is_active=True, is_suspended=False, invite_token__isnull=True).select_related("role"))
    if len(people) != len(set(ids)):
        raise ValidationError({"recipients": "Every recipient must be active staff."})
    refused = [p.full_name for p in people if not generators.allowed(kind, p)]
    if refused:
        raise ValidationError({"recipients": f"{', '.join(refused)} may not receive {gen.label.lower()}."})
    return {"name": name, "kind": kind, "format": fmt, "frequency": frequency, "weekday": weekday, "day_of_month": day_of_month,
            "run_time": time(int(raw_time[:2]), int(raw_time[3:])), "filters": filters, "personal_data": gen.personal}, people


class ScheduledExportsView(APIView):
    """GET /api/insights/exports/ — the schedules, the exports on offer and run
    counts. POST creates one (a personal-data schedule needs the password)."""

    def get_permissions(self):
        return SchedulePermission.classes()

    def get(self, request):
        schedules = list(ScheduledExport.objects.select_related("created_by", "paused_by").prefetch_related("recipients__role", "runs"))
        week = timezone.now() - timedelta(days=7)
        recent = ScheduledExportRun.objects.filter(started_at__gte=week)
        files = ScheduledExportFile.objects.filter(run__started_at__gte=week).exclude(file_name="")
        return Response({
            "schedules": [_schedule_payload(s) for s in schedules],
            "kinds": [
                {"key": g.key, "label": g.label, "description": g.description, "personal_data": g.personal,
                 "presets": [{"key": p, "label": generators.PRESETS[p]} for p in g.presets]}
                for g in generators.GENERATORS.values()
            ],
            "team_options": funnel.team_options(),
            "kpis": {
                "active": sum(1 for s in schedules if not s.paused_at), "active_personal": sum(1 for s in schedules if not s.paused_at and s.personal_data),
                "paused": sum(1 for s in schedules if s.paused_at), "runs_7_days": recent.count(),
                "runs_with_problems": recent.exclude(status=ScheduledExportRun.OK).count(),
                "never_opened": files.filter(first_opened_at__isnull=True, expires_at__lt=timezone.now()).count(),
            },
            "staff": [
                {"id": p.pk, "full_name": p.full_name, "role": p.role.name}
                for p in StaffUser.objects.filter(is_active=True, is_suspended=False, invite_token__isnull=True).select_related("role").order_by("full_name")
            ],
        })

    def post(self, request):
        fields, people = _clean(request.data)
        if fields["personal_data"]:
            require_sudo(request)
        schedule = ScheduledExport(created_by=request.user, **fields)
        if fields["personal_data"]:
            schedule.password_confirmed_at = timezone.now()
        schedule.next_run_at = scheduling.next_run_after(schedule, timezone.now())
        schedule.save()
        schedule.recipients.set(people)
        return Response(_schedule_payload(ScheduledExport.objects.get(pk=schedule.pk)), status=201)


class ScheduledExportDetailView(APIView):
    def get_permissions(self):
        return SchedulePermission.classes()

    def patch(self, request, pk):
        schedule = generics.get_object_or_404(ScheduledExport, pk=pk)
        fields, people = _clean(request.data, schedule)
        if fields["personal_data"] or schedule.personal_data:
            require_sudo(request)  # editing a schedule that carries personal data asks again
        for key, value in fields.items():
            setattr(schedule, key, value)
        if fields["personal_data"]:
            schedule.password_confirmed_at = timezone.now()
        schedule.next_run_at = scheduling.next_run_after(schedule, timezone.now())
        schedule.save()
        schedule.recipients.set(people)
        return Response(_schedule_payload(ScheduledExport.objects.get(pk=schedule.pk)))


class _PauseView(APIView):
    pause = True

    def get_permissions(self):
        return SchedulePermission.classes()

    def post(self, request, pk):
        schedule = generics.get_object_or_404(ScheduledExport, pk=pk)
        if self.pause:
            schedule.paused_at, schedule.paused_by = timezone.now(), request.user
        else:
            schedule.paused_at, schedule.paused_by = None, None
            schedule.next_run_at = scheduling.next_run_after(schedule, timezone.now())
        schedule.save(update_fields=["paused_at", "paused_by", "next_run_at", "updated_at"])
        return Response(_schedule_payload(ScheduledExport.objects.get(pk=pk)))


class SchedulePauseView(_PauseView):
    pause = True


class ScheduleResumeView(_PauseView):
    pause = False


class ScheduledExportRunsView(APIView):
    def get_permissions(self):
        return SchedulePermission.classes()

    def get(self, request, pk):
        schedule = generics.get_object_or_404(ScheduledExport, pk=pk)
        return Response([
            {"id": r.pk, "status": r.status, "started_at": r.started_at, "finished_at": r.finished_at, "rows": r.rows, "error": r.error,
             "files": [{"recipient": f.recipient.full_name, "error": f.error, "opened": f.first_opened_at is not None, "row_count": f.row_count} for f in r.files.select_related("recipient")]}
            for r in schedule.runs.prefetch_related("files")[:30]
        ])


class MyExportFilesView(APIView):
    """GET /api/insights/exports/files/mine/ — files sent to me that are still valid."""

    def get_permissions(self):
        from accounts.permissions import IsStaff

        return [IsStaff()]

    def get(self, request):
        files = ScheduledExportFile.objects.filter(recipient=request.user, purged=False, expires_at__gt=timezone.now()).exclude(file_name="").select_related("run__schedule")
        return Response([
            {"id": f.pk, "name": f.run.schedule.name, "file_name": f.download_name, "expires_at": f.expires_at, "download_url": scheduling.link_for(f)}
            for f in files
        ])


class ExportFileDownloadView(APIView):
    def get_permissions(self):
        from accounts.permissions import IsStaff

        return [IsStaff()]

    def get(self, request, pk):
        file = generics.get_object_or_404(ScheduledExportFile, pk=pk, recipient=request.user)
        if not scheduling.signature_matches(file, request.query_params.get("sig")):
            return Response({"detail": "This download link has expired."}, status=403)
        path = scheduling.directory() / file.file_name
        if file.purged or not file.file_name or file.expires_at is None or file.expires_at <= timezone.now() or not path.exists():
            return Response({"detail": "This export isn't available any more."}, status=410)
        schedule = file.run.schedule
        # Access may have changed since the file was made: re-check the downloader now.
        if not generators.allowed(schedule.kind, request.user):
            return Response({"detail": "You may no longer receive this export."}, status=403)
        if file.first_opened_at is None:
            file.first_opened_at = timezone.now()
            file.save(update_fields=["first_opened_at"])
        # Who took which file, never what is in it.
        record(request.user, "export.downloaded", target=schedule, method="GET", request=request,
               summary=f"Downloaded the scheduled export: {schedule.name}",
               after={"source": "scheduled", "export": schedule.kind, "format": schedule.format, "rows": file.row_count,
                      "personal_data": schedule.personal_data, "file": file.pk})
        return FileResponse(open(path, "rb"), as_attachment=True, filename=file.download_name)
