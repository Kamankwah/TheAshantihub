"""Sponsored ads are free until priced (marketplace Plan 2, Task 9).

While ``PROMOTION_PRICING_ENABLED`` is off a promotion costs 0 and writes no billing Transaction, the response
says ``free``, and the promotion still waits for staff approval. Turned on, the paid path is unchanged."""
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from accounts.models import BusinessOwner, Customer
from accounts.authentication import issue_token
from accounts.testing import make_staff, staff_token
from billing.models import Transaction
from listings.models import Category, Listing, Promotion, Zone


class PromotionFreeTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.owner = BusinessOwner.objects.create(full_name="Ama Trader", login_phone="+233207881122", password_hash="x")
        self.token = issue_token(self.owner, "business_owner")
        self.listing = Listing.objects.create(
            business_owner=self.owner, category=Category.objects.get(slug="hotels"), zone=Zone.objects.get(name="Manhyia"),
            name="Royal Lodge", description="Rooms.", contact_phone="+233207881122", price_amount="450.00", status=Listing.PUBLISHED,
        )

    def _owner(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.token}")

    def _promote(self, **extra):
        self._owner()
        return self.client.post(f"/api/listings/{self.listing.id}/promote/", {"kind": "featured", "days": 7, **extra}, format="json")

    @override_settings(PROMOTION_PRICING_ENABLED=False)
    def test_promotion_is_free_while_pricing_is_off(self):
        response = self._promote()
        self.assertEqual(response.status_code, 201, response.content)
        body = response.json()
        self.assertIs(body["free"], True)
        self.assertEqual(Promotion.objects.get(pk=body["id"]).amount_paid, 0)
        self.assertEqual(float(body["amount_paid"]), 0)
        self.assertEqual(Transaction.objects.count(), 0)

    @override_settings(PROMOTION_PRICING_ENABLED=True)
    def test_review_focus_pricing_on_keeps_the_paid_path(self):
        response = self._promote()
        self.assertEqual(response.status_code, 201, response.content)
        body = response.json()
        self.assertIs(body["free"], False)
        self.assertGreater(Promotion.objects.get(pk=body["id"]).amount_paid, 0)
        self.assertEqual(Transaction.objects.filter(business_owner=self.owner).count(), 1)

    @override_settings(PROMOTION_PRICING_ENABLED=False)
    def test_free_promotion_still_waits_for_staff_approval(self):
        body = self._promote().json()
        self.assertEqual(body["status"], "pending")
        promotion = Promotion.objects.get(pk=body["id"])
        self.assertFalse(promotion.is_currently_active)
        staff = make_staff("marketing", "akua@example.com")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(staff)}")
        self.assertEqual(self.client.post(f"/api/listings/promotions/{promotion.id}/approve/", {}, format="json").status_code, 200)
        promotion.refresh_from_db()
        self.assertEqual(promotion.status, Promotion.ACTIVE)
        self.assertEqual(promotion.amount_paid, 0)

    def test_pricing_flag_endpoint_reports_the_setting(self):
        self._owner()
        with override_settings(PROMOTION_PRICING_ENABLED=False):
            self.assertEqual(self.client.get("/api/listings/promotions/pricing/").json(), {"enabled": False})
        with override_settings(PROMOTION_PRICING_ENABLED=True):
            self.assertEqual(self.client.get("/api/listings/promotions/pricing/").json(), {"enabled": True})

    def test_pricing_flag_endpoint_is_for_owners_and_staff_only(self):
        self.client.credentials()
        self.assertIn(self.client.get("/api/listings/promotions/pricing/").status_code, (401, 403))
        customer = Customer.objects.create(full_name="Kofi", phone="+233207881199", password_hash="x")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(customer, 'customer')}")
        self.assertEqual(self.client.get("/api/listings/promotions/pricing/").status_code, 403)
        staff = make_staff("operations", "ops2@example.com")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(staff)}")
        self.assertEqual(self.client.get("/api/listings/promotions/pricing/").status_code, 200)
