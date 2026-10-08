from celery import shared_task

from . import services


@shared_task
def send_day_report_reminders():
    return services.send_day_reminders()
