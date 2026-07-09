from django.test import TestCase
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, BusinessOwnerProfile, Customer
from listings.models import Category, Listing, Zone


class ListingCRUDTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.owner = BusinessOwner.objects.create(
            full_name="Kofi Trader", login_phone="+233207445566", password_hash="x",
        )
        BusinessOwnerProfile.objects.create(
            business_owner=self.owner, ghana_card_number="GHA-222333444-5",
            gps_address="AK-039-5060", business_contact_phone="+233207445566",
            is_formal=False, default_payout_method="momo", payout_momo_network="MTN",
            payout_momo_number="+233207445566", payout_momo_name="Kofi Trader",
        )
        self.other_owner = BusinessOwner.objects.create(
            full_name="Ama Seller", login_phone="+233207445577", password_hash="x",
        )
        self.hotels = Category.objects.get(slug="hotels")
        self.manhyia = Zone.objects.get(name="Manhyia")
        self.token = issue_token(self.owner, "business_owner")

    def _auth(self, owner):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(owner, 'business_owner')}")

    def test_create_listing_defaults_contact_phone_from_profile(self):
        self._auth(self.owner)
        response = self.client.post(
            "/api/listings/mine/",
            {"category": self.hotels.id, "zone": self.manhyia.id, "name": "New Lodge", "description": "Desc."},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        listing = Listing.objects.get(id=response.json()["id"])
        self.assertEqual(listing.contact_phone, "+233207445566")
        self.assertEqual(listing.status, Listing.DRAFT)
        self.assertEqual(listing.business_owner, self.owner)

    def test_list_mine_returns_only_own_listings_any_status(self):
        Listing.objects.create(
            business_owner=self.owner, category=self.hotels, zone=self.manhyia,
            name="Mine", description="D.", contact_phone="+233207445566", status=Listing.DRAFT,
        )
        Listing.objects.create(
            business_owner=self.other_owner, category=self.hotels, zone=self.manhyia,
            name="Not Mine", description="D.", contact_phone="+233207445577", status=Listing.PUBLISHED,
        )
        self._auth(self.owner)
        response = self.client.get("/api/listings/mine/")
        names = [item["name"] for item in response.json()]
        self.assertEqual(names, ["Mine"])

    def test_owner_can_edit_own_draft_listing(self):
        listing = Listing.objects.create(
            business_owner=self.owner, category=self.hotels, zone=self.manhyia,
            name="Old Name", description="D.", contact_phone="+233207445566",
        )
        self._auth(self.owner)
        response = self.client.patch(f"/api/listings/mine/{listing.id}/", {"name": "New Name"}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        listing.refresh_from_db()
        self.assertEqual(listing.name, "New Name")

    def test_other_owner_cannot_edit_listing(self):
        listing = Listing.objects.create(
            business_owner=self.owner, category=self.hotels, zone=self.manhyia,
            name="Old Name", description="D.", contact_phone="+233207445566",
        )
        self._auth(self.other_owner)
        response = self.client.patch(f"/api/listings/mine/{listing.id}/", {"name": "Hijacked"}, format="json")
        self.assertEqual(response.status_code, 403)

    def test_cannot_edit_published_listing(self):
        listing = Listing.objects.create(
            business_owner=self.owner, category=self.hotels, zone=self.manhyia,
            name="Live Listing", description="D.", contact_phone="+233207445566",
            status=Listing.PUBLISHED,
        )
        self._auth(self.owner)
        response = self.client.patch(f"/api/listings/mine/{listing.id}/", {"name": "Changed"}, format="json")
        self.assertEqual(response.status_code, 400)

    def test_submit_moves_draft_to_pending_review(self):
        listing = Listing.objects.create(
            business_owner=self.owner, category=self.hotels, zone=self.manhyia,
            name="Ready Listing", description="D.", contact_phone="+233207445566",
        )
        self._auth(self.owner)
        response = self.client.post(f"/api/listings/mine/{listing.id}/submit/")
        self.assertEqual(response.status_code, 200, response.content)
        listing.refresh_from_db()
        self.assertEqual(listing.status, Listing.PENDING_REVIEW)

    def test_customer_cannot_create_a_listing(self):
        customer = Customer.objects.create(full_name="Ama", phone="+233200008888", password_hash="x")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(customer, 'customer')}")
        response = self.client.post(
            "/api/listings/mine/",
            {"category": self.hotels.id, "zone": self.manhyia.id, "name": "Nope", "description": "D."},
            format="json",
        )
        self.assertEqual(response.status_code, 403)
