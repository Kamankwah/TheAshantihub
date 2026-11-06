import logging
from datetime import timedelta

from celery import shared_task
from django.conf import settings
from django.db import transaction as db_transaction
from django.utils import timezone

from .models import CheckoutSession
from .services import finalize_failure

logger = logging.getLogger(__name__)

BATCH = 200


@shared_task
def expire_stale_checkouts():
    """Close checkouts the customer never paid (review BE-07): a PENDING session older than
    ``CHECKOUT_PENDING_TTL_MINUTES`` becomes EXPIRED and its kind's rollback runs, so reserved stock, coupon uses and
    sale stock go back. Each session is handled in its own transaction under a row lock, and only if it is still
    PENDING, so a payment confirmed at the same moment is never undone. A payment confirmed *after* this is flagged by
    the webhook for a manual refund."""
    cutoff = timezone.now() - timedelta(minutes=settings.CHECKOUT_PENDING_TTL_MINUTES)
    ids = list(
        CheckoutSession.objects.filter(status=CheckoutSession.PENDING, created_at__lt=cutoff)
        .order_by("created_at").values_list("pk", flat=True)[:BATCH]
    )
    expired = 0
    for pk in ids:
        try:
            with db_transaction.atomic():
                session = CheckoutSession.objects.select_for_update().get(pk=pk)
                if session.status != CheckoutSession.PENDING:
                    continue
                session.status = CheckoutSession.EXPIRED
                session.save(update_fields=["status", "updated_at"])
                finalize_failure(session)
                expired += 1
        except Exception:
            logger.exception("could not expire checkout session %s", pk)
    return expired
