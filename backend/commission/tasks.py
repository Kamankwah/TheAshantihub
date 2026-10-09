from celery import shared_task

from . import services


@shared_task
def release_commission_holds():
    return services.release_holds()
