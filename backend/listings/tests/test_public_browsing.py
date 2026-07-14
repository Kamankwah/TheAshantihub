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
        self.grocery = Category.objects.get(slug="grocery")
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

    def test_categories_endpoint_includes_kind(self):
        # The frontend's Products/Services category split (Phase 3) groups
        # categories by this field client-side, so it must be serialized.
        response = self.client.get("/api/listings/categories/")
        hotels = next(c for c in response.json() if c["slug"] == "hotels")
        self.assertEqual(hotels["kind"], "service")

    def test_zones_endpoint_lists_all_nine(self):
        response = self.client.get("/api/listings/zones/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()), 9)

    def test_listings_endpoint_only_returns_published(self):
        response = self.client.get("/api/listings/")
        ids = [item["id"] for item in response.json()["results"]]
        self.assertIn(self.published_hotel.id, ids)
        self.assertIn(self.published_food.id, ids)
        self.assertNotIn(self.draft_listing.id, ids)

    def test_filter_by_category(self):
        response = self.client.get("/api/listings/?category=hotels")
        ids = [item["id"] for item in response.json()["results"]]
        self.assertEqual(ids, [self.published_hotel.id])

    def test_filter_by_zone(self):
        response = self.client.get("/api/listings/?zone=Adum")
        ids = [item["id"] for item in response.json()["results"]]
        self.assertEqual(ids, [self.published_food.id])

    def test_search_by_name(self):
        response = self.client.get("/api/listings/?search=Royal")
        ids = [item["id"] for item in response.json()["results"]]
        self.assertEqual(ids, [self.published_hotel.id])

    def test_price_range_filter(self):
        response = self.client.get("/api/listings/?min_price=100&max_price=500")
        ids = [item["id"] for item in response.json()["results"]]
        self.assertEqual(ids, [self.published_hotel.id])

    def test_ordering_by_price(self):
        response = self.client.get("/api/listings/?ordering=price_amount")
        ids = [item["id"] for item in response.json()["results"]]
        self.assertEqual(ids, [self.published_food.id, self.published_hotel.id])

    def test_listings_endpoint_is_paginated(self):
        for i in range(25):
            Listing.objects.create(
                business_owner=self.owner, category=self.hotels, zone=self.manhyia,
                name=f"Extra Lodge {i}", description="Filler.",
                contact_phone="+233207334455", status=Listing.PUBLISHED,
            )
        response = self.client.get("/api/listings/")
        body = response.json()
        self.assertEqual(body["count"], 27)  # 25 new + published_hotel + published_food
        self.assertEqual(len(body["results"]), 20)
        self.assertIsNotNone(body["next"])
        self.assertIsNone(body["previous"])

    def test_draft_listing_detail_returns_404_for_public(self):
        response = self.client.get(f"/api/listings/{self.draft_listing.id}/")
        self.assertEqual(response.status_code, 404)

    def test_published_listing_detail_returns_200(self):
        response = self.client.get(f"/api/listings/{self.published_hotel.id}/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["name"], "Royal Lodge")

    def test_default_ordering_is_deterministic_and_newest_first(self):
        newer_listing = Listing.objects.create(
            business_owner=self.owner, category=self.hotels, zone=self.manhyia,
            name="Newest Lodge", description="Just published.",
            contact_phone="+233207334455", status=Listing.PUBLISHED,
        )
        response = self.client.get("/api/listings/")
        ids = [item["id"] for item in response.json()["results"]]
        self.assertEqual(ids[0], newer_listing.id)

    def test_filter_by_kind_service(self):
        # hotels is seeded/backfilled as a "service" category, grocery as "product".
        self.assertEqual(self.hotels.kind, Category.SERVICE)
        self.assertEqual(self.grocery.kind, Category.PRODUCT)
        response = self.client.get("/api/listings/?kind=service")
        ids = [item["id"] for item in response.json()["results"]]
        self.assertIn(self.published_hotel.id, ids)
        self.assertIn(self.published_food.id, ids)

    def test_filter_by_kind_product(self):
        grocery_listing = Listing.objects.create(
            business_owner=self.owner, category=self.grocery, zone=self.manhyia,
            name="Kejetia Grocery Run", description="Same-day grocery shopping and delivery.",
            contact_phone="+233207334455", price_amount="15.00", status=Listing.PUBLISHED,
        )
        response = self.client.get("/api/listings/?kind=product")
        ids = [item["id"] for item in response.json()["results"]]
        self.assertEqual(ids, [grocery_listing.id])

    def test_filter_by_verified_true_excludes_unverified_owner_listings(self):
        # self.owner defaults to kyc_status=pending (not verified).
        response = self.client.get("/api/listings/?verified=true")
        ids = [item["id"] for item in response.json()["results"]]
        self.assertEqual(ids, [])

    def test_filter_by_verified_true_includes_verified_owner_listings(self):
        self.owner.kyc_status = BusinessOwner.VERIFIED
        self.owner.save(update_fields=["kyc_status"])
        response = self.client.get("/api/listings/?verified=true")
        ids = [item["id"] for item in response.json()["results"]]
        self.assertIn(self.published_hotel.id, ids)
        self.assertIn(self.published_food.id, ids)

    def test_filter_by_verified_1_also_accepted(self):
        self.owner.kyc_status = BusinessOwner.VERIFIED
        self.owner.save(update_fields=["kyc_status"])
        response = self.client.get("/api/listings/?verified=1")
        ids = [item["id"] for item in response.json()["results"]]
        self.assertIn(self.published_hotel.id, ids)

    def test_verified_false_or_absent_returns_all_published(self):
        response = self.client.get("/api/listings/?verified=false")
        ids = [item["id"] for item in response.json()["results"]]
        self.assertIn(self.published_hotel.id, ids)
        self.assertIn(self.published_food.id, ids)
