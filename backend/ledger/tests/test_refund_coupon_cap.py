"""A refund never exceeds what the customer actually paid, net of the coupon, minus the delivery fee kept for the rider
(Plan 7F-E Task 1, ruling R1). Figures in cedis: items I, fee F, coupon D, customer paid N = I + F - D."""
from decimal import Decimal

from django.test import override_settings
from django.utils import timezone

from delivery.models import RiderEarning
from ledger import posting, refunds
from ledger.models import Account, Journal, JournalLine, OrderRefund
from orders.models import DeliveryAssignment, Order
from payments.models import CheckoutSession

from . import rider_helpers
from .test_refunds import RefundBase


@override_settings(LEDGER_ENABLED=True)
class RefundCouponCapTests(RefundBase):
    def setUp(self):
        super().setUp()
        self.kofi = self.owner("Kofi")
        self.swift = rider_helpers.rider()

    def door(self, *, price="100.00", delivery="15.00", discount="10.00", picked_up=False, lines=None):
        order = self.paid(lines or [(self.listing(self.kofi, price), 1)], delivery=delivery, discount=discount)
        order.delivery_method = Order.DOOR_TO_DOOR
        order.save(update_fields=["delivery_method"])
        DeliveryAssignment.objects.create(
            order=order, dispatch=self.swift.staff,
            status=DeliveryAssignment.PICKED_UP if picked_up else DeliveryAssignment.ASSIGNED,
            picked_up_at=timezone.now() if picked_up else None,
        )
        return order

    def rider_balances(self):
        return posting.balance_of(Account.RIDER_BALANCE, self.swift.staff), posting.balance_of(Account.RIDER_RESERVE, self.swift.staff)

    def assert_balanced(self):
        for journal in Journal.objects.all():
            lines = JournalLine.objects.filter(journal=journal)
            debit = sum(l.amount for l in lines if l.side == JournalLine.DEBIT)
            credit = sum(l.amount for l in lines if l.side == JournalLine.CREDIT)
            self.assertEqual(debit, credit, journal.key)

    def processing(self, order, fee):
        CheckoutSession.objects.create(
            customer=self.customer, kind=CheckoutSession.ORDER_CHECKOUT, amount=order.total_amount + Decimal(fee),
            processing_fee=Decimal(fee), purpose="Order", status=CheckoutSession.SUCCESS, metadata={"order_id": order.pk},
        )

    def test_partial_refund_cannot_take_the_money_the_fee_needs(self):
        order = self.door()                                                  # N 105, no pickup yet
        for owner_ids in (None, {self.kofi.pk}):
            with self.assertRaises(refunds.RefundError) as caught:
                refunds.refund_order(order, 10000, source="dispute-1", owner_ids=owner_ids)
            self.assertEqual(
                caught.exception.message,
                "Only GH₵ 90.00 of this order can be refunded before the whole order (the delivery fee is kept back).",
            )
        self.assertFalse(OrderRefund.objects.exists())
        refund = refunds.refund_order(order, 9000, source="dispute-1")
        self.assertFalse(refund.whole)
        self.assertEqual(self.wallet(), 9000)

    def test_partial_then_whole_before_pickup_returns_the_fee_and_coupon(self):
        order = self.door()
        refunds.refund_order(order, 9000, source="dispute-1")
        last = refunds.refund_order(order, source="dispute-2")
        self.assertTrue(last.whole)
        self.assertEqual((last.amount_pesewas, last.delivery_pesewas, last.subsidy_pesewas), (1500, 1500, 1000))
        self.assertEqual(self.wallet(), 10500)                                # everything the customer paid
        self.assertEqual(self.balance(Account.PLATFORM_PROMO_SUBSIDY), 0)      # the 10.00 coupon went back
        self.assertEqual(self.balance(Account.VENDOR_PENDING, self.kofi), 0)
        self.assertEqual(sum(OrderRefund.objects.filter(order=order).values_list("items_pesewas", flat=True)), 10000)
        self.assertEqual(self.balance(Account.DELIVERY_PAYABLE, order), 0)
        self.assert_balanced()

    def test_whole_refund_after_pickup_gives_paid_minus_fee(self):
        order = self.door(picked_up=True)
        refund = refunds.refund_order(order, source="dispute-1")
        self.assertEqual(self.wallet(), 9000)
        self.assertEqual((refund.amount_pesewas, refund.delivery_kept_pesewas, refund.wallet_pesewas), (9000, 1500, 9000))
        self.assertEqual(self.rider_balances(), (1350, 150))
        self.assertEqual(self.balance(Account.PLATFORM_PROMO_SUBSIDY), 0)
        self.assertEqual(self.balance(Account.DELIVERY_PAYABLE, order), 0)
        self.assert_balanced()

    def test_displayed_amount_is_a_whole_refund(self):
        order = self.door(picked_up=True)
        self.assertEqual(refunds.refundable(order), 9000)
        refund = refunds.refund_order(order, 9000, source="dispute-1")
        self.assertTrue(refund.whole)
        order.refresh_from_db()
        self.assertEqual(order.status, Order.CANCELLED)
        self.assertEqual(refunds.refundable(order), 0)

    def test_coupon_larger_than_items_whole_refund_ashantihub_covers_gap_only(self):
        order = self.door(price="20.00", discount="30.00", picked_up=True)   # N 5.00
        self.assertEqual(refunds.left(order).shortfall, 1000)
        self.assertEqual(refunds.left(order).customer, 0)
        refund = refunds.refund_order(order, source="dispute-1")
        self.assertEqual((refund.amount_pesewas, refund.wallet_pesewas, refund.delivery_kept_pesewas), (0, 0, 1500))
        self.assertEqual(self.wallet(), 0)
        self.assertEqual(self.rider_balances(), (1350, 150))
        lines = {
            (line.account.kind, line.side): line.amount
            for line in JournalLine.objects.filter(journal=refund.journal).select_related("account")
        }
        self.assertEqual(lines, {
            (Account.VENDOR_PENDING, JournalLine.DEBIT): 2000, (Account.PLATFORM_PROMO_SUBSIDY, JournalLine.CREDIT): 2000,
        })
        self.assertEqual(self.balance(Account.PLATFORM_PROMO_SUBSIDY), 1000)  # 30.00 out at payment, 20.00 back: 10.00 net
        self.assertEqual(self.balance(Account.DELIVERY_PAYABLE, order), 0)
        self.assertEqual(self.balance(Account.PLATFORM_DELIVERY_INCOME), 0)
        self.assertEqual(self.balance(Account.VENDOR_PENDING, self.kofi), 0)
        self.assert_balanced()

    def test_coupon_larger_than_items_partial_refund_is_refused(self):
        order = self.door(price="20.00", discount="30.00", picked_up=True)
        self.assertEqual(refunds.left(order).partial, 0)
        for amount in (1, 500, 2000):
            with self.assertRaises(refunds.RefundError):
                refunds.refund_order(order, amount, source="dispute-1")
            with self.assertRaises(refunds.RefundError):
                refunds.refund_order(order, amount, source="dispute-1", owner_ids={self.kofi.pk})
        with self.assertRaises(refunds.RefundError):
            refunds.refund_order(order, source="dispute-1", owner_ids={self.kofi.pk})
        self.assertFalse(OrderRefund.objects.exists())

    def test_processing_refund_is_not_eaten_by_the_kept_fee(self):
        order = self.door(picked_up=True)                                      # N 105
        self.processing(order, "1.20")
        refund = refunds.refund_order(order, source="dispute-1", refund_processing=True)
        self.assertEqual(self.wallet(), 9120)
        self.assertEqual(refund.wallet_pesewas, 9120)
        self.assert_balanced()

    def test_processing_refund_reaches_the_customer_even_when_the_coupon_left_less_than_the_fee(self):
        order = self.door(price="20.00", discount="30.00", picked_up=True)    # N 5.00
        self.processing(order, "0.50")
        refund = refunds.refund_order(order, source="dispute-1", refund_processing=True)
        self.assertEqual((refund.amount_pesewas, refund.processing_pesewas, refund.wallet_pesewas), (0, 50, 50))
        self.assertEqual(self.wallet(), 50)
        self.assertEqual(self.balance(Account.PLATFORM_PROMO_SUBSIDY), 1000)
        self.assert_balanced()

    def test_scoped_refund_with_no_amount_takes_the_capped_room(self):
        esi = self.owner("Esi")
        order = self.door(
            discount="50.00", lines=[(self.listing(self.kofi, "60.00"), 1), (self.listing(esi, "40.00"), 1)],
        )                                                                      # N 65.00, partial room 50.00
        refund = refunds.refund_order(order, source="dispute-1", owner_ids={self.kofi.pk})
        self.assertEqual((refund.whole, refund.amount_pesewas, refund.items_pesewas), (False, 5000, 5000))
        self.assertEqual(self.balance(Account.VENDOR_PENDING, self.kofi), 1000)
        self.assertEqual(self.balance(Account.VENDOR_PENDING, esi), 4000)
        self.assertEqual(self.wallet(), 5000)
        last = refunds.refund_order(order, source="dispute-2")
        self.assertTrue(last.whole)
        self.assertEqual(self.wallet(), 6500)                                  # never more than the 65.00 paid
        self.assertEqual(self.balance(Account.PLATFORM_PROMO_SUBSIDY), 0)
        self.assert_balanced()

    def test_no_coupon_behaviour_unchanged(self):
        order = self.door(discount="0.00")
        self.assertEqual(refunds.left(order).partial, 10000)
        with self.assertRaises(refunds.RefundError):
            refunds.refund_order(order, 10001, source="dispute-1")
        self.assertEqual(refunds.refund_order(order, source="dispute-1").amount_pesewas, 11500)
        self.assertEqual(self.wallet(), 11500)
        after = self.door(discount="0.00", picked_up=True)
        self.assertEqual(refunds.left(after).partial, 10000)
        refunds.refund_order(after, source="dispute-2")
        self.assertEqual(self.wallet(), 11500 + 10000)
        self.assert_balanced()

    def test_check_agrees_with_refund_order(self):
        cases = [
            (dict(), 10000, None), (dict(), 10000, "kofi"), (dict(), 9000, None), (dict(), 10500, None),
            (dict(picked_up=True), 9000, None), (dict(picked_up=True), 9001, None), (dict(picked_up=True), 8000, "kofi"),
            (dict(price="20.00", discount="30.00", picked_up=True), 1, None),
            (dict(price="20.00", discount="30.00", picked_up=True), 500, "kofi"),
            (dict(discount="0.00"), 10001, None), (dict(discount="0.00"), 11500, None), (dict(discount="0.00"), 10000, "kofi"),
            (dict(discount="0.00", picked_up=True), 11500, None), (dict(discount="0.00", picked_up=True), 10000, None),
        ]
        for n, (shape, amount, scope) in enumerate(cases):
            order = self.door(**shape)
            owner_ids = {self.kofi.pk} if scope else None
            try:
                refunds.check(order, amount, owner_ids=owner_ids)
                checked = None
            except refunds.RefundError as exc:
                checked = exc.message
            try:
                refunds.refund_order(order, amount, source=f"dispute-{n}", owner_ids=owner_ids)
                given = None
            except refunds.RefundError as exc:
                given = exc.message
            self.assertEqual(checked, given, (shape, amount, scope))

    def test_refundable_is_none_while_ledger_off(self):
        order = self.door(picked_up=True)
        with self.settings(LEDGER_ENABLED=False):
            self.assertIsNone(refunds.refundable(order))
        unpaid = self.order([(self.listing(self.kofi, "10.00"), 1)])
        self.assertIsNone(refunds.refundable(unpaid))
        self.assertFalse(RiderEarning.objects.exists())
