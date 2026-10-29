from datetime import timedelta

from django.utils import timezone

from disputes.models import Dispute
from orders.models import DeliveryAssignment, Order
from accounts.testing import make_staff

from .base import MarketplaceTestCase, make_customer, make_order


class OrderOversightTests(MarketplaceTestCase):
    def setUp(self):
        super().setUp()
        self.customer = make_customer("Yaw Mensah")
        self.rider = make_staff("dispatch", "kofi@example.com")
        self.waiting = make_order(self.customer, self.listing, delivery_method=Order.DOOR_TO_DOOR)
        self.assigned = make_order(self.customer, self.listing, delivery_method=Order.DOOR_TO_DOOR, delivery_status=Order.OUT_FOR_DELIVERY)
        DeliveryAssignment.objects.create(
            order=self.assigned, dispatch=self.rider, assigned_by=self.boss, status=DeliveryAssignment.PICKED_UP,
            picked_up_at=timezone.now(),
        )
        self.old = make_order(self.customer, self.listing, status=Order.PENDING)
        Order.objects.filter(pk=self.old.pk).update(placed_at=timezone.now() - timedelta(days=3))
        self.sign_in()

    def ids(self, query=""):
        response = self.client.get(f"/api/marketplace/orders/{query}")
        self.assertEqual(response.status_code, 200, response.content)
        return {row["id"]: row for row in response.json()["results"]}

    def test_rows_carry_business_customer_rider_and_no_fee_fields(self):
        row = self.ids()[self.assigned.pk]
        self.assertEqual(row["businesses"], ["Akosua Ntoma Kente"])
        self.assertEqual(row["customer"], "Yaw Mensah")
        self.assertEqual(row["rider"], self.rider.full_name)
        for key in row:
            self.assertNotIn("fee", key)
            self.assertNotIn("cash", key)

    def test_filters(self):
        self.assertEqual(set(self.ids("?delivery=waiting_for_rider")), {self.waiting.pk})
        self.assertEqual(set(self.ids("?payment=pending")), {self.old.pk})
        self.assertEqual(set(self.ids(f"?rider={self.rider.pk}")), {self.assigned.pk})
        self.assertEqual(set(self.ids("?day=today")), {self.waiting.pk, self.assigned.pk})
        self.assertEqual(set(self.ids(f"?q=%23{self.old.pk}")), {self.old.pk})
        Dispute.objects.create(order=self.waiting, raised_by=self.customer, reason=Dispute.DELIVERY_ISSUE, description="x")
        self.assertEqual(set(self.ids("?case=1")), {self.waiting.pk})

    def test_a_date_range(self):
        day = (timezone.localdate() - timedelta(days=3)).isoformat()
        self.assertEqual(set(self.ids(f"?day=range&from={day}&to={day}")), {self.old.pk})
        self.assertEqual(len(self.ids("?day=range&from=nonsense&to=x")), 3)

    def test_counts(self):
        body = self.client.get("/api/marketplace/orders/counts/").json()
        self.assertEqual(body["orders_today"], 2)
        self.assertEqual(body["items_value_today"], "20.00")
        self.assertEqual(body["in_flight"], 2)
        self.assertEqual(body["waiting_for_rider"], 1)
        self.assertEqual(body["delivered_today"], 0)
        self.assertEqual(body["riders"], [{"id": self.rider.pk, "name": self.rider.full_name}])

    def test_detail_steps_come_from_the_couriers_recorded_times(self):
        body = self.client.get(f"/api/marketplace/orders/{self.assigned.pk}/").json()
        texts = [step["text"] for step in body["steps"]]
        self.assertTrue(texts[0].startswith("Placed"))
        self.assertIn(f"Assigned to {self.rider.full_name} by {self.boss.full_name}", texts)
        self.assertIn("Picked up from the business", texts)
        self.assertNotIn("Delivered to the customer", texts)

    def test_export_leaves_out_the_customer(self):
        text = b"".join(self.client.get("/api/marketplace/orders/export/").streaming_content).decode("utf-8-sig")
        self.assertNotIn("Yaw Mensah", text)
        self.assertIn("Akosua Ntoma Kente", text)

    def test_needs_the_delivery_permission(self):
        self.sign_in(make_staff("scout", "scout@example.com"))
        self.assertEqual(self.client.get("/api/marketplace/orders/").status_code, 403)

    def test_detail_carries_the_ghanapost_code_and_landmark_blank_on_old_orders(self):
        Order.objects.filter(pk=self.assigned.pk).update(delivery_gps_address="AK-039-5028", delivery_landmark="Blue gate")
        body = self.client.get(f"/api/marketplace/orders/{self.assigned.pk}/").json()
        self.assertEqual((body["delivery_gps_address"], body["delivery_landmark"]), ("AK-039-5028", "Blue gate"))
        body = self.client.get(f"/api/marketplace/orders/{self.waiting.pk}/").json()
        self.assertEqual((body["delivery_gps_address"], body["delivery_landmark"]), ("", ""))
