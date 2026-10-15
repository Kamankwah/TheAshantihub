from datetime import timedelta

from django.core.cache import cache
from django.test import override_settings
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

    def as_staff(self, staff):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(staff)}")

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
