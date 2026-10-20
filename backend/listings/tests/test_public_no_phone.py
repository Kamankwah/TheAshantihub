"""Businesses are never contacted directly: no public response may carry a business phone."""
import json

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, Role, StaffUser
from events.models import Event
from listings.models import Category, Listing, Zone
from storefront.testing import open_marketplace

PHONE = "+233207880123"
LOCAL = "0207880123"
NINE = "207880123"
FORBIDDEN_KEYS = {"contact_phone", "phone", "whatsapp", "whatsapp_number", "business_contact_phone", "login_phone"}


def keys_in(node):
    if isinstance(node, dict):
        for key, value in node.items():
            yield key
            yield from keys_in(value)
    elif isinstance(node, list):
        for value in node:
            yield from keys_in(value)


class PublicNoPhoneBase(TestCase):
    def setUp(self):
        open_marketplace()
        self.client = APIClient()
        self.owner = BusinessOwner.objects.create(
            full_name="Phone Owner", login_phone=PHONE, password_hash="x", kyc_status=BusinessOwner.VERIFIED,
        )
        self.cat = Category.objects.create(slug="zz-nophone", label="ZZ NoPhone", icon="x", color="#000", kind=Category.PRODUCT)
        self.zone = Zone.objects.get(name="Manhyia")
        self.listing = self.make("Kente cloth", sale_price="80.00", sponsored=True)
        self.sibling = self.make("Kente scarf")

    def make(self, name, **extra):
        fields = dict(
            business_owner=self.owner, category=self.cat, zone=self.zone, name=name, description="Nice.",
            contact_phone=PHONE, price_amount="100.00", status=Listing.PUBLISHED, stock_quantity=5,
        )
        fields.update(extra)
        return Listing.objects.create(**fields)

    def assertNoPhone(self, response):
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertFalse(FORBIDDEN_KEYS & set(keys_in(body)), keys_in(body))
        text = json.dumps(body)
        for needle in (PHONE, LOCAL, NINE):
            self.assertNotIn(needle, text)


class PublicListingNoPhoneTests(PublicNoPhoneBase):
    def test_public_listing_list_and_detail_have_no_phone_keys(self):
        self.assertNoPhone(self.client.get("/api/listings/"))
        self.assertNoPhone(self.client.get(f"/api/listings/{self.listing.pk}/"))

    def test_sponsored_deals_search_and_related_have_no_phone(self):
        self.assertNoPhone(self.client.get(f"/api/listings/{self.listing.pk}/related/"))
        self.assertNoPhone(self.client.get("/api/storefront/deals/"))
        self.assertNoPhone(self.client.get("/api/storefront/search/?q=Kente"))
        self.assertNoPhone(self.client.get("/api/storefront/home/"))
        self.assertNoPhone(self.client.get(f"/api/catalogue/listings/{self.listing.pk}/other-sellers/"))
        self.assertNoPhone(self.client.get(f"/api/reviews/seller/{self.owner.pk}/"))

    def test_event_public_has_no_phone(self):
        now = timezone.now()
        event = Event.objects.create(
            category=Category.objects.get(slug="festivals"), zone=self.zone, submitted_by_business=self.owner,
            name="Durbar", description="Royal durbar.", address="Manhyia", lat="6.7", lng="-1.62",
            event_date=now + timezone.timedelta(days=30), visibility_days=14, status=Event.APPROVED,
            paid_at=now, expires_at=now + timezone.timedelta(days=14),
        )
        self.assertNoPhone(self.client.get("/api/events/"))
        self.assertNoPhone(self.client.get(f"/api/events/{event.pk}/"))

    def test_owner_and_staff_endpoints_still_return_contact_phone(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.owner, 'business_owner')}")
        mine = self.client.get("/api/listings/mine/").json()
        rows = mine["results"] if isinstance(mine, dict) else mine
        self.assertTrue(rows)
        self.assertTrue(all(row["contact_phone"] == PHONE for row in rows))
        staff = StaffUser.objects.create(
            full_name="Ops", email="ops-nophone@example.com", password_hash="x", role=Role.objects.get(name="operations"),
        )
        pending = self.make("Pending one", status=Listing.PENDING_REVIEW)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(staff, 'staff')}")
        detail = self.client.get(f"/api/listings/moderation/{pending.pk}/")
        self.assertEqual(detail.status_code, 200)
        self.assertEqual(detail.json()["contact_phone"], PHONE)
