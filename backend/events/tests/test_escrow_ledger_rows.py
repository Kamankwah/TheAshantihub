"""Plan 1F task 16: the Accountant's escrow rows and summary follow the ledger (gate (lxii))."""
from django.test import override_settings

from accounts.testing import make_staff
from billing.models import Transaction
from events.models import Ticket
from ledger.tests.booking_helpers import BookingBase

LIST = "/api/events/tickets/escrow/"
SUMMARY = "/api/events/tickets/escrow/summary/"


class EscrowLedgerRowTests(BookingBase):
    def setUp(self):
        super().setUp()
        self.accountant = make_staff("accountant", "acct-rows@example.com")

    def legacy_ticket(self):
        transaction = Transaction.objects.create(
            customer=self.customer, amount="50.00", purpose="Event ticket", reference="TEST-ROWS-LEGACY",
        )
        return Ticket.objects.create(
            ticket_type=self.ticket_type, purchased_by=self.customer, transaction=transaction, price="50.00",
        )

    def rows(self):
        self.as_staff(self.accountant)
        response = self.client.get(LIST)
        self.assertEqual(response.status_code, 200, response.content)
        return {row["id"]: row for row in response.json()["results"]}

    @override_settings(LEDGER_ENABLED=True)
    def test_a_ticket_bought_with_the_ledger_on_is_in_ledger(self):
        bought = self.buy_tickets(quantity=1)
        self.assertEqual(bought.status_code, 201, bought.content)
        ticket_id = bought.json()[0]["id"]
        self.assertTrue(self.rows()[ticket_id]["in_ledger"])

    @override_settings(LEDGER_ENABLED=True)
    def test_a_ticket_bought_before_the_ledger_is_not(self):
        legacy = self.legacy_ticket()
        self.assertIs(self.rows()[legacy.pk]["in_ledger"], False)

    def test_ledger_off_marks_none(self):
        legacy = self.legacy_ticket()
        self.assertIs(self.rows()[legacy.pk]["in_ledger"], False)
        with override_settings(LEDGER_ENABLED=True):
            bought = self.buy_tickets(quantity=1)
            ticket_id = bought.json()[0]["id"]
        # The sale exists but the ledger is switched off again: nothing is marked.
        self.assertIs(self.rows()[ticket_id]["in_ledger"], False)

    @override_settings(LEDGER_ENABLED=True)
    def test_the_summary_says_where_order_and_booking_money_is_held_with_the_ledger_on(self):
        self.as_staff(self.accountant)
        response = self.client.get(SUMMARY)
        self.assertEqual(response.status_code, 200, response.content)
        items = response.json()["not_recorded"]
        self.assertEqual([item["name"] for item in items], ["Orders and bookings", "Tickets bought with the ledger on"])
        self.assertIn("Pending balance in the ledger", items[0]["why"])
        self.assertIn("48 hours after the event day ends", items[1]["why"])
        self.assertNotIn("not built", " ".join(item["why"] for item in items))

    def test_the_summary_is_unchanged_with_the_ledger_off(self):
        self.as_staff(self.accountant)
        items = self.client.get(SUMMARY).json()["not_recorded"]
        self.assertEqual([item["name"] for item in items], ["Orders and bookings", "Release timers"])
        self.assertIn("not held in escrow yet", items[0]["why"])
