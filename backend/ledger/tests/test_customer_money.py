"""Plan 7G, Task 2: `customer_money.money_block`, the read-only block a customer sees on their own stays, services and
tickets."""
from datetime import datetime, timedelta, timezone as dt_timezone

from django.test import override_settings
from django.utils import timezone
from rest_framework import serializers

from accounts.testing import make_staff
from disputes.models import Dispute
from ledger import customer_money, sales
from ledger.models import BookingSale
from services.models import ServiceRequest

from .booking_helpers import BookingBase

BLOCK_KEYS = {
    "sale", "release_at", "released_at", "accepted_at", "refunded", "refunded_whole", "problem", "policy", "start",
    "can_cancel", "can_report", "cancelled_by_you",
}


def iso(value):
    return serializers.DateTimeField().to_representation(value)


@override_settings(LEDGER_ENABLED=True)
class MoneyBlockTests(BookingBase):
    def stay(self, policy="moderate", starts_in=10):
        self.lodge.__class__.objects.filter(pk=self.lodge.pk).update(cancellation_policy=policy)
        return self.paid_stay(nights=2, starts_in=starts_in)       # GH₵ 300.00

    def start_of(self, sale):
        return datetime.combine(sale.booking.check_in, sales.STAY_CHECK_IN_TIME, tzinfo=dt_timezone.utc)

    def dispute(self, sale, status):
        dispute = Dispute.objects.create(
            order=None, raised_by=None, logged_by=make_staff("support", "cm7g@example.com"), reason=Dispute.QUALITY_ISSUE,
            status=status, description="Not as described.",
        )
        BookingSale.objects.filter(pk=sale.pk).update(dispute=dispute)
        return dispute

    def test_none_without_a_sale_or_with_the_ledger_off(self):
        sale = self.stay()
        self.assertIsNone(customer_money.money_block(None))
        with override_settings(LEDGER_ENABLED=False):
            self.assertIsNone(customer_money.money_block(sale))

    def test_stay_block_before_start(self):
        sale = self.stay("moderate")
        now = self.start_of(sale) - timedelta(days=10)
        block = customer_money.money_block(sale, now)
        self.assertEqual(set(block), BLOCK_KEYS)
        self.assertEqual(block["sale"], sale.pk)
        self.assertEqual(block["release_at"], iso(sales.release_at(sale)))
        self.assertTrue(block["release_at"].endswith("Z"))
        self.assertEqual(block["start"], iso(self.start_of(sale)))
        self.assertTrue(block["start"].endswith("14:00:00Z"))
        self.assertIsNone(block["released_at"])
        self.assertIsNone(block["accepted_at"])
        self.assertIsNone(block["refunded"])
        self.assertFalse(block["refunded_whole"])
        self.assertIsNone(block["problem"])
        self.assertFalse(block["cancelled_by_you"])
        self.assertEqual(block["policy"], sale.policy_snapshot)
        self.assertTrue(block["can_cancel"])
        self.assertTrue(block["can_report"])

    def test_service_has_no_release_at_until_done(self):
        sale = self.paid_service("200.00")
        block = customer_money.money_block(sale)
        self.assertIsNone(block["release_at"])
        self.assertIsNone(block["start"])
        done = timezone.now()
        ServiceRequest.objects.filter(pk=sale.service_request_id).update(status=ServiceRequest.COMPLETED, completed_at=done)
        sale = BookingSale.objects.get(pk=sale.pk)
        block = customer_money.money_block(sale)
        self.assertEqual(block["release_at"], iso(sales.release_at(sale)))
        self.assertIsNotNone(block["release_at"])

    def test_accepted_service_shows_accepted_at_and_released_at(self):
        sale = self.paid_service("200.00")
        ServiceRequest.objects.filter(pk=sale.service_request_id).update(status=ServiceRequest.COMPLETED, completed_at=timezone.now())
        sale = sales.accept(BookingSale.objects.get(pk=sale.pk), self.customer)
        block = customer_money.money_block(sale)
        self.assertEqual(block["accepted_at"], iso(sale.customer_accepted_at))
        self.assertEqual(block["released_at"], iso(sale.released_at))
        self.assertIsNone(block["release_at"])
        self.assertFalse(block["can_cancel"])
        self.assertFalse(block["can_report"])

    def test_open_then_closed_problem(self):
        sale = self.stay("flexible")
        dispute = self.dispute(sale, Dispute.OPEN)
        block = customer_money.money_block(BookingSale.objects.get(pk=sale.pk))
        self.assertEqual(block["problem"], "open")
        self.assertFalse(block["can_report"])
        Dispute.objects.filter(pk=dispute.pk).update(status=Dispute.RESOLVED)
        block = customer_money.money_block(BookingSale.objects.get(pk=sale.pk))
        self.assertEqual(block["problem"], "closed")
        self.assertFalse(block["can_report"])

    def test_partial_cancel_shows_refund_and_offers_nothing(self):
        sale = self.stay("moderate")
        now = self.start_of(sale) - timedelta(days=3)
        sales.cancel_by_customer(sale, now)
        block = customer_money.money_block(BookingSale.objects.get(pk=sale.pk), now)
        self.assertEqual(block["refunded"], "150.00")
        self.assertFalse(block["refunded_whole"])
        self.assertFalse(block["can_cancel"])
        self.assertFalse(block["can_report"])
        self.assertTrue(block["cancelled_by_you"])

    def test_a_staff_partial_refund_is_not_a_customer_cancel(self):
        sale = self.stay("moderate")
        sales.refund(sale, 5000, source="dispute-1", note="Settled by Support")
        block = customer_money.money_block(BookingSale.objects.get(pk=sale.pk))
        self.assertIsNotNone(block["refunded"])
        self.assertFalse(block["refunded_whole"])
        self.assertFalse(block["cancelled_by_you"])

    def test_whole_refund_marks_refunded_whole(self):
        sale = self.stay("flexible")
        now = self.start_of(sale) - timedelta(days=5)
        sales.cancel_by_customer(sale, now)
        block = customer_money.money_block(BookingSale.objects.get(pk=sale.pk), now)
        self.assertTrue(block["refunded_whole"])
        self.assertEqual(block["refunded"], "300.00")
        self.assertIsNone(block["release_at"])
        self.assertFalse(block["can_cancel"])
        self.assertFalse(block["can_report"])

    def test_legacy_sale_has_no_policy_and_cannot_cancel(self):
        sale = self.stay("flexible")
        BookingSale.objects.filter(pk=sale.pk).update(policy_snapshot=None)
        block = customer_money.money_block(BookingSale.objects.get(pk=sale.pk))
        self.assertIsNone(block["policy"])
        self.assertFalse(block["can_cancel"])
        self.assertTrue(block["can_report"])

    def test_past_release_time_cannot_cancel_but_can_report_until_released(self):
        sale = self.stay("flexible")
        late = sales.release_at(sale) + timedelta(minutes=1)
        block = customer_money.money_block(sale, late)
        self.assertFalse(block["can_cancel"])
        self.assertTrue(block["can_report"])
        self.assertEqual(block["release_at"], iso(sales.release_at(sale)))
        BookingSale.objects.filter(pk=sale.pk).update(released_at=late)
        block = customer_money.money_block(BookingSale.objects.get(pk=sale.pk), late)
        self.assertFalse(block["can_report"])
        self.assertIsNone(block["release_at"])
