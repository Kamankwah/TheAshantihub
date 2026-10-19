from datetime import timedelta

from django.core.cache import cache
from django.db import connection
from django.test import override_settings
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.testing import make_staff, staff_token
from disputes.models import Dispute
from ledger import escrow
from ledger.models import Account, FulfilmentCheck, Journal, OrderFeeSnapshot
from orders.models import DeliveryAssignment, Order

from .test_order_payment import OrderPaymentBase


class VerificationBase(OrderPaymentBase):
    def setUp(self):
        super().setUp()
        cache.clear()
        self.client = APIClient()
        self.support = make_staff("support", "esi@example.com")
        self.accountant = make_staff("accountant", "kofi@example.com")

    def as_staff(self, staff, sudo=True):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(staff, sudo=sudo)}")

    def paid_order(self, *, delivered=True, customer_confirmed=False, price="120.00", delivery="10.00"):
        """A paid door-to-door order (items 120.00 + delivery 10.00) with its payment recorded."""
        self.kofi = self.owner("Kofi")
        order = self.order([(self.listing(self.kofi, price), 1)], delivery=delivery)
        order.delivery_method = Order.DOOR_TO_DOOR
        order.save(update_fields=["delivery_method"])
        escrow.record_order_payment(order)
        if delivered:
            DeliveryAssignment.objects.create(
                order=order, status=DeliveryAssignment.DELIVERED, delivered_at=timezone.now() - timedelta(hours=1),
            )
        if customer_confirmed:
            DeliveryAssignment.objects.filter(order=order).update(status=DeliveryAssignment.CONFIRMED, confirmed_at=timezone.now())
        return order

    def verify(self, order, outcome, **extra):
        return self.client.post(f"/api/ledger/orders/{order.pk}/verification/", {"outcome": outcome, **extra}, format="json")


@override_settings(LEDGER_ENABLED=True)
class RecordVerificationTests(VerificationBase):
    def test_a_positive_call_releases_at_once_in_the_owners_order(self):
        order = self.paid_order(customer_confirmed=True)
        self.as_staff(self.support)
        response = self.verify(order, "matches")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertTrue(response.json()["released"])
        self.assertEqual(self.balance(Account.VENDOR_PENDING, self.kofi), 0)
        self.assertEqual(self.balance(Account.VENDOR_AVAILABLE, self.kofi), 11500)          # 120.00 - GHS 5.00 fee
        self.assertEqual(self.balance(Account.PLATFORM_FEE_INCOME), 500)
        self.assertEqual(self.balance(Account.DELIVERY_PAYABLE, order), 0)
        self.assertEqual(self.balance(Account.PLATFORM_DELIVERY_INCOME), 1000)              # company rider: delivery is platform income
        self.assertTrue(OrderFeeSnapshot.objects.get(order=order).released_at)
        kinds = [line.account.kind for line in Journal.objects.get(key=f"order-release-{order.pk}").lines.order_by("id")]
        self.assertLess(kinds.index(Account.PLATFORM_FEE_INCOME), kinds.index(Account.VENDOR_AVAILABLE))

    def test_nothing_moves_until_the_goods_have_reached_the_customer(self):
        order = self.paid_order(delivered=False)
        self.as_staff(self.support)
        self.assertEqual(self.verify(order, "matches").status_code, 409)
        self.assertEqual(self.balance(Account.VENDOR_PENDING, self.kofi), 12000)

    def test_the_customers_receipt_can_be_confirmed_on_the_call(self):
        order = self.paid_order(customer_confirmed=False)
        self.as_staff(self.support)
        refused = self.verify(order, "matches")
        self.assertEqual(refused.status_code, 409)
        self.assertIn("confirmation of receipt", refused.json()["detail"])
        ok = self.verify(order, "matches", customer_confirmed_by_phone=True)
        self.assertEqual(ok.status_code, 200, ok.content)
        self.assertIsNotNone(FulfilmentCheck.objects.get(order=order).phone_confirmed_at)
        self.assertEqual(self.balance(Account.VENDOR_AVAILABLE, self.kofi), 11500)

    def test_a_mismatch_raises_a_dispute_due_within_72_hours_of_purchase_and_releases_nothing(self):
        order = self.paid_order(customer_confirmed=True)
        self.as_staff(self.support)
        self.assertEqual(self.verify(order, "does_not_match").status_code, 400)             # a note is required
        response = self.verify(order, "does_not_match", note="Customer received a different colour")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertFalse(response.json()["released"])
        order.refresh_from_db()
        dispute = Dispute.objects.get(order=order)
        self.assertEqual((dispute.status, dispute.raised_by_id, dispute.logged_by_id), (Dispute.OPEN, self.customer.pk, self.support.pk))
        self.assertEqual(dispute.answer_due_at, order.placed_at + timedelta(hours=72))
        self.assertEqual(self.balance(Account.VENDOR_PENDING, self.kofi), 12000)

    def test_a_second_mismatch_note_does_not_open_a_second_dispute(self):
        order = self.paid_order(customer_confirmed=True)
        self.as_staff(self.support)
        self.verify(order, "does_not_match", note="Wrong size")
        self.verify(order, "does_not_match", note="Still wrong")
        self.assertEqual(Dispute.objects.filter(order=order).count(), 1)

    def test_unreachable_is_recorded_and_releases_nothing(self):
        order = self.paid_order(customer_confirmed=True)
        self.as_staff(self.support)
        response = self.verify(order, "unreachable", note="Rang three times")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(FulfilmentCheck.objects.get(order=order).outcome, "unreachable")
        self.assertEqual(self.balance(Account.VENDOR_PENDING, self.kofi), 12000)
        self.assertFalse(Dispute.objects.filter(order=order).exists())

    def test_review_focus_an_open_dispute_blocks_a_positive_result_until_it_is_final(self):
        order = self.paid_order(customer_confirmed=True)
        self.as_staff(self.support)
        self.verify(order, "does_not_match", note="Wrong item")
        self.assertEqual(self.verify(order, "matches").status_code, 409)
        for final in Dispute.FINAL_STATUSES:                                                 # resolved and rejected both end it
            Dispute.objects.filter(order=order).update(status=final)
            self.assertFalse(escrow.has_open_dispute(order), final)
        Dispute.objects.filter(order=order).update(status=Dispute.REJECTED)
        self.assertEqual(self.verify(order, "matches").status_code, 200)
        self.assertEqual(self.balance(Account.VENDOR_AVAILABLE, self.kofi), 11500)

    def test_a_released_order_cannot_be_verified_again(self):
        order = self.paid_order(customer_confirmed=True)
        self.as_staff(self.support)
        self.verify(order, "matches")
        self.assertEqual(self.verify(order, "matches").status_code, 409)
        self.assertEqual(Journal.objects.filter(key=f"order-release-{order.pk}").count(), 1)
        self.assertEqual(self.balance(Account.VENDOR_AVAILABLE, self.kofi), 11500)

    def test_review_focus_release_uses_the_snapshot_not_the_rules_now(self):
        from ledger.models import FeeBand, FeeRuleSet

        order = self.paid_order(customer_confirmed=True)
        newer = FeeRuleSet.objects.create(category="product", effective_from=timezone.now())
        FeeBand.objects.create(rule_set=newer, lower_pesewas=0, upper_pesewas=None, percent_bp=5000)      # 50%!
        self.as_staff(self.support)
        self.verify(order, "matches")
        self.assertEqual(self.balance(Account.PLATFORM_FEE_INCOME), 500)

    def test_the_result_is_recorded_but_nothing_moves_while_the_ledger_is_off(self):
        order = self.paid_order(customer_confirmed=True)
        self.as_staff(self.support)
        with override_settings(LEDGER_ENABLED=False):
            response = self.verify(order, "matches")
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["released"])
        self.assertEqual(self.balance(Account.VENDOR_PENDING, self.kofi), 12000)

    def test_only_support_and_super_admin_may_verify(self):
        order = self.paid_order(customer_confirmed=True)
        self.as_staff(self.accountant)
        self.assertEqual(self.verify(order, "matches").status_code, 403)

    def test_an_unknown_outcome_is_a_400(self):
        order = self.paid_order(customer_confirmed=True)
        self.as_staff(self.support)
        self.assertEqual(self.verify(order, "maybe").status_code, 400)


@override_settings(LEDGER_ENABLED=True)
class AwaitingListTests(VerificationBase):
    def get(self):
        return self.client.get("/api/ledger/orders/awaiting-verification/")

    def test_lists_delivered_unverified_orders_with_what_to_check_on_the_call(self):
        order = self.paid_order(customer_confirmed=True)
        self.as_staff(self.support)
        rows = self.get().json()["results"]
        self.assertEqual([r["order_id"] for r in rows], [order.pk])
        row = rows[0]
        self.assertEqual(row["customer_phone"], "+233200990001")
        self.assertEqual(len(row["items"]), 1)
        self.assertEqual(row["items"][0]["quantity"], 1)
        self.assertTrue(row["customer_confirmed"])
        self.assertFalse(row["overdue"])

    def test_hides_undelivered_verified_and_released_orders(self):
        undelivered = self.paid_order(delivered=False)
        released = self.paid_order(customer_confirmed=True)
        self.as_staff(self.support)
        self.verify(released, "matches")
        ids = [r["order_id"] for r in self.get().json()["results"]]
        self.assertNotIn(undelivered.pk, ids)
        self.assertNotIn(released.pk, ids)

    def test_an_order_past_72_hours_from_purchase_is_flagged_overdue(self):
        order = self.paid_order(customer_confirmed=True)
        Order.objects.filter(pk=order.pk).update(placed_at=timezone.now() - timedelta(hours=73))
        self.as_staff(self.support)
        self.assertTrue(self.get().json()["results"][0]["overdue"])

    def test_an_order_with_a_mismatch_stays_on_the_list_with_its_note(self):
        order = self.paid_order(customer_confirmed=True)
        self.as_staff(self.support)
        self.verify(order, "does_not_match", note="Wrong colour")
        row = self.get().json()["results"][0]
        self.assertEqual((row["outcome"], row["outcome_note"]), ("does_not_match", "Wrong colour"))

    def test_support_only(self):
        self.as_staff(self.accountant)
        self.assertEqual(self.get().status_code, 403)


@override_settings(LEDGER_ENABLED=True)
class ReleaseEdgeCaseTests(VerificationBase):
    def _deliver(self, order):
        order.delivery_method = Order.DOOR_TO_DOOR
        order.save(update_fields=["delivery_method"])
        DeliveryAssignment.objects.create(
            order=order, status=DeliveryAssignment.CONFIRMED, delivered_at=timezone.now(), confirmed_at=timezone.now(),
        )

    def test_a_zero_value_vendor_does_not_block_the_other_vendor(self):
        kofi, ama = self.owner("Kofi"), self.owner("Ama")
        order = self.order([(self.listing(kofi, "120.00"), 1), (self.listing(ama, "0.00"), 1)], delivery="10.00")
        escrow.record_order_payment(order)
        self._deliver(order)
        self.as_staff(self.support)
        response = self.verify(order, "matches")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertTrue(response.json()["released"])
        self.assertEqual(self.balance(Account.VENDOR_PENDING, kofi), 0)
        self.assertEqual(self.balance(Account.VENDOR_AVAILABLE, kofi), 11500)
        self.assertEqual(self.balance(Account.DELIVERY_PAYABLE, order), 0)

    def test_a_zero_value_vendor_alone_with_a_delivery_fee_posts_only_the_delivery(self):
        ama = self.owner("Ama")
        order = self.order([(self.listing(ama, "0.00"), 1)], delivery="10.00")
        escrow.record_order_payment(order)
        self._deliver(order)
        self.as_staff(self.support)
        response = self.verify(order, "matches")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(self.balance(Account.PLATFORM_DELIVERY_INCOME), 1000)
        self.assertEqual(self.balance(Account.DELIVERY_PAYABLE, order), 0)
        self.assertEqual(self.balance(Account.VENDOR_AVAILABLE, ama), 0)

    def test_a_flat_fee_above_the_base_is_capped_at_the_base(self):
        from ledger.models import FeeBand, FeeRuleSet

        rules = FeeRuleSet.objects.create(category="product", effective_from=timezone.now() - timedelta(minutes=1))
        FeeBand.objects.create(rule_set=rules, lower_pesewas=0, upper_pesewas=None, flat_pesewas=500)
        kofi = self.owner("Kofi")
        order = self.order([(self.listing(kofi, "3.00"), 1)])
        escrow.record_order_payment(order)
        snap = OrderFeeSnapshot.objects.get(order=order)
        self.assertEqual((snap.computed_pesewas, snap.charged_pesewas), (500, 300))
        self._deliver(order)
        self.as_staff(self.support)
        self.assertEqual(self.verify(order, "matches").status_code, 200)
        self.assertEqual(self.balance(Account.VENDOR_AVAILABLE, kofi), 0)
        self.assertEqual(self.balance(Account.PLATFORM_FEE_INCOME), 300)
        self.assertEqual(self.balance(Account.VENDOR_PENDING, kofi), 0)

    def test_a_vendor_at_the_lifetime_cap_pays_no_fee(self):
        from ledger.models import MoneySetting

        MoneySetting.objects.create(key="fee_cap_pesewas", value=500, effective_from=timezone.now() - timedelta(days=1))
        kofi = self.owner("Kofi")
        first = self.order([(self.listing(kofi, "120.00"), 1)])
        escrow.record_order_payment(first)
        second = self.order([(self.listing(kofi, "120.00"), 1)])
        escrow.record_order_payment(second)
        self._deliver(second)
        self.as_staff(self.support)
        self.assertEqual(self.verify(second, "matches").status_code, 200)
        self.assertEqual(self.balance(Account.VENDOR_AVAILABLE, kofi), 12000)
        self.assertEqual(self.balance(Account.PLATFORM_FEE_INCOME), 0)

    def test_an_order_with_no_delivery_fee_releases(self):
        kofi = self.owner("Kofi")
        order = self.order([(self.listing(kofi, "120.00"), 1)])
        escrow.record_order_payment(order)
        self._deliver(order)
        self.as_staff(self.support)
        self.assertEqual(self.verify(order, "matches").status_code, 200)
        self.assertEqual(self.balance(Account.VENDOR_AVAILABLE, kofi), 11500)

    def test_two_fee_categories_for_one_vendor_release_together(self):
        from listings.models import Category

        service = Category.objects.filter(kind="service").first()
        kofi = self.owner("Kofi")
        product = self.listing(kofi, "120.00")
        other = self.listing(kofi, "50.00")
        other.category = service
        other.save()
        order = self.order([(product, 1), (other, 1)])
        escrow.record_order_payment(order)
        self.assertEqual(OrderFeeSnapshot.objects.filter(order=order).count(), 2)
        self._deliver(order)
        self.as_staff(self.support)
        self.assertEqual(self.verify(order, "matches").status_code, 200)
        self.assertEqual(self.balance(Account.VENDOR_PENDING, kofi), 0)
        fee = sum(OrderFeeSnapshot.objects.filter(order=order).values_list("charged_pesewas", flat=True))
        self.assertEqual(self.balance(Account.VENDOR_AVAILABLE, kofi), 17000 - fee)

    def test_a_super_admin_can_verify(self):
        order = self.paid_order(customer_confirmed=True)
        self.as_staff(make_staff("super_admin", "boss@example.com"))
        self.assertEqual(self.verify(order, "matches").status_code, 200)


@override_settings(LEDGER_ENABLED=True)
class StrandedReleaseTests(VerificationBase):
    def test_matches_recorded_while_the_ledger_was_off_stays_listed_and_can_be_released(self):
        order = self.paid_order(customer_confirmed=True)
        self.as_staff(self.support)
        with override_settings(LEDGER_ENABLED=False):
            self.assertFalse(self.verify(order, "matches").json()["released"])
        row = self.client.get("/api/ledger/orders/awaiting-verification/").json()["results"][0]
        self.assertEqual((row["order_id"], row["outcome"], row["released"]), (order.pk, "matches", False))
        self.assertTrue(self.verify(order, "matches").json()["released"])
        self.assertEqual(self.client.get("/api/ledger/orders/awaiting-verification/").json()["results"], [])

    def test_a_dispute_appearing_between_the_check_and_the_release_is_a_409_and_not_recorded(self):
        from unittest import mock

        order = self.paid_order(customer_confirmed=True)
        self.as_staff(self.support)
        calls = {"n": 0}

        def flaky(o):
            calls["n"] += 1
            return calls["n"] > 1  # false for record's check, true inside release_verified

        with mock.patch.object(escrow, "has_open_dispute", side_effect=flaky):
            response = self.verify(order, "matches")
        self.assertEqual(response.status_code, 409)
        self.assertFalse(FulfilmentCheck.objects.filter(order=order, outcome="matches").exists())
        self.assertEqual(self.balance(Account.VENDOR_PENDING, self.kofi), 12000)


@override_settings(LEDGER_ENABLED=True)
class ReviewFixTests(VerificationBase):
    def test_a_note_that_is_not_text_is_a_400_and_nothing_is_recorded(self):
        order = self.paid_order(customer_confirmed=True)
        self.as_staff(self.support)
        for note in (5, [1], {"a": 1}, True):
            response = self.verify(order, "unreachable", note=note)
            self.assertEqual(response.status_code, 400, (note, response.content))
        self.assertFalse(FulfilmentCheck.objects.filter(order=order, outcome=FulfilmentCheck.UNREACHABLE).exists())
        self.assertEqual(self.verify(order, "unreachable", note=None).status_code, 200)

    def test_a_non_boolean_phone_confirmation_counts_as_false(self):
        order = self.paid_order(customer_confirmed=False)
        self.as_staff(self.support)
        for value in ("true", 1, [True]):
            response = self.verify(order, "matches", customer_confirmed_by_phone=value)
            self.assertEqual(response.status_code, 409, (value, response.content))

    def test_release_does_not_lock_the_vendors_business_owner_row(self):
        order = self.paid_order(customer_confirmed=True)
        self.as_staff(self.support)
        check = FulfilmentCheck.objects.create(order=order, outcome=FulfilmentCheck.MATCHES)
        self.assertTrue(check.pk)
        with CaptureQueriesContext(connection) as queries:
            self.assertIsNotNone(escrow.release_verified(order))
        locking = [q["sql"] for q in queries if "FOR UPDATE" in q["sql"] and "ledger_orderfeesnapshot" in q["sql"]]
        self.assertTrue(locking)
        for sql in locking:
            self.assertIn('FOR UPDATE OF "ledger_orderfeesnapshot"', sql)
            self.assertNotIn('OF "accounts_businessowner"', sql)
