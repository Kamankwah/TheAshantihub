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


class LegacyAssignAndCountTests(EngineCase):
    def assign_via_api(self, order):
        self.as_staff(self.manager)
        return self.client.post(f"/api/orders/{order.id}/assign-dispatch/", {"dispatch": self.rider_staff.id}, format="json")

    def test_legacy_assign_refused_until_due_then_allowed(self):
        order = self.make_order(ready_not_before=timezone.now() + timedelta(minutes=60))
        r = self.assign_via_api(order)
        self.assertEqual(r.status_code, 409, r.content)
        self.assertIn("opens", r.json()["detail"].lower())
        order.__class__.objects.filter(pk=order.pk).update(ready_not_before=timezone.now() - timedelta(minutes=1))  # now due
        order.refresh_from_db()
        self.assertEqual(self.assign_via_api(order).status_code, 200)

    def test_manager_order_list_exposes_ready_not_before(self):
        order = self.make_order(ready_not_before=timezone.now() + timedelta(minutes=60))
        self.as_staff(self.manager)
        rows = self.client.get("/api/orders/delivery/").json()
        rows = rows["results"] if isinstance(rows, dict) else rows
        self.assertIsNotNone([r for r in rows if r["id"] == order.pk][0]["ready_not_before"])

    def test_scheduled_count_in_queue_and_board(self):
        self.make_order(ready_not_before=timezone.now() + timedelta(minutes=60))
        self.make_order(ready_not_before=timezone.now() + timedelta(minutes=90))
        self.make_order()
        self.as_staff(self.manager)
        queue = self.client.get("/api/delivery/queue/").json()
        self.assertEqual(queue["scheduled_count"], 2)
        self.assertEqual(queue["total"], 1)
        from delivery import board
        self.assertEqual(board.live()["kpis"]["scheduled_count"], 2)
