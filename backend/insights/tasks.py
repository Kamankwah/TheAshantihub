from celery import shared_task

from . import scheduling


@shared_task
def run_due_scheduled_exports():
    """Every 5 minutes: run what is due, then delete files past their 24 hours."""
    ran = scheduling.dispatch_due()
    scheduling.purge_expired()
    return ran
