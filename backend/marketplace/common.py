"""Shared bits of the Super Admin marketplace oversight screens (SA-5): a page
size, the CSV response and the one place an export is recorded."""
import csv

from django.http import StreamingHttpResponse
from rest_framework.pagination import PageNumberPagination

from activity.services import record
from reports.exports import _Echo, escape_cell


class OversightPagination(PageNumberPagination):
    page_size = 25
    page_size_query_param = "page_size"
    max_page_size = 100


def money(value):
    return str(value if value is not None else "0.00")


def choice_param(params, name, choices):
    """A ?name= that must be one of `choices` (or empty); anything else is
    ignored rather than an error, as the moderated queues do."""
    value = params.get(name) or ""
    return value if value in choices else ""


def csv_export(request, *, stem, header, rows, kind, personal_data=False, filters=None):
    """Stream `rows` as a UTF-8 CSV (with a BOM) and record the export as
    report.exported with the number of rows, whether it holds personal data
    and the filters used. Formula-looking cells are escaped."""
    rows = list(rows)
    record(
        request.user, "report.exported",
        summary=f"Exported {kind} ({len(rows)} rows)",
        after={"format": "csv", "kind": kind, "rows": len(rows), "personal_data": personal_data, "filters": filters or {}},
        request=request,
    )

    def chunks():
        writer = csv.writer(_Echo())
        yield "﻿"
        yield writer.writerow(header)
        for row in rows:
            yield writer.writerow([escape_cell(cell) for cell in row])

    response = StreamingHttpResponse(chunks(), content_type="text/csv; charset=utf-8")
    response["Content-Disposition"] = f'attachment; filename="{stem}.csv"'
    return response
