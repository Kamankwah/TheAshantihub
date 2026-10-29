from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import BusinessOwner, Customer
from listings.models import Category, Listing, Zone
from reviews.models import Review


class ReviewDistributionTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.owner = BusinessOwner.objects.create(full_name="Ama Shop", login_phone="+233207992001", password_hash="x")
        self.listing = Listing.objects.create(
            business_owner=self.owner, category=Category.objects.get(slug="shops"), zone=Zone.objects.get(name="Manhyia"),
            name="Thing", description="D.", contact_phone="+233207992001", price_amount="10.00", status=Listing.PUBLISHED,
        )

    def review(self, rating, status=Review.PUBLISHED, n=[0]):
        n[0] += 1
        customer = Customer.objects.create(full_name=f"C{n[0]}", phone=f"+2332009920{n[0]:02d}", password_hash="x")
        return Review.objects.create(
            target_type=Review.LISTING, listing=self.listing, author=customer, rating=rating, comment="ok", status=status,
        )

    def test_counts_only_published_reviews(self):
        for rating in (5, 5, 4, 1):
            self.review(rating)
        self.review(2, status=Review.PENDING)
        body = self.client.get(f"/api/reviews/listing/{self.listing.pk}/").json()
        self.assertEqual(body["distribution"], {"5": 2, "4": 1, "3": 0, "2": 0, "1": 1})
        self.assertEqual(body["review_count"], 4)

    def test_distribution_covers_every_page_not_just_the_current_one(self):
        for _ in range(22):
            self.review(3)
        body = self.client.get(f"/api/reviews/listing/{self.listing.pk}/", {"page": 2}).json()
        self.assertEqual(body["distribution"]["3"], 22)

    def test_empty_listing_returns_all_zero_counts(self):
        body = self.client.get(f"/api/reviews/listing/{self.listing.pk}/").json()
        self.assertEqual(body["distribution"], {"5": 0, "4": 0, "3": 0, "2": 0, "1": 0})
