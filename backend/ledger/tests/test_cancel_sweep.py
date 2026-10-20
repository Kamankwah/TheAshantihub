"""Plan 7F-C, task 2: the hourly sweep finishes a cancel that was interrupted, never refunding a ticket twice, and does
nothing when every ticket of every cancelled event is refunded."""
from unittest import mock

from django.conf import settings
from django.test import override_settings

from events import cancellation
from events.models import Ticket
from ledger import sales, tasks
from ledger.models import Account, BookingRefund
from ledger.refunds import RefundError
from notifications.models import Notification

from .booking_helpers import BookingBase


@override_settings(LEDGER_ENABLED=True)
class CancelSweepTests(BookingBase):
    def test_sweep_finishes_interrupted_cancel(self):
        self.paid_tickets(quantity=2)
        second = Ticket.objects.order_by("pk").last()
        real_refund = sales.refund

        def flaky(sale, amount=None, *, source, **kwargs):
            if source == f"ticket-{second.pk}":
                raise RefundError("Provider fell over")
            return real_refund(sale, amount, source=source, **kwargs)

        with mock.patch("ledger.sales.refund", side_effect=flaky):
            result = cancellation.cancel_event(self.event, by=self.owner, reason="Venue flooded")
        self.assertEqual(result.tickets_left, 1)

        with self.captureOnCommitCallbacks(execute=True):
            self.assertEqual(tasks.finish_cancelled_event_refunds(), 1)
        second.refresh_from_db()
        self.assertIsNotNone(second.refunded_at)
        self.assertEqual(second.refund_reason, "Venue flooded")
        self.assertEqual(BookingRefund.objects.count(), 2)
        self.assertEqual(self.balance(Account.CUSTOMER_WALLET, self.customer), 10000)
        notice = Notification.objects.get(customer=self.customer, kind="event_cancelled")
        self.assertIn("GH₵ 50.00 went back", notice.body)

    def test_sweep_noop_when_all_refunded(self):
        self.paid_tickets(quantity=2)
        cancellation.cancel_event(self.event, by=self.owner, reason="Venue flooded")
        with self.captureOnCommitCallbacks(execute=True):
            self.assertEqual(tasks.finish_cancelled_event_refunds(), 0)
        self.assertEqual(BookingRefund.objects.count(), 2)
        self.assertFalse(Notification.objects.filter(kind="event_cancelled").exists())

    def test_sweep_ignores_live_events(self):
        self.paid_tickets(quantity=2)
        self.assertEqual(tasks.finish_cancelled_event_refunds(), 0)
        self.assertFalse(Ticket.objects.filter(refunded_at__isnull=False).exists())

    def test_candidates_are_cancelled_events_with_an_unrefunded_ticket(self):
        from datetime import timedelta

        from django.utils import timezone

        from events.models import Event

        self.paid_tickets(quantity=2)
        now = timezone.now()
        bare = Event.objects.create(
            category=self.event.category, zone=self.zone, submitted_by_business=self.owner, name="No Tickets",
            description="D.", address="Kumasi", event_date=now + timedelta(days=5), visibility_days=14,
            status=Event.CANCELLED, cancelled_at=now,
        )
        Event.objects.filter(pk=self.event.pk).update(status=Event.CANCELLED, cancelled_at=now)
        self.assertEqual(list(tasks.cancelled_events_to_finish()), [self.event])     # two unrefunded tickets: listed once
        self.assertNotIn(bare, tasks.cancelled_events_to_finish())
        Ticket.objects.update(refunded_at=now)
        self.assertEqual(list(tasks.cancelled_events_to_finish()), [])                 # all refunded: excluded

    def test_beat_runs_hourly_at_fifty_past(self):
        entry = settings.CELERY_BEAT_SCHEDULE["ledger-finish-cancelled-event-refunds"]
        self.assertEqual(entry["task"], "ledger.tasks.finish_cancelled_event_refunds")
        self.assertEqual(entry["schedule"]._orig_minute, 50)
