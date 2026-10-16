"""Refunds of booking sales into the customer's wallet (Plan 1b, Task 7; spec §2.2 steps 3-4, §5): before and after
release, in parts, with the processing charge only on fault, and the whole refund cancelling a booking not yet handed
over. Review Focus 3 (release after a refund) and 4 (refund arithmetic, and nothing left to refund)."""
from django.test import override_settings
from django.utils import timezone

from accounts.testing import make_staff
from bookings.availability import min_units_free
from bookings.models import Booking
from events.models import Ticket
from ledger import fees, posting, refunds, sales
from ledger.models import Account, BookingRefund, Journal
from ledger.verification import VerificationError
from services.models import ServiceRequest

from .booking_helpers import BookingBase


@override_settings(LEDGER_ENABLED=True)
class BookingRefundTests(BookingBase):
    def setUp(self):
        super().setUp()
        self.support = make_staff("support", "esi-r@example.com")

    def wallet(self):
        return self.balance(Account.CUSTOMER_WALLET, self.customer)

    def complete(self, sale):
        ServiceRequest.objects.filter(pk=sale.service_request_id).update(status=ServiceRequest.COMPLETED, completed_at=timezone.now())

    def released(self, sale):
        self.complete(sale)
        return sales.record_verification(sale, self.support, "matches", customer_confirmed_by_phone=True)

    def test_a_whole_refund_before_release_returns_everything_frees_the_cap_and_cancels_the_service(self):
        sale = self.paid_service("200.00")
        refund = sales.refund(sale, source="cancel", by=self.support)
        self.assertEqual((refund.whole, refund.released, refund.amount_pesewas, refund.fee_pesewas), (True, False, 20000, 500))
        self.assertEqual(refund.journal.key, f"booking-refund-{sale.pk}-cancel")
        self.assertEqual(self.wallet(), 20000)
        self.assertEqual(self.balance(Account.VENDOR_PENDING, self.owner), 0)
        sale.refresh_from_db()
        self.assertIsNotNone(sale.reversed_at)
        self.assertEqual(fees.charged_to_date(self.owner), 0)
        self.assertEqual(ServiceRequest.objects.get(pk=sale.service_request_id).status, ServiceRequest.CANCELLED)

    def test_review_focus_the_same_source_refunds_once_and_more_than_is_left_writes_nothing(self):
        sale = self.paid_service("200.00")
        first = sales.refund(sale, 5000, source="dispute-1")
        self.assertEqual(sales.refund(sale, 5000, source="dispute-1"), first)
        with self.assertRaisesMessage(refunds.RefundError, "Only GH₵ 150.00 of this booking can still be refunded."):
            sales.refund(sale, 15001, source="dispute-2")
        with self.assertRaises(refunds.RefundError):
            sales.refund(sale, 0, source="dispute-3")
        self.assertEqual(self.wallet(), 5000)
        self.assertEqual(BookingRefund.objects.count(), 1)
        self.assertEqual(Journal.objects.filter(kind="booking_refund").count(), 1)

    def test_review_focus_fee_given_back_in_parts_adds_up_to_the_fee_taken(self):
        sale = self.paid_service("100.00")                                                     # GH₵ 5.00 flat fee
        self.released(sale)
        self.assertEqual(self.balance(Account.VENDOR_AVAILABLE, self.owner), 9500)
        returned = []
        for source, amount in (("dispute-1", 3333), ("dispute-2", 3333), ("dispute-3", 3334)):
            sales.refund(sale, amount, source=source)
            sale.refresh_from_db()
            returned.append(sale.refunded_fee_pesewas)
        self.assertEqual(returned, [167, 333, 500])                                            # 1.67 + 1.66 + 1.67
        self.assertEqual(self.balance(Account.PLATFORM_FEE_INCOME), 0)
        self.assertEqual(self.balance(Account.VENDOR_AVAILABLE, self.owner), 0)
        self.assertEqual(self.wallet(), 10000)
        self.assertIsNotNone(sale.reversed_at)
        self.assertEqual(ServiceRequest.objects.get(pk=sale.service_request_id).status, ServiceRequest.COMPLETED)

    def test_a_refund_after_release_may_drive_available_below_zero(self):
        sale = self.paid_service("200.00")
        self.released(sale)                                                                    # Available GH₵ 195.00
        posting.post(key="test-1b-spent", kind="test_spend", lines=[
            posting.debit(posting.account_for(Account.VENDOR_AVAILABLE, self.owner), 19500),
            posting.credit(posting.account_for(Account.PROVIDER_CLEARING), 19500),
        ])
        refund = sales.refund(sale, source="dispute-9")
        self.assertTrue(refund.released)
        self.assertEqual(self.balance(Account.VENDOR_AVAILABLE, self.owner), -19500)
        self.assertEqual(self.balance(Account.PLATFORM_FEE_INCOME), 0)
        self.assertEqual(self.wallet(), 20000)

    def test_review_focus_a_refund_then_matches_pays_only_the_rest(self):
        sale = self.paid_service("200.00")                                                     # fee GH₵ 5.00
        sales.refund(sale, 5000, source="dispute-1")                                           # GH₵ 50.00 back first
        self.released(sale)
        self.assertEqual(self.balance(Account.VENDOR_PENDING, self.owner), 0)
        self.assertEqual(self.balance(Account.VENDOR_AVAILABLE, self.owner), 14625)            # 150.00 − (5.00 − 1.25)
        self.assertEqual(self.balance(Account.PLATFORM_FEE_INCOME), 375)

    def test_review_focus_a_wholly_refunded_booking_is_never_released_and_leaves_supports_list(self):
        sale = self.paid_service()
        self.complete(sale)
        sales.refund(sale, source="dispute-1")
        with self.assertRaisesMessage(VerificationError, "This booking was refunded in full."):
            sales.record_verification(sale, self.support, "matches", customer_confirmed_by_phone=True)
        self.assertFalse(sales.awaiting().filter(pk=sale.pk).exists())
        self.assertEqual(self.balance(Account.VENDOR_AVAILABLE, self.owner), 0)

    def test_a_whole_refund_of_a_stay_not_checked_in_cancels_it_and_frees_its_nights(self):
        sale = self.paid_stay(nights=2)
        booking = sale.booking
        self.assertEqual(min_units_free(self.lodge, booking.check_in, booking.check_out), 1)
        sales.refund(sale, source="cancel")
        booking.refresh_from_db()
        self.assertEqual(booking.status, Booking.CANCELLED)
        self.assertIsNotNone(booking.cancelled_at)
        self.assertEqual(min_units_free(self.lodge, booking.check_in, booking.check_out), 2)

    def test_a_whole_refund_of_tickets_marks_the_ones_not_scanned_refunded(self):
        sale = self.paid_tickets(quantity=2)
        scanned, other = Ticket.objects.filter(transaction=sale.session.transaction).order_by("pk")
        Ticket.objects.filter(pk=scanned.pk).update(delivered_at=timezone.now())
        sales.refund(sale, source="dispute-4", by=self.support, note="Event cancelled")
        scanned.refresh_from_db()
        other.refresh_from_db()
        self.assertIsNone(scanned.refunded_at)
        self.assertIsNotNone(other.refunded_at)
        self.assertEqual((other.refund_reason, other.refunded_by_staff), ("Event cancelled", self.support))

    @override_settings(SIMULATED_COLLECTION_CHARGE_BP=200)
    def test_the_processing_charge_comes_back_only_on_fault_and_in_proportion(self):
        sale = self.paid_service("200.00")                                                     # paid 204.00
        sales.refund(sale, 10000, source="dispute-1", refund_processing=True)                  # half: GH₵ 2.00 of 4.00
        self.assertEqual(self.wallet(), 10200)
        sales.refund(sale, source="dispute-2")                                                 # the rest, nobody's fault
        self.assertEqual(self.wallet(), 20200)
        self.assertEqual(self.balance(Account.PROVIDER_FEES), 200)

    def test_with_the_ledger_off_nothing_is_refunded(self):
        sale = self.paid_service()
        with override_settings(LEDGER_ENABLED=False):
            self.assertIsNone(sales.refund(sale, source="cancel"))
        self.assertEqual(self.wallet(), 0)

    def test_an_amount_asked_of_a_booking_refunded_in_full_is_refused(self):
        sale = self.paid_service()
        sales.refund(sale, source="cancel")
        with self.assertRaisesMessage(refunds.RefundError, "Nothing is left to refund on this booking."):
            sales.refund(sale, 100, source="dispute-9")
        self.assertEqual(self.wallet(), 20000)
