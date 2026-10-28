"""A whole refund must not leave the order deliverable (final review I-1): an order not yet handed over is cancelled and
restocked in the refund's own transaction, and a wholly refunded order is refused by the delivery board, the pickup desk
and the pickup queue even if its status is somehow still paid."""
from django.test import override_settings
from django.utils import timezone

from approvals import services as approvals
from delivery import board
from disputes.models import Dispute
from ledger import refunds, verification
from ledger.models import OrderRefund
from orders.models import DeliveryAssignment, Order

from .test_refund_wiring import WiringBase


@override_settings(LEDGER_ENABLED=True)
class WholeRefundCancelTests(WiringBase):
    def stocked_order(self, **kwargs):
        self.kofi = self.owner("Kofi")
        self.item = self.listing(self.kofi, "60.00")
        self.item.stock_quantity = 3
        self.item.save(update_fields=["stock_quantity"])
        return self.paid([(self.item, 2)], **kwargs)

    def stock(self):
        self.item.refresh_from_db()
        return self.item.stock_quantity

    def test_a_whole_dispute_refund_of_an_undelivered_order_cancels_it_and_restocks(self):
        order = self.stocked_order()
        dispute = self.dispute(order)
        self.as_staff(self.accountant, sudo=True)
        response = self.resolve(dispute, refund_amount="120.00", resolution_notes="Never sent")
        self.assertEqual(response.status_code, 200, response.content)
        order.refresh_from_db()
        self.assertEqual(order.status, Order.CANCELLED)
        self.assertEqual(self.stock(), 5)
        self.assertEqual(self.wallet(), 12000)

    def test_a_whole_delivery_case_approval_of_an_undelivered_order_cancels_it_and_restocks(self):
        order = self.stocked_order()
        case = Dispute.objects.create(
            order=order, reason=Dispute.DELIVERY_ISSUE, case_type=Dispute.NOT_RECEIVED, description="Never arrived",
            status=Dispute.RESOLVED, outcome="refund", fault="rider", refund_amount=order.total_amount,
        )
        approvals.approve(self.ask_refund(case, "120.00").pk, self.boss)
        order.refresh_from_db()
        self.assertEqual(order.status, Order.CANCELLED)
        self.assertEqual(self.stock(), 5)

    def test_a_whole_refund_of_a_delivered_order_leaves_it_paid(self):
        order = self.stocked_order()
        Order.objects.filter(pk=order.pk).update(delivery_method=Order.DOOR_TO_DOOR)
        order.refresh_from_db()
        DeliveryAssignment.objects.create(order=order, status=DeliveryAssignment.DELIVERED, delivered_at=timezone.now())
        refunds.refund_order(order, source="dispute-1")
        order.refresh_from_db()
        self.assertEqual(order.status, Order.PAID)
        self.assertEqual(self.stock(), 3)

    def test_a_partial_refund_leaves_the_order_paid(self):
        order = self.stocked_order()
        refunds.refund_order(order, 1000, source="dispute-1")
        order.refresh_from_db()
        self.assertEqual((order.status, self.stock()), (Order.PAID, 3))

    def test_a_cancel_that_already_restocked_does_not_restock_twice(self):
        order = self.stocked_order()
        self.as_staff(self.support)
        self.assertEqual(self.cancel(order).status_code, 200)
        self.assertEqual(self.stock(), 5)

    def refunded_but_paid(self, order=None):
        order = order or self.stocked_order()
        refunds.refund_order(order, source="dispute-1")
        Order.objects.filter(pk=order.pk).update(status=Order.PAID)                    # as if something revived it
        order.refresh_from_db()
        return order

    def test_is_wholly_refunded(self):
        order = self.stocked_order()
        self.assertFalse(refunds.is_wholly_refunded(order))
        refunds.refund_order(order, 1000, source="dispute-1")
        self.assertFalse(refunds.is_wholly_refunded(order))
        refunds.refund_order(order, source="dispute-2")
        self.assertTrue(refunds.is_wholly_refunded(order))

    def test_a_wholly_refunded_order_is_not_waiting_for_a_rider(self):
        order = self.stocked_order()
        Order.objects.filter(pk=order.pk).update(delivery_method=Order.DOOR_TO_DOOR)
        self.assertIn(order.pk, [o.pk for o in board.waiting_orders()])
        refunds.refund_order(order, source="dispute-1")
        Order.objects.filter(pk=order.pk).update(status=Order.PAID)
        self.assertNotIn(order.pk, [o.pk for o in board.waiting_orders()])

    def test_a_wholly_refunded_order_is_not_on_the_pickup_queue(self):
        order = self.stocked_order()
        self.assertIn(order.pk, [row["order_id"] for row in verification.pickup_queue()])
        self.refunded_but_paid(order)
        self.assertNotIn(order.pk, [row["order_id"] for row in verification.pickup_queue()])

    def test_the_desk_cannot_mark_a_wholly_refunded_order_collected(self):
        order = self.refunded_but_paid()
        with self.assertRaises(verification.VerificationError) as caught:
            verification.mark_collected(order, self.support, code=verification.check_for(order).collection_code)
        self.assertIn("refunded", caught.exception.message)
        self.assertFalse(verification.FulfilmentCheck.objects.filter(order=order, collected_at__isnull=False).exists())
        self.assertTrue(OrderRefund.objects.filter(order=order, whole=True).exists())
