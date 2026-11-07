"""Personal data past its useful life (review DB-04; Ghana Data Protection Act 2012: keep it no longer than the purpose needs).

The money records stay for good - an order, its lines, totals, the ledger. What goes is the personal detail around them:
  * an order's delivery address, phone, Ghana Post address, landmark and pin - once the customer's account has been deleted for
    `PII_DELETED_ACCOUNT_GRACE_DAYS` (refunds and disputes are over), or the order is older than `PII_ORDER_RETENTION_DAYS`;
  * the text of a support conversation (message bodies, notes, the subject) under the same two rules;
  * in-app notifications older than `NOTIFICATION_RETENTION_DAYS`.
Idempotent: a second run finds nothing left to blank. The activity log is not touched here: its rows are sealed by a hash chain,
so the addresses of customers and owners are truncated when the event is written (activity.services)."""
from datetime import timedelta

from django.conf import settings
from django.db.models import Q
from django.utils import timezone

REMOVED = "[removed]"


def scrub_expired(now=None):
    from messaging.models import Conversation, Message
    from notifications.models import Notification
    from orders.models import Order

    now = now or timezone.now()
    grace = now - timedelta(days=settings.PII_DELETED_ACCOUNT_GRACE_DAYS)
    retention = now - timedelta(days=settings.PII_ORDER_RETENTION_DAYS)

    orders = (
        Order.objects.filter(Q(customer__deleted_at__lt=grace) | Q(placed_at__lt=retention))
        .exclude(delivery_address="", delivery_phone="", delivery_gps_address="", delivery_landmark="",
                 delivery_lat=None, delivery_lng=None)
    )
    orders_scrubbed = orders.update(
        delivery_address="", delivery_phone="", delivery_gps_address="", delivery_landmark="", delivery_lat=None, delivery_lng=None,
    )

    expired = Conversation.objects.filter(
        Q(customer__deleted_at__lt=grace) | Q(business_owner__deleted_at__lt=grace) | Q(created_at__lt=retention)
    )
    messages_scrubbed = (
        Message.objects.filter(conversation__in=expired).exclude(kind=Message.EVENT).exclude(body=REMOVED).update(body=REMOVED)
    )
    expired.exclude(subject="").exclude(subject=REMOVED).update(subject=REMOVED)

    notifications_deleted, _ = Notification.objects.filter(
        created_at__lt=now - timedelta(days=settings.NOTIFICATION_RETENTION_DAYS)
    ).delete()
    return {"orders": orders_scrubbed, "messages": messages_scrubbed, "notifications": notifications_deleted}
