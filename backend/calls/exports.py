"""Call log export (CSV / Excel). One file means the same rows the list shows
for the same filters. Counterpart phones are masked for everyone except the
person who logged the call, and a business owner's number is masked for Support
whoever logged it (a Support agent never holds a full business number)."""
import csv
import io

from django.http import HttpResponse, StreamingHttpResponse
from django.utils import timezone

from accounts.serializers import mask_but_last
from reports.exports import FORMATS, ExportNegotiation, _Echo, escape_cell  # noqa: F401  (ExportNegotiation re-exported for the view)

MAX_ROWS = 5000
COLUMNS = [
    ("time", "Time"), ("direction", "Direction"), ("channel", "Channel"), ("with", "With"), ("with_type", "They are"),
    ("phone", "Number"), ("purpose", "Purpose"), ("outcome", "Outcome"), ("length", "Length (seconds)"),
    ("linked", "Linked to"), ("logged_by", "Logged by"), ("follow_up", "Follow-up"), ("notes", "Notes"),
]


def _stamp(value):
    return timezone.localtime(value).strftime("%Y-%m-%d %H:%M") if value else ""


def shown_phone(call, viewer):
    phone = call.counterpart_phone
    if not phone:
        return ""
    if call.counterpart_type == "business_owner" and viewer.role.name == "support":
        return mask_but_last(phone, keep=3) or ""
    if call.staff_id == viewer.id:
        return phone
    return mask_but_last(phone, keep=3) or ""


def call_row(call, viewer):
    return {
        "time": _stamp(call.started_at), "direction": call.get_direction_display(), "channel": call.get_channel_display(),
        "with": call.counterpart_name or call.related_label, "with_type": call.get_counterpart_type_display(),
        "phone": shown_phone(call, viewer), "purpose": call.purpose.replace("_", " "),
        "outcome": call.get_outcome_display(), "length": call.duration_seconds or "",
        "linked": call.related_label or call.related_type, "logged_by": call.staff.full_name,
        "follow_up": _stamp(call.follow_up_at), "notes": call.notes,
    }


def _csv_chunks(calls, viewer):
    writer = csv.writer(_Echo())
    yield "﻿"
    yield writer.writerow([label for _, label in COLUMNS])
    for call in calls:
        row = call_row(call, viewer)
        yield writer.writerow([escape_cell(row[key]) for key, _ in COLUMNS])


def _xlsx_bytes(calls, viewer):
    import xlsxwriter

    buffer = io.BytesIO()
    workbook = xlsxwriter.Workbook(buffer, {
        "in_memory": True, "strings_to_formulas": False, "strings_to_urls": False, "strings_to_numbers": False,
    })
    sheet = workbook.add_worksheet("Calls")
    header = workbook.add_format({"bold": True})
    for col, (_, label) in enumerate(COLUMNS):
        sheet.write_string(0, col, label, header)
    for number, call in enumerate(calls, start=1):
        row = call_row(call, viewer)
        for col, (key, _) in enumerate(COLUMNS):
            sheet.write_string(number, col, str(row[key]))
    workbook.close()
    return buffer.getvalue()


def export_response(calls, fmt, viewer, stem):
    calls = list(calls)
    if fmt == "csv":
        response = StreamingHttpResponse(_csv_chunks(calls, viewer), content_type=FORMATS["csv"])
    else:
        response = HttpResponse(_xlsx_bytes(calls, viewer), content_type=FORMATS["xlsx"])
    response["Content-Disposition"] = f'attachment; filename="{stem}.{fmt}"'
    return response
