"""A re-delivery fee in the ledger (Plan 7F-E Task 7, owner Rulings R4 and R5).

The first rider completed the trip and the customer was away; at the customer's request the order is delivered again for
an extra fee the customer pays first. The fee waits in the order's Re-delivery payable, becomes platform delivery income
when the second (in-house) rider completes the trip, and goes back to the wallet when the request is cancelled after
payment or the order is refunded whole before the second rider collected anything. The first rider keeps the ORIGINAL
delivery fee: paid once at release when third-party, platform income when in-house, never returned by a refund."""
from datetime import timedelta

from django.test import override_settings
from django.utils import timezone

from delivery import redelivery
from delivery.models import Redelivery, RiderEarning
from disputes.models import Dispute
from ledger import approval_kinds, posting, refunds
from ledger import redelivery as books
from ledger import settings_store
from ledger.models import Account, Journal, JournalLine, MoneySetting

from .redelivery_helpers import RedeliveryBase


@override_settings(LEDGER_ENABLED=True)
class RedeliveryLedgerTests(RedeliveryBase):
    def payable(self, order):
        return posting.balance_of(Account.REDELIVERY_PAYABLE, order)

    def income(self):
        return posting.balance_of(Account.PLATFORM_DELIVERY_INCOME)

    def lines(self, key):
        return sorted((l.account.kind, l.side, l.amount) for l in JournalLine.objects.filter(journal__key=key).select_related("account"))

    def paid_request(self, order=None, *, wallet=True):
        order = order or self.unavailable()
        row = self.ask(order)
        self.pay(row, wallet=wallet)
        return order, row

    def test_payment_journal_balances(self):
        order, row = self.paid_request()
        self.assertEqual((row.status, row.fee_pesewas), (Redelivery.PAID, 1500))
        self.assertEqual(row.pay_journal.key, f"redelivery-pay-{row.pk}")
        self.assertEqual(self.lines(row.pay_journal.key), [
            (Account.CUSTOMER_WALLET, JournalLine.DEBIT, 1500), (Account.REDELIVERY_PAYABLE, JournalLine.CREDIT, 1500),
        ])
        self.assertEqual(self.payable(order), 1500)
        self.assertEqual(self.wallet(), 0)
        # By mobile money: provider clearing is debited instead (net of any processing charge).
        order2, row2 = self.paid_request(self.unavailable(self.door_order()), wallet=False)
        self.assertEqual(self.lines(row2.pay_journal.key), [
            (Account.PROVIDER_CLEARING, JournalLine.DEBIT, 1500), (Account.REDELIVERY_PAYABLE, JournalLine.CREDIT, 1500),
        ])
        self.assertEqual(row2.checkout_session.metadata["journal_key"], row2.pay_journal.key)
        self.assert_balanced()

    def test_payment_of_the_wrong_amount_is_refused(self):
        order = self.unavailable()
        row = self.ask(order)
        Redelivery.objects.filter(pk=row.pk).update(fee_pesewas=2000)    # the session below pays 15.00, the request says 20.00
        with self.assertRaises(books.RedeliveryPostingError):
            self.pay(row, wallet=False)
        self.assertEqual(Redelivery.objects.get(pk=row.pk).status, Redelivery.AWAITING_PAYMENT)

    def test_completion_books_platform_income_and_records_rider_owed(self):
        order, row = self.paid_request()
        self.second_trip(order, self.own)
        row.refresh_from_db()
        self.assertEqual((row.status, row.rider_id), (Redelivery.ASSIGNED, self.own.staff_id))
        before = self.income()
        self.collect_all(order, self.own)
        self.deliver(order, self.own)
        row.refresh_from_db()
        self.assertEqual((row.status, row.rider_id), (Redelivery.COMPLETED, self.own.staff_id))
        self.assertIsNotNone(row.completed_at)
        self.assertEqual(self.lines(row.settle_journal.key), [
            (Account.PLATFORM_DELIVERY_INCOME, JournalLine.CREDIT, 1500), (Account.REDELIVERY_PAYABLE, JournalLine.DEBIT, 1500),
        ])
        self.assertEqual(self.income() - before, 1500)
        self.assertEqual(self.payable(order), 0)
        self.assertEqual(posting.balance_of(Account.RIDER_BALANCE, self.own.staff), 0)    # in-house: no wallet, owed via payroll
        self.assert_balanced()

    def test_failed_second_trip_after_pickup_keeps_the_fee(self):
        order, row = self.paid_request()
        self.second_trip(order, self.own)
        self.collect_all(order, self.own)
        from delivery import services

        from .redelivery_helpers import HERE

        services.cant_deliver(self.job(order), self.own.staff, "refused", "Customer refused", *HERE, 10)
        row.refresh_from_db()
        self.assertEqual(row.status, Redelivery.COMPLETED)
        self.assertEqual(self.payable(order), 0)
        self.assertTrue(Journal.objects.filter(key=books.settle_key(row)).exists())

    def test_cancel_after_payment_refunds_wallet(self):
        order, row = self.paid_request()
        self.assertEqual(self.wallet(), 0)
        redelivery.cancel(row.pk, self.support)
        row.refresh_from_db()
        self.assertEqual(row.status, Redelivery.REFUNDED)
        self.assertEqual(self.lines(row.refund_journal.key), [
            (Account.CUSTOMER_WALLET, JournalLine.CREDIT, 1500), (Account.REDELIVERY_PAYABLE, JournalLine.DEBIT, 1500),
        ])
        self.assertEqual(self.wallet(), 1500)
        self.assertEqual(self.payable(order), 0)
        self.assert_balanced()

    def test_whole_order_refund_before_second_pickup_returns_redelivery_fee(self):
        order, row = self.paid_request()
        self.second_trip(order, self.own)               # assigned, nothing collected yet
        refund = refunds.refund_order(order, source="cancel")
        row.refresh_from_db()
        self.assertEqual(row.status, Redelivery.REFUNDED)
        self.assertEqual(refund.amount_pesewas, 10000)                  # the goods; the original fee is the first rider's
        self.assertEqual(refund.delivery_kept_pesewas, 1500)
        self.assertEqual(self.wallet(), 10000 + 1500)                   # plus the re-delivery fee, in full
        self.assertEqual(self.payable(order), 0)
        # The re-assignment cleared the first leg's pickup stamps, yet Swift (third-party) is paid the original fee at the
        # refund: the Redelivery row names the first rider (riders.fee_rider), tested at the end of their leg.
        self.assertEqual(RiderEarning.objects.get(order=order).rider_id, self.swift.pk)
        self.assertEqual(posting.balance_of(Account.RIDER_BALANCE, self.swift.staff), 1350)
        self.assert_balanced()

    def test_whole_order_refund_after_second_pickup_settles_fee_and_does_not_return_it(self):
        order, row = self.paid_request()
        self.second_trip(order, self.own)
        self.collect_all(order, self.own)
        before = self.income()
        refund = refunds.refund_order(order, source="cancel")
        row.refresh_from_db()
        self.assertEqual((row.status, row.rider_id), (Redelivery.COMPLETED, self.own.staff_id))
        self.assertTrue(Journal.objects.filter(key=books.settle_key(row)).exists())
        self.assertFalse(Journal.objects.filter(key=books.refund_key(row)).exists())
        self.assertEqual(refund.amount_pesewas, 10000)
        self.assertEqual(self.wallet(), 10000)                          # the re-delivery fee is not returned
        self.assertEqual(self.income() - before, 1500)                  # the re-delivery fee; the original fee went on to Swift
        self.assertEqual(posting.balance_of(Account.RIDER_BALANCE, self.swift.staff), 1350)
        self.assertEqual(self.payable(order), 0)
        self.assert_balanced()

    def test_whole_refund_of_an_unpaid_request_cancels_it(self):
        order = self.unavailable()
        row = self.ask(order)
        refunds.refund_order(order, source="cancel")
        row.refresh_from_db()
        self.assertEqual(row.status, Redelivery.CANCELLED)
        self.assertIsNone(row.refund_journal)

    def test_goods_partial_refund_leaves_redelivery_fee(self):
        order, row = self.paid_request()
        refund = refunds.refund_order(order, 2000, source="dispute-1")
        self.assertFalse(refund.whole)
        row.refresh_from_db()
        self.assertEqual(row.status, Redelivery.PAID)
        self.assertEqual(self.payable(order), 1500)
        self.assertEqual(self.wallet(), 2000)

    def test_refund_cap_unchanged_by_redelivery_fee(self):
        order = self.unavailable()
        before = refunds.left(order)
        self.assertEqual((before.customer, before.delivery, before.partial), (10000, 0, 10000))   # R1: the fee is kept
        self.paid_request(order)
        self.assertEqual(refunds.left(order), before)
        self.assertEqual(refunds.refundable(order), 10000)

    def test_first_rider_keeps_original_fee_third_party(self):
        order, row = self.paid_request()                     # Swift (third-party) made the first trip
        self.second_trip(order, self.own)
        self.collect_all(order, self.own)
        self.deliver(order, self.own)
        Dispute.objects.filter(order=order).update(status=Dispute.RESOLVED)   # the failed trip's case is closed
        self.release(order)
        earning = RiderEarning.objects.get(order=order)
        self.assertEqual((earning.rider_id, earning.gross_pesewas), (self.swift.pk, 1500))
        self.assertEqual(posting.balance_of(Account.RIDER_BALANCE, self.swift.staff), 1350)
        self.assertEqual(posting.balance_of(Account.RIDER_RESERVE, self.swift.staff), 150)
        self.assertEqual(posting.balance_of(Account.RIDER_BALANCE, self.own.staff), 0)
        self.assertEqual(RiderEarning.objects.filter(order=order).count(), 1)
        # A whole refund after release pays nobody twice.
        refunds.refund_order(order, source="dispute-9")
        self.assertEqual(RiderEarning.objects.filter(order=order).count(), 1)
        self.assertEqual(posting.balance_of(Account.RIDER_BALANCE, self.swift.staff), 1350)
        self.assert_balanced()

    def test_first_rider_in_house_original_fee_platform_income(self):
        order, row = self.paid_request(self.unavailable(rider_row=self.own))
        self.second_trip(order, self.own2)
        self.collect_all(order, self.own2)
        self.deliver(order, self.own2)
        Dispute.objects.filter(order=order).update(status=Dispute.RESOLVED)
        self.release(order)
        self.assertFalse(RiderEarning.objects.filter(order=order).exists())
        self.assertEqual(self.income(), 1500 + 1500)        # the original fee and the re-delivery fee
        self.assert_balanced()

    def test_original_fee_never_returned_after_customer_unavailable_trip(self):
        order = self.unavailable()
        row = self.ask(order)
        redelivery.cancel(row.pk, self.support)            # the customer decided not to pay
        # The goods came back to AshantiHub; the order is refunded whole. The first trip was made: the fee is the rider's.
        refund = refunds.refund_order(order, source="cancel")
        self.assertEqual((refund.amount_pesewas, refund.delivery_pesewas, refund.delivery_kept_pesewas), (10000, 0, 1500))
        self.assertEqual(self.wallet(), 10000)
        self.assertEqual(posting.balance_of(Account.RIDER_BALANCE, self.swift.staff), 1350)   # settled to Swift
        self.assert_balanced()

    def test_redelivery_fee_setting_definition_and_consequence_text(self):
        definition = settings_store.DEFINITIONS["redelivery_fee_pesewas"]
        self.assertEqual((definition.default, definition.nullable, definition.minimum, definition.maximum), (1500, False, 0, 20000))
        self.assertEqual(settings_store.current("redelivery_fee_pesewas"), 1500)

        class Request:
            payload = {"key": "redelivery_fee_pesewas", "value": 2000}

        self.assertIn("Applies to re-deliveries requested after it starts", approval_kinds.setting_consequences(Request())[0])
        self.assertTrue(approval_kinds.MONEY_SETTING.requires_sudo)
        self.assertEqual(approval_kinds.MONEY_SETTING.chain_note, "Super Admin only")
        # A later change changes no open request.
        order = self.unavailable()
        row = self.ask(order)
        MoneySetting.objects.create(key="redelivery_fee_pesewas", value=3000, effective_from=timezone.now() - timedelta(seconds=1))
        row.refresh_from_db()
        self.assertEqual(row.fee_pesewas, 1500)


@override_settings(LEDGER_ENABLED=True)
class RedeliveryRiderPayTests(RedeliveryBase):
    """Who is paid the re-delivery fee (Director ruling 2, 2026-10-20): the rider who completes the second trip. An
    AshantiHub rider is paid through payroll (the Redelivery row records rider and time); a third-party rider, who may take
    the second trip only when no in-house rider is available, is paid through their wallet exactly as a delivery fee is:
    gross split at the rider commission rate in force when the fee was paid into Rider balance (withdrawable) and Rider
    reserve (AshantiHub's commission, posted at the end of the day), with a RiderEarning for the re-delivery."""

    def lines(self, key):
        return sorted((l.account.kind, l.side, l.amount) for l in JournalLine.objects.filter(journal__key=key).select_related("account"))

    def balances(self, row):
        return posting.balance_of(Account.RIDER_BALANCE, row.staff), posting.balance_of(Account.RIDER_RESERVE, row.staff)

    def fallback_trip(self):
        """Swift (third-party) made the first trip; the customer paid; no AshantiHub rider is available, so Kwesi (another
        third-party rider) is given the second trip."""
        order = self.unavailable()
        row = self.ask(order)
        self.pay(row)
        kwesi = self.third()
        self.second_trip(order, kwesi)
        return order, row, kwesi

    def test_a_third_party_second_rider_is_paid_the_fee_through_the_wallet(self):
        order, row, kwesi = self.fallback_trip()
        income = posting.balance_of(Account.PLATFORM_DELIVERY_INCOME)
        self.collect_all(order, kwesi)
        self.deliver(order, kwesi)
        row.refresh_from_db()
        self.assertEqual((row.status, row.rider_id), (Redelivery.COMPLETED, kwesi.staff_id))
        self.assertEqual(self.lines(f"redelivery-rider-{row.pk}"), [
            (Account.PLATFORM_DELIVERY_INCOME, JournalLine.DEBIT, 1500),
            (Account.RIDER_BALANCE, JournalLine.CREDIT, 1350), (Account.RIDER_RESERVE, JournalLine.CREDIT, 150),
        ])
        earning = RiderEarning.objects.get(redelivery=row)
        self.assertEqual((earning.rider_id, earning.order_id, earning.gross_pesewas, earning.commission_bp, earning.reserve_pesewas,
                          earning.net_pesewas), (kwesi.pk, None, 1500, 1000, 150, 1350))
        self.assertEqual(self.balances(kwesi), (1350, 150))
        self.assertEqual(posting.balance_of(Account.PLATFORM_DELIVERY_INCOME), income)   # the fee went on to the rider
        self.assertEqual(posting.balance_of(Account.REDELIVERY_PAYABLE, order), 0)
        self.assertFalse(row.owed_through_payroll)
        self.assertEqual(redelivery.staff_row(row)["paid_through"], "wallet")
        self.assert_balanced()

    def test_an_in_house_second_rider_is_owed_through_payroll(self):
        order = self.unavailable()
        row = self.ask(order)
        self.pay(row)
        self.second_trip(order, self.own)
        self.collect_all(order, self.own)
        self.deliver(order, self.own)
        row.refresh_from_db()
        self.assertFalse(RiderEarning.objects.filter(redelivery=row).exists())
        self.assertFalse(Journal.objects.filter(key=f"redelivery-rider-{row.pk}").exists())
        self.assertEqual(self.balances(self.own), (0, 0))
        self.assertTrue(row.owed_through_payroll)
        self.assertEqual(redelivery.staff_row(row)["paid_through"], "payroll")

    def test_the_rate_is_the_one_in_force_when_the_fee_was_paid(self):
        order, row, kwesi = self.fallback_trip()
        # A new rate starts after the customer paid the fee and before the trip is done: the old rate still applies.
        MoneySetting.objects.create(key="rider_commission_bp", value=2000, effective_from=row.paid_at + timedelta(microseconds=1))
        self.collect_all(order, kwesi)
        self.deliver(order, kwesi)
        earning = RiderEarning.objects.get(redelivery=row)
        self.assertEqual((earning.commission_bp, earning.reserve_pesewas, earning.net_pesewas), (1000, 150, 1350))

    def test_a_third_party_second_rider_who_failed_after_collecting_is_still_paid(self):
        from delivery import services

        from .redelivery_helpers import HERE

        order, row, kwesi = self.fallback_trip()
        self.collect_all(order, kwesi)
        services.cant_deliver(self.job(order), kwesi.staff, "wrong_address", "Gate locked", *HERE, 10)
        self.assertEqual(self.balances(kwesi), (1350, 150))
        self.assertEqual(RiderEarning.objects.filter(redelivery=row).count(), 1)

    def test_a_whole_refund_after_the_third_party_second_pickup_pays_that_rider(self):
        order, row, kwesi = self.fallback_trip()
        self.collect_all(order, kwesi)
        refunds.refund_order(order, source="cancel")
        row.refresh_from_db()
        self.assertEqual(row.status, Redelivery.COMPLETED)
        self.assertEqual(self.balances(kwesi), (1350, 150))                       # the re-delivery fee
        self.assertEqual(self.balances(self.swift), (1350, 150))                  # the original fee, first rider (Ruling R4)
        self.assertEqual(self.wallet(), 10000)                                    # the goods only; both fees were earned
        self.assert_balanced()

    def test_no_double_pay(self):
        """Each fee is paid once, to its own rider: the original fee to the first rider at release, the re-delivery fee to
        the second rider when the second trip is done. Settling again, a release and a later whole refund pay nobody
        twice, and the second rider is never also owed through payroll."""
        order, row, kwesi = self.fallback_trip()
        self.collect_all(order, kwesi)
        self.deliver(order, kwesi)
        row.refresh_from_db()
        self.assertIsNone(books.credit_rider(row, RiderEarning.objects.get(redelivery=row).rider))   # already paid
        Dispute.objects.filter(order=order).update(status=Dispute.RESOLVED)
        self.release(order)
        from ledger import escrow

        self.assertIsNone(escrow.release_verified(order))                       # a second release does nothing
        refunds.refund_order(order, source="dispute-9")
        self.assertEqual(sorted(RiderEarning.objects.values_list("rider_id", "order_id", "redelivery_id")),
                         sorted([(self.swift.pk, order.pk, None), (kwesi.pk, None, row.pk)]))
        self.assertEqual(self.balances(self.swift), (1350, 150))
        self.assertEqual(self.balances(kwesi), (1350, 150))
        self.assertEqual(Journal.objects.filter(key__startswith="redelivery-rider-").count(), 1)
        self.assertFalse(Redelivery.objects.get(pk=row.pk).owed_through_payroll)
        self.assert_balanced()

    def test_the_end_of_day_job_posts_the_redelivery_commission(self):
        from ledger import riders

        order, row, kwesi = self.fallback_trip()
        self.collect_all(order, kwesi)
        self.deliver(order, kwesi)
        earning = RiderEarning.objects.get(redelivery=row)
        posted = riders.post_day(kwesi.pk, earning.earned_on, now=timezone.now() + timedelta(days=1))
        self.assertEqual((posted.deliveries, posted.gross_pesewas, posted.commission_pesewas), (1, 1500, 150))
        self.assertEqual(self.balances(kwesi), (1350, 0))
        self.assertIsNone(riders.post_day(kwesi.pk, earning.earned_on, now=timezone.now() + timedelta(days=1)))

    def test_the_rider_wallet_lists_the_redelivery_earning(self):
        from wallets import rider_wallet

        order, row, kwesi = self.fallback_trip()
        self.collect_all(order, kwesi)
        self.deliver(order, kwesi)
        listed = [rider_wallet.earning_row(e) for e in rider_wallet.earnings(kwesi)]
        self.assertEqual([(e["order"], e["kind"], e["gross"], e["you_got"]) for e in listed], [(order.pk, "redelivery", "15.00", "13.50")])
        self.assertIsNotNone(listed[0]["delivered_at"])
        self.assertEqual(rider_wallet.LABELS["rider_redelivery_earning"], "Re-delivery paid to you")
