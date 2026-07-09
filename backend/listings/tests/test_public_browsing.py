from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import BusinessOwner
from listings.models import Category, Listing, Zone


class PublicBrowsingTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.owner = BusinessOwner.objects.create(
            full_name="Efua Trader", login_phone="+233207334455", password_hash="x",
        )
        self.hotels = Category.objects.get(slug="hotels")
        self.food = Category.objects.get(slug="food")
        self.manhyia = Zone.objects.get(name="Manhyia")
        self.adum = Zone.objects.get(name="Adum")

        self.published_hotel = Listing.objects.create(
            business_owner=self.owner, category=self.hotels, zone=self.manhyia,
            name="Royal Lodge", description="Luxury kente-draped rooms.",
            contact_phone="+233207334455", price_amount="450.00", status=Listing.PUBLISHED,
        )
        self.published_food = Listing.objects.create(
            business_owner=self.owner, category=self.food, zone=self.adum,
            name="Afia's Kitchen", description="Authentic fufu and light soup.",
            contact_phone="+233207334455", price_amount="25.00", status=Listing.PUBLISHED,
        )
        self.draft_listing = Listing.objects.create(
            business_owner=self.owner, category=self.hotels, zone=self.manhyia,
            name="Unfinished Lodge", description="Not ready.",
            contact_phone="+233207334455", status=Listing.DRAFT,
        )

    def test_categories_endpoint_lists_all_fifteen(self):
        response = self.client.get("/api/listings/categories/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()), 15)

    def test_zones_endpoint_lists_all_nine(self):
        response = self.client.get("/api/listings/zones/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()), 9)

    def test_listings_endpoint_only_returns_published(self):
        response = self.client.get("/api/listings/")
        ids = [item["id"] for item in response.json()]
        self.assertIn(self.published_hotel.id, ids)
        self.assertIn(self.published_food.id, ids)
        self.assertNotIn(self.draft_listing.id, ids)

    def test_filter_by_category(self):
        response = self.client.get("/api/listings/?category=hotels")
        ids = [item["id"] for item in response.json()]
        self.assertEqual(ids, [self.published_hotel.id])

    def test_filter_by_zone(self):
        response = self.client.get("/api/listings/?zone=Adum")
        ids = [item["id"] for item in response.json()]
        self.assertEqual(ids, [self.published_food.id])

    def test_search_by_name(self):
        response = self.client.get("/api/listings/?search=Royal")
        ids = [item["id"] for item in response.json()]
        self.assertEqual(ids, [self.published_hotel.id])

    def test_price_range_filter(self):
        response = self.client.get("/api/listings/?min_price=100&max_price=500")
        ids = [item["id"] for item in response.json()]
        self.assertEqual(ids, [self.published_hotel.id])

    def test_ordering_by_price(self):
        response = self.client.get("/api/listings/?ordering=price_amount")
        ids = [item["id"] for item in response.json()]
        self.assertEqual(ids, [self.published_food.id, self.published_hotel.id])

    def test_draft_listing_detail_returns_404_for_public(self):
        response = self.client.get(f"/api/listings/{self.draft_listing.id}/")
        self.assertEqual(response.status_code, 404)

    def test_published_listing_detail_returns_200(self):
        response = self.client.get(f"/api/listings/{self.published_hotel.id}/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["name"], "Royal Lodge")
