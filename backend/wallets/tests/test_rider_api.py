"""The rider's own wallet API (wallets Plan 5, Task 6; spec §7): balance, reserve, earnings per delivery, each day's
commission, the statement, payout destinations and withdrawals, always the caller's own. AshantiHub's own riders get 409
wallet_disabled; every endpoint answers 409 ledger_off while the ledger is off. Review Focus 4 and 5."""
import json
from datetime import timedelta
from decimal import Decimal

from django.db import connection, transaction
from django.test import TestCase, override_settings
from django.test.utils import CaptureQueriesContext
from django.utils import timezone

from accounts.testing import make_staff
from activity.models import ActivityEvent
from delivery.models import RiderEarning
from ledger import posting, riders
from ledger.models import Account
from ledger.tests import rider_helpers
from notifications.models import Notification
from accounts.models import Customer
from orders.models import DeliveryAssignment, Order
from wallets import withdrawals
from wallets.models import PayoutDestination

from .helpers import Holder, destination

BASE = "/api/delivery/rider/wallet/"
PATHS = ("", "earnings/", "days/", "statement/", "destinations/", "withdrawals/")
MOMO = {"rail": "momo", "institution": "MTN", "account_number": "0241234567"}


@override_settings(LEDGER_ENABLED=True)
class RiderWalletApiTests(TestCase):
    def setUp(self):
        self.swift = rider_helpers.rider()
        rider_helpers.ghana_card(self.swift)
        self.me = Holder(self.swift.staff, "staff")

    def credited(self, gross=1000, rider=None, at=None):
        return rider_helpers.earning(rider or self.swift, gross=gross, at=at or timezone.now())

    def other_rider(self):
        return rider_helpers.rider("fast@example.com", name="Yaw Boateng", phone="+233244000003", company="Fast Riders")

    def test_review_focus_an_ashantihub_rider_is_told_wallets_are_off_everywhere(self):
        own = rider_helpers.rider("own@example.com", third_party=False, phone="+233244000009")
        them = Holder(own.staff, "staff")
        for path in PATHS:
            response = them.get(BASE + path)
            self.assertEqual((response.status_code, response.json()["code"]), (409, "wallet_disabled"), path)
        posted = them.post(
            BASE + "withdrawals/", {"destination": 1, "amount": "5.00", "request_id": "req-own-0001"}, action="withdrawal",
        )
        self.assertEqual((posted.status_code, posted.json()["code"]), (409, "wallet_disabled"))
        home = them.get("/api/delivery/rider/me/").json()["rider"]
        self.assertEqual((home["employment"], home["wallet"]), ("ashantihub", False))

    def test_with_the_ledger_off_every_endpoint_answers_ledger_off(self):
        with override_settings(LEDGER_ENABLED=False):
            for path in PATHS:
                response = self.me.get(BASE + path)
                self.assertEqual((response.status_code, response.json()["code"]), (409, "ledger_off"), path)

    def test_office_staff_cannot_open_a_rider_wallet(self):
        self.assertEqual(Holder(make_staff("accountant", "acc@example.com"), "staff").get(BASE).status_code, 403)

    def test_the_wallet_shows_balance_reserve_rate_and_company(self):
        self.credited(1000)
        body = self.me.get(BASE).json()
        self.assertEqual(
            {key: body[key] for key in ("kind", "balance", "reserve", "commission_bp", "company_name", "awaiting_release")},
            {"kind": "rider", "balance": "9.00", "reserve": "1.00", "commission_bp": 1000, "company_name": "Swift Riders Ltd",
             "awaiting_release": 0},
        )
        home = self.me.get("/api/delivery/rider/me/").json()["rider"]
        self.assertEqual((home["employment"], home["wallet"]), ("third_party", True))

    def test_review_focus_each_rider_sees_only_their_own_earnings_and_statement(self):
        mine, theirs = self.credited(1000), self.credited(2000, rider=self.other_rider())
        rows = self.me.get(BASE + "earnings/").json()["results"]
        self.assertEqual([row["order"] for row in rows], [mine.order_id])
        self.assertEqual(
            {key: rows[0][key] for key in ("gross", "commission_bp", "commission", "you_got", "status")},
            {"gross": "10.00", "commission_bp": 1000, "commission": "1.00", "you_got": "9.00", "status": "reserve_held"},
        )
        lines = self.me.get(BASE + "statement/").json()["results"]
        self.assertEqual(sorted((line["account"], line["amount"], line["order"]) for line in lines),
                         [("balance", "9.00", mine.order_id), ("reserve", "1.00", mine.order_id)])
        self.assertNotIn(theirs.order_id, [line["order"] for line in lines])
        self.assertEqual(self.me.get(BASE + "earnings/", {"day": "2026-13-01"}).status_code, 400)

    def test_each_day_shows_gross_commission_and_net(self):
        yesterday = timezone.now() - timedelta(days=1)
        self.credited(1000, at=yesterday)
        self.credited(2000, at=yesterday)
        riders.post_commission(today=timezone.localdate())
        self.assertEqual(self.me.get(BASE + "days/").json()["results"], [{
            "day": timezone.localdate(yesterday).isoformat(), "deliveries": 2, "gross": "30.00", "commission": "3.00", "net": "27.00",
            "given_back": "0.00",
        }])
        self.assertEqual({row["status"] for row in self.me.get(BASE + "earnings/").json()["results"]}, {"commission_taken"})

    def test_a_delivery_taken_back_after_the_day_was_posted_shows_the_commission_given_back(self):
        yesterday = timezone.now() - timedelta(days=1)
        self.credited(1000, at=yesterday)
        taken_back = self.credited(2000, at=yesterday)
        riders.post_commission(today=timezone.localdate())
        RiderEarning.objects.filter(pk=taken_back.pk).update(reversed_at=timezone.now())     # what riders.reverse_earning records
        day = self.me.get(BASE + "days/").json()["results"][0]
        self.assertEqual((day["commission"], day["given_back"]), ("3.00", "2.00"))            # the day's record is never edited

    def test_payroll_figures_leave_out_a_third_party_riders_deliveries(self):
        own = rider_helpers.rider("own@example.com", third_party=False, phone="+233244000009")
        for row, pay in ((self.swift, "12.00"), (own, "8.00")):
            order = (rider_helpers.earning(row, gross=1000, at=timezone.now()).order if row == self.swift
                     else Order.objects.create(customer=Customer.objects.first(), status=Order.PAID, total_amount=Decimal("0.00")))
            job = rider_helpers.delivered_by(order, row)
            DeliveryAssignment.objects.filter(pk=job.pk).update(rider_pay=Decimal(pay))
        manager = Holder(make_staff("delivery_manager", "dm@example.com"), "staff")
        paid = manager.get("/api/delivery/payouts/").json()["riders"]
        self.assertEqual([row["staff_id"] for row in paid], [own.staff.pk])                    # Accounting cannot pay the wallet rider twice
        self.assertEqual(manager.get(f"/api/delivery/payouts/{self.swift.staff.pk}/").json()["results"], [])
        mine = self.me.get("/api/delivery/rider/earnings/?period=week").json()
        self.assertEqual((mine["jobs"], mine["total"]), (0, None))                              # the rider's pay is the wallet

    def test_review_focus_a_rider_adds_a_destination_with_a_code_and_withdraws(self):
        self.credited(1000)
        refused = self.me.post(BASE + "destinations/", MOMO)
        self.assertEqual((refused.status_code, refused.json()["code"]), (403, "step_up_required"))
        added = self.me.post(BASE + "destinations/", MOMO, action="payout_destination")
        self.assertEqual(added.status_code, 201, added.content)
        self.assertNotIn("1234567", added.content.decode())
        PayoutDestination.objects.filter(pk=added.json()["id"]).update(usable_from=timezone.now() - timedelta(hours=1))
        paid = self.me.post(
            BASE + "withdrawals/", {"destination": added.json()["id"], "amount": "9.00", "request_id": "req-rider-0001"},
            action="withdrawal",
        )
        self.assertEqual((paid.status_code, paid.json()["status"]), (201, "succeeded"), paid.content)
        self.assertEqual(self.me.get(BASE).json()["balance"], "0.00")
        removed = self.me.post(BASE + f"destinations/{added.json()['id']}/remove/", action="payout_destination")
        self.assertEqual(removed.status_code, 204)
        self.assertEqual(
            sorted(ActivityEvent.objects.filter(verb__startswith="wallets.rider_").values_list("verb", flat=True)),
            ["wallets.rider_destination_added", "wallets.rider_destination_removed", "wallets.rider_withdrawal_requested"],
        )
        for event in ActivityEvent.objects.all():                                           # never the number, anywhere
            self.assertNotIn("1234567", json.dumps([event.summary, event.target_label, event.before, event.after]))
        self.assertTrue(Notification.objects.filter(staff=self.swift.staff, kind="payout_destination").exists())

    def test_review_focus_a_rider_cannot_cancel_another_riders_withdrawal(self):
        fast = self.other_rider()
        rider_helpers.ghana_card(fast)
        self.credited(1000, rider=fast)
        to_fast = destination(fast.staff, name="Yaw Boateng")
        with transaction.atomic():
            held = withdrawals.request(fast.staff, destination_id=to_fast.pk, amount_pesewas=500, request_id="req-fast-0001")
        refused = self.me.post(BASE + f"withdrawals/{held.pk}/cancel/")
        self.assertEqual((refused.status_code, refused.json()["code"]), (404, "not_found"))
        self.assertEqual(self.me.get(BASE + "withdrawals/").json()["results"], [])
        cancelled = Holder(fast.staff, "staff").post(BASE + f"withdrawals/{held.pk}/cancel/")
        self.assertEqual((cancelled.status_code, cancelled.json()["status"]), (200, "cancelled"))
        self.assertTrue(ActivityEvent.objects.filter(verb="wallets.rider_withdrawal_cancelled").exists())


@override_settings(LEDGER_ENABLED=True)
class RiderWalletEdgeTests(TestCase):
    def setUp(self):
        self.swift = rider_helpers.rider()
        rider_helpers.ghana_card(self.swift)
        self.me = Holder(self.swift.staff, "staff")

    def test_a_negative_balance_is_shown_honestly_and_cannot_be_withdrawn(self):
        balance, _held = riders.accounts_of(self.swift)
        posting.post(key="test-owe", kind="test_fund", lines=[
            posting.debit(balance, 300), posting.credit(posting.account_for(Account.PLATFORM_DELIVERY_INCOME), 300),
        ], allow_negative=(Account.RIDER_BALANCE,))
        self.assertEqual(self.me.get(BASE).json()["balance"], "-3.00")
        to = destination(self.swift.staff, name="Kojo Mensah")
        refused = self.me.post(
            BASE + "withdrawals/", {"destination": to.pk, "amount": "1.00", "request_id": "req-neg-0001"}, action="withdrawal",
        )
        self.assertEqual((refused.status_code, refused.json()["code"]), (409, "negative_balance"))
        self.assertEqual(self.me.get(BASE).json()["balance"], "-3.00")

    def test_empty_wallet_has_honest_empty_lists(self):
        for path in ("earnings/", "days/", "statement/", "withdrawals/", "destinations/"):
            self.assertEqual(self.me.get(BASE + path).json()["results"], [], path)
        self.assertEqual(self.me.get(BASE).json()["balance"], "0.00")

    def test_the_lists_do_not_grow_queries_with_the_rows(self):
        for _ in range(2):
            rider_helpers.earning(self.swift, gross=1000, at=timezone.now())
        before = {path: self._count(path) for path in ("earnings/", "statement/")}
        for _ in range(5):
            rider_helpers.earning(self.swift, gross=1000, at=timezone.now())
        self.assertEqual({path: self._count(path) for path in before}, before)

    def _count(self, path):
        with CaptureQueriesContext(connection) as ctx:
            self.me.get(BASE + path)
        return len(ctx)

    def test_earning_rows_carry_no_customer_data(self):
        rider_helpers.earning(self.swift, gross=1000, at=timezone.now())
        row = self.me.get(BASE + "earnings/").json()["results"][0]
        self.assertEqual(
            set(row), {"id", "order", "delivered_at", "earned_at", "earned_on", "gross", "commission_bp", "commission", "you_got",
                       "status", "status_label", "reversed_at"},
        )

    def test_every_rider_write_view_is_activity_exempt(self):
        from wallets import views_rider_wallet as v
        for view in (v.RiderDestinationsView, v.RiderDestinationRemoveView, v.RiderWithdrawalsView, v.RiderWithdrawalCancelView):
            self.assertTrue(view.activity_exempt, view.__name__)

    def test_the_account_name_lookup_runs_outside_any_transaction(self):
        from unittest import mock
        from wallets import destinations
        real, depth = destinations.check, []
        def spy(*args, **kwargs):
            depth.append(len(connection.savepoint_ids))
            return real(*args, **kwargs)
        baseline = len(connection.savepoint_ids)
        with mock.patch.object(destinations, "check", spy):
            self.assertEqual(self.me.post(BASE + "destinations/", MOMO, action="payout_destination").status_code, 201)
        self.assertEqual(depth, [baseline])
