from celery import shared_task

from . import alerts


@shared_task
def check_stock_alerts():
    """Hourly: tell businesses about offers that ran low or sold out (once per crossing; a no-op while
    STOCK_ALERTS_ENABLED is off). The beat entry makes core.jobs keep a JobRun heartbeat for it."""
    return alerts.run()
