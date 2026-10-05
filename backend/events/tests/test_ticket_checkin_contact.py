from accounts.authentication import issue_token
from accounts.models import Role, StaffUser
from billing.models import Transaction
from events.models import EventTicketType, Ticket
from events.tests.test_event_rsvp import EventRSVPTestsBase


class TicketCheckinContactTests(EventRSVPTestsBase):
    """The gate check-in list (and a check-in's response) identifies a ticket
    holder by name and code. Organizers never get the buyer's phone — they
    reach buyers through AshantiHub Support — while staff still do."""

    def setUp(self):
        super().setUp()
        self.staff = StaffUser.objects.create(
            full_name="Marketing Person", email="marketing-checkin@example.com", password_hash="x",
            role=Role.objects.get(name="marketing"),
        )
        self.event = self._make_event()
        ticket_type = EventTicketType.objects.create(
            event=self.event, name="Regular", price="50.00", delivery_method=EventTicketType.DELIVERY_METHOD_CHOICES[0][0],
        )
        transaction = Transaction.objects.create(
            customer=self.attendee, amount="50.00", purpose="Event ticket", reference="TEST-CHECKIN-1",
        )
        self.ticket = Ticket.objects.create(
            ticket_type=ticket_type, purchased_by=self.attendee, transaction=transaction,
            delivery_method=ticket_type.delivery_method, price="50.00",
        )

    def _checkin_list(self, token):
        self._auth(token)
        return self.client.get(f"/api/events/{self.event.id}/tickets/checkin-list/")

    def test_organizer_check_in_list_has_the_buyer_name_but_not_phone(self):
        response = self._checkin_list(issue_token(self.organizer, "customer"))
        self.assertEqual(response.status_code, 200, response.content)
        row = response.json()["results"][0]
        self.assertEqual(row["purchased_by_name"], "Yaw Attendee")
        self.assertNotIn("purchased_by_phone", row)
        self.assertNotIn(self.attendee.phone.encode(), response.content)

    def test_organizer_check_in_response_has_no_buyer_phone(self):
        self._auth(issue_token(self.organizer, "customer"))
        response = self.client.post(
            f"/api/events/{self.event.id}/tickets/checkin/", {"code": self.ticket.code}, format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["purchased_by_name"], "Yaw Attendee")
        self.assertNotIn("purchased_by_phone", response.json())

    def test_staff_check_in_list_still_has_the_buyer_phone(self):
        row = self._checkin_list(issue_token(self.staff, "staff")).json()["results"][0]
        self.assertEqual(row["purchased_by_phone"], self.attendee.phone)
