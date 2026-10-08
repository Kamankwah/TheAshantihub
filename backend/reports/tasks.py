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


def fail_export(export, message):
    """Mark an export failed and tell its requester."""
    message = (message or "Export failed")[:300]
    ReportExport.objects.filter(pk=export.pk).update(
        status=ReportExport.FAILED, error=message, finished_at=timezone.now()
    )
    notify_staff(export.requester, "report_export_failed", "Your report export failed",
                 body=message, link="reports", icon="⚠️")


@shared_task
def build_report_export(export_id):
    export = ReportExport.objects.select_related("requester__role").get(pk=export_id)
    ReportExport.objects.filter(pk=export.pk).update(status=ReportExport.RUNNING)
    directory = exports.export_dir()
    directory.mkdir(parents=True, exist_ok=True)
    final_name = f"{uuid.uuid4().hex}.{export.format}"
    partial = directory / f"{final_name}.partial"
    try:
        reports = list(exports.export_queryset(export.requester, export.filters))
        exports.write_export_file(reports, export.format, partial, exports.range_title(export.filters))
        partial.rename(directory / final_name)
    except Exception as exc:
        # Nothing partial is ever served: the half-written file goes too.
        partial.unlink(missing_ok=True)
        logger.exception("Report export %s failed", export.pk)
        fail_export(export, str(exc) or exc.__class__.__name__)
        return
    now = timezone.now()
    ReportExport.objects.filter(pk=export.pk).update(
        status=ReportExport.READY, file_name=final_name, row_count=len(reports),
        finished_at=now, expires_at=now + timedelta(seconds=exports.LINK_MAX_AGE),
    )
    notify_staff(export.requester, "report_export_ready", "Your report export is ready",
                 body="Download it from My Reports within 24 hours.", link="reports", icon="📦")


@shared_task
def purge_expired_exports():
    expired = 0
    for export in ReportExport.objects.filter(status=ReportExport.READY, expires_at__lt=timezone.now()):
        exports.export_path(export).unlink(missing_ok=True)
        ReportExport.objects.filter(pk=export.pk).update(status=ReportExport.EXPIRED)
        expired += 1
    return expired
