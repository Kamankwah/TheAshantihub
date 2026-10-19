"""Plan 7C, task 2: ticket money releases `event_release_delay_hours` (48) after the end of the event's day, on the hourly
clock, and nowhere else: not on a scan, not while a dispute is open, not once refunded in full. A date edit moves it."""
from datetime import datetime, time, timedelta, timezone as dt_timezone

from django.conf import settings
from django.test import override_settings
from django.utils import timezone

from accounts.testing import make_staff
from disputes.models import Dispute
from events.models import Event, Ticket
from ledger import sales
from ledger.models import Account, BookingSale

from .booking_helpers import BookingBase

UTC = dt_timezone.utc


def day_end(event_date):
    return datetime.combine(event_date.astimezone(UTC).date() + timedelta(days=1), time(0, 0), tzinfo=UTC)


@override_settings(LEDGER_ENABLED=True)
class EventReleaseTimerTests(BookingBase):
    def test_release_two_days_after_event_end(self):
        sale = self.paid_tickets()
        due = day_end(sale.event.event_date) + timedelta(hours=48)
        self.assertEqual(sales.release_at(sale), due)
        self.assertEqual(sales.release_due(due), 1)
        sale.refresh_from_db()
        self.assertIsNotNone(sale.released_at)
        self.assertEqual(self.balance(Account.VENDOR_PENDING, self.owner), 0)
        self.assertTrue(Ticket.objects.filter(transaction=sale.session.transaction, escrow_status=Ticket.RELEASED).exists())

    def test_not_released_before_delay(self):
        sale = self.paid_tickets()
        due = day_end(sale.event.event_date) + timedelta(hours=48)
        self.assertEqual(sales.release_due(due - timedelta(minutes=1)), 0)
        sale.refresh_from_db()
        self.assertIsNone(sale.released_at)

    def test_date_change_moves_release(self):
        sale = self.paid_tickets()
        old = sales.release_at(sale)
        Event.objects.filter(pk=sale.event_id).update(event_date=sale.event.event_date + timedelta(days=3))
        sale = BookingSale.objects.get(pk=sale.pk)
        self.assertEqual(sales.release_at(sale), old + timedelta(days=3))
        self.assertEqual(sales.release_due(old + timedelta(hours=1)), 0)
        self.assertEqual(sales.release_due(old + timedelta(days=3)), 1)

    def test_disputed_sale_not_released_by_timer(self):
        sale = self.paid_tickets()
        dispute = Dispute.objects.create(
            order=None, raised_by=None, logged_by=make_staff("support", "t7c2@example.com"), reason=Dispute.QUALITY_ISSUE,
            status=Dispute.OPEN, description="Wrong event.",
        )
        BookingSale.objects.filter(pk=sale.pk).update(dispute=dispute)
        due = sales.release_at(sale) + timedelta(hours=1)
        self.assertEqual(sales.release_due(due), 0)
        Dispute.objects.filter(pk=dispute.pk).update(status=Dispute.REJECTED)
        self.assertEqual(sales.release_due(due), 1)

    def test_refunded_sale_not_released_by_timer(self):
        sale = self.paid_tickets()
        sales.refund(sale, source="full-test")
        self.assertEqual(sales.release_due(sales.release_at(sale) + timedelta(hours=1)), 0)

    def test_cancelled_event_refunds_all(self):
        sale = self.paid_tickets(quantity=2)
        accountant = make_staff("accountant", "acct7c2@example.com")
        for ticket in Ticket.objects.filter(transaction=sale.session.transaction):
            sales.refund_ticket(sale, ticket.pk, by=accountant, reason="Event cancelled")
        sale.refresh_from_db()
        self.assertIsNotNone(sale.reversed_at)
        self.assertEqual(Ticket.objects.filter(transaction=sale.session.transaction, refunded_at__isnull=True).count(), 0)
        self.assertEqual(self.balance(Account.VENDOR_PENDING, self.owner), 0)

    def test_job_is_scheduled_hourly(self):
        entry = settings.CELERY_BEAT_SCHEDULE["ledger-release-due-booking-sales"]
        self.assertEqual(entry["task"], "ledger.tasks.release_due_booking_sales")
        self.assertEqual(entry["schedule"].hour, set(range(24)))
        self.assertEqual(len(entry["schedule"].minute), 1)
