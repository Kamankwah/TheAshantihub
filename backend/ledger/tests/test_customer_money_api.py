"""Plan 7G, Task 2: the `money` block on the customer's own lists, and its absence from the owner's."""
from django.db import connection
from django.test import override_settings
from django.test.utils import CaptureQueriesContext

from accounts.models import Customer
from ledger.models import BookingSale

from .booking_helpers import BookingBase


@override_settings(LEDGER_ENABLED=True)
class CustomerMoneyApiTests(BookingBase):
    def test_my_bookings_carry_the_money_block(self):
        sale = self.paid_stay(starts_in=20)
        self.as_customer()
        rows = self.client.get("/api/bookings/mine/").json()
        rows = rows["results"] if isinstance(rows, dict) else rows
        self.assertEqual(rows[0]["money"]["sale"], sale.pk)
        self.assertTrue(rows[0]["money"]["can_cancel"])

    def test_my_requests_carry_the_money_block(self):
        sale = self.paid_service()
        self.as_customer()
        rows = self.client.get("/api/services/requests/mine/").json()
        rows = rows["results"] if isinstance(rows, dict) else rows
        self.assertEqual(rows[0]["money"]["sale"], sale.pk)
        self.assertIsNone(rows[0]["money"]["release_at"])

    def test_owner_lists_carry_no_money_key(self):
        self.paid_stay()
        self.paid_service()
        self.as_owner()
        for url in ("/api/bookings/incoming/", "/api/services/requests/incoming/"):
            rows = self.client.get(url).json()
            rows = rows["results"] if isinstance(rows, dict) else rows
            self.assertTrue(rows, url)
            for row in rows:
                self.assertNotIn("money", row, url)

    def test_tickets_of_one_purchase_share_one_block(self):
        sale = self.paid_tickets(quantity=3)
        self.as_customer()
        rows = self.client.get("/api/events/tickets/mine/").json()
        self.assertEqual(len(rows), 3)
        self.assertEqual(rows[0]["money"]["sale"], sale.pk)
        self.assertEqual([r["money"] for r in rows], [rows[0]["money"]] * 3)
        self.assertTrue(rows[0]["money"]["can_report"])

    def test_ticket_with_no_sale_has_null_money(self):
        self.paid_tickets(quantity=2)
        BookingSale.objects.all().delete()
        self.as_customer()
        rows = self.client.get("/api/events/tickets/mine/").json()
        self.assertEqual(len(rows), 2)
        self.assertTrue(all(r["money"] is None for r in rows))

    def test_my_tickets_queries_do_not_grow_per_ticket(self):
        def count(quantity, phone):
            self.customer = Customer.objects.create(full_name="Buyer", phone=phone, password_hash="x")
            self.paid_tickets(quantity=quantity)
            self.as_customer()
            with CaptureQueriesContext(connection) as ctx:
                response = self.client.get("/api/events/tickets/mine/")
            self.assertEqual(response.status_code, 200)
            self.assertEqual(len(response.json()), quantity)
            return len(ctx)

        self.assertEqual(count(2, "+233200770031"), count(5, "+233200770032"))

    def test_stay_cancel_response_carries_block_and_wallet_refund(self):
        sale = self.paid_stay(starts_in=20)
        self.as_customer()
        response = self.client.post(f"/api/bookings/{sale.booking_id}/cancel/")
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        self.assertIn("wallet_refund", body)
        self.assertEqual(body["status"], "cancelled")
        self.assertEqual(body["money"]["sale"], sale.pk)
        self.assertFalse(body["money"]["can_cancel"])
        self.assertIsNotNone(body["money"]["refunded"])
