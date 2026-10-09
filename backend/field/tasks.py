from celery import shared_task

from .services import abandon_stale_visits


@shared_task
def close_abandoned_visits():
    return abandon_stale_visits()
