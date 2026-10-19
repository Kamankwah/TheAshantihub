"""Plan 7F-C, task 1: a payment confirmed after its event was cancelled creates nothing. The ticket finalizer raises,
rolling the payment's effects back (no ticket, no SUCCESS transaction); a renewal paid after the cancel never reopens
the event."""
from datetime import timedelta

from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import Customer
from billing.models import Transaction
from events.models import Event, EventTicketType, Ticket
from listings.models import Category, Zone
from payments.models import CheckoutSession

from .test_webhook import WEBHOOK_SECRET, WEBHOOK_URL, _sign, _signature_for


@override_settings(HUBTEL_WEBHOOK_SECRET=WEBHOOK_SECRET)
class TicketAfterCancelTests(TestCase):
    def setUp(self):
        self.client = APIClient(raise_request_exception=False)
        self.customer = Customer.objects.create(full_name="Ama Buyer", phone="+233200991101", password_hash="x")
        self.organiser = Customer.objects.create(full_name="Kofi Organiser", phone="+233200991102", password_hash="x")
        now = timezone.now()
        self.event = Event.objects.create(
            category=Category.objects.get(slug="festivals"), zone=Zone.objects.get(name="Manhyia"),
            submitted_by_customer=self.organiser, name="Akwasidae Festival", description="Royal durbar.",
            address="Manhyia Palace", event_date=now + timedelta(days=30), visibility_days=14,
            status=Event.APPROVED, paid_at=now, expires_at=now + timedelta(days=14),
        )
        self.ticket_type = EventTicketType.objects.create(
            event=self.event, name="General", price="25.00", quantity_total=10, quantity_sold=2,
        )

    def _post(self, payload):
        raw_body = _sign(payload)
        return self.client.generic(
            "POST", WEBHOOK_URL, data=raw_body, content_type="application/json",
            HTTP_X_HUBTEL_SIGNATURE=_signature_for(raw_body),
        )

    def _ticket_session(self):
        return CheckoutSession.objects.create(
            customer=self.customer, kind=CheckoutSession.TICKET_PURCHASE, amount="50.00", purpose="2x 'General' ticket(s)",
            metadata={
                "event_id": self.event.id, "ticket_type_id": self.ticket_type.id, "quantity": 2,
                "customer_id": self.customer.id, "delivery_method": "digital", "unit_price": "25.00",
            },
        )

    def _assert_nothing_finalized(self, session):
        self.assertFalse(Ticket.objects.exists())
        session.refresh_from_db()
        self.assertEqual(session.status, CheckoutSession.PENDING)
        self.assertFalse(Transaction.objects.filter(reference=session.reference).exists())

    def test_hubtel_success_after_cancel_creates_no_ticket(self):
        session = self._ticket_session()
        Event.objects.filter(pk=self.event.pk).update(status=Event.CANCELLED, cancelled_at=timezone.now())
        response = self._post({"ClientReference": session.reference, "Status": "Success", "Amount": "50.00"})
        self.assertEqual(response.status_code, 500)
        self._assert_nothing_finalized(session)

    @override_settings(LEDGER_ENABLED=True)
    def test_hubtel_success_after_cancel_creates_no_ticket_with_ledger_on(self):
        session = self._ticket_session()
        Event.objects.filter(pk=self.event.pk).update(status=Event.CANCELLED, cancelled_at=timezone.now())
        response = self._post({"ClientReference": session.reference, "Status": "Success", "Amount": "50.00"})
        self.assertEqual(response.status_code, 500)
        self._assert_nothing_finalized(session)

    def test_success_before_cancel_still_creates_tickets(self):
        session = self._ticket_session()
        response = self._post({"ClientReference": session.reference, "Status": "Success", "Amount": "50.00"})
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(Ticket.objects.count(), 2)

    def test_renewal_paid_after_cancel_does_not_reopen_event(self):
        session = CheckoutSession.objects.create(
            customer=self.organiser, kind=CheckoutSession.EVENT_RENEW, amount="50.00", purpose="Event renewal",
            metadata={"event_id": self.event.id, "renew_days": 30},
        )
        Event.objects.filter(pk=self.event.pk).update(status=Event.CANCELLED, cancelled_at=timezone.now())
        response = self._post({"ClientReference": session.reference, "Status": "Success", "Amount": "50.00"})
        self.assertEqual(response.status_code, 200, response.content)
        self.event.refresh_from_db()
        self.assertEqual(self.event.status, Event.CANCELLED)
