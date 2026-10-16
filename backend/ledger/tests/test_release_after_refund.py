"""Release after refunds (wallets plan 3a, Task 6; spec §13 "Stage 3 carry-forward"). Review Focus 5: a refund then
Support's "matches" pays the vendor only what is left, and a cancelled order is never released. Also: the waived
delivery fee is charged to the business at release and given back on a whole refund."""
from datetime import timedelta
from decimal import Decimal

from django.test import override_settings
from django.utils import timezone

from accounts.models import Role, StaffUser
from ledger import escrow, refunds, verification
from ledger.models import Account, FulfilmentCheck, Journal, OrderFeeSnapshot
from marketing.models_waivers import DeliveryWaiver, WaivedFeeCharge
from orders.models import DeliveryAssignment, Order

from .test_refunds import RefundBase


@override_settings(LEDGER_ENABLED=True)
class ReleaseAfterRefundTests(RefundBase):
    def staff(self):
        return StaffUser.objects.get_or_create(email="maker@example.com", defaults=dict(full_name="Maker", password_hash="x", role=Role.objects.get(name="support")))[0]

    def delivered(self, order):
        order.delivery_method = Order.DOOR_TO_DOOR
        order.save(update_fields=["delivery_method"])
        DeliveryAssignment.objects.create(
            order=order, status=DeliveryAssignment.CONFIRMED, delivered_at=timezone.now(), confirmed_at=timezone.now(),
        )

    def pending_refund(self, order):
        from approvals.models import ApprovalRequest
        from disputes.models import Dispute

        dispute = Dispute.objects.create(order=order, raised_by=order.customer, reason=Dispute.ORDER_ISSUE, status=Dispute.FINAL_STATUSES[0])
        return ApprovalRequest.objects.create(
            maker=self.staff(), due_at=timezone.now() + timedelta(days=1), kind="delivery.refund_request",
            status=ApprovalRequest.PENDING, target_type="disputes.dispute", target_id=str(dispute.pk),
        )

    def test_review_focus_a_refund_then_matches_pays_only_the_rest(self):
        kofi, esi = self.owner("Kofi"), self.owner("Esi")
        order = self.paid([(self.listing(kofi, "60.00"), 1), (self.listing(esi, "600.00"), 1)], delivery="10.00")
        refunds.refund_order(order, 6000, source="dispute-1", owner_ids={kofi.pk})        # Kofi's shop could not hand over
        refunds.refund_order(order, 30000, source="dispute-2", owner_ids={esi.pk})         # half of Esi's item went back
        self.release(order)
        self.assertEqual(self.balance(Account.VENDOR_PENDING, kofi), 0)
        self.assertEqual(self.balance(Account.VENDOR_AVAILABLE, kofi), 0)                 # nothing paid for refunded lines
        self.assertEqual(self.balance(Account.VENDOR_PENDING, esi), 0)
        self.assertEqual(self.balance(Account.VENDOR_AVAILABLE, esi), 29700)              # 30000 left, less the 300 of fee left
        self.assertEqual(self.balance(Account.PLATFORM_FEE_INCOME), 300)
        self.assertEqual(self.balance(Account.PLATFORM_DELIVERY_INCOME), 1000)
        self.assertEqual(self.wallet(), 36000)

    def test_review_focus_a_cancelled_order_is_never_released(self):
        kofi = self.owner("Kofi")
        order = self.paid([(self.listing(kofi, "60.00"), 1)])
        Order.objects.filter(pk=order.pk).update(status=Order.CANCELLED)
        FulfilmentCheck.objects.create(order=order, outcome=FulfilmentCheck.MATCHES)
        self.assertIsNone(escrow.release_verified(order))
        self.assertFalse(Journal.objects.filter(key=f"order-release-{order.pk}").exists())
        self.assertEqual(self.balance(Account.VENDOR_PENDING, kofi), 6000)

    def test_a_fully_refunded_order_leaves_supports_list(self):
        kofi = self.owner("Kofi")
        order = self.paid([(self.listing(kofi, "60.00"), 1)])
        order.delivery_method = Order.DOOR_TO_DOOR
        order.save(update_fields=["delivery_method"])
        DeliveryAssignment.objects.create(
            order=order, status=DeliveryAssignment.CONFIRMED, delivered_at=timezone.now(), confirmed_at=timezone.now(),
        )
        self.assertEqual([row["order_id"] for row in verification.awaiting()], [order.pk])
        refunds.refund_order(order, source="dispute-1")
        self.assertEqual(verification.awaiting(), [])

    def waived(self, owner, order, status=WaivedFeeCharge.OWED):
        now = timezone.now()
        waiver = DeliveryWaiver.objects.create(
            business_owner=owner, name="Free delivery week", starts_at=now - timedelta(days=1), ends_at=now + timedelta(days=1),
            status=DeliveryWaiver.ACTIVE,
        )
        return WaivedFeeCharge.objects.create(order=order, waiver=waiver, business_owner=owner, amount=Decimal("15.00"), status=status)

    def test_a_free_delivery_promo_is_charged_at_release_and_given_back_on_a_whole_refund(self):
        kofi = self.owner("Kofi")
        order = self.paid([(self.listing(kofi, "120.00"), 1)], delivery="0.00")             # the delivery fee was waived
        charge = self.waived(kofi, order)
        self.release(order)
        self.assertEqual(self.balance(Account.VENDOR_AVAILABLE, kofi), 10000)                # 12000 - 500 fee - 1500 promo
        self.assertEqual(self.balance(Account.PLATFORM_DELIVERY_INCOME), 1500)
        self.assertTrue(Journal.objects.filter(key=f"order-waiver-{order.pk}").exists())
        refunds.refund_order(order, source="dispute-1")                                       # the whole order goes back
        self.assertEqual(self.wallet(), 12000)                                                 # never the waived fee: it was never paid
        self.assertEqual(self.balance(Account.VENDOR_AVAILABLE, kofi), 0)
        self.assertEqual(self.balance(Account.PLATFORM_DELIVERY_INCOME), 0)
        self.assertTrue(Journal.objects.filter(key=f"order-waiver-return-{order.pk}").exists())
        charge.refresh_from_db()
        self.assertEqual(charge.status, WaivedFeeCharge.REVERSED)

    def test_a_reversed_promo_charge_is_never_taken(self):
        kofi = self.owner("Kofi")
        order = self.paid([(self.listing(kofi, "120.00"), 1)], delivery="0.00")
        self.waived(kofi, order, status=WaivedFeeCharge.REVERSED)
        self.release(order)
        self.assertFalse(Journal.objects.filter(key=f"order-waiver-{order.pk}").exists())
        self.assertEqual(self.balance(Account.VENDOR_AVAILABLE, kofi), 11500)

    def test_all_items_refunded_but_not_the_order_still_releases_the_delivery_fee_once(self):
        kofi = self.owner("Kofi")
        order = self.paid([(self.listing(kofi, "60.00"), 1)], delivery="10.00")
        refunds.refund_order(order, source="dispute-1", owner_ids={kofi.pk})                 # every item back; fee still held
        self.assertEqual(self.balance(Account.DELIVERY_PAYABLE, order), 1000)
        self.assertFalse(OrderFeeSnapshot.objects.filter(order=order, reversed_at__isnull=True).exists())
        self.release(order)
        self.assertEqual(self.balance(Account.DELIVERY_PAYABLE, order), 0)
        self.assertEqual(self.balance(Account.PLATFORM_DELIVERY_INCOME), 1000)
        self.assertEqual(self.balance(Account.VENDOR_PENDING, kofi), 0)
        self.assertEqual(self.balance(Account.VENDOR_AVAILABLE, kofi), 0)
        self.assertEqual(self.balance(Account.PLATFORM_FEE_INCOME), 0)
        self.assertIsNone(escrow.release_verified(order))                                   # idempotent
        self.assertEqual(self.balance(Account.PLATFORM_DELIVERY_INCOME), 1000)
        self.assertEqual(Journal.objects.filter(key=f"order-release-{order.pk}").count(), 1)

    def test_a_wholly_refunded_order_releases_nothing(self):
        kofi = self.owner("Kofi")
        order = self.paid([(self.listing(kofi, "60.00"), 1)], delivery="10.00")
        refunds.refund_order(order, source="cancel")
        FulfilmentCheck.objects.create(order=order, outcome=FulfilmentCheck.MATCHES)
        self.assertIsNone(escrow.release_verified(order))
        self.assertFalse(Journal.objects.filter(key=f"order-release-{order.pk}").exists())

    def test_a_delivery_case_refund_waiting_for_approval_blocks_release(self):
        from approvals.models import ApprovalRequest
        from disputes.models import Dispute

        kofi = self.owner("Kofi")
        order = self.paid([(self.listing(kofi, "60.00"), 1)])
        dispute = Dispute.objects.create(order=order, raised_by=order.customer, reason=Dispute.ORDER_ISSUE, status=Dispute.FINAL_STATUSES[0])
        FulfilmentCheck.objects.create(order=order, outcome=FulfilmentCheck.MATCHES)
        maker = self.staff()
        pending = ApprovalRequest.objects.create(
            maker=maker, due_at=timezone.now() + timedelta(days=1), kind="delivery.refund_request", status=ApprovalRequest.PENDING, target_type="disputes.dispute", target_id=str(dispute.pk),
        )
        self.assertTrue(escrow.has_pending_refund(order))
        self.assertIsNone(escrow.release_verified(order))
        ApprovalRequest.objects.filter(pk=pending.pk).update(status=ApprovalRequest.APPROVED)
        self.assertFalse(escrow.has_pending_refund(order))
        self.assertIsNotNone(escrow.release_verified(order))

    def test_an_all_items_refunded_order_stays_on_supports_list_and_releases_through_record(self):
        kofi = self.owner("Kofi")
        order = self.paid([(self.listing(kofi, "60.00"), 1)], delivery="10.00")
        self.delivered(order)
        refunds.refund_order(order, source="dispute-1", owner_ids={kofi.pk})
        self.assertEqual([row["order_id"] for row in verification.awaiting()], [order.pk])
        verification.record(order, self.staff(), FulfilmentCheck.MATCHES)
        self.assertEqual(verification.awaiting(), [])
        self.assertEqual(self.balance(Account.PLATFORM_DELIVERY_INCOME), 1000)
        self.assertEqual(self.balance(Account.VENDOR_AVAILABLE, kofi), 0)
        self.assertEqual(Journal.objects.filter(key=f"order-release-{order.pk}").count(), 1)

    def test_a_wholly_refunded_order_is_not_on_the_list_even_with_a_delivery_fee(self):
        kofi = self.owner("Kofi")
        order = self.paid([(self.listing(kofi, "60.00"), 1)], delivery="10.00")
        self.delivered(order)
        refunds.refund_order(order, source="cancel")
        self.assertEqual(verification.awaiting(), [])

    def test_the_r1_release_still_charges_a_promo_owed(self):
        kofi = self.owner("Kofi")
        order = self.paid([(self.listing(kofi, "60.00"), 1)], delivery="10.00")
        self.delivered(order)
        self.waived(kofi, order)
        refunds.refund_order(order, source="dispute-1", owner_ids={kofi.pk})
        self.release(order)
        self.assertTrue(Journal.objects.filter(key=f"order-waiver-{order.pk}").exists())
        self.assertEqual(self.balance(Account.VENDOR_AVAILABLE, kofi), -1500)
        self.assertEqual(self.balance(Account.PLATFORM_DELIVERY_INCOME), 2500)

    def test_all_items_refunded_before_any_delivery_reverses_the_promo_charge(self):
        kofi = self.owner("Kofi")
        order = self.paid([(self.listing(kofi, "120.00"), 1)], delivery="0.00")
        charge = self.waived(kofi, order)
        refunds.refund_order(order, source="dispute-1", owner_ids={kofi.pk})                 # nothing left to deliver
        charge.refresh_from_db()
        self.assertEqual(charge.status, WaivedFeeCharge.REVERSED)
        self.assertFalse(WaivedFeeCharge.objects.filter(status=WaivedFeeCharge.OWED).exists())

    def test_a_whole_refund_with_nothing_left_still_reverses_the_promo_charge(self):
        kofi = self.owner("Kofi")
        order = self.paid([(self.listing(kofi, "120.00"), 1)], delivery="0.00")
        self.delivered(order)
        charge = self.waived(kofi, order)
        refunds.refund_order(order, source="dispute-1", owner_ids={kofi.pk})                 # delivered: charge stays owed
        charge.refresh_from_db()
        self.assertEqual(charge.status, WaivedFeeCharge.OWED)
        self.assertIsNone(refunds.refund_order(order, source="cancel"))                       # nothing left to refund
        charge.refresh_from_db()
        self.assertEqual(charge.status, WaivedFeeCharge.REVERSED)

    def test_matches_is_refused_while_a_delivery_refund_waits_and_nothing_is_saved(self):
        kofi = self.owner("Kofi")
        order = self.paid([(self.listing(kofi, "60.00"), 1)])
        self.delivered(order)
        self.pending_refund(order)
        with self.assertRaises(verification.VerificationError) as caught:
            verification.record(order, self.staff(), FulfilmentCheck.MATCHES)
        self.assertEqual(caught.exception.status_code, 409)
        self.assertIn("refund waiting for approval", caught.exception.message)
        self.assertFalse(FulfilmentCheck.objects.filter(order=order, outcome=FulfilmentCheck.MATCHES).exists())

    def test_ledger_off_the_promo_postings_do_nothing(self):
        kofi = self.owner("Kofi")
        order = self.paid([(self.listing(kofi, "120.00"), 1)], delivery="0.00")
        self.waived(kofi, order)
        with override_settings(LEDGER_ENABLED=False):
            self.assertIsNone(escrow.charge_waiver(order))
            self.assertIsNone(escrow.return_waiver(order))
