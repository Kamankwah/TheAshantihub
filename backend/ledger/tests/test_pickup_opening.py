from datetime import timedelta

from django.test import override_settings
from django.utils import timezone

from ledger import verification
from orders.models import Order

from .test_refunds import RefundBase


@override_settings(LEDGER_ENABLED=True)
class PickupOpeningTests(RefundBase):
    def test_pickup_window_starts_at_opening(self):
        kofi = self.owner("Kofi")
        item = self.listing(kofi, "60.00")
        order = self.paid([(item, 1)])
        opening = timezone.now() - timedelta(hours=2)
        Order.objects.filter(pk=order.pk).update(placed_at=timezone.now() - timedelta(hours=30), ready_not_before=opening)
        # 30h after purchase but only 2h after the vendor opened: still inside the 24h window
        self.assertEqual(verification.expire_uncollected(), 0)
        row = [r for r in verification.pickup_queue() if r["order_id"] == order.pk][0]
        self.assertFalse(row["overdue"])
        self.assertEqual(row["collect_by"], opening + timedelta(hours=24))
        Order.objects.filter(pk=order.pk).update(ready_not_before=timezone.now() - timedelta(hours=25))
        self.assertEqual(verification.expire_uncollected(), 1)
