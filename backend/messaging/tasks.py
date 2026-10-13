from celery import shared_task

from . import services


@shared_task
def wake_snoozed():
    """Every minute: snoozed conversations whose time has come wake up."""
    return services.wake_due_snoozes()
