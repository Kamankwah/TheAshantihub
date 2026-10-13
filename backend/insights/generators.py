"""The exports a schedule can send. Only generators that exist are listed:
every one builds its document from the same functions the screens use, so a
scheduled file always matches what the Super Admin sees. A generator is
built for one recipient, which is how commission statements reach each scout
with only their own lines."""
from dataclasses import dataclass
from datetime import timedelta
from typing import Callable

from django.utils import timezone

from accounts.models import StaffUser
from reports import exports as report_exports
from reports import services as report_services

from . import funnel, money, sales, tabular

PRESETS = {
    "previous_day": "Yesterday",
    "last_week": "Last week (Monday to Sunday)",
    "last_month": "Last month",
    "month_to_date": "This month so far",
    "last_90_days": "The last 90 days",
}


def resolve_period(preset, today=None):
    today = today or timezone.localdate()
    if preset == "previous_day":
        day = today - timedelta(days=1)
        return day, day
    if preset == "last_week":
        monday = today - timedelta(days=today.weekday() + 7)
        return monday, monday + timedelta(days=6)
    if preset == "month_to_date":
        return sales.month_start(today), today
    if preset == "last_90_days":
        return today - timedelta(days=90), today - timedelta(days=1)
    first = sales.add_months(sales.month_start(today), -1)
    return first, sales.month_end(first)


@dataclass(frozen=True)
class Generator:
    key: str
    label: str
    description: str
    permissions: tuple  # holding any of these may be sent this export
    personal: bool
    presets: tuple
    build: Callable  # (filters, recipient, today) -> document


def revenue_document(report):
    start, end = report["from"], report["to"]
    tables = [
        tabular.table("Revenue by type", ["Type", f"{start} to {end} (GH₵)", f"{report['previous']['from']} to {report['previous']['to']} (GH₵)"],
                      [[t["label"], t["amount"], t["previous"]] for t in report["types"]]),
        tabular.table("By zone", ["Zone", "Sales (GH₵)", "Orders, bookings and tickets", "AshantiHub revenue (GH₵)", "Verified businesses"],
                      [[z["zone"], z["sales"], z["orders"], z["revenue"], z["businesses"]] for z in report["zones"]]),
        tabular.table("Sales by category", ["Category", "Sales (GH₵)", "Orders, bookings and tickets"],
                      [[c["category"], c["sales"], c["orders"]] for c in report["categories"]]),
    ]
    note = "Simulated payments; no real money has moved." if report["simulated"] else ""
    return tabular.document(f"Revenue and sales, {start} to {end}", tables, note)


def _revenue(filters, recipient, today):
    start, end = resolve_period(filters.get("period", "last_week"), today)
    return revenue_document(sales.revenue_report(start, end, today=today))


def _analytics(filters, recipient, today):
    report = sales.analytics_report(today=today)
    return tabular.document("Marketplace analytics", [
        tabular.table("Month by month", ["Month", "Verified businesses", "New customers", "Orders, bookings and tickets", "GMV (GH₵)", "Repeat rate"],
                      [[m["label"], m["businesses"], m["customers"], m["orders"], m["gmv"], "" if m["repeat_rate"] is None else f"{m['repeat_rate']}%"] for m in report["months"]]),
        tabular.table("By zone", ["Zone", "Verified businesses", "Buyers (90 days)", "Orders", "GMV (GH₵)", "Repeat rate"],
                      [[z["zone"], z["businesses"], z["buyers"], z["orders"], z["gmv"], "" if z["repeat_rate"] is None else f"{z['repeat_rate']}%"] for z in report["zones"]]),
    ], "Simulated payments." if report["simulated"] else "")


def _funnel(filters, recipient, today):
    start, end = resolve_period(filters.get("period", "last_90_days"), today)
    report = funnel.funnel_report(team=filters.get("team"), start=start, end=end)
    return tabular.document(f"Growth funnel, places first visited {start} to {end}", [tabular.table(*t) for t in funnel.funnel_document(report)])


def _refunds(filters, recipient, today):
    start, end = resolve_period(filters.get("period", "last_month"), today)
    return tabular.document(f"Refunds, {start} to {end}", [tabular.table(*t) for t in money.refunds_document(money.refunds_report(start, end))])


def _statements(filters, recipient, today):
    from commission.views import VIEW_ALL

    own_only = VIEW_ALL not in recipient.effective_permission_codenames()
    return tabular.document("Commission statement", [tabular.table(*t) for t in money.statement_document([recipient.pk] if own_only else None)],
                            "Your own lines only." if own_only else "")


def _reports(filters, recipient, today):
    start, end = resolve_period(filters.get("period", "last_month"), today)
    reports = report_exports.export_queryset(recipient, {"from": start.isoformat(), "to": end.isoformat()})
    columns = [label for _k, label in report_exports.COLUMNS]
    rows = [[row[k] for k, _l in report_exports.COLUMNS] for row in (report_exports.report_row(r) for r in reports)]
    return tabular.document(f"Staff reports, {start} to {end}", [tabular.table("Reports", columns, rows)])


GENERATORS = {g.key: g for g in [
    Generator("revenue", "Revenue & sales", "Revenue by type, sales by zone and category", ("transactions.report",), False, ("last_week", "last_month", "month_to_date"), _revenue),
    Generator("analytics", "Analytics", "Month by month and by zone", ("analytics.view",), False, (), _analytics),
    Generator("growth_funnel", "Growth funnel", "Visit to 3 months paid, by scout and zone", ("analytics.view",), False, ("last_90_days", "last_month"), _funnel),
    Generator("refunds", "Refunds", "Refunds already recorded, with customer names", ("transactions.report",), True, ("last_week", "last_month"), _refunds),
    Generator("commission_statements", "Commission statements", "Earned, on hold, payable and reversed lines (a scout receives only their own)", ("commission.view_all", "commission.view_own"), True, (), _statements),
    Generator("reports", "Staff reports", "Every role's submitted reports, with their text", ("reports.view_all",), True, ("previous_day", "last_week", "last_month"), _reports),
]}


def allowed(key, staff: StaffUser):
    gen = GENERATORS.get(key)
    return bool(gen and set(gen.permissions) & staff.effective_permission_codenames())
