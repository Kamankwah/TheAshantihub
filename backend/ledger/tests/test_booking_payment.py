"""Recording a paid booking in the ledger (Plan 1b, Task 2): the sale, its fee from its own category table, the payment
journal, and the lifetime cap shared with product orders. Review Focus 1 (the cap across categories, also at the same
moment) and 2 (a payment that is not the price writes nothing)."""
import threading
from datetime import datetime, timedelta, timezone as dt_timezone
from decimal import Decimal

from django.db import connection, transaction
from django.test import TransactionTestCase, override_settings
from django.utils import timezone

from accounts.models import BusinessOwner, Customer
from bookings.models import Booking
from ledger import escrow, fees, posting, sales
from ledger.models import Account, BookingSale, FeeBand, FeeRuleSet, Journal, MoneySetting, OrderFeeSnapshot
from listings.models import Category, Listing, Zone
from orders.models import Order, OrderItem
from payments.models import CheckoutSession
from services.models import ServiceRequest

from .booking_helpers import BookingBase, fund


@override_settings(LEDGER_ENABLED=True)
class RecordBookingPaymentTests(BookingBase):
    def session(self, kind, amount, *, wallet=False, processing="0.00", **metadata):
        return CheckoutSession.objects.create(
            customer=self.customer, kind=kind, amount=Decimal(amount), processing_fee=Decimal(processing),
            provider=CheckoutSession.WALLET if wallet else "simulated", status=CheckoutSession.SUCCESS, purpose="Test",
            metadata=metadata,
        )

    def service_sale(self, price="200.00", **kwargs):
        sr = self.accepted_service(price)
        session = self.session(CheckoutSession.SERVICE_REQUEST, price, service_request_id=sr.pk, **kwargs)
        return sales.record_payment(session, BookingSale.SERVICE, sr, self.owner)

    def test_a_paid_service_holds_its_price_in_pending_with_its_fee_snapshotted(self):
        sale = self.service_sale("200.00")
        self.assertEqual(
            (sale.kind, sale.category, sale.base_pesewas, sale.computed_pesewas, sale.charged_pesewas, sale.cap_pesewas),
            (BookingSale.SERVICE, FeeRuleSet.SERVICE, 20000, 500, 500, None),                       # GH₵ 5.00 flat band
        )
        self.assertEqual(sale.rule_set_id, fees.rule_set_in_force(FeeRuleSet.SERVICE).pk)
        journal = Journal.objects.get(key=f"booking-pay-{sale.session.reference}")
        self.assertEqual((journal.kind, journal.reference_type, journal.reference_id), ("booking_payment", "ledger.bookingsale", str(sale.pk)))
        self.assertEqual(self.balance(Account.PROVIDER_CLEARING), 20000)
        self.assertEqual(self.balance(Account.VENDOR_PENDING, self.owner), 20000)
        self.assertEqual(self.balance(Account.VENDOR_AVAILABLE, self.owner), 0)

    def test_stays_use_the_services_table_and_tickets_the_events_table(self):
        # An older events table (3%), dated well before the suggested one: the newest in force must win, not this.
        older = FeeRuleSet.objects.create(category=FeeRuleSet.EVENT, effective_from=datetime(2021, 1, 1, tzinfo=dt_timezone.utc))
        FeeBand.objects.create(rule_set=older, lower_pesewas=0, upper_pesewas=None, percent_bp=300)
        today = timezone.localdate()
        booking = Booking.objects.create(
            customer=self.customer, listing=self.lodge, business_owner=self.owner, check_in=today + timedelta(days=1),
            check_out=today + timedelta(days=3), nightly_rate=Decimal("150.00"), total_price=Decimal("300.00"),
            status=Booking.CONFIRMED,
        )
        # This test is about which fee table each kind uses, so drop the setUp pin and use the suggested ladders.
        for pinned in self.pinned_fee_rules:
            pinned.delete()
        suggested = {c: FeeRuleSet.objects.filter(category=c).order_by("-effective_from", "-id").first() for c in (FeeRuleSet.SERVICE, FeeRuleSet.EVENT)}
        stay = sales.record_payment(self.session(CheckoutSession.BOOKING, "300.00", booking_id=booking.pk), BookingSale.STAY, booking, self.owner)
        tickets = sales.record_payment(
            self.session(CheckoutSession.TICKET_PURCHASE, "100.00", unit_price="50.00", quantity=2),
            BookingSale.TICKETS, self.event, self.owner,
        )
        self.assertEqual((stay.category, stay.base_pesewas, stay.charged_pesewas), (FeeRuleSet.SERVICE, 30000, 600))
        self.assertEqual((tickets.category, tickets.base_pesewas, tickets.charged_pesewas), (FeeRuleSet.EVENT, 10000, 250))
        self.assertEqual((stay.rule_set, tickets.rule_set), (suggested[FeeRuleSet.SERVICE], suggested[FeeRuleSet.EVENT]))
        self.assertEqual((stay.booking, tickets.event), (booking, self.event))
        self.assertEqual(self.balance(Account.VENDOR_PENDING, self.owner), 40000)

    def test_review_focus_the_lifetime_cap_is_shared_with_product_orders(self):
        MoneySetting.objects.create(key="fee_cap_pesewas", value=700, effective_from=timezone.now() - timedelta(minutes=1))
        kente = self.listing("Kente", "120.00", Category.objects.get(slug="shops"))
        order = Order.objects.create(customer=self.customer, status=Order.PAID, total_amount=Decimal("120.00"))
        OrderItem.objects.create(order=order, listing=kente, quantity=1, unit_price=Decimal("120.00"), line_total=Decimal("120.00"))
        escrow.record_order_payment(order)                                                    # GH₵ 5.00 of the GH₵ 7.00 cap
        sale = self.service_sale("200.00")
        self.assertEqual((sale.computed_pesewas, sale.charged_pesewas, sale.cap_pesewas), (500, 200, 700))  # only GH₵ 2.00 left
        self.assertEqual(self.service_sale("200.00").charged_pesewas, 0)                     # the cap is used up
        self.assertEqual(fees.charged_to_date(self.owner), 700)

    def test_paid_from_the_wallet_the_wallet_pays_and_a_low_one_writes_nothing(self):
        fund(self.customer, 25000, "fund-1b-payment")
        sale = self.service_sale("200.00", wallet=True)
        self.assertEqual(self.balance(Account.CUSTOMER_WALLET, self.customer), 5000)
        self.assertEqual(self.balance(Account.PROVIDER_CLEARING), 25000)                      # only the top-up moved clearing
        self.assertEqual(self.balance(Account.VENDOR_PENDING, self.owner), 20000)
        with self.assertRaises(posting.InsufficientFunds):
            self.service_sale("200.00", wallet=True)
        self.assertEqual(BookingSale.objects.get(), sale)
        self.assertEqual(self.balance(Account.CUSTOMER_WALLET, self.customer), 5000)

    def test_the_processing_charge_is_not_the_businesss_money(self):
        sr = self.accepted_service("200.00")
        session = self.session(CheckoutSession.SERVICE_REQUEST, "204.00", processing="4.00", service_request_id=sr.pk)
        sale = sales.record_payment(session, BookingSale.SERVICE, sr, self.owner)
        self.assertEqual(sale.base_pesewas, 20000)
        self.assertEqual(self.balance(Account.PROVIDER_CLEARING), 20000)

    def test_review_focus_a_payment_that_does_not_match_the_price_writes_nothing(self):
        sr = self.accepted_service("200.00")
        session = self.session(CheckoutSession.SERVICE_REQUEST, "150.00", service_request_id=sr.pk)
        with self.assertRaises(posting.PostingError):
            sales.record_payment(session, BookingSale.SERVICE, sr, self.owner)
        self.assertFalse(BookingSale.objects.exists())
        self.assertFalse(Journal.objects.filter(kind="booking_payment").exists())

    def test_recording_twice_keeps_one_sale_and_one_journal(self):
        sr = self.accepted_service("200.00")
        session = self.session(CheckoutSession.SERVICE_REQUEST, "200.00", service_request_id=sr.pk)
        first = sales.record_payment(session, BookingSale.SERVICE, sr, self.owner)
        self.assertEqual(sales.record_payment(session, BookingSale.SERVICE, sr, self.owner), first)
        self.assertEqual(Journal.objects.filter(kind="booking_payment").count(), 1)

    def test_a_free_booking_records_nothing_and_a_negative_price_is_refused(self):
        free = self.accepted_service("0.00")
        self.assertIsNone(sales.record_payment(self.session(CheckoutSession.SERVICE_REQUEST, "0.00"), BookingSale.SERVICE, free, self.owner))
        negative = self.accepted_service("-5.00")
        with self.assertRaises(posting.PostingError):
            sales.record_payment(self.session(CheckoutSession.SERVICE_REQUEST, "-5.00"), BookingSale.SERVICE, negative, self.owner)
        self.assertFalse(BookingSale.objects.exists())

    def test_a_customer_organised_event_has_no_business_to_pay(self):
        session = self.session(CheckoutSession.TICKET_PURCHASE, "100.00", unit_price="50.00", quantity=2)
        self.assertIsNone(sales.record_payment(session, BookingSale.TICKETS, self.event, None))
        self.assertFalse(BookingSale.objects.exists())
        self.assertFalse(Account.objects.exists())

    def test_a_wallet_payment_with_a_processing_charge_is_refused(self):
        fund(self.customer, 25000, "fund-1b-proc")
        sr = self.accepted_service("200.00")
        session = self.session(CheckoutSession.SERVICE_REQUEST, "204.00", wallet=True, processing="4.00", service_request_id=sr.pk)
        with self.assertRaises(posting.PostingError):
            sales.record_payment(session, BookingSale.SERVICE, sr, self.owner)
        self.assertFalse(BookingSale.objects.exists())

    def test_a_booking_with_no_price_is_refused_cleanly(self):
        sr = self.accepted_service("200.00")
        sr.agreed_price = None
        with self.assertRaises(posting.PostingError):
            sales.record_payment(self.session(CheckoutSession.SERVICE_REQUEST, "200.00"), BookingSale.SERVICE, sr, self.owner)
        self.assertFalse(BookingSale.objects.exists())

    @override_settings(LEDGER_ENABLED=False)
    def test_with_the_ledger_off_nothing_is_recorded(self):
        self.assertIsNone(self.service_sale("200.00"))
        self.assertFalse(Account.objects.exists())


@override_settings(LEDGER_ENABLED=True)
class CapRaceTests(TransactionTestCase):
    serialized_rollback = True

    def test_review_focus_a_product_and_a_service_paid_at_once_never_pass_the_cap(self):
        customer = Customer.objects.create(full_name="Ama", phone="+233200770201", password_hash="x")
        owner = BusinessOwner.objects.create(full_name="Kwame", login_phone="+233207770201", password_hash="x")
        zone = Zone.objects.get(name="Manhyia")
        MoneySetting.objects.create(key="fee_cap_pesewas", value=600, effective_from=timezone.now() - timedelta(minutes=1))
        kente = Listing.objects.create(
            business_owner=owner, category=Category.objects.get(slug="shops"), zone=zone, name="Kente", description="D.",
            contact_phone=owner.login_phone, price_amount=Decimal("120.00"), status=Listing.PUBLISHED,
        )
        order = Order.objects.create(customer=customer, status=Order.PAID, total_amount=Decimal("120.00"))
        OrderItem.objects.create(order=order, listing=kente, quantity=1, unit_price=Decimal("120.00"), line_total=Decimal("120.00"))
        cleaning = Listing.objects.create(
            business_owner=owner, category=Category.objects.create(slug="cleaning-1b-race", label="Cleaning", kind="service"),
            zone=zone, name="Cleaning", description="D.", contact_phone=owner.login_phone, price_amount=Decimal("200.00"),
            status=Listing.PUBLISHED,
        )
        sr = ServiceRequest.objects.create(
            customer=customer, listing=cleaning, business_owner=owner, message="M.", agreed_price=Decimal("200.00"),
            status=ServiceRequest.IN_PROGRESS,
        )
        session = CheckoutSession.objects.create(
            customer=customer, kind=CheckoutSession.SERVICE_REQUEST, amount=Decimal("200.00"), status=CheckoutSession.SUCCESS,
            purpose="Service", metadata={"service_request_id": sr.pk},
        )
        # Open both accounts first: the race must resolve on posting.lock, not on the accounts' first INSERT.
        posting.account_for(Account.VENDOR_PENDING, owner)
        posting.account_for(Account.PROVIDER_CLEARING)
        outcomes, barrier = [], threading.Barrier(2)

        def run(step):
            try:
                barrier.wait()
                with transaction.atomic():
                    step()
                outcomes.append("paid")
            except Exception as exc:  # noqa: BLE001 - a failure must show in the assertion, not hang the test
                outcomes.append(type(exc).__name__)
            finally:
                connection.close()

        threads = [
            threading.Thread(target=run, args=(lambda: escrow.record_order_payment(order),)),
            threading.Thread(target=run, args=(lambda: sales.record_payment(session, BookingSale.SERVICE, sr, owner),)),
        ]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=10)
            self.assertFalse(thread.is_alive(), "a racing payment hung")
        self.assertEqual(outcomes, ["paid", "paid"])
        charged = sorted([OrderFeeSnapshot.objects.get().charged_pesewas, BookingSale.objects.get().charged_pesewas])
        # Whichever paid second got only what the GH₵ 6.00 cap had left; the order is a race, the total is not.
        self.assertEqual(sum(charged), 600)
        self.assertEqual(fees.charged_to_date(owner), 600)
