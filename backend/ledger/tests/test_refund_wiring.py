"""Refunds wired into the doors that already decide them (wallets plan 3a, Task 7): Support's cancel, dispute
resolution (Accountant, password again) and the delivery-case refund approval (Super Admin). Review Focus 5 and 7."""
from decimal import Decimal

from django.core.cache import cache
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.testing import make_staff, staff_token
from activity.models import ActivityEvent
from approvals import services as approvals
from approvals.models import ApprovalRequest
from delivery import config
from delivery.models import DeliveryEvent, PickupStop
from disputes.models import Dispute
from ledger import escrow, refunds
from ledger.models import Account, FulfilmentCheck, OrderFeeSnapshot, OrderRefund
from notifications.models import Notification
from orders.models import DeliveryAssignment, Order
from payments.models import CheckoutSession

from .test_refunds import RefundBase


class WiringBase(RefundBase):
    def setUp(self):
        super().setUp()
        cache.clear()
        self.client = APIClient()
        self.support = make_staff("support", "esi@example.com")
        self.accountant = make_staff("accountant", "kofi@example.com")
        self.boss = make_staff("super_admin", "boss@example.com")
        self.manager = make_staff("delivery_manager", "dm@example.com")

    def as_staff(self, staff, sudo=False):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(staff, sudo=sudo)}")

    def with_processing(self, order, fee="1.20"):
        CheckoutSession.objects.create(
            customer=self.customer, kind=CheckoutSession.ORDER_CHECKOUT, amount=order.total_amount + Decimal(fee),
            processing_fee=Decimal(fee), purpose="Order", status=CheckoutSession.SUCCESS, metadata={"order_id": order.pk},
        )

    def cancel(self, order):
        return self.client.post(
            f"/api/orders/{order.pk}/support-status/", {"status": "cancelled_by_customer", "reason": "Changed their mind"}, format="json",
        )

    def resolve(self, dispute, **body):
        return self.client.post(f"/api/disputes/{dispute.pk}/resolve/", body, format="json")

    def verify(self, order, outcome, **extra):
        return self.client.post(f"/api/ledger/orders/{order.pk}/verification/", {"outcome": outcome, **extra}, format="json")

    def dispute(self, order):
        return Dispute.objects.create(
            order=order, raised_by=self.customer, reason=Dispute.ORDER_ISSUE, description="Wrong colour", status=Dispute.INVESTIGATING,
        )

    def ask_refund(self, case, amount):
        return approvals.submit(
            self.manager, config.REFUND, title=f"Refund for case #{case.pk}", payload={"dispute_id": case.pk, "amount": amount}, target=case,
        )


@override_settings(LEDGER_ENABLED=True)
class SupportCancelTests(WiringBase):
    def test_cancelling_a_paid_order_refunds_it_whole_without_the_processing_charge(self):
        kofi = self.owner("Kofi")
        order = self.paid([(self.listing(kofi, "60.00"), 2)], delivery="10.00")
        self.with_processing(order)
        self.as_staff(self.support, sudo=True)
        response = self.cancel(order)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["status"], Order.CANCELLED)
        self.assertEqual(self.wallet(), 13000)                                                   # 130.00, not the 1.20 charge
        self.assertEqual(self.balance(Account.VENDOR_PENDING, kofi), 0)
        self.assertIsNotNone(OrderFeeSnapshot.objects.get(order=order).reversed_at)
        refund = OrderRefund.objects.get(order=order)
        self.assertEqual((refund.source, refund.created_by_id, refund.processing_pesewas), ("cancel", self.support.pk, 0))
        notice = Notification.objects.filter(customer=self.customer).latest("id")
        self.assertIn("GH₵ 130.00 went back to your AshantiHub wallet", notice.body)


@override_settings(LEDGER_ENABLED=True)
class DisputeRefundTests(WiringBase):
    def test_resolving_with_a_refund_amount_pays_it_into_the_wallet(self):
        kofi = self.owner("Kofi")
        order = self.paid([(self.listing(kofi, "60.00"), 2)], delivery="10.00")
        dispute = self.dispute(order)
        self.as_staff(self.accountant, sudo=True)
        response = self.resolve(dispute, refund_amount="40.00", resolution_notes="One item was wrong")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["wallet_refund"], "40.00")
        self.assertEqual(self.wallet(), 4000)
        self.assertEqual(OrderRefund.objects.get(order=order).source, f"dispute-{dispute.pk}")
        self.assertEqual(self.balance(Account.VENDOR_PENDING, kofi), 8000)

    def test_a_refund_the_ledger_cannot_give_leaves_the_dispute_undecided(self):
        kofi = self.owner("Kofi")
        order = self.paid([(self.listing(kofi, "60.00"), 2)], delivery="10.00")
        dispute = self.dispute(order)
        self.as_staff(self.accountant, sudo=True)
        response = self.resolve(dispute, refund_amount="500.00")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["refund_amount"], "Only GH₵ 130.00 of this order can still be refunded.")
        dispute.refresh_from_db()
        self.assertEqual((dispute.status, dispute.refund_amount), (Dispute.INVESTIGATING, None))
        self.assertEqual(self.wallet(), 0)

    def test_the_processing_charge_comes_back_when_the_accountant_says_so(self):
        kofi = self.owner("Kofi")
        order = self.paid([(self.listing(kofi, "60.00"), 1)])
        self.with_processing(order)
        self.as_staff(self.accountant, sudo=True)
        response = self.resolve(self.dispute(order), refund_amount="60.00", refund_processing=True)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["wallet_refund"], "61.20")
        self.assertEqual(self.wallet(), 6120)

    def test_review_focus_mismatch_money_back_then_matches_pays_the_rest(self):
        kofi = self.owner("Kofi")
        order = self.paid([(self.listing(kofi, "120.00"), 1)], delivery="10.00")
        order.delivery_method = Order.DOOR_TO_DOOR
        order.save(update_fields=["delivery_method"])
        DeliveryAssignment.objects.create(
            order=order, status=DeliveryAssignment.CONFIRMED, delivered_at=timezone.now(), confirmed_at=timezone.now(),
        )
        self.as_staff(self.support, sudo=True)
        self.assertEqual(self.verify(order, "does_not_match", note="Different colour").status_code, 200)
        dispute = Dispute.objects.get(order=order)
        self.as_staff(self.accountant, sudo=True)
        self.assertEqual(self.resolve(dispute, refund_amount="60.00").status_code, 200)
        self.as_staff(self.support, sudo=True)
        response = self.verify(order, "matches")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertTrue(response.json()["released"])
        self.assertEqual(self.balance(Account.VENDOR_AVAILABLE, kofi), 5750)                    # 6000 left less the 250 of fee left
        self.assertEqual(self.balance(Account.PLATFORM_FEE_INCOME), 250)
        self.assertEqual(self.balance(Account.PLATFORM_DELIVERY_INCOME), 1000)
        self.assertEqual(self.wallet(), 6000)


@override_settings(LEDGER_ENABLED=True)
class DeliveryCaseRefundTests(WiringBase):
    def skipped_case(self):
        self.kofi, self.esi = self.owner("Kofi"), self.owner("Esi")
        order = self.paid([(self.listing(self.kofi, "60.00"), 1), (self.listing(self.esi, "600.00"), 1)], delivery="10.00")
        self.with_processing(order, fee="13.40")
        assignment = DeliveryAssignment.objects.create(order=order, status=DeliveryAssignment.DELIVERED, delivered_at=timezone.now())
        case = Dispute.objects.create(
            order=order, reason=Dispute.DELIVERY_ISSUE, case_type=Dispute.NOT_RECEIVED, description="Esi's shop could not hand over",
            status=Dispute.RESOLVED, outcome="refund", fault="business", refund_amount=Decimal("600.00"),
        )
        stop = PickupStop.objects.create(assignment=assignment, sequence=2, business_owner=self.esi, status=PickupStop.SKIPPED)
        DeliveryEvent.objects.create(assignment=assignment, stop=stop, step=DeliveryEvent.SKIPPED_STOP, at=timezone.now(), dispute=case)
        return order, case

    def test_approving_a_skipped_shops_refund_pays_that_shops_lines_and_the_charge(self):
        order, case = self.skipped_case()
        self.assertEqual(refunds.scope_for_dispute(case), {self.esi.pk})
        approvals.approve(self.ask_refund(case, "600.00").pk, self.boss)
        self.assertEqual(self.wallet(), 61200)                                                    # Esi's 600.00 + 12.00, her share of the 13.40 charge (business at fault)
        self.assertEqual(self.balance(Account.VENDOR_PENDING, self.esi), 0)
        self.assertEqual(self.balance(Account.VENDOR_PENDING, self.kofi), 6000)
        self.assertEqual(OrderRefund.objects.get(order=order).source, f"dispute-{case.pk}")
        event = ActivityEvent.objects.filter(verb="delivery.refund_request_decided").latest("id")
        self.assertIn("returned to the customer's AshantiHub wallet", event.summary)

    def test_a_refund_beyond_the_shops_lines_leaves_the_request_pending(self):
        # DecideView now refuses such an amount up front; this is a balance that changed after the decision.
        order, case = self.skipped_case()
        approval = self.ask_refund(case, "700.00")
        with self.assertRaises(approvals.ApprovalError):
            approvals.approve(approval.pk, self.boss)
        approval.refresh_from_db()
        self.assertEqual(approval.status, ApprovalRequest.PENDING)
        self.assertEqual(self.wallet(), 0)

    def test_a_refund_waiting_for_the_super_admin_blocks_release(self):
        order, case = self.skipped_case()
        self.ask_refund(case, "600.00")
        FulfilmentCheck.objects.create(order=order, outcome=FulfilmentCheck.MATCHES)
        self.assertIsNone(escrow.release_verified(order))
        self.assertEqual(self.balance(Account.VENDOR_PENDING, self.esi), 60000)

    def test_a_decision_the_ledger_could_not_pay_is_refused_and_the_case_stays_undecided(self):
        order, case = self.skipped_case()
        Dispute.objects.filter(pk=case.pk).update(status=Dispute.INVESTIGATING, refund_amount=None)     # not decided yet
        self.as_staff(self.manager, sudo=True)
        response = self.client.post(
            f"/api/delivery/cases/{case.pk}/decide/",
            {"outcome": "refund", "fault": "business", "note": "Esi's shop could not hand over", "refund_amount": "650.00"}, format="json",
        )
        self.assertEqual(response.status_code, 400, response.content)                          # above Esi's 600.00 of lines
        self.assertEqual(response.json()["field"], "refund_amount")
        case.refresh_from_db()
        self.assertEqual((case.status, case.refund_amount), (Dispute.INVESTIGATING, None))
        self.assertFalse(ApprovalRequest.objects.filter(kind=config.REFUND).exists())

    def test_a_dispute_is_never_refunded_twice_across_both_doors(self):
        order, case = self.skipped_case()
        approvals.approve(self.ask_refund(case, "600.00").pk, self.boss)
        refunds.refund_order(order, 60000, source=f"dispute-{case.pk}")                       # the same source again
        self.assertEqual(OrderRefund.objects.filter(order=order).count(), 1)
        self.assertEqual(self.wallet(), 61200)

    def test_a_case_without_a_skipped_stop_refunds_from_the_whole_order(self):
        kofi = self.owner("Kofi")
        order = self.paid([(self.listing(kofi, "60.00"), 1)])
        self.assertIsNone(refunds.scope_for_dispute(self.dispute(order)))


class LedgerOffWiringTests(WiringBase):
    def test_review_focus_with_the_ledger_off_cancel_dispute_and_approval_move_nothing(self):
        kofi = self.owner("Kofi")
        order = self.order([(self.listing(kofi, "60.00"), 1)])
        self.as_staff(self.support, sudo=True)
        self.assertEqual(self.cancel(order).status_code, 200)
        notice = Notification.objects.filter(customer=self.customer).latest("id")
        self.assertEqual(notice.body, f"Your order #{order.pk} was cancelled at your request. Contact AshantiHub Support with any question.")
        other = self.order([(self.listing(kofi, "60.00"), 1)])
        self.as_staff(self.accountant, sudo=True)
        response = self.resolve(self.dispute(other), refund_amount="20.00")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertNotIn("wallet_refund", response.json())
        case = Dispute.objects.create(
            order=other, reason=Dispute.DELIVERY_ISSUE, description="Not received", status=Dispute.RESOLVED, outcome="refund",
            fault="rider", refund_amount=Decimal("10.00"),
        )
        approvals.approve(self.ask_refund(case, "10.00").pk, self.boss)
        event = ActivityEvent.objects.filter(verb="delivery.refund_request_decided").latest("id")
        self.assertIn("recorded only; payments are simulated", event.summary)
        self.assertFalse(Account.objects.exists())
        self.assertFalse(OrderRefund.objects.exists())
