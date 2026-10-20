"""Re-delivery at the customer's request (Plan 7F-E Task 7, owner Rulings R4 and R5): the rules (delivery.redelivery)."""
from datetime import timedelta

from django.test import override_settings
from django.utils import timezone

from delivery import redelivery
from delivery.models import Redelivery
from delivery.redelivery import RedeliveryError
from ledger.models import MoneySetting
from ledger.tests.redelivery_helpers import RedeliveryBase
from notifications.models import Notification


@override_settings(LEDGER_ENABLED=True)
class RedeliveryRequestTests(RedeliveryBase):
    def refused(self, order, code="not_redeliverable"):
        with self.assertRaises(RedeliveryError) as raised:
            self.ask(order)
        self.assertEqual((raised.exception.status_code, raised.exception.code), (409, code))

    def test_request_refused_unless_failed_no_answer_after_arrival(self):
        self.refused(self.failed_other("wrong_address"))                 # case (a): a plain re-assignment, no fee
        self.refused(self.failed_other("refused"))
        on_the_road = self.door_order()
        self.give(on_the_road, self.swift)
        self.collect_all(on_the_road, self.swift)
        self.refused(on_the_road)                                         # still with the rider
        self.refused(self.door_order())                                   # never assigned
        order = self.unavailable()
        row = self.ask(order)
        self.assertEqual((row.status, row.attempt, row.first_rider_id), (Redelivery.AWAITING_PAYMENT, 1, self.swift.staff_id))
        self.assertIsNotNone(row.first_leg_ended_at)
        notice = Notification.objects.filter(customer=self.customer).order_by("-id").first()
        self.assertIn("Pay GH₵ 15.00", notice.title)
        self.assertEqual(notice.link, "/my-account")

    def test_request_refused_for_a_wholly_refunded_order(self):
        from ledger import refunds

        order = self.unavailable()
        refunds.refund_order(order, source="cancel")
        self.refused(order)

    def test_request_needs_a_reason(self):
        with self.assertRaises(RedeliveryError) as raised:
            redelivery.request(self.unavailable(), self.support, "   ")
        self.assertEqual(raised.exception.status_code, 400)

    def test_request_snapshots_fee_from_setting(self):
        MoneySetting.objects.create(key="redelivery_fee_pesewas", value=2500, effective_from=timezone.now() - timedelta(minutes=1))
        row = self.ask(self.unavailable())
        self.assertEqual(row.fee_pesewas, 2500)

    def test_setting_change_does_not_change_open_request(self):
        row = self.ask(self.unavailable())
        MoneySetting.objects.create(key="redelivery_fee_pesewas", value=900, effective_from=timezone.now() - timedelta(seconds=1))
        row.refresh_from_db()
        self.assertEqual(row.fee_pesewas, 1500)
        self.pay(row)
        self.assertEqual(row.pay_journal.lines.first().amount, 1500)

    def test_a_free_redelivery_needs_no_payment(self):
        MoneySetting.objects.create(key="redelivery_fee_pesewas", value=0, effective_from=timezone.now() - timedelta(minutes=1))
        row = self.ask(self.unavailable())
        self.assertEqual((row.status, row.fee_pesewas, row.pay_journal), (Redelivery.PAID, 0, None))

    def test_one_open_redelivery_per_order(self):
        order = self.unavailable()
        self.ask(order)
        self.refused(order, "redelivery_open")
        self.assertEqual(Redelivery.objects.filter(order=order).count(), 1)
        redelivery.cancel(Redelivery.objects.get(order=order).pk, self.support)
        second = self.ask(order)                                          # a closed request does not block a new one
        self.assertEqual(second.attempt, 2)

    def test_cancel_before_payment(self):
        row = self.ask(self.unavailable())
        redelivery.cancel(row.pk, self.support)
        row.refresh_from_db()
        self.assertEqual((row.status, row.refund_journal), (Redelivery.CANCELLED, None))
        self.assertIsNotNone(row.cancelled_at)

    def test_cancel_refused_once_assigned(self):
        order = self.unavailable()
        row = self.ask(order)
        self.pay(row)
        self.second_trip(order, self.own)
        with self.assertRaises(RedeliveryError) as raised:
            redelivery.cancel(row.pk, self.support)
        self.assertEqual(raised.exception.code, "redelivery_not_cancellable")

    def test_a_second_payment_after_the_first_goes_to_the_wallet(self):
        order = self.unavailable()
        row = self.ask(order)
        self.pay(row, wallet=False)
        session = self.pay(row, wallet=False)              # a second mobile-money session for the same request lands later
        row.refresh_from_db()
        self.assertEqual(row.status, Redelivery.PAID)
        session.refresh_from_db()
        self.assertEqual(session.metadata["journal_key"], f"redelivery-stray-{session.reference}")
        self.assertEqual(self.wallet(), 1500)
        self.assert_balanced()


class RedeliverPermissionSeedTests(RedeliveryBase):
    def test_orders_redeliver_is_seeded_to_support_pickup_desk_and_super_admin(self):
        from accounts.models import Role

        holders = sorted(Role.objects.filter(permissions__codename="orders.redeliver").values_list("name", flat=True))
        self.assertEqual(holders, ["pickup_desk", "super_admin", "support"])


@override_settings(LEDGER_ENABLED=False)
class RedeliveryLedgerOffTests(RedeliveryBase):
    def test_nothing_runs_while_the_ledger_is_off(self):
        with override_settings(LEDGER_ENABLED=True):
            order = self.unavailable()
        with self.assertRaises(RedeliveryError) as raised:
            self.ask(order)
        self.assertEqual(raised.exception.code, "ledger_off")
        self.assertFalse(Redelivery.objects.exists())

