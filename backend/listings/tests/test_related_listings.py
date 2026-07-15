from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import BusinessOwner
from listings.models import Category, Listing, Zone


class RelatedListingsTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.owner = BusinessOwner.objects.create(
            full_name="Efua Trader", login_phone="+233207334455", password_hash="x",
        )
        self.hotels = Category.objects.get(slug="hotels")
        self.food = Category.objects.get(slug="food")
        self.manhyia = Zone.objects.get(name="Manhyia")
        self.adum = Zone.objects.get(name="Adum")

        self.anchor = Listing.objects.create(
            business_owner=self.owner, category=self.hotels, zone=self.manhyia,
            name="Royal Lodge", description="Luxury kente-draped rooms.",
            contact_phone="+233207334455", price_amount="450.00", status=Listing.PUBLISHED,
        )
        self.same_category = Listing.objects.create(
            business_owner=self.owner, category=self.hotels, zone=self.adum,
            name="Golden Stool Inn", description="Boutique hotel.",
            contact_phone="+233207334455", price_amount="300.00", status=Listing.PUBLISHED,
        )
        self.same_zone = Listing.objects.create(
            business_owner=self.owner, category=self.food, zone=self.manhyia,
            name="Afia's Kitchen", description="Authentic fufu and light soup.",
            contact_phone="+233207334455", price_amount="25.00", status=Listing.PUBLISHED,
        )
        self.unrelated = Listing.objects.create(
            business_owner=self.owner, category=self.food, zone=self.adum,
            name="Adum Chop Bar", description="Quick lunch spot.",
            contact_phone="+233207334455", price_amount="20.00", status=Listing.PUBLISHED,
        )
        self.draft_same_category = Listing.objects.create(
            business_owner=self.owner, category=self.hotels, zone=self.manhyia,
            name="Unfinished Lodge", description="Not ready.",
            contact_phone="+233207334455", status=Listing.DRAFT,
        )

    def test_related_returns_same_category_or_zone_excluding_self(self):
        response = self.client.get(f"/api/listings/{self.anchor.id}/related/")
        self.assertEqual(response.status_code, 200)
        ids = [item["id"] for item in response.json()]
        self.assertIn(self.same_category.id, ids)
        self.assertIn(self.same_zone.id, ids)
        self.assertNotIn(self.anchor.id, ids)

    def test_related_excludes_unrelated_listings(self):
        response = self.client.get(f"/api/listings/{self.anchor.id}/related/")
        ids = [item["id"] for item in response.json()]
        self.assertNotIn(self.unrelated.id, ids)

    def test_related_excludes_non_published_listings(self):
        response = self.client.get(f"/api/listings/{self.anchor.id}/related/")
        ids = [item["id"] for item in response.json()]
        self.assertNotIn(self.draft_same_category.id, ids)

    def test_related_is_limited_to_eight(self):
        for i in range(10):
            Listing.objects.create(
                business_owner=self.owner, category=self.hotels, zone=self.manhyia,
                name=f"Extra Lodge {i}", description="Filler.",
                contact_phone="+233207334455", status=Listing.PUBLISHED,
            )
        response = self.client.get(f"/api/listings/{self.anchor.id}/related/")
        body = response.json()
        self.assertEqual(len(body), 8)

    def test_related_returns_full_public_listing_shape(self):
        response = self.client.get(f"/api/listings/{self.anchor.id}/related/")
        item = response.json()[0]
        self.assertIn("category", item)
        self.assertIn("zone", item)
        self.assertIn("photos", item)
        self.assertIn("main_photo", item)

    def test_related_for_unknown_listing_returns_404(self):
        response = self.client.get("/api/listings/999999/related/")
        self.assertEqual(response.status_code, 404)

    def test_related_for_non_published_anchor_returns_404(self):
        response = self.client.get(f"/api/listings/{self.draft_same_category.id}/related/")
        self.assertEqual(response.status_code, 404)
