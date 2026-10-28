"""Plan 7F-C, task 1 (ruling R4): a cancelled event refunds every unrefunded ticket in full, scanned or not, from the
organiser's side, with the processing charge returned and borne by AshantiHub. A customer-organised event has no ledger
sale, so its tickets are only marked refunded with the REFUNDED billing row. A cancelled event is never reopened, paid
out, renewed or sold again."""
from datetime import timedelta
from decimal import Decimal
from unittest import mock

from django.test import override_settings
from django.utils import timezone

from accounts.models import Customer
from accounts.testing import make_staff
from billing.models import Transaction
from events import cancellation
from events.models import Event, EventPricingTier, EventTicketType, Ticket
from ledger import posting, sales
from ledger.models import Account, BookingRefund, BookingSale
from ledger.refunds import RefundError
from ledger.tests.booking_helpers import BookingBase


@override_settings(LEDGER_ENABLED=True)
class EventCancelServiceTests(BookingBase):
    def setUp(self):
        super().setUp()
        self.ops = make_staff("operations", "ops-7fc1@example.com")
        self.buyer2 = Customer.objects.create(full_name="Yaw Boateng", phone="+233200770002", password_hash="x")

    def wallet(self, customer=None):
        return self.balance(Account.CUSTOMER_WALLET, customer or self.customer)

    def tickets(self):
        return Ticket.objects.filter(ticket_type__event=self.event)

    def refund_rows(self):
        return Transaction.objects.filter(status=Transaction.REFUNDED)

    def test_cancel_sets_status_and_is_idempotent(self):
        self.paid_tickets(quantity=2)
        first = cancellation.cancel_event(self.event, by=self.ops, reason="Venue flooded")
        self.event.refresh_from_db()
        self.assertEqual(self.event.status, Event.CANCELLED)
        self.assertEqual(self.event.cancel_reason, "Venue flooded")
        self.assertEqual(self.event.cancelled_by_staff, self.ops)
        stamped = self.event.cancelled_at
        self.assertIsNotNone(stamped)
        self.assertEqual((first.tickets_refunded, first.tickets_left), (2, 0))

        again = cancellation.cancel_event(self.event, by=self.owner, reason="Something else")
        self.event.refresh_from_db()
        self.assertEqual((again.tickets_refunded, again.tickets_left), (2, 0))
        self.assertEqual((self.event.cancelled_at, self.event.cancel_reason, self.event.cancelled_by_staff), (stamped, "Venue flooded", self.ops))
        self.assertEqual(BookingRefund.objects.count(), 2)
        self.assertEqual(self.refund_rows().count(), 2)

    def test_organiser_cancel_records_no_staff(self):
        cancellation.cancel_event(self.event, by=self.owner, reason="Artist ill")
        self.event.refresh_from_db()
        self.assertEqual(self.event.status, Event.CANCELLED)
        self.assertIsNone(self.event.cancelled_by_staff)

    def test_cancel_refunds_every_unrefunded_ticket_to_buyers_wallet(self):
        self.paid_tickets(quantity=2)
        self.as_customer(self.buyer2)
        response = self.client.post(f"/api/events/{self.event.pk}/tickets/purchase/", {"ticket_type": self.ticket_type.pk, "quantity": 1}, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        scanned = self.tickets().filter(purchased_by=self.customer).order_by("pk").first()
        Ticket.objects.filter(pk=scanned.pk).update(delivered_at=timezone.now())

        result = cancellation.cancel_event(self.event, by=self.ops, reason="Venue flooded")
        self.assertEqual((result.tickets_refunded, result.tickets_left), (3, 0))
        self.assertEqual(self.wallet(), 10000)
        self.assertEqual(self.wallet(self.buyer2), 5000)
        self.assertFalse(self.tickets().filter(refunded_at__isnull=True).exists())
        scanned.refresh_from_db()
        self.assertEqual((scanned.refund_reason, scanned.refunded_by_staff), ("Venue flooded", self.ops))
        self.assertEqual(self.refund_rows().count(), 3)
        self.assertEqual(sorted(BookingRefund.objects.values_list("source", flat=True)), sorted(f"ticket-{t.pk}" for t in self.tickets()))

    def test_refund_comes_out_of_organiser_pending_before_release(self):
        self.paid_tickets(quantity=2)
        self.assertEqual(self.balance(Account.VENDOR_PENDING, self.owner), 10000)
        cancellation.cancel_event(self.event, by=self.ops, reason="Venue flooded")
        self.assertEqual(self.balance(Account.VENDOR_PENDING, self.owner), 0)
        self.assertEqual(self.balance(Account.VENDOR_AVAILABLE, self.owner), 0)
        self.assertEqual(self.balance(Account.PLATFORM_FEE_INCOME), 0)
        self.assertEqual(self.wallet(), 10000)

    def test_refund_after_release_may_take_available_negative(self):
        sale = self.paid_tickets(quantity=2)
        self.assertEqual(sales.release_due(sales.release_at(sale) + timedelta(minutes=1)), 1)
        sale.refresh_from_db()
        kept = sale.base_pesewas - sale.charged_pesewas
        self.assertEqual(self.balance(Account.VENDOR_AVAILABLE, self.owner), kept)
        posting.post(key="test-7fc-spent", kind="test_spend", lines=[
            posting.debit(posting.account_for(Account.VENDOR_AVAILABLE, self.owner), kept),
            posting.credit(posting.account_for(Account.PROVIDER_CLEARING), kept),
        ])
        result = cancellation.cancel_event(self.event, by=self.ops, reason="Venue flooded")
        self.assertEqual(result.tickets_refunded, 2)
        self.assertEqual(self.balance(Account.VENDOR_AVAILABLE, self.owner), -kept)
        self.assertEqual(self.balance(Account.PLATFORM_FEE_INCOME), 0)
        self.assertEqual(self.wallet(), 10000)

    @override_settings(SIMULATED_COLLECTION_CHARGE_BP=200)
    def test_processing_charge_returned_and_borne_by_platform(self):
        sale = self.paid_tickets(quantity=2)                                               # paid GH₵ 102.00
        self.assertEqual(sale.session.processing_fee, Decimal("2.00"))
        cancellation.cancel_event(self.event, by=self.ops, reason="Venue flooded")
        self.assertEqual(self.wallet(), 10200)
        self.assertEqual(self.balance(Account.PROVIDER_FEES), 200)
        self.assertEqual(self.balance(Account.VENDOR_PENDING, self.owner), 0)

    def test_customer_organised_event_marks_tickets_refunded_without_wallet(self):
        organiser = Customer.objects.create(full_name="Efua Organiser", phone="+233200770003", password_hash="x")
        now = timezone.now()
        event = Event.objects.create(
            category=self.event.category, zone=self.zone, submitted_by_customer=organiser, name="Street Party",
            description="Music.", address="Kumasi", event_date=now + timedelta(days=10), visibility_days=14,
            status=Event.APPROVED, paid_at=now, expires_at=now + timedelta(days=14),
        )
        ticket_type = EventTicketType.objects.create(event=event, name="Entry", price=Decimal("20.00"))
        response = self.buy_tickets(quantity=2, event=event, ticket_type=ticket_type)
        self.assertEqual(response.status_code, 201, response.content)
        self.assertFalse(BookingSale.objects.exists())

        result = cancellation.cancel_event(event, by=organiser, reason="Rain")
        self.assertEqual((result.tickets_refunded, result.tickets_left), (2, 0))
        self.assertFalse(Ticket.objects.filter(ticket_type=ticket_type, refunded_at__isnull=True).exists())
        self.assertEqual(self.refund_rows().filter(customer=self.customer).count(), 2)
        self.assertEqual(self.wallet(), 0)
        self.assertFalse(BookingRefund.objects.exists())

    def test_already_refunded_ticket_not_refunded_twice(self):
        sale = self.paid_tickets(quantity=2)
        first = self.tickets().order_by("pk").first()
        sales.refund_ticket(sale, first.pk, by=self.ops, reason="Asked early")
        result = cancellation.cancel_event(self.event, by=self.ops, reason="Venue flooded")
        self.assertEqual((result.tickets_refunded, result.tickets_left), (1, 0))
        self.assertEqual(self.wallet(), 10000)
        self.assertEqual(BookingRefund.objects.count(), 2)
        self.assertEqual(self.refund_rows().count(), 2)
        first.refresh_from_db()
        self.assertEqual(first.refund_reason, "Asked early")

    def test_interrupted_cancel_resumed_by_second_call(self):
        self.paid_tickets(quantity=2)
        second = self.tickets().order_by("pk").last()
        real_refund = sales.refund

        def flaky(sale, amount=None, *, source, **kwargs):
            if source == f"ticket-{second.pk}":
                raise RefundError("Provider fell over")
            return real_refund(sale, amount, source=source, **kwargs)

        with mock.patch("ledger.sales.refund", side_effect=flaky):
            first = cancellation.cancel_event(self.event, by=self.ops, reason="Venue flooded")
        self.assertEqual((first.tickets_refunded, first.tickets_left), (1, 1))
        self.event.refresh_from_db()
        self.assertEqual(self.event.status, Event.CANCELLED)
        second.refresh_from_db()
        self.assertIsNone(second.refunded_at)
        self.assertEqual(self.refund_rows().count(), 1)
        self.assertEqual(self.wallet(), 5000)

        again = cancellation.cancel_event(self.event, by=self.ops, reason="Venue flooded")
        self.assertEqual((again.tickets_refunded, again.tickets_left), (2, 0))
        self.assertEqual(self.wallet(), 10000)
        self.assertEqual(self.refund_rows().count(), 2)

    def test_cancelled_event_not_purchasable(self):
        cancellation.cancel_event(self.event, by=self.ops, reason="Venue flooded")
        self.assertEqual(self.buy_tickets(quantity=1).status_code, 404)

    # --- the guards around a cancelled event ---

    def test_edit_does_not_reopen_cancelled_event(self):
        cancellation.cancel_event(self.event, by=self.owner, reason="Artist ill")
        self.as_owner()
        response = self.client.patch(f"/api/events/mine/{self.event.pk}/", {"name": "Highlife Night II"}, format="json")
        self.assertEqual(response.status_code, 409, response.content)
        self.assertEqual(response.json()["code"], "event_cancelled")
        self.event.refresh_from_db()
        self.assertEqual((self.event.status, self.event.name), (Event.CANCELLED, "Highlife Night"))

    def test_approve_and_renew_refuse_cancelled_event(self):
        EventPricingTier.objects.get_or_create(duration_days=30, defaults={"live_price": Decimal("50.00")})
        cancellation.cancel_event(self.event, by=self.owner, reason="Artist ill")
        self.as_staff(self.ops)
        response = self.client.post(f"/api/events/moderation/{self.event.pk}/approve/")
        self.assertEqual(response.status_code, 409, response.content)
        self.assertEqual(response.json()["code"], "event_cancelled")
        response = self.client.post(f"/api/events/moderation/{self.event.pk}/reject/", {"reason": "No."}, format="json")
        self.assertEqual(response.status_code, 409, response.content)
        self.as_owner()
        response = self.client.post(f"/api/events/{self.event.pk}/renew/", {"additional_days": 30}, format="json")
        self.assertEqual(response.status_code, 409, response.content)
        self.assertEqual(response.json()["code"], "event_cancelled")
        self.event.refresh_from_db()
        self.assertEqual(self.event.status, Event.CANCELLED)

    @override_settings(LEDGER_ENABLED=False)
    def test_manual_release_refused_for_cancelled_event(self):
        response = self.buy_tickets(quantity=1)
        self.assertEqual(response.status_code, 201, response.content)
        ticket = self.tickets().get()
        Event.objects.filter(pk=self.event.pk).update(status=Event.CANCELLED)  # a ticket the cancel has not refunded yet
        self.as_staff(make_staff("accountant", "acct-7fc1@example.com"), sudo=True)
        response = self.client.post(f"/api/events/tickets/{ticket.pk}/escrow/release/", {"note": "Pay the organiser"}, format="json")
        self.assertEqual(response.status_code, 409, response.content)
        self.assertEqual(response.json()["code"], "event_cancelled")
        ticket.refresh_from_db()
        self.assertEqual(ticket.escrow_status, Ticket.HELD)
