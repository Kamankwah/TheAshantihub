from celery import shared_task

from . import signin


@shared_task
def purge_old_sign_in_records():
    """Nightly: drop sign-in history older than signin.RETENTION_DAYS. The beat
    entry makes core.jobs keep a JobRun heartbeat for it."""
    return signin.purge_old()
