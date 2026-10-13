"""Running scheduled exports: when a schedule is next due, building one file
per recipient, telling them (bell and e-mail) and logging every run."""
import logging
import uuid
from datetime import datetime, timedelta
from pathlib import Path

from django.conf import settings
from django.core import signing
from django.utils import timezone

from accounts.emails import _send
from activity.services import record
from notifications.services import notify_staff

from . import generators, tabular
from .models import ScheduledExport, ScheduledExportFile, ScheduledExportRun

logger = logging.getLogger(__name__)
LINK_SALT = "insights.scheduled-export"
LINK_MAX_AGE = 24 * 60 * 60
MAX_RECIPIENTS = 10


def directory():
    return Path(settings.PRIVATE_MEDIA_ROOT) / "scheduled-exports"


def next_run_after(schedule, after):
    """The first run time strictly after `after` (local time)."""
    zone = timezone.get_current_timezone()
    local = timezone.localtime(after, zone)
    day = local.date()
    for offset in range(0, 62):
        candidate_day = day + timedelta(days=offset)
        if schedule.frequency == ScheduledExport.WEEKLY and candidate_day.weekday() != schedule.weekday:
            continue
        if schedule.frequency == ScheduledExport.MONTHLY and candidate_day.day != schedule.day_of_month:
            continue
        candidate = timezone.make_aware(datetime.combine(candidate_day, schedule.run_time), zone)
        if candidate > after:
            return candidate
    return None


def link_for(file):
    signature = signing.TimestampSigner(salt=LINK_SALT).sign(str(file.pk))
    return f"/api/insights/exports/files/{file.pk}/download/?sig={signature}"


def signature_matches(file, signature):
    try:
        value = signing.TimestampSigner(salt=LINK_SALT).unsign(signature or "", max_age=LINK_MAX_AGE)
    except signing.BadSignature:
        return False
    return value == str(file.pk)


def _email(recipient, schedule, file):
    _send(
        f"Your scheduled export is ready: {schedule.name}",
        f"Hi {recipient.full_name},\n\n{schedule.name} is ready. Sign in to AshantiHub staff to download it "
        f"({settings.FRONTEND_BASE_URL}/staff). The link works for 24 hours and only for you, signed in. "
        "The file is never attached to an e-mail.\n",
        recipient.email,
    )


def creator_problem(schedule):
    """Why a schedule may no longer run, or None: whoever set it up must still be an
    active, unsuspended Super Admin-level holder of exports.schedule."""
    creator = schedule.created_by
    if not creator.is_active or creator.is_suspended:
        return "The person who set this up no longer has an active account."
    if "exports.schedule" not in creator.effective_permission_codenames():
        return "The person who set this up can no longer schedule exports."
    return None


def run_schedule(schedule, *, now=None):
    now = now or timezone.now()
    problem = creator_problem(schedule)
    if problem:
        # Skip and flag: pause it so it does not keep trying, and say why.
        run = ScheduledExportRun.objects.create(
            schedule=schedule, started_at=now, finished_at=now, status=ScheduledExportRun.FAILED, error=problem,
        )
        ScheduledExport.objects.filter(pk=schedule.pk, paused_at__isnull=True).update(paused_at=now)
        record(None, "export.scheduled_run_skipped", target=schedule, summary=f"Scheduled export skipped: {schedule.name}",
               after={"reason": problem, "creator": schedule.created_by.full_name})
        return run
    run = ScheduledExportRun.objects.create(schedule=schedule, started_at=now)
    made = problems = rows = 0
    today = timezone.localdate(now)
    gen = generators.GENERATORS.get(schedule.kind)
    for recipient in schedule.recipients.select_related("role").order_by("full_name"):
        file = ScheduledExportFile.objects.create(run=run, recipient=recipient)
        try:
            if gen is None:
                raise ValueError("This export no longer exists.")
            if not (recipient.is_active and not recipient.is_suspended):
                raise PermissionError("They no longer have access.")
            if not generators.allowed(schedule.kind, recipient):
                raise PermissionError("They may no longer receive this export.")
            doc = gen.build(schedule.filters or {}, recipient, today)
            data, _content_type = tabular.render(doc, schedule.format)
            directory().mkdir(parents=True, exist_ok=True)
            name = f"{uuid.uuid4().hex}.{schedule.format}"
            (directory() / name).write_bytes(data)
            file.file_name = name
            file.download_name = f"ashantihub-{schedule.kind}-{today}.{schedule.format}"
            file.row_count = tabular.row_count(doc)
            file.expires_at = now + timedelta(seconds=LINK_MAX_AGE)
            file.save(update_fields=["file_name", "download_name", "row_count", "expires_at"])
            made += 1
            rows += file.row_count
            notify_staff(recipient, "scheduled_export_ready", f"Your export is ready: {schedule.name}",
                         body="Download it within 24 hours.", link="scheduled-exports", icon="📆")
            if recipient.email:
                _email(recipient, schedule, file)
            record(None, "report.exported", target=schedule, summary=f"Scheduled export sent: {schedule.name}", after={
                "source": "scheduled", "export": schedule.kind, "format": schedule.format, "rows": file.row_count,
                "personal_data": schedule.personal_data, "recipient": recipient.full_name, "filters": schedule.filters,
            })
        except Exception as exc:
            problems += 1
            logger.exception("Scheduled export %s failed for %s", schedule.pk, recipient.pk)
            file.error = (str(exc) if isinstance(exc, (PermissionError, ValueError)) else "We couldn't build this file.")[:300]
            file.save(update_fields=["error"])
    run.finished_at = timezone.now()
    run.rows = rows
    run.status = ScheduledExportRun.FAILED if not made else ScheduledExportRun.PARTIAL if problems else ScheduledExportRun.OK
    if problems:
        run.error = f"{problems} of {made + problems} files were not made."
    run.save(update_fields=["finished_at", "rows", "status", "error"])
    if problems:
        record(None, "export.scheduled_run_problem", target=schedule, summary=f"Scheduled export had problems: {schedule.name}", after={"problems": problems, "made": made})
    return run


def dispatch_due(*, now=None):
    """Claim and run every unpaused schedule whose time has come. A schedule is
    claimed by moving its next_run_at on first, so two workers never both run it."""
    now = now or timezone.now()
    ran = 0
    for schedule in ScheduledExport.objects.filter(paused_at__isnull=True, next_run_at__lte=now):
        following = next_run_after(schedule, now)
        claimed = ScheduledExport.objects.filter(pk=schedule.pk, next_run_at=schedule.next_run_at, paused_at__isnull=True).update(
            next_run_at=following, last_run_at=now,
        )
        if claimed != 1:
            continue
        schedule.refresh_from_db()
        run_schedule(schedule, now=now)
        ran += 1
    return ran


def purge_expired(*, now=None):
    now = now or timezone.now()
    purged = 0
    for file in ScheduledExportFile.objects.filter(purged=False, expires_at__lt=now).exclude(file_name=""):
        (directory() / file.file_name).unlink(missing_ok=True)
        file.purged = True
        file.save(update_fields=["purged"])
        purged += 1
    return purged
