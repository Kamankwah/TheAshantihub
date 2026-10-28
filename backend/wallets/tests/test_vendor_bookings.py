"""The business's booking sales on its money API (plan 4F, Task 1): services, stays and event tickets as rows beside
the order rows. Privacy (no customer detail, no problem reason; Director G3), the server's release time and wording,
refunds, filters and the fixed query count."""
import csv
import io
from datetime import datetime, time, timedelta, timezone as dt_timezone
from decimal import Decimal
from unittest.mock import patch

from django.db import connection
from django.test import override_settings
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from accounts.models import Customer
from accounts.testing import make_staff
from events.models import Event
from ledger import sales
from ledger.models import Account, MoneySetting
from ledger.tests.booking_helpers import BookingBase
from wallets import vendor
from wallets.models import Withdrawal

from .helpers import destination
from .vendor_helpers import Shop, customer, hold, paid_order

BOOKINGS, OVERVIEW, SALES = "/api/wallet/vendor/bookings/", "/api/wallet/vendor/", "/api/wallet/vendor/sales/"


class BookingsBase(BookingBase):
    def rows(self, params=None):
        self.as_owner()
        response = self.client.get(BOOKINGS, params or {})
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()["results"]

    def row(self, sale):
        return next(row for row in self.rows() if row["sale"] == sale.pk)

    def done(self, sale, at=None):
        sale.service_request.completed_at = at or timezone.now()
        sale.service_request.save(update_fields=["completed_at"])


class LedgerOffTests(BookingBase):
    def test_ledger_off_bookings_say_ledger_off(self):
        self.as_owner()
        accounts = Account.objects.count()
        response = self.client.get(BOOKINGS)
        self.assertEqual((response.status_code, response.json()["code"]), (409, "ledger_off"))
        self.assertEqual(Account.objects.count(), accounts)


@override_settings(LEDGER_ENABLED=True)
class BookingRowTests(BookingsBase):
    def test_customer_with_the_same_id_and_staff_get_403(self):
        twin = Customer.objects.filter(pk=self.owner.pk).first() or Customer.objects.create(
            pk=self.owner.pk, full_name="Twin", phone="+233241119998", password_hash="x",
        )
        self.as_customer(twin)
        self.assertEqual(self.client.get(BOOKINGS).status_code, 403)
        self.as_staff(make_staff("support", "s-bookings@example.com"))
        self.assertEqual(self.client.get(BOOKINGS).status_code, 403)

    def test_a_paid_service_not_done_waits_for_you(self):
        sale = self.paid_service()
        row = self.row(sale)
        self.assertEqual(
            (row["kind"], row["booking_kind"], row["booking_kind_label"], row["reference"], row["what"]),
            ("booking", "service", "Service", f"Booking #{sale.pk}", "Home Cleaning"),
        )
        self.assertEqual((row["status"], row["status_label"], row["release_at"]), ("awaiting_call", "Waiting for you to mark the service done", None))
        self.assertEqual(
            (row["item_subtotal"], row["refunded"], row["free_delivery_promo"], row["on_hold"], row["customer_accepted"], row["released_at"]),
            ("200.00", "0.00", "0.00", False, False, None),
        )
        self.assertEqual(float(row["net"]), 200 - float(row["platform_fee"]))

    def test_a_done_service_shows_the_servers_release_time(self):
        sale = self.paid_service()
        done = timezone.now() - timedelta(hours=1)
        self.done(sale, done)
        row = self.row(sale)
        self.assertEqual(parse_datetime(row["release_at"]), done + timedelta(hours=48))
        self.assertEqual(row["status_label"], "Waiting for the customer to accept, or the automatic release")
        MoneySetting.objects.create(key="service_auto_accept_hours", value=72, effective_from=timezone.now() - timedelta(minutes=1))
        moved = self.row(sale)["release_at"]
        self.assertEqual(parse_datetime(moved), done + timedelta(hours=72))

    def test_customer_accept_shows_released_and_accepted(self):
        sale = self.paid_service()
        self.done(sale)
        sales.accept(sale, self.customer)
        row = self.row(sale)
        self.assertEqual(
            (row["status"], row["status_label"], row["customer_accepted"], row["release_at"]),
            ("released", "Released to your Available balance", True, None),
        )
        self.assertIsNotNone(row["released_at"])

    def test_review_focus_an_open_problem_shows_on_hold_and_no_release_time(self):
        sale = self.paid_service()
        self.done(sale)
        sales.report_problem(sale, self.customer, "The cleaner never came back for the kitchen")
        row = self.row(sale)
        self.assertEqual((row["on_hold"], row["status_label"], row["release_at"]), (True, "On hold: a problem was reported", None))

    def test_a_stay_releases_after_the_check_in_window(self):
        sale = self.paid_stay(starts_in=3)
        row = self.row(sale)
        check_in = sale.booking.check_in
        expected = datetime.combine(check_in, time(14, 0), tzinfo=dt_timezone.utc) + timedelta(hours=24)
        self.assertEqual(parse_datetime(row["release_at"]), expected)
        self.assertEqual((row["booking_kind"], row["status_label"]), ("stay", "Releases after the guest's check-in window"))
        self.assertIn(f"{check_in:%d %b}", row["what"])

    def test_tickets_release_after_the_event_day(self):
        sale = self.paid_tickets(quantity=2)
        row = self.row(sale)
        day = self.event.event_date.astimezone(dt_timezone.utc).date()
        expected = datetime.combine(day + timedelta(days=1), time(0, 0), tzinfo=dt_timezone.utc) + timedelta(hours=48)
        self.assertEqual(parse_datetime(row["release_at"]), expected)
        self.assertEqual((row["booking_kind"], row["booking_kind_label"], row["status_label"]), ("tickets", "Event tickets", "Releases after the event"))
        self.assertTrue(row["what"].startswith("2 tickets for Highlife Night"))

    def test_tickets_for_an_event_under_review_are_on_hold(self):
        sale = self.paid_tickets()
        Event.objects.filter(pk=self.event.pk).update(status=Event.PENDING)
        row = self.row(sale)
        self.assertEqual((row["on_hold"], row["status_label"], row["release_at"]), (True, "On hold while AshantiHub checks the event", None))

    def test_a_due_sale_not_yet_released_says_due_for_release(self):
        sale = self.paid_service()
        self.done(sale, timezone.now() - timedelta(hours=60))
        row = self.row(sale)
        self.assertEqual((row["status"], row["status_label"], row["on_hold"]), ("awaiting_call", "Due for release", False))
        self.assertIsNotNone(row["release_at"])

    def test_a_partial_refund_shows_what_is_left_and_a_whole_refund_shows_refunded(self):
        staff = make_staff("support", "s-refund@example.com")
        partial = self.paid_service("200.00")
        sales.refund(partial, 5000, source="partial-1", by=staff)
        row = self.row(partial)
        self.assertEqual((row["status"], row["refunded"], row["item_subtotal"]), ("awaiting_call", "50.00", "200.00"))
        self.assertEqual(float(row["net"]), 200 - 50 - float(row["platform_fee"]))
        whole = self.paid_service("120.00")
        sales.refund(whole, source="whole-1", by=staff)
        row = self.row(whole)
        self.assertEqual((row["status"], row["status_label"], row["refunded"], row["platform_fee"], row["net"]), ("refunded", "Refunded to the customer", "120.00", "0.00", "0.00"))
        self.assertIsNone(row["release_at"])

    def test_review_focus_no_customer_detail_in_a_booking_row(self):
        sale = self.paid_service()
        self.done(sale)
        sales.report_problem(sale, self.customer, "Secret reason about the damaged wardrobe")
        self.paid_stay(starts_in=3)
        self.paid_tickets()
        self.as_owner()
        text = self.client.get(BOOKINGS).content.decode()
        for forbidden in ("Ama Owusu", "+233200770001", "233200770001", "Secret reason", "damaged wardrobe", "customer_name", "phone"):
            self.assertNotIn(forbidden, text)

    def test_review_focus_another_business_sees_none_of_these_bookings(self):
        self.paid_service()
        self.paid_stay(starts_in=3)
        other = Shop("Esi Boateng", "+233201110002")
        response = other.get(BOOKINGS)
        self.assertEqual((response.status_code, response.json()["count"], response.json()["results"]), (200, 0, []))
        self.assertEqual(len(self.rows()), 2)

    def test_status_and_date_filters_and_bad_values_are_400(self):
        waiting = self.paid_service()
        released = self.paid_service("100.00")
        self.done(released)
        sales.accept(released, self.customer)
        refunded = self.paid_service("80.00")
        sales.refund(refunded, source="whole-2", by=make_staff("support", "s-filter@example.com"))
        ids = lambda params: [row["sale"] for row in self.rows(params)]
        self.assertEqual(ids({"status": "awaiting_call"}), [waiting.pk])
        self.assertEqual(ids({"status": "released"}), [released.pk])
        self.assertEqual(ids({"status": "refunded"}), [refunded.pk])
        self.assertEqual(ids({"status": "all"}), [refunded.pk, released.pk, waiting.pk])
        today = timezone.localdate()
        self.assertEqual(len(ids({"date_from": today.isoformat(), "date_to": today.isoformat()})), 3)
        self.assertEqual(ids({"date_to": (today - timedelta(days=1)).isoformat()}), [])
        self.assertEqual(ids({"date_from": (today + timedelta(days=1)).isoformat()}), [])
        self.as_owner()
        for params, field in (
            ({"status": "nonsense"}, "status"), ({"date_from": "yesterday"}, "date_from"), ({"date_to": "2026-02-30"}, "date_to"),
            ({"date_from": "2026-10-10", "date_to": "2026-10-01"}, "date_from"),
        ):
            response = self.client.get(BOOKINGS, params)
            self.assertEqual(response.status_code, 400, params)
            self.assertIn(field, response.json())

    def test_page_query_count_does_not_grow_with_rows(self):
        def counted():
            self.as_owner()
            with CaptureQueriesContext(connection) as queries:
                response = self.client.get(BOOKINGS)
            self.assertEqual(response.status_code, 200)
            return len(queries), response.json()["count"]

        starts = iter(range(10, 200, 3))

        def mixed(n):
            for i in range(n):
                service = self.paid_service()
                self.done(service)
                if i == 0:
                    sales.report_problem(service, self.customer, "Something went wrong here")
                self.paid_stay(starts_in=next(starts))
                self.paid_tickets(quantity=1 + i)
        mixed(1)
        small, small_count = counted()
        mixed(1)
        mixed(1)
        large, large_count = counted()
        self.assertEqual((small_count, large_count), (3, 9))
        self.assertEqual(small, large)


@override_settings(LEDGER_ENABLED=True)
class OverviewBookingTests(BookingsBase):
    def test_review_focus_pending_is_the_sum_of_waiting_orders_and_bookings(self):
        listing = self.listing("Phone case", "60.00", self.service.category)
        paid_order(customer(), [(listing, 2)])
        self.paid_service("200.00")
        self.as_owner()
        overview = self.client.get(OVERVIEW).json()
        orders = [row for row in self.client.get(SALES).json()["results"] if row["status"] == "awaiting_call"]
        books = [row for row in self.client.get(BOOKINGS).json()["results"] if row["status"] == "awaiting_call"]
        total = sum(float(row["item_subtotal"]) - float(row["refunded"]) for row in orders + books)
        self.assertEqual((len(orders), len(books)), (1, 1))
        self.assertEqual(float(overview["pending"]), total)
        self.assertEqual(overview["awaiting_call"], 2)

    def test_withdrawing_is_the_sum_of_open_withdrawals(self):
        self.as_owner()
        self.assertEqual(self.client.get(OVERVIEW).json()["withdrawing"], "0.00")
        payee = destination(self.owner, name=self.owner.full_name)
        for request_id, amount, status in (("r1", 5000, Withdrawal.PENDING), ("r2", 7000, Withdrawal.SUCCEEDED)):
            Withdrawal.objects.create(
                holder_type="business_owner", holder_id=self.owner.pk, source_kind=Account.VENDOR_AVAILABLE, destination=payee,
                request_id=request_id, amount_pesewas=amount, charge_pesewas=0, net_pesewas=amount, status=status, provider="simulated",
            )
        self.assertEqual(self.client.get(OVERVIEW).json()["withdrawing"], "50.00")


DAILY, EXPORT = "/api/wallet/vendor/daily/", "/api/wallet/vendor/statement/export/"


def csv_lines(response):
    return list(csv.reader(io.StringIO(response.content.decode("utf-8"))))[1:]


@override_settings(LEDGER_ENABLED=True)
class BookingDailyAndStatementTests(BookingsBase):
    def daily(self):
        self.as_owner()
        response = self.client.get(DAILY)
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()

    def statement(self, params=None):
        self.as_owner()
        return self.client.get(EXPORT, params or {})

    def test_booking_payment_release_and_refund_fold_into_their_columns(self):
        sale = self.paid_service("200.00")
        totals = self.daily()["totals"]
        self.assertEqual((totals["orders"], totals["sold"], totals["fees"], totals["released"], totals["other"]), (1, "200.00", "0.00", "0.00", "0.00"))
        self.done(sale)
        sales.accept(sale, self.customer)
        sale.refresh_from_db()
        fee = Decimal(sale.charged_pesewas) / 100
        self.assertGreater(fee, 0)
        totals = self.daily()["totals"]
        self.assertEqual((totals["orders"], Decimal(totals["fees"]), Decimal(totals["released"]), totals["other"]), (1, fee, 200 - fee, "0.00"))
        sales.refund(sale, 5000, source="partial-daily", by=make_staff("support", "s-daily@example.com"))
        totals = self.daily()["totals"]
        self.assertGreater(Decimal(totals["refunded"]), 0)
        self.assertEqual(totals["other"], "0.00")

    def test_review_focus_columns_still_add_up_with_bookings(self):
        listing = self.listing("Phone case", "60.00", self.service.category)
        paid_order(customer(), [(listing, 2)])
        sale = self.paid_service("200.00")
        self.done(sale)
        sales.accept(sale, self.customer)
        self.paid_stay(starts_in=3)
        hold(self.owner, 5000, "hold-bookings")
        totals = self.daily()["totals"]

        def figure(key):
            return Decimal(totals[key])

        self.assertEqual(totals["other"], "0.00")
        self.assertEqual(totals["orders"], 3)
        self.assertEqual(
            figure("sold") - figure("fees") - figure("refunded") - figure("free_delivery_promo") - figure("withdrawn") + figure("other"),
            figure("net_change"),
        )

    def test_statement_lists_booking_sales_by_paid_day_with_their_status_word(self):
        waiting = self.paid_service("200.00")
        released = self.paid_service("120.00")
        self.done(released)
        sales.accept(released, self.customer)
        refunded = self.paid_service("80.00")
        sales.refund(refunded, source="whole-stmt", by=make_staff("support", "s-stmt@example.com"))
        response = self.statement()
        self.assertEqual(response.status_code, 200, response.content)
        lines = {line[2]: line for line in csv_lines(response)}
        day = timezone.localdate().isoformat()
        released.refresh_from_db()
        fee = f"{Decimal(released.charged_pesewas) / 100:.2f}"
        self.assertEqual(lines[f"Booking #{waiting.pk}"][:2] + lines[f"Booking #{waiting.pk}"][3:4] + lines[f"Booking #{waiting.pk}"][-1:], [day, "Booking", "200.00", "Pending"])
        row = lines[f"Booking #{released.pk}"]
        self.assertEqual((row[3], row[4], row[5], row[6], row[7], row[8], row[9]), ("120.00", fee, "", "0.00", "", f"{Decimal('120.00') - Decimal(fee):.2f}", "Available"))
        row = lines[f"Booking #{refunded.pk}"]
        self.assertEqual((row[3], row[4], row[6], row[8], row[9]), ("80.00", "0.00", "80.00", "0.00", "Refunded"))

    def test_statement_booking_rows_hold_no_customer_detail_or_item_name(self):
        self.paid_service()
        self.paid_stay(starts_in=3)
        self.paid_tickets()
        text = self.statement().content.decode()
        self.assertEqual(text.count("Booking #"), 3)
        for forbidden in ("Ama Owusu", "233200770001", "Home Cleaning", "customer", "phone"):
            self.assertNotIn(forbidden, text)

    def test_the_row_ceiling_counts_bookings(self):
        self.paid_service()
        self.assertEqual(self.statement().status_code, 200)
        with patch.object(vendor, "EXPORT_MAX_ROWS", 1):
            self.assertEqual(self.statement().status_code, 200)
            self.paid_service()
            response = self.statement()
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json(), {"date_from": "Too many rows \u2014 choose a shorter date range."})
