"""The delivery fee belongs to the rider once any pickup is done (Plan 7F-D Task 1; spec §6, §7): after the rider has picked
up at least one stop, a refund of goods never returns the delivery fee. A whole refund before release settles it at once
(the release will never run); before any pickup the customer gets the fee back and the rider nothing."""
from datetime import timedelta

from django.test import override_settings
from django.utils import timezone

from delivery.models import PickupStop, RiderEarning
from ledger import posting, refunds, riders
from ledger.models import Account, Journal, JournalLine
from orders.models import DeliveryAssignment, Order

from . import rider_helpers
from .test_refunds import RefundBase


@override_settings(LEDGER_ENABLED=True)
class RiderRefundPayTests(RefundBase):
    def setUp(self):
        super().setUp()
        self.kofi = self.owner("Kofi")
        self.swift = rider_helpers.rider()

    def assigned(self, rider_row=None, *, status=DeliveryAssignment.ASSIGNED, picked_up=False, discount="0.00", price="100.00",
                 delivery="15.00"):
        order = self.paid([(self.listing(self.kofi, price), 1)], delivery=delivery, discount=discount)
        order.delivery_method = Order.DOOR_TO_DOOR
        order.save(update_fields=["delivery_method"])
        DeliveryAssignment.objects.create(
            order=order, dispatch=(rider_row or self.swift).staff, status=status,
            picked_up_at=timezone.now() if picked_up else None,
        )
        return order

    def picked(self, **kwargs):
        return self.assigned(status=DeliveryAssignment.PICKED_UP, picked_up=True, **kwargs)

    def rider_balances(self, row=None):
        row = row or self.swift
        return posting.balance_of(Account.RIDER_BALANCE, row.staff), posting.balance_of(Account.RIDER_RESERVE, row.staff)

    def assert_balanced(self):
        for journal in Journal.objects.all():
            lines = JournalLine.objects.filter(journal=journal)
            debit = sum(l.amount for l in lines if l.side == JournalLine.DEBIT)
            credit = sum(l.amount for l in lines if l.side == JournalLine.CREDIT)
            self.assertEqual(debit, credit, journal.key)

    def test_whole_refund_after_pickup_keeps_fee_for_rider(self):
        order = self.picked()
        refund = refunds.refund_order(order, source="dispute-1")
        self.assertEqual(self.wallet(), 10000)
        self.assertEqual((refund.delivery_pesewas, refund.delivery_kept_pesewas), (0, 1500))
        self.assertEqual(refund.wallet_pesewas, 10000)
        self.assertEqual(self.rider_balances(), (1350, 150))
        earning = RiderEarning.objects.get(order=order)
        self.assertEqual((earning.gross_pesewas, earning.commission_bp), (1500, 1000))
        self.assertEqual(self.balance(Account.DELIVERY_PAYABLE, order), 0)
        self.assertEqual(self.balance(Account.PLATFORM_DELIVERY_INCOME), 0)
        self.assertEqual(refunds.left(order).delivery, 0)
        self.assert_balanced()

    def test_whole_refund_before_pickup_returns_fee_and_pays_rider_nothing(self):
        order = self.assigned()
        refund = refunds.refund_order(order, source="dispute-1")
        self.assertEqual(self.wallet(), 11500)
        self.assertEqual((refund.delivery_pesewas, refund.delivery_kept_pesewas), (1500, 0))
        self.assertEqual(self.rider_balances(), (0, 0))
        self.assertFalse(RiderEarning.objects.exists())
        self.assertEqual(self.balance(Account.DELIVERY_PAYABLE, order), 0)
        self.assert_balanced()

    def test_multi_stop_any_pickup_pays_rider(self):
        esi = self.owner("Esi")
        order = self.paid([(self.listing(self.kofi, "60.00"), 1), (self.listing(esi, "40.00"), 1)], delivery="15.00")
        rider_helpers.delivered_by(order, self.swift, status=DeliveryAssignment.ACCEPTED)
        rider_helpers.stop_collected(order, self.kofi)
        rider_helpers.stop_collected(order, esi, status=PickupStop.PENDING)
        self.assertIsNone(DeliveryAssignment.objects.get(order=order).picked_up_at)
        refunds.refund_order(order, source="dispute-1")
        self.assertEqual(self.wallet(), 10000)
        self.assertEqual(self.rider_balances(), (1350, 150))
        self.assert_balanced()

    def test_failed_delivery_after_pickup_still_pays_rider(self):
        order = self.assigned(status=DeliveryAssignment.FAILED)
        rider_helpers.stop_collected(order, self.kofi)
        refunds.refund_order(order, source="dispute-1")
        self.assertEqual(self.wallet(), 10000)
        self.assertEqual(self.rider_balances(), (1350, 150))
        self.assert_balanced()

    def test_no_stop_collected_returns_fee(self):
        order = self.assigned(status=DeliveryAssignment.ACCEPTED)
        rider_helpers.stop_collected(order, self.kofi, status=PickupStop.SKIPPED)
        self.assertIsNone(riders.pickup_made(order))
        refunds.refund_order(order, source="dispute-1")
        self.assertEqual(self.wallet(), 11500)
        self.assertEqual(self.rider_balances(), (0, 0))
        self.assertFalse(RiderEarning.objects.exists())

    def test_partial_refund_of_one_shop_moves_no_fee(self):
        esi = self.owner("Esi")
        order = self.paid([(self.listing(self.kofi, "60.00"), 1), (self.listing(esi, "40.00"), 1)], delivery="15.00")
        rider_helpers.delivered_by(order, self.swift, status=DeliveryAssignment.PICKED_UP)
        rider_helpers.stop_collected(order, self.kofi)
        refunds.refund_order(order, source="dispute-1", owner_ids={esi.pk})
        self.assertEqual(self.wallet(), 4000)
        self.assertEqual(self.balance(Account.DELIVERY_PAYABLE, order), 1500)
        self.assertEqual(self.rider_balances(), (0, 0))
        self.assertFalse(RiderEarning.objects.exists())
        DeliveryAssignment.objects.filter(order=order).update(delivered_at=timezone.now(), status=DeliveryAssignment.CONFIRMED)
        self.release(order)
        self.assertEqual(self.rider_balances(), (1350, 150))
        self.assertEqual(RiderEarning.objects.filter(order=order).count(), 1)
        self.assert_balanced()

    def test_refund_then_release_pays_once(self):
        order = self.picked()
        refunds.refund_order(order, source="dispute-1")
        DeliveryAssignment.objects.filter(order=order).update(delivered_at=timezone.now(), status=DeliveryAssignment.CONFIRMED)
        Order.objects.filter(pk=order.pk).update(status=Order.PAID)
        order.refresh_from_db()
        from ledger import escrow
        from ledger.models import FulfilmentCheck

        FulfilmentCheck.objects.create(order=order, outcome=FulfilmentCheck.MATCHES)
        escrow.release_verified(order)
        self.assertEqual(self.rider_balances(), (1350, 150))
        self.assertEqual(RiderEarning.objects.filter(order=order).count(), 1)
        self.assertEqual(Journal.objects.filter(key=riders.earning_key(order)).count(), 1)
        self.assert_balanced()

    def test_refund_after_release_does_not_reverse_rider(self):
        order = self.picked()
        DeliveryAssignment.objects.filter(order=order).update(
            delivered_at=timezone.now(), confirmed_at=timezone.now(), status=DeliveryAssignment.CONFIRMED,
        )
        self.release(order)
        self.assertEqual(self.rider_balances(), (1350, 150))
        refund = refunds.refund_order(order, source="dispute-1")
        self.assertEqual(self.rider_balances(), (1350, 150))
        self.assertEqual(self.wallet(), 10000)                          # goods only
        self.assertEqual((refund.delivery_pesewas, refund.delivery_kept_pesewas), (0, 1500))
        self.assertFalse(Journal.objects.filter(key=f"order-rider-reversal-{order.pk}").exists())
        self.assertIsNone(RiderEarning.objects.get(order=order).reversed_at)
        self.assertEqual(self.balance(Account.PLATFORM_DELIVERY_INCOME), 0)
        self.assert_balanced()

    def test_same_source_twice_is_idempotent(self):
        order = self.picked()
        first = refunds.refund_order(order, source="dispute-1")
        again = refunds.refund_order(order, source="dispute-1")
        self.assertEqual(first.pk, again.pk)
        self.assertEqual(self.rider_balances(), (1350, 150))
        self.assertEqual(Journal.objects.filter(key=f"order-delivery-settle-{order.pk}").count(), 1)
        self.assertEqual(RiderEarning.objects.count(), 1)

    def test_in_house_rider_fee_stays_platform_income(self):
        own = rider_helpers.rider("own@example.com", phone="+233244000003", third_party=False)
        order = self.assigned(own, status=DeliveryAssignment.PICKED_UP, picked_up=True)
        refund = refunds.refund_order(order, source="dispute-1")
        self.assertEqual(self.wallet(), 10000)
        self.assertEqual(refund.delivery_kept_pesewas, 1500)
        self.assertEqual(self.rider_balances(own), (0, 0))
        self.assertFalse(RiderEarning.objects.exists())
        self.assertEqual(self.balance(Account.DELIVERY_PAYABLE, order), 0)
        self.assertEqual(self.balance(Account.PLATFORM_DELIVERY_INCOME), 1500)
        self.assert_balanced()

    def test_rider_not_third_party_at_pickup_gets_nothing(self):
        order = self.assigned(status=DeliveryAssignment.PICKED_UP)
        DeliveryAssignment.objects.filter(order=order).update(picked_up_at=self.swift.third_party_since - timedelta(days=2))
        refunds.refund_order(order, source="dispute-1")
        self.assertEqual(self.wallet(), 10000)
        self.assertEqual(self.rider_balances(), (0, 0))
        self.assertFalse(RiderEarning.objects.exists())
        self.assertEqual(self.balance(Account.PLATFORM_DELIVERY_INCOME), 1500)

    def test_coupon_shortfall_pays_rider_in_full(self):
        order = self.picked(price="20.00", discount="30.00")             # the customer paid 5.00
        refund = refunds.refund_order(order, source="dispute-1")
        self.assertEqual(self.wallet(), 0)
        self.assertEqual((refund.wallet_pesewas, refund.delivery_kept_pesewas), (0, 1500))
        self.assertEqual(self.rider_balances(), (1350, 150))
        self.assertEqual(self.balance(Account.PLATFORM_PROMO_SUBSIDY), 1000)     # 30.00 out at payment, 20.00 back: 10.00 net
        self.assertEqual(self.balance(Account.DELIVERY_PAYABLE, order), 0)
        self.assert_balanced()

    def test_coupon_covers_fee_no_shortfall(self):
        order = self.picked(discount="20.00")                            # the customer paid 95.00
        refund = refunds.refund_order(order, source="dispute-1")
        self.assertEqual(self.wallet(), 8000)                            # paid 95.00 less the 15.00 kept
        self.assertEqual(refund.wallet_pesewas, 8000)
        self.assertEqual(self.rider_balances(), (1350, 150))
        self.assertEqual(self.balance(Account.PLATFORM_PROMO_SUBSIDY), 0)
        self.assert_balanced()

    @override_settings(LEDGER_ENABLED=False)
    def test_inert_while_the_ledger_is_off(self):
        order = self.picked()
        self.assertIsNone(refunds.refund_order(order, source="dispute-1"))
        self.assertFalse(RiderEarning.objects.exists())
