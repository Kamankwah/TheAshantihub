"""Plan 7F-C, R5: a door scan never releases; a ticket outside the ledger stays held and is findable."""
from django.test import override_settings

from accounts.authentication import issue_token
from accounts.testing import make_staff, staff_token
from billing.models import Transaction
from events.models import EventTicketType, Ticket
from events.tests.test_event_rsvp import EventRSVPTestsBase
from ledger.tests.booking_helpers import BookingBase


class LegacyScanTests(EventRSVPTestsBase):
    def setUp(self):
        super().setUp()
        self.accountant = make_staff("accountant", "acct-legacy@example.com")
        self.event = self._make_event()
        self.ticket_type = EventTicketType.objects.create(
            event=self.event, name="Regular", price="50.00", delivery_method=EventTicketType.DELIVERY_METHOD_CHOICES[0][0],
        )
        self.ticket = self.make_ticket("TEST-LEGACY-1")

    def make_ticket(self, reference):
        transaction = Transaction.objects.create(
            customer=self.attendee, amount="50.00", purpose="Event ticket", reference=reference,
        )
        return Ticket.objects.create(
            ticket_type=self.ticket_type, purchased_by=self.attendee, transaction=transaction,
            delivery_method=self.ticket_type.delivery_method, price="50.00",
        )

    def scan(self, ticket, expect=200):
        self._auth(issue_token(self.organizer, "customer"))
        response = self.client.post(f"/api/events/{self.event.id}/tickets/checkin/", {"code": ticket.code}, format="json")
        self.assertEqual(response.status_code, expect, response.content)
        ticket.refresh_from_db()
        return response

    def test_scan_of_ledger_off_ticket_leaves_escrow_held(self):
        self.scan(self.ticket)
        self.assertEqual(self.ticket.escrow_status, Ticket.HELD)
        self.assertIsNone(self.ticket.escrow_released_at)

    @override_settings(LEDGER_ENABLED=True)
    def test_scan_of_pre_ledger_ticket_with_ledger_on_leaves_held(self):
        self.scan(self.ticket)
        self.assertEqual(self.ticket.escrow_status, Ticket.HELD)

    def test_scan_still_records_delivered_at_and_staff(self):
        staff = make_staff("marketing", "marketing-legacy@example.com")
        self._auth(staff_token(staff))
        response = self.client.post(f"/api/events/{self.event.id}/tickets/checkin/", {"code": self.ticket.code}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        self.ticket.refresh_from_db()
        self.assertIsNotNone(self.ticket.delivered_at)
        self.assertEqual(self.ticket.delivered_by_staff_id, staff.pk)
        self.assertEqual(self.ticket.escrow_status, Ticket.HELD)

    def test_accounting_manual_release_still_works_after_scan(self):
        self.scan(self.ticket)
        self._auth(staff_token(self.accountant, sudo=True))
        response = self.client.post(f"/api/events/tickets/{self.ticket.pk}/escrow/release/", {"note": "Scanned at the door"}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        self.ticket.refresh_from_db()
        self.assertEqual(self.ticket.escrow_status, Ticket.RELEASED)
        self.assertEqual(self.ticket.escrow_released_by_staff_id, self.accountant.pk)

    def test_rescan_still_refused(self):
        self.scan(self.ticket)
        self.scan(self.ticket, expect=400)

    def test_state_unreleased_legacy_filter_lists_only_sale_less_held(self):
        refunded = self.make_ticket("TEST-LEGACY-2")
        Ticket.objects.filter(pk=refunded.pk).update(refunded_at=self.now)
        released = self.make_ticket("TEST-LEGACY-3")
        Ticket.objects.filter(pk=released.pk).update(escrow_status=Ticket.RELEASED)
        self._auth(staff_token(self.accountant))
        response = self.client.get("/api/events/tickets/escrow/?state=unreleased_legacy")
        self.assertEqual(response.status_code, 200, response.content)
        rows = response.json()["results"]
        self.assertEqual([r["id"] for r in rows], [self.ticket.pk])
        self.assertIs(rows[0]["in_ledger"], False)

    def test_summary_reports_legacy_held(self):
        self._auth(staff_token(self.accountant))
        body = self.client.get("/api/events/tickets/escrow/summary/").json()
        self.assertEqual(body["legacy_held"], {"amount": "50.00", "count": 1})
        Ticket.objects.all().delete()
        body = self.client.get("/api/events/tickets/escrow/summary/").json()
        self.assertEqual(body["legacy_held"], {"amount": "0.00", "count": 0})


@override_settings(LEDGER_ENABLED=True)
class LedgerSaleTicketNotLegacyTests(BookingBase):
    def test_ledger_sale_ticket_is_not_legacy(self):
        sale = self.paid_tickets(quantity=1)
        ticket = Ticket.objects.get(transaction=sale.session.transaction)
        self.as_staff(make_staff("accountant", "acct-legacy2@example.com"))
        rows = self.client.get("/api/events/tickets/escrow/?state=unreleased_legacy").json()["results"]
        self.assertEqual(rows, [])
        all_rows = self.client.get("/api/events/tickets/escrow/").json()["results"]
        self.assertIs([r for r in all_rows if r["id"] == ticket.pk][0]["in_ledger"], True)
        self.assertEqual(self.client.get("/api/events/tickets/escrow/summary/").json()["legacy_held"]["count"], 0)
