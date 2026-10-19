"""A refund before release still pays a third-party rider for a trip already made (Plan 7D Task 1; spec §6, §7): a
whole refund after the rider picked the goods up pays them their share of the delivery fee (the 90/10 split's net) and
gives the rest back to the customer; before pickup, or for AshantiHub's own rider, nothing is paid."""
from django.test import override_settings
from django.utils import timezone

from delivery.models import RiderEarning
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

    def assigned(self, rider_row=None, *, status, picked_up=False):
        order = self.paid([(self.listing(self.kofi, "60.00"), 1)], delivery="10.00")
        order.delivery_method = Order.DOOR_TO_DOOR
        order.save(update_fields=["delivery_method"])
        DeliveryAssignment.objects.create(
            order=order, dispatch=(rider_row or self.swift).staff, status=status,
            picked_up_at=timezone.now() if picked_up else None,
        )
        return order

    def rider_balances(self, row=None):
        row = row or self.swift
        return posting.balance_of(Account.RIDER_BALANCE, row.staff), posting.balance_of(Account.RIDER_RESERVE, row.staff)

    def assert_balanced(self):
        for journal in Journal.objects.all():
            lines = JournalLine.objects.filter(journal=journal)
            debit = sum(l.amount for l in lines if l.side == JournalLine.DEBIT)
            credit = sum(l.amount for l in lines if l.side == JournalLine.CREDIT)
            self.assertEqual(debit, credit, journal.key)

    def test_whole_refund_before_pickup_pays_an_assigned_only_rider_nothing(self):
        order = self.assigned(status=DeliveryAssignment.ASSIGNED)
        self.assertFalse(riders.rider_picked_up(order))
        refunds.refund_order(order, source="dispute-1")
        self.assertEqual(self.wallet(), 7000)                              # items and the whole delivery fee back
        self.assertEqual(self.rider_balances(), (0, 0))
        self.assertFalse(RiderEarning.objects.exists())
        self.assertEqual(self.balance(Account.DELIVERY_PAYABLE, order), 0)
        self.assert_balanced()

    def test_whole_refund_after_pickup_pays_the_rider_and_returns_the_rest(self):
        order = self.assigned(status=DeliveryAssignment.PICKED_UP, picked_up=True)
        self.assertTrue(riders.rider_picked_up(order))
        refund = refunds.refund_order(order, source="dispute-1")
        self.assertEqual(self.rider_balances(), (900, 0))                  # the 90% net of the 10.00 fee
        self.assertEqual(self.wallet(), 7000 - 900)                        # the remainder of the fee goes back to the customer
        self.assertEqual(self.balance(Account.DELIVERY_PAYABLE, order), 0)
        self.assertEqual(self.balance(Account.PLATFORM_DELIVERY_INCOME), 0)
        self.assertEqual(refund.delivery_pesewas, 1000)                    # the refund still accounts for the whole fee
        earning = RiderEarning.objects.get(order=order)
        self.assertEqual((earning.rider_id, earning.gross_pesewas, earning.net_pesewas, earning.reserve_pesewas), (self.swift.pk, 900, 900, 0))
        self.assertEqual(earning.journal.key, f"rider-refund-{order.pk}")
        self.assertEqual(refunds.left(order).delivery, 0)
        self.assert_balanced()

    def test_a_later_release_pays_nothing_more(self):
        order = self.assigned(status=DeliveryAssignment.PICKED_UP, picked_up=True)
        refunds.refund_order(order, source="dispute-1")
        self.assertEqual(riders.credit_on_refund(order, timezone.now()), 0)
        self.assertEqual(self.rider_balances(), (900, 0))

    def test_refund_after_release_still_reverses_the_earning(self):
        order = self.assigned(status=DeliveryAssignment.CONFIRMED, picked_up=True)
        DeliveryAssignment.objects.filter(order=order).update(delivered_at=timezone.now(), confirmed_at=timezone.now())
        self.release(order)
        self.assertEqual(self.rider_balances(), (900, 100))
        refunds.refund_order(order, source="dispute-1")
        self.assertEqual(self.rider_balances(), (0, 0))
        self.assertEqual(self.wallet(), 7000)
        self.assertEqual(RiderEarning.objects.filter(order=order).count(), 1)
        self.assertIsNotNone(RiderEarning.objects.get(order=order).reversed_at)
        self.assertFalse(Journal.objects.filter(key=f"rider-refund-{order.pk}").exists())
        self.assert_balanced()

    def test_a_goods_only_partial_refund_leaves_the_delivery_fee_and_rider_untouched(self):
        order = self.assigned(status=DeliveryAssignment.PICKED_UP, picked_up=True)
        refunds.refund_order(order, 3000, source="dispute-1")
        self.assertEqual(self.wallet(), 3000)
        self.assertEqual(self.balance(Account.DELIVERY_PAYABLE, order), 1000)
        self.assertEqual(self.rider_balances(), (0, 0))
        self.assertFalse(RiderEarning.objects.exists())

    def test_credit_is_idempotent_on_retry(self):
        order = self.assigned(status=DeliveryAssignment.PICKED_UP, picked_up=True)
        first = refunds.refund_order(order, source="dispute-1")
        again = refunds.refund_order(order, source="dispute-1")
        self.assertEqual(first.pk, again.pk)
        self.assertEqual(self.rider_balances(), (900, 0))
        self.assertEqual(Journal.objects.filter(key=f"rider-refund-{order.pk}").count(), 1)
        self.assertEqual(RiderEarning.objects.count(), 1)

    def test_in_house_rider_not_credited(self):
        own = rider_helpers.rider("own@example.com", phone="+233244000003", third_party=False)
        order = self.assigned(own, status=DeliveryAssignment.PICKED_UP, picked_up=True)
        refunds.refund_order(order, source="dispute-1")
        self.assertEqual(self.wallet(), 7000)
        self.assertEqual(self.rider_balances(own), (0, 0))
        self.assertFalse(RiderEarning.objects.exists())

    @override_settings(LEDGER_ENABLED=False)
    def test_inert_while_the_ledger_is_off(self):
        order = self.assigned(status=DeliveryAssignment.PICKED_UP, picked_up=True)
        self.assertEqual(riders.credit_on_refund(order, timezone.now()), 0)
        self.assertIsNone(refunds.refund_order(order, source="dispute-1"))
