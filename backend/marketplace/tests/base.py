"""Fixtures for the Super Admin marketplace oversight tests."""
import itertools

from django.core.cache import cache
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import Customer
from accounts.testing import make_staff, staff_token
from orders.models import Order, OrderItem
from portfolio.tests.health_fixtures import add_listings, make_business

_numbers = itertools.count(1)


def make_customer(name="Ama Buyer", **extra):
    number = next(_numbers)
    return Customer.objects.create(full_name=name, phone=f"+23320{number:07d}", email=f"c{number}@example.com", password_hash="x", **extra)


def make_order(customer, listing, *, status=Order.PAID, total="10.00", **extra):
    order = Order.objects.create(customer=customer, status=status, total_amount=total, **extra)
    OrderItem.objects.create(order=order, listing=listing, quantity=1, unit_price=total, line_total=total)
    return order


class MarketplaceTestCase(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.boss = make_staff("super_admin", "boss@example.com")
        self.support = make_staff("support", "support@example.com")
        self.business = make_business("Akosua Ntoma Kente")
        self.listing = add_listings(self.business, 1)[0]

    def sign_in(self, staff=None, *, sudo=False):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(staff or self.boss, sudo=sudo)}")
