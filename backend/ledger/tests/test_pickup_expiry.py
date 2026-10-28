"""Store-pickup orders nobody collected within the pickup window are refunded to the wallet, cancelled and restocked
(wallets plan 3a, Task 8; spec §4.3). Review Focus 8: the desk racing the job."""
from datetime import timedelta

from unittest.mock import patch

from django.conf import settings
from django.test import override_settings
from django.utils import timezone

from disputes.models import Dispute
from ledger import posting, refunds, tasks, verification
from ledger.models import Account, FulfilmentCheck, MoneySetting, OrderRefund
from notifications.models import Notification
from orders.models import Order

from .test_refunds import RefundBase


@override_settings(LEDGER_ENABLED=True)
class PickupExpiryTests(RefundBase):
    def pickup(self, hours_ago, stock=3):
        self.kofi = self.owner("Kofi")
        self.item = self.listing(self.kofi, "60.00")
        self.item.stock_quantity = stock
        self.item.save(update_fields=["stock_quantity"])
        order = self.paid([(self.item, 2)])                                                   # store pickup is the default
        Order.objects.filter(pk=order.pk).update(placed_at=timezone.now() - timedelta(hours=hours_ago))
        return order

    def test_an_order_not_collected_in_24_hours_goes_back_to_the_wallet(self):
        order = self.pickup(hours_ago=25)
        self.assertEqual(verification.expire_uncollected(), 1)
        order.refresh_from_db()
        self.assertEqual(order.status, Order.CANCELLED)
        self.assertEqual(self.wallet(), 12000)
        self.assertEqual(self.balance(Account.VENDOR_PENDING, self.kofi), 0)
        self.assertEqual(OrderRefund.objects.get(order=order).source, "pickup_expired")
        self.item.refresh_from_db()
        self.assertEqual(self.item.stock_quantity, 5)                                         # the 2 reserved go back on the shelf
        notice = Notification.objects.filter(customer=self.customer).latest("id")
        self.assertEqual(notice.title, "Your order was not collected")
        self.assertIn("GH₵ 120.00 went back to your AshantiHub wallet", notice.body)
        self.assertEqual(verification.expire_uncollected(), 0)                                # once only

    def test_an_order_still_inside_the_window_is_left(self):
        order = self.pickup(hours_ago=23)
        self.assertEqual(verification.expire_uncollected(), 0)
        order.refresh_from_db()
        self.assertEqual(order.status, Order.PAID)

    def test_the_window_is_the_governed_setting(self):
        MoneySetting.objects.create(key="pickup_window_hours", value=48, effective_from=timezone.now() - timedelta(days=3))
        order = self.pickup(hours_ago=30)
        self.assertEqual(verification.expire_uncollected(), 0)
        order.refresh_from_db()
        self.assertEqual(order.status, Order.PAID)

    def test_review_focus_a_collected_order_is_never_refunded(self):
        order = self.pickup(hours_ago=30)
        FulfilmentCheck.objects.update_or_create(order=order, defaults=dict(collected_at=timezone.now() - timedelta(hours=1)))
        self.assertEqual(verification.expire_uncollected(), 0)
        order.refresh_from_db()
        self.assertEqual(order.status, Order.PAID)
        self.assertEqual(self.wallet(), 0)

    def test_review_focus_the_desk_collecting_after_the_job_read_its_list_wins(self):
        order = self.pickup(hours_ago=30)
        FulfilmentCheck.objects.update_or_create(order=order, defaults=dict(collected_at=timezone.now()))              # collected after `due` was read
        self.assertEqual(verification.expire_one(order.pk, 24), 0)
        order.refresh_from_db()
        self.assertEqual((order.status, self.wallet(), OrderRefund.objects.count()), (Order.PAID, 0, 0))

    def test_one_order_the_ledger_refuses_does_not_stop_the_others(self):
        first = self.pickup(hours_ago=30)
        first_item = self.item
        second = self.pickup(hours_ago=29)
        second_item = self.item
        real, calls = refunds.refund_order, []

        def flaky(order, *args, **kwargs):
            calls.append(order.pk)
            if len(calls) == 1:
                raise posting.PostingError("refused")
            return real(order, *args, **kwargs)

        with patch("ledger.refunds.refund_order", side_effect=flaky), self.assertLogs("ledger.verification", level="ERROR"):
            self.assertEqual(verification.expire_uncollected(), 1)
        self.assertEqual(calls, [first.pk, second.pk])
        first.refresh_from_db(), second.refresh_from_db(), first_item.refresh_from_db(), second_item.refresh_from_db()
        self.assertEqual((first.status, first_item.stock_quantity), (Order.PAID, 3))          # rolled back: still paid, stock untouched
        self.assertEqual((second.status, second_item.stock_quantity), (Order.CANCELLED, 5))

    def test_an_order_with_an_open_dispute_is_left_for_a_person(self):
        order = self.pickup(hours_ago=30)
        Dispute.objects.create(order=order, raised_by=self.customer, reason=Dispute.ORDER_ISSUE, description="Wrong item", status=Dispute.OPEN)
        self.assertEqual(verification.expire_uncollected(), 0)
        self.assertEqual(self.wallet(), 0)

    def test_an_order_paid_before_the_ledger_was_on_is_left(self):
        kofi = self.owner("Kofi")
        order = self.order([(self.listing(kofi, "60.00"), 1)])                                # no payment journal
        Order.objects.filter(pk=order.pk).update(placed_at=timezone.now() - timedelta(hours=30))
        self.assertEqual(verification.expire_uncollected(), 0)
        order.refresh_from_db()
        self.assertEqual(order.status, Order.PAID)

    def test_an_order_paid_before_the_ledger_was_on_is_not_even_selected(self):
        kofi = self.owner("Kofi")
        old = self.order([(self.listing(kofi, "60.00"), 1)])                                  # no payment journal
        Order.objects.filter(pk=old.pk).update(placed_at=timezone.now() - timedelta(hours=30))
        recorded = self.pickup(hours_ago=30)
        with patch("ledger.verification.expire_one", return_value=0) as expire:
            verification.expire_uncollected()
        self.assertEqual([call.args[0] for call in expire.call_args_list], [recorded.pk])

    def test_the_hourly_task_runs_it(self):
        self.pickup(hours_ago=25)
        self.assertEqual(tasks.refund_uncollected_pickups(), 1)
        entry = settings.CELERY_BEAT_SCHEDULE["ledger-refund-uncollected-pickups"]
        self.assertEqual(entry["task"], "ledger.tasks.refund_uncollected_pickups")


class PickupExpiryLedgerOffTests(RefundBase):
    def test_nothing_happens_while_the_ledger_is_off(self):
        kofi = self.owner("Kofi")
        order = self.order([(self.listing(kofi, "60.00"), 1)])
        Order.objects.filter(pk=order.pk).update(placed_at=timezone.now() - timedelta(hours=30))
        self.assertEqual(verification.expire_uncollected(), 0)
        order.refresh_from_db()
        self.assertEqual(order.status, Order.PAID)
