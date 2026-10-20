"""Fixtures for the vendor-side tests (not test cases themselves): businesses, and product orders paid, delivered,
released and refunded through the real ledger paths."""
from datetime import timedelta
from decimal import Decimal

from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, Customer
from accounts.testing import make_staff
from ledger import escrow, posting, verification
from ledger.models import Account
from listings.models import Category, Listing, Zone
from marketing.models_waivers import DeliveryWaiver, WaivedFeeCharge
from orders.models import DeliveryAssignment, Order, OrderItem
from otp import senders
from otp.identity import contacts
from otp.models import SMS, VerifiedContact


def signed_in(account, kind):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(account, kind)}")
    return client


class Shop:
    """A business with its own listings and a signed-in API client."""

    def __init__(self, name, phone):
        self.owner = BusinessOwner.objects.create(full_name=name, login_phone=phone, password_hash="x")
        # The login phone is a confirmed contact (a code to it was accepted): money texts only go to those.
        VerifiedContact.objects.create(
            account_type="business_owner", account_id=self.owner.pk, channel=SMS, destination=contacts(self.owner)[SMS],
        )
        self.client = signed_in(self.owner, "business_owner")
        self.count = 0

    def listing(self, price):
        self.count += 1
        return Listing.objects.create(
            business_owner=self.owner, category=Category.objects.get(slug="shops"), zone=Zone.objects.get(name="Manhyia"),
            name=f"{self.owner.full_name} item {self.count}", description="D.", contact_phone=self.owner.login_phone,
            price_amount=Decimal(price), status=Listing.PUBLISHED,
        )

    def get(self, url, params=None):
        return self.client.get(url, params or {})


def customer(phone="+233241110001", name="Ama Buyer"):
    return Customer.objects.create(full_name=name, phone=phone, password_hash="x")


def paid_order(buyer, lines, *, delivery=None, record=True):
    """A paid door-to-door order of [(listing, quantity)], its payment recorded in the ledger as checkout records it
    (record=False: an order paid before the ledger was on)."""
    items = sum((listing.price_amount * quantity for listing, quantity in lines), Decimal("0.00"))
    order = Order.objects.create(
        customer=buyer, status=Order.PAID, total_amount=items + Decimal(delivery or "0.00"), delivery_fee=delivery,
        delivery_method=Order.DOOR_TO_DOOR, delivery_address="12 Kejetia Road", delivery_phone=buyer.phone,
    )
    for listing, quantity in lines:
        OrderItem.objects.create(
            order=order, listing=listing, quantity=quantity, unit_price=listing.price_amount,
            line_total=listing.price_amount * quantity,
        )
    if record:
        escrow.record_order_payment(order)
    return order


def deliver(order):
    """The rider delivered it and the customer confirmed receipt."""
    now = timezone.now()
    DeliveryAssignment.objects.create(
        order=order, status=DeliveryAssignment.CONFIRMED, delivered_at=now - timedelta(minutes=30), confirmed_at=now,
    )


def release(order):
    """Delivered, confirmed, and Support's call says it matches: the money is released (ledger.verification.record)."""
    deliver(order)
    verification.record(order, make_staff("support", f"support-{order.pk}@example.com"), "matches")


def waived(owner, order, amount, funded_by=DeliveryWaiver.FUNDER_BUSINESS):
    """The business's free-delivery promo covered this order's delivery (owed; charged from Available at release)."""
    now = timezone.now()
    waiver = DeliveryWaiver.objects.create(
        business_owner=owner, name="Free delivery week", starts_at=now - timedelta(days=1), ends_at=now + timedelta(days=1),
        status=DeliveryWaiver.ACTIVE, funded_by=funded_by,
    )
    return WaivedFeeCharge.objects.create(order=order, waiver=waiver, business_owner=owner, amount=Decimal(amount), funded_by=funded_by)


def hold(owner, pesewas, key):
    """A withdrawal held from the business's Available, in the shape wallets.withdrawals posts it."""
    posting.post(key=key, kind="withdrawal_hold", lines=[
        posting.debit(posting.account_for(Account.VENDOR_AVAILABLE, owner), pesewas),
        posting.credit(posting.account_for(Account.WITHDRAWAL_IN_TRANSIT), pesewas),
    ])


class VendorBase(TestCase):
    """Two businesses (Kofi, Esi) and a customer; the text outbox emptied."""

    def setUp(self):
        cache.clear()
        senders.sms_outbox.clear()
        self.kofi = Shop("Kofi Mensah", "+233201110001")
        self.esi = Shop("Esi Boateng", "+233201110002")
        self.buyer = customer()

    def twin(self):
        """A customer whose id is the same number as Kofi's business id (a different account kind). Call it last in a
        test: a row made with an explicit id does not move the id sequence."""
        pk = self.kofi.owner.pk
        return Customer.objects.filter(pk=pk).first() or Customer.objects.create(
            pk=pk, full_name="Twin Buyer", phone="+233241119999", password_hash="x",
        )
