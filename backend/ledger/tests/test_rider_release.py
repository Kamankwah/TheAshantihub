"""A third-party rider is paid at release (wallets Plan 5, Task 2; spec §1 row 4, §2.2 step 2(c), §3.3, §4.1): the delivery
fee AshantiHub took for the order, 90% to their balance and 10% held in the reserve, at the rate in force when the order
was paid. Review Focus 2 and 4."""
import threading
import time
from datetime import timedelta
from decimal import Decimal

from django.db import connection, transaction
from django.test import SimpleTestCase, TransactionTestCase, override_settings
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import BusinessOwner, Customer
from accounts.testing import make_staff, staff_token
from approvals import services as approvals
from delivery import services as delivery_services
from delivery.models import Rider, RiderEarning
from ledger import escrow, posting, refunds, riders, settings_store, verification
from ledger.models import Account, FulfilmentCheck, Journal, MoneySetting
from listings.models import Category, Listing, Zone
from orders import locks
from orders.models import DeliveryAssignment, Order, OrderItem

from . import rider_helpers
from .test_refunds import RefundBase


@override_settings(LEDGER_ENABLED=True)
class RiderReleaseTests(RefundBase):
    def setUp(self):
        super().setUp()
        self.kofi = self.owner("Kofi")

    def delivered_order(self, by, *, delivery="10.00", price="60.00", at=None):
        order = self.paid([(self.listing(self.kofi, price), 1)], delivery=delivery)
        rider_helpers.delivered_by(order, by, at=at)
        return order

    def test_review_focus_a_third_party_delivery_pays_the_rider_90_and_holds_10(self):
        swift = rider_helpers.rider()
        order = self.delivered_order(swift)
        self.release(order)
        self.assertEqual(self.balance(Account.RIDER_BALANCE, swift.staff), 900)
        self.assertEqual(self.balance(Account.RIDER_RESERVE, swift.staff), 100)
        self.assertEqual(self.balance(Account.PLATFORM_DELIVERY_INCOME), 0)                   # it all went to the rider
        self.assertEqual(self.balance(Account.VENDOR_AVAILABLE, self.kofi), 5940)             # the vendor's side is unchanged
        earning = RiderEarning.objects.get(order=order)
        self.assertEqual(
            (earning.rider, earning.gross_pesewas, earning.commission_bp, earning.reserve_pesewas, earning.net_pesewas),
            (swift, 1000, 1000, 100, 900),
        )
        self.assertEqual((earning.journal.key, earning.journal.kind), (f"order-rider-{order.pk}", "rider_earning"))
        self.assertEqual(earning.earned_on, timezone.localdate(earning.earned_at))

    def test_an_ashantihub_riders_delivery_fee_stays_with_ashantihub(self):
        own = rider_helpers.rider(third_party=False)
        order = self.delivered_order(own)
        self.release(order)
        self.assertFalse(RiderEarning.objects.exists())
        self.assertFalse(Account.objects.filter(kind__in=[Account.RIDER_BALANCE, Account.RIDER_RESERVE]).exists())  # no wallet opened
        self.assertEqual(self.balance(Account.PLATFORM_DELIVERY_INCOME), 1000)

    def test_review_focus_a_delivery_made_before_the_rider_became_third_party_stays_with_ashantihub(self):
        swift = rider_helpers.rider(since=timezone.now())
        order = self.delivered_order(swift, at=timezone.now() - timedelta(hours=1))
        self.release(order)
        self.assertFalse(RiderEarning.objects.exists())
        self.assertEqual(self.balance(Account.PLATFORM_DELIVERY_INCOME), 1000)

    def test_a_store_pickup_or_a_failed_delivery_pays_no_rider(self):
        swift = rider_helpers.rider()
        pickup = self.paid([(self.listing(self.kofi, "60.00"), 1)])                             # store pickup: no rider
        self.release(pickup)
        failed = self.paid([(self.listing(self.kofi, "60.00"), 1)], delivery="10.00")
        rider_helpers.delivered_by(failed, swift, status=DeliveryAssignment.FAILED)
        self.release(failed)
        self.assertFalse(RiderEarning.objects.exists())
        self.assertFalse(Account.objects.filter(kind__in=[Account.RIDER_BALANCE, Account.RIDER_RESERVE]).exists())   # no wallet opened
        self.assertEqual(self.balance(Account.PLATFORM_DELIVERY_INCOME), 1000)

    def test_review_focus_the_rate_is_the_one_in_force_when_the_order_was_paid(self):
        swift = rider_helpers.rider()
        before = self.paid([(self.listing(self.kofi, "60.00"), 1)], delivery="10.00")          # paid at 10%
        paid_at = Journal.objects.get(key=f"order-pay-{before.pk}").created_at
        MoneySetting.objects.create(key="rider_commission_bp", value=2000, effective_from=paid_at + timedelta(microseconds=1))
        after = self.paid([(self.listing(self.kofi, "60.00"), 1)], delivery="10.00")           # paid at 20%
        for order in (before, after):
            rider_helpers.delivered_by(order, swift)
            self.release(order)                                                                  # both released at 20% in force
        self.assertEqual(RiderEarning.objects.get(order=before).reserve_pesewas, 100)
        self.assertEqual(RiderEarning.objects.get(order=after).reserve_pesewas, 200)
        self.assertEqual(self.balance(Account.RIDER_RESERVE, swift.staff), 300)
        self.assertEqual(self.balance(Account.RIDER_BALANCE, swift.staff), 1700)

    def test_a_free_delivery_promo_fee_paid_by_the_business_goes_to_the_rider(self):
        swift = rider_helpers.rider()
        order = self.delivered_order(swift, delivery="0.00", price="120.00")
        rider_helpers.waived(order, self.kofi)
        self.release(order)
        self.assertEqual(self.balance(Account.VENDOR_AVAILABLE, self.kofi), 10000)            # 12000 - 500 fee - 1500 promo
        self.assertEqual(self.balance(Account.RIDER_BALANCE, swift.staff), 1350)
        self.assertEqual(self.balance(Account.RIDER_RESERVE, swift.staff), 150)
        self.assertEqual(self.balance(Account.PLATFORM_DELIVERY_INCOME), 0)

    def test_a_redispatched_delivery_pays_the_rider_who_delivered(self):
        """Plan 7F-E Task 6 (Ruling R3): a re-dispatched delivery goes to AshantiHub's own riders only, so the rider who
        delivers it is in-house and the fee stays platform delivery income; the failed first attempt earns nothing. (Before
        R3 a third-party second rider was paid here; assign now refuses one, see test_rider_reassignment.)"""
        first = rider_helpers.rider()
        second = rider_helpers.rider("rider2@example.com", name="Yaw Boateng", phone="+233244000003", third_party=False)
        order = self.delivered_order(first)
        DeliveryAssignment.objects.filter(order=order).update(status=DeliveryAssignment.FAILED, delivered_at=None, failed_at=timezone.now())
        manager = make_staff("delivery_manager", "dm@example.com")
        with transaction.atomic():                                  # callers lock the order row first (orders/locks.py)
            delivery_services.assign(locks.lock_order(order.pk), second.staff, manager, mode=DeliveryAssignment.MANUAL)   # the same row, a new rider
        DeliveryAssignment.objects.filter(order=order).update(
            status=DeliveryAssignment.CONFIRMED, delivered_at=timezone.now(), confirmed_at=timezone.now(), failed_at=None,
        )
        self.release(order)
        self.assertFalse(RiderEarning.objects.filter(order=order).exists())
        self.assertFalse(Account.objects.filter(kind=Account.RIDER_BALANCE, owner_id=str(first.staff.pk)).exists())   # checked before self.balance(), which opens the account
        self.assertFalse(Account.objects.filter(kind=Account.RIDER_BALANCE, owner_id=str(second.staff.pk)).exists())  # in-house: no wallet
        self.assertEqual(self.balance(Account.PLATFORM_DELIVERY_INCOME), 1000)                  # the fee stays platform delivery income

    def test_a_skipped_shops_refund_still_pays_the_rider_the_whole_fee(self):
        swift, esi = rider_helpers.rider(), self.owner("Esi")
        order = self.paid([(self.listing(self.kofi, "60.00"), 1), (self.listing(esi, "40.00"), 1)], delivery="10.00")
        rider_helpers.delivered_by(order, swift)
        refunds.refund_order(order, 4000, source="skipped-shop-1", owner_ids={esi.pk})          # Esi's shop could not hand over
        self.release(order)
        self.assertEqual(self.balance(Account.RIDER_BALANCE, swift.staff), 900)                 # one order, one fee, never reduced
        self.assertEqual(self.balance(Account.RIDER_RESERVE, swift.staff), 100)

    def test_a_fee_the_customer_paid_and_a_promo_fee_on_the_same_order_are_one_gross(self):
        swift = rider_helpers.rider()
        order = self.delivered_order(swift, delivery="10.00", price="120.00")
        rider_helpers.waived(order, self.kofi)                                                  # 15.00 more, charged to the business
        self.release(order)
        earning = RiderEarning.objects.get(order=order)
        self.assertEqual((earning.gross_pesewas, earning.reserve_pesewas, earning.net_pesewas), (2500, 250, 2250))
        self.assertEqual(self.balance(Account.PLATFORM_DELIVERY_INCOME), 0)

    def test_an_order_paid_before_the_ledger_was_on_pays_no_rider(self):
        swift = rider_helpers.rider()
        order = self.order([(self.listing(self.kofi, "60.00"), 1)], delivery="10.00")           # no order-pay journal
        rider_helpers.delivered_by(order, swift)
        FulfilmentCheck.objects.update_or_create(order=order, defaults=dict(outcome=FulfilmentCheck.MATCHES))
        self.assertIsNone(escrow.release_verified(order))
        self.assertFalse(RiderEarning.objects.exists())
        self.assertFalse(Account.objects.filter(kind__in=[Account.RIDER_BALANCE, Account.RIDER_RESERVE]).exists())

    def test_a_delivery_with_no_rider_row_or_no_rider_at_all_pays_no_one(self):
        ghost = rider_helpers.rider("ghost@example.com", name="Kwame Ghost", phone="+233244000009")
        order = self.delivered_order(ghost)
        Rider.objects.filter(pk=ghost.pk).delete()                                              # dispatch staff, no Rider row
        self.assertIsNone(riders.third_party_rider(order))
        none = self.delivered_order(rider_helpers.rider())
        DeliveryAssignment.objects.filter(order=none).update(dispatch=None)                    # nobody recorded
        self.assertIsNone(riders.third_party_rider(none))
        self.assertIsNone(riders.rider_for_release(none))
        self.release(order)
        self.release(none)
        self.assertFalse(RiderEarning.objects.exists())
        self.assertEqual(self.balance(Account.PLATFORM_DELIVERY_INCOME), 2000)

    def test_an_ashantihub_riders_release_does_not_lock_the_rider_row(self):
        own = rider_helpers.rider(third_party=False)
        order = self.delivered_order(own)
        with CaptureQueriesContext(connection) as queries, transaction.atomic():
            self.assertIsNone(riders.rider_for_release(order))
        self.assertFalse([q for q in queries.captured_queries if "FOR UPDATE" in q["sql"] and "delivery_rider" in q["sql"]])
        third = self.delivered_order(rider_helpers.rider("rider3@example.com", name="Yaw Mensah", phone="+233244000004"))
        with CaptureQueriesContext(connection) as queries, transaction.atomic():
            self.assertIsNotNone(riders.rider_for_release(third))
        self.assertTrue([q for q in queries.captured_queries if "FOR UPDATE" in q["sql"] and "delivery_rider" in q["sql"]])

    def test_releasing_twice_pays_the_rider_once(self):
        swift = rider_helpers.rider()
        order = self.delivered_order(swift)
        self.release(order)
        self.assertIsNone(escrow.release_verified(order))
        self.assertIsNone(riders.credit_delivery(order, swift))
        self.assertEqual(RiderEarning.objects.filter(order=order).count(), 1)
        self.assertEqual(self.balance(Account.RIDER_BALANCE, swift.staff), 900)

    def test_supports_matches_call_pays_the_rider(self):
        swift = rider_helpers.rider()
        order = self.delivered_order(swift)
        verification.record(order, make_staff("support", "support@example.com"), FulfilmentCheck.MATCHES)
        self.assertEqual(posting.balance_of(Account.RIDER_BALANCE, swift.staff), 900)
        self.assertEqual(posting.balance_of(Account.RIDER_RESERVE, swift.staff), 100)

    def test_the_commission_rate_changes_only_through_the_money_setting_approval(self):
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(make_staff('accountant', 'acc@example.com'))}")
        response = client.post("/api/ledger/settings/", {"key": "rider_commission_bp", "value": 1500}, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(settings_store.current("rider_commission_bp"), 1000)                   # waits for a Super Admin
        approvals.approve(response.json()["approval_id"], make_staff("super_admin", "sa@example.com"))
        self.assertEqual(settings_store.current("rider_commission_bp"), 1500)


@override_settings(LEDGER_ENABLED=True)
class ConcurrentReleaseSwitchBackTests(TransactionTestCase):
    """The reason release takes the rider row lock (R3): a release and the switch back to AshantiHub's own, at the same
    moment, never leave an AshantiHub rider holding a wallet's money. Both tests are deterministic: one side holds a lock
    while the other is shown waiting, so removing the lock from either side fails them (checked by removing it)."""

    serialized_rollback = True

    def setUp(self):
        customer = Customer.objects.create(full_name="Ama", phone="+233200990001", password_hash="x")
        owner = BusinessOwner.objects.create(full_name="Kofi", login_phone="+233207990001", password_hash="x")
        listing = Listing.objects.create(
            business_owner=owner, category=Category.objects.get(slug="shops"), zone=Zone.objects.get(name="Manhyia"),
            name="Kente", description="D.", contact_phone=owner.login_phone, price_amount=Decimal("60.00"), status=Listing.PUBLISHED,
        )
        self.order = Order.objects.create(customer=customer, status=Order.PAID, total_amount=Decimal("70.00"), delivery_fee=Decimal("10.00"))
        OrderItem.objects.create(order=self.order, listing=listing, quantity=1, unit_price=Decimal("60.00"), line_total=Decimal("60.00"))
        self.swift = rider_helpers.rider()
        self.support, self.super_admin = make_staff("support", "support@example.com"), make_staff("super_admin", "sa@example.com")
        manager = make_staff("delivery_manager", "dm@example.com")
        # The manager stages the switch back while nothing is open yet (no delivery exists), so it can be proposed.
        self.request = approvals.submit(
            manager, "delivery.rider_employment", title="Back to AshantiHub",
            payload={"rider_id": self.swift.pk, "employment": Rider.ASHANTIHUB, "company_name": ""}, target=self.swift,
        )
        escrow.record_order_payment(self.order)
        rider_helpers.delivered_by(self.order, self.swift)

    def run_threads(self, *targets):
        errors = []

        def wrap(target):
            def run():
                try:
                    target()
                except Exception as exc:                                  # noqa: BLE001 - collected and asserted by the test
                    errors.append(exc)
                finally:
                    connection.close()
            return run

        threads = [threading.Thread(target=wrap(target)) for target in targets]
        for thread in threads:
            thread.start()
        return threads, errors

    def finish(self, threads):
        for thread in threads:
            thread.join(timeout=15)
            self.assertFalse(thread.is_alive(), "a racing thread hung")

    @staticmethod
    def a_session_is_waiting_for_the_rider_row(timeout=6.0):
        """Poll Postgres until a session waits on a row lock *in its SELECT ... FOR UPDATE on the rider* (the release, held
        back at the start by riders.third_party_rider(lock=True)), or `timeout`. A session waiting in its COMMIT does not
        count: that is only the deferred foreign key from the earning to the rider, which waits for a FOR UPDATE holder
        anyway but only after the release has already taken its account locks (the deadlock the early lock prevents)."""
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            with connection.cursor() as cursor:
                cursor.execute("SELECT pg_stat_clear_snapshot()")          # inside an open transaction the view would stay stale
                cursor.execute("SELECT query FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'")
                # pg_stat_activity cuts long statements, so match the start: a waiting SELECT on the rider, not a waiting COMMIT
                if any(query.lstrip().upper().startswith("SELECT") and "delivery_rider" in query for (query,) in cursor.fetchall()):
                    return True
            time.sleep(0.05)
        return False

    def assert_paid_and_still_third_party(self):
        self.swift.refresh_from_db()
        self.assertEqual(self.swift.employment, Rider.THIRD_PARTY)
        self.assertEqual(posting.balance_of(Account.RIDER_BALANCE, self.swift.staff), 900)
        self.assertEqual(posting.balance_of(Account.RIDER_RESERVE, self.swift.staff), 100)
        self.assertEqual(RiderEarning.objects.filter(order=self.order).count(), 1)

    def test_review_focus_a_release_waits_for_the_rider_row_and_pays_the_rider(self):
        """Something else holds the rider row (a switch back mid-apply): the release waits, then pays; nothing is paid early."""
        holding, may_finish = threading.Event(), threading.Event()

        def hold_the_rider_row():
            with transaction.atomic():
                Rider.objects.select_for_update(of=("self",)).get(pk=self.swift.pk)
                holding.set()
                may_finish.wait(timeout=15)

        def release():
            holding.wait(timeout=15)
            verification.record(self.order, self.support, FulfilmentCheck.MATCHES)

        (holder, releaser), errors = self.run_threads(hold_the_rider_row, release)
        holding.wait(timeout=15)
        self.assertTrue(self.a_session_is_waiting_for_the_rider_row(), "the release did not wait for the rider row up front")
        self.assertTrue(releaser.is_alive())
        self.assertFalse(RiderEarning.objects.exists())
        may_finish.set()
        self.finish([holder, releaser])
        self.assertEqual(errors, [])
        self.assert_paid_and_still_third_party()

    def test_review_focus_a_switch_back_that_has_read_the_balance_cannot_close_a_wallet_a_release_is_paying(self):
        """employment.apply holds the rider row and has read the (still empty) balance when the release arrives: the release
        must wait for the apply to end, so the apply's decision and the money agree."""
        from unittest import mock

        from delivery import employment

        real_unreleased = employment.unreleased_deliveries
        paused, waited = threading.Event(), []

        def pause_after_the_balance_read(rider):
            paused.set()
            # The release arrives now. With the row lock it waits here (a session waits on a lock: carry on); without it,
            # it is paid during this pause and the wait times out.
            waited.append(self.a_session_is_waiting_for_the_rider_row())
            return real_unreleased(rider)

        def switch_back():
            with mock.patch.object(employment, "unreleased_deliveries", pause_after_the_balance_read):
                try:
                    with transaction.atomic():
                        employment.apply(self.request)
                except approvals.ApprovalError:
                    pass                    # refused: the delivery's money is not released yet (the right answer)

        def release():
            paused.wait(timeout=15)
            verification.record(self.order, self.support, FulfilmentCheck.MATCHES)

        threads, errors = self.run_threads(switch_back, release)
        self.finish(threads)
        self.assertEqual(errors, [])
        self.assertEqual(waited, [True], "the release did not wait for the rider row while the switch back held it")
        self.assert_paid_and_still_third_party()


class RiderReleaseLedgerOffTests(RefundBase):
    def test_with_the_ledger_off_no_rider_is_paid(self):
        swift = rider_helpers.rider()
        order = self.order([(self.listing(self.owner("Kofi"), "60.00"), 1)], delivery="10.00")
        rider_helpers.delivered_by(order, swift)
        FulfilmentCheck.objects.update_or_create(order=order, defaults=dict(outcome=FulfilmentCheck.MATCHES))
        self.assertIsNone(escrow.release_verified(order))
        self.assertFalse(RiderEarning.objects.exists())
        self.assertFalse(Account.objects.filter(kind=Account.RIDER_BALANCE).exists())


class SplitTests(SimpleTestCase):
    def test_the_reserve_is_rounded_half_up_and_the_net_is_the_rest(self):
        self.assertEqual(riders.split(1000, 1000), (100, 900))
        self.assertEqual(riders.split(1005, 1000), (101, 904))          # 100.5 -> 101
        self.assertEqual(riders.split(1004, 1000), (100, 904))          # 100.4 -> 100
        self.assertEqual(riders.split(1, 1000), (0, 1))
        self.assertEqual(riders.split(1000, 0), (0, 1000))
        self.assertEqual(riders.split(1000, 10000), (1000, 0))
