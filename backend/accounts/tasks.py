from celery import shared_task

from . import sessions


@shared_task
def cleanup_staff_sessions():
    return sessions.cleanup()
