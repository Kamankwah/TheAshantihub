"""Staff reports (foundations F6): a system section computed from the
database and a narrative written by the person. Draft → Submitted (locked;
late after the due time) → Acknowledged, or Returned with a note (editable
again, then resubmitted). The reviewer is the staffer's manager; a holder of
reports.view_all (Super Admin) may review anyone's."""
import calendar
from datetime import datetime, time, timedelta

from django.db import IntegrityError, connection, transaction
from django.db.models import Q
from django.utils import timezone

from accounts.models import Role, StaffUser
from activity.services import record
from notifications.models import Notification
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
MAX_NOTE = 2000


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


def _text(value):
    """str(value) without NUL characters, which Postgres refuses in text."""
    return str(value).replace("\x00", "")


def _clean_items(value):
    if not isinstance(value, list):
        raise ReportError("Write the plan as a list of lines.")
    items = [_text(item).strip()[:300] for item in value if _text(item).strip()]
    if len(items) > MAX_LINES:
        raise ReportError(f"Keep the plan to {MAX_LINES} lines.")
    return items


def _clean_results(value):
    if not isinstance(value, list):
        raise ReportError("Mark the previous plan as a list.")
    if len(value) > MAX_LINES:
        raise ReportError(f"Keep the plan to {MAX_LINES} lines.")
    cleaned = []
    for row in value:
        if not isinstance(row, dict) or row.get("result", "") not in PLAN_RESULTS:
            raise ReportError("Mark each plan item done, partly or not done.")
        cleaned.append({"item": _text(row.get("item", ""))[:300], "result": row.get("result", "")})
    return cleaned


def _clean_targets(value):
    if not isinstance(value, list) or len(value) > MAX_LINES:
        raise ReportError(f"Link at most {MAX_LINES} records.")
    cleaned = []
    for row in value:
        if not isinstance(row, dict) or not row.get("type") or not row.get("id"):
            raise ReportError("Each link needs a type and an id.")
        cleaned.append({"type": _text(row["type"])[:50], "id": _text(row["id"])[:64], "label": _text(row.get("label", ""))[:200]})
    return cleaned


def narrative_similarity(report):
    """Highest pg_trgm similarity (0–1) between this narrative and the
    staffer's last five earlier reports of the same period type; very short
    text scores 0."""
    text = report.narrative_text()
    if len(text) < MIN_TEXT_FOR_SIMILARITY:
        return 0.0
    earlier = (
        StaffReport.objects.filter(staff=report.staff, period=report.period, period_start__lt=report.period_start)
        .exclude(pk=report.pk)
        .order_by("-period_start", "-id")[:5]
    )
    texts = [t for t in (r.narrative_text() for r in earlier) if t]
    if not texts:
        return 0.0
    with connection.cursor() as cursor:
        cursor.execute("SELECT COALESCE(MAX(similarity(%s, t)), 0) FROM unnest(%s::text[]) AS t", [text, texts])
        return round(float(cursor.fetchone()[0]), 3)


def _locked(pk):
    return StaffReport.objects.select_for_update(of=("self",)).select_related("staff__role").get(pk=pk)


def _sync(target, source):
    """Copy the locked row's state onto the caller's instance."""
    for field in StaffReport._meta.concrete_fields:
        setattr(target, field.attname, getattr(source, field.attname))
    return target


def _apply_draft_fields(report, data):
    for field in ("achievements", "blockers"):
        if field in data:
            setattr(report, field, _text(data[field] or "")[:5000])
    if "plan_next" in data:
        report.plan_next = _clean_items(data["plan_next"])
    if "plan_results" in data:
        report.plan_results = _clean_results(data["plan_results"])
    if "linked_targets" in data:
        report.linked_targets = _clean_targets(data["linked_targets"])
    report.similarity = narrative_similarity(report)


DRAFT_FIELDS = ["achievements", "blockers", "plan_next", "plan_results", "linked_targets", "similarity", "updated_at"]


def save_draft(staff, period, day, data):
    start, _ = period_bounds(period, day)
    if start > timezone.localdate():
        raise FuturePeriod("You can't write a report for a period that hasn't started.")
    report = build(staff, period, day)
    with transaction.atomic():
        if report.pk is None:
            try:
                with transaction.atomic():
                    _apply_draft_fields(report, data)
                    report.save()
                return report
            except IntegrityError:
                # Someone created it between our read and write: edit theirs.
                report = build(staff, period, day)
        locked = _locked(report.pk)
        if locked.status not in (StaffReport.DRAFT, StaffReport.RETURNED):
            raise NotEditable("A submitted report is locked.")
        _apply_draft_fields(locked, data)
        locked.save(update_fields=DRAFT_FIELDS)
        return _sync(report, locked)


def submit(report, *, now=None, http_request=None):
    now = now or timezone.now()
    with transaction.atomic():
        locked = _locked(report.pk)
        if locked.status not in (StaffReport.DRAFT, StaffReport.RETURNED):
            raise NotEditable("This report has already been submitted.")
        if locked.period_start > timezone.localdate(now):
            raise FuturePeriod("You can't submit a report for a period that hasn't started.")
        if not locked.narrative_text():
            raise ReportError("Write at least one line before you submit.")
        locked.system_snapshot = providers.system_sections(locked.staff, locked.period_start, locked.period_end)
        if locked.submitted_at is None:  # lateness is decided by the first submission only
            locked.submitted_at = now
            locked.is_late = now > due_at(locked)
        locked.status = StaffReport.SUBMITTED
        locked.save(update_fields=["system_snapshot", "submitted_at", "is_late", "status", "updated_at"])
        manager = locked.staff.manager
        if manager is not None and manager.is_active:
            notify_staff(
                manager, "report_submitted",
                f"{locked.staff.full_name} sent a {locked.get_period_display().lower()} report",
                body="Submitted after the deadline." if locked.is_late else "",
                link="team-reports", icon="📝",
            )
        record(locked.staff, "report.submitted", target=locked, after={
            "period": locked.period, "period_start": str(locked.period_start),
            "is_late": locked.is_late, "similarity": locked.similarity,
        }, request=http_request)
        return _sync(report, locked)


def can_review(report, staff, *, view_all=None):
    """`view_all` may carry a precomputed reports.view_all answer for `staff`,
    so a list of rows costs one permission lookup, not one per row."""
    if staff.pk == report.staff_id:
        return False
    if report.staff.manager_id == staff.pk:
        return True
    if view_all is None:
        view_all = VIEW_ALL in staff.effective_permission_codenames()
    return view_all


def _decide(report, reviewer, new_status, note, kind, title, icon, verb, http_request):
    with transaction.atomic():
        locked = _locked(report.pk)
        if locked.status != StaffReport.SUBMITTED:
            if locked.status in (StaffReport.ACKNOWLEDGED, StaffReport.RETURNED):
                raise ReportError("This report has already been reviewed.")
            raise ReportError("Only a submitted report can be reviewed.")
        if not can_review(locked, reviewer):
            raise NotReviewable("Only their manager or a Super Admin can review this report.")
        if new_status == StaffReport.RETURNED and not note:
            raise NoteRequired("Write what needs changing before you return it.")
        locked.status = new_status
        locked.reviewer = reviewer
        locked.reviewed_at = timezone.now()
        locked.review_note = note
        locked.save(update_fields=["status", "reviewer", "reviewed_at", "review_note", "updated_at"])
        notify_staff(locked.staff, kind, title(reviewer), body=note, link="reports", icon=icon)
        record(reviewer, verb, target=locked, after={"note": note}, request=http_request)
        return _sync(report, locked)


def _clean_note(note):
    note = _text(note or "").strip()
    if len(note) > MAX_NOTE:
        raise ReportError(f"Keep the note to {MAX_NOTE} characters.")
    return note


def acknowledge(report, reviewer, note="", http_request=None):
    return _decide(
        report, reviewer, StaffReport.ACKNOWLEDGED, _clean_note(note), "report_acknowledged",
        lambda who: f"{who.full_name} read your report", "✅", "report.acknowledged", http_request,
    )


def return_report(report, reviewer, note, http_request=None):
    return _decide(
        report, reviewer, StaffReport.RETURNED, _clean_note(note), "report_returned",
        lambda who: "Your report came back with a note", "↩️", "report.returned", http_request,
    )


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
    already = Notification.objects.filter(
        kind="report_reminder", created_at__date=today
    ).values("staff_id")
    recipients = (
        StaffUser.objects.select_related("role")
        .filter(is_active=True, is_suspended=False, invite_token__isnull=True)
        .exclude(role__name=Role.SUPER_ADMIN)
        .exclude(pk__in=done)
        .exclude(pk__in=already)
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
