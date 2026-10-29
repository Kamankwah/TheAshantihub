"""Refunds and a third-party rider's pay (wallets Plan 5, Task 4; Plan 7F-D Task 1): a delivery made but not picked up is
not a trip, so nothing is paid before release; after release a refund never takes a rider's pay back (the delivery fee
belongs to the rider once any pickup is done: test_rider_refund_pay)."""
from django.test import override_settings
from django.utils import timezone

from delivery.models import RiderEarning
from ledger import escrow, posting, refunds, riders
from ledger.models import Account, FulfilmentCheck
from orders.models import DeliveryAssignment

from . import rider_helpers
from .test_refunds import RefundBase


@override_settings(LEDGER_ENABLED=True)
class RiderRefundTests(RefundBase):
    def setUp(self):
        super().setUp()
        self.kofi = self.owner("Kofi")
        self.swift = rider_helpers.rider()

    def delivered_order(self, *, delivery="10.00", price="60.00"):
        order = self.paid([(self.listing(self.kofi, price), 1)], delivery=delivery)
        rider_helpers.delivered_by(order, self.swift)
        return order

    def rider_balances(self):
        return (
            posting.balance_of(Account.RIDER_BALANCE, self.swift.staff), posting.balance_of(Account.RIDER_RESERVE, self.swift.staff),
        )

    def test_review_focus_a_whole_refund_before_release_pays_the_rider_nothing(self):
        order = self.delivered_order()
        refunds.refund_order(order, source="dispute-1")                                     # the whole order, delivery included
        self.assertEqual(self.wallet(), 7000)
        FulfilmentCheck.objects.update_or_create(order=order, defaults=dict(outcome=FulfilmentCheck.MATCHES))
        self.assertIsNone(escrow.release_verified(order))
        self.assertFalse(RiderEarning.objects.exists())
        self.assertFalse(Account.objects.filter(kind=Account.RIDER_BALANCE).exists())        # no empty wallet opened

    def test_a_partial_refund_after_release_leaves_the_rider_paid(self):
        order = self.delivered_order()
        self.release(order)
        refunds.refund_order(order, 3000, source="dispute-1")
        self.assertEqual(self.rider_balances(), (900, 100))
        self.assertIsNone(RiderEarning.objects.get(order=order).reversed_at)

    def test_every_item_refunded_before_release_still_pays_the_rider_the_delivery(self):
        order = self.delivered_order()
        refunds.refund_order(order, source="dispute-1", owner_ids={self.kofi.pk})           # items back; the fee stays held
        self.release(order)
        self.assertEqual(self.rider_balances(), (900, 100))

    def test_a_promo_order_picked_up_then_refunded_whole_has_the_business_pay_the_rider(self):
        order = self.delivered_order(delivery="0.00", price="120.00")
        rider_helpers.waived(order, self.kofi)
        DeliveryAssignment.objects.filter(order=order).update(picked_up_at=timezone.now())
        refunds.refund_order(order, source="dispute-1")
        self.assertEqual(self.wallet(), 12000)
        self.assertEqual(self.rider_balances(), (1350, 150))
        self.assertEqual(self.balance(Account.VENDOR_AVAILABLE, self.kofi), -1500)
        self.assertEqual(self.balance(Account.PLATFORM_DELIVERY_INCOME), 0)

    def test_a_promo_order_never_picked_up_charges_nobody_and_pays_nobody(self):
        order = self.delivered_order(delivery="0.00", price="120.00")
        rider_helpers.waived(order, self.kofi)
        refunds.refund_order(order, source="dispute-1")
        self.assertEqual(self.rider_balances(), (0, 0))
        self.assertEqual(self.balance(Account.VENDOR_AVAILABLE, self.kofi), 0)

    def test_no_reverse_earning_symbol_remains(self):
        self.assertFalse(hasattr(riders, "reverse_earning"))
        self.assertFalse(hasattr(riders, "earning_to_reverse"))
        self.assertFalse(hasattr(riders, "credit_on_refund"))
