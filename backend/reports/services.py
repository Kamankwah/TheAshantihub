"""Staff reports (foundations F6): a system section computed from the
database and a narrative written by the person. Draft → Submitted (locked;
late after the due time) → Acknowledged, or Returned with a note (editable
again, then resubmitted). The reviewer is the staffer's manager; a holder of
reports.view_all (Super Admin) may review anyone's."""
import calendar
from datetime import datetime, time, timedelta

from django.db import connection, transaction
from django.db.models import Q
from django.utils import timezone

from accounts.models import Role, StaffUser
from activity.services import record
from notifications.services import notify_staff

from . import providers
from .models import StaffReport

VIEW_ALL = "reports.view_all"
DEFAULT_DUE_TIME = time(19, 0)
# Per-role due times (role name → time); phases 2–7 set them for their roles.
REPORT_DUE_TIMES = {}
SIMILARITY_FLAG = 0.8
MIN_TEXT_FOR_SIMILARITY = 40
PLAN_RESULTS = ("", "done", "partly", "not_done")
MAX_LINES = 20


class ReportError(Exception):
    status_code = 400

    def __init__(self, message):
        super().__init__(message)
        self.message = message


class NotEditable(ReportError):
    pass


class FuturePeriod(ReportError):
    pass


class NoteRequired(ReportError):
    pass


class NotReviewable(ReportError):
    status_code = 403


def period_bounds(period, day):
    if period == StaffReport.DAY:
        return day, day
    if period == StaffReport.WEEK:
        start = day - timedelta(days=day.weekday())
        return start, start + timedelta(days=6)
    if period == StaffReport.MONTH:
        return day.replace(day=1), day.replace(day=calendar.monthrange(day.year, day.month)[1])
    raise ReportError("Use day, week or month.")


def due_time_for(staff):
    return REPORT_DUE_TIMES.get(staff.role.name, DEFAULT_DUE_TIME)


def due_at(report):
    return timezone.make_aware(datetime.combine(report.period_end, due_time_for(report.staff)))


def previous_plan_items(staff, period, start):
    previous = (
        StaffReport.objects.filter(staff=staff, period=period, period_start__lt=start)
        .exclude(status=StaffReport.DRAFT)
        .order_by("-period_start")
        .first()
    )
    return [str(item) for item in (previous.plan_next if previous else [])]


def build(staff, period, day):
    """The staffer's saved report for that period, or an unsaved draft whose
    plan_results list the previous report's plan, ready to mark."""
    start, end = period_bounds(period, day)
    existing = (
        StaffReport.objects.select_related("staff__role", "reviewer__role")
        .filter(staff=staff, period=period, period_start=start)
        .first()
    )
    if existing is not None:
        return existing
    return StaffReport(
        staff=staff, period=period, period_start=start, period_end=end,
        plan_results=[{"item": item, "result": ""} for item in previous_plan_items(staff, period, start)],
    )


def _clean_items(value):
    if not isinstance(value, list):
        raise ReportError("Write the plan as a list of lines.")
    items = [str(item).strip()[:300] for item in value if str(item).strip()]
    if len(items) > MAX_LINES:
        raise ReportError(f"Keep the plan to {MAX_LINES} lines.")
    return items


def _clean_results(value):
    if not isinstance(value, list):
        raise ReportError("Mark the previous plan as a list.")
    cleaned = []
    for row in value[:MAX_LINES]:
        if not isinstance(row, dict) or row.get("result", "") not in PLAN_RESULTS:
            raise ReportError("Mark each plan item done, partly or not done.")
        cleaned.append({"item": str(row.get("item", ""))[:300], "result": row.get("result", "")})
    return cleaned


def _clean_targets(value):
    if not isinstance(value, list) or len(value) > MAX_LINES:
        raise ReportError(f"Link at most {MAX_LINES} records.")
    cleaned = []
    for row in value:
        if not isinstance(row, dict) or not row.get("type") or not row.get("id"):
            raise ReportError("Each link needs a type and an id.")
        cleaned.append({"type": str(row["type"])[:50], "id": str(row["id"])[:64], "label": str(row.get("label", ""))[:200]})
    return cleaned


def narrative_similarity(report):
    """Highest pg_trgm similarity (0–1) between this narrative and the
    staffer's last five other reports; very short text scores 0."""
    text = report.narrative_text()
    if len(text) < MIN_TEXT_FOR_SIMILARITY:
        return 0.0
    earlier = StaffReport.objects.filter(staff=report.staff).exclude(pk=report.pk).order_by("-period_start", "-id")[:5]
    texts = [t for t in (r.narrative_text() for r in earlier) if t]
    if not texts:
        return 0.0
    with connection.cursor() as cursor:
        cursor.execute("SELECT COALESCE(MAX(similarity(%s, t)), 0) FROM unnest(%s::text[]) AS t", [text, texts])
        return round(float(cursor.fetchone()[0]), 3)


def save_draft(staff, period, day, data):
    if day > timezone.localdate():
        raise FuturePeriod("You can't write a report for a day that hasn't started.")
    report = build(staff, period, day)
    if report.pk and report.status not in (StaffReport.DRAFT, StaffReport.RETURNED):
        raise NotEditable("A submitted report is locked.")
    for field in ("achievements", "blockers"):
        if field in data:
            setattr(report, field, str(data[field] or "")[:5000])
    if "plan_next" in data:
        report.plan_next = _clean_items(data["plan_next"])
    if "plan_results" in data:
        report.plan_results = _clean_results(data["plan_results"])
    if "linked_targets" in data:
        report.linked_targets = _clean_targets(data["linked_targets"])
    report.similarity = narrative_similarity(report)
    report.save()
    return report


def submit(report, *, now=None, http_request=None):
    now = now or timezone.now()
    if report.status not in (StaffReport.DRAFT, StaffReport.RETURNED):
        raise NotEditable("This report has already been submitted.")
    if report.period_start > timezone.localdate(now):
        raise FuturePeriod("You can't submit a report for a period that hasn't started.")
    if not report.narrative_text():
        raise ReportError("Write at least one line before you submit.")
    with transaction.atomic():
        report.system_snapshot = providers.system_sections(report.staff, report.period_start, report.period_end)
        report.submitted_at = now
        report.is_late = now > due_at(report)
        report.status = StaffReport.SUBMITTED
        report.save(update_fields=["system_snapshot", "submitted_at", "is_late", "status", "updated_at"])
        manager = report.staff.manager
        if manager is not None and manager.is_active:
            notify_staff(
                manager, "report_submitted",
                f"{report.staff.full_name} sent a {report.get_period_display().lower()} report",
                body="Submitted after the deadline." if report.is_late else "",
                link="team-reports", icon="📝",
            )
        record(report.staff, "report.submitted", target=report, after={
            "period": report.period, "period_start": str(report.period_start),
            "is_late": report.is_late, "similarity": report.similarity,
        }, request=http_request)
    return report


def can_review(report, staff):
    if staff.pk == report.staff_id:
        return False
    return report.staff.manager_id == staff.pk or VIEW_ALL in staff.effective_permission_codenames()


def _check_reviewable(report, staff):
    if report.status != StaffReport.SUBMITTED:
        raise ReportError("Only a submitted report can be reviewed.")
    if not can_review(report, staff):
        raise NotReviewable("Only their manager or a Super Admin can review this report.")


def acknowledge(report, reviewer, note="", http_request=None):
    _check_reviewable(report, reviewer)
    with transaction.atomic():
        report.status = StaffReport.ACKNOWLEDGED
        report.reviewer = reviewer
        report.reviewed_at = timezone.now()
        report.review_note = (note or "").strip()
        report.save(update_fields=["status", "reviewer", "reviewed_at", "review_note", "updated_at"])
        notify_staff(report.staff, "report_acknowledged", f"{reviewer.full_name} read your report",
                     body=report.review_note, link="reports", icon="✅")
        record(reviewer, "report.acknowledged", target=report, after={"note": report.review_note}, request=http_request)
    return report


def return_report(report, reviewer, note, http_request=None):
    note = (note or "").strip()
    _check_reviewable(report, reviewer)
    if not note:
        raise NoteRequired("Write what needs changing before you return it.")
    with transaction.atomic():
        report.status = StaffReport.RETURNED
        report.reviewer = reviewer
        report.reviewed_at = timezone.now()
        report.review_note = note
        report.save(update_fields=["status", "reviewer", "reviewed_at", "review_note", "updated_at"])
        notify_staff(report.staff, "report_returned", "Your report came back with a note",
                     body=note, link="reports", icon="↩️")
        record(reviewer, "report.returned", target=report, after={"note": note}, request=http_request)
    return report


def visible_reports(staff):
    """Own reports (drafts too); direct reports' once submitted; everyone's
    submitted reports for reports.view_all."""
    scope = Q(staff=staff) | (Q(staff__manager=staff) & ~Q(status=StaffReport.DRAFT))
    if VIEW_ALL in staff.effective_permission_codenames():
        scope |= ~Q(status=StaffReport.DRAFT)
    return StaffReport.objects.filter(scope)


def send_day_reminders(now=None):
    """18:00: everyone active, activated and not a Super Admin who hasn't
    submitted today's day report gets a reminder."""
    today = timezone.localdate(now or timezone.now())
    done = StaffReport.objects.filter(
        period=StaffReport.DAY, period_start=today,
        status__in=[StaffReport.SUBMITTED, StaffReport.ACKNOWLEDGED],
    ).values("staff_id")
    recipients = (
        StaffUser.objects.select_related("role")
        .filter(is_active=True, is_suspended=False, invite_token__isnull=True)
        .exclude(role__name=Role.SUPER_ADMIN)
        .exclude(pk__in=done)
    )
    sent = 0
    for staff in recipients:
        notify_staff(
            staff, "report_reminder", f"Your day report is due at {due_time_for(staff):%H:%M}",
            body="Write what you did today, what got in the way and your plan for tomorrow.",
            link="reports", icon="📝",
        )
        sent += 1
    return sent
