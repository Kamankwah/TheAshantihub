from celery import shared_task

from . import services


@shared_task
def send_due_announcements():
    """Every minute: send the scheduled announcements whose time has come."""
    return services.send_due()
