from datetime import timedelta

from django.utils import timezone

from accounts.models import Customer
from activity.models import ActivityEvent
from disputes.models import Dispute
from orders.models import Order

from .base import MarketplaceTestCase, make_customer, make_order


class CustomerOversightTests(MarketplaceTestCase):
    def setUp(self):
        super().setUp()
        self.ama = make_customer("Ama Buyer")
        self.kwasi = make_customer("Kwasi Owusu")
        make_order(self.ama, self.listing, total="30.00")
        make_order(self.ama, self.listing, total="20.00")
        make_order(self.ama, self.listing, total="99.00", status=Order.PENDING)
        self.order = make_order(self.kwasi, self.listing, total="15.00")
        Dispute.objects.create(order=self.order, raised_by=self.kwasi, reason=Dispute.DELIVERY_ISSUE, description="Not received")
        self.sign_in()

    def rows(self, query=""):
        response = self.client.get(f"/api/marketplace/customers/{query}")
        self.assertEqual(response.status_code, 200, response.content)
        return {row["name"]: row for row in response.json()["results"]}

    def test_counts_come_from_paid_orders_and_disputes(self):
        rows = self.rows()
        self.assertEqual(rows["Ama Buyer"]["orders"], 2)
        self.assertEqual(rows["Ama Buyer"]["spend"], "50.00")
        self.assertEqual(rows["Kwasi Owusu"]["disputes"], 1)
        self.assertEqual(rows["Kwasi Owusu"]["open_disputes"], 1)

    def test_phones_are_masked_and_no_consent_column_exists(self):
        row = self.rows()["Ama Buyer"]
        self.assertIn("***", row["phone"])
        self.assertNotIn(self.ama.phone[-7:], row["phone"])
        for key in row:
            self.assertNotIn("sms", key)
            self.assertNotIn("marketing", key)

    def test_filters(self):
        self.assertEqual(set(self.rows("?case=open")), {"Kwasi Owusu"})
        self.assertEqual(set(self.rows("?case=none")), {"Ama Buyer"})
        self.assertEqual(set(self.rows(f"?q=%23{self.order.pk}")), {"Kwasi Owusu"})
        self.assertEqual(set(self.rows(f"?q={self.ama.phone[-9:]}")), {"Ama Buyer"})
        Customer.objects.filter(pk=self.kwasi.pk).update(is_suspended=True, suspension_reason="Abuse")
        self.assertEqual(set(self.rows("?status=suspended")), {"Kwasi Owusu"})
        self.assertEqual(set(self.rows("?status=active")), {"Ama Buyer"})

    def test_header_counts(self):
        body = self.client.get("/api/marketplace/customers/counts/").json()
        self.assertEqual(body["total"], 2)
        self.assertEqual(body["ordered_90_days"], 2)
        self.assertEqual(body["with_open_case"], 1)
        self.assertEqual(body["suspended"], 0)

    def test_ordered_90_days_ignores_old_orders(self):
        Order.objects.filter(customer=self.kwasi).update(placed_at=timezone.now() - timedelta(days=120))
        self.assertEqual(self.client.get("/api/marketplace/customers/counts/").json()["ordered_90_days"], 1)

    def test_detail_lists_orders_and_disputes_with_the_phone_still_masked(self):
        body = self.client.get(f"/api/marketplace/customers/{self.kwasi.pk}/").json()
        self.assertEqual(body["disputes_recent"][0]["order"], self.order.pk)
        self.assertEqual(body["orders_recent"][0]["businesses"], ["Akosua Ntoma Kente"])
        self.assertIn("***", body["phone"])

    def test_revealing_a_phone_needs_the_password_and_is_recorded_without_the_number(self):
        url = f"/api/marketplace/customers/{self.ama.pk}/reveal-phone/"
        self.assertEqual(self.client.post(url).json()["code"], "sudo_required")
        self.sign_in(sudo=True)
        self.assertEqual(self.client.post(url).json(), {"phone": self.ama.phone})
        event = ActivityEvent.objects.get(verb="customer.phone_revealed")
        self.assertEqual(event.target_id, str(self.ama.pk))
        self.assertNotIn(self.ama.phone, str(event.after) + event.summary)

    def test_export_needs_the_password_and_is_recorded_as_personal_data(self):
        self.assertEqual(self.client.get("/api/marketplace/customers/export/").status_code, 403)
        self.sign_in(sudo=True)
        response = self.client.get("/api/marketplace/customers/export/")
        self.assertEqual(response.status_code, 200)
        text = b"".join(response.streaming_content).decode("utf-8-sig")
        self.assertIn("Ama Buyer", text)
        self.assertIn(self.ama.phone, text)
        event = ActivityEvent.objects.get(verb="report.exported")
        self.assertTrue(event.after["personal_data"])
        self.assertEqual(event.after["rows"], 2)

    def test_a_role_without_users_view_is_refused(self):
        self.sign_in(self.support)
        self.assertEqual(self.client.get("/api/marketplace/customers/export/").status_code, 403)
