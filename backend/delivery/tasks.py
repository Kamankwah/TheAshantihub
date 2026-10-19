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


@shared_task
def run_engine():
    """Every 10 seconds: time out offers and, when the auto-assign switch is on, offer or assign waiting orders."""
    from . import dispatching

    return dispatching.run_engine()


@shared_task
def release_deferred_orders():
    """Every 5 minutes: orders held until their vendor opened that are now due get the dispatch they would normally get."""
    from . import dispatching

    return dispatching.release_deferred()
