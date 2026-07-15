from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import BusinessOwner, Customer
from listings.models import Category, Listing, Zone

from reviews.models import Review


class ListingRatingAnnotationTests(TestCase):
    """avg_rating/review_count on GET /api/listings/ and the detail endpoint
    (reviews/ratings/Q&A plan, docs/PROJECT_SCOPE.md Phase 2).
    """

    def setUp(self):
        self.client = APIClient()
        self.owner = BusinessOwner.objects.create(
            full_name="Kofi Trader", login_phone="+233207885500", password_hash="x",
        )
        self.reviewer_a = Customer.objects.create(
            full_name="Ama A", phone="+233200885500", password_hash="x",
        )
        self.reviewer_b = Customer.objects.create(
            full_name="Yaw B", phone="+233200885501", password_hash="x",
        )
        self.reviewer_c = Customer.objects.create(
            full_name="Kwame C", phone="+233200885502", password_hash="x",
        )
        self.category = Category.objects.get(slug="hotels")
        self.zone = Zone.objects.get(name="Manhyia")
        self.listing = Listing.objects.create(
            business_owner=self.owner, category=self.category, zone=self.zone,
            name="Rated Lodge", description="A lodge with reviews.",
            contact_phone="+233207112233", price_amount="100.00", status=Listing.PUBLISHED,
        )
        self.unrated_listing = Listing.objects.create(
            business_owner=self.owner, category=self.category, zone=self.zone,
            name="Unrated Lodge", description="No reviews yet.",
            contact_phone="+233207112233", price_amount="80.00", status=Listing.PUBLISHED,
        )

        # 3 reviews with known ratings: 5, 4, 3 -> average exactly 4.0.
        Review.objects.create(
            target_type=Review.LISTING, listing=self.listing, author=self.reviewer_a, rating=5, verified=True,
        )
        Review.objects.create(
            target_type=Review.LISTING, listing=self.listing, author=self.reviewer_b, rating=4, verified=True,
        )
        Review.objects.create(
            target_type=Review.LISTING, listing=self.listing, author=self.reviewer_c, rating=3, verified=True,
        )

    def _find(self, results, listing_id):
        return next(item for item in results if item["id"] == listing_id)

    def test_list_endpoint_reports_correct_average_and_count(self):
        response = self.client.get("/api/listings/")
        self.assertEqual(response.status_code, 200, response.content)
        item = self._find(response.json()["results"], self.listing.id)
        self.assertEqual(item["avg_rating"], 4.0)
        self.assertEqual(item["review_count"], 3)

    def test_list_endpoint_unrated_listing_has_null_average_zero_count(self):
        response = self.client.get("/api/listings/")
        item = self._find(response.json()["results"], self.unrated_listing.id)
        self.assertIsNone(item["avg_rating"])
        self.assertEqual(item["review_count"], 0)

    def test_detail_endpoint_reports_correct_average_and_count(self):
        response = self.client.get(f"/api/listings/{self.listing.id}/")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["avg_rating"], 4.0)
        self.assertEqual(response.json()["review_count"], 3)

    def test_hidden_review_excluded_from_average(self):
        hidden = Review.objects.create(
            target_type=Review.LISTING, listing=self.unrated_listing, author=self.reviewer_a,
            rating=1, verified=True, status=Review.HIDDEN,
        )
        response = self.client.get(f"/api/listings/{self.unrated_listing.id}/")
        self.assertIsNone(response.json()["avg_rating"])
        self.assertEqual(response.json()["review_count"], 0)
        self.assertEqual(hidden.status, Review.HIDDEN)

    def test_business_owner_exposed_on_public_listing(self):
        response = self.client.get(f"/api/listings/{self.listing.id}/")
        data = response.json()["business_owner"]
        self.assertEqual(data["id"], self.owner.id)
        self.assertEqual(data["full_name"], self.owner.full_name)
        self.assertEqual(data["kyc_status"], self.owner.kyc_status)

    def test_related_listings_endpoint_also_annotates(self):
        response = self.client.get(f"/api/listings/{self.unrated_listing.id}/related/")
        self.assertEqual(response.status_code, 200, response.content)
        item = self._find(response.json(), self.listing.id)
        self.assertEqual(item["avg_rating"], 4.0)
        self.assertEqual(item["review_count"], 3)


class ListingReviewPaginationEnvelopeTests(TestCase):
    """Confirms GET /api/reviews/listing/<pk>/'s paginated envelope carries
    avg_rating/review_count as top-level keys alongside DRF's normal
    count/next/previous/results, not nested inside results.
    """

    def setUp(self):
        self.client = APIClient()
        self.owner = BusinessOwner.objects.create(
            full_name="Kofi Trader", login_phone="+233207885510", password_hash="x",
        )
        self.reviewer = Customer.objects.create(
            full_name="Ama A", phone="+233200885510", password_hash="x",
        )
        self.category = Category.objects.get(slug="hotels")
        self.zone = Zone.objects.get(name="Manhyia")
        self.listing = Listing.objects.create(
            business_owner=self.owner, category=self.category, zone=self.zone,
            name="Envelope Lodge", description="D.", contact_phone="+233207112233",
            price_amount="100.00", status=Listing.PUBLISHED,
        )
        Review.objects.create(
            target_type=Review.LISTING, listing=self.listing, author=self.reviewer, rating=4, verified=True,
        )

    def test_envelope_shape(self):
        response = self.client.get(f"/api/reviews/listing/{self.listing.id}/")
        self.assertEqual(response.status_code, 200, response.content)
        data = response.json()
        self.assertEqual(set(data.keys()), {"count", "next", "previous", "results", "avg_rating", "review_count"})
        self.assertEqual(data["count"], 1)
        self.assertEqual(data["avg_rating"], 4.0)
        self.assertEqual(data["review_count"], 1)
        self.assertIsInstance(data["results"], list)
