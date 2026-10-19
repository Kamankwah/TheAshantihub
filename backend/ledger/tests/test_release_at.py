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
