from django.test import TestCase
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, Customer, Role, StaffUser
from listings.models import Category, Listing, Zone

from reviews.models import Review


class ReviewModerationTestsBase(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.owner = BusinessOwner.objects.create(
            full_name="Kofi Trader", login_phone="+233207883300", password_hash="x",
        )
        self.author = Customer.objects.create(
            full_name="Ama Buyer", phone="+233200883300", password_hash="x",
        )
        self.other_author = Customer.objects.create(
            full_name="Yaw Buyer", phone="+233200883301", password_hash="x",
        )
        self.category = Category.objects.get(slug="hotels")
        self.zone = Zone.objects.get(name="Manhyia")
        self.listing = Listing.objects.create(
            business_owner=self.owner, category=self.category, zone=self.zone,
            name="Test Lodge", description="A test lodge.", contact_phone="+233207112233",
            price_amount="100.00", status=Listing.PUBLISHED,
        )
        self.review_1 = Review.objects.create(
            target_type=Review.LISTING, listing=self.listing, author=self.author, rating=5, verified=True,
        )
        self.review_2 = Review.objects.create(
            target_type=Review.LISTING, listing=self.listing, author=self.other_author, rating=1, verified=True,
        )
        self.admin = StaffUser.objects.create(
            full_name="Admin Person", email="admin-review-mod@example.com", password_hash="x",
            role=Role.objects.get(name="admin"),
        )
        self.marketing = StaffUser.objects.create(
            full_name="Marketing Person", email="marketing-review-mod@example.com", password_hash="x",
            role=Role.objects.get(name="marketing"),
        )

    def _auth_staff(self, staff):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(staff, 'staff')}")


class ReviewHideUnhideTests(ReviewModerationTestsBase):
    def test_hide_without_permission_is_403(self):
        self._auth_staff(self.marketing)
        response = self.client.post(f"/api/reviews/moderation/{self.review_1.id}/hide/", {"reason": "spam"}, format="json")
        self.assertEqual(response.status_code, 403)

    def test_hide_requires_reason(self):
        self._auth_staff(self.admin)
        response = self.client.post(f"/api/reviews/moderation/{self.review_1.id}/hide/", {}, format="json")
        self.assertEqual(response.status_code, 400)

    def test_hide_with_permission_succeeds(self):
        self._auth_staff(self.admin)
        response = self.client.post(
            f"/api/reviews/moderation/{self.review_1.id}/hide/", {"reason": "abusive content"}, format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.review_1.refresh_from_db()
        self.assertEqual(self.review_1.status, Review.HIDDEN)
        self.assertEqual(self.review_1.hidden_reason, "abusive content")
        self.assertEqual(self.review_1.hidden_by, self.admin)

    def test_hidden_review_disappears_from_public_list_and_aggregate_excludes_it(self):
        self._auth_staff(self.admin)
        self.client.post(f"/api/reviews/moderation/{self.review_1.id}/hide/", {"reason": "spam"}, format="json")

        response = self.client.get(f"/api/reviews/listing/{self.listing.id}/")
        self.assertEqual(response.status_code, 200, response.content)
        data = response.json()
        ids = [r["id"] for r in data["results"]]
        self.assertNotIn(self.review_1.id, ids)
        self.assertIn(self.review_2.id, ids)
        # Only review_2 (rating=1) remains published.
        self.assertEqual(data["avg_rating"], 1.0)
        self.assertEqual(data["review_count"], 1)

    def test_unhide_without_permission_is_403(self):
        self._auth_staff(self.admin)
        self.client.post(f"/api/reviews/moderation/{self.review_1.id}/hide/", {"reason": "spam"}, format="json")
        self._auth_staff(self.marketing)
        response = self.client.post(f"/api/reviews/moderation/{self.review_1.id}/unhide/")
        self.assertEqual(response.status_code, 403)

    def test_unhide_reinstates_review(self):
        self._auth_staff(self.admin)
        self.client.post(f"/api/reviews/moderation/{self.review_1.id}/hide/", {"reason": "spam"}, format="json")
        response = self.client.post(f"/api/reviews/moderation/{self.review_1.id}/unhide/")
        self.assertEqual(response.status_code, 200, response.content)
        self.review_1.refresh_from_db()
        self.assertEqual(self.review_1.status, Review.PUBLISHED)
        self.assertIsNone(self.review_1.hidden_reason)
        self.assertIsNone(self.review_1.hidden_by)

        listing_reviews = self.client.get(f"/api/reviews/listing/{self.listing.id}/")
        ids = [r["id"] for r in listing_reviews.json()["results"]]
        self.assertIn(self.review_1.id, ids)


class ReviewModerationListTests(ReviewModerationTestsBase):
    def test_moderation_list_requires_permission(self):
        self._auth_staff(self.marketing)
        response = self.client.get("/api/reviews/moderation/")
        self.assertEqual(response.status_code, 403)

    def test_moderation_list_shows_all_statuses(self):
        self._auth_staff(self.admin)
        self.client.post(f"/api/reviews/moderation/{self.review_1.id}/hide/", {"reason": "spam"}, format="json")
        response = self.client.get("/api/reviews/moderation/")
        self.assertEqual(response.status_code, 200, response.content)
        ids = [r["id"] for r in response.json()["results"]]
        self.assertIn(self.review_1.id, ids)
        self.assertIn(self.review_2.id, ids)
