"""Paid and refunded counts on the Super Admin listings and events tables (marketplace.sales_counts)."""
import csv
import io
import itertools
from datetime import date, timedelta

from django.db import connection
from django.test import override_settings
from django.test.utils import CaptureQueriesContext
from django.utils import timezone

from billing.models import Transaction
from events.models import Event, EventTicketType, Ticket
from bookings.models import Booking
from ledger.models import BookingRefund, BookingSale, FeeRuleSet, Journal, OrderRefund
from listings.models import Category, Listing, Zone
from orders.models import Order, OrderItem
from payments.models import CheckoutSession
from portfolio.tests.health_fixtures import add_listings, make_business
from services.models import ServiceRequest

from marketplace import sales_counts

from .base import MarketplaceTestCase, make_customer, make_order

_keys = itertools.count(1)


class SalesCountsBase(MarketplaceTestCase):
    def setUp(self):
        super().setUp()
        self.buyer = make_customer("Abena Mensah")
        self.service_category = Category.objects.create(slug="cleaning-s9", label="Cleaning", kind="service")
        self.stay_category = Category.objects.create(slug="lodge-s9", label="Lodge", kind="service", is_accommodation=True)
        self.zone = Zone.objects.get(name="Bantama")

    def make_listing(self, category, name="Thing"):
        return Listing.objects.create(
            business_owner=self.business, category=category, zone=self.zone, name=name, description="D.",
            contact_phone=self.business.login_phone, status=Listing.PUBLISHED,
        )

    def pay_order(self, order):
        """The successful order-checkout session the payments finalizer leaves behind."""
        return CheckoutSession.objects.create(
            customer=self.buyer, kind=CheckoutSession.ORDER_CHECKOUT, amount="10.00", purpose="Order",
            metadata={"order_id": order.pk}, status=CheckoutSession.SUCCESS,
        )

    def sale_for(self, **subject):
        kind = "service" if "service_request" in subject else "stay" if "booking" in subject else "tickets"
        session = CheckoutSession.objects.create(
            customer=self.buyer, kind=CheckoutSession.SERVICE_REQUEST, amount="10.00", purpose="Sale", status=CheckoutSession.SUCCESS,
        )
        return BookingSale.objects.create(
            kind=kind, session=session, customer=self.buyer, business_owner=self.business,
            category="event" if kind == "tickets" else "service", rule_set=FeeRuleSet.objects.first(),
            base_pesewas=1000, computed_pesewas=0, charged_pesewas=0, paid_at=timezone.now(), **subject,
        )

    def refund_sale(self, sale, source="cancel"):
        journal = Journal.objects.create(key=f"s9-refund-{next(_keys)}", kind="test_refund")
        return BookingRefund.objects.create(sale=sale, source=source, whole=True, amount_pesewas=1000, journal=journal)

    def make_request(self, listing, *, paid=True, status=ServiceRequest.IN_PROGRESS):
        return ServiceRequest.objects.create(
            customer=self.buyer, listing=listing, business_owner=self.business, message="Hi",
            status=status, paid_at=timezone.now() if paid else None,
        )

    def make_booking(self, listing, *, paid=True, cancelled=False):
        return Booking.objects.create(
            customer=self.buyer, listing=listing, business_owner=self.business,
            check_in=date.today() + timedelta(days=5), check_out=date.today() + timedelta(days=6),
            nightly_rate="50.00", total_price="50.00",
            status=Booking.CANCELLED if cancelled else Booking.CONFIRMED,
            paid_at=timezone.now() if paid else None, cancelled_at=timezone.now() if cancelled else None,
        )


@override_settings(LEDGER_ENABLED=True)
class LedgerOnTests(SalesCountsBase):
    def counts(self, listing):
        return sales_counts.for_listings([listing.pk])[listing.pk]

    def test_product_paid_counts_orders_not_units(self):
        order = make_order(self.buyer, self.listing, status=Order.PAID)
        OrderItem.objects.filter(order=order).update(quantity=5)
        second = make_order(self.buyer, self.listing, status=Order.PAID)
        OrderItem.objects.create(order=second, listing=self.listing, quantity=2, unit_price="1.00", line_total="2.00")
        self.assertEqual(self.counts(self.listing), (2, 0))

    def test_product_cancelled_before_payment_not_paid(self):
        make_order(self.buyer, self.listing, status=Order.CANCELLED)
        make_order(self.buyer, self.listing, status=Order.PENDING)
        self.assertEqual(self.counts(self.listing), (0, 0))

    def test_product_whole_refund_counted_in_both(self):
        order = make_order(self.buyer, self.listing, status=Order.CANCELLED)
        self.pay_order(order)
        OrderRefund.objects.create(order=order, source="cancel", whole=True, amount_pesewas=1000)
        self.assertEqual(self.counts(self.listing), (1, 1))

    def test_product_refund_row_on_a_paid_order_is_refunded(self):
        order = make_order(self.buyer, self.listing, status=Order.PAID)
        OrderRefund.objects.create(
            order=order, source="dispute-1", whole=False, amount_pesewas=300,
            allocation=[{"snapshot": 1, "business_owner": self.business.pk, "category": "product", "base": 300, "fee": 0, "released": False}],
        )
        make_order(self.buyer, self.listing, status=Order.PAID)
        self.assertEqual(self.counts(self.listing), (2, 1))

    def two_shop_order(self):
        other = make_business("Kejetia Spices")
        theirs = add_listings(other, 1)[0]
        order = make_order(self.buyer, self.listing, status=Order.PAID)
        OrderItem.objects.create(order=order, listing=theirs, quantity=1, unit_price="10.00", line_total="10.00")
        return order, theirs, other

    def test_partial_refund_counts_only_the_shop_it_paid_back(self):
        order, theirs, _ = self.two_shop_order()
        OrderRefund.objects.create(
            order=order, source="dispute-9", whole=False, amount_pesewas=500,
            allocation=[{"snapshot": 1, "business_owner": self.business.pk, "category": "product", "base": 500, "fee": 0, "released": False}],
        )
        self.assertEqual(self.counts(self.listing), (1, 1))
        self.assertEqual(self.counts(theirs), (1, 0))

    def test_whole_refund_counts_every_shop_on_the_order(self):
        order, theirs, _ = self.two_shop_order()
        OrderRefund.objects.create(order=order, source="cancel", whole=True, amount_pesewas=1000, allocation=[])
        self.assertEqual(self.counts(self.listing), (1, 1))
        self.assertEqual(self.counts(theirs), (1, 1))

    def test_service_request_paid_and_refunded(self):
        listing = self.make_listing(self.service_category)
        self.make_request(listing, paid=False, status=ServiceRequest.REQUESTED)
        self.make_request(listing)
        refunded = self.make_request(listing)
        self.refund_sale(self.sale_for(service_request=refunded))
        self.assertEqual(self.counts(listing), (2, 1))

    def test_stay_booking_cancelled_after_pay_is_refunded(self):
        listing = self.make_listing(self.stay_category)
        self.make_booking(listing, paid=False)
        self.make_booking(listing)
        self.make_booking(listing, cancelled=True)
        refunded = self.make_booking(listing)
        self.refund_sale(self.sale_for(booking=refunded))
        self.assertEqual(self.counts(listing), (3, 2))

    def test_event_tickets_paid_and_refunded_at_ticket_level(self):
        event, ticket_type = self.make_event()
        self.make_ticket(ticket_type)
        self.make_ticket(ticket_type, refunded=True)
        by_sale = self.make_ticket(ticket_type)
        sale = self.sale_for(event=event)
        self.refund_sale(sale, source=f"ticket-{by_sale.pk}")
        # a refund row for a ticket that also has refunded_at is one ticket, not two
        both = self.make_ticket(ticket_type, refunded=True)
        self.refund_sale(sale, source=f"ticket-{both.pk}")
        self.assertEqual(sales_counts.for_events([event.pk])[event.pk], (4, 3))

    def test_refunded_never_exceeds_paid(self):
        order = make_order(self.buyer, self.listing, status=Order.PENDING)
        OrderRefund.objects.create(order=order, source="cancel", whole=True, amount_pesewas=1000)
        listing = self.make_listing(self.service_category)
        unpaid = self.make_request(listing, paid=False, status=ServiceRequest.CANCELLED)
        self.refund_sale(self.sale_for(service_request=unpaid))
        self.assertEqual(self.counts(self.listing), (0, 0))
        self.assertEqual(self.counts(listing), (0, 0))

    def test_no_purchases_is_a_real_zero(self):
        self.assertEqual(sales_counts.for_listings([self.listing.pk]), {self.listing.pk: (0, 0)})
        self.assertEqual(sales_counts.for_listings([]), {})

    def make_event(self):
        event = Event.objects.create(
            category=Category.objects.get(slug="festivals"), zone=self.zone, submitted_by_business=self.business, name="Night",
            description="D.", address="Manhyia", event_date=timezone.now() + timedelta(days=5), visibility_days=14, status=Event.APPROVED,
        )
        return event, EventTicketType.objects.create(event=event, name="Regular", price="80.00", quantity_total=50, delivery_method="digital")

    def make_ticket(self, ticket_type, *, refunded=False):
        txn = Transaction.objects.create(customer=self.buyer, amount="80.00", purpose="Ticket", reference=f"S9-{next(_keys)}")
        extra = {"refunded_at": timezone.now(), "refund_reason": "x"} if refunded else {}
        return Ticket.objects.create(ticket_type=ticket_type, purchased_by=self.buyer, transaction=txn, delivery_method="digital", price="80.00", **extra)


@override_settings(LEDGER_ENABLED=False)
class LedgerOffTests(SalesCountsBase):
    def test_ledger_off_falls_back_to_cancel_markers(self):
        # a cancelled order that was paid, one that never was, and a refund row the off ledger must not read
        paid_then_cancelled = make_order(self.buyer, self.listing, status=Order.CANCELLED)
        self.pay_order(paid_then_cancelled)
        make_order(self.buyer, self.listing, status=Order.CANCELLED)
        make_order(self.buyer, self.listing, status=Order.PAID)
        listing = self.make_listing(self.service_category)
        cancelled = self.make_request(listing, status=ServiceRequest.CANCELLED)
        self.make_request(listing)
        stays = self.make_listing(self.stay_category)
        self.make_booking(stays, cancelled=True)
        self.make_booking(stays)
        result = sales_counts.for_listings([self.listing.pk, listing.pk, stays.pk])
        self.assertEqual(result[self.listing.pk], (2, 1))
        self.assertEqual(result[listing.pk], (2, 1))
        self.assertEqual(result[stays.pk], (2, 1))
        self.assertIsNotNone(cancelled)

    def test_ledger_off_ignores_refund_rows(self):
        order = make_order(self.buyer, self.listing, status=Order.PAID)
        OrderRefund.objects.create(order=order, source="dispute-1", whole=False, amount_pesewas=300)
        self.assertEqual(sales_counts.for_listings([self.listing.pk])[self.listing.pk], (1, 0))


@override_settings(LEDGER_ENABLED=True)
class TableTests(SalesCountsBase):
    def setUp(self):
        super().setUp()
        self.sign_in()

    def list_rows(self):
        response = self.client.get("/api/marketplace/listings/")
        self.assertEqual(response.status_code, 200, response.content)
        return {row["id"]: row for row in response.json()["results"]}

    def test_listing_row_has_two_numbers_and_query_count_bounded(self):
        order = make_order(self.buyer, self.listing, status=Order.CANCELLED)
        self.pay_order(order)
        OrderRefund.objects.create(order=order, source="cancel", whole=True, amount_pesewas=1000)
        rows = self.list_rows()
        self.assertEqual((rows[self.listing.pk]["paid_count"], rows[self.listing.pk]["refunded_count"]), (1, 1))
        with CaptureQueriesContext(connection) as small:
            self.list_rows()
        for listing in add_listings(self.business, 12):
            make_order(self.buyer, listing, status=Order.PAID)
        with CaptureQueriesContext(connection) as large:
            rows = self.list_rows()
        self.assertGreater(len(rows), 10)
        self.assertEqual(len(large), len(small))
        zero = [r for r in rows.values() if r["id"] != self.listing.pk and r["paid_count"] == 0]
        self.assertEqual(zero, [])

    def test_event_row_has_paid_and_refunded_and_bounded_queries(self):
        helper = LedgerOnTests("test_no_purchases_is_a_real_zero")
        helper.buyer, helper.business, helper.zone = self.buyer, self.business, self.zone
        event, ticket_type = helper.make_event()
        helper.make_ticket(ticket_type)
        helper.make_ticket(ticket_type, refunded=True)
        with CaptureQueriesContext(connection) as small:
            rows = self.client.get("/api/marketplace/events/").json()["results"]
        row = [r for r in rows if r["id"] == event.pk][0]
        self.assertEqual((row["paid_count"], row["refunded_count"], row["tickets_sold"]), (2, 1, 1))
        for _ in range(4):
            other, other_type = helper.make_event()
            helper.make_ticket(other_type)
        with CaptureQueriesContext(connection) as large:
            self.client.get("/api/marketplace/events/")
        self.assertEqual(len(large), len(small))

    def test_csv_export_has_columns(self):
        make_order(self.buyer, self.listing, status=Order.PAID)
        response = self.client.get("/api/marketplace/listings/export/")
        text = b"".join(response.streaming_content).decode("utf-8-sig")
        table = list(csv.reader(io.StringIO(text)))
        header = next(row for row in table if "Listing" in row)
        self.assertEqual(header[-2:], ["Paid", "Refunded"])
        row = next(r for r in table if self.listing.name in r)
        self.assertEqual(row[-2:], ["1", "0"])
