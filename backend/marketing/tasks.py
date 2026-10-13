from celery import shared_task

from . import dispatch


@shared_task
def campaign_tick():
    return dispatch.tick()


from .tasks_promos import tick_flash_sales  # noqa: E402,F401  (celery only autodiscovers tasks.py)
