from datetime import timedelta

from django.utils import timezone

from accounts.models import Permission
from accounts.testing import make_staff

from .test_dispatch import EngineCase


class ScheduledAccessTests(EngineCase):
    """The Scheduled list is readable with delivery.manage OR orders.manage_delivery; sending early needs delivery.manage."""

    LIST = "/api/delivery/scheduled/"

    def staffer(self, email, *codenames):
        staff = make_staff("support", email, phone="+233244000099")
        for code in codenames:
            staff.extra_permissions.add(Permission.objects.get(codename=code))
        return staff

    def held(self):
        return self.make_order(ready_not_before=timezone.now() + timedelta(minutes=90))

    def send(self, staff, order):
        self.as_staff(staff)
        return self.client.post(f"/api/delivery/orders/{order.pk}/send-early/", {"reason": "Shop confirmed it is open"}, format="json")

    def test_manage_delivery_only_user_can_list_and_send_early(self):
        # orders.manage_delivery reads the list; with delivery.manage as well the same person can send early.
        staff = self.staffer("both@example.com", "orders.manage_delivery", "delivery.manage")
        order = self.held()
        self.as_staff(staff)
        listed = self.client.get(self.LIST)
        self.assertEqual(listed.status_code, 200, listed.content)
        self.assertEqual([r["order_id"] for r in listed.data["results"]], [order.pk])
        self.assertEqual(self.send(staff, order).status_code, 200)

    def test_read_only_user_can_list_but_not_send_early_403(self):
        staff = self.staffer("reader@example.com", "orders.manage_delivery")
        order = self.held()
        self.as_staff(staff)
        listed = self.client.get(self.LIST)
        self.assertEqual(listed.status_code, 200, listed.content)
        self.assertEqual([r["order_id"] for r in listed.data["results"]], [order.pk])
        self.assertEqual(self.send(staff, order).status_code, 403)
        order.refresh_from_db()
        self.assertGreater(order.ready_not_before, timezone.now())

    def test_user_with_neither_gets_403(self):
        staff = self.staffer("neither@example.com")
        self.held()
        self.as_staff(staff)
        self.assertEqual(self.client.get(self.LIST).status_code, 403)
        self.assertEqual(self.send(staff, self.held()).status_code, 403)
