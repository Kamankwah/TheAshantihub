"""A full dispute refund and a free-delivery promo (final review of Plan 7F-D): after a pickup the delivery is earned, so the
promo's charge stands (WaivedFeeCharge stays OWED, the ledger charge is made); before a pickup it is reversed as before."""
from django.test import override_settings
from django.utils import timezone

from delivery.models import RiderEarning
from marketing.models_waivers import WaivedFeeCharge
from orders.models import DeliveryAssignment, Order

from . import rider_helpers
from .test_refund_wiring import WiringBase


@override_settings(LEDGER_ENABLED=True)
class DisputePromoRefundTests(WiringBase):
    def promo_order(self, *, picked):
        kofi = self.owner("Kofi")
        swift = rider_helpers.rider()
        order = self.paid([(self.listing(kofi, "120.00"), 1)], delivery="0.00")
        order.delivery_method = Order.DOOR_TO_DOOR
        order.save(update_fields=["delivery_method"])
        DeliveryAssignment.objects.create(
            order=order, dispatch=swift.staff, status=DeliveryAssignment.PICKED_UP if picked else DeliveryAssignment.ASSIGNED,
            picked_up_at=timezone.now() if picked else None,
        )
        return order, rider_helpers.waived(order, kofi)

    def test_full_dispute_refund_after_pickup_leaves_the_promo_charge_owed(self):
        order, charge = self.promo_order(picked=True)
        self.as_staff(self.accountant, sudo=True)
        response = self.resolve(self.dispute(order), refund_amount="120.00", resolution_notes="Wrong goods")
        self.assertEqual(response.status_code, 200, response.content)
        charge.refresh_from_db()
        self.assertEqual(charge.status, WaivedFeeCharge.OWED)
        self.assertTrue(RiderEarning.objects.filter(order=order).exists())

    def test_full_dispute_refund_before_pickup_reverses_the_promo_charge(self):
        order, charge = self.promo_order(picked=False)
        self.as_staff(self.accountant, sudo=True)
        response = self.resolve(self.dispute(order), refund_amount="120.00", resolution_notes="Wrong goods")
        self.assertEqual(response.status_code, 200, response.content)
        charge.refresh_from_db()
        self.assertEqual(charge.status, WaivedFeeCharge.REVERSED)
        self.assertFalse(RiderEarning.objects.exists())
