from celery import shared_task

from . import retention


@shared_task
def purge_old_otp_rows():
    """Nightly: drop spent codes and step-up tokens, long-ended trusted devices and old audit rows. The beat entry
    makes core.jobs keep a JobRun heartbeat for it."""
    return retention.purge()
