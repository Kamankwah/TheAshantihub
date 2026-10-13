"""One small tabular shape for every Insights export, written as CSV, Excel
or PDF. A document is {"title", "note", "tables": [{"heading", "columns",
"rows"}]}; rows hold plain strings or numbers, never markup. CSV cells that
start = + - @ are neutralised, Excel writes text only (no live formulas) and
the PDF loads no URL (the same rules as reports.exports)."""
import csv
import io

from django.template.loader import render_to_string
from django.utils import timezone
from reports.exports import FORMATS, RefusingFetcher, escape_cell

__all__ = ["FORMATS", "document", "table", "csv_chunks", "xlsx_bytes", "pdf_bytes", "render", "row_count"]


def table(heading, columns, rows):
    return {"heading": heading, "columns": list(columns), "rows": [list(row) for row in rows]}


def document(title, tables, note=""):
    return {"title": title, "note": note, "tables": tables}


def row_count(doc):
    return sum(len(t["rows"]) for t in doc["tables"])


class _Echo:
    def write(self, value):
        return value


def csv_chunks(doc):
    writer = csv.writer(_Echo())
    yield "﻿"
    yield writer.writerow([escape_cell(doc["title"])])
    for tab in doc["tables"]:
        yield writer.writerow([])
        if tab["heading"]:
            yield writer.writerow([escape_cell(tab["heading"])])
        yield writer.writerow([escape_cell(c) for c in tab["columns"]])
        for row in tab["rows"]:
            yield writer.writerow([escape_cell(v) for v in row])


def _sheet_name(heading, index):
    cleaned = "".join(ch for ch in (heading or f"Table {index + 1}") if ch not in "[]:*?/\\")[:28]
    return f"{index + 1} {cleaned}".strip()[:31]


def xlsx_bytes(doc):
    import xlsxwriter

    buffer = io.BytesIO()
    workbook = xlsxwriter.Workbook(buffer, {
        "in_memory": True, "strings_to_formulas": False, "strings_to_urls": False, "strings_to_numbers": False,
    })
    bold = workbook.add_format({"bold": True})
    for index, tab in enumerate(doc["tables"] or [table("", [], [])]):
        sheet = workbook.add_worksheet(_sheet_name(tab["heading"], index))
        for col, label in enumerate(tab["columns"]):
            sheet.write_string(0, col, str(label), bold)
        for r, row in enumerate(tab["rows"], start=1):
            for col, value in enumerate(row):
                sheet.write_string(r, col, "" if value is None else str(value))
        sheet.set_column(0, max(len(tab["columns"]) - 1, 0), 18)
    workbook.close()
    return buffer.getvalue()


def pdf_bytes(doc):
    from weasyprint import HTML

    html = render_to_string("insights/export.html", {"doc": doc, "generated_at": timezone.localtime()})
    return HTML(string=html, url_fetcher=RefusingFetcher()).write_pdf()


def render(doc, fmt):
    """(bytes, content_type) for a document in csv, xlsx or pdf."""
    if fmt == "csv":
        return "".join(csv_chunks(doc)).encode("utf-8"), FORMATS["csv"]
    if fmt == "xlsx":
        return xlsx_bytes(doc), FORMATS["xlsx"]
    return pdf_bytes(doc), FORMATS["pdf"]
