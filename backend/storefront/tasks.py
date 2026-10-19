from celery import shared_task

from . import notify


@shared_task
def send_opening_notices():
    """Beat runs this every minute; it sends nothing until the gate is on and the opening time has passed."""
    return notify.send_batch()
