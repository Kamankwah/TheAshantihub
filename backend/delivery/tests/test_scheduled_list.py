from datetime import timedelta

from django.utils import timezone
from rest_framework.test import APIClient

from ledger.models import OrderRefund
from orders.models import Order

from .test_dispatch import EngineCase


class ScheduledListTests(EngineCase):
    URL = "/api/delivery/scheduled/"

    def held(self, minutes):
        return self.make_order(ready_not_before=timezone.now() + timedelta(minutes=minutes))

    def get(self, staff=None, url=None):
        self.as_staff(staff or self.manager)
        return self.client.get(url or self.URL)

    def test_lists_only_paid_held_orders_soonest_first(self):
        late, soon = self.held(300), self.held(60)
        self.make_order()  # not held
        res = self.get()
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual([r["order_id"] for r in res.data["results"]], [soon.pk, late.pk])
        row = res.data["results"][0]
        self.assertIsNotNone(row["ready_not_before"])
        self.assertEqual(row["vendors"][0]["business_id"], self.listing.business_owner_id)
        self.assertIn("next_open", row["vendors"][0])

    def test_released_and_unpaid_orders_not_listed(self):
        shown = self.held(60)
        released = self.held(60)
        released.ready_not_before = timezone.now() - timedelta(minutes=1)
        released.save(update_fields=["ready_not_before"])
        unpaid = self.held(60)
        unpaid.status = Order.PENDING
        unpaid.save(update_fields=["status"])
        refunded = self.held(60)
        OrderRefund.objects.create(order=refunded, source="cancel", whole=True, amount_pesewas=10000)
        res = self.get()
        self.assertEqual([r["order_id"] for r in res.data["results"]], [shown.pk])

    def test_paginated_and_matches_scheduled_count(self):
        for i in range(23):
            self.held(60 + i)
        first = self.get()
        self.assertEqual(first.data["count"], 23)
        self.assertEqual(len(first.data["results"]), 20)
        self.assertIsNotNone(first.data["next"])
        second = self.get(url=self.URL + "?page=2")
        self.assertEqual(len(second.data["results"]), 3)
        self.as_staff(self.manager)
        queue = self.client.get("/api/delivery/queue/")
        self.assertEqual(queue.data["scheduled_count"], first.data["count"])

    def test_requires_manager_permission(self):
        self.held(60)
        self.assertEqual(self.get(self.rider_staff).status_code, 403)
        self.assertIn(APIClient().get(self.URL).status_code, (401, 403))
