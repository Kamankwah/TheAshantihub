from celery import shared_task

from . import services


@shared_task
def escalate_due_approvals():
    return services.escalate_due()
