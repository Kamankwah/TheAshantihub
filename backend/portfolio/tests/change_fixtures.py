"""Shared fixtures for the scout-change tests (Tasks 9 and 10): a scout-managed
business with a profile, a pin and a subscription, a published listing, a valid
product body and real JPEG uploads. Not a test module."""
import io
import tempfile
from datetime import timedelta
from decimal import Decimal

from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.utils import timezone
from PIL import Image
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, BusinessOwnerProfile
from accounts.testing import make_staff, staff_token
from billing.models import Subscription, SubscriptionPlan
from listings.models import Category, Listing, Zone
from portfolio.proposals import stage_photo

TEST_MEDIA_ROOT = tempfile.mkdtemp()


def jpeg(name="photo.jpg"):
    # The image validators sniff real bytes (python-magic + Pillow), so the
    # fixture must be a genuine JPEG.
    buf = io.BytesIO()
    Image.new("RGB", (4, 4), (180, 40, 40)).save(buf, format="JPEG")
    return SimpleUploadedFile(name, buf.getvalue(), content_type="image/jpeg")


def make_business(manager, *, phone="+233244100200", name="Abena Kente House", gps="AK-039-5028",
                  kind="product", kyc_status=BusinessOwner.VERIFIED, plan="product_basic",
                  subscribed=True, email=None):
    """A scout-registered, claimed business managed by `manager`, pinned in
    Manhyia by its owner, with an active subscription (Product Basic: 5 live
    listings) unless subscribed=False."""
    owner = BusinessOwner.objects.create(
        full_name="Abena Owusu", login_phone=phone, email=email, password_hash="x", kyc_status=kyc_status,
        registration_channel=BusinessOwner.SCOUT, registered_by=manager, account_manager=manager,
        claimed_at=timezone.now(),
    )
    BusinessOwnerProfile.objects.create(
        business_owner=owner, business_name=name, business_kind=kind, gps_address=gps,
        business_contact_phone=phone, zone=Zone.objects.get(name="Manhyia"),
        lat=Decimal("6.700000"), lng=Decimal("-1.610000"), location_accuracy_m=12,
        location_set_by="owner", location_set_at=timezone.now() - timedelta(days=20),
        opening_hours="Mon–Sat 8am–6pm", business_description="Kente and fabrics.",
    )
    if subscribed:
        now = timezone.now()
        Subscription.objects.create(
            business_owner=owner, plan=SubscriptionPlan.objects.get(tier=plan),
            current_period_start=now, current_period_end=now + timedelta(days=30),
        )
    return owner


def make_listing(owner, *, name="Kente stole", status=Listing.PUBLISHED):
    return Listing.objects.create(
        business_owner=owner, category=Category.objects.get(slug="shops"), zone=Zone.objects.get(name="Manhyia"),
        name=name, description="Hand-woven.", contact_phone=owner.login_phone, status=status,
        has_warranty=False, has_expiry=False, return_policy="Exchange within 7 days.",
    )


def product_body(**overrides):
    """A complete product listing as the Add-a-product form sends it."""
    body = {
        "category": Category.objects.get(slug="shops").id,
        "zone": Zone.objects.get(name="Adum").id,
        "name": "Kente stole",
        "description": "Hand-woven kente stole, 2 m.",
        "price_amount": "250.00",
        "price_unit": "each",
        "has_warranty": False,
        "has_expiry": False,
        "return_policy": "Exchange within 7 days if unworn.",
    }
    body.update(overrides)
    return body


@override_settings(MEDIA_ROOT=TEST_MEDIA_ROOT)
class ChangeTestBase(TestCase):
    """Ama (Operations) leads Kwame and Yaw (scouts); Kwame manages Abena Kente House."""

    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.lead = make_staff("operations", "ama@example.com")
        self.scout = make_staff("scout", "kwame@example.com", manager=self.lead)
        self.other_scout = make_staff("scout", "yaw@example.com", manager=self.lead)
        self.owner = make_business(self.scout)

    def as_staff(self, staff):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(staff)}")

    def as_owner(self, owner):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(owner, 'business_owner')}")

    def staged(self, owner=None, by=None, name="photo.jpg"):
        return stage_photo(owner or self.owner, by or self.scout, jpeg(name))
