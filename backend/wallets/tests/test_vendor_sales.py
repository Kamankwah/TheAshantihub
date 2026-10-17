"""The business's own money for its dashboard (vendor plan 4, Task 1): the overview and one row per sale. Review Focus 1
(isolation, privacy, the fee never shown to a customer), 3 (refunds) and 5 (ledger off)."""
from datetime import timedelta
from decimal import Decimal

from django.db import connection
from django.test import override_settings
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import Customer
from accounts.testing import make_staff, staff_token
from approvals.models import ApprovalRequest
from disputes.models import Dispute
from ledger import refunds
from ledger.models import Account, FulfilmentCheck, MoneySetting, OrderFeeSnapshot
from listings.models import Category, Listing, Zone
from orders.models import Order

from .vendor_helpers import VendorBase, deliver, hold, paid_order, release, signed_in, waived

OVERVIEW, SALES = "/api/wallet/vendor/", "/api/wallet/vendor/sales/"


class LedgerOffTests(VendorBase):
    def test_review_focus_the_overview_and_sales_say_ledger_off(self):
        accounts = Account.objects.count()
        for url in (OVERVIEW, SALES):
            response = self.kofi.get(url)
            self.assertEqual((response.status_code, response.json()["code"]), (409, "ledger_off"), url)
        self.assertEqual(Account.objects.count(), accounts)


@override_settings(LEDGER_ENABLED=True)
class SaleRowTests(VendorBase):
    def rows(self, params=None):
        response = self.kofi.get(SALES, params)
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()["results"]

    def test_a_paid_order_waits_for_delivery_then_for_supports_call(self):
        order = paid_order(self.buyer, [(self.kofi.listing("60.00"), 2)], delivery="10.00")   # items 120.00: GH₵ 5.00 flat
        row = self.rows()[0]
        self.assertEqual(
            (row["kind"], row["order"], row["reference"], row["item_subtotal"], row["platform_fee"], row["net"], row["refunded"]),
            ("order", order.pk, f"Order #{order.pk}", "120.00", "5.00", "115.00", "0.00"),
        )
        self.assertEqual([(i["name"], i["quantity"], i["line_total"]) for i in row["items"]], [("Kofi Mensah item 1", 2, "120.00")])
        self.assertEqual(
            (row["status"], row["status_label"], row["handed_over"], row["released_at"]),
            ("awaiting_call", "Waiting for delivery or collection", False, None),
        )
        deliver(order)
        row = self.rows()[0]
        self.assertEqual(
            (row["status"], row["status_label"], row["handed_over"]),
            ("awaiting_call", "Waiting for Support's call to the customer", True),
        )

    def test_a_released_order_says_so_with_its_time(self):
        order = paid_order(self.buyer, [(self.kofi.listing("120.00"), 1)])
        release(order)
        row = self.rows()[0]
        self.assertEqual((row["status"], row["status_label"], row["net"]), ("released", "Released to your Available balance", "115.00"))
        self.assertIsNotNone(row["released_at"])

    def test_a_free_delivery_promo_is_taken_from_what_is_due(self):
        order = paid_order(self.buyer, [(self.kofi.listing("120.00"), 1)], delivery="0.00")
        waived(self.kofi.owner, order, "15.00")
        row = self.rows()[0]
        self.assertEqual((row["free_delivery_promo"], row["net"]), ("15.00", "100.00"))          # 120 - 5 fee - 15 promo

    def test_review_focus_a_partial_refund_after_release_shows_what_is_left(self):
        order = paid_order(self.buyer, [(self.kofi.listing("600.00"), 1)])                       # 1%: GH₵ 6.00
        release(order)
        refunds.refund_order(order, 15000, source="dispute-1")                                   # GH₵ 150.00 back
        row = self.rows()[0]
        self.assertEqual(
            (row["status"], row["item_subtotal"], row["refunded"], row["platform_fee"], row["net"]),
            ("released", "600.00", "150.00", "4.50", "445.50"),                                  # GH₵ 1.50 of the fee went back
        )

    def test_review_focus_a_whole_refund_shows_refunded_with_nothing_due(self):
        order = paid_order(self.buyer, [(self.kofi.listing("120.00"), 1)])
        refunds.refund_order(order, source="cancel")
        row = self.rows()[0]
        self.assertEqual(
            (row["status"], row["status_label"], row["refunded"], row["platform_fee"], row["net"]),
            ("refunded", "Refunded to the customer", "120.00", "0.00", "0.00"),
        )

    def test_an_open_dispute_puts_the_sale_on_hold_without_saying_more(self):
        order = paid_order(self.buyer, [(self.kofi.listing("120.00"), 1)])
        deliver(order)
        Dispute.objects.create(
            order=order, raised_by=self.buyer, reason=Dispute.ORDER_ISSUE, description="Torn cloth", status=Dispute.OPEN,
        )
        row = self.rows()[0]
        self.assertEqual(
            (row["status"], row["status_label"], row["on_hold"]),
            ("awaiting_call", "On hold while AshantiHub checks the order", True),
        )
        self.assertNotIn("Torn", str(row))

    def test_review_focus_a_delivery_case_refund_waiting_for_approval_is_on_hold(self):
        order = paid_order(self.buyer, [(self.kofi.listing("120.00"), 1)])
        deliver(order)
        dispute = Dispute.objects.create(
            order=order, raised_by=self.buyer, reason=Dispute.ORDER_ISSUE, status=Dispute.FINAL_STATUSES[0],
        )
        pending = ApprovalRequest.objects.create(
            maker=make_staff("support", "maker@example.com"), due_at=timezone.now() + timedelta(days=1),
            kind="delivery.refund_request", status=ApprovalRequest.PENDING, target_type="disputes.dispute",
            target_id=str(dispute.pk),
        )
        row = self.rows()[0]                                          # Support's call cannot release it yet
        self.assertEqual(
            (row["status"], row["status_label"], row["on_hold"]),
            ("awaiting_call", "On hold while AshantiHub checks the order", True),
        )
        ApprovalRequest.objects.filter(pk=pending.pk).update(status=ApprovalRequest.APPROVED)
        self.assertEqual(self.rows()[0]["status_label"], "Waiting for Support's call to the customer")

    def test_status_and_date_filters(self):
        waiting = paid_order(self.buyer, [(self.kofi.listing("50.00"), 1)])
        released = paid_order(self.buyer, [(self.kofi.listing("50.00"), 1)])
        release(released)
        refunded = paid_order(self.buyer, [(self.kofi.listing("50.00"), 1)])
        refunds.refund_order(refunded, source="cancel")

        def ids(params):
            return [row["order"] for row in self.rows(params)]

        self.assertEqual(ids({}), [refunded.pk, released.pk, waiting.pk])
        self.assertEqual(ids({"status": "awaiting_call"}), [waiting.pk])
        self.assertEqual(ids({"status": "released"}), [released.pk])
        self.assertEqual(ids({"status": "refunded"}), [refunded.pk])
        Order.objects.filter(pk=waiting.pk).update(placed_at=timezone.now() - timedelta(days=10))
        self.assertEqual(ids({"date_to": (timezone.localdate() - timedelta(days=5)).isoformat()}), [waiting.pk])
        self.assertEqual(ids({"date_from": (timezone.localdate() - timedelta(days=5)).isoformat()}), [refunded.pk, released.pk])
        for params in ({"status": "lost"}, {"date_from": "16/10/2026"}, {"date_from": "2026-10-10", "date_to": "2026-10-01"}):
            self.assertEqual(self.kofi.get(SALES, params).status_code, 400, params)

    def test_orders_paid_before_the_ledger_was_on_are_not_rows(self):
        paid_order(self.buyer, [(self.kofi.listing("50.00"), 1)], record=False)
        self.assertEqual(self.kofi.get(SALES).json()["count"], 0)


@override_settings(LEDGER_ENABLED=True)
class OverviewTests(VendorBase):
    def test_pending_available_and_the_count_waiting(self):
        paid_order(self.buyer, [(self.kofi.listing("120.00"), 1)])
        released = paid_order(self.buyer, [(self.kofi.listing("120.00"), 1)])
        release(released)
        body = self.kofi.get(OVERVIEW).json()
        self.assertEqual(
            (body["pending"], body["available"], body["withdrawable"], body["negative"], body["awaiting_call"]),
            ("120.00", "115.00", "115.00", False, 1),
        )

    def test_review_focus_pending_is_the_sum_of_the_rows_still_waiting(self):
        first = paid_order(self.buyer, [(self.kofi.listing("600.00"), 1)])
        paid_order(self.buyer, [(self.kofi.listing("80.00"), 2)], delivery="10.00")              # delivery is never the business's
        refunds.refund_order(first, 10000, source="dispute-2")                                   # part of it, before release
        rows = self.kofi.get(SALES, {"status": "awaiting_call"}).json()["results"]
        waiting = sum(Decimal(row["item_subtotal"]) - Decimal(row["refunded"]) for row in rows)
        self.assertEqual(waiting, Decimal("660.00"))
        self.assertEqual(Decimal(self.kofi.get(OVERVIEW).json()["pending"]), waiting)

    def test_a_late_refund_can_leave_available_negative_and_nothing_withdrawable(self):
        order = paid_order(self.buyer, [(self.kofi.listing("120.00"), 1)])
        release(order)                                                                           # Available 115.00
        hold(self.kofi.owner, 11500, "hold-negative")                                           # all of it withdrawn
        refunds.refund_order(order, 5000, source="dispute-3")                                    # 50.00 back, 2.08 of the fee returned
        body = self.kofi.get(OVERVIEW).json()
        self.assertEqual((body["available"], body["withdrawable"], body["negative"]), ("-47.92", "0.00", True))

    def test_the_lifetime_cap_used_and_left(self):
        MoneySetting.objects.create(key="fee_cap_pesewas", value=700, effective_from=timezone.now() - timedelta(days=1))
        paid_order(self.buyer, [(self.kofi.listing("120.00"), 1)])                               # GH₵ 5.00 charged
        self.assertEqual(self.kofi.get(OVERVIEW).json()["fee_cap"], {"limit": "7.00", "used": "5.00", "remaining": "2.00"})
        self.assertEqual(self.esi.get(OVERVIEW).json()["fee_cap"], {"limit": "7.00", "used": "0.00", "remaining": "7.00"})

    def test_no_cap_says_so(self):
        self.assertEqual(self.kofi.get(OVERVIEW).json()["fee_cap"], {"limit": None, "used": "0.00", "remaining": None})


@override_settings(LEDGER_ENABLED=True)
class IsolationTests(VendorBase):
    def test_review_focus_a_shared_order_shows_each_business_only_its_own_lines(self):
        order = paid_order(self.buyer, [(self.kofi.listing("120.00"), 1), (self.esi.listing("600.00"), 1)])
        kofi_rows = self.kofi.get(SALES).json()["results"]
        esi_rows = self.esi.get(SALES).json()["results"]
        self.assertEqual([(r["order"], r["item_subtotal"], r["platform_fee"]) for r in kofi_rows], [(order.pk, "120.00", "5.00")])
        self.assertEqual([(r["order"], r["item_subtotal"], r["platform_fee"]) for r in esi_rows], [(order.pk, "600.00", "6.00")])
        self.assertEqual([item["name"] for item in kofi_rows[0]["items"]], ["Kofi Mensah item 1"])
        self.assertEqual(self.kofi.get(OVERVIEW).json()["pending"], "120.00")

    def test_review_focus_no_customer_detail_reaches_a_business(self):
        order = paid_order(self.buyer, [(self.kofi.listing("120.00"), 1)])
        deliver(order)
        Customer.objects.filter(pk=self.buyer.pk).update(email="ama.buyer@example.com")
        sales = self.kofi.get(SALES)
        self.assertEqual((sales.status_code, sales.json()["count"]), (200, 1))
        overview = self.kofi.get(OVERVIEW)
        self.assertEqual(overview.status_code, 200)
        seen = str(sales.json()) + str(overview.json())
        for detail in ("Ama Buyer", "241110001", "Kejetia", "ama.buyer@example.com"):
            self.assertNotIn(detail, seen)

    def test_review_focus_a_customer_with_the_same_id_or_staff_are_refused(self):
        paid_order(self.buyer, [(self.kofi.listing("120.00"), 1)])
        support = APIClient()
        support.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(make_staff('support', 'desk@example.com'))}")
        twin = signed_in(self.twin(), "customer")
        for client in (twin, support):
            for url in (OVERVIEW, SALES):
                self.assertEqual(client.get(url).status_code, 403, url)


@override_settings(LEDGER_ENABLED=True)
class SaleRowEdgeTests(VendorBase):
    def rows(self, params=None):
        response = self.kofi.get(SALES, params)
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()["results"]

    def test_a_partial_refund_before_release_keeps_the_rest_waiting(self):
        order = paid_order(self.buyer, [(self.kofi.listing("600.00"), 1)])
        refunds.refund_order(order, 10000, source="dispute-4")                                   # 100.00 of 600.00 back
        row = self.rows()[0]
        self.assertEqual(
            (row["status"], row["item_subtotal"], row["refunded"], row["platform_fee"], row["net"]),
            ("awaiting_call", "600.00", "100.00", "5.00", "495.00"),
        )

    def test_two_fee_categories_one_reversed_the_rest_released_reads_released(self):
        events = Category.objects.create(slug="gigs", icon="x", label="Gigs", color="#000", kind=Category.EVENT)
        listing = Listing.objects.create(
            business_owner=self.kofi.owner, category=events, zone=Zone.objects.get(name="Manhyia"), name="Gig ticket",
            description="D.", contact_phone="+233201110001", price_amount=Decimal("100.00"), status=Listing.PUBLISHED,
        )
        order = paid_order(self.buyer, [(self.kofi.listing("200.00"), 1), (listing, 1)])
        self.assertEqual(OrderFeeSnapshot.objects.filter(order=order).count(), 2)
        snap = OrderFeeSnapshot.objects.get(order=order, category="event")
        OrderFeeSnapshot.objects.filter(pk=snap.pk).update(
            reversed_at=timezone.now(), refunded_base_pesewas=snap.base_pesewas, refunded_fee_pesewas=snap.charged_pesewas,
        )
        release(order)
        row = self.rows()[0]
        self.assertEqual((row["status"], row["item_subtotal"], row["refunded"]), ("released", "300.00", "100.00"))

    def test_paging_past_twenty_rows(self):
        listing = self.kofi.listing("10.00")
        for _ in range(23):
            paid_order(self.buyer, [(listing, 1)])
        first = self.kofi.get(SALES).json()
        second = self.kofi.get(SALES, {"page": 2}).json()
        self.assertEqual((first["count"], len(first["results"]), len(second["results"])), (23, 20, 3))
        self.assertFalse({r["order"] for r in first["results"]} & {r["order"] for r in second["results"]})

    def test_year_bounds(self):
        for params, message in (
            ({"date_from": "2019-12-31"}, "Choose a date from 2020 on."),
            ({"date_to": "2101-01-01"}, "Choose a date up to 2100."),
        ):
            response = self.kofi.get(SALES, params)
            self.assertEqual((response.status_code, list(response.json().values())), (400, [message]), params)
        self.assertEqual(self.kofi.get(SALES, {"date_from": "2020-01-01", "date_to": "2100-12-31"}).status_code, 200)

    def test_the_sales_list_does_not_query_per_row(self):
        first = paid_order(self.buyer, [(self.kofi.listing("50.00"), 1)])
        deliver(first)
        Dispute.objects.create(order=first, raised_by=self.buyer, reason=Dispute.ORDER_ISSUE, status=Dispute.OPEN)
        self.kofi.get(SALES)                                                                     # warm one-off queries
        with CaptureQueriesContext(connection) as few:
            self.kofi.get(SALES)
        pickup = paid_order(self.buyer, [(self.kofi.listing("50.00"), 1)])
        Order.objects.filter(pk=pickup.pk).update(delivery_method=Order.STORE_PICKUP)
        FulfilmentCheck.objects.create(order=pickup, collected_at=timezone.now())
        promo = paid_order(self.buyer, [(self.kofi.listing("120.00"), 1)], delivery="0.00")
        waived(self.kofi.owner, promo, "15.00")
        paid_order(self.buyer, [(self.kofi.listing("70.00"), 1), (self.esi.listing("80.00"), 1)])
        release(paid_order(self.buyer, [(self.esi.listing("60.00"), 1), (self.kofi.listing("60.00"), 1)]))
        with self.assertNumQueries(len(few)):
            self.assertEqual(self.kofi.get(SALES).json()["count"], 5)
