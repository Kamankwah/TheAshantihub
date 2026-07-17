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
        self.third_author = Customer.objects.create(
            full_name="Esi Buyer", phone="+233200883302", password_hash="x",
        )
        self.category = Category.objects.get(slug="hotels")
        self.zone = Zone.objects.get(name="Manhyia")
        self.listing = Listing.objects.create(
            business_owner=self.owner, category=self.category, zone=self.zone,
            name="Test Lodge", description="A test lodge.", contact_phone="+233207112233",
            price_amount="100.00", status=Listing.PUBLISHED,
        )
        # Reviews default to PENDING now, so anything standing in for an
        # already-live review has to say so explicitly.
        self.review_1 = Review.objects.create(
            target_type=Review.LISTING, listing=self.listing, author=self.author,
            rating=5, verified=True, status=Review.PUBLISHED,
        )
        self.review_2 = Review.objects.create(
            target_type=Review.LISTING, listing=self.listing, author=self.other_author,
            rating=1, verified=True, status=Review.PUBLISHED,
        )
        self.pending_review = Review.objects.create(
            target_type=Review.LISTING, listing=self.listing, author=self.third_author,
            rating=4, verified=True, status=Review.PENDING,
        )
        self.admin = StaffUser.objects.create(
            full_name="Admin Person", email="admin-review-mod@example.com", password_hash="x",
            role=Role.objects.get(name="admin"),
        )
        self.marketing = StaffUser.objects.create(
            full_name="Marketing Person", email="marketing-review-mod@example.com", password_hash="x",
            role=Role.objects.get(name="marketing"),
        )
        self.super_admin = StaffUser.objects.create(
            full_name="Super Person", email="super-review-mod@example.com", password_hash="x",
            role=Role.objects.get(name="super_admin"),
        )

    def _auth_staff(self, staff):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(staff, 'staff')}")


class ReviewApproveTests(ReviewModerationTestsBase):
    def test_approve_without_permission_is_403(self):
        self._auth_staff(self.marketing)
        response = self.client.post(f"/api/reviews/moderation/{self.pending_review.id}/approve/")
        self.assertEqual(response.status_code, 403)

    def test_approve_publishes_and_records_reviewer(self):
        self._auth_staff(self.admin)
        response = self.client.post(f"/api/reviews/moderation/{self.pending_review.id}/approve/")
        self.assertEqual(response.status_code, 200, response.content)
        self.pending_review.refresh_from_db()
        self.assertEqual(self.pending_review.status, Review.PUBLISHED)
        self.assertEqual(self.pending_review.reviewed_by, self.admin)
        self.assertIsNotNone(self.pending_review.reviewed_at)

    def test_approve_rejects_an_already_published_review(self):
        self._auth_staff(self.admin)
        response = self.client.post(f"/api/reviews/moderation/{self.review_1.id}/approve/")
        self.assertEqual(response.status_code, 400)

    def test_approved_review_appears_publicly_and_counts_toward_rating(self):
        before = self.client.get(f"/api/reviews/listing/{self.listing.id}/").json()
        self.assertNotIn(self.pending_review.id, [r["id"] for r in before["results"]])
        self.assertEqual(before["review_count"], 2)

        self._auth_staff(self.admin)
        self.client.post(f"/api/reviews/moderation/{self.pending_review.id}/approve/")

        self.client.credentials()
        after = self.client.get(f"/api/reviews/listing/{self.listing.id}/").json()
        self.assertIn(self.pending_review.id, [r["id"] for r in after["results"]])
        self.assertEqual(after["review_count"], 3)


class ReviewPendingVisibilityTests(ReviewModerationTestsBase):
    """A pending review must be invisible to the public and must not move any
    rating average — the load-bearing guarantee of pre-moderation.
    """

    def test_pending_review_is_not_in_the_public_list(self):
        response = self.client.get(f"/api/reviews/listing/{self.listing.id}/")
        self.assertEqual(response.status_code, 200, response.content)
        ids = [r["id"] for r in response.json()["results"]]
        self.assertNotIn(self.pending_review.id, ids)

    def test_pending_review_does_not_affect_the_aggregate(self):
        data = self.client.get(f"/api/reviews/listing/{self.listing.id}/").json()
        # Only the two published reviews (5 and 1) count — the pending 4 does not.
        self.assertEqual(data["review_count"], 2)
        self.assertEqual(data["avg_rating"], 3.0)


class ReviewHideTests(ReviewModerationTestsBase):
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

    def test_hide_records_the_canonical_reviewer_pair_too(self):
        self._auth_staff(self.admin)
        self.client.post(
            f"/api/reviews/moderation/{self.review_1.id}/hide/", {"reason": "spam"}, format="json",
        )
        self.review_1.refresh_from_db()
        self.assertEqual(self.review_1.reviewed_by, self.admin)
        self.assertIsNotNone(self.review_1.reviewed_at)

    def test_rejecting_a_pending_review_hides_it(self):
        self._auth_staff(self.admin)
        response = self.client.post(
            f"/api/reviews/moderation/{self.pending_review.id}/hide/", {"reason": "fake"}, format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.pending_review.refresh_from_db()
        self.assertEqual(self.pending_review.status, Review.HIDDEN)

    def test_hidden_review_disappears_from_public_list_and_aggregate_excludes_it(self):
        self._auth_staff(self.admin)
        self.client.post(f"/api/reviews/moderation/{self.review_1.id}/hide/", {"reason": "spam"}, format="json")

        self.client.credentials()
        response = self.client.get(f"/api/reviews/listing/{self.listing.id}/")
        self.assertEqual(response.status_code, 200, response.content)
        data = response.json()
        ids = [r["id"] for r in data["results"]]
        self.assertNotIn(self.review_1.id, ids)
        self.assertIn(self.review_2.id, ids)
        # Only review_2 (rating=1) remains published.
        self.assertEqual(data["avg_rating"], 1.0)
        self.assertEqual(data["review_count"], 1)


class ReviewReReviewTests(ReviewModerationTestsBase):
    def _reject(self, review):
        self._auth_staff(self.admin)
        self.client.post(
            f"/api/reviews/moderation/{review.id}/hide/", {"reason": "spam"}, format="json",
        )

    def test_re_review_is_403_for_a_moderator_without_re_review(self):
        """reviews.moderate alone is not enough — this is the tighter gate."""
        self._reject(self.review_1)
        self._auth_staff(self.admin)
        response = self.client.post(f"/api/reviews/moderation/{self.review_1.id}/re-review/")
        self.assertEqual(response.status_code, 403)

    def test_re_review_by_super_admin_returns_review_to_pending(self):
        self._reject(self.review_1)
        self._auth_staff(self.super_admin)
        response = self.client.post(f"/api/reviews/moderation/{self.review_1.id}/re-review/")
        self.assertEqual(response.status_code, 200, response.content)
        self.review_1.refresh_from_db()
        self.assertEqual(self.review_1.status, Review.PENDING)
        self.assertIsNone(self.review_1.hidden_reason)
        self.assertIsNone(self.review_1.hidden_by)
        self.assertIsNone(self.review_1.reviewed_by)
        self.assertIsNone(self.review_1.reviewed_at)

    def test_re_reviewed_review_stays_hidden_from_the_public_until_approved(self):
        self._reject(self.review_1)
        self._auth_staff(self.super_admin)
        self.client.post(f"/api/reviews/moderation/{self.review_1.id}/re-review/")

        self.client.credentials()
        ids = [r["id"] for r in self.client.get(f"/api/reviews/listing/{self.listing.id}/").json()["results"]]
        self.assertNotIn(self.review_1.id, ids)

    def test_re_review_rejects_a_non_rejected_review(self):
        self._auth_staff(self.super_admin)
        response = self.client.post(f"/api/reviews/moderation/{self.pending_review.id}/re-review/")
        self.assertEqual(response.status_code, 400)


class ReviewModerationListTests(ReviewModerationTestsBase):
    def test_moderation_list_requires_permission(self):
        self._auth_staff(self.marketing)
        response = self.client.get("/api/reviews/moderation/")
        self.assertEqual(response.status_code, 403)

    def test_default_queue_is_pending(self):
        self._auth_staff(self.admin)
        response = self.client.get("/api/reviews/moderation/")
        self.assertEqual(response.status_code, 200, response.content)
        ids = [r["id"] for r in response.json()["results"]]
        self.assertEqual(ids, [self.pending_review.id])

    def test_approved_tab_lists_published_reviews(self):
        self._auth_staff(self.admin)
        response = self.client.get("/api/reviews/moderation/?status=approved")
        ids = [r["id"] for r in response.json()["results"]]
        self.assertCountEqual(ids, [self.review_1.id, self.review_2.id])
        self.assertNotIn(self.pending_review.id, ids)

    def test_rejected_tab_lists_hidden_reviews_with_reason_and_reviewer(self):
        self._auth_staff(self.admin)
        self.client.post(
            f"/api/reviews/moderation/{self.review_1.id}/hide/", {"reason": "Abusive"}, format="json",
        )
        response = self.client.get("/api/reviews/moderation/?status=rejected")
        body = response.json()["results"]
        self.assertEqual([r["id"] for r in body], [self.review_1.id])
        self.assertEqual(body[0]["hidden_reason"], "Abusive")
        self.assertEqual(body[0]["reviewed_by_name"], "Admin Person")
        self.assertIsNotNone(body[0]["reviewed_at"])

    def test_approved_list_surfaces_reviewer_name(self):
        self._auth_staff(self.admin)
        self.client.post(f"/api/reviews/moderation/{self.pending_review.id}/approve/")
        response = self.client.get("/api/reviews/moderation/?status=approved")
        row = next(r for r in response.json()["results"] if r["id"] == self.pending_review.id)
        self.assertEqual(row["reviewed_by_name"], "Admin Person")
        self.assertIsNotNone(row["reviewed_at"])

    def test_list_surfaces_the_target_name(self):
        self._auth_staff(self.admin)
        response = self.client.get("/api/reviews/moderation/")
        self.assertEqual(response.json()["results"][0]["target_name"], "Test Lodge")

    def test_unknown_status_falls_back_to_pending(self):
        self._auth_staff(self.admin)
        response = self.client.get("/api/reviews/moderation/?status=nonsense")
        ids = [r["id"] for r in response.json()["results"]]
        self.assertEqual(ids, [self.pending_review.id])
