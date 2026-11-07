from celery import shared_task

from . import sessions


@shared_task
def cleanup_staff_sessions():
    return sessions.cleanup()


@shared_task
def scrub_expired_personal_data():
    """03:15 every day: delivery details on orders, and support-conversation text, past their retention period are blanked
    (accounts.retention). Idempotent. The beat entry makes core.jobs keep a JobRun heartbeat for it."""
    from . import retention

    return retention.scrub_expired()
