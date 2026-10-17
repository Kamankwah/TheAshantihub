"""Paying a service, a stay or tickets from the AshantiHub wallet (Plan 1b, Task 4; spec §5): the wallet is debited
instead of provider clearing, it must cover the whole booking, and a refused payment leaves nothing behind. Review Focus
5 (a wallet that covers only part)."""
from datetime import timedelta
from decimal import Decimal

from django.db import transaction
from django.test import override_settings
from django.utils import timezone

from accounts.models import Customer
from billing.models import Transaction
from bookings.models import Booking
from events.models import Event, EventTicketType, Ticket
from ledger import posting
from ledger.models import Account, BookingSale
from payments.models import CheckoutSession
from payments.services import process_payment
from services.models import ServiceRequest

from .booking_helpers import BookingBase, fund


@override_settings(LEDGER_ENABLED=True)
class PayBookingFromWalletTests(BookingBase):
    def customer_event(self):
        organiser = Customer.objects.create(full_name="Yaa Organiser", phone="+233200770009", password_hash="x")
        now = timezone.now()
        event = Event.objects.create(
            category=self.event.category, zone=self.zone, submitted_by_customer=organiser, name="Street Party",
            description="D.", address="Kumasi", event_date=now + timedelta(days=5), visibility_days=14,
            status=Event.APPROVED, paid_at=now, expires_at=now + timedelta(days=14),
        )
        return event, EventTicketType.objects.create(event=event, name="Entry", price=Decimal("20.00"))

    @override_settings(SIMULATED_COLLECTION_CHARGE_BP=200)
    def test_a_service_paid_from_the_wallet_carries_no_processing_charge(self):
        fund(self.customer, 30000, "fund-1b-wallet-1")
        sr = self.accepted_service("200.00")
        response = self.pay_service(sr, method="wallet")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual((response.json()["payment_method"], response.json()["payment_processing"]), ("wallet", "0.00"))
        sale = BookingSale.objects.get(service_request=sr)
        self.assertEqual((sale.session.provider, sale.session.amount), (CheckoutSession.WALLET, Decimal("200.00")))
        self.assertEqual(self.balance(Account.CUSTOMER_WALLET, self.customer), 10000)
        self.assertEqual(self.balance(Account.VENDOR_PENDING, self.owner), 20000)
        self.assertEqual(self.balance(Account.PROVIDER_CLEARING), 30000)                       # only the top-up moved it

    def test_a_stay_and_tickets_paid_from_the_wallet(self):
        fund(self.customer, 40000, "fund-1b-wallet-2")
        self.assertEqual(self.book_stay(nights=1, method="wallet").status_code, 201)           # GH₵ 150.00
        self.assertEqual(self.buy_tickets(quantity=2, method="wallet").status_code, 201)       # GH₵ 100.00
        self.assertEqual(self.balance(Account.CUSTOMER_WALLET, self.customer), 15000)
        self.assertEqual(BookingSale.objects.filter(session__provider=CheckoutSession.WALLET).count(), 2)

    def test_review_focus_a_wallet_that_covers_only_part_pays_nothing_and_keeps_nothing(self):
        fund(self.customer, 10000, "fund-1b-wallet-3")                                        # GH₵ 100.00
        sr = self.accepted_service("200.00")
        for response in (
            self.pay_service(sr, method="wallet"),
            self.book_stay(nights=1, method="wallet"),                                        # GH₵ 150.00
            self.buy_tickets(quantity=3, method="wallet"),                                    # GH₵ 150.00
        ):
            self.assertEqual((response.status_code, response.json()["code"]), (409, "insufficient_funds"))
        sr.refresh_from_db()
        self.assertEqual(sr.status, ServiceRequest.ACCEPTED)
        self.ticket_type.refresh_from_db()
        self.assertEqual(self.ticket_type.quantity_sold, 0)
        for model in (Booking, Ticket, CheckoutSession, Transaction, BookingSale):
            self.assertFalse(model.objects.exists(), model.__name__)
        self.assertEqual(self.balance(Account.CUSTOMER_WALLET, self.customer), 10000)

    def test_an_unknown_method_is_refused_and_the_wallet_needs_the_ledger(self):
        sr = self.accepted_service()
        response = self.pay_service(sr, method="card")
        self.assertEqual(
            (response.status_code, response.json()), (400, {"payment_method": "Pay by mobile money or from your AshantiHub wallet."}),
        )
        with override_settings(LEDGER_ENABLED=False):
            response = self.pay_service(sr, method="wallet")
        self.assertEqual((response.status_code, response.json()["code"]), (409, "ledger_off"))
        sr.refresh_from_db()
        self.assertEqual(sr.status, ServiceRequest.ACCEPTED)

    def test_tickets_for_a_customer_organised_event_cannot_be_paid_from_the_wallet(self):
        fund(self.customer, 5000, "fund-1b-wallet-4")
        event, ticket_type = self.customer_event()
        response = self.buy_tickets(quantity=1, method="wallet", event=event, ticket_type=ticket_type)
        self.assertEqual((response.status_code, response.json()["code"]), (409, "wallet_not_accepted"))
        ticket_type.refresh_from_db()
        self.assertEqual(ticket_type.quantity_sold, 0)
        self.assertEqual(self.balance(Account.CUSTOMER_WALLET, self.customer), 5000)

    def test_the_finalizer_refuses_a_wallet_payment_no_business_can_receive(self):
        fund(self.customer, 5000, "fund-1b-wallet-5")
        event, ticket_type = self.customer_event()
        with self.assertRaises(posting.PostingError), transaction.atomic():
            process_payment(
                kind=CheckoutSession.TICKET_PURCHASE, amount=Decimal("20.00"), purpose="Tickets", customer=self.customer,
                wallet=True, metadata={
                    "event_id": event.pk, "ticket_type_id": ticket_type.pk, "quantity": 1, "customer_id": self.customer.pk,
                    "delivery_method": ticket_type.delivery_method, "unit_price": "20.00",
                },
            )
        self.assertFalse(Ticket.objects.exists())
        self.assertEqual(self.balance(Account.CUSTOMER_WALLET, self.customer), 5000)

    def test_other_kinds_still_cannot_be_paid_from_the_wallet(self):
        with self.assertRaises(ValueError):
            process_payment(kind=CheckoutSession.EVENT_PAY, amount=Decimal("10.00"), purpose="Listing", customer=self.customer, wallet=True)
