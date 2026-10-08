"""Report exports (staff foundations F6): CSV (UTF-8 with a BOM, formula-
escaped), Excel (XlsxWriter, constant memory) and PDF (WeasyPrint, with SVG
bar charts). Ranges over 31 days or 5,000 rows are built by a Celery job into
PRIVATE_MEDIA_ROOT and served by a permission-checked view behind a signed
link valid 24 hours."""
import csv
import hmac
import io
from pathlib import Path
from urllib.parse import quote

from django.conf import settings
from django.core import signing
from django.db.models import Q
from django.http import HttpResponse, StreamingHttpResponse
from django.template.loader import render_to_string
from django.utils import timezone
from rest_framework.negotiation import DefaultContentNegotiation
from weasyprint.urls import URLFetcher

from accounts.models import StaffUser

from . import services
from .models import ReportExport, StaffReport

FORMATS = {
    "csv": "text/csv; charset=utf-8",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "pdf": "application/pdf",
}
FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")
BACKGROUND_DAYS = 31
BACKGROUND_ROWS = 5000
PDF_SYNC_ROWS = 200  # a bigger PDF is built by the job, not inside a 60 s web request
GENERIC_ERROR = "We couldn't build that file. Try again, or pick a shorter range."
LINK_SALT = "reports.export-download"
LINK_MAX_AGE = 24 * 60 * 60
CHART_WIDTH = 230
COLUMNS = [
    ("staff", "Staff"), ("role", "Role"), ("period", "Period"), ("period_start", "From"), ("period_end", "To"),
    ("status", "Status"), ("submitted_at", "Submitted"), ("is_late", "Late"), ("system", "System numbers"),
    ("achievements", "Achievements"), ("blockers", "Blockers"), ("plan_next", "Plan"),
    ("plan_results", "Previous plan"), ("reviewer", "Reviewed by"), ("review_note", "Review note"),
    ("similarity", "Similarity"),
]


class ExportNegotiation(DefaultContentNegotiation):
    """Exports take ?format=csv|xlsx|pdf (spec F6), which DRF would otherwise
    read as its own renderer override and answer 404 before the view runs.
    Error bodies are always JSON."""

    def select_renderer(self, request, renderers, format_suffix=None):
        return renderers[0], renderers[0].media_type


def escape_cell(value):
    """Spreadsheet formula injection: a cell that starts = + - @ tab or CR
    gets a leading apostrophe so Excel and Sheets show it as text."""
    text = "" if value is None else str(value)
    return "'" + text if text.startswith(FORMULA_PREFIXES) else text


def _system_text(sections):
    parts = []
    for section in sections or []:
        rows = ", ".join(f"{row.get('label', '')} {row.get('value', '')}" for row in section.get("rows", []))
        parts.append(f"{section.get('title', '')}: {rows}")
    return "; ".join(parts)


def report_row(report):
    submitted = timezone.localtime(report.submitted_at).strftime("%Y-%m-%d %H:%M") if report.submitted_at else ""
    return {
        "staff": report.staff.full_name,
        "role": report.staff.role.name,
        "period": report.get_period_display(),
        "period_start": report.period_start.isoformat(),
        "period_end": report.period_end.isoformat(),
        "status": report.get_status_display(),
        "submitted_at": submitted,
        "is_late": "yes" if report.is_late else "no",
        "system": _system_text(report.system_snapshot),
        "achievements": report.achievements,
        "blockers": report.blockers,
        "plan_next": "; ".join(str(item) for item in report.plan_next),
        "plan_results": "; ".join(
            f"{row.get('item', '')}: {row.get('result') or 'not marked'}" for row in report.plan_results
        ),
        "reviewer": report.reviewer.full_name if report.reviewer else "",
        "review_note": report.review_note,
        "similarity": f"{report.similarity:.2f}",
    }


class _Echo:
    def write(self, value):
        return value


def csv_chunks(reports):
    writer = csv.writer(_Echo())
    yield "﻿"
    yield writer.writerow([label for _, label in COLUMNS])
    for report in reports:
        row = report_row(report)
        yield writer.writerow([escape_cell(row[key]) for key, _ in COLUMNS])


def write_xlsx(reports, target):
    import xlsxwriter

    # Every cell is written as text and strings_to_formulas is off, so nothing
    # a staffer typed can become a live formula; no apostrophe escaping needed.
    workbook = xlsxwriter.Workbook(target, {
        "constant_memory": True, "strings_to_formulas": False,
        "strings_to_urls": False, "strings_to_numbers": False,
    })
    sheet = workbook.add_worksheet("Reports")
    header = workbook.add_format({"bold": True})
    for col, (_, label) in enumerate(COLUMNS):
        sheet.write_string(0, col, label, header)
    for row_number, report in enumerate(reports, start=1):
        row = report_row(report)
        for col, (key, _) in enumerate(COLUMNS):
            sheet.write_string(row_number, col, row[key])
    workbook.close()


def _chart(section):
    rows = section.get("rows", [])
    numbers = [row.get("value") for row in rows if isinstance(row.get("value"), (int, float))]
    top = max(numbers or [0]) or 1
    drawn = []
    for index, row in enumerate(rows):
        value = row.get("value") if isinstance(row.get("value"), (int, float)) else 0
        width = round(CHART_WIDTH * value / top)
        y = index * 16
        drawn.append({
            "label": str(row.get("label", ""))[:40], "value": row.get("value", ""),
            "y": y, "text_y": y + 9, "width": width, "value_x": 190 + width + 6,
        })
    return {"title": section.get("title", ""), "rows": drawn, "height": max(len(rows) * 16, 16)}


def _pdf_report(report):
    same_day = report.period_start == report.period_end
    return {
        "staff": report.staff.full_name,
        "role": report.staff.role.name.replace("_", " ").title(),
        "period": report.get_period_display(),
        "range": str(report.period_start) if same_day else f"{report.period_start} to {report.period_end}",
        "status": report.get_status_display(),
        "submitted_at": timezone.localtime(report.submitted_at) if report.submitted_at else None,
        "is_late": report.is_late,
        "similar": report.similarity >= services.SIMILARITY_FLAG,
        "sections": [_chart(section) for section in (report.system_snapshot or [])],
        "achievements": report.achievements,
        "blockers": report.blockers,
        "plan_next": report.plan_next,
        "plan_results": report.plan_results,
        "reviewer": report.reviewer.full_name if report.reviewer else "",
        "review_note": report.review_note,
    }


class RefusingFetcher(URLFetcher):
    """WeasyPrint's url_fetcher: report text is user-written, so a PDF must
    never load a URL (no SSRF, no local files, no tracking pixels). Every
    fetch is refused; the URLs asked for are kept in `refused`."""

    def __init__(self):
        super().__init__()
        self.refused = []

    def fetch(self, url, headers=None):
        self.refused.append(url)
        raise ValueError("Report PDFs do not load external resources.")


def pdf_html(reports, title):
    # Django autoescaping stays on: staff text can never become markup.
    return render_to_string("reports/report_export.html", {
        "title": title, "generated_at": timezone.localtime(), "reports": [_pdf_report(r) for r in reports],
    })


def pdf_bytes(reports, title):
    from weasyprint import HTML

    # No base_url and a fetcher that refuses everything.
    return HTML(string=pdf_html(reports, title), url_fetcher=RefusingFetcher()).write_pdf()


def may_export_staff(requester, staff_id):
    if staff_id == requester.pk or services.VIEW_ALL in requester.effective_permission_codenames():
        return True
    return StaffUser.objects.filter(pk=staff_id, manager=requester).exists()


def export_queryset(requester, filters):
    """Reports `requester` may export under `filters` ({"from", "to"} as
    YYYY-MM-DD; optional "staff", "role", "period"): their own, their direct
    reports' (managers), everyone's (reports.view_all). Drafts never export.
    The background job calls this again, so access is re-checked when it runs."""
    reports = StaffReport.objects.exclude(status=StaffReport.DRAFT).select_related("staff__role", "reviewer__role")
    if services.VIEW_ALL not in requester.effective_permission_codenames():
        reports = reports.filter(Q(staff=requester) | Q(staff__manager=requester))
    if "staff" in filters:
        reports = reports.filter(staff_id=filters["staff"])
    if filters.get("role"):
        reports = reports.filter(staff__role__name=filters["role"])
    if filters.get("period"):
        reports = reports.filter(period=filters["period"])
    return reports.filter(period_start__gte=filters["from"], period_end__lte=filters["to"]).order_by(
        "staff__full_name", "period_start", "period"
    )


def reaches_others(requester, filters):
    """True when an export under `filters` can include anyone else's reports:
    it is then personal data and needs a recent password (sudo)."""
    if "staff" in filters:
        return filters["staff"] != requester.pk
    if services.VIEW_ALL in requester.effective_permission_codenames():
        return True
    return StaffUser.objects.filter(manager=requester).exists()


def range_title(filters):
    return f"AshantiHub staff reports, {filters['from']} to {filters['to']}"


def export_response(reports, fmt, stem, title):
    if fmt == "csv":
        response = StreamingHttpResponse(csv_chunks(reports), content_type=FORMATS["csv"])
    elif fmt == "xlsx":
        buffer = io.BytesIO()
        write_xlsx(reports, buffer)
        response = HttpResponse(buffer.getvalue(), content_type=FORMATS["xlsx"])
    else:
        response = HttpResponse(pdf_bytes(reports, title), content_type=FORMATS["pdf"])
    response["Content-Disposition"] = f'attachment; filename="{stem}.{fmt}"'
    return response


def write_export_file(reports, fmt, path, title):
    if fmt == "csv":
        with open(path, "w", encoding="utf-8", newline="") as handle:
            for chunk in csv_chunks(reports):
                handle.write(chunk)
    elif fmt == "xlsx":
        write_xlsx(reports, str(path))
    else:
        Path(path).write_bytes(pdf_bytes(reports, title))


def export_dir():
    return Path(settings.PRIVATE_MEDIA_ROOT) / "report-exports"


def export_path(export):
    # file_name is set by the job (a uuid and the format), never from a request.
    return export_dir() / export.file_name


def download_url(export):
    signature = signing.TimestampSigner(salt=LINK_SALT).sign(str(export.pk))
    return f"/api/reports/exports/{export.pk}/download/?sig={quote(signature)}"


def signature_matches(export, signature):
    """Signed with the export id and a timestamp; the unsign compares in
    constant time (django.core.signing uses constant_time_compare)."""
    try:
        value = signing.TimestampSigner(salt=LINK_SALT).unsign(signature or "", max_age=LINK_MAX_AGE)
    except signing.BadSignature:
        return False
    return hmac.compare_digest(value.encode(), str(export.pk).encode())


def download_filename(export):
    return f"ashantihub-reports-{export.filters.get('from')}-{export.filters.get('to')}.{export.format}"


def export_payload(export):
    ready = export.status == ReportExport.READY and export.expires_at and export.expires_at > timezone.now()
    return {
        "id": export.pk,
        "format": export.format,
        "status": export.status,
        "row_count": export.row_count,
        "error": export.error,
        "created_at": export.created_at,
        "finished_at": export.finished_at,
        "expires_at": export.expires_at,
        "file_name": download_filename(export),
        "download_url": download_url(export) if ready else None,
    }
