"""Paying for services, stays and tickets records them in the ledger (Plan 1b, Task 3): the finalizers record the sale,
the pay endpoints put the payment-processing charge on top and mark the session for the reconciliation, and nothing
changes while the ledger is off. Review Focus 2 (a confirmation that arrives twice), 6 (switches off) and 7 (the price
check)."""
from datetime import timedelta
from decimal import Decimal

from django.test import override_settings
from django.utils import timezone

from accounts.models import Customer
from billing.models import Transaction
from events.models import Event, EventTicketType, Ticket
from ledger.models import Account, BookingSale, Journal
from payments.models import CheckoutSession
from payments.services import finalize_success
from services.models import ServiceRequest
from wallets import reconciliation
from wallets.models import ReconciliationRun

from .booking_helpers import BookingBase


@override_settings(LEDGER_ENABLED=True)
class BookingPaymentWiringTests(BookingBase):
    def test_a_paid_service_is_recorded_and_its_session_marked(self):
        sr = self.accepted_service("200.00")
        response = self.pay_service(sr)
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        self.assertEqual((body["status"], body["payment_method"], body["payment_processing"]), ("in_progress", "momo", "0.00"))
        sale = BookingSale.objects.get(service_request=sr)
        self.assertEqual((sale.kind, sale.base_pesewas, sale.customer, sale.business_owner), (BookingSale.SERVICE, 20000, self.customer, self.owner))
        self.assertTrue(sale.session.metadata["ledger"])
        self.assertEqual(self.balance(Account.VENDOR_PENDING, self.owner), 20000)

    @override_settings(SIMULATED_COLLECTION_CHARGE_BP=200)
    def test_mobile_money_pays_the_processing_charge_on_top_and_the_business_is_owed_the_price(self):
        response = self.book_stay(nights=2)                                                    # 2 nights x GH₵ 150.00
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.json()["payment_processing"], "6.00")
        sale = BookingSale.objects.get(booking_id=response.json()["id"])
        self.assertEqual((sale.session.amount, sale.session.processing_fee), (Decimal("306.00"), Decimal("6.00")))
        self.assertEqual((sale.kind, sale.base_pesewas), (BookingSale.STAY, 30000))
        self.assertEqual(self.balance(Account.PROVIDER_CLEARING), 30000)

    def test_tickets_are_one_sale_for_the_purchase_and_the_answer_keeps_its_shape(self):
        response = self.buy_tickets(quantity=3)
        self.assertEqual(response.status_code, 201, response.content)
        self.assertIsInstance(response.json(), list)
        sale = BookingSale.objects.get(kind=BookingSale.TICKETS)
        self.assertEqual((sale.event, sale.base_pesewas, sale.category), (self.event, 15000, "event"))
        self.assertEqual(Ticket.objects.filter(transaction=sale.session.transaction).count(), 3)

    def test_review_focus_a_confirmation_that_arrives_twice_records_once(self):
        sale = self.paid_service()
        finalize_success(sale.session)                                                         # Hubtel retrying its callback
        self.assertEqual(BookingSale.objects.count(), 1)
        self.assertEqual(Journal.objects.filter(kind="booking_payment").count(), 1)

    @override_settings(SIMULATED_COLLECTION_CHARGE_BP=200)
    def test_tickets_for_an_event_a_customer_organised_stay_outside_the_ledger(self):
        organiser = Customer.objects.create(full_name="Yaa Organiser", phone="+233200770009", password_hash="x")
        now = timezone.now()
        event = Event.objects.create(
            category=self.event.category, zone=self.zone, submitted_by_customer=organiser, name="Street Party",
            description="D.", address="Kumasi", event_date=now + timedelta(days=5), visibility_days=14,
            status=Event.APPROVED, paid_at=now, expires_at=now + timedelta(days=14),
        )
        ticket_type = EventTicketType.objects.create(event=event, name="Entry", price=Decimal("20.00"))
        response = self.buy_tickets(quantity=1, event=event, ticket_type=ticket_type)
        self.assertEqual(response.status_code, 201, response.content)
        session = CheckoutSession.objects.get(kind=CheckoutSession.TICKET_PURCHASE)
        self.assertNotIn("ledger", session.metadata)
        self.assertEqual((session.amount, session.processing_fee), (Decimal("20.00"), Decimal("0.00")))
        self.assertFalse(BookingSale.objects.exists())

    def test_the_businesss_statement_names_booking_payments(self):
        sale = self.paid_service()
        self.as_owner()
        row = self.client.get("/api/wallet/transactions/").json()["results"][0]
        self.assertEqual(
            (row["label"], row["account"], row["direction"], row["amount"], row["booking"], row["order"], row["reference"]),
            ("Booking payment", "pending", "in", "200.00", sale.pk, None, ""),
        )

    def test_review_focus_with_the_ledger_off_paying_is_exactly_as_before(self):
        with override_settings(LEDGER_ENABLED=False):
            sr = self.accepted_service()
            service = self.pay_service(sr)
            stay = self.book_stay()
            tickets = self.buy_tickets()
        self.assertEqual((service.status_code, stay.status_code, tickets.status_code), (200, 201, 201))
        self.assertEqual(service.json()["status"], "in_progress")
        for body in (service.json(), stay.json()):
            self.assertNotIn("payment_processing", body)
            self.assertNotIn("payment_method", body)
        self.assertFalse(BookingSale.objects.exists())
        self.assertFalse(Account.objects.exists())
        self.assertFalse(CheckoutSession.objects.filter(metadata__has_key="ledger").exists())


@override_settings(LEDGER_ENABLED=True)
class BookingReconciliationTests(BookingBase):
    def test_a_day_of_booking_payments_matches(self):
        self.paid_service("200.00")
        self.paid_stay(nights=1)                                                               # GH₵ 150.00
        self.paid_tickets(quantity=2)                                                          # 2 x GH₵ 50.00
        run = reconciliation.reconcile(timezone.localdate())
        self.assertEqual((run.status, run.differences), (ReconciliationRun.MATCHED, []))
        self.assertEqual((run.statement_in_pesewas, run.ledger_in_pesewas), (45000, 45000))

    def test_a_marked_booking_payment_with_no_journal_is_a_difference(self):
        reference = "AH-SERVICE_REQUEST-LOST000001"
        txn = Transaction.objects.create(customer=self.customer, amount=Decimal("80.00"), purpose="Service", reference=reference)
        CheckoutSession.objects.create(
            customer=self.customer, kind=CheckoutSession.SERVICE_REQUEST, amount=Decimal("80.00"), purpose="Service",
            reference=reference, status=CheckoutSession.SUCCESS, transaction=txn, metadata={"ledger": True},
        )
        run = reconciliation.reconcile(timezone.localdate())
        self.assertEqual(run.status, ReconciliationRun.MISMATCHED)
        self.assertEqual([(d["reference"], d["problem"]) for d in run.differences], [(reference, "missing_in_ledger")])


class ServicePriceTests(BookingBase):
    def respond(self, sr, price):
        self.as_owner()
        return self.client.post(f"/api/services/requests/{sr.pk}/respond/", {"action": "accept", "price": price}, format="json")

    def requested(self):
        return ServiceRequest.objects.create(customer=self.customer, listing=self.service, business_owner=self.owner, message="M.")

    def test_review_focus_a_service_price_must_be_above_zero_with_two_decimals_at_most(self):
        for price in ("-5.00", "0", "0.00", "12.345", "abc", "1e3", "NaN", True):
            sr = self.requested()
            with self.subTest(price=price):
                response = self.respond(sr, price)
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.json(), {"price": "Enter a price in GH₵ above 0.00, like 150.00."})
                sr.refresh_from_db()
                self.assertEqual(sr.status, ServiceRequest.REQUESTED)
        sr = self.requested()
        self.assertEqual(self.respond(sr, "150.5").status_code, 200)
        sr.refresh_from_db()
        self.assertEqual((sr.status, sr.agreed_price), (ServiceRequest.ACCEPTED, Decimal("150.50")))
