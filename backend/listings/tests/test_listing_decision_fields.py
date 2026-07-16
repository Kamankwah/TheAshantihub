"""Product/service decision fields on Listing (comprehensive listing-creation
work): the Amazon/Fiverr-style fields a business owner fills in when creating
a listing, and the "a product listing must consciously answer warranty/expiry/
returns at creation time" enforcement in OwnerListingSerializer.validate().
"""

from datetime import timedelta

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, BusinessOwnerProfile
from billing.models import Subscription, SubscriptionPlan
from listings.models import Category, Listing, Zone


class ListingDecisionFieldsTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.owner = BusinessOwner.objects.create(
            full_name="Kofi Trader", login_phone="+233207445599", password_hash="x",
        )
        BusinessOwnerProfile.objects.create(
            business_owner=self.owner, ghana_card_number="GHA-444555666-7",
            gps_address="AK-039-5062", business_contact_phone="+233207445599",
            is_formal=False, default_payout_method="momo", payout_momo_network="MTN",
            payout_momo_number="+233207445599", payout_momo_name="Kofi Trader",
        )
        # seeded categories: shops is product-kind, hotels is service-kind
        self.shops = Category.objects.get(slug="shops")
        self.hotels = Category.objects.get(slug="hotels")
        self.manhyia = Zone.objects.get(name="Manhyia")

        # Active unlimited subscription so the subscription/cap checks (which
        # predate this work) don't interfere with what's under test here.
        plan = SubscriptionPlan.objects.get(tier="product_unlimited")
        now = timezone.now()
        Subscription.objects.create(
            business_owner=self.owner, plan=plan,
            current_period_start=now, current_period_end=now + timedelta(days=30),
        )
        self.client.credentials(
            HTTP_AUTHORIZATION=f"Bearer {issue_token(self.owner, 'business_owner')}"
        )

    def _product_payload(self, **overrides):
        payload = {
            "category": self.shops.id, "zone": self.manhyia.id,
            "name": "Kente Scarf", "description": "Hand-woven kente scarf.",
            "price_amount": "120.00", "price_unit": "per item",
            "has_warranty": False, "has_expiry": False,
            "return_policy": "Returns accepted within 7 days, unworn.",
        }
        payload.update(overrides)
        return payload

    # ── Create: product mandatory-field enforcement ─────────────────────────

    def test_product_create_requires_warranty_expiry_and_return_policy(self):
        response = self.client.post(
            "/api/listings/mine/",
            {
                "category": self.shops.id, "zone": self.manhyia.id,
                "name": "Kente Scarf", "description": "D.",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 400, response.content)
        body = response.json()
        self.assertIn("has_warranty", body)
        self.assertIn("has_expiry", body)
        self.assertIn("return_policy", body)

    def test_product_create_rejects_blank_return_policy(self):
        response = self.client.post(
            "/api/listings/mine/", self._product_payload(return_policy="   "), format="json",
        )
        self.assertEqual(response.status_code, 400, response.content)
        self.assertIn("return_policy", response.json())

    def test_warranty_details_required_only_when_has_warranty_true(self):
        # has_warranty=True without details → rejected
        response = self.client.post(
            "/api/listings/mine/", self._product_payload(has_warranty=True), format="json",
        )
        self.assertEqual(response.status_code, 400, response.content)
        self.assertIn("warranty_details", response.json())
        # has_warranty=False without details → fine
        response = self.client.post(
            "/api/listings/mine/", self._product_payload(has_warranty=False), format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)

    def test_expiry_date_required_only_when_has_expiry_true(self):
        response = self.client.post(
            "/api/listings/mine/", self._product_payload(has_expiry=True), format="json",
        )
        self.assertEqual(response.status_code, 400, response.content)
        self.assertIn("expiry_date", response.json())
        response = self.client.post(
            "/api/listings/mine/", self._product_payload(has_expiry=False), format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)

    def test_product_create_persists_all_decision_fields(self):
        response = self.client.post(
            "/api/listings/mine/",
            self._product_payload(
                has_warranty=True, warranty_details="12-month manufacturer warranty.",
                has_expiry=True, expiry_date="2027-06-30",
                brand="Bonwire Weavers", condition="new",
                dimensions="180cm x 30cm", weight="0.4 kg", stock_quantity=25,
                specs=[{"label": "Material", "value": "Silk & cotton"}],
            ),
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        listing = Listing.objects.get(id=response.json()["id"])
        self.assertTrue(listing.has_warranty)
        self.assertEqual(listing.warranty_details, "12-month manufacturer warranty.")
        self.assertTrue(listing.has_expiry)
        self.assertEqual(str(listing.expiry_date), "2027-06-30")
        self.assertEqual(listing.return_policy, "Returns accepted within 7 days, unworn.")
        self.assertEqual(listing.brand, "Bonwire Weavers")
        self.assertEqual(listing.condition, "new")
        self.assertEqual(listing.dimensions, "180cm x 30cm")
        self.assertEqual(listing.weight, "0.4 kg")
        self.assertEqual(listing.stock_quantity, 25)
        self.assertEqual(listing.specs, [{"label": "Material", "value": "Silk & cotton"}])

    # ── Create: services are exempt from the product battery ───────────────

    def test_service_create_needs_no_product_fields_and_persists_service_fields(self):
        response = self.client.post(
            "/api/listings/mine/",
            {
                "category": self.hotels.id, "zone": self.manhyia.id,
                "name": "City Tour", "description": "Guided tour of Kumasi.",
                "service_duration": "3 hours",
                "whats_included": "Transport, guide, water.",
                "requirements": "Comfortable shoes.",
                "revisions": "1 free reschedule",
                "delivery_time": "Bookable within 48 hours",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        listing = Listing.objects.get(id=response.json()["id"])
        self.assertEqual(listing.whats_included, "Transport, guide, water.")
        self.assertEqual(listing.requirements, "Comfortable shoes.")
        self.assertEqual(listing.revisions, "1 free reschedule")
        self.assertEqual(listing.delivery_time, "Bookable within 48 hours")

    # ── Edit: pragmatic enforcement against pre-existing rows ───────────────

    def _existing_product_listing(self):
        return Listing.objects.create(
            business_owner=self.owner, category=self.shops, zone=self.manhyia,
            name="Old Product", description="Created before this feature.",
            contact_phone="+233207445599",
        )

    def test_editing_an_old_product_listing_without_touching_decision_fields_still_works(self):
        listing = self._existing_product_listing()
        response = self.client.patch(
            f"/api/listings/mine/{listing.id}/", {"name": "Renamed"}, format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        listing.refresh_from_db()
        self.assertEqual(listing.name, "Renamed")

    def test_edit_cannot_blank_return_policy_on_a_product(self):
        listing = self._existing_product_listing()
        response = self.client.patch(
            f"/api/listings/mine/{listing.id}/", {"return_policy": ""}, format="json",
        )
        self.assertEqual(response.status_code, 400, response.content)
        self.assertIn("return_policy", response.json())

    def test_edit_setting_has_warranty_true_requires_details(self):
        listing = self._existing_product_listing()
        response = self.client.patch(
            f"/api/listings/mine/{listing.id}/", {"has_warranty": True}, format="json",
        )
        self.assertEqual(response.status_code, 400, response.content)
        self.assertIn("warranty_details", response.json())
        response = self.client.patch(
            f"/api/listings/mine/{listing.id}/",
            {"has_warranty": True, "warranty_details": "6-month warranty."},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)

    def test_edit_can_fill_in_decision_fields_on_an_old_listing(self):
        listing = self._existing_product_listing()
        response = self.client.patch(
            f"/api/listings/mine/{listing.id}/",
            {
                "has_warranty": False, "has_expiry": False,
                "return_policy": "7-day returns.", "brand": "Ashanti Made",
                "condition": "used", "stock_quantity": 3,
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        listing.refresh_from_db()
        self.assertEqual(listing.return_policy, "7-day returns.")
        self.assertEqual(listing.brand, "Ashanti Made")
        self.assertEqual(listing.condition, "used")
        self.assertEqual(listing.stock_quantity, 3)

    # ── Public exposure ─────────────────────────────────────────────────────

    def test_public_detail_exposes_decision_fields(self):
        listing = Listing.objects.create(
            business_owner=self.owner, category=self.shops, zone=self.manhyia,
            name="Public Product", description="D.", contact_phone="+233207445599",
            status=Listing.PUBLISHED,
            has_warranty=True, warranty_details="12-month warranty.",
            return_policy="7-day returns.", brand="Bonwire Weavers", condition="new",
            dimensions="10cm", weight="1 kg", stock_quantity=5,
        )
        self.client.credentials()  # anonymous
        response = self.client.get(f"/api/listings/{listing.id}/")
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        self.assertTrue(body["has_warranty"])
        self.assertEqual(body["warranty_details"], "12-month warranty.")
        self.assertEqual(body["return_policy"], "7-day returns.")
        self.assertEqual(body["brand"], "Bonwire Weavers")
        self.assertEqual(body["condition"], "new")
        self.assertEqual(body["dimensions"], "10cm")
        self.assertEqual(body["weight"], "1 kg")
        self.assertEqual(body["stock_quantity"], 5)
        self.assertIn("whats_included", body)
        self.assertIn("delivery_time", body)
