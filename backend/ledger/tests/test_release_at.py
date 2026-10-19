"""Plan 7E, Task 1: services, stays and tickets release on their own milestone (a service on the customer's accept or
48 h after the business marks it done; a stay 24 h after the check-in time; tickets 48 h after the event day), not on
Support's call. Times are Accra time, which is UTC all year."""
from datetime import datetime, time, timedelta, timezone as dt_timezone

from django.test import override_settings
from django.utils import timezone

from accounts.testing import make_staff
from bookings.models import Booking
from disputes.models import Dispute
from events.models import Event
from ledger import sales
from ledger.models import Account, BookingSale, Journal, MoneySetting
from services.models import ServiceRequest

from .booking_helpers import BookingBase

UTC = dt_timezone.utc


@override_settings(LEDGER_ENABLED=True)
class ReleaseAtTests(BookingBase):
    def done(self, sale, at):
        ServiceRequest.objects.filter(pk=sale.service_request_id).update(status=ServiceRequest.COMPLETED, completed_at=at)
        return BookingSale.objects.get(pk=sale.pk)

    def test_service_releases_48h_after_done(self):
        sale = self.paid_service("200.00")
        t0 = timezone.now()
        sale = self.done(sale, t0)
        self.assertEqual(sales.release_at(sale), t0 + timedelta(hours=48))
        self.assertEqual(sales.release_due(t0 + timedelta(hours=47, minutes=59)), 0)
        self.assertEqual(sales.release_due(t0 + timedelta(hours=48)), 1)
        sale.refresh_from_db()
        self.assertIsNotNone(sale.released_at)
        self.assertEqual(sale.outcome, "matches")
        self.assertEqual(self.balance(Account.VENDOR_AVAILABLE, self.owner), 19500)
        self.assertEqual(self.balance(Account.VENDOR_PENDING, self.owner), 0)

    def test_service_not_released_before_done(self):
        sale = self.paid_service()
        self.assertIsNone(sales.release_at(sale))
        self.assertEqual(sales.release_due(timezone.now() + timedelta(days=365)), 0)

    def test_undone_service_clears_clock(self):
        sale = self.paid_service()
        sale = self.done(sale, timezone.now())
        self.assertIsNotNone(sales.release_at(sale))
        sale = self.done(sale, None)
        self.assertIsNone(sales.release_at(sale))
        self.assertEqual(sales.release_due(timezone.now() + timedelta(days=30)), 0)

    def test_accept_then_timer_releases_once(self):
        sale = self.paid_service()
        t0 = timezone.now()
        sale = self.done(sale, t0)
        BookingSale.objects.filter(pk=sale.pk).update(customer_accepted_at=t0 + timedelta(hours=47))
        sale.refresh_from_db()
        self.assertEqual(sales.release_at(sale), t0 + timedelta(hours=47))
        self.assertEqual(sales.release_due(t0 + timedelta(hours=47)), 1)
        self.assertEqual(sales.release_due(t0 + timedelta(hours=49)), 0)
        self.assertEqual(Journal.objects.filter(key=sales.release_key(sale)).count(), 1)

    def test_stay_releases_24h_after_check_in_time(self):
        sale = self.paid_stay()
        check_in = sale.booking.check_in
        due = datetime.combine(check_in, time(14, 0), tzinfo=UTC) + timedelta(hours=24)
        self.assertEqual(sales.release_at(sale), due)
        self.assertEqual(sales.release_due(due - timedelta(minutes=1)), 0)
        self.assertEqual(sales.release_due(due), 1)

    def test_no_show_stay_releases_after_window(self):
        sale = self.paid_stay()
        self.assertIsNone(sale.booking.checked_in_at)
        due = sales.release_at(sale)
        self.assertEqual(sales.release_due(due + timedelta(minutes=1)), 1)
        sale.refresh_from_db()
        self.assertIsNotNone(sale.released_at)

    def test_ticket_release_is_48h_after_the_event_day(self):
        sale = self.paid_tickets()
        day_end = datetime.combine(sale.event.event_date.astimezone(UTC).date() + timedelta(days=1), time(0, 0), tzinfo=UTC)
        self.assertEqual(sales.release_at(sale), day_end + timedelta(hours=48))
        self.assertEqual(sales.release_due(day_end + timedelta(hours=47)), 0)
        self.assertEqual(sales.release_due(day_end + timedelta(hours=48)), 1)

    def test_open_dispute_blocks_timer_until_it_closes(self):
        sale = self.paid_service()
        t0 = timezone.now()
        sale = self.done(sale, t0)
        dispute = Dispute.objects.create(
            order=None, raised_by=None, logged_by=make_staff("support", "s7e@example.com"), reason=Dispute.QUALITY_ISSUE,
            status=Dispute.OPEN, description="Not as described.",
        )
        BookingSale.objects.filter(pk=sale.pk).update(dispute=dispute)
        later = t0 + timedelta(hours=49)
        self.assertEqual(sales.release_due(later), 0)
        Dispute.objects.filter(pk=dispute.pk).update(status=Dispute.REJECTED)
        self.assertEqual(sales.release_due(later), 1)

    def test_settings_change_applies_to_unreleased_sales(self):
        sale = self.paid_service()
        t0 = timezone.now()
        sale = self.done(sale, t0)
        MoneySetting.objects.create(key="service_auto_accept_hours", value=24, effective_from=t0 - timedelta(minutes=1))
        self.assertEqual(sales.release_at(sale), t0 + timedelta(hours=24))

    def test_nothing_happens_while_the_ledger_is_off(self):
        sale = self.paid_service()
        sale = self.done(sale, timezone.now() - timedelta(days=9))
        with override_settings(LEDGER_ENABLED=False):
            self.assertEqual(sales.release_due(), 0)


@override_settings(LEDGER_ENABLED=True)
class FinalReviewTests(BookingBase):
    def mismatch(self, sale, dispute_status):
        dispute = Dispute.objects.create(
            order=None, raised_by=None, logged_by=make_staff("support", "fr7e@example.com"), reason=Dispute.QUALITY_ISSUE,
            status=dispute_status, description="Does not match.",
        )
        BookingSale.objects.filter(pk=sale.pk).update(outcome=sales.DOES_NOT_MATCH, dispute=dispute)
        return dispute

    def test_a_mismatch_whose_dispute_was_rejected_releases_by_the_timer(self):
        sale = self.paid_stay()
        self.mismatch(sale, Dispute.REJECTED)
        self.assertEqual(sales.release_due(sales.release_at(sale) + timedelta(minutes=1)), 1)
        sale.refresh_from_db()
        self.assertIsNotNone(sale.released_at)
        self.assertEqual(self.balance(Account.VENDOR_PENDING, self.owner), 0)

    def test_a_mismatch_with_the_dispute_open_is_not_released(self):
        sale = self.paid_stay()
        self.mismatch(sale, Dispute.OPEN)
        self.assertEqual(sales.release_due(sales.release_at(sale) + timedelta(minutes=1)), 0)
        sale.refresh_from_db()
        self.assertIsNone(sale.released_at)

    def test_a_mismatch_resolved_with_a_partial_refund_releases_the_remainder_once(self):
        sale = self.paid_stay(nights=2)                                       # 30000
        self.mismatch(sale, Dispute.RESOLVED)
        sales.refund(sale, 10000, source="dispute-1")
        later = sales.release_at(sale) + timedelta(minutes=1)
        self.assertEqual(sales.release_due(later), 1)
        self.assertEqual(sales.release_due(later + timedelta(hours=2)), 0)
        self.assertEqual(Journal.objects.filter(key=sales.release_key(sale)).count(), 1)
        self.assertEqual(self.balance(Account.VENDOR_PENDING, self.owner), 0)
        self.assertEqual(self.balance(Account.CUSTOMER_WALLET, self.customer), 10000)
        for journal in Journal.objects.all():
            lines = journal.lines.all()
            self.assertEqual(sum(l.amount for l in lines if l.side == "debit"), sum(l.amount for l in lines if l.side == "credit"))
        released = Journal.objects.get(key=sales.release_key(sale))
        self.assertEqual(sum(l.amount for l in released.lines.all() if l.side == "debit"), 20000)

    def test_accept_is_409_when_nothing_was_released(self):
        sale = self.paid_service("200.00")
        ServiceRequest.objects.filter(pk=sale.service_request_id).update(status=ServiceRequest.COMPLETED, completed_at=timezone.now())
        BookingSale.objects.filter(pk=sale.pk).update(outcome=sales.DOES_NOT_MATCH)      # a negative call, no dispute linked
        self.as_customer()
        response = self.client.post(f"/api/services/requests/{sale.service_request_id}/accept/", {}, format="json")
        self.assertEqual(response.status_code, 409, response.content)
        self.assertEqual(self.balance(Account.VENDOR_AVAILABLE, self.owner), 0)

    def test_tickets_of_an_unapproved_event_are_not_released_until_approved(self):
        sale = self.paid_tickets()
        due = sales.release_at(sale) + timedelta(minutes=1)
        for status in (Event.PENDING, Event.REJECTED):
            Event.objects.filter(pk=sale.event_id).update(status=status)
            self.assertEqual(sales.release_due(due), 0)
        Event.objects.filter(pk=sale.event_id).update(status=Event.APPROVED)
        self.assertEqual(sales.release_due(due), 1)

    def test_tickets_of_an_expired_listing_still_release(self):
        sale = self.paid_tickets()
        Event.objects.filter(pk=sale.event_id).update(status=Event.EXPIRED)
        self.assertEqual(sales.release_due(sales.release_at(sale) + timedelta(minutes=1)), 1)
