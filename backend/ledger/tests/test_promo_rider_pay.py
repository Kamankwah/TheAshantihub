"""A promo-covered delivery fee is paid to the rider by the promo's owner (Plan 7F-D Task 2): a business's free-delivery
promo debits that business's Available, an AshantiHub-funded one debits the promo subsidy account; the funder is copied onto
the charge at checkout. With no pickup before a whole refund nobody pays and nobody is paid."""
from datetime import timedelta
from decimal import Decimal

from django.test import override_settings
from django.utils import timezone

from delivery.models import RiderEarning
from ledger import escrow, posting, refunds
from ledger.models import Account, Journal, JournalLine
from marketing import waivers
from marketing.models_waivers import DeliveryWaiver, WaivedFeeCharge
from orders.models import DeliveryAssignment, Order

from . import rider_helpers
from .test_refunds import RefundBase


@override_settings(LEDGER_ENABLED=True)
class PromoRiderPayTests(RefundBase):
    def setUp(self):
        super().setUp()
        self.kofi = self.owner("Kofi")
        self.swift = rider_helpers.rider()

    def promo_order(self, rider_row=None, *, picked=True, funded_by="business"):
        order = self.paid([(self.listing(self.kofi, "120.00"), 1)], delivery="0.00")
        order.delivery_method = Order.DOOR_TO_DOOR
        order.save(update_fields=["delivery_method"])
        DeliveryAssignment.objects.create(
            order=order, dispatch=(rider_row or self.swift).staff,
            status=DeliveryAssignment.PICKED_UP if picked else DeliveryAssignment.ASSIGNED,
            picked_up_at=timezone.now() if picked else None,
        )
        rider_helpers.waived(order, self.kofi, funded_by=funded_by)
        return order

    def rider_balances(self, row=None):
        row = row or self.swift
        return posting.balance_of(Account.RIDER_BALANCE, row.staff), posting.balance_of(Account.RIDER_RESERVE, row.staff)

    def assert_balanced(self):
        for journal in Journal.objects.all():
            lines = JournalLine.objects.filter(journal=journal)
            debit = sum(l.amount for l in lines if l.side == JournalLine.DEBIT)
            credit = sum(l.amount for l in lines if l.side == JournalLine.CREDIT)
            self.assertEqual(debit, credit, journal.key)

    def test_business_promo_whole_refund_after_pickup_debits_business_and_pays_rider(self):
        order = self.promo_order()
        refund = refunds.refund_order(order, source="dispute-1")
        self.assertEqual(self.wallet(), 12000)                                   # goods only
        self.assertEqual(refund.delivery_pesewas, 0)
        self.assertEqual(self.balance(Account.VENDOR_AVAILABLE, self.kofi), -1500)
        self.assertEqual(self.rider_balances(), (1350, 150))
        self.assertEqual(self.balance(Account.PLATFORM_PROMO_SUBSIDY), 0)
        self.assertEqual(self.balance(Account.PLATFORM_DELIVERY_INCOME), 0)
        self.assert_balanced()

    def test_platform_funded_promo_debits_subsidy_account(self):
        order = self.promo_order(funded_by="platform")
        refunds.refund_order(order, source="dispute-1")
        self.assertEqual(self.balance(Account.PLATFORM_PROMO_SUBSIDY), 1500)
        self.assertEqual(self.balance(Account.VENDOR_AVAILABLE, self.kofi), 0)
        self.assertEqual(self.rider_balances(), (1350, 150))
        self.assertEqual(self.balance(Account.PLATFORM_DELIVERY_INCOME), 0)
        self.assert_balanced()

    def test_promo_refund_before_pickup_pays_nobody_and_reverses_charge(self):
        order = self.promo_order(picked=False)
        refunds.refund_order(order, source="dispute-1")
        self.assertEqual(self.rider_balances(), (0, 0))
        self.assertEqual(self.balance(Account.VENDOR_AVAILABLE, self.kofi), 0)
        self.assertEqual(self.balance(Account.PLATFORM_PROMO_SUBSIDY), 0)
        self.assertEqual(WaivedFeeCharge.objects.get(order=order).status, WaivedFeeCharge.REVERSED)
        self.assertFalse(RiderEarning.objects.exists())

    def test_promo_partial_refund_moves_nothing_then_release_pays_rider_once(self):
        order = self.promo_order()
        refunds.refund_order(order, 3000, source="dispute-1")
        self.assertEqual(self.rider_balances(), (0, 0))
        self.assertFalse(Journal.objects.filter(key=escrow.waiver_key(order)).exists())
        now = timezone.now()
        DeliveryAssignment.objects.filter(order=order).update(
            status=DeliveryAssignment.CONFIRMED, delivered_at=now, confirmed_at=now)
        self.release(order)
        self.assertEqual(self.rider_balances(), (1350, 150))
        self.assertEqual(RiderEarning.objects.filter(order=order).count(), 1)
        self.assertEqual(Journal.objects.filter(key=escrow.waiver_key(order)).count(), 1)
        self.assert_balanced()

    def test_promo_with_in_house_rider_charges_owner_keeps_platform_income(self):
        own = rider_helpers.rider("own@example.com", phone="+233244000003", third_party=False)
        order = self.promo_order(own)
        refunds.refund_order(order, source="dispute-1")
        self.assertEqual(self.balance(Account.VENDOR_AVAILABLE, self.kofi), -1500)
        self.assertEqual(self.rider_balances(own), (0, 0))
        self.assertEqual(self.balance(Account.PLATFORM_DELIVERY_INCOME), 1500)
        self.assertFalse(RiderEarning.objects.exists())
        self.assert_balanced()

    def test_funder_is_copied_at_checkout_not_read_from_waiver_later(self):
        order = self.paid([(self.listing(self.kofi, "120.00"), 1)], delivery="0.00")
        now = timezone.now()
        waiver = DeliveryWaiver.objects.create(
            business_owner=self.kofi, name="Free", starts_at=now - timedelta(days=1), ends_at=now + timedelta(days=1),
            status=DeliveryWaiver.ACTIVE, funded_by="platform",
        )
        charge = waivers.record_charge(order, waiver, Decimal("15.00"))
        self.assertEqual(charge.funded_by, "platform")
        DeliveryWaiver.objects.filter(pk=waiver.pk).update(funded_by="business")        # changed after the order
        escrow.charge_waiver(order)
        self.assertEqual(self.balance(Account.PLATFORM_PROMO_SUBSIDY), 1500)
        self.assertEqual(self.balance(Account.VENDOR_AVAILABLE, self.kofi), 0)

    def test_return_waiver_credits_subsidy_for_platform_promo(self):
        order = self.promo_order(funded_by="platform")
        escrow.charge_waiver(order)
        self.assertEqual(self.balance(Account.PLATFORM_PROMO_SUBSIDY), 1500)
        escrow.return_waiver(order)
        self.assertEqual(self.balance(Account.PLATFORM_PROMO_SUBSIDY), 0)
        self.assertEqual(self.balance(Account.PLATFORM_DELIVERY_INCOME), 0)
        self.assert_balanced()
