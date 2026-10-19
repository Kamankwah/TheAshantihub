"""A staff member's manual release of a held ticket's payment asks for the password again (wallet rulings 7C, task 1)."""
from accounts.authentication import issue_token
from accounts.testing import make_staff, staff_token
from billing.models import Transaction
from events.models import EventTicketType, Ticket
from events.tests.test_event_rsvp import EventRSVPTestsBase


class ManualEscrowReleaseSudoTests(EventRSVPTestsBase):
    def setUp(self):
        super().setUp()
        self.accountant = make_staff("accountant", "kofi-sudo@example.com")
        event = self._make_event()
        ticket_type = EventTicketType.objects.create(
            event=event, name="Regular", price="50.00", delivery_method=EventTicketType.DELIVERY_METHOD_CHOICES[0][0],
        )
        transaction = Transaction.objects.create(
            customer=self.attendee, amount="50.00", purpose="Event ticket", reference="TEST-SUDO-1",
        )
        self.ticket = Ticket.objects.create(
            ticket_type=ticket_type, purchased_by=self.attendee, transaction=transaction,
            delivery_method=ticket_type.delivery_method, price="50.00",
        )
        self.url = f"/api/events/tickets/{self.ticket.pk}/escrow/release/"

    def release(self, *, sudo):
        self._auth(staff_token(self.accountant, sudo=sudo))
        return self.client.post(self.url, {"note": "Physical delivery ticket"}, format="json")

    def test_manual_release_without_sudo_is_403(self):
        response = self.release(sudo=False)
        self.assertEqual(response.status_code, 403, response.content)
        self.assertEqual(response.json()["code"], "sudo_required")
        self.ticket.refresh_from_db()
        self.assertEqual(self.ticket.escrow_status, Ticket.HELD)

    def test_manual_release_with_sudo_works(self):
        response = self.release(sudo=True)
        self.assertEqual(response.status_code, 200, response.content)
        self.ticket.refresh_from_db()
        self.assertEqual(self.ticket.escrow_status, Ticket.RELEASED)
