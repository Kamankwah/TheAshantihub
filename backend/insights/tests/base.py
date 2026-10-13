from decimal import Decimal

from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import BusinessOwner, BusinessOwnerProfile, Customer
from accounts.testing import make_staff, staff_token
from billing.models import Transaction
from listings.models import Category, Listing, Zone
from orders.models import Order, OrderItem
from payments.models import CheckoutSession
from payments.services import process_payment


class InsightsBase(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.boss = make_staff("super_admin", "boss@example.com")
        self.lead = make_staff("operations", "ama@example.com")
        self.scout = make_staff("scout", "kwame@example.com", manager=self.lead)
        self.accountant = make_staff("accountant", "kofi@example.com")
        self.hotels = Category.objects.get(slug="hotels")
        self.adum = Zone.objects.get(name="Manhyia")
        self.owner = BusinessOwner.objects.create(
            full_name="Kofi Trader", login_phone="+233207662001", password_hash="x", kyc_status=BusinessOwner.VERIFIED,
            registered_by=self.scout, account_manager=self.scout,
        )
        BusinessOwnerProfile.objects.create(business_owner=self.owner, business_name="Kofi Rooms", zone=self.adum, business_category=self.hotels)
        self.customer = Customer.objects.create(full_name="Ama Buyer", phone="+233200662001", password_hash="x")
        self.listing = Listing.objects.create(
            business_owner=self.owner, category=self.hotels, zone=self.adum, name="Room A", description="D.",
            contact_phone="+233207662001", price_amount="150.00", status=Listing.PUBLISHED,
        )

    def as_staff(self, staff, sudo=False):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(staff, sudo=sudo)}")

    def sale(self, amount="150.00", customer=None):
        """A paid order for the listing, with its simulated payment."""
        customer = customer or self.customer
        order = Order.objects.create(customer=customer, status=Order.PAID, total_amount=Decimal(amount))
        OrderItem.objects.create(order=order, listing=self.listing, quantity=1, unit_price=Decimal(amount), line_total=Decimal(amount))
        process_payment(kind=CheckoutSession.ORDER_CHECKOUT, amount=Decimal(amount), purpose=f"Order #{order.pk}", customer=customer, metadata={"order_id": order.pk})
        return order

    def subscription(self, amount="100.00", months=1):
        return process_payment(
            kind=CheckoutSession.SUBSCRIPTION, amount=Decimal(amount), purpose="Subscription", business_owner=self.owner,
            metadata={"plan": "product_basic", "cycle_months": months, "paid_months": months},
        )

    def promotion(self, amount="40.00"):
        from listings.models import Promotion

        promo = Promotion.objects.create(
            listing=self.listing, kind=Promotion.FEATURED, starts_at=timezone.now(), ends_at=timezone.now() + timezone.timedelta(days=3),
            amount_paid=Decimal(amount), status=Promotion.PENDING,
        )
        Transaction.objects.create(business_owner=self.owner, amount=Decimal(amount), purpose="Featured promotion", status=Transaction.SUCCESS, reference=f"AH-PROMO-{promo.pk}-ABCD1234")
        return promo
