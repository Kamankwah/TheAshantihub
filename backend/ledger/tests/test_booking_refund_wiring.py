"""Refunds wired into the booking flows (Plan 1b, Task 8): the customer's stay cancel, Support's cancel, the Accountant's
ticket refund and dispute resolution, and the hand-over steps locking their row. Review Focus 6 (a hand-over or a second
refund racing a refund), 9 (two taps on Pay) and 8 (switches off)."""
import threading
from datetime import timedelta
from decimal import Decimal

from django.core.cache import cache
from django.db import connection
from django.test import TransactionTestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, Customer
from accounts.testing import make_staff
from billing.models import Transaction
from bookings.models import Booking
from disputes.models import Dispute
from events.models import Event, EventTicketType, Ticket
from ledger import posting, sales
from ledger.models import Account, BookingSale
from listings.models import Category, Listing, Zone
from notifications.models import Notification
from payments.models import CheckoutSession
from payments.services import process_payment
from services.models import ServiceRequest

from .booking_helpers import BookingBase, fund


@override_settings(LEDGER_ENABLED=True)
class BookingRefundWiringTests(BookingBase):
    def setUp(self):
        super().setUp()
        self.support = make_staff("support", "esi-w@example.com")
        self.accountant = make_staff("accountant", "kofi-w@example.com")

    def wallet(self):
        return self.balance(Account.CUSTOMER_WALLET, self.customer)

    def support_cancel(self, sale, reason):
        return self.client.post(f"/api/ledger/bookings/{sale.pk}/cancel/", {"reason": reason}, format="json")

    def test_the_customer_cancels_a_paid_stay_and_gets_it_back_in_the_wallet(self):
        sale = self.paid_stay(nights=2)                                                        # GH₵ 300.00
        self.as_customer()
        response = self.client.post(f"/api/bookings/{sale.booking_id}/cancel/")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual((response.json()["status"], response.json()["wallet_refund"]), ("cancelled", "300.00"))
        self.assertEqual(self.wallet(), 30000)
        self.assertEqual(self.balance(Account.VENDOR_PENDING, self.owner), 0)
        sale.refresh_from_db()
        self.assertIsNotNone(sale.reversed_at)
        self.assertTrue(Notification.objects.filter(customer=self.customer, title="Your booking was cancelled").exists())

    def test_review_focus_a_cancelled_stay_cannot_be_checked_in(self):
        sale = self.paid_stay(nights=1)
        self.as_customer()
        self.client.post(f"/api/bookings/{sale.booking_id}/cancel/")
        self.as_owner()
        self.assertEqual(self.client.post(f"/api/bookings/{sale.booking_id}/check-in/").status_code, 400)
        self.assertEqual(Booking.objects.get(pk=sale.booking_id).status, Booking.CANCELLED)

    def test_review_focus_with_the_ledger_off_a_cancelled_stay_moves_no_money(self):
        with override_settings(LEDGER_ENABLED=False):
            booking_id = self.book_stay(nights=1).json()["id"]
            self.as_customer()
            response = self.client.post(f"/api/bookings/{booking_id}/cancel/")
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("wallet_refund", response.json())
        self.assertFalse(Account.objects.exists())

    def test_support_cancels_a_service_not_done_yet(self):
        sale = self.paid_service("200.00")
        self.as_staff(self.support)
        response = self.support_cancel(sale, "Customer moved away")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json(), {"sale": sale.pk, "refunded": "200.00"})
        self.assertEqual(self.wallet(), 20000)
        self.assertEqual(ServiceRequest.objects.get(pk=sale.service_request_id).status, ServiceRequest.CANCELLED)
        self.assertTrue(Notification.objects.filter(business_owner=self.owner, title="Booking cancelled").exists())
        self.assertTrue(Notification.objects.filter(customer=self.customer, title="Your booking was cancelled").exists())

    def test_support_cannot_cancel_what_was_handed_over(self):
        sale = self.paid_service()
        self.as_owner()
        self.assertEqual(self.client.post(f"/api/services/requests/{sale.service_request_id}/complete/").status_code, 200)
        self.as_staff(self.support)
        response = self.support_cancel(sale, "Changed mind")
        self.assertEqual(
            (response.status_code, response.json()["detail"]),
            (409, "The business has already marked this service done. Open a dispute instead."),
        )
        self.assertEqual(self.support_cancel(sale, "x").status_code, 400)
        self.assertEqual(self.wallet(), 0)

    def test_support_cancels_tickets_before_the_event(self):
        sale = self.paid_tickets(quantity=2)
        self.as_staff(self.support)
        self.assertEqual(self.support_cancel(sale, "Customer cannot come").status_code, 200)
        self.assertEqual(self.wallet(), 10000)
        notice = Notification.objects.get(customer=self.customer, title="Your booking was cancelled")
        self.assertIn("2 tickets for Highlife Night", notice.body)       # in words, never an internal id
        self.assertNotIn("#", notice.body)
        self.assertEqual(Ticket.objects.filter(transaction=sale.session.transaction, refunded_at__isnull=False).count(), 2)

    def test_support_cancels_a_stay_not_checked_in(self):
        sale = self.paid_stay(nights=2)
        self.as_staff(self.support)
        response = self.support_cancel(sale, "Lodge closed")
        self.assertEqual((response.status_code, response.json()["refunded"]), (200, "300.00"))
        self.assertEqual(self.wallet(), 30000)
        self.assertEqual(Booking.objects.get(pk=sale.booking_id).status, Booking.CANCELLED)

    def test_the_cancel_answers_409_for_a_released_and_an_already_refunded_sale(self):
        released, refunded = self.paid_service(), self.paid_service("50.00")
        BookingSale.objects.filter(pk=released.pk).update(released_at=timezone.now())
        self.as_staff(self.support)
        response = self.support_cancel(released, "Because")
        self.assertEqual((response.status_code, response.json()["detail"]), (409, "This booking's money was already released to the business. Open a dispute instead."))
        self.assertEqual(self.support_cancel(refunded, "Because").status_code, 200)
        again = self.support_cancel(refunded, "Because")
        self.assertEqual((again.status_code, again.json()["detail"]), (409, "This booking was already refunded in full."))
        self.assertEqual(self.wallet(), 5000)

    @override_settings(LEDGER_ENABLED=False)
    def test_the_cancel_with_the_ledger_off_answers_ledger_off(self):
        self.as_staff(self.support)
        response = self.support_cancel(BookingSale(pk=1), "Because")
        self.assertEqual((response.status_code, response.json()["code"]), (409, "ledger_off"))

    def test_a_stay_paid_before_the_ledger_was_on_cancels_without_touching_the_ledger(self):
        with override_settings(LEDGER_ENABLED=False):
            booking_id = self.book_stay(nights=1).json()["id"]
        self.as_customer()
        response = self.client.post(f"/api/bookings/{booking_id}/cancel/")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["status"], "cancelled")
        self.assertNotIn("wallet_refund", response.json())
        self.assertFalse(Account.objects.exists())

    def test_support_cancelling_tickets_writes_the_same_refunded_rows_and_counts_only_the_tickets_left(self):
        sale = self.paid_tickets(quantity=3)
        first = Ticket.objects.filter(transaction=sale.session.transaction).order_by("pk").first()
        self.as_staff(self.accountant, sudo=True)
        self.assertEqual(self.client.post(
            f"/api/events/tickets/{first.pk}/escrow/refund/", {"reason": "Cannot attend"}, format="json").status_code, 200)
        self.as_staff(self.support)
        self.assertEqual(self.support_cancel(sale, "Event moved").status_code, 200)
        rows = Transaction.objects.filter(status=Transaction.REFUNDED)
        self.assertEqual((rows.count(), set(rows.values_list("amount", flat=True))), (3, {Decimal("-50.00")}))
        self.assertEqual(len({r.purpose for r in rows}), 3)
        notice = Notification.objects.get(customer=self.customer, title="Your booking was cancelled")
        self.assertIn("2 tickets for Highlife Night", notice.body)
        self.assertEqual(self.wallet(), 15000)

    def test_only_support_may_cancel(self):
        sale = self.paid_service()
        self.as_staff(make_staff("pickup_desk", "desk-w@example.com"))
        self.assertEqual(self.support_cancel(sale, "Because").status_code, 403)

    def test_the_accountant_refunds_one_ticket_to_the_wallet(self):
        sale = self.paid_tickets(quantity=2)
        first, second = Ticket.objects.filter(transaction=sale.session.transaction).order_by("pk")
        self.as_staff(self.accountant, sudo=True)
        url = "/api/events/tickets/{}/escrow/refund/"
        response = self.client.post(url.format(first.pk), {"reason": "Cannot attend"}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["wallet_refund"], "50.00")
        self.assertEqual(self.wallet(), 5000)
        first.refresh_from_db()
        self.assertEqual((first.refund_reason, first.refunded_by_staff), ("Cannot attend", self.accountant))
        self.assertTrue(Transaction.objects.filter(status=Transaction.REFUNDED, amount=Decimal("-50.00")).exists())
        again = self.client.post(url.format(first.pk), {"reason": "Cannot attend"}, format="json")
        self.assertEqual((again.status_code, again.json()["detail"]), (400, "This ticket has already been refunded."))
        Ticket.objects.filter(pk=second.pk).update(delivered_at=timezone.now())
        self.assertEqual(self.client.post(url.format(second.pk), {"reason": "Cannot attend"}, format="json").status_code, 400)
        self.assertEqual(self.wallet(), 5000)

    def test_a_booking_dispute_resolved_with_a_refund_pays_the_wallet_once_and_the_rest_is_released(self):
        sale = self.paid_service("200.00")
        ServiceRequest.objects.filter(pk=sale.service_request_id).update(status=ServiceRequest.COMPLETED, completed_at=timezone.now())
        sale = sales.record_verification(sale, self.support, "does_not_match", note="Half done")
        self.as_staff(self.accountant, sudo=True)
        url = f"/api/disputes/{sale.dispute_id}/resolve/"
        self.assertEqual(self.client.post(url, {"refund_amount": "250.00"}, format="json").status_code, 400)
        self.assertEqual(Dispute.objects.get(pk=sale.dispute_id).status, Dispute.OPEN)            # the decision rolled back
        response = self.client.post(url, {"refund_amount": "80.00", "resolution_notes": "Half the job"}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["wallet_refund"], "80.00")
        self.assertEqual(self.wallet(), 8000)
        sales.record_verification(sale, self.support, "matches", customer_confirmed_by_phone=True)
        self.assertEqual(self.balance(Account.VENDOR_AVAILABLE, self.owner), 12000 - 300)        # fee left 5.00 − 2.00


@override_settings(LEDGER_ENABLED=True)
class TicketRefundRaceTests(TransactionTestCase):
    serialized_rollback = True

    def test_review_focus_two_ticket_refunds_from_one_purchase_at_once_both_land(self):
        customer = Customer.objects.create(full_name="Ama", phone="+233200770301", password_hash="x")
        owner = BusinessOwner.objects.create(full_name="Kwame", login_phone="+233207770301", password_hash="x")
        accountant = make_staff("accountant", "kofi-race@example.com")
        now = timezone.now()
        event = Event.objects.create(
            category=Category.objects.get(slug="festivals"), zone=Zone.objects.get(name="Manhyia"), submitted_by_business=owner,
            name="Highlife Night", description="D.", address="Kumasi", event_date=now + timedelta(days=10),
            visibility_days=14, status=Event.APPROVED, paid_at=now, expires_at=now + timedelta(days=14),
        )
        ticket_type = EventTicketType.objects.create(event=event, name="Regular", price=Decimal("50.00"))
        result = process_payment(
            kind=CheckoutSession.TICKET_PURCHASE, amount=Decimal("100.00"), purpose="Tickets", customer=customer,
            metadata={
                "event_id": event.pk, "ticket_type_id": ticket_type.pk, "quantity": 2, "customer_id": customer.pk,
                "delivery_method": ticket_type.delivery_method, "unit_price": "50.00", "ledger": True,
            },
        )
        sale = BookingSale.objects.get(session=result["session"])
        outcomes, barrier = [], threading.Barrier(2)

        def refund(ticket_id):
            try:
                barrier.wait()
                sales.refund_ticket(sale, ticket_id, by=accountant, reason="Cannot attend")
                outcomes.append("refunded")
            except Exception as exc:  # noqa: BLE001 - a failure must show in the assertion, not hang the test
                outcomes.append(repr(exc))
            finally:
                connection.close()

        threads = [threading.Thread(target=refund, args=(pk,)) for pk in result["session"].metadata["ticket_ids"]]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=10)
            self.assertFalse(thread.is_alive(), "a racing refund hung")
        self.assertEqual(outcomes, ["refunded", "refunded"])
        self.assertEqual(posting.balance_of(Account.CUSTOMER_WALLET, customer), 10000)
        sale.refresh_from_db()
        self.assertIsNotNone(sale.reversed_at)
        self.assertEqual(Ticket.objects.filter(refunded_at__isnull=False).count(), 2)


@override_settings(LEDGER_ENABLED=True)
class SameMomentRaceTests(TransactionTestCase):
    """Two requests at the same moment on one booking: the row lock decides who goes first (Plan 1b S15)."""

    serialized_rollback = True

    def setUp(self):
        cache.clear()
        self.customer = Customer.objects.create(full_name="Ama", phone="+233200770401", password_hash="x")
        self.owner = BusinessOwner.objects.create(full_name="Kwame", login_phone="+233207770401", password_hash="x")
        self.zone = Zone.objects.get(name="Manhyia")

    def listing(self, name, price, category, **extra):
        return Listing.objects.create(
            business_owner=self.owner, category=category, zone=self.zone, name=name, description="D.",
            contact_phone=self.owner.login_phone, price_amount=Decimal(price), status=Listing.PUBLISHED, **extra,
        )

    def client_for(self, account, kind):
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(account, kind)}")
        return client

    def run_together(self, *calls):
        """Each call in its own thread, released at once; returns what each returned (the exception's repr if it raised)."""
        results, barrier = [None] * len(calls), threading.Barrier(len(calls))

        def run(index, call):
            try:
                barrier.wait()
                results[index] = call()
            except Exception as exc:  # noqa: BLE001 - a failure must show in the assertion, not hang the test
                results[index] = repr(exc)
            finally:
                connection.close()

        threads = [threading.Thread(target=run, args=(index, call)) for index, call in enumerate(calls)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=15)
            self.assertFalse(thread.is_alive(), "a racing request hung")
        return results

    def test_review_focus_two_taps_on_pay_charge_a_service_request_once(self):
        service = self.listing("Home Cleaning", "200.00", Category.objects.create(slug="cleaning-1b-race", label="Cleaning", kind="service"))
        request = ServiceRequest.objects.create(
            customer=self.customer, listing=service, business_owner=self.owner, message="Clean my house.",
            agreed_price=Decimal("200.00"), status=ServiceRequest.ACCEPTED,
        )
        fund(self.customer, 50000, "fund-1b-race-pay")

        def tap():
            client = self.client_for(self.customer, "customer")
            return client.post(f"/api/services/requests/{request.pk}/pay/", {"payment_method": "wallet"}, format="json").status_code

        self.assertCountEqual(self.run_together(tap, tap), [200, 400])
        self.assertEqual(CheckoutSession.objects.filter(status=CheckoutSession.SUCCESS).count(), 1)
        self.assertEqual(Transaction.objects.count(), 1)
        self.assertEqual(BookingSale.objects.filter(service_request=request).count(), 1)
        self.assertEqual(posting.balance_of(Account.CUSTOMER_WALLET, self.customer), 30000)         # debited once

    def test_review_focus_a_check_in_and_a_cancel_at_once_never_both_land(self):
        lodge = self.listing(
            "Ashanti Lodge", "150.00",
            Category.objects.create(slug="lodge-1b-race", label="Lodge", kind="service", is_accommodation=True), units_total=2,
        )
        check_in = timezone.localdate() + timedelta(days=1)
        paid = self.client_for(self.customer, "customer").post("/api/bookings/", {
            "listing": lodge.pk, "check_in": check_in.isoformat(), "check_out": (check_in + timedelta(days=2)).isoformat(), "units": 1,
        }, format="json")
        self.assertEqual(paid.status_code, 201, paid.content)
        booking_id = paid.json()["id"]

        def check_in_call():
            return self.client_for(self.owner, "business_owner").post(f"/api/bookings/{booking_id}/check-in/").status_code

        def cancel_call():
            return self.client_for(self.customer, "customer").post(f"/api/bookings/{booking_id}/cancel/").status_code

        self.assertCountEqual(self.run_together(check_in_call, cancel_call), [200, 400])
        booking = Booking.objects.get(pk=booking_id)
        sale = BookingSale.objects.get(booking=booking)
        wallet = posting.balance_of(Account.CUSTOMER_WALLET, self.customer)
        if booking.status == Booking.CANCELLED:                      # the cancel went first: refunded, never checked in
            self.assertEqual((wallet, booking.checked_in_at), (30000, None))
            self.assertIsNotNone(sale.reversed_at)
        else:                                                         # the check-in went first: the cancel was refused
            self.assertEqual(booking.status, Booking.CHECKED_IN)
            self.assertEqual(wallet, 0)
            self.assertIsNone(sale.reversed_at)
