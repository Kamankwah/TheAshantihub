"""Plan 7E, Task 3: vendor-chosen cancellation policies. Pure share arithmetic, the snapshot taken at payment, and the
customer's cancel refunding base * share plus its proportional fee through the existing refund path."""
from datetime import datetime, timedelta, timezone as dt_timezone
from decimal import Decimal

from django.test import SimpleTestCase, override_settings
from django.utils import timezone

from bookings.models import Booking
from events.models import Event, Ticket
from ledger import cancellation, posting, sales
from ledger.models import Account, BookingSale, Journal
from services.models import ServiceRequest

from .booking_helpers import BookingBase

START = datetime(2026, 11, 10, 14, 0, tzinfo=dt_timezone.utc)


def before(**delta):
    return START - timedelta(**delta)


class ShareTests(SimpleTestCase):
    def test_flexible_boundary_favours_guest(self):
        self.assertEqual(cancellation.refund_share("flexible", START, before(hours=24)), 10000)
        self.assertEqual(cancellation.refund_share("flexible", START, before(hours=24) + timedelta(seconds=1)), 0)
        self.assertEqual(cancellation.refund_share("flexible", START, before(days=30)), 10000)

    def test_moderate_two_tiers(self):
        self.assertEqual(cancellation.refund_share("moderate", START, before(days=5)), 10000)
        self.assertEqual(cancellation.refund_share("moderate", START, before(days=5) + timedelta(seconds=1)), 5000)
        self.assertEqual(cancellation.refund_share("moderate", START, before(hours=24)), 5000)
        self.assertEqual(cancellation.refund_share("moderate", START, before(hours=24) + timedelta(seconds=1)), 0)

    def test_strict_half_then_none(self):
        self.assertEqual(cancellation.refund_share("strict", START, before(days=7)), 5000)
        self.assertEqual(cancellation.refund_share("strict", START, before(days=7) + timedelta(seconds=1)), 0)
        self.assertEqual(cancellation.refund_share("strict", START, before(days=60)), 5000)

    def test_none_never_refunds_and_no_start_is_whole(self):
        self.assertEqual(cancellation.refund_share("none", START, before(days=90)), 0)
        self.assertEqual(cancellation.refund_share("flexible", None, START), 10000)

    def test_a_snapshot_dict_is_read_like_a_name(self):
        snap = cancellation.snapshot("strict")
        self.assertEqual(cancellation.refund_share(snap, START, before(days=8)), 5000)


@override_settings(LEDGER_ENABLED=True)
class CancelBySaleTests(BookingBase):
    def wallet(self):
        return self.balance(Account.CUSTOMER_WALLET, self.customer)

    def stay(self, policy="flexible", starts_in=10):
        Listing = self.lodge.__class__
        Listing.objects.filter(pk=self.lodge.pk).update(cancellation_policy=policy)
        return self.paid_stay(nights=2, starts_in=starts_in)       # GH₵ 300.00

    def start_of(self, sale):
        return datetime.combine(sale.booking.check_in, sales.STAY_CHECK_IN_TIME, tzinfo=dt_timezone.utc)

    def test_new_listings_default_to_flexible_and_the_snapshot_is_taken_at_payment(self):
        self.assertEqual(self.lodge.cancellation_policy, "flexible")
        sale = self.paid_stay()
        self.assertEqual(sale.policy_snapshot["policy"], "flexible")
        self.assertEqual(sale.policy_snapshot["tiers"], [[24, 10000]])

    def test_snapshot_survives_policy_edit(self):
        sale = self.stay("moderate")
        self.lodge.__class__.objects.filter(pk=self.lodge.pk).update(cancellation_policy="strict")
        sale.refresh_from_db()
        self.assertEqual(sale.policy_snapshot["policy"], "moderate")
        # 3 days out: moderate gives half; the edited strict policy would give half too, so use 6 days out: moderate whole
        given = sales.cancel_by_customer(sale, self.start_of(sale) - timedelta(days=6))
        self.assertEqual(given.amount_pesewas, 30000)

    def test_flexible_cancel_at_the_cutoff_instant_is_whole(self):
        sale = self.stay("flexible")
        given = sales.cancel_by_customer(sale, self.start_of(sale) - timedelta(hours=24))
        self.assertTrue(given.whole)
        self.assertEqual(self.wallet(), 30000)
        self.assertEqual(Booking.objects.get(pk=sale.booking_id).status, Booking.CANCELLED)

    def test_flexible_cancel_a_second_late_is_refused_with_no_refund(self):
        sale = self.stay("flexible")
        with self.assertRaises(sales.CancelError) as ctx:
            sales.cancel_by_customer(sale, self.start_of(sale) - timedelta(hours=24) + timedelta(seconds=1))
        self.assertEqual(ctx.exception.status_code, 409)
        self.assertEqual(self.wallet(), 0)
        self.assertEqual(Booking.objects.get(pk=sale.booking_id).status, Booking.CONFIRMED)

    def test_refund_conserves_money_with_fee_share(self):
        sale = self.stay("moderate")                   # 30000 paid; 3 days out: half
        fee = sale.charged_pesewas
        given = sales.cancel_by_customer(sale, self.start_of(sale) - timedelta(days=3))
        sale.refresh_from_db()
        self.assertFalse(given.whole)
        self.assertEqual(given.amount_pesewas, 15000)
        self.assertEqual(self.wallet(), 15000)
        self.assertEqual(self.balance(Account.VENDOR_PENDING, self.owner), 15000)
        self.assertEqual(sale.refunded_fee_pesewas, (2 * fee * 15000 + 30000) // 60000)
        self.assertEqual(given.fee_pesewas, sale.refunded_fee_pesewas)
        self.assertEqual(Booking.objects.get(pk=sale.booking_id).status, Booking.CANCELLED)
        for journal in Journal.objects.all():
            lines = journal.lines.all()
            self.assertEqual(sum(l.amount for l in lines if l.side == "debit"), sum(l.amount for l in lines if l.side == "credit"))
        # the host keeps half, so a second cancel cannot take the rest
        with self.assertRaises(sales.CancelError):
            sales.cancel_by_customer(sale, self.start_of(sale) - timedelta(days=3))
        self.assertEqual(self.wallet(), 15000)

    def test_cancel_after_milestone_409_dispute_instead(self):
        sale = self.stay("flexible")
        after = sales.release_at(sale) + timedelta(minutes=1)
        with self.assertRaises(sales.CancelError) as ctx:
            sales.cancel_by_customer(sale, after)
        self.assertIn("dispute", ctx.exception.message.lower())
        BookingSale.objects.filter(pk=sale.pk).update(released_at=timezone.now())
        sale.refresh_from_db()
        with self.assertRaises(sales.CancelError):
            sales.cancel_by_customer(sale, self.start_of(sale) - timedelta(days=20))

    def test_legacy_sale_without_a_snapshot_is_support_only(self):
        sale = self.stay("flexible")
        BookingSale.objects.filter(pk=sale.pk).update(policy_snapshot=None)
        sale.refresh_from_db()
        with self.assertRaises(sales.CancelError) as ctx:
            sales.cancel_by_customer(sale, self.start_of(sale) - timedelta(days=20))
        self.assertEqual(ctx.exception.status_code, 409)
        self.as_customer()
        response = self.client.post(f"/api/bookings/{sale.booking_id}/cancel/")
        self.assertEqual(response.status_code, 409)
        self.assertEqual(self.wallet(), 0)

    def test_stay_door_uses_the_policy(self):
        sale = self.stay("flexible", starts_in=10)
        self.as_customer()
        response = self.client.post(f"/api/bookings/{sale.booking_id}/cancel/")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["wallet_refund"], "300.00")
        self.assertEqual(self.wallet(), 30000)

    def test_stay_door_after_cutoff_is_409_and_keeps_the_booking(self):
        sale = self.stay("strict", starts_in=2)
        self.as_customer()
        response = self.client.post(f"/api/bookings/{sale.booking_id}/cancel/")
        self.assertEqual(response.status_code, 409, response.content)
        self.assertEqual(Booking.objects.get(pk=sale.booking_id).status, Booking.CONFIRMED)

    def test_service_cancels_whole_until_marked_done(self):
        sale = self.paid_service("200.00")
        self.as_customer()
        response = self.client.post(f"/api/services/requests/{sale.service_request_id}/cancel/")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(self.wallet(), 20000)
        self.assertEqual(ServiceRequest.objects.get(pk=sale.service_request_id).status, ServiceRequest.CANCELLED)

    def test_service_cancel_after_done_is_409(self):
        sale = self.paid_service("200.00")
        ServiceRequest.objects.filter(pk=sale.service_request_id).update(status=ServiceRequest.COMPLETED, completed_at=timezone.now())
        self.as_customer()
        self.assertEqual(self.client.post(f"/api/services/requests/{sale.service_request_id}/cancel/").status_code, 409)
        self.assertEqual(self.wallet(), 0)

    def test_tickets_default_to_no_refund(self):
        sale = self.paid_tickets(2)
        self.assertEqual(sale.policy_snapshot["policy"], "none")
        self.as_customer()
        response = self.client.post(f"/api/events/tickets/purchases/{sale.pk}/cancel/")
        self.assertEqual(response.status_code, 409, response.content)
        self.assertEqual(self.wallet(), 0)

    def test_tickets_with_an_organiser_window_refund_and_mark_tickets_refunded(self):
        Event.objects.filter(pk=self.event.pk).update(refund_until_days_before=3)
        sale = self.paid_tickets(2)                    # event is 10 days out
        self.assertEqual(sale.policy_snapshot["tiers"], [[72, 10000]])
        self.as_customer()
        response = self.client.post(f"/api/events/tickets/purchases/{sale.pk}/cancel/")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(self.wallet(), 10000)
        self.assertEqual(Ticket.objects.filter(transaction=sale.session.transaction, refunded_at__isnull=False).count(), 2)

    def test_another_customer_cannot_cancel(self):
        from accounts.models import Customer
        Event.objects.filter(pk=self.event.pk).update(refund_until_days_before=3)
        sale = self.paid_tickets(1)
        other = Customer.objects.create(full_name="Kojo", phone="+233200770009", password_hash="x")
        self.as_customer(other)
        self.assertEqual(self.client.post(f"/api/events/tickets/purchases/{sale.pk}/cancel/").status_code, 404)
