"""Business texts for service, stay and ticket sales (plan 4F, Task 4; Director rulings G3 and G4): one text and its in-app
copy when a booking sale is paid, released or put on hold by a reported problem. Privacy (V5): the booking reference and
amounts only, never the customer's name, phone or what they wrote. A text never stops the payment, release or report."""
from datetime import timedelta
from unittest import mock

from django.test import override_settings
from django.utils import timezone

from accounts.models import BusinessOwner
from ledger import sales
from ledger.models import BookingSale
from ledger.tests.booking_helpers import BookingBase
from notifications.models import Notification
from otp import senders
from otp.identity import contacts
from otp.models import SMS, VerifiedContact
from services.models import ServiceRequest
from wallets import vendor, vendor_texts
from wallets.models import VendorText

PAID, RELEASED, HOLD = VendorText.BOOKING_PAID, VendorText.BOOKING_RELEASED, VendorText.BOOKING_ON_HOLD
REASON = "The cleaner never turned up at all"


def ghs(pesewas):
    return f"{pesewas // 100}.{pesewas % 100:02d}"


@override_settings(LEDGER_ENABLED=True)
class BookingTextBase(BookingBase):
    def setUp(self):
        super().setUp()
        senders.sms_outbox.clear()
        VerifiedContact.objects.create(
            account_type="business_owner", account_id=self.owner.pk, channel=SMS, destination=contacts(self.owner)[SMS],
        )

    def texts(self, kind=None):
        rows = VendorText.objects.filter(business_owner=self.owner)
        return list(rows.filter(kind=kind) if kind else rows)

    def done(self, sale):
        ServiceRequest.objects.filter(pk=sale.service_request_id).update(
            status=ServiceRequest.COMPLETED, completed_at=timezone.now(),
        )

    def accept(self, sale):
        self.done(sale)
        return sales.accept(sale, self.customer)


class PaidTests(BookingTextBase):
    def paid_body(self, sale, word):
        gross, fee, _refunded, net = vendor.booking_figures(sale)
        return (
            f"AshantiHub: booking #{sale.pk} paid ({word}). Price GHS {ghs(gross)}, platform fee GHS {ghs(fee)} at release, "
            f"due to you GHS {ghs(net)} once it is released."
        )

    def test_a_paid_service_stay_and_ticket_sale_each_text_the_business_once(self):
        service, stay, tickets = self.paid_service(), self.paid_stay(), self.paid_tickets()
        for sale, word in ((service, "Service"), (stay, "Stay"), (tickets, "Tickets")):
            found = VendorText.objects.filter(key=f"booking-paid-{sale.pk}")
            self.assertEqual(found.count(), 1, word)
            self.assertEqual(found.get().body, self.paid_body(sale, word))
            self.assertEqual(found.get().kind, PAID)
            self.assertEqual(found.get().business_owner, self.owner)
            self.assertIsNotNone(found.get().notification)                         # the in-app copy
        self.assertIn("Price GHS 200.00, platform fee GHS 5.00 at release, due to you GHS 195.00", VendorText.objects.get(key=f"booking-paid-{service.pk}").body)
        vendor_texts.booking_paid(service)                                          # a retry never texts twice
        self.assertEqual(len(self.texts(PAID)), 3)

    def test_a_retried_payment_does_not_text_again(self):
        sale = self.paid_service()
        self.assertEqual(sales.record_payment(sale.session, "service", sale.service_request, self.owner), sale)
        self.assertEqual(len(self.texts(PAID)), 1)


class ReleaseAndHoldTests(BookingTextBase):
    def test_release_texts_what_reached_available_after_the_fee(self):
        sale = self.paid_service()
        self.accept(sale)
        _gross, fee, _refunded, net = vendor.booking_figures(sale)
        text = VendorText.objects.get(key=f"booking-released-{sale.pk}")
        self.assertEqual(text.kind, RELEASED)
        self.assertEqual(
            text.body,
            f"AshantiHub: booking #{sale.pk} released. GHS {ghs(net)} added to your Available balance after the GHS {ghs(fee)} platform fee.",
        )
        self.assertEqual((net, fee), (19500, 500))
        self.assertIsNotNone(text.notification)

    def test_a_partly_refunded_sale_releases_what_is_left(self):
        sale = self.paid_service()
        sales.refund(sale, 5000, source="support-test")
        self.accept(BookingSale.objects.get(pk=sale.pk))
        sale.refresh_from_db()
        _gross, fee, _refunded, net = vendor.booking_figures(sale)
        body = VendorText.objects.get(key=f"booking-released-{sale.pk}").body
        self.assertIn(f"GHS {ghs(net)} added", body)
        self.assertIn(f"after the GHS {ghs(fee)} platform fee", body)

    def test_a_reported_problem_texts_on_hold(self):
        sale = self.paid_service()
        self.as_customer()
        sales.report_problem(sale, self.customer, REASON)
        text = VendorText.objects.get(key=f"booking-hold-{sale.pk}")
        self.assertEqual(text.kind, HOLD)
        self.assertEqual(
            text.body,
            f"AshantiHub: booking #{sale.pk} payment on hold: a problem was reported. AshantiHub Support is checking it.",
        )
        self.assertIsNotNone(text.notification)
        sales.report_problem(sale, self.customer, "And another thing that went wrong")   # a second report: no second text
        self.assertEqual(len(self.texts(HOLD)), 1)

    def test_review_focus_no_customer_detail_in_any_booking_text(self):
        service = self.paid_service()
        self.paid_stay()
        self.paid_tickets()
        sales.report_problem(service, self.customer, REASON)
        self.accept(self.paid_service("120.00"))
        rows = self.texts()
        self.assertEqual({row.kind for row in rows}, {PAID, RELEASED, HOLD})
        for row in rows:
            copy = row.notification
            for words in (row.body, copy.title, copy.body):
                for secret in (self.customer.full_name, "Ama", "Owusu", self.customer.phone, "200770001", REASON, "cleaner"):
                    self.assertNotIn(secret, words)
            self.assertTrue(vendor_texts.fits(row.body))


class GuardTests(BookingTextBase):
    def test_no_booking_text_while_the_ledger_is_off(self):
        sale = self.paid_service()
        VendorText.objects.all().delete()
        Notification.objects.filter(kind=vendor_texts.VENDOR_MONEY).delete()
        with override_settings(LEDGER_ENABLED=False):
            for call in (lambda: vendor_texts.booking_paid(sale), lambda: vendor_texts.booking_on_hold(sale),
                         lambda: vendor_texts.booking_released(sale, None)):
                call()
        self.assertEqual(VendorText.objects.count(), 0)
        self.assertFalse(Notification.objects.filter(kind=vendor_texts.VENDOR_MONEY).exists())

    def test_a_suspended_business_gets_no_booking_text(self):
        BusinessOwner.objects.filter(pk=self.owner.pk).update(is_suspended=True)
        sale = self.paid_service()
        self.accept(sale)
        self.as_customer()
        other = self.paid_service("90.00")
        sales.report_problem(other, self.customer, REASON)
        self.assertEqual(VendorText.objects.count(), 0)

    def test_a_text_failure_never_stops_the_payment_release_or_report(self):
        with mock.patch.object(vendor_texts, "queue", side_effect=RuntimeError("outbox down")):
            sale = self.paid_service()
            reported = self.paid_service("90.00")
            sales.report_problem(reported, self.customer, REASON)
            self.accept(sale)
        sale.refresh_from_db()
        reported.refresh_from_db()
        self.assertIsNotNone(sale.released_at)
        self.assertIsNotNone(reported.dispute_id)
        self.assertEqual(VendorText.objects.count(), 0)

    def test_a_failure_in_the_figures_never_stops_the_payment(self):
        with mock.patch.object(vendor, "booking_figures", side_effect=RuntimeError("boom")):
            sale = self.paid_service()
        self.assertTrue(BookingSale.objects.filter(pk=sale.pk).exists())


class WordsTests(BookingTextBase):
    def test_each_booking_body_fits_one_text(self):
        sale = self.paid_tickets(quantity=3)
        sales.report_problem(sale, self.customer, REASON)
        sale.refresh_from_db()
        self.accept(self.paid_service())
        for text in self.texts():
            self.assertTrue(vendor_texts.fits(text.body), text.body)
            self.assertLessEqual(len(text.body), 160, text.body)                    # one text part

    def test_the_three_kinds_read_in_words(self):
        self.assertEqual(
            [VendorText(kind=kind).get_kind_display() for kind in (PAID, RELEASED, HOLD)],
            ["Booking paid", "Booking released", "Booking on hold"],
        )
        self.assertTrue(all(len(kind) <= 16 for kind in (PAID, RELEASED, HOLD)))
