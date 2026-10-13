from celery import shared_task

from . import flash_sales


@shared_task
def tick_flash_sales():
    """Flips flash sales scheduled to live to ended. Idempotent (each flip re-reads the row locked)."""
    return flash_sales.tick()
