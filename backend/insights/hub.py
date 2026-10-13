"""Reports hub: every role's reports for one day, week or month in one place,
with who owed one, who sent it on time or late, who has not, and what a
reviewer did with it. Leave, public holidays and days off are not expected
(targets.Calendar decides). Acknowledge and return stay the reports app's own
endpoints."""
from datetime import datetime, timedelta

from django.utils import timezone

from accounts.models import Role, StaffUser
from reports import services
from reports.models import StaffReport
from targets.services import WORKING, Calendar

TEAMS = [
    ("operations", "Operations", (Role.OPERATIONS,)),
    ("scouts", "Scouts", (Role.SCOUT,)),
    ("support", "Support", (Role.SUPPORT,)),
    ("delivery", "Delivery & dispatch", (Role.DELIVERY_MANAGER, Role.DISPATCH)),
    ("accounting", "Accounting", (Role.ACCOUNTANT,)),
    ("marketing", "Marketing", (Role.MARKETING,)),
]
TEAM_OF_ROLE = {role: key for key, _label, roles in TEAMS for role in roles}
STATUSES = ["waiting", "submitted", "late", "missing", "returned", "acknowledged"]
SUBMITTED_STATES = (StaffReport.SUBMITTED, StaffReport.ACKNOWLEDGED, StaffReport.RETURNED)


def _people(end):
    people = StaffUser.objects.filter(is_active=True, is_suspended=False, invite_token__isnull=True).exclude(role__name=Role.SUPER_ADMIN)
    return [p for p in people.select_related("role", "manager").order_by("full_name") if p.created_at is None or timezone.localtime(p.created_at).date() <= end]


def _expected(person, start, end):
    joined = timezone.localtime(person.created_at).date() if person.created_at else start
    calendar = Calendar(person, start, end)
    return any(day >= joined and calendar.state(day) == WORKING for day in calendar.days())


def period_rows(period, day, viewer, *, now=None):
    now = now or timezone.now()
    start, end = services.period_bounds(period, day)
    reports = {
        r.staff_id: r
        for r in StaffReport.objects.select_related("staff__role", "reviewer__role")
        .filter(period=period, period_start=start).exclude(status=StaffReport.DRAFT)
    }
    view_all = services.VIEW_ALL in viewer.effective_permission_codenames()
    rows = []
    for person in _people(end):
        report = reports.get(person.pk)
        if report is None and not _expected(person, start, end):
            continue
        due = services.due_at(report) if report else timezone.make_aware(
            datetime.combine(end, services.due_time_for(person))
        )
        if report is None:
            state = "missing" if now > due else "not_due"
        elif report.status == StaffReport.ACKNOWLEDGED:
            state = "acknowledged"
        elif report.status == StaffReport.RETURNED:
            state = "returned"
        elif report.is_late:
            state = "late"
        else:
            state = "submitted"
        rows.append({
            "staff": {"id": person.pk, "full_name": person.full_name, "role": person.role.name},
            "team": TEAM_OF_ROLE.get(person.role.name, person.role.name),
            "manager": person.manager.full_name if person.manager_id else "Super Admin",
            "state": state, "due_at": due,
            "report": None if report is None else {
                "id": report.pk, "status": report.status, "is_late": report.is_late, "submitted_at": report.submitted_at,
                "similar_warning": report.similarity >= services.SIMILARITY_FLAG, "similarity": report.similarity,
                "review_note": report.review_note, "reviewed_at": report.reviewed_at,
                "reviewer": report.reviewer.full_name if report.reviewer else None,
                "can_review": report.status == StaffReport.SUBMITTED and services.can_review(report, viewer, view_all=view_all),
            },
        })
    return start, end, rows


def team_table(rows):
    out = []
    for key, label, _roles in TEAMS:
        mine = [r for r in rows if r["team"] == key]
        if not mine:
            continue
        due = [r for r in mine if r["state"] != "not_due"]
        sent = [r for r in due if r["report"]]
        on_time = [r for r in sent if not r["report"]["is_late"]]
        out.append({
            "key": key, "label": label, "reviewers": sorted({r["manager"] for r in mine}),
            "expected": len(mine), "due": len(due), "on_time": len(on_time),
            "late": sum(1 for r in sent if r["report"]["is_late"]),
            "missing": sum(1 for r in due if not r["report"]),
            "acknowledged": sum(1 for r in sent if r["report"]["status"] == StaffReport.ACKNOWLEDGED),
            "on_time_share": round(len(on_time) / len(due) * 100) if due else None,
        })
    return out


def _sum(table, field):
    return sum(t[field] for t in table)


def hub_report(viewer, period, day, *, role=None, status=None, person=None, today=None):
    today = today or timezone.localdate()
    start, end, rows = period_rows(period, day, viewer)
    teams = team_table(rows)
    everyone = {
        "expected": _sum(teams, "expected"), "due": _sum(teams, "due"), "on_time": _sum(teams, "on_time"), "late": _sum(teams, "late"),
        "missing": _sum(teams, "missing"), "acknowledged": _sum(teams, "acknowledged"),
    }
    everyone["on_time_share"] = round(everyone["on_time"] / everyone["due"] * 100) if everyone["due"] else None
    _, _, today_rows = period_rows(StaffReport.DAY, today, viewer)
    yesterday = today - timedelta(days=1)
    _, _, yest_rows = period_rows(StaffReport.DAY, yesterday, viewer)
    today_sent = sum(1 for r in today_rows if r["report"])
    yest = team_table(yest_rows)
    waiting = sum(1 for r in rows if r["report"] and r["report"]["can_review"])

    def listed(row):
        if role and row["team"] != role and row["staff"]["role"] != role:
            return False
        if person and person.lower() not in row["staff"]["full_name"].lower():
            return False
        if status == "waiting":
            return bool(row["report"] and row["report"]["can_review"])
        if status == "submitted":
            return row["state"] in ("submitted", "late", "acknowledged", "returned")
        if status and status != "all":
            return row["state"] == status
        return True

    order = {"missing": 0, "late": 1, "submitted": 2, "returned": 3, "acknowledged": 4, "not_due": 5}
    shown = sorted((r for r in rows if listed(r)), key=lambda r: (not (r["report"] and r["report"]["can_review"]), order.get(r["state"], 9), r["staff"]["full_name"]))
    return {
        "period": period, "from": start, "to": end,
        "due_time": services.DEFAULT_DUE_TIME.strftime("%H:%M"),
        "teams": teams, "everyone": everyone,
        "kpis": {
            "waiting": waiting,
            "today_sent": today_sent, "today_expected": len(today_rows),
            "yesterday_on_time": _sum(yest, "on_time"), "yesterday_due": _sum(yest, "due"),
            "yesterday_late": _sum(yest, "late"), "yesterday_missing": _sum(yest, "missing"),
        },
        "rows": shown, "role_options": [{"key": k, "label": label} for k, label, _ in TEAMS],
    }
