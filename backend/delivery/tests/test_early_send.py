from datetime import timedelta

from django.utils import timezone

from activity.models import ActivityEvent
from accounts.testing import make_staff
from ledger.models import OrderRefund
from notifications.models import Notification
from orders.models import DeliveryAssignment, Order

from .test_dispatch import EngineCase


class EarlySendTests(EngineCase):
    def held(self, minutes=120):
        return self.make_order(ready_not_before=timezone.now() + timedelta(minutes=minutes))

    def send(self, order, reason="Shop confirmed it is open", staff=None):
        self.as_staff(staff or self.manager)
        return self.client.post(f"/api/delivery/orders/{order.pk}/send-early/", {"reason": reason}, format="json")

    def notices(self, order):
        return Notification.objects.filter(customer=order.customer, title="Your order is being sent now").count()

    def test_send_early_releases_a_held_order_and_logs_who_and_why(self):
        order = self.held()
        res = self.send(order)
        self.assertEqual(res.status_code, 200, res.content)
        order.refresh_from_db()
        self.assertLessEqual(order.ready_not_before, timezone.now())
        event = ActivityEvent.objects.get(verb="delivery.early_send")
        self.assertEqual(event.target_id, str(order.pk))
        self.assertEqual(event.after["reason"], "Shop confirmed it is open")
        self.assertEqual(event.actor_id, self.manager.pk)
        self.assertEqual(self.notices(order), 1)

    def test_reason_under_3_chars_400(self):
        order = self.held()
        self.assertEqual(self.send(order, "ab").status_code, 400)
        self.assertEqual(self.send(order, "  ").status_code, 400)
        order.refresh_from_db()
        self.assertGreater(order.ready_not_before, timezone.now())
        self.assertFalse(ActivityEvent.objects.filter(verb="delivery.early_send").exists())

    def test_not_held_order_409(self):
        res = self.send(self.make_order())
        self.assertEqual(res.status_code, 409)
        self.assertEqual(res.data["code"], "not_held")
        self.assertEqual(self.send(self.make_order(ready_not_before=timezone.now() - timedelta(minutes=5))).status_code, 409)

    def test_second_call_is_noop(self):
        order = self.held()
        self.assertEqual(self.send(order).status_code, 200)
        again = self.send(order)
        self.assertEqual(again.status_code, 409)
        self.assertEqual(again.data["code"], "not_held")
        self.assertEqual(ActivityEvent.objects.filter(verb="delivery.early_send").count(), 1)
        self.assertEqual(self.notices(order), 1)

    def assert_refused(self, order):
        res = self.send(order)
        self.assertEqual(res.status_code, 409)
        self.assertEqual(res.data["code"], "not_sendable")
        order.refresh_from_db()
        self.assertGreater(order.ready_not_before, timezone.now())
        self.assertFalse(ActivityEvent.objects.filter(verb="delivery.early_send").exists())
        self.assertEqual(self.notices(order), 0)

    def test_cancelled_or_refunded_order_refused(self):
        cancelled = self.held()
        Order.objects.filter(pk=cancelled.pk).update(status=Order.CANCELLED)
        self.assert_refused(cancelled)
        refunded = self.held()
        OrderRefund.objects.create(order=refunded, source="cancel", whole=True, amount_pesewas=10000)
        self.assert_refused(refunded)

    def test_partial_refund_still_allows_send_early(self):
        order = self.held()
        OrderRefund.objects.create(order=order, source="dispute-1", whole=False, amount_pesewas=1000)
        self.assertEqual(self.send(order).status_code, 200)

    def test_assign_after_send_early_works(self):
        order = self.held()
        self.as_staff(self.manager)
        url = f"/api/orders/{order.pk}/assign-dispatch/"
        self.assertEqual(self.client.post(url, {"dispatch": self.rider_staff.pk}, format="json").status_code, 409)
        self.assertEqual(self.send(order).status_code, 200)
        res = self.client.post(url, {"dispatch": self.rider_staff.pk}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertTrue(DeliveryAssignment.objects.filter(order=order).exists())

    def test_requires_the_manager_permission(self):
        order = self.held()
        self.assertEqual(self.send(order, staff=self.rider_staff).status_code, 403)
        order.refresh_from_db()
        self.assertGreater(order.ready_not_before, timezone.now())
