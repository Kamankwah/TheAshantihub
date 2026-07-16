"""HubtelWebhookView — signature verification, idempotency, amount
re-verification, and success/failure finalization. The webhook signature
scheme implemented in payments/hubtel_client.py is a best-guess
HMAC-SHA256-over-the-raw-body placeholder (UNVERIFIED against real Hubtel
docs — see that module's docstring); these tests exercise *this* codebase's
side of the contract (log-first, 401-on-invalid, idempotent, amount-checked,
monotonic) against that placeholder scheme, not against real Hubtel
behavior.
"""
import hashlib
import hmac
import json

from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import BusinessOwner, Customer
from billing.models import Transaction
from events.models import Event, EventTicketType
from listings.models import Category, Zone
from orders.models import Order
from payments.models import CheckoutSession, WebhookEvent

WEBHOOK_URL = "/api/payments/webhook/hubtel/"
WEBHOOK_SECRET = "test-webhook-secret"


def _sign(payload: dict) -> bytes:
    raw = json.dumps(payload).encode("utf-8")
    return raw


def _signature_for(raw_body: bytes) -> str:
    return hmac.new(WEBHOOK_SECRET.encode("utf-8"), raw_body, hashlib.sha256).hexdigest()


@override_settings(HUBTEL_WEBHOOK_SECRET=WEBHOOK_SECRET)
class WebhookSignatureTests(TestCase):
    def setUp(self):
        self.client = APIClient()

    def _post(self, payload, signature=None, sign=True):
        raw_body = _sign(payload)
        headers = {}
        if sign:
            headers["HTTP_X_HUBTEL_SIGNATURE"] = signature or _signature_for(raw_body)
        return self.client.generic(
            "POST", WEBHOOK_URL, data=raw_body, content_type="application/json", **headers
        )

    def test_missing_signature_is_401(self):
        response = self._post({"ClientReference": "AH-TEST-1", "Status": "Success"}, sign=False)
        self.assertEqual(response.status_code, 401)

    def test_invalid_signature_is_401(self):
        response = self._post(
            {"ClientReference": "AH-TEST-1", "Status": "Success"}, signature="not-the-real-signature",
        )
        self.assertEqual(response.status_code, 401)

    def test_every_webhook_including_invalid_signature_is_logged(self):
        self.assertEqual(WebhookEvent.objects.count(), 0)
        self._post({"ClientReference": "AH-TEST-1", "Status": "Success"}, signature="wrong")
        self.assertEqual(WebhookEvent.objects.count(), 1)
        event = WebhookEvent.objects.get()
        self.assertFalse(event.signature_valid)
        self.assertEqual(event.raw_payload["ClientReference"], "AH-TEST-1")

    def test_response_never_echoes_the_webhook_secret(self):
        response = self._post({"ClientReference": "AH-TEST-1", "Status": "Success"}, signature="wrong")
        self.assertNotIn(WEBHOOK_SECRET, response.content.decode())

    def test_no_secret_configured_rejects_everything(self):
        # HUBTEL_WEBHOOK_SECRET unset (the real launch-day default) — every
        # webhook is rejected, never silently trusted.
        with override_settings(HUBTEL_WEBHOOK_SECRET=""):
            response = self._post({"ClientReference": "AH-TEST-1", "Status": "Success"})
        self.assertEqual(response.status_code, 401)


@override_settings(HUBTEL_WEBHOOK_SECRET=WEBHOOK_SECRET)
class WebhookProcessingTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.customer = Customer.objects.create(
            full_name="Ama Buyer", phone="+233200991001", password_hash="x",
        )

    def _post(self, payload):
        raw_body = _sign(payload)
        signature = _signature_for(raw_body)
        return self.client.generic(
            "POST", WEBHOOK_URL, data=raw_body, content_type="application/json",
            HTTP_X_HUBTEL_SIGNATURE=signature,
        )

    def _make_pending_order_session(self, amount="150.00"):
        order = Order.objects.create(customer=self.customer, status=Order.PENDING, total_amount=amount)
        session = CheckoutSession.objects.create(
            customer=self.customer, kind=CheckoutSession.ORDER_CHECKOUT,
            amount=amount, purpose=f"AshantiHub Order #{order.id}",
            metadata={"order_id": order.id},
        )
        return order, session

    def test_unknown_reference_is_logged_and_acknowledged_not_errored(self):
        response = self._post({"ClientReference": "AH-DOES-NOT-EXIST", "Status": "Success", "Amount": 10})
        self.assertEqual(response.status_code, 200)
        event = WebhookEvent.objects.get()
        self.assertTrue(event.signature_valid)
        self.assertIn("Unknown reference", event.processing_note)

    def test_successful_payment_finalizes_order_and_creates_transaction(self):
        order, session = self._make_pending_order_session()
        response = self._post(
            {"ClientReference": session.reference, "Status": "Success", "Amount": 150.00}
        )
        self.assertEqual(response.status_code, 200, response.content)

        session.refresh_from_db()
        order.refresh_from_db()
        self.assertEqual(session.status, CheckoutSession.SUCCESS)
        self.assertIsNotNone(session.transaction)
        self.assertEqual(session.transaction.status, Transaction.SUCCESS)
        self.assertEqual(session.transaction.reference, session.reference)
        self.assertEqual(order.status, Order.PAID)

    def test_idempotent_replay_of_same_reference_does_not_duplicate(self):
        order, session = self._make_pending_order_session()
        payload = {"ClientReference": session.reference, "Status": "Success", "Amount": 150.00}

        first = self._post(payload)
        second = self._post(payload)

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(Transaction.objects.filter(reference=session.reference).count(), 1)

        second_event = WebhookEvent.objects.order_by("-received_at").first()
        self.assertIn("already", second_event.processing_note.lower())

    def test_amount_mismatch_is_logged_and_not_finalized(self):
        order, session = self._make_pending_order_session(amount="150.00")
        response = self._post(
            {"ClientReference": session.reference, "Status": "Success", "Amount": 5.00}
        )
        self.assertEqual(response.status_code, 200)

        session.refresh_from_db()
        order.refresh_from_db()
        self.assertEqual(session.status, CheckoutSession.PENDING)
        self.assertIsNone(session.transaction)
        self.assertEqual(order.status, Order.PENDING)
        self.assertFalse(Transaction.objects.filter(reference=session.reference).exists())

        event = WebhookEvent.objects.order_by("-received_at").first()
        self.assertIn("Amount mismatch", event.processing_note)

    def test_failed_status_marks_session_failed_without_transaction(self):
        order, session = self._make_pending_order_session()
        response = self._post(
            {"ClientReference": session.reference, "Status": "Failed", "Amount": 150.00}
        )
        self.assertEqual(response.status_code, 200)
        session.refresh_from_db()
        self.assertEqual(session.status, CheckoutSession.FAILED)
        self.assertIsNone(session.transaction)
        self.assertFalse(Transaction.objects.filter(reference=session.reference).exists())

    def test_ticket_purchase_failure_rolls_back_reserved_inventory(self):
        category = Category.objects.get(slug="festivals")
        zone = Zone.objects.get(name="Manhyia")
        event = Event.objects.create(
            category=category, zone=zone, submitted_by_customer=self.customer,
            name="Akwasidae Festival", description="Royal durbar.", address="Manhyia Palace",
            event_date=timezone.now() + timezone.timedelta(days=30), visibility_days=14,
            status=Event.APPROVED, paid_at=timezone.now(),
            expires_at=timezone.now() + timezone.timedelta(days=14),
        )
        ticket_type = EventTicketType.objects.create(
            event=event, name="General", price="25.00", quantity_total=10, quantity_sold=2,
        )
        session = CheckoutSession.objects.create(
            customer=self.customer, kind=CheckoutSession.TICKET_PURCHASE,
            amount="50.00", purpose="2x 'General' ticket(s)",
            metadata={
                "event_id": event.id, "ticket_type_id": ticket_type.id, "quantity": 2,
                "customer_id": self.customer.id, "delivery_method": "digital", "unit_price": "25.00",
            },
        )
        response = self._post(
            {"ClientReference": session.reference, "Status": "Failed", "Amount": "50.00"}
        )
        self.assertEqual(response.status_code, 200)
        ticket_type.refresh_from_db()
        self.assertEqual(ticket_type.quantity_sold, 0)
