import logging
import uuid
from datetime import timedelta

from celery import shared_task
from django.utils import timezone

from notifications.services import notify_staff

from . import exports, services
from .models import ReportExport

logger = logging.getLogger(__name__)


@shared_task
def send_day_report_reminders():
    return services.send_day_reminders()


UNFINISHED = (ReportExport.QUEUED, ReportExport.RUNNING)


def fail_export(export, message=exports.GENERIC_ERROR, *, statuses=UNFINISHED):
    """Mark an export failed and tell its requester — only if the row is still
    in one of `statuses`, so a row the reaper (or anyone else) already settled
    is never failed or notified twice. True if this call failed it."""
    failed = ReportExport.objects.filter(pk=export.pk, status__in=statuses).update(
        status=ReportExport.FAILED, error=message[:300], finished_at=timezone.now()
    )
    if failed != 1:
        return False
    notify_staff(export.requester, "report_export_failed", "Your report export failed",
                 body=message, link="reports", icon="⚠️")
    return True


def partial_files(export_id):
    """The half-written files of one export (named `<export id>-<uuid>.partial`)."""
    directory = exports.export_dir()
    return list(directory.glob(f"{int(export_id)}-*.partial")) if directory.exists() else []


@shared_task
def build_report_export(export_id):
    # Claim the row: a duplicate delivery, or a row that is no longer queued
    # (expired, failed, already built), does nothing.
    if not ReportExport.objects.filter(pk=export_id, status=ReportExport.QUEUED).update(
        status=ReportExport.RUNNING
    ):
        return
    export = ReportExport.objects.select_related("requester__role").get(pk=export_id)
    partial = final = None
    try:
        requester = export.requester
        if not requester.is_active or requester.is_suspended:
            raise PermissionError("The requester can no longer export.")
        directory = exports.export_dir()
        directory.mkdir(parents=True, exist_ok=True)
        token = uuid.uuid4().hex
        final_name = f"{token}.{export.format}"
        # Named by export id, so the reaper removes only the files of rows it reaps.
        partial = directory / f"{export.pk}-{token}.partial"
        final = directory / final_name
        reports = list(exports.export_queryset(requester, export.filters))
        exports.write_export_file(reports, export.format, partial, exports.range_title(export.filters))
        partial.rename(final)
        now = timezone.now()
        # Only a row this job still holds: if the reaper failed it meanwhile, it
        # stays failed (one notice) and the file goes.
        finished = ReportExport.objects.filter(pk=export.pk, status=ReportExport.RUNNING).update(
            status=ReportExport.READY, file_name=final_name, row_count=len(reports),
            finished_at=now, expires_at=now + timedelta(seconds=exports.LINK_MAX_AGE),
        )
        if finished != 1:
            final.unlink(missing_ok=True)
            return
        notify_staff(requester, "report_export_ready", "Your report export is ready",
                     body="Download it from My Reports within 24 hours.", link="reports", icon="📦")
    except Exception:
        # Nothing partial is ever served: the half-written file goes too.
        logger.exception("Report export %s failed", export.pk)
        for leftover in (partial, final):
            if leftover is not None:
                leftover.unlink(missing_ok=True)
        fail_export(export, statuses=(ReportExport.RUNNING,))


@shared_task
def reap_stuck_exports():
    """A job that died (worker killed, broker lost) leaves its row queued or
    running forever; fail those older than an hour."""
    cutoff = timezone.now() - timedelta(hours=1)
    stuck = ReportExport.objects.select_related("requester").filter(
        status__in=[ReportExport.QUEUED, ReportExport.RUNNING], created_at__lt=cutoff
    )
    reaped = 0
    for export in stuck:
        if not fail_export(export):
            continue  # settled since the query ran
        reaped += 1
        # Only this row's half-written files: a healthy job's partial stays.
        for leftover in partial_files(export.pk):
            leftover.unlink(missing_ok=True)
    return reaped


@shared_task
def purge_expired_exports():
    expired = 0
    for export in ReportExport.objects.filter(status=ReportExport.READY, expires_at__lt=timezone.now()):
        exports.export_path(export).unlink(missing_ok=True)
        ReportExport.objects.filter(pk=export.pk).update(status=ReportExport.EXPIRED)
        expired += 1
    return expired
