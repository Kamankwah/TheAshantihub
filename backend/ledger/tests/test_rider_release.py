"""A third-party rider is paid at release (wallets Plan 5, Task 2; spec §1 row 4, §2.2 step 2(c), §3.3, §4.1): the delivery
fee AshantiHub took for the order, 90% to their balance and 10% held in the reserve, at the rate in force when the order
was paid. Review Focus 2 and 4."""
import threading
from datetime import timedelta
from decimal import Decimal

from django.db import connection
from django.test import SimpleTestCase, TransactionTestCase, override_settings
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
        first, second = rider_helpers.rider(), rider_helpers.rider("rider2@example.com", name="Yaw Boateng", phone="+233244000003")
        order = self.delivered_order(first)
        DeliveryAssignment.objects.filter(order=order).update(status=DeliveryAssignment.FAILED, delivered_at=None, failed_at=timezone.now())
        manager = make_staff("delivery_manager", "dm@example.com")
        delivery_services.assign(order, second.staff, manager, mode=DeliveryAssignment.MANUAL)   # the same row, a new rider
        DeliveryAssignment.objects.filter(order=order).update(
            status=DeliveryAssignment.CONFIRMED, delivered_at=timezone.now(), confirmed_at=timezone.now(), failed_at=None,
        )
        self.release(order)
        self.assertEqual(RiderEarning.objects.get(order=order).rider, second)
        self.assertEqual(self.balance(Account.RIDER_BALANCE, second.staff), 900)
        self.assertFalse(Account.objects.filter(kind=Account.RIDER_BALANCE, owner_id=str(first.staff.pk)).exists())   # checked before self.balance(), which opens the account
        self.assertEqual(self.balance(Account.RIDER_BALANCE, first.staff), 0)                    # the failed attempt earned nothing

    def test_a_skipped_shops_refund_still_pays_the_rider_the_whole_fee(self):
        swift, esi = rider_helpers.rider(), self.owner("Esi")
        order = self.paid([(self.listing(self.kofi, "60.00"), 1), (self.listing(esi, "40.00"), 1)], delivery="10.00")
        rider_helpers.delivered_by(order, swift)
        refunds.refund_order(order, 4000, source="skipped-shop-1", owner_ids={esi.pk})          # Esi's shop could not hand over
        self.release(order)
        self.assertEqual(self.balance(Account.RIDER_BALANCE, swift.staff), 900)                 # one order, one fee, never reduced
        self.assertEqual(self.balance(Account.RIDER_RESERVE, swift.staff), 100)

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
    moment, never leave an AshantiHub rider holding a wallet's money."""

    serialized_rollback = True

    def test_review_focus_a_release_and_a_switch_back_never_close_a_paid_wallet(self):
        customer = Customer.objects.create(full_name="Ama", phone="+233200990001", password_hash="x")
        owner = BusinessOwner.objects.create(full_name="Kofi", login_phone="+233207990001", password_hash="x")
        listing = Listing.objects.create(
            business_owner=owner, category=Category.objects.get(slug="shops"), zone=Zone.objects.get(name="Manhyia"),
            name="Kente", description="D.", contact_phone=owner.login_phone, price_amount=Decimal("60.00"), status=Listing.PUBLISHED,
        )
        order = Order.objects.create(customer=customer, status=Order.PAID, total_amount=Decimal("70.00"), delivery_fee=Decimal("10.00"))
        OrderItem.objects.create(order=order, listing=listing, quantity=1, unit_price=Decimal("60.00"), line_total=Decimal("60.00"))
        swift = rider_helpers.rider()
        support, super_admin = make_staff("support", "support@example.com"), make_staff("super_admin", "sa@example.com")
        manager = make_staff("delivery_manager", "dm@example.com")
        # The manager stages the switch back while nothing is open yet (no delivery exists), so it can be proposed. Then the
        # order is paid and delivered, and the Super Admin's approval races Support's call.
        request = approvals.submit(
            manager, "delivery.rider_employment", title="Back to AshantiHub",
            payload={"rider_id": swift.pk, "employment": Rider.ASHANTIHUB, "company_name": ""}, target=swift,
        )
        escrow.record_order_payment(order)
        rider_helpers.delivered_by(order, swift)
        errors, barrier = [], threading.Barrier(2)

        def release():
            try:
                barrier.wait()
                verification.record(order, support, FulfilmentCheck.MATCHES)
            except Exception as exc:                                     # noqa: BLE001 - collected and asserted below
                errors.append(exc)
            finally:
                connection.close()

        def switch_back():
            try:
                barrier.wait()
                approvals.approve(request.pk, super_admin)
            except approvals.ApprovalError as exc:
                errors.append(exc)
            finally:
                connection.close()

        threads = [threading.Thread(target=release), threading.Thread(target=switch_back)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=15)
            self.assertFalse(thread.is_alive(), "a racing thread hung")
        self.assertTrue(all(isinstance(error, approvals.ApprovalError) for error in errors), errors)   # only a refusal, never a crash
        swift.refresh_from_db()
        balance = posting.balance_of(Account.RIDER_BALANCE, swift.staff)
        if swift.employment == Rider.THIRD_PARTY:                        # the switch back was refused: the rider was paid
            self.assertEqual((len(errors), balance, posting.balance_of(Account.RIDER_RESERVE, swift.staff)), (1, 900, 100))
        else:                                                            # it applied first: AshantiHub's own, so no wallet, fee kept
            self.assertEqual((balance, RiderEarning.objects.count()), (0, 0))
            self.assertEqual(posting.balance_of(Account.PLATFORM_DELIVERY_INCOME), 1000)
        self.assertFalse(swift.employment == Rider.ASHANTIHUB and balance != 0)


class RiderReleaseLedgerOffTests(RefundBase):
    def test_with_the_ledger_off_no_rider_is_paid(self):
        swift = rider_helpers.rider()
        order = self.order([(self.listing(self.owner("Kofi"), "60.00"), 1)], delivery="10.00")
        rider_helpers.delivered_by(order, swift)
        FulfilmentCheck.objects.create(order=order, outcome=FulfilmentCheck.MATCHES)
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
