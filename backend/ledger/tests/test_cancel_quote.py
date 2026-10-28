"""Plan 7G, Task 1: `sales.cancel_quote` (what a customer's cancel would refund, written by nothing) and the endpoint
that serves it. The cancel itself calls the quote, so the two can never disagree."""
from datetime import datetime, timedelta, timezone as dt_timezone

from django.test import override_settings
from django.urls import reverse
from django.utils import timezone

from accounts.models import Customer
from ledger import sales
from ledger.models import BookingRefund, BookingSale, Journal
from bookings.models import Booking
from services.models import ServiceRequest

from .booking_helpers import BookingBase


@override_settings(LEDGER_ENABLED=True)
class CancelQuoteTests(BookingBase):
    def stay(self, policy="flexible", starts_in=10):
        self.lodge.__class__.objects.filter(pk=self.lodge.pk).update(cancellation_policy=policy)
        return self.paid_stay(nights=2, starts_in=starts_in)       # GH₵ 300.00

    def start_of(self, sale):
        return datetime.combine(sale.booking.check_in, sales.STAY_CHECK_IN_TIME, tzinfo=dt_timezone.utc)

    def url(self, sale):
        return reverse("ledger-booking-cancel-quote", args=[sale.pk])

    def test_quote_equals_what_the_cancel_then_gives(self):
        sale = self.stay("moderate")
        now = self.start_of(sale) - timedelta(days=3)
        quote = sales.cancel_quote(sale, now)
        self.assertEqual(tuple(quote), (15000, False))
        given = sales.cancel_by_customer(sale, now)
        self.assertEqual(given.amount_pesewas, 15000)
        self.assertEqual(given.whole, quote.whole)

    def test_a_whole_quote_is_whole(self):
        sale = self.stay("flexible")
        quote = sales.cancel_quote(sale, self.start_of(sale) - timedelta(days=5))
        self.assertEqual(tuple(quote), (30000, True))

    def test_quote_writes_nothing(self):
        sale = self.stay("moderate")
        before = (Journal.objects.count(), BookingRefund.objects.count())
        sales.cancel_quote(sale, self.start_of(sale) - timedelta(days=3))
        self.assertEqual((Journal.objects.count(), BookingRefund.objects.count()), before)
        self.assertEqual(Booking.objects.get(pk=sale.booking_id).status, Booking.CONFIRMED)

    def test_quote_refuses_exactly_as_cancel_does(self):
        def legacy():
            sale = self.stay("flexible", starts_in=10)
            BookingSale.objects.filter(pk=sale.pk).update(policy_snapshot=None)
            sale.refresh_from_db()
            return sale, self.start_of(sale) - timedelta(days=20)

        def after_cutoff():
            sale = self.stay("flexible", starts_in=14)
            return sale, self.start_of(sale) - timedelta(hours=24) + timedelta(seconds=1)

        def past_release():
            sale = self.stay("flexible", starts_in=18)
            return sale, sales.release_at(sale) + timedelta(minutes=1)

        def open_dispute():
            sale = self.stay("flexible", starts_in=22)
            sale = sales.report_problem(sale, self.customer, "The room is not as described")
            return sale, self.start_of(sale) - timedelta(days=20)

        def released():
            sale = self.stay("flexible", starts_in=26)
            BookingSale.objects.filter(pk=sale.pk).update(released_at=timezone.now())
            sale.refresh_from_db()
            return sale, self.start_of(sale) - timedelta(days=20)

        def cancelled():
            sale = self.stay("flexible", starts_in=30)
            now = self.start_of(sale) - timedelta(days=20)
            sales.cancel_by_customer(sale, now)
            sale.refresh_from_db()
            return sale, now

        for name, make in [("legacy", legacy), ("after cut-off", after_cutoff), ("past release", past_release),
                           ("open dispute", open_dispute), ("released", released), ("cancelled", cancelled)]:
            with self.subTest(name):
                sale, now = make()
                with self.assertRaises(sales.CancelError) as quote_err:
                    sales.cancel_quote(sale, now)
                with self.assertRaises(sales.CancelError) as cancel_err:
                    sales.cancel_by_customer(sale, now)
                self.assertEqual(quote_err.exception.status_code, cancel_err.exception.status_code)
                self.assertEqual(quote_err.exception.message, cancel_err.exception.message)

    @override_settings(LEDGER_ENABLED=False)
    def test_quote_refuses_with_the_ledger_off(self):
        sale = BookingSale.objects.none()
        with self.assertRaises(sales.CancelError) as ctx:
            sales.cancel_quote(sale)
        self.assertEqual(ctx.exception.message, "The ledger is off.")

    def test_view_answers_refund_as_a_ghs_string(self):
        sale = self.stay("moderate", starts_in=3)
        self.as_customer()
        response = self.client.get(self.url(sale))
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json(), {"refund": "150.00", "whole": False})

    def test_view_404_for_another_customers_sale(self):
        sale = self.stay("moderate", starts_in=3)
        other = Customer.objects.create(full_name="Esi Boateng", phone="+233200770002", password_hash="x")
        self.as_customer(other)
        self.assertEqual(self.client.get(self.url(sale)).status_code, 404)

    def test_view_refuses_an_anonymous_caller(self):
        sale = self.stay("moderate", starts_in=3)
        self.client.credentials()
        self.assertIn(self.client.get(self.url(sale)).status_code, (401, 403))

    def test_view_409_ledger_off(self):
        sale = self.stay("moderate", starts_in=3)
        self.as_customer()
        with override_settings(LEDGER_ENABLED=False):
            response = self.client.get(self.url(sale))
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["code"], "ledger_off")

    def test_view_409_carries_the_refusal_detail(self):
        sale = self.stay("strict", starts_in=2)
        self.as_customer()
        response = self.client.get(self.url(sale))
        self.assertEqual(response.status_code, 409)
        self.assertIn("nothing can be refunded now", response.json()["detail"])

    def test_refusals_say_report_a_problem_and_never_open_a_dispute(self):
        def stay_handed_over():
            sale = self.stay("flexible", starts_in=5)
            Booking.objects.filter(pk=sale.booking_id).update(checked_in_at=timezone.now())
            sale.refresh_from_db()
            return sale, timezone.now()

        def service_handed_over():
            sale = self.paid_service()
            ServiceRequest.objects.filter(pk=sale.service_request_id).update(status=ServiceRequest.COMPLETED, completed_at=timezone.now())
            sale.refresh_from_db()
            return sale, timezone.now()

        def tickets_handed_over():
            sale = self.paid_tickets(2)
            return sale, self.event.event_date + timedelta(hours=1)

        def past_window():
            sale = self.stay("flexible", starts_in=40)
            return sale, sales.release_at(sale) + timedelta(minutes=1)

        def released():
            sale = self.stay("flexible", starts_in=44)
            BookingSale.objects.filter(pk=sale.pk).update(released_at=timezone.now())
            sale.refresh_from_db()
            return sale, self.start_of(sale) - timedelta(days=20)

        expected = {
            "stay": "Report a problem instead.", "service": "Report a problem instead.", "tickets": "Report a problem instead.",
            "past window": "past its cancellation window. Report a problem instead.",
            "released": "If something is wrong, contact AshantiHub Support.",
        }
        for name, make in [("stay", stay_handed_over), ("service", service_handed_over), ("tickets", tickets_handed_over),
                           ("past window", past_window), ("released", released)]:
            with self.subTest(name):
                sale, now = make()
                with self.assertRaises(sales.CancelError) as ctx:
                    sales.cancel_quote(sale, now)
                message = ctx.exception.message
                self.assertNotIn("dispute", message.lower())
                self.assertIn(expected[name].lower(), message.lower())
                if name == "released":
                    self.assertIn("contact ashantihub support", message.lower())
