"""The dispute payload says what can still be refunded on its order (Plan 7F-E Task 1): the customer's real credit, net of
the coupon and of a delivery fee kept for the rider; null while the ledger is off or without a ledger-paid order."""
from django.test import override_settings

from disputes.models import Dispute
from disputes.serializers import DisputeSerializer
from ledger.tests.test_refunds import RefundBase


@override_settings(LEDGER_ENABLED=True)
class DisputeRefundableAmountTests(RefundBase):
    def dispute(self, order=None):
        return Dispute.objects.create(
            raised_by=self.customer, order=order, reason=Dispute.DELIVERY_ISSUE, description="x", status=Dispute.OPEN,
        )

    def test_dispute_payload_carries_refundable_amount(self):
        kofi = self.owner("Kofi")
        order = self.paid([(self.listing(kofi, "100.00"), 1)], delivery="15.00", discount="10.00")
        data = DisputeSerializer(self.dispute(order)).data
        self.assertEqual(data["order_refundable_amount"], "105.00")
        with self.settings(LEDGER_ENABLED=False):
            self.assertIsNone(DisputeSerializer(self.dispute(order)).data["order_refundable_amount"])
        self.assertIsNone(DisputeSerializer(self.dispute()).data["order_refundable_amount"])

    def test_skipped_stop_dispute_shows_only_its_shops_capped_room(self):
        from django.utils import timezone

        from delivery.models import DeliveryEvent, PickupStop
        from orders.models import DeliveryAssignment, Order

        kofi, esi = self.owner("Kofi"), self.owner("Esi")
        order = self.paid(
            [(self.listing(kofi, "60.00"), 1), (self.listing(esi, "40.00"), 1)], delivery="15.00", discount="10.00",
        )                                                                   # N 105, partial room 90
        order.delivery_method = Order.DOOR_TO_DOOR
        order.save(update_fields=["delivery_method"])
        assignment = DeliveryAssignment.objects.create(order=order, status=DeliveryAssignment.ACCEPTED)
        stop = PickupStop.objects.create(assignment=assignment, sequence=1, business_owner=esi, status=PickupStop.SKIPPED)
        dispute = self.dispute(order)
        DeliveryEvent.objects.create(
            assignment=assignment, stop=stop, step=DeliveryEvent.SKIPPED_STOP, at=timezone.now(), dispute=dispute,
        )
        self.assertEqual(DisputeSerializer(dispute).data["order_refundable_amount"], "40.00")     # Esi's lines only
        self.assertEqual(DisputeSerializer(self.dispute(order)).data["order_refundable_amount"], "105.00")
