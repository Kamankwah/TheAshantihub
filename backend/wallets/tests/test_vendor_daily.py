"""The business's money day by day (vendor plan 4, Task 2), from its own ledger lines. Review Focus 1 (only its own
accounts), 3 (the columns add up to the change in its balances) and 4 (day boundaries, ranges)."""
from datetime import date, datetime, timedelta
from decimal import Decimal
from unittest import mock
from zoneinfo import ZoneInfo

from django.test import override_settings
from django.utils import timezone

from ledger import refunds
from ledger.models import Account
from wallets import vendor

from .helpers import fund
from .vendor_helpers import VendorBase, hold, paid_order, release, signed_in, waived

DAILY, OVERVIEW = "/api/wallet/vendor/daily/", "/api/wallet/vendor/"
ACCRA = ZoneInfo("Africa/Accra")


def at(moment):
    """Everything inside happens at `moment` (journals are append-only, so they are written then, never back-dated)."""
    return mock.patch("django.utils.timezone.now", return_value=moment)


class LedgerOffTests(VendorBase):
    def test_review_focus_the_daily_summary_says_ledger_off(self):
        response = self.kofi.get(DAILY)
        self.assertEqual((response.status_code, response.json()["code"]), (409, "ledger_off"))


@override_settings(LEDGER_ENABLED=True)
class DailySummaryTests(VendorBase):
    def test_a_day_of_sales_a_release_and_a_refund(self):
        first = paid_order(self.buyer, [(self.kofi.listing("120.00"), 1)])
        second = paid_order(self.buyer, [(self.kofi.listing("600.00"), 1)])
        release(first)                                                                          # fee 5.00, 115.00 to Available
        refunds.refund_order(second, 10000, source="dispute-4")                                 # 100.00 back before release
        day = self.kofi.get(DAILY).json()["days"][0]
        self.assertEqual(day["day"], timezone.localdate().isoformat())
        self.assertEqual(
            (day["orders"], day["sold"], day["fees"], day["released"], day["refunded"], day["net_change"]),
            (2, "720.00", "5.00", "115.00", "100.00", "615.00"),
        )

    def test_review_focus_the_columns_add_up_to_the_change_in_the_balances(self):
        big = paid_order(self.buyer, [(self.kofi.listing("600.00"), 1)])
        release(big)                                                                            # fee 6.00
        refunds.refund_order(big, 15000, source="dispute-5")                                    # after release: 1.50 of the fee back
        promo = paid_order(self.buyer, [(self.kofi.listing("120.00"), 1)], delivery="0.00")
        waived(self.kofi.owner, promo, "15.00")
        release(promo)                                                                          # fee 5.00, then the 15.00 promo
        paid_order(self.buyer, [(self.kofi.listing("80.00"), 1)])                              # still waiting
        hold(self.kofi.owner, 20000, "hold-1")                                                 # a withdrawal
        fund(Account.VENDOR_AVAILABLE, self.kofi.owner, 1000, "fund-other")                   # any other movement
        totals = self.kofi.get(DAILY).json()["totals"]
        self.assertEqual(
            (totals["sold"], totals["fees"], totals["refunded"], totals["free_delivery_promo"], totals["withdrawn"], totals["other"]),
            ("800.00", "11.00", "148.50", "15.00", "200.00", "10.00"),
        )

        def figure(key):
            return Decimal(totals[key])

        self.assertEqual(
            figure("sold") - figure("fees") - figure("refunded") - figure("free_delivery_promo") - figure("withdrawn") + figure("other"),
            figure("net_change"),
        )
        overview = self.kofi.get(OVERVIEW).json()
        self.assertEqual(figure("net_change"), Decimal(overview["pending"]) + Decimal(overview["available"]))

    def test_review_focus_a_sale_before_midnight_and_its_release_after_fall_on_their_own_days(self):
        with at(datetime(2026, 10, 14, 23, 59, 30, tzinfo=ACCRA)):
            order = paid_order(self.buyer, [(self.kofi.listing("120.00"), 1)])
        with at(datetime(2026, 10, 15, 0, 0, 30, tzinfo=ACCRA)):
            release(order)
        body = self.kofi.get(DAILY, {"date_from": "2026-10-14", "date_to": "2026-10-15"}).json()
        self.assertEqual(
            [(d["day"], d["orders"], d["sold"], d["fees"], d["released"]) for d in body["days"]],
            [("2026-10-15", 0, "0.00", "5.00", "115.00"), ("2026-10-14", 1, "120.00", "0.00", "0.00")],
        )
        only_the_14th = self.kofi.get(DAILY, {"date_from": "2026-10-14", "date_to": "2026-10-14"}).json()
        self.assertEqual([d["day"] for d in only_the_14th["days"]], ["2026-10-14"])
        # Africa/Accra is UTC+0, so the checks above cannot tell an Accra day from a UTC day. This one can: in a zone an
        # hour ahead, the 14th starts at 23:00 UTC on the 13th.
        with override_settings(TIME_ZONE="Africa/Lagos"):
            start, _ = vendor.bounds(date(2026, 10, 14), date(2026, 10, 14))
        self.assertEqual(start, datetime(2026, 10, 13, 23, 0, tzinfo=ZoneInfo("UTC")))

    def test_review_focus_bad_or_too_long_ranges_are_refused(self):
        for params in (
            {"date_from": "2026-13-01"}, {"date_from": "yesterday"}, {"date_from": "2026-10-10", "date_to": "2026-10-01"},
            {"date_from": "2026-01-01", "date_to": "2026-10-16"},
            {"date_to": "0001-01-05"}, {"date_from": "9999-12-30", "date_to": "9999-12-31"},      # would overflow a day sum
        ):
            response = self.kofi.get(DAILY, params)
            self.assertEqual(response.status_code, 400, params)
            self.assertIn("date_", next(iter(response.json())))

    def test_the_default_is_the_last_30_days_and_quiet_days_are_left_out(self):
        body = self.kofi.get(DAILY).json()
        today = timezone.localdate()
        self.assertEqual((body["from"], body["to"]), ((today - timedelta(days=29)).isoformat(), today.isoformat()))
        self.assertEqual((body["days"], body["totals"]["net_change"], body["totals"]["orders"]), ([], "0.00", 0))

    def test_review_focus_only_the_businesss_own_accounts_count(self):
        paid_order(self.buyer, [(self.kofi.listing("120.00"), 1), (self.esi.listing("600.00"), 1)])
        twin = self.twin()
        fund(Account.CUSTOMER_WALLET, twin, 99900, "fund-twin")                               # same id number, a customer's wallet
        totals = self.kofi.get(DAILY).json()["totals"]
        self.assertEqual((totals["orders"], totals["sold"], totals["net_change"]), (1, "120.00", "120.00"))
        self.assertEqual(signed_in(twin, "customer").get(DAILY).status_code, 403)
