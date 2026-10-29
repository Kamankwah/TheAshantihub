"""Shared fixtures for the catalogue tests (catalogue plan 6)."""
import itertools
from datetime import timedelta
from decimal import Decimal

from django.utils import timezone

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, BusinessOwnerProfile, Customer
from accounts.testing import make_staff, staff_token
from listings.models import Category, Listing, Zone
from orders.models import Order, OrderItem

BARCODE = "04006381333931"          # EAN-13 4006381333931, kept as its 14-digit key
OTHER_BARCODE = "05000112637922"    # EAN-13 5000112637922
STORE_CODE = "02000000000015"       # EAN-13 2000000000015: a store's own number (GS1 prefix 200)

_seq = itertools.count(1)


def business(name="Adepa Ventures", *, verified=True, lat=None, lng=None, suspended=False):
    n = next(_seq)
    owner = BusinessOwner.objects.create(
        full_name=f"Owner {n}", login_phone=f"+23320{n:07d}", password_hash="x", is_suspended=suspended,
        kyc_status=BusinessOwner.VERIFIED if verified else BusinessOwner.PENDING,
    )
    # The public verified mark follows approved identity documents, not the address check.
    BusinessOwnerProfile.objects.create(
        business_owner=owner, business_name=name, lat=lat, lng=lng,
        identity_status=BusinessOwnerProfile.IDENTITY_VERIFIED if verified else BusinessOwnerProfile.IDENTITY_NOT_SUBMITTED,
    )
    return owner


def product(owner, name="Milo 400g", *, price="25.00", stock=10, status=Listing.PUBLISHED, barcode="", brand="Nestle",
            category="grocery", catalogue_product=None):
    return Listing.objects.create(
        business_owner=owner, category=Category.objects.get(slug=category), zone=Zone.objects.get(name="Manhyia"),
        name=name, description="A tin.", contact_phone="+233209999999",
        price_amount=None if price is None else Decimal(price), stock_quantity=stock, status=status,
        barcode=barcode, brand=brand, catalogue_product=catalogue_product,
    )


def service(owner, name="Haircut"):
    return Listing.objects.create(
        business_owner=owner, category=Category.objects.get(slug="lifestyle"), zone=Zone.objects.get(name="Manhyia"),
        name=name, description="A cut.", contact_phone="+233209999999", price_amount=Decimal("30.00"),
        status=Listing.PUBLISHED,
    )


def stay(owner, name="Garden Room"):
    category, _ = Category.objects.get_or_create(
        slug="stays-test",
        defaults={"icon": "🛏", "label": "Stays", "color": "#000000", "kind": Category.SERVICE, "is_accommodation": True},
    )
    return Listing.objects.create(
        business_owner=owner, category=category, zone=Zone.objects.get(name="Manhyia"), name=name,
        description="A room.", contact_phone="+233209999999", price_amount=Decimal("300.00"), status=Listing.PUBLISHED,
    )


def buyer():
    n = next(_seq)
    return Customer.objects.create(full_name=f"Customer {n}", phone=f"+23324{n:07d}", password_hash="x")


def sell(listing, quantity, *, days_ago=0, status=Order.PAID):
    """One order line for `listing` placed `days_ago` days back (placed_at is set on create, so it is moved after)."""
    total = listing.price_amount * quantity
    order = Order.objects.create(customer=buyer(), status=status, total_amount=total)
    OrderItem.objects.create(order=order, listing=listing, quantity=quantity, unit_price=listing.price_amount, line_total=total)
    if days_ago:
        Order.objects.filter(pk=order.pk).update(placed_at=timezone.now() - timedelta(days=days_ago))
    return order


def go_live(listing, days_ago):
    """Make `listing` look approved `days_ago` days back (days on sale count from approval)."""
    when = timezone.now() - timedelta(days=days_ago)
    Listing.objects.filter(pk=listing.pk).update(reviewed_at=when, created_at=when)
    listing.refresh_from_db()
    return listing


def as_account(client, account, kind):
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(account, kind)}")


def as_staff(client, role, email):
    staff = make_staff(role, email)
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(staff)}")
    return staff
