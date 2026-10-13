from celery import shared_task

from . import papers, services


@shared_task
def run_paper_checks():
    """Hourly: expire lapsed papers, remind at 30/14/7 days, suspend a rider whose required paper lapsed
    (never mid-job)."""
    return papers.run()


@shared_task
def purge_old_pings():
    """Location fixes are kept 48 hours."""
    return services.purge_old_pings()
