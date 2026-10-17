"""Booking sales in the ledger (Plan 1b, Task 1): one subject per sale, of its own kind, and the lifetime cap counted
across products, services, stays and events (spec §1 row 2)."""
from datetime import timedelta
from decimal import Decimal

from django.db import IntegrityError, transaction
from django.test import TestCase
from django.utils import timezone

from accounts.models import BusinessOwner, Customer
from bookings.models import Booking
from ledger import fees, posting
from ledger.models import Account, BookingRefund, BookingSale, FeeRuleSet, OrderFeeSnapshot
from listings.models import Category, Listing, Zone
from orders.models import Order
from payments.models import CheckoutSession
from services.models import ServiceRequest


class BookingSaleModelTests(TestCase):
    def setUp(self):
        self.customer = Customer.objects.create(full_name="Ama", phone="+233200770101", password_hash="x")
        self.owner = BusinessOwner.objects.create(full_name="Kwame", login_phone="+233207770101", password_hash="x")
        category = Category.objects.create(slug="cleaning-1b-models", label="Cleaning", kind="service")
        self.listing = Listing.objects.create(
            business_owner=self.owner, category=category, zone=Zone.objects.get(name="Manhyia"), name="Home Cleaning",
            description="D.", contact_phone=self.owner.login_phone, price_amount=Decimal("200.00"), status=Listing.PUBLISHED,
        )

    def service_request(self):
        return ServiceRequest.objects.create(
            customer=self.customer, listing=self.listing, business_owner=self.owner, message="M.",
            agreed_price=Decimal("200.00"), status=ServiceRequest.IN_PROGRESS,
        )

    def booking(self):
        today = timezone.localdate()
        return Booking.objects.create(
            customer=self.customer, listing=self.listing, business_owner=self.owner, check_in=today,
            check_out=today + timedelta(days=1), nightly_rate=Decimal("200.00"), total_price=Decimal("200.00"),
        )

    def sale(self, kind=BookingSale.SERVICE, charged=500, **subject):
        session = CheckoutSession.objects.create(
            customer=self.customer, kind=CheckoutSession.SERVICE_REQUEST, amount=Decimal("200.00"), purpose="Service",
        )
        return BookingSale.objects.create(
            kind=kind, session=session, customer=self.customer, business_owner=self.owner, category=FeeRuleSet.SERVICE,
            rule_set=fees.rule_set_in_force(FeeRuleSet.SERVICE), base_pesewas=20000, computed_pesewas=charged,
            charged_pesewas=charged, paid_at=timezone.now(), **subject,
        )

    def test_a_sale_names_the_one_subject_its_kind_names(self):
        sale = self.sale(service_request=self.service_request())
        self.assertEqual(sale.label(), f"service request #{sale.service_request_id}")
        with self.assertRaises(IntegrityError), transaction.atomic():
            self.sale(kind=BookingSale.STAY, service_request=self.service_request())          # a stay names a booking
        with self.assertRaises(IntegrityError), transaction.atomic():
            self.sale(kind=BookingSale.STAY, booking=self.booking(), service_request=self.service_request())
        stay = self.sale(kind=BookingSale.STAY, booking=self.booking())
        self.assertEqual(stay.label(), f"stay booking #{stay.booking_id}")

    def test_a_refund_never_exceeds_the_base(self):
        sale = self.sale(service_request=self.service_request())
        with self.assertRaises(IntegrityError), transaction.atomic():
            BookingSale.objects.filter(pk=sale.pk).update(refunded_base_pesewas=20001)

    def test_one_refund_per_sale_and_source(self):
        sale = self.sale(service_request=self.service_request())

        def journal(key):
            return posting.post(key=key, kind="test_refund", lines=[
                posting.debit(posting.account_for(Account.PROVIDER_CLEARING), 100),
                posting.credit(posting.account_for(Account.CUSTOMER_WALLET, self.customer), 100),
            ])

        BookingRefund.objects.create(sale=sale, source="cancel", amount_pesewas=100, journal=journal("test-booking-refund-1"))
        with self.assertRaises(IntegrityError), transaction.atomic():
            BookingRefund.objects.create(sale=sale, source="cancel", amount_pesewas=100, journal=journal("test-booking-refund-2"))

    def test_review_focus_the_lifetime_cap_counts_every_category(self):
        order = Order.objects.create(customer=self.customer, status=Order.PAID, total_amount=Decimal("100.00"))
        OrderFeeSnapshot.objects.create(
            order=order, business_owner=self.owner, category=FeeRuleSet.PRODUCT,
            rule_set=fees.rule_set_in_force(FeeRuleSet.PRODUCT), base_pesewas=10000, computed_pesewas=500, charged_pesewas=500,
        )
        self.sale(charged=500, service_request=self.service_request())
        partly = self.sale(charged=500, service_request=self.service_request())
        BookingSale.objects.filter(pk=partly.pk).update(refunded_base_pesewas=8000, refunded_fee_pesewas=200)
        gone = self.sale(charged=500, service_request=self.service_request())
        BookingSale.objects.filter(pk=gone.pk).update(refunded_base_pesewas=20000, refunded_fee_pesewas=500, reversed_at=timezone.now())
        self.assertEqual(fees.charged_to_date(self.owner), 500 + 500 + 300)
        other = BusinessOwner.objects.create(full_name="Esi", login_phone="+233207770102", password_hash="x")
        self.assertEqual(fees.charged_to_date(other), 0)

    def test_fee_refund_stays_within_zero_and_the_charge(self):
        sale = self.sale(service_request=self.service_request())
        for field, value in [("refunded_fee_pesewas", 501), ("refunded_fee_pesewas", -1), ("refunded_base_pesewas", -1)]:
            with self.assertRaises(IntegrityError), transaction.atomic():
                BookingSale.objects.filter(pk=sale.pk).update(**{field: value})

    def test_category_follows_kind(self):
        with self.assertRaises(IntegrityError), transaction.atomic():
            self.sale(kind=BookingSale.STAY, booking=self.booking()).__class__.objects.filter(
                kind=BookingSale.STAY).update(category=FeeRuleSet.EVENT)
        sale = self.sale(service_request=self.service_request())
        with self.assertRaises(IntegrityError), transaction.atomic():
            BookingSale.objects.filter(pk=sale.pk).update(category=FeeRuleSet.PRODUCT)
        with self.assertRaises(IntegrityError), transaction.atomic():
            BookingSale.objects.filter(pk=sale.pk).update(kind=BookingSale.TICKETS)

    def test_refund_amounts_are_positive_and_fee_not_negative(self):
        sale = self.sale(service_request=self.service_request())
        for i, (amount, fee) in enumerate([(0, 0), (100, -1)]):
            journal = posting.post(key=f"test-booking-refund-bad-{i}", kind="test_refund", lines=[
                posting.debit(posting.account_for(Account.PROVIDER_CLEARING), 100),
                posting.credit(posting.account_for(Account.CUSTOMER_WALLET, self.customer), 100),
            ])
            with self.assertRaises(IntegrityError), transaction.atomic():
                BookingRefund.objects.create(sale=sale, source=f"bad{i}", amount_pesewas=amount, fee_pesewas=fee, journal=journal)
