from django.test import TestCase
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, BusinessOwnerProfile, Customer, Role, StaffUser
from credit.models import CreditScore
from credit.scoring import LOAN_ELIGIBLE_THRESHOLD, compute_naive_credit_score, grade_for_score
from listings.models import Category, Listing, Zone


class CreditScoringLogicTests(TestCase):
    """Unit tests for the naive placeholder formula itself (credit/scoring.py)."""

    def setUp(self):
        self.hotels = Category.objects.get(slug="hotels")
        self.manhyia = Zone.objects.get(name="Manhyia")

    def test_unverified_new_owner_with_no_listings_scores_minimum(self):
        owner = BusinessOwner.objects.create(
            full_name="New Owner", login_phone="+233207443001", password_hash="x",
        )
        score, factors = compute_naive_credit_score(owner)
        self.assertEqual(score, 300)
        self.assertFalse(factors["kyc_verified"]["value"])
        self.assertEqual(factors["listings_published"]["value"], 0)

    def test_verified_owner_with_published_listings_scores_higher(self):
        verified_owner = BusinessOwner.objects.create(
            full_name="Verified Owner", login_phone="+233207443002", password_hash="x",
            kyc_status=BusinessOwner.VERIFIED,
        )
        BusinessOwnerProfile.objects.create(
            business_owner=verified_owner, ghana_card_number="GHA-111222333-1",
            gps_address="AK-039-5060", business_contact_phone="+233207443002",
            default_payout_method="momo", payout_momo_network="MTN",
            payout_momo_number="+233207443002", payout_momo_name="Verified Owner",
            payout_verification_status="verified",
        )
        for i in range(3):
            Listing.objects.create(
                business_owner=verified_owner, category=self.hotels, zone=self.manhyia,
                name=f"Listing {i}", description="D.", contact_phone="+233207443002",
                status=Listing.PUBLISHED,
            )

        unverified_owner = BusinessOwner.objects.create(
            full_name="Unverified Owner", login_phone="+233207443003", password_hash="x",
        )

        verified_score, _ = compute_naive_credit_score(verified_owner)
        unverified_score, _ = compute_naive_credit_score(unverified_owner)
        self.assertGreater(verified_score, unverified_score)
        self.assertLessEqual(verified_score, 1000)

    def test_grade_bands_match_score_thresholds(self):
        self.assertEqual(grade_for_score(900)[0], "A+")
        self.assertEqual(grade_for_score(820)[0], "A")
        self.assertEqual(grade_for_score(760)[0], "A-")
        self.assertEqual(grade_for_score(710)[0], "B+")
        self.assertEqual(grade_for_score(660)[0], "B")
        self.assertEqual(grade_for_score(610)[0], "B-")
        self.assertEqual(grade_for_score(560)[0], "C+")
        self.assertEqual(grade_for_score(510)[0], "C")
        self.assertEqual(grade_for_score(400)[0], "D")


class CreditScoreMeViewTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.owner = BusinessOwner.objects.create(
            full_name="Kofi Trader", login_phone="+233207444001", password_hash="x",
        )
        self.other_owner = BusinessOwner.objects.create(
            full_name="Ama Seller", login_phone="+233207444002", password_hash="x",
        )

    def _auth(self, owner):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(owner, 'business_owner')}")

    def test_get_computes_and_persists_score(self):
        self._auth(self.owner)
        response = self.client.get("/api/credit/scores/me/")
        self.assertEqual(response.status_code, 200, response.content)
        data = response.json()
        self.assertIn("score", data)
        self.assertIn("grade", data)
        self.assertIn("factors", data)
        self.assertEqual(data["loan_eligible"], data["score"] >= LOAN_ELIGIBLE_THRESHOLD)
        self.assertTrue(CreditScore.objects.filter(business_owner=self.owner).exists())

    def test_owner_cannot_see_another_owners_score(self):
        # There is no "get another owner's score" endpoint at all — confirm the
        # /me/ endpoint always reflects request.user, never a query param.
        self._auth(self.owner)
        own_response = self.client.get("/api/credit/scores/me/")
        self._auth(self.other_owner)
        other_response = self.client.get("/api/credit/scores/me/")
        self.assertEqual(CreditScore.objects.count(), 2)
        self.assertNotEqual(
            CreditScore.objects.get(business_owner=self.owner).id,
            CreditScore.objects.get(business_owner=self.other_owner).id,
        )
        self.assertEqual(own_response.status_code, 200)
        self.assertEqual(other_response.status_code, 200)

    def test_customer_cannot_access_credit_score_endpoint(self):
        customer = Customer.objects.create(full_name="Ama", phone="+233200009876", password_hash="x")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(customer, 'customer')}")
        response = self.client.get("/api/credit/scores/me/")
        self.assertEqual(response.status_code, 403)

    def test_unauthenticated_cannot_access_credit_score_endpoint(self):
        response = self.client.get("/api/credit/scores/me/")
        self.assertEqual(response.status_code, 401)


class CreditScoreStaffListViewTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.owner = BusinessOwner.objects.create(
            full_name="Kofi Trader", login_phone="+233207445001", password_hash="x",
        )

    def test_marketing_staff_can_view_aggregate_scores(self):
        marketing = StaffUser.objects.create(
            full_name="Kojo Marketing", email="kojo-credit@example.com", password_hash="x",
            role=Role.objects.get(name="marketing"),
        )
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(marketing, 'staff')}")
        response = self.client.get("/api/credit/scores/")
        self.assertEqual(response.status_code, 200, response.content)
        names = [row["business_owner_name"] for row in response.json()]
        self.assertIn("Kofi Trader", names)

    def test_support_staff_cannot_view_aggregate_scores(self):
        support = StaffUser.objects.create(
            full_name="Ama Support", email="ama-credit@example.com", password_hash="x",
            role=Role.objects.get(name="support"),
        )
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(support, 'staff')}")
        response = self.client.get("/api/credit/scores/")
        self.assertEqual(response.status_code, 403)

    def test_business_owner_cannot_view_aggregate_scores(self):
        self.client.credentials(
            HTTP_AUTHORIZATION=f"Bearer {issue_token(self.owner, 'business_owner')}"
        )
        response = self.client.get("/api/credit/scores/")
        self.assertEqual(response.status_code, 403)
