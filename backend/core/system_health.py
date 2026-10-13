"""What the app can honestly measure about itself. Anything it cannot (payments
provider uptime, past incidents, error rates, a disk it cannot see) is listed
under "not_reported" instead of being given a value."""
import os
import shutil
import time
from datetime import datetime, timedelta
from pathlib import Path

from django.conf import settings
from django.db import connection
from django.utils import timezone

from activity.models import ChainCheck

from .models import JobRun
from .views import _redis_state

OK, DOWN, LATE, NOT_RUN, NOT_CONNECTED, NOT_REPORTED = "ok", "down", "late", "not_run", "not_connected", "not_reported"
DISK_WATCH_PERCENT = 85
DISK_WARN_PERCENT = 95
BACKUP_MAX_AGE = timedelta(hours=36)
BACKUP_PATTERNS = ("*.sql.gz", "*.sql", "*.dump", "*.gz")


def _check(key, name, state, value, note=""):
    return {"key": key, "name": name, "state": state, "value": value, "note": note}


def database():
    started = time.monotonic()
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
    except Exception:
        return _check("database", "Database", DOWN, "Not answering")
    return _check("database", "Database", OK, f"Answered in {max(1, round((time.monotonic() - started) * 1000))} ms")


def live_updates():
    redis = _redis_state()
    if redis == "not_configured":
        return _check("live", "Live updates", NOT_CONNECTED, "One process, no Redis", "Pages share updates within one server process only.")
    if redis == "down":
        return _check("live", "Live updates", DOWN, "Redis not answering", "Staff pages fall back to refreshing on a timer.")
    return _check("live", "Live updates", OK, "Redis answering")


def _schedule_text(schedule):
    if isinstance(schedule, (int, float)):
        minutes = schedule / 60
        return f"every {int(minutes)} minutes" if minutes >= 1 else f"every {int(schedule)} seconds"
    hour, minute = getattr(schedule, "_orig_hour", "*"), getattr(schedule, "_orig_minute", "*")
    if str(hour) == "*":
        return f"hourly, at :{int(minute):02d}" if str(minute).isdigit() else "every minute"
    if str(hour).isdigit() and str(minute).isdigit():
        return f"daily at {int(hour):02d}:{int(minute):02d}"
    return "on a schedule"


def _interval(schedule):
    if isinstance(schedule, (int, float)):
        return timedelta(seconds=schedule)
    hour = str(getattr(schedule, "_orig_hour", "*"))
    return timedelta(hours=1) if hour == "*" else timedelta(days=1)


def jobs(now=None):
    now = now or timezone.now()
    runs = {run.task: run for run in JobRun.objects.all()}
    rows = []
    for name, entry in settings.CELERY_BEAT_SCHEDULE.items():
        run = runs.get(entry["task"])
        interval = _interval(entry["schedule"])
        if run is None or run.last_started_at is None:
            state = NOT_RUN
        elif run.last_status == JobRun.FAILED:
            state = DOWN
        elif now - (run.last_finished_at or run.last_started_at) > interval * 2 + timedelta(minutes=10):
            state = LATE
        else:
            state = OK
        rows.append({
            "key": name, "task": entry["task"], "every": _schedule_text(entry["schedule"]), "state": state,
            "last_started_at": run.last_started_at if run else None, "last_finished_at": run.last_finished_at if run else None,
            "took_ms": run.last_duration_ms if run else None, "error": run.last_error if run else "",
        })
    return rows


def background_work(rows, now=None):
    """Is a worker running the jobs? Read from the jobs' own heartbeats."""
    if not settings.USE_REDIS:
        return _check("jobs", "Background jobs", NOT_CONNECTED, "Run in the web process", "No separate worker or scheduler is running here.")
    failed = [r for r in rows if r["state"] == DOWN]
    late = [r for r in rows if r["state"] == LATE]
    never = [r for r in rows if r["state"] == NOT_RUN]
    if failed:
        return _check("jobs", "Background jobs", DOWN, f"{len(failed)} failed at the last run", ", ".join(r["key"] for r in failed))
    if late:
        return _check("jobs", "Background jobs", LATE, f"{len(late)} overdue", ", ".join(r["key"] for r in late))
    if len(never) == len(rows):
        return _check("jobs", "Background jobs", NOT_RUN, "No job has run since the heartbeat started", "Nothing is recorded until the worker next runs a job.")
    return _check("jobs", "Background jobs", OK, f"{len(rows) - len(never)} of {len(rows)} have run on time", "" if not never else f"{len(never)} not run yet")


def backups(now=None):
    now = now or timezone.now()
    folder = os.environ.get("BACKUP_DIR", "")
    if folder and Path(folder).is_dir():
        files = [p for pattern in BACKUP_PATTERNS for p in Path(folder).glob(pattern)]
        if files:
            newest = max(files, key=lambda p: p.stat().st_mtime)
            when = datetime.fromtimestamp(newest.stat().st_mtime, tz=timezone.get_current_timezone())
            state = OK if now - when <= BACKUP_MAX_AGE else LATE
            return _check("backups", "Backups", state, f"Last backup {timezone.localtime(when):%d %b %Y %H:%M}", "" if state == OK else "Older than a day and a half.")
    return _check("backups", "Backups", NOT_REPORTED, "Not reported to the app", "Backups run on the server outside AshantiHub; check the server's backup folder.")


def audit_chain():
    check = ChainCheck.objects.first()
    if check is None:
        return _check("audit", "Audit log chain", NOT_RUN, "No nightly check has run yet")
    when = timezone.localtime(check.checked_at)
    return _check("audit", "Audit log chain", OK if check.ok else DOWN, f"{'Intact' if check.ok else 'BROKEN'} at {when:%d %b %H:%M}", f"{check.events} entries checked.")


def disk():
    try:
        usage = shutil.disk_usage("/")
    except OSError:
        return _check("disk", "Disk", NOT_REPORTED, "Not readable")
    percent = round(usage.used * 100 / usage.total) if usage.total else 0
    state = DOWN if percent >= DISK_WARN_PERCENT else LATE if percent >= DISK_WATCH_PERCENT else OK
    return _check("disk", "Disk", state, f"{percent}% full", "The space the app can see, which may be a container rather than the whole server.")


def errors():
    if settings.SENTRY_DSN:
        return _check("errors", "Errors", NOT_REPORTED, "Reported to Sentry", "AshantiHub does not read them back; open Sentry for recent errors.")
    return _check("errors", "Errors", NOT_CONNECTED, "No error reporting set")


def report(now=None):
    now = now or timezone.now()
    rows = jobs(now)
    checks = [
        _check("api", "API", OK, "Answering"), database(), live_updates(), background_work(rows, now), backups(now), audit_chain(), disk(), errors(),
    ]
    bad = [c for c in checks if c["state"] == DOWN]
    watch = [c for c in checks if c["state"] in (LATE, NOT_RUN)]
    if bad:
        headline = "Something needs attention: " + ", ".join(c["name"] for c in bad) + "."
    elif watch:
        headline = "Working, with things to watch: " + ", ".join(c["name"] for c in watch) + "."
    else:
        headline = "Everything the app can measure is working."
    return {
        "checked_at": now, "headline": headline, "overall": DOWN if bad else LATE if watch else OK, "checks": checks, "jobs": rows,
        "simulated_payments": settings.PAYMENTS_PROVIDER == "simulated",
        "not_reported": [
            {"name": "Past incidents", "why": "Outages are not logged anywhere the app can read, so no incident history is shown."},
            {"name": "Payment provider status", "why": "Payments are simulated; there is no provider to check." if settings.PAYMENTS_PROVIDER == "simulated" else "The app does not call Hubtel to test it."},
            {"name": "Live connections", "why": "The number of open live-update connections is not counted."},
        ],
    }
