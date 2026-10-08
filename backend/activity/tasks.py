from celery import shared_task
from django.conf import settings
from django.core.management import call_command
from django.core.management.base import CommandError

from notifications.services import notify_staff_role


@shared_task
def verify_activity_chain_nightly():
    """F4's nightly chain check, run by Celery beat (it replaces the host cron
    lines plan 1A added). A break raises — the command logs it at ERROR, which
    Sentry captures — and alerts every Super Admin in-app."""
    try:
        call_command("verify_activity_chain", email_seal=settings.ACTIVITY_SEAL_EMAIL)
    except CommandError as exc:
        notify_staff_role(
            "activity.view_all", "activity_chain_broken", "Activity log check failed",
            body=f"{exc}. Investigate before anything else; never repair rows by hand.",
            link="activity", icon="🚨",
        )
        raise
