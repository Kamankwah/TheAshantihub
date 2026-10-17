"""Refunds and a third-party rider's pay (wallets Plan 5, Task 4; spec §2.2 steps 3-4 and 6, §13 W4): before release the
rider was never paid; after release a partial refund leaves them paid and a whole refund takes the earning back first
(the balance may go below zero; the reserve, or the commission once posted). Review Focus 1, 3 and 7."""
import threading
import time
from unittest import mock
from datetime import timedelta
from decimal import Decimal

from django.db import connection
from django.test import TransactionTestCase, override_settings
from django.utils import timezone

from accounts.models import BusinessOwner, Customer
from delivery.models import RiderEarning
from ledger import escrow, posting, refunds, riders
from ledger.models import Account, FulfilmentCheck
from listings.models import Category, Listing, Zone
from notifications.models import Notification
from orders.models import Order, OrderItem

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
        FulfilmentCheck.objects.create(order=order, outcome=FulfilmentCheck.MATCHES)
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

    def test_review_focus_a_whole_refund_after_release_takes_the_delivery_back_from_the_rider(self):
        order = self.delivered_order()
        self.release(order)
        refund = refunds.refund_order(order, source="dispute-1")
        self.assertTrue(refund.whole)
        self.assertEqual(self.wallet(), 7000)
        self.assertEqual(self.rider_balances(), (0, 0))
        self.assertEqual(self.balance(Account.PLATFORM_DELIVERY_INCOME), 0)
        earning = RiderEarning.objects.get(order=order)
        self.assertIsNotNone(earning.reversed_at)
        self.assertEqual(
            (earning.reversal_journal.key, earning.reversal_journal.kind), (f"order-rider-reversal-{order.pk}", "rider_earning_reversal"),
        )
        self.assertEqual(riders.post_commission(today=timezone.localdate() + timedelta(days=1)), 0)  # a reversed one is never posted
        self.assertEqual(self.balance(Account.PLATFORM_COMMISSION_INCOME), 0)
        told = Notification.objects.filter(staff=self.swift.staff, title="A delivery was taken back")   # the rider is told (S5)
        self.assertEqual(told.count(), 1)
        self.assertIn(f"Order #{order.pk} was refunded in full", told.get().body)
        self.assertIn("GH₵ 9", told.get().body)

    def test_after_the_days_commission_was_posted_ashantihub_gives_its_commission_back(self):
        order = self.delivered_order()
        FulfilmentCheck.objects.create(order=order, outcome=FulfilmentCheck.MATCHES)
        escrow.release_verified(order, now=timezone.now() - timedelta(days=1))
        self.assertEqual(riders.post_commission(today=timezone.localdate()), 1)
        self.assertEqual(self.balance(Account.PLATFORM_COMMISSION_INCOME), 100)
        refunds.refund_order(order, source="dispute-1")
        self.assertEqual(self.balance(Account.PLATFORM_COMMISSION_INCOME), 0)
        self.assertEqual(self.rider_balances(), (0, 0))
        self.assertEqual(self.balance(Account.PLATFORM_DELIVERY_INCOME), 0)
        self.assertEqual(self.wallet(), 7000)
        # The day record still names the delivery; the views show what was given back from the reversed earnings (S4).
        earning = RiderEarning.objects.get(order=order)
        self.assertEqual((earning.commission_posting.commission_pesewas, earning.reserve_pesewas, earning.reversed_at is not None), (100, 100, True))

    def test_review_focus_a_rider_who_already_withdrew_goes_below_zero(self):
        order = self.delivered_order()
        self.release(order)
        balance, _ = riders.accounts_of(self.swift)
        posting.post(key="spent", kind="test", lines=[
            posting.debit(balance, 900), posting.credit(posting.account_for(Account.WITHDRAWAL_IN_TRANSIT), 900),
        ])
        refunds.refund_order(order, source="dispute-1")
        self.assertEqual(self.rider_balances(), (-900, 0))                                    # recovered from later deliveries
        self.assertEqual(self.wallet(), 7000)
        self.assertEqual(self.balance(Account.PLATFORM_DELIVERY_INCOME), 0)                  # AshantiHub is never short

    def test_a_promo_order_refunded_whole_after_release_unwinds_the_rider_and_the_business(self):
        order = self.delivered_order(delivery="0.00", price="120.00")
        rider_helpers.waived(order, self.kofi)
        self.release(order)                                                                    # rider 1350 + 150 of the promo
        refunds.refund_order(order, source="dispute-1")
        self.assertEqual(self.rider_balances(), (0, 0))
        self.assertEqual(self.balance(Account.PLATFORM_DELIVERY_INCOME), 0)
        self.assertEqual(self.balance(Account.VENDOR_AVAILABLE, self.kofi), 0)
        self.assertEqual(self.wallet(), 12000)

    def test_a_promo_fee_comes_back_from_the_rider_when_shop_refunds_then_a_last_refund_empty_the_order(self):
        order = self.delivered_order(delivery="0.00", price="120.00")
        rider_helpers.waived(order, self.kofi)
        self.release(order)
        refunds.refund_order(order, source="dispute-1", owner_ids={self.kofi.pk})            # every item, shop-scoped: not whole
        self.assertEqual(self.rider_balances(), (1350, 150))
        self.assertIsNone(refunds.refund_order(order, source="dispute-2"))                   # nothing left: the promo goes back
        self.assertEqual(self.rider_balances(), (0, 0))
        self.assertEqual(self.balance(Account.PLATFORM_DELIVERY_INCOME), 0)
        self.assertEqual(self.balance(Account.VENDOR_AVAILABLE, self.kofi), 0)
        self.assertIsNotNone(RiderEarning.objects.get(order=order).reversed_at)

    def test_the_same_refund_twice_takes_the_delivery_back_once(self):
        order = self.delivered_order()
        self.release(order)
        refunds.refund_order(order, source="dispute-1")
        refunds.refund_order(order, source="dispute-1")
        self.assertEqual(self.rider_balances(), (0, 0))
        self.assertEqual(self.wallet(), 7000)


class ConcurrentRiderRefundTests(TransactionTestCase):
    serialized_rollback = True

    @override_settings(LEDGER_ENABLED=True)
    def test_review_focus_a_refund_racing_the_end_of_day_never_takes_the_commission_twice(self):
        customer = Customer.objects.create(full_name="Ama", phone="+233200990001", password_hash="x")
        kofi = BusinessOwner.objects.create(full_name="Kofi", login_phone="+233207990001", password_hash="x")
        listing = Listing.objects.create(
            business_owner=kofi, category=Category.objects.get(slug="shops"), zone=Zone.objects.get(name="Manhyia"),
            name="Item", description="D.", contact_phone=kofi.login_phone, price_amount=Decimal("60.00"), status=Listing.PUBLISHED,
        )
        order = Order.objects.create(
            customer=customer, status=Order.PAID, total_amount=Decimal("70.00"), discount_amount=Decimal("0.00"),
            delivery_fee=Decimal("10.00"),
        )
        OrderItem.objects.create(order=order, listing=listing, quantity=1, unit_price=listing.price_amount, line_total=listing.price_amount)
        escrow.record_order_payment(order)
        swift = rider_helpers.rider()
        rider_helpers.delivered_by(order, swift)
        FulfilmentCheck.objects.create(order=order, outcome=FulfilmentCheck.MATCHES)
        escrow.release_verified(order, now=timezone.now() - timedelta(days=1))
        work = [lambda: riders.post_commission(today=timezone.localdate()), lambda: refunds.refund_order(order, source="dispute-1")]
        errors, barrier = [], threading.Barrier(2)

        def run(job):
            try:
                barrier.wait()
                job()
            except Exception as exc:  # reported below, never swallowed
                errors.append(exc)
            finally:
                connection.close()

        threads = [threading.Thread(target=run, args=(job,)) for job in work]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=10)
            self.assertFalse(thread.is_alive(), "a racing thread hung")
        self.assertEqual(errors, [])
        # Whichever ran first, the commission is either never posted or posted and given back: never taken twice.
        self.assertEqual(posting.balance_of(Account.PLATFORM_COMMISSION_INCOME), 0)
        self.assertEqual(posting.balance_of(Account.RIDER_RESERVE, swift.staff), 0)
        self.assertEqual(posting.balance_of(Account.RIDER_BALANCE, swift.staff), 0)
        self.assertEqual(posting.balance_of(Account.PLATFORM_DELIVERY_INCOME), 0)
        self.assertEqual(posting.balance_of(Account.CUSTOMER_WALLET, customer), 7000)


@override_settings(LEDGER_ENABLED=True)
class DeterministicRiderRefundTests(TransactionTestCase):
    """A refund reversing an earning waits for the end-of-day job that holds it, then sees the posting and takes the
    commission back from platform commission income, once. Deterministic: the posting is paused inside its transaction
    (rider row and earning rows held), the refund is shown waiting in its SELECT on the earning row, then released."""

    serialized_rollback = True

    @staticmethod
    def a_session_is_waiting_in_a_select_on_the_earning_row(timeout=6.0):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            with connection.cursor() as cursor:
                cursor.execute("SELECT pg_stat_clear_snapshot()")
                cursor.execute("SELECT query FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'")
                if any(query.lstrip().upper().startswith("SELECT") and "delivery_riderearning" in query for (query,) in cursor.fetchall()):
                    return True
            time.sleep(0.05)
        return False

    def test_review_focus_the_refund_waits_for_the_posting_then_takes_the_commission_back(self):
        customer = Customer.objects.create(full_name="Ama", phone="+233200990002", password_hash="x")
        kofi = BusinessOwner.objects.create(full_name="Kofi", login_phone="+233207990002", password_hash="x")
        listing = Listing.objects.create(
            business_owner=kofi, category=Category.objects.get(slug="shops"), zone=Zone.objects.get(name="Manhyia"),
            name="Item", description="D.", contact_phone=kofi.login_phone, price_amount=Decimal("60.00"), status=Listing.PUBLISHED,
        )
        order = Order.objects.create(
            customer=customer, status=Order.PAID, total_amount=Decimal("70.00"), discount_amount=Decimal("0.00"),
            delivery_fee=Decimal("10.00"),
        )
        OrderItem.objects.create(order=order, listing=listing, quantity=1, unit_price=listing.price_amount, line_total=listing.price_amount)
        escrow.record_order_payment(order)
        swift = rider_helpers.rider()
        rider_helpers.delivered_by(order, swift)
        FulfilmentCheck.objects.create(order=order, outcome=FulfilmentCheck.MATCHES)
        escrow.release_verified(order, now=timezone.now() - timedelta(days=1))
        paused, go, errors = threading.Event(), threading.Event(), []
        real_post = posting.post

        def pausing_post(*args, **kwargs):
            if kwargs.get("kind") == "rider_commission":
                paused.set()
                go.wait(timeout=15)
            return real_post(*args, **kwargs)

        def wrap(target):
            def run():
                try:
                    target()
                except Exception as exc:  # reported below, never swallowed
                    errors.append(exc)
                finally:
                    connection.close()
            return run

        def refund():
            paused.wait(timeout=15)
            refunds.refund_order(order, source="dispute-1")

        with mock.patch.object(posting, "post", pausing_post):
            poster = threading.Thread(target=wrap(lambda: riders.post_commission(today=timezone.localdate())))
            refunder = threading.Thread(target=wrap(refund))
            poster.start()
            refunder.start()
            paused.wait(timeout=15)
            waiting = self.a_session_is_waiting_in_a_select_on_the_earning_row()
            go.set()
            for thread in (poster, refunder):
                thread.join(timeout=15)
                self.assertFalse(thread.is_alive(), "a racing thread hung")
        self.assertTrue(waiting, "the refund did not wait for the earning row held by the posting")
        self.assertEqual(errors, [])
        earning = RiderEarning.objects.get(order=order)
        self.assertIsNotNone(earning.commission_posting_id)
        self.assertIsNotNone(earning.reversed_at)
        self.assertEqual(posting.balance_of(Account.PLATFORM_COMMISSION_INCOME), 0)
        self.assertEqual(posting.balance_of(Account.RIDER_RESERVE, swift.staff), 0)
        self.assertEqual(posting.balance_of(Account.RIDER_BALANCE, swift.staff), 0)
        self.assertEqual(posting.balance_of(Account.PLATFORM_DELIVERY_INCOME), 0)
        self.assertEqual(posting.balance_of(Account.CUSTOMER_WALLET, customer), 7000)
