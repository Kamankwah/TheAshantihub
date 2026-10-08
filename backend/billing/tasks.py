from celery import shared_task

from . import clock


@shared_task
def run_subscription_clock():
    return clock.tick()
