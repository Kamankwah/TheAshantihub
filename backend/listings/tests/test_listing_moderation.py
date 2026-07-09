from django.test import TestCase
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, Role, StaffUser
from listings.models import Category, Listing, Zone


class ListingModerationTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = StaffUser.objects.create(
            full_name="Admin Person", email="admin-listing@example.com", password_hash="x",
            role=Role.objects.get(name="admin"),
        )
        self.admin_token = issue_token(self.admin, "staff")

        self.verified_owner = BusinessOwner.objects.create(
            full_name="Verified Trader", login_phone="+233207556677", password_hash="x",
            kyc_status=BusinessOwner.VERIFIED,
        )
        self.pending_owner = BusinessOwner.objects.create(
            full_name="Pending Trader", login_phone="+233207556688", password_hash="x",
            kyc_status=BusinessOwner.PENDING,
        )
        self.hotels = Category.objects.get(slug="hotels")
        self.manhyia = Zone.objects.get(name="Manhyia")

        self.listing_verified_owner = Listing.objects.create(
            business_owner=self.verified_owner, category=self.hotels, zone=self.manhyia,
            name="Verified Lodge", description="D.", contact_phone="+233207556677",
            status=Listing.PENDING_REVIEW,
        )
        self.listing_pending_owner = Listing.objects.create(
            business_owner=self.pending_owner, category=self.hotels, zone=self.manhyia,
            name="Unverified Lodge", description="D.", contact_phone="+233207556688",
            status=Listing.PENDING_REVIEW,
        )

    def test_pending_queue_lists_pending_review_listings(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.admin_token}")
        response = self.client.get("/api/listings/moderation/pending/")
        ids = [item["id"] for item in response.json()]
        self.assertIn(self.listing_verified_owner.id, ids)
        self.assertIn(self.listing_pending_owner.id, ids)

    def test_admin_can_approve_listing_of_verified_owner(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.admin_token}")
        response = self.client.post(f"/api/listings/moderation/{self.listing_verified_owner.id}/approve/")
        self.assertEqual(response.status_code, 200, response.content)
        self.listing_verified_owner.refresh_from_db()
        self.assertEqual(self.listing_verified_owner.status, Listing.PUBLISHED)

    def test_approve_blocked_if_owner_not_kyc_verified(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.admin_token}")
        response = self.client.post(f"/api/listings/moderation/{self.listing_pending_owner.id}/approve/")
        self.assertEqual(response.status_code, 400)
        self.listing_pending_owner.refresh_from_db()
        self.assertEqual(self.listing_pending_owner.status, Listing.PENDING_REVIEW)

    def test_admin_can_reject_with_reason(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.admin_token}")
        response = self.client.post(
            f"/api/listings/moderation/{self.listing_verified_owner.id}/reject/",
            {"reason": "Description too short"}, format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.listing_verified_owner.refresh_from_db()
        self.assertEqual(self.listing_verified_owner.status, Listing.REJECTED)
        self.assertEqual(self.listing_verified_owner.rejection_reason, "Description too short")

    def test_reject_requires_non_blank_reason(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.admin_token}")
        response = self.client.post(
            f"/api/listings/moderation/{self.listing_verified_owner.id}/reject/",
            {"reason": ""}, format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_accountant_cannot_moderate_listings(self):
        accountant = StaffUser.objects.create(
            full_name="Accountant Person", email="acc-listing@example.com", password_hash="x",
            role=Role.objects.get(name="accountant"),
        )
        token = issue_token(accountant, "staff")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        response = self.client.post(f"/api/listings/moderation/{self.listing_verified_owner.id}/approve/")
        self.assertEqual(response.status_code, 403)
