from datetime import timedelta
from unittest import mock

from django.utils import timezone

from delivery import board, dispatching
from delivery.models import DeliverySettings, Offer

from .base import PICKUP
from .test_dispatch import EngineCase


class DeferredDispatchTests(EngineCase):
    def deferred(self, minutes=60):
        return self.make_order(ready_not_before=timezone.now() + timedelta(minutes=minutes))

    def test_dispatch_ignores_deferred_order(self):
        self.on_shift(self.rider)
        self.switch(True)
        order = self.deferred()
        self.assertNotIn(order, board.waiting_orders())
        out = dispatching.run_engine()
        self.assertEqual(out["offered"] + out["forced"], 0)
        self.assertFalse(Offer.objects.filter(order=order).exists())
        self.as_staff(self.manager)
        queue = self.client.get("/api/delivery/queue/")
        self.assertNotIn(order.pk, [row["order_id"] for row in queue.data["results"]])

    def test_deferred_order_dispatches_after_time(self):
        self.on_shift(self.rider, age=-3700)  # a fix that is fresh at `later`
        self.switch(True)
        order = self.deferred()
        later = timezone.now() + timedelta(minutes=61)
        with mock.patch("django.utils.timezone.now", return_value=later):
            self.assertIn(order, board.waiting_orders())
            self.assertEqual(dispatching.release_deferred(), 1)
            self.assertEqual(Offer.objects.filter(order=order, status=Offer.OFFERED).count(), 1)
            self.assertEqual(dispatching.release_deferred(), 0)  # idempotent: a live offer is not offered again
            self.assertEqual(Offer.objects.filter(order=order).count(), 1)

    def test_deadline_promise_starts_at_opening(self):
        order = self.deferred(minutes=600)
        from datetime import time
        limits = mock.Mock(opens_at=time(0, 0), closes_at=time(23, 59, 59), promise_standard_min=90, promise_express_min=45)
        self.assertEqual(dispatching.deadline_for(order, limits=limits), order.ready_not_before + timedelta(minutes=90))
