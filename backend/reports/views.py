import logging
from datetime import date

from django.db import transaction
from django.http import FileResponse, QueryDict
from django.utils import timezone
from django.utils.text import slugify
from rest_framework import generics
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import Role, StaffUser
from accounts.permissions import IsStaff
from accounts.serializers import staff_brief
from accounts.sessions import require_sudo
from activity.services import record

from . import exports, services
from .models import ReportExport, StaffReport
from .serializers import report_payload
from .tasks import build_report_export, fail_export

logger = logging.getLogger(__name__)


def _period(value):
    period = value or StaffReport.DAY
    if not isinstance(period, str) or period not in dict(StaffReport.PERIOD_CHOICES):
        raise ValidationError({"period": "Use day, week or month."})
    return period


def _date(value, name="date", *, required=False):
    if not value:
        if required:
            raise ValidationError({name: "Pick a date."})
        return timezone.localdate()
    try:
        return date.fromisoformat(str(value))
    except ValueError:
        raise ValidationError({name: "Use YYYY-MM-DD."}) from None


def _bounds(period, day):
    """period_bounds, with a far-future or far-past date turned into a 400."""
    try:
        return services.period_bounds(period, day)
    except (OverflowError, ValueError):
        raise ValidationError({"detail": "That date is out of range."}) from None


def _error(exc):
    return Response({"detail": exc.message}, status=exc.status_code)


def _not_an_object(request):
    """A 400 response when the body isn't a JSON object, else None."""
    if isinstance(request.data, (dict, QueryDict)):
        return None
    return Response({"detail": "Send the report as a JSON object."}, status=400)


class ReportPagination(PageNumberPagination):
    page_size = 20


class MyReportsView(APIView):
    """GET: my reports, newest first. POST: save my draft for a period."""

    def get_permissions(self):
        return [IsStaff()]

    def get(self, request):
        reports = StaffReport.objects.filter(staff=request.user).select_related("staff__role", "reviewer__role")
        if request.query_params.get("period"):
            reports = reports.filter(period=_period(request.query_params["period"]))
        paginator = ReportPagination()
        page = paginator.paginate_queryset(reports.order_by("-period_start", "-id"), request, view=self)
        return paginator.get_paginated_response(
            [report_payload(report, request.user, include_system=False) for report in page]
        )

    def post(self, request):
        if (bad := _not_an_object(request)) is not None:
            return bad
        period = _period(request.data.get("period"))
        day = _date(request.data.get("date"))
        _bounds(period, day)
        try:
            report = services.save_draft(request.user, period, day, request.data)
        except services.ReportError as exc:
            return _error(exc)
        # Action responses skip the system numbers: the panels refetch.
        return Response(report_payload(report, request.user, include_system=False))


class CurrentReportView(APIView):
    def get_permissions(self):
        return [IsStaff()]

    def get(self, request):
        period = _period(request.query_params.get("period"))
        day = _date(request.query_params.get("date"))
        _bounds(period, day)
        if day > timezone.localdate():
            raise ValidationError({"date": "That day hasn't started yet."})
        return Response(report_payload(services.build(request.user, period, day), request.user))


class ReportDetailView(APIView):
    def get_permissions(self):
        return [IsStaff()]

    def get(self, request, pk):
        report = generics.get_object_or_404(
            services.visible_reports(request.user).select_related("staff__role", "reviewer__role"), pk=pk
        )
        return Response(report_payload(report, request.user))

    def patch(self, request, pk):
        if (bad := _not_an_object(request)) is not None:
            return bad
        report = generics.get_object_or_404(StaffReport, pk=pk, staff=request.user)
        try:
            report = services.save_draft(request.user, report.period, report.period_start, request.data)
        except services.ReportError as exc:
            return _error(exc)
        return Response(report_payload(report, request.user, include_system=False))


class ReportSubmitView(APIView):
    def get_permissions(self):
        return [IsStaff()]

    def post(self, request, pk):
        report = generics.get_object_or_404(StaffReport.objects.select_related("staff__role"), pk=pk, staff=request.user)
        try:
            services.submit(report, http_request=request)
        except services.ReportError as exc:
            return _error(exc)
        return Response(report_payload(report, request.user, include_system=False))


class _ReviewView(APIView):
    def get_permissions(self):
        return [IsStaff()]

    def review(self, report, request):
        raise NotImplementedError

    def post(self, request, pk):
        if (bad := _not_an_object(request)) is not None:
            return bad
        report = generics.get_object_or_404(
            services.visible_reports(request.user).select_related("staff__role"), pk=pk
        )
        try:
            self.review(report, request)
        except services.ReportError as exc:
            return _error(exc)
        return Response(report_payload(report, request.user, include_system=False))


class ReportAcknowledgeView(_ReviewView):
    def review(self, report, request):
        services.acknowledge(report, request.user, note=str(request.data.get("note") or ""), http_request=request)


class ReportReturnView(_ReviewView):
    def review(self, report, request):
        services.return_report(report, request.user, note=str(request.data.get("note") or ""), http_request=request)


class TeamReportsView(APIView):
    """My direct reports' reports for one period (managers); everyone's with
    ?scope=all (reports.view_all). A draft shows as null — not submitted yet."""

    def get_permissions(self):
        return [IsStaff()]

    def get(self, request):
        params = request.query_params
        period = _period(params.get("period"))
        start, _ = _bounds(period, _date(params.get("date")))
        scope = params.get("scope")
        if scope not in (None, "", "all"):
            raise ValidationError({"detail": "Use scope=all or leave it out."})
        view_all = services.VIEW_ALL in request.user.effective_permission_codenames()
        if scope == "all":
            if not view_all:
                raise PermissionDenied("Only a Super Admin can see everyone's reports.")
            # Everyone who works here now: not pending invitees, not suspended.
            people = StaffUser.objects.filter(
                is_active=True, is_suspended=False, invite_token__isnull=True
            ).exclude(pk=request.user.pk)
        else:
            people = StaffUser.objects.filter(manager=request.user, is_active=True)
        people = list(people.select_related("role").order_by("full_name"))
        reports = {
            report.staff_id: report
            for report in StaffReport.objects.select_related("staff__role", "reviewer__role")
            .filter(period=period, period_start=start, staff__in=people)
            .exclude(status=StaffReport.DRAFT)
        }
        return Response({
            "period": period,
            "period_start": start,
            "rows": [
                {
                    "staff": staff_brief(member),
                    "report": report_payload(reports[member.pk], request.user, include_system=False, view_all=view_all)
                    if member.pk in reports else None,
                }
                for member in people
            ],
        })


QUEUE_DOWN = "Background jobs are unavailable right now — try a range of 31 days or less."
MAX_STAFF_ID = 2**31 - 1


def _format(params):
    fmt = params.get("format", "")
    if fmt not in exports.FORMATS:
        raise ValidationError({"format": "Use csv, xlsx or pdf."})
    return fmt


def _enqueue(export_id):
    """Runs after the export row commits. A broker that is down must not leave
    the export queued forever: mark it failed and tell the requester."""
    try:
        build_report_export.delay(export_id)
    except Exception:
        logger.exception("Could not queue report export %s", export_id)
        export = ReportExport.objects.select_related("requester").get(pk=export_id)
        fail_export(export, QUEUE_DOWN)


class ReportExportView(APIView):
    """GET /api/reports/<id>/export/?format= — one report."""

    content_negotiation_class = exports.ExportNegotiation

    def get_permissions(self):
        return [IsStaff()]

    def get(self, request, pk):
        fmt = _format(request.query_params)
        report = generics.get_object_or_404(
            services.visible_reports(request.user).select_related("staff__role", "reviewer__role"), pk=pk
        )
        if report.staff_id != request.user.pk:
            require_sudo(request)  # someone else's report is personal data
        record(request.user, "report.exported", target=report, after={"format": fmt, "report": report.pk}, request=request)
        stem = f"report-{slugify(report.staff.full_name)}-{report.period}-{report.period_start}"
        return exports.export_response([report], fmt, stem, str(report))


class ReportRangeExportView(APIView):
    """GET /api/reports/export/?from=&to=&format=[&staff=&role=&period=]"""

    content_negotiation_class = exports.ExportNegotiation

    def get_permissions(self):
        return [IsStaff()]

    def get(self, request):
        params = request.query_params
        fmt = _format(params)
        start = _date(params.get("from"), "from", required=True)
        end = _date(params.get("to"), "to", required=True)
        if end < start:
            raise ValidationError({"to": "Pick an end date on or after the start."})
        filters = {"from": start.isoformat(), "to": end.isoformat()}
        if params.get("staff"):
            staff = params["staff"]
            if not (staff.isdecimal() and staff.isascii()) or not 1 <= int(staff) <= MAX_STAFF_ID:
                raise ValidationError({"staff": "Use a staff id."})
            if not exports.may_export_staff(request.user, int(staff)):
                raise PermissionDenied("You can export only your own and your team's reports.")
            filters["staff"] = int(staff)
        if params.get("role"):
            if "\x00" in params["role"] or not Role.objects.filter(name=params["role"]).exists():
                raise ValidationError({"role": "Unknown role."})
            filters["role"] = params["role"]
        if params.get("period"):
            filters["period"] = _period(params["period"])
        reports = exports.export_queryset(request.user, filters)
        if exports.reaches_others(request.user, filters):
            require_sudo(request)  # other people's reports are personal data
        count = reports.count()
        background = (end - start).days + 1 > exports.BACKGROUND_DAYS or count > exports.BACKGROUND_ROWS
        background = background or (fmt == "pdf" and count > exports.PDF_SYNC_ROWS)
        after = {"filters": filters, "format": fmt, "rows": count, "background": background}
        if background:
            # record() holds a global lock until commit, so it goes last.
            with transaction.atomic():
                export = ReportExport.objects.create(requester=request.user, filters=filters, format=fmt)
                transaction.on_commit(lambda: _enqueue(export.pk), robust=True)
                record(request.user, "report.exported", after={**after, "export": export.pk}, request=request)
            return Response({"id": export.pk, "status": export.status}, status=202)
        record(request.user, "report.exported", after=after, request=request)
        return exports.export_response(list(reports), fmt, f"ashantihub-reports-{start}-{end}", exports.range_title(filters))


class ReportExportListView(APIView):
    def get_permissions(self):
        return [IsStaff()]

    def get(self, request):
        return Response([exports.export_payload(e) for e in ReportExport.objects.filter(requester=request.user)[:20]])


class ReportExportDownloadView(APIView):
    def get_permissions(self):
        return [IsStaff()]

    def get(self, request, pk):
        export = generics.get_object_or_404(ReportExport, pk=pk, requester=request.user)
        if not exports.signature_matches(export, request.query_params.get("sig")):
            return Response({"detail": "This download link has expired. Export again."}, status=403)
        path = exports.export_path(export)
        expired = export.expires_at is None or export.expires_at <= timezone.now()
        if expired or export.status != ReportExport.READY or not export.file_name or not path.exists():
            return Response({"detail": "This export isn't available any more."}, status=410)
        return FileResponse(open(path, "rb"), as_attachment=True, filename=exports.download_filename(export))
