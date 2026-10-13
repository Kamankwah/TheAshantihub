"""Heartbeat for scheduled jobs: Celery signals keep one JobRun row per task in
the beat schedule (last start, finish, duration and result). A failure to write
the heartbeat never fails the job itself."""
import logging

from celery.signals import task_failure, task_postrun, task_prerun
from django.conf import settings
from django.utils import timezone

logger = logging.getLogger(__name__)


def scheduled_task_names():
    return {entry["task"] for entry in getattr(settings, "CELERY_BEAT_SCHEDULE", {}).values()}


def _tracked(task_name):
    return task_name in scheduled_task_names()


def mark_started(task_name, now=None):
    from .models import JobRun

    JobRun.objects.update_or_create(
        task=task_name, defaults={"last_started_at": now or timezone.now(), "last_finished_at": None, "last_status": JobRun.STARTED, "last_duration_ms": None, "last_error": ""},
    )


def mark_finished(task_name, *, ok, error="", now=None):
    from .models import JobRun

    now = now or timezone.now()
    run, _ = JobRun.objects.get_or_create(task=task_name, defaults={"last_started_at": now})
    started = run.last_started_at or now
    run.last_finished_at = now
    run.last_status = JobRun.OK if ok else JobRun.FAILED
    run.last_duration_ms = max(0, int((now - started).total_seconds() * 1000))
    run.last_error = "" if ok else str(error)[:300]
    run.save()


@task_prerun.connect(weak=False)
def _prerun(sender=None, **_kwargs):
    if sender is not None and _tracked(sender.name):
        try:
            mark_started(sender.name)
        except Exception:
            logger.warning("Could not record the start of %s", sender.name, exc_info=True)


@task_postrun.connect(weak=False)
def _postrun(sender=None, state=None, **_kwargs):
    # A raised task is recorded as failed by _failure; postrun then only closes a success.
    if sender is not None and _tracked(sender.name) and state == "SUCCESS":
        try:
            mark_finished(sender.name, ok=True)
        except Exception:
            logger.warning("Could not record the end of %s", sender.name, exc_info=True)


@task_failure.connect(weak=False)
def _failure(sender=None, exception=None, **_kwargs):
    if sender is not None and _tracked(sender.name):
        try:
            mark_finished(sender.name, ok=False, error=f"{type(exception).__name__}: {exception}")
        except Exception:
            logger.warning("Could not record the failure of %s", sender.name, exc_info=True)
