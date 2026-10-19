"""One canonical lock order for every write that touches an order and its delivery (Plan 7F-E Task 2): the Order row
before its DeliveryAssignment row (orders/locks.py). Before it, a rider's pickup locked the assignment row and then saved
the Order row (DeliveryAssignment.sync_order) while a whole refund locked the Order row and then the assignment row, and
Postgres broke the cycle with `deadlock detected`.

The race tests use two seams that exist both before and after the fix: thread A (the delivery write) pauses where it is
about to write the Order row (DeliveryAssignment.sync_order, or stops.reopen_for_new_rider on a re-assignment), and thread
B (the refund) pauses just after its Order lock (escrow.pay_key, read by refund_order right after it). Each waits at most
two seconds for the other, so before the fix both hold the lock the other wants; after it the refund waits for the Order
row until the delivery write has committed."""
import pathlib
import re
import threading
import time
from decimal import Decimal
from unittest import mock

from django.conf import settings
from django.db import connection
from django.test import TestCase, TransactionTestCase, override_settings
from django.urls import reverse
from rest_framework.test import APIClient

from accounts.models import BusinessOwner, Customer
from accounts.testing import make_staff, staff_token
from delivery import stops
from delivery.models import PickupStop
from ledger import escrow, posting, refunds
from ledger.models import Account, OrderRefund
from listings.models import Category, Listing, Zone
from orders.models import DeliveryAssignment, Order, OrderItem

from . import rider_helpers

PICKUP_CODE = "4821"


def paid_order(phone_suffix):
    """A paid door-to-door ledger order: one 100.00 item from Kofi's shop and a 15.00 delivery fee."""
    customer = Customer.objects.create(full_name="Ama", phone=f"+23320099{phone_suffix}", password_hash="x")
    kofi = BusinessOwner.objects.create(full_name="Kofi", login_phone=f"+23320799{phone_suffix}", password_hash="x")
    listing = Listing.objects.create(
        business_owner=kofi, category=Category.objects.get(slug="shops"), zone=Zone.objects.get(name="Manhyia"),
        name="Item", description="D.", contact_phone=kofi.login_phone, price_amount=Decimal("100.00"), status=Listing.PUBLISHED,
    )
    order = Order.objects.create(
        customer=customer, status=Order.PAID, total_amount=Decimal("115.00"), discount_amount=Decimal("0.00"),
        delivery_fee=Decimal("15.00"), delivery_method=Order.DOOR_TO_DOOR,
    )
    OrderItem.objects.create(order=order, listing=listing, quantity=1, unit_price=listing.price_amount, line_total=listing.price_amount)
    escrow.record_order_payment(order)
    return order, customer, kofi


def job(order, rider_row, kofi, *, status, stop_status):
    """The order's delivery, given to `rider_row`, with its one stop at Kofi's shop (code PICKUP_CODE)."""
    assignment = DeliveryAssignment.objects.create(
        order=order, dispatch=rider_row.staff, status=status, pickup_code=PICKUP_CODE, drop_code="7302",
    )
    PickupStop.objects.create(assignment=assignment, sequence=1, business_owner=kofi, code=PICKUP_CODE, status=stop_status)
    return assignment


class LockHelperTests(TestCase):
    def setUp(self):
        self.order, _, kofi = paid_order("1101")
        self.swift = rider_helpers.rider()
        self.assignment = job(self.order, self.swift, kofi, status=DeliveryAssignment.ACCEPTED, stop_status=PickupStop.PENDING)

    def test_assignment_lock_requires_the_order_lock_first(self):
        from orders import locks

        with self.assertRaises(locks.LockOrderError):
            locks.lock_assignment(Order.objects.get(pk=self.order.pk))
        order = locks.lock_order(self.order.pk)
        assignment = locks.lock_assignment(order)
        self.assertEqual(assignment.pk, self.assignment.pk)
        self.assertIs(assignment.order, order)
        self.assertIs(locks.lock_assignment(order).order, order)        # locking the same row twice is fine

    def test_lock_job_wrong_rider_or_missing_raises_does_not_exist(self):
        from orders import locks

        other = rider_helpers.rider("other@example.com", phone="+233244000077")
        self.assertEqual(locks.lock_job(self.assignment.pk, dispatch_id=self.swift.staff_id).pk, self.assignment.pk)
        with self.assertRaises(DeliveryAssignment.DoesNotExist):
            locks.lock_job(self.assignment.pk, dispatch_id=other.staff_id)
        with self.assertRaises(DeliveryAssignment.DoesNotExist):
            locks.lock_job(self.assignment.pk + 1000)

    def test_no_raw_assignment_row_lock_outside_locks_module(self):
        root = pathlib.Path(settings.BASE_DIR)
        pattern = re.compile(r"DeliveryAssignment.{0,120}?select_for_update", re.S)
        offenders = []
        for path in root.rglob("*.py"):
            rel = path.relative_to(root).as_posix()
            if "/tests/" in f"/{rel}" or "/migrations/" in f"/{rel}" or rel == "orders/locks.py":
                continue
            text = path.read_text(encoding="utf-8")
            if "DeliveryAssignment.objects.select_for_update" in text or pattern.search(text):
                offenders.append(rel)
        self.assertEqual(offenders, [], "lock a delivery assignment only through orders/locks.py")


@override_settings(LEDGER_ENABLED=True)
class LockOrderRaceTests(TransactionTestCase):
    """A delivery write and a whole refund on the same order, at the same moment, never deadlock."""

    serialized_rollback = True

    def race(self, write, seam_target, *, seam_attr=None):
        """Run `write` (thread A) against refunds.refund_order (thread B) with the two seams; return (errors, times)."""
        a_at_sync, b_past_order = threading.Event(), threading.Event()
        times, errors = {}, []
        threads = {}

        def a_seam(original):
            def seam(*args, **kwargs):
                if threading.current_thread() is threads.get("a") and "a_at_sync" not in times:
                    times["a_at_sync"] = time.monotonic()
                    a_at_sync.set()
                    b_past_order.wait(timeout=2)
                    result = original(*args, **kwargs)
                    times["a_done"] = time.monotonic()      # A's last Order write; it commits after this
                    return result
                return original(*args, **kwargs)
            return seam

        original_pay_key = escrow.pay_key

        def pay_key_seam(order):
            if threading.current_thread() is threads.get("b") and "b_past_order" not in times:
                times["b_past_order"] = time.monotonic()
                b_past_order.set()
                a_at_sync.wait(timeout=2)
            return original_pay_key(order)

        def run_a():
            try:
                write()
            except Exception as exc:  # reported below, never swallowed
                errors.append(exc)
            finally:
                connection.close()

        def run_b():
            try:
                a_at_sync.wait(timeout=15)       # start once A holds its rows and is about to write the Order row
                refunds.refund_order(Order.objects.get(pk=self.order.pk), source="dispute-1")
            except Exception as exc:
                errors.append(exc)
            finally:
                connection.close()

        if seam_attr is None:
            original = DeliveryAssignment.sync_order
            a_patch = mock.patch.object(DeliveryAssignment, "sync_order", autospec=True, side_effect=a_seam(original))
        else:
            original = getattr(seam_target, seam_attr)
            a_patch = mock.patch.object(seam_target, seam_attr, side_effect=a_seam(original))
        with a_patch, mock.patch.object(escrow, "pay_key", side_effect=pay_key_seam):
            threads["a"], threads["b"] = threading.Thread(target=run_a), threading.Thread(target=run_b)
            threads["a"].start()
            threads["b"].start()
            for thread in threads.values():
                thread.join(timeout=15)
                self.assertFalse(thread.is_alive(), "a racing thread hung")
        return errors, times

    def assert_refund_waited_and_paid_the_rider(self, errors, times):
        self.assertEqual(errors, [])
        self.assertLess(times["a_done"], times["b_past_order"])    # the refund passed the Order lock only after the pickup
        self.assertEqual(posting.balance_of(Account.CUSTOMER_WALLET, self.customer), 10000)     # the fee is the rider's
        self.assertEqual(posting.balance_of(Account.RIDER_BALANCE, self.swift.staff), 1350)
        self.assertEqual(posting.balance_of(Account.RIDER_RESERVE, self.swift.staff), 150)
        self.assertEqual(OrderRefund.objects.get(order=self.order).delivery_kept_pesewas, 1500)

    def test_rider_pickup_and_whole_refund_do_not_deadlock(self):
        self.order, self.customer, kofi = paid_order("1201")
        self.swift = rider_helpers.rider()
        assignment = job(self.order, self.swift, kofi, status=DeliveryAssignment.AT_PICKUP, stop_status=PickupStop.ARRIVED)
        url = reverse("delivery-rider-pickup", args=[assignment.pk])
        token = staff_token(self.swift.staff)

        def pickup():
            client = APIClient()
            client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
            response = client.post(url, {"code": PICKUP_CODE, "lat": 6.69, "lng": -1.62, "accuracy_m": 10}, format="json")
            if response.status_code != 200:
                raise AssertionError(f"pickup answered {response.status_code}: {response.content[:300]}")

        errors, times = self.race(pickup, None)
        self.assert_refund_waited_and_paid_the_rider(errors, times)

    def test_legacy_dispatch_pickup_and_whole_refund_do_not_deadlock(self):
        self.order, self.customer, kofi = paid_order("1301")
        self.swift = rider_helpers.rider()
        assignment = job(self.order, self.swift, kofi, status=DeliveryAssignment.ACCEPTED, stop_status=PickupStop.PENDING)
        url = reverse("delivery-pickup", args=[assignment.pk])
        token = staff_token(self.swift.staff)

        def pickup():
            client = APIClient()
            client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
            response = client.post(url, {"code": PICKUP_CODE}, format="json")
            if response.status_code != 200:
                raise AssertionError(f"pickup answered {response.status_code}: {response.content[:300]}")

        errors, times = self.race(pickup, None)
        self.assert_refund_waited_and_paid_the_rider(errors, times)

    def test_reassign_and_whole_refund_do_not_deadlock(self):
        """The Delivery Manager gives a failed job to another rider (orders AssignDispatchView: services.assign, then the
        Order's delivery status) while a whole refund starts. Nothing was picked up, so the customer gets everything back."""
        self.order, self.customer, kofi = paid_order("1401")
        self.swift = rider_helpers.rider()
        second = rider_helpers.rider("second@example.com", phone="+233244000088")
        job(self.order, self.swift, kofi, status=DeliveryAssignment.FAILED, stop_status=PickupStop.PENDING)
        # The re-assignment writes the Order row only when its delivery status changes (a failed job leaves it where it was).
        Order.objects.filter(pk=self.order.pk).update(delivery_status=Order.OUT_FOR_DELIVERY)
        manager = make_staff("delivery_manager", "dm@example.com")
        url = reverse("order-assign-dispatch", args=[self.order.pk])
        token = staff_token(manager)

        def reassign():
            client = APIClient()
            client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
            response = client.post(url, {"dispatch": second.staff_id}, format="json")
            if response.status_code != 200:
                raise AssertionError(f"assign answered {response.status_code}: {response.content[:300]}")

        errors, times = self.race(reassign, stops, seam_attr="reopen_for_new_rider")
        self.assertEqual(errors, [])
        self.assertLess(times["a_done"], times["b_past_order"])
        self.assertEqual(DeliveryAssignment.objects.get(order=self.order).dispatch_id, second.staff_id)
        self.assertEqual(posting.balance_of(Account.CUSTOMER_WALLET, self.customer), 11500)     # no pickup: the fee goes back
        self.assertEqual(posting.balance_of(Account.RIDER_BALANCE, self.swift.staff), 0)
        self.assertEqual(OrderRefund.objects.get(order=self.order).delivery_kept_pesewas, 0)
