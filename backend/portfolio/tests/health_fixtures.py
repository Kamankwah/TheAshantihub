"""Fixtures shared by the portfolio health and API tests (plan 2A Task 8)."""
import io
import itertools
from datetime import timedelta

from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone
from PIL import Image

from accounts.models import BusinessOwner, BusinessOwnerProfile, Customer
from billing.models import Subscription, SubscriptionPlan
from calls.models import CallLog
from listings.models import Category, Listing, Zone
from orders.models import Order, OrderItem

_owner_numbers = itertools.count(1)
_customer_numbers = itertools.count(1)


def owner_phone():
    return f"+23324{next(_owner_numbers):07d}"


def image(name="photo.jpg"):
    buf = io.BytesIO()
    Image.new("RGB", (1, 1)).save(buf, format="JPEG")
    return SimpleUploadedFile(name, buf.getvalue(), content_type="image/jpeg")


def goods_category():
    category, _ = Category.objects.get_or_create(
        slug="portfolio-health-test",
        defaults={"icon": "🧺", "label": "Portfolio test goods", "color": "#336699", "kind": Category.PRODUCT},
    )
    return category


def make_business(name, *, manager=None, kyc=BusinessOwner.VERIFIED, kyc_days=90, zone="Bantama", phone=None,
                  **owner_fields):
    """A business (owner + profile). Verified ones were approved `kyc_days` ago."""
    owner = BusinessOwner.objects.create(
        full_name=f"{name} Owner", login_phone=phone or owner_phone(), password_hash="x", kyc_status=kyc,
        reviewed_at=None if kyc == BusinessOwner.PENDING else timezone.now() - timedelta(days=kyc_days),
        account_manager=manager, **owner_fields,
    )
    BusinessOwnerProfile.objects.create(
        business_owner=owner, business_name=name, business_kind="product",
        zone=Zone.objects.get(name=zone) if zone else None,
    )
    return owner


def subscribe(owner, *, ends_at=None, overdue_since=None, paused_at=None, is_trial=False):
    end = ends_at or timezone.now() + timedelta(days=20)
    return Subscription.objects.create(
        business_owner=owner, plan=SubscriptionPlan.objects.get(tier="product_basic"), is_trial=is_trial,
        current_period_start=end - timedelta(days=30), current_period_end=end,
        overdue_since=overdue_since, paused_at=paused_at,
    )


def subscribe_overdue(owner, since):
    """Overdue since `since`, already marked by the hourly clock."""
    return subscribe(owner, ends_at=since, overdue_since=since)


def subscribe_paused(owner):
    now = timezone.now()
    since = now - timedelta(days=20)
    return subscribe(owner, ends_at=since, overdue_since=since, paused_at=now - timedelta(days=6))


def add_listings(owner, count, *, status=Listing.PUBLISHED):
    return [
        Listing.objects.create(
            business_owner=owner, category=goods_category(), zone=Zone.objects.get(name="Bantama"),
            name=f"{owner.full_name} item {index}", description="D.", contact_phone=owner.login_phone,
            status=status,
        )
        for index in range(count)
    ]


def add_order(owner, *, days_ago, status=Order.PAID):
    """An order with one line from this business, placed `days_ago` days ago."""
    listing = owner.listings.order_by("pk").first() or add_listings(owner, 1, status=Listing.DRAFT)[0]
    customer = Customer.objects.create(
        full_name="Ama Buyer", phone=f"+23320{next(_customer_numbers):07d}", password_hash="x",
    )
    order = Order.objects.create(customer=customer, status=status, total_amount="10.00")
    OrderItem.objects.create(order=order, listing=listing, quantity=1, unit_price="10.00", line_total="10.00")
    Order.objects.filter(pk=order.pk).update(placed_at=timezone.now() - timedelta(days=days_ago))
    return order


def log_call(owner, staff, *, days_ago, about_only=False):
    """A call with the owner — or, with about_only, a call to someone else that
    was logged about the business (related_type/related_id)."""
    where = (
        {"counterpart_type": "other", "related_type": "business_owner", "related_id": str(owner.pk)}
        if about_only else {"counterpart_type": "business_owner", "counterpart_id": owner.pk}
    )
    return CallLog.objects.create(
        staff=staff, direction="out", purpose="onboarding", outcome="connected",
        started_at=timezone.now() - timedelta(days=days_ago), **where,
    )


def make_healthy(owner, staff, *, subscription=subscribe, live_listings=3, order_days_ago=5, call_days_ago=3):
    """Everything a healthy business has; each keyword knocks one input out
    (None = leave it out)."""
    if subscription is not None:
        subscription(owner)
    add_listings(owner, live_listings)
    if order_days_ago is not None:
        add_order(owner, days_ago=order_days_ago)
    if call_days_ago is not None:
        log_call(owner, staff, days_ago=call_days_ago)
    return owner
