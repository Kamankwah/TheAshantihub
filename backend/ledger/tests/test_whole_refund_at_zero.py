"""A whole refund when nothing can still be given back to the customer (Plan 7F-E fix wave, after ruling R1). A coupon can
leave the customer having paid N no more than the delivery fee F; once a pickup is made the fee is kept for the rider, so
refunds.refundable(order) is 0. The whole refund must still be possible: the third-party rider is paid in full (settle),
the vendor's pending money, the Delivery payable and the subsidy are reversed, the customer gets 0 and the order is
cancelled. Every amount-based door refuses 0, so dispute resolution (unscoped) and the delivery-case refund approval take
an explicit `whole_refund` instead. Figures: items 20.00, fee 15.00, coupon 30.00, N 5.00."""
from decimal import Decimal

from django.test import override_settings
from django.utils import timezone

from approvals import services as approvals
from approvals.models import ApprovalRequest
from delivery import config
from delivery.models import DeliveryEvent, PickupStop, RiderEarning
from disputes.models import Dispute
from disputes.serializers import DisputeSerializer
from ledger import posting, refunds
from ledger.models import Account, Journal, JournalLine, OrderRefund
from orders.models import DeliveryAssignment, Order

from . import rider_helpers
from .test_refund_wiring import WiringBase


@override_settings(LEDGER_ENABLED=True)
class WholeRefundAtZeroBase(WiringBase):
    def setUp(self):
        super().setUp()
        self.kofi = self.owner("Kofi")
        self.swift = rider_helpers.rider()

    def shortfall_order(self, *, price="20.00", discount="30.00"):
        """Paid, door to door, picked up by the third-party rider: N 5.00 for the 15.00 fee."""
        order = self.paid([(self.listing(self.kofi, price), 1)], delivery="15.00", discount=discount)
        order.delivery_method = Order.DOOR_TO_DOOR
        order.save(update_fields=["delivery_method"])
        DeliveryAssignment.objects.create(
            order=order, dispatch=self.swift.staff, status=DeliveryAssignment.PICKED_UP, picked_up_at=timezone.now(),
        )
        return order

    def case(self, order):
        return Dispute.objects.create(
            order=order, reason=Dispute.DELIVERY_ISSUE, case_type=Dispute.NOT_RECEIVED, description="Never arrived",
            status=Dispute.INVESTIGATING,
        )

    def rider_balances(self):
        return posting.balance_of(Account.RIDER_BALANCE, self.swift.staff), posting.balance_of(Account.RIDER_RESERVE, self.swift.staff)

    def assert_balanced(self):
        for journal in Journal.objects.all():
            lines = JournalLine.objects.filter(journal=journal)
            debit = sum(l.amount for l in lines if l.side == JournalLine.DEBIT)
            credit = sum(l.amount for l in lines if l.side == JournalLine.CREDIT)
            self.assertEqual(debit, credit, journal.key)

    def assert_whole_refund_done(self, order):
        order.refresh_from_db()
        self.assertEqual(order.status, Order.CANCELLED)
        refund = OrderRefund.objects.get(order=order)
        self.assertTrue(refund.whole)
        self.assertEqual((refund.amount_pesewas, refund.wallet_pesewas, refund.delivery_kept_pesewas), (0, 0, 1500))
        self.assertEqual(self.wallet(), 0)
        self.assertEqual(self.rider_balances(), (1350, 150))                     # the rider is paid in full
        self.assertEqual(RiderEarning.objects.filter(order=order).count(), 1)
        self.assertEqual(self.balance(Account.VENDOR_PENDING, self.kofi), 0)
        self.assertEqual(self.balance(Account.DELIVERY_PAYABLE, order), 0)
        self.assertEqual(self.balance(Account.PLATFORM_PROMO_SUBSIDY), 1000)    # 30.00 out, 20.00 back (D - (F - N))
        self.assertEqual(refunds.refundable(order), 0)
        self.assert_balanced()


class CheckWholeTests(WholeRefundAtZeroBase):
    def test_a_picked_up_order_the_coupon_left_at_zero_may_be_refunded_whole(self):
        order = self.shortfall_order()
        self.assertEqual(refunds.refundable(order), 0)
        self.assertIsNone(refunds.whole_at_zero_refusal(order))
        refunds.check_whole(order)                                                # does not raise

    def test_an_order_with_money_still_refundable_needs_the_amount(self):
        order = self.shortfall_order(price="100.00", discount="10.00")          # N 105, refundable 90.00
        with self.assertRaises(refunds.RefundError) as caught:
            refunds.check_whole(order)
        self.assertEqual(
            caught.exception.message, "GH₵ 90.00 can still be refunded: enter that amount for a whole-order refund.",
        )

    def test_a_shop_scoped_case_cannot_refund_the_whole_order(self):
        order = self.shortfall_order()
        with self.assertRaises(refunds.RefundError):
            refunds.check_whole(order, owner_ids={self.kofi.pk})

    def test_an_order_already_refunded_whole_is_refused(self):
        order = self.shortfall_order()
        refunds.refund_order(order, source="dispute-99")
        with self.assertRaises(refunds.RefundError) as caught:
            refunds.check_whole(order)
        self.assertEqual(caught.exception.message, "This order has already been refunded in full.")

    def test_refused_while_the_ledger_is_off(self):
        order = self.shortfall_order()
        with self.settings(LEDGER_ENABLED=False):
            self.assertIsNotNone(refunds.whole_at_zero_refusal(order))
            with self.assertRaises(refunds.RefundError):
                refunds.check_whole(order)

    def test_the_dispute_payload_says_when_only_a_whole_refund_at_zero_is_left(self):
        order = self.shortfall_order()
        data = DisputeSerializer(self.dispute(order)).data
        self.assertEqual(data["order_refundable_amount"], "0.00")
        self.assertTrue(data["order_whole_refund_at_zero"])
        other = self.shortfall_order(price="100.00", discount="10.00")
        self.assertFalse(DisputeSerializer(self.dispute(other)).data["order_whole_refund_at_zero"])


class DisputeWholeRefundTests(WholeRefundAtZeroBase):
    def test_resolving_with_whole_refund_pays_the_rider_and_cancels_the_order(self):
        order = self.shortfall_order()
        dispute = self.dispute(order)
        self.as_staff(self.accountant, sudo=True)
        response = self.resolve(dispute, whole_refund=True, resolution_notes="Never delivered")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["wallet_refund"], "0.00")
        dispute.refresh_from_db()
        self.assertEqual((dispute.status, dispute.refund_amount), (Dispute.RESOLVED, Decimal("0.00")))
        self.assertEqual(OrderRefund.objects.get(order=order).source, f"dispute-{dispute.pk}")
        self.assert_whole_refund_done(order)
        # A retry (either door, any source) settles nothing twice.
        refunds.refund_order(order, source=f"dispute-{dispute.pk}")
        self.assertIsNone(refunds.refund_order(order, source="dispute-other"))
        self.assertEqual(OrderRefund.objects.filter(order=order).count(), 1)
        self.assert_whole_refund_done(order)

    def test_whole_refund_is_refused_while_money_is_still_refundable(self):
        order = self.shortfall_order(price="100.00", discount="10.00")
        dispute = self.dispute(order)
        self.as_staff(self.accountant, sudo=True)
        response = self.resolve(dispute, whole_refund=True)
        self.assertEqual(response.status_code, 400, response.content)
        self.assertEqual(
            response.json()["whole_refund"], "GH₵ 90.00 can still be refunded: enter that amount for a whole-order refund.",
        )
        dispute.refresh_from_db()
        self.assertEqual((dispute.status, dispute.refund_amount), (Dispute.INVESTIGATING, None))
        self.assertFalse(OrderRefund.objects.exists())

    def test_whole_refund_with_an_amount_is_refused(self):
        order = self.shortfall_order()
        dispute = self.dispute(order)
        self.as_staff(self.accountant, sudo=True)
        response = self.resolve(dispute, whole_refund=True, refund_amount="5.00")
        self.assertEqual(response.status_code, 400, response.content)
        self.assertIn("whole_refund", response.json())
        self.assertFalse(OrderRefund.objects.exists())

    def test_whole_refund_on_a_skipped_shops_case_is_refused(self):
        order = self.shortfall_order()
        dispute = self.dispute(order)
        assignment = DeliveryAssignment.objects.get(order=order)
        stop = PickupStop.objects.create(assignment=assignment, sequence=1, business_owner=self.kofi, status=PickupStop.SKIPPED)
        DeliveryEvent.objects.create(assignment=assignment, stop=stop, step=DeliveryEvent.SKIPPED_STOP, at=timezone.now(), dispute=dispute)
        self.as_staff(self.accountant, sudo=True)
        response = self.resolve(dispute, whole_refund=True)
        self.assertEqual(response.status_code, 400, response.content)
        self.assertFalse(OrderRefund.objects.exists())

    def test_a_rejected_dispute_ignores_whole_refund(self):
        order = self.shortfall_order()
        dispute = self.dispute(order)
        self.as_staff(self.accountant, sudo=True)
        response = self.resolve(dispute, outcome="rejected", whole_refund=True)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertFalse(OrderRefund.objects.exists())
        self.assertEqual(self.rider_balances(), (0, 0))

    def test_resolving_with_no_amount_and_no_flag_still_refunds_nothing(self):
        order = self.shortfall_order()
        self.as_staff(self.accountant, sudo=True)
        response = self.resolve(self.dispute(order), refund_amount="0.00")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertFalse(OrderRefund.objects.exists())
        self.assertEqual(self.rider_balances(), (0, 0))


class DeliveryCaseWholeRefundTests(WholeRefundAtZeroBase):
    def decide(self, case, **body):
        self.as_staff(self.manager, sudo=True)
        return self.client.post(
            f"/api/delivery/cases/{case.pk}/decide/",
            {"outcome": "refund", "fault": "rider", "note": "The parcel was lost", **body}, format="json",
        )

    def test_a_whole_refund_decision_is_approved_and_pays_the_rider_once(self):
        order = self.shortfall_order()
        case = self.case(order)
        response = self.decide(case, whole_refund=True)
        self.assertEqual(response.status_code, 200, response.content)
        approval = ApprovalRequest.objects.get(pk=response.json()["refund_approval_id"])
        self.assertEqual(approval.payload, {"dispute_id": case.pk, "amount": "0.00", "whole": True})
        case.refresh_from_db()
        self.assertEqual((case.status, case.refund_amount), (Dispute.RESOLVED, Decimal("0.00")))
        approvals.approve(approval.pk, self.boss)
        self.assert_whole_refund_done(order)
        approval.refresh_from_db()
        config.refund_apply(approval)                                             # a retried apply moves nothing more
        self.assert_whole_refund_done(order)

    def test_a_whole_refund_decision_is_refused_while_money_is_still_refundable(self):
        order = self.shortfall_order(price="100.00", discount="10.00")
        case = self.case(order)
        response = self.decide(case, whole_refund=True)
        self.assertEqual(response.status_code, 400, response.content)
        self.assertEqual(response.json()["field"], "whole_refund")
        case.refresh_from_db()
        self.assertEqual(case.status, Dispute.INVESTIGATING)
        self.assertFalse(ApprovalRequest.objects.filter(kind=config.REFUND).exists())

    def test_an_approved_whole_refund_that_is_no_longer_at_zero_stays_pending(self):
        order = self.shortfall_order()
        case = self.case(order)
        approval = approvals.submit(
            self.manager, config.REFUND, title="Whole refund", payload={"dispute_id": case.pk, "amount": "0.00", "whole": True},
            target=case,
        )
        refunds.refund_order(order, source="dispute-elsewhere")                   # refunded whole by another door meanwhile
        with self.assertRaises(approvals.ApprovalError):
            approvals.approve(approval.pk, self.boss)
        approval.refresh_from_db()
        self.assertEqual(approval.status, ApprovalRequest.PENDING)
        self.assertEqual(self.rider_balances(), (1350, 150))


class DeliveryCaseMoneyFieldsTests(WholeRefundAtZeroBase):
    def detail(self, case):
        self.as_staff(self.manager)
        response = self.client.get(f"/api/delivery/cases/{case.pk}/")
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()

    def test_case_detail_carries_refundable_and_the_kept_fee(self):
        case = self.case(self.shortfall_order())
        order = self.detail(case)["order"]
        self.assertEqual((order["refundable"], order["delivery_fee_kept"], order["whole_refund_at_zero"]), ("0.00", "15.00", True))
        self.assertIsNone(order["free_delivery"])

    def test_refundable_money_leaves_the_whole_refund_flag_off(self):
        order = self.detail(self.case(self.shortfall_order(price="100.00", discount="10.00")))["order"]
        self.assertEqual(order["refundable"], "90.00")
        self.assertFalse(order["whole_refund_at_zero"])

    @override_settings(LEDGER_ENABLED=False)
    def test_money_fields_are_empty_while_the_ledger_is_off(self):
        data = self.detail(self.case(self.shortfall_order()))
        order = data["order"]
        self.assertEqual((order["refundable"], order["delivery_fee_kept"], order["whole_refund_at_zero"]), (None, None, False))
        self.assertIn("simulated", data["payments"])

    def test_whole_refund_flag_is_false_once_decided(self):
        case = self.case(self.shortfall_order())
        case.status = Dispute.RESOLVED
        case.save(update_fields=["status"])
        order = self.detail(case)["order"]
        self.assertEqual(order["refundable"], "0.00")
        self.assertFalse(order["whole_refund_at_zero"])

    def test_shop_scoped_case_never_offers_whole_refund(self):
        order = self.shortfall_order()
        case = self.case(order)
        assignment = DeliveryAssignment.objects.get(order=order)
        stop = PickupStop.objects.create(assignment=assignment, sequence=1, business_owner=self.kofi, status=PickupStop.SKIPPED)
        DeliveryEvent.objects.create(assignment=assignment, stop=stop, step=DeliveryEvent.SKIPPED_STOP, at=timezone.now(), dispute=case)
        self.assertFalse(self.detail(case)["order"]["whole_refund_at_zero"])

    def test_free_delivery_names_the_funder(self):
        order = self.shortfall_order()
        rider_helpers.waived(order, self.kofi, amount="15.00", funded_by="platform")
        self.assertEqual(self.detail(self.case(order))["order"]["free_delivery"], {"amount": "15.00", "funded_by": "platform"})

    @override_settings(LEDGER_ENABLED=False)
    def test_free_delivery_does_not_depend_on_the_ledger(self):
        order = self.shortfall_order()
        rider_helpers.waived(order, self.kofi, amount="15.00", funded_by="business")
        self.assertEqual(self.detail(self.case(order))["order"]["free_delivery"], {"amount": "15.00", "funded_by": "business"})

    def test_refund_block_says_whole(self):
        case = self.case(self.shortfall_order())
        self.as_staff(self.manager, sudo=True)
        self.client.post(f"/api/delivery/cases/{case.pk}/decide/", {"outcome": "refund", "fault": "rider", "note": "Lost", "whole_refund": True}, format="json")
        refund = self.detail(case)["refund"]
        self.assertTrue(refund["whole"])
        self.assertEqual(refund["amount"], "0.00")

    def test_payments_copy_follows_the_ledger(self):
        data = self.detail(self.case(self.shortfall_order()))
        self.assertEqual(data["payments"], "A refund is paid into the customer's AshantiHub wallet once a Super Admin approves it.")
