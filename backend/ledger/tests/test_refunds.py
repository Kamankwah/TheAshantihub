"""Refunds into the customer's wallet (wallets plan 3a, Task 5). Review Focus 3 (a line refunded twice, or more than was
paid) and 4 (partial-refund fee rounding)."""
from decimal import Decimal

from django.test import SimpleTestCase, override_settings

from ledger import escrow, fees, posting, refunds
from ledger.models import Account, FulfilmentCheck, Journal, OrderFeeSnapshot, OrderRefund
from payments.models import CheckoutSession

from .test_order_payment import OrderPaymentBase


class RefundBase(OrderPaymentBase):
    def paid(self, lines, *, delivery=None, discount="0.00"):
        order = self.order(lines, delivery=delivery, discount=discount)
        escrow.record_order_payment(order)
        return order

    def release(self, order):
        FulfilmentCheck.objects.update_or_create(order=order, defaults=dict(outcome=FulfilmentCheck.MATCHES))
        journal = escrow.release_verified(order)
        self.assertIsNotNone(journal)
        return journal

    def wallet(self):
        return posting.balance_of(Account.CUSTOMER_WALLET, self.customer)

    def snap(self, order, owner):
        return OrderFeeSnapshot.objects.get(order=order, business_owner=owner)


@override_settings(LEDGER_ENABLED=True)
class RefundTests(RefundBase):
    def test_a_whole_refund_before_release_returns_everything_and_frees_the_cap(self):
        kofi = self.owner("Kofi")
        order = self.paid([(self.listing(kofi, "60.00"), 2)], delivery="10.00")          # items 120.00 + delivery 10.00
        refund = refunds.refund_order(order, source="cancel")
        self.assertTrue(refund.whole)
        self.assertEqual((refund.amount_pesewas, refund.items_pesewas, refund.delivery_pesewas), (13000, 12000, 1000))
        self.assertEqual(refund.journal.key, f"order-refund-{order.pk}-cancel")
        self.assertEqual(self.wallet(), 13000)
        self.assertEqual(self.balance(Account.VENDOR_PENDING, kofi), 0)
        self.assertEqual(self.balance(Account.DELIVERY_PAYABLE, order), 0)
        snap = self.snap(order, kofi)
        self.assertEqual((snap.refunded_base_pesewas, snap.refunded_fee_pesewas), (12000, 500))
        self.assertIsNotNone(snap.reversed_at)
        self.assertEqual(fees.charged_to_date(kofi), 0)

    def test_a_partial_refund_is_shared_by_what_is_left_of_each_line(self):
        kofi, esi = self.owner("Kofi"), self.owner("Esi")
        order = self.paid([(self.listing(kofi, "60.00"), 1), (self.listing(esi, "600.00"), 1)])   # bases 6000 and 60000
        refund = refunds.refund_order(order, 3300, source="dispute-1")
        self.assertFalse(refund.whole)
        self.assertEqual(self.wallet(), 3300)
        self.assertEqual(self.balance(Account.VENDOR_PENDING, kofi), 5700)                # 300 of Kofi's 6000
        self.assertEqual(self.balance(Account.VENDOR_PENDING, esi), 57000)                # 3000 of Esi's 60000
        kofi_snap, esi_snap = self.snap(order, kofi), self.snap(order, esi)
        self.assertEqual((kofi_snap.refunded_base_pesewas, kofi_snap.refunded_fee_pesewas), (300, 3))     # fee 60 x 300/6000
        self.assertEqual((esi_snap.refunded_base_pesewas, esi_snap.refunded_fee_pesewas), (3000, 30))    # fee 600 x 3000/60000
        self.assertIsNone(esi_snap.reversed_at)
        self.assertEqual(fees.charged_to_date(esi), 570)

    def test_review_focus_fee_returned_in_parts_adds_up_to_the_fee_taken(self):
        kofi = self.owner("Kofi")
        order = self.paid([(self.listing(kofi, "100.00"), 1)])                           # GH₵ 5.00 flat fee
        self.release(order)
        self.assertEqual(self.balance(Account.VENDOR_AVAILABLE, kofi), 9500)
        returned = []
        for source, amount in (("dispute-1", 3333), ("dispute-2", 3333), ("dispute-3", 3334)):
            refunds.refund_order(order, amount, source=source)
            returned.append(self.snap(order, kofi).refunded_fee_pesewas)
        self.assertEqual(returned, [167, 333, 500])                                         # 1.67 + 1.66 + 1.67
        self.assertEqual(self.balance(Account.PLATFORM_FEE_INCOME), 0)
        self.assertEqual(self.balance(Account.VENDOR_AVAILABLE, kofi), 0)
        self.assertEqual(self.wallet(), 10000)
        self.assertIsNotNone(self.snap(order, kofi).reversed_at)

    def test_a_refund_after_release_may_drive_available_below_zero(self):
        kofi = self.owner("Kofi")
        order = self.paid([(self.listing(kofi, "60.00"), 2)], delivery="10.00")
        self.release(order)                                                                   # Available 11500, delivery income 1000
        available = posting.account_for(Account.VENDOR_AVAILABLE, kofi)
        posting.post(key="spent", kind="test", lines=[
            posting.debit(available, 11000), posting.credit(posting.account_for(Account.WITHDRAWAL_IN_TRANSIT), 11000),
        ])
        refunds.refund_order(order, source="dispute-9")                                      # whole: 130.00 back
        self.assertEqual(self.wallet(), 13000)
        self.assertEqual(self.balance(Account.VENDOR_AVAILABLE, kofi), -11000)               # 500 - 12000 + 500 fee returned
        self.assertEqual(self.balance(Account.PLATFORM_FEE_INCOME), 0)
        self.assertEqual(self.balance(Account.PLATFORM_DELIVERY_INCOME), 0)

    def test_a_coupon_goes_back_to_ashantihub_only_when_the_order_is_emptied(self):
        kofi = self.owner("Kofi")
        order = self.paid([(self.listing(kofi, "100.00"), 1)], discount="10.00")            # the customer paid 90.00
        refunds.refund_order(order, 4500, source="dispute-1")
        self.assertEqual((self.wallet(), self.balance(Account.PLATFORM_PROMO_SUBSIDY)), (4500, 1000))
        last = refunds.refund_order(order, source="cancel")
        self.assertEqual((last.whole, last.amount_pesewas, last.subsidy_pesewas, last.items_pesewas), (True, 4500, 1000, 5500))
        self.assertEqual((self.wallet(), self.balance(Account.PLATFORM_PROMO_SUBSIDY)), (9000, 0))   # never more than was paid
        self.assertEqual(self.balance(Account.VENDOR_PENDING, kofi), 0)
        with self.assertRaises(refunds.RefundError):
            refunds.refund_order(order, 1, source="dispute-2")

    def test_review_focus_more_than_is_left_is_refused_and_writes_nothing(self):
        kofi = self.owner("Kofi")
        order = self.paid([(self.listing(kofi, "60.00"), 1)])
        with self.assertRaises(refunds.RefundError) as caught:
            refunds.refund_order(order, 6001, source="dispute-1")
        self.assertEqual(caught.exception.message, "Only GH₵ 60.00 of this order can still be refunded.")
        for bad in (0, -1, True, 1.5):
            with self.assertRaises(refunds.RefundError, msg=repr(bad)):
                refunds.refund_order(order, bad, source="dispute-1")
        self.assertFalse(OrderRefund.objects.exists())
        self.assertEqual(self.wallet(), 0)
        self.assertEqual(self.balance(Account.VENDOR_PENDING, kofi), 6000)

    def test_the_delivery_fee_comes_back_only_with_the_whole_order(self):
        kofi = self.owner("Kofi")
        order = self.paid([(self.listing(kofi, "60.00"), 1)], delivery="10.00")              # paid 70.00
        with self.assertRaises(refunds.RefundError) as caught:
            refunds.refund_order(order, 6500, source="dispute-1")
        self.assertEqual(
            caught.exception.message,
            "The items left are worth GH₵ 60.00. The delivery fee comes back only with the whole order: GH₵ 70.00.",
        )
        refund = refunds.refund_order(order, 7000, source="dispute-1")
        self.assertEqual((refund.whole, refund.delivery_pesewas), (True, 1000))
        self.assertEqual(self.balance(Account.DELIVERY_PAYABLE, order), 0)

    def test_review_focus_the_same_source_refunds_once(self):
        kofi = self.owner("Kofi")
        order = self.paid([(self.listing(kofi, "60.00"), 1)])
        first = refunds.refund_order(order, 2000, source="dispute-1")
        again = refunds.refund_order(order, 2000, source="dispute-1")
        self.assertEqual(first.pk, again.pk)
        self.assertEqual(self.wallet(), 2000)
        self.assertEqual(Journal.objects.filter(kind="order_refund").count(), 1)

    def test_review_focus_a_scoped_refund_takes_only_that_vendors_lines(self):
        kofi, esi = self.owner("Kofi"), self.owner("Esi")
        order = self.paid([(self.listing(kofi, "60.00"), 1), (self.listing(esi, "40.00"), 1)], delivery="10.00")
        with self.assertRaises(refunds.RefundError):
            refunds.refund_order(order, 4001, source="dispute-1", owner_ids={esi.pk})          # more than Esi's lines
        refund = refunds.refund_order(order, 4000, source="dispute-1", owner_ids={esi.pk})
        self.assertEqual((refund.whole, refund.delivery_pesewas), (False, 0))
        self.assertEqual(self.balance(Account.VENDOR_PENDING, esi), 0)
        self.assertEqual(self.balance(Account.VENDOR_PENDING, kofi), 6000)
        self.assertEqual(self.balance(Account.DELIVERY_PAYABLE, order), 1000)                # never the delivery fee
        self.assertIsNotNone(self.snap(order, esi).reversed_at)
        self.assertEqual(self.wallet(), 4000)

    def test_the_processing_charge_comes_back_only_when_asked_and_only_once(self):
        kofi = self.owner("Kofi")
        order = self.paid([(self.listing(kofi, "60.00"), 1)])
        CheckoutSession.objects.create(
            customer=self.customer, kind=CheckoutSession.ORDER_CHECKOUT, amount=Decimal("61.20"), processing_fee=Decimal("1.20"),
            purpose="Order", status=CheckoutSession.SUCCESS, metadata={"order_id": order.pk},
        )
        refunds.refund_order(order, 1000, source="dispute-1")
        self.assertEqual(self.wallet(), 1000)
        refund = refunds.refund_order(order, 1000, source="dispute-2", refund_processing=True)
        self.assertEqual(refund.processing_pesewas, 20)                                       # 10.00 of 60.00 of the 1.20 charge
        self.assertEqual(self.wallet(), 2020)
        self.assertEqual(self.balance(Account.PROVIDER_FEES), 20)                             # AshantiHub bears its share
        refunds.refund_order(order, source="cancel", refund_processing=True)
        self.assertEqual(self.wallet(), 6120)                                                  # the rest, and what is left of the charge (1.00)


class RefundGateTests(RefundBase):
    def test_nothing_happens_while_the_ledger_is_off(self):
        kofi = self.owner("Kofi")
        order = self.order([(self.listing(kofi, "60.00"), 1)])
        self.assertIsNone(refunds.refund_order(order, source="cancel"))
        self.assertFalse(Account.objects.exists())

    @override_settings(LEDGER_ENABLED=True)
    def test_an_order_paid_before_the_ledger_was_on_is_left_alone(self):
        kofi = self.owner("Kofi")
        order = self.order([(self.listing(kofi, "60.00"), 1)])                                # no payment journal
        self.assertIsNone(refunds.refund_order(order, source="cancel"))
        self.assertFalse(OrderRefund.objects.exists())

    @override_settings(LEDGER_ENABLED=True)
    def test_an_order_already_refunded_whole_gives_nothing_more(self):
        kofi = self.owner("Kofi")
        order = self.paid([(self.listing(kofi, "60.00"), 1)])
        refunds.refund_order(order, source="dispute-1")
        self.assertIsNone(refunds.refund_order(order, source="cancel"))
        self.assertEqual(OrderRefund.objects.count(), 1)
        self.assertEqual(self.wallet(), 6000)


class AllocateTests(SimpleTestCase):
    def test_largest_remainders_ties_to_the_earlier_and_never_beyond_a_room(self):
        self.assertEqual(refunds.allocate(100, [("a", 50), ("b", 50), ("c", 50)]), {"a": 34, "b": 33, "c": 33})
        self.assertEqual(refunds.allocate(5, [("a", 0), ("b", 5)]), {"a": 0, "b": 5})
        self.assertEqual(refunds.allocate(0, [("a", 7)]), {"a": 0})
