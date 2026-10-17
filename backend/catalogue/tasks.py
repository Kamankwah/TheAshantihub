from celery import shared_task

from . import alerts


@shared_task
def check_stock_alerts():
    """Hourly: tell businesses about offers that ran low or sold out (once per crossing; a no-op while
    STOCK_ALERTS_ENABLED is off). The beat entry makes core.jobs keep a JobRun heartbeat for it."""
    return alerts.run()


@shared_task
def propose_matches():
    """Nightly: file grouping requests for listings whose barcode matches a catalogue entry (a no-op while
    CATALOGUE_MATCHER_ENABLED is off). Files requests only; staff decide each one."""
    from django.conf import settings

    from . import attach

    if not settings.CATALOGUE_MATCHER_ENABLED:
        return 0
    return attach.propose_barcode_matches()
