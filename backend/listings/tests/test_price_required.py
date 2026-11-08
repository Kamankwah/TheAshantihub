"""An item without a price is not in the marketplace: every public listing surface leaves it out, and it cannot be
submitted, approved or have its price blanked once it is live."""
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import Role, StaffUser
from listings.category_tree import build_tree
from listings.models import Category, Listing, Zone

from .test_golive_gate import make_owner


class PriceRequiredTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.owner = make_owner("+233241460001")
        self.zone = Zone.objects.get(name="Manhyia")
        self.service = Category.objects.get(slug="hotels")  # a stay
        self.product = Category.objects.get(slug="books")

    def listing(self, category, price, status=Listing.PUBLISHED, name="Thing"):
        return Listing.objects.create(
            business_owner=self.owner, category=category, zone=self.zone, name=name, description="D.",
            contact_phone="+233207553999", price_amount=price, status=status,
        )

    def ids(self, url):
        body = self.client.get(url).json()
        return {row["id"] for row in (body["results"] if isinstance(body, dict) and "results" in body else body)}

    def test_public_list_leaves_out_unpriced_products_and_services(self):
        priced = self.listing(self.product, "10.00", name="Priced")
        blank = self.listing(self.product, None, name="Blank")
        zero = self.listing(self.product, "0.00", name="Zero")
        service = self.listing(self.service, None, name="Unpriced stay")
        ids = self.ids("/api/listings/")
        self.assertIn(priced.pk, ids)
        for hidden in (blank, zero, service):
            self.assertNotIn(hidden.pk, ids)

    def test_public_detail_is_a_404_without_a_price(self):
        self.assertEqual(self.client.get(f"/api/listings/{self.listing(self.service, None).pk}/").status_code, 404)
        self.assertEqual(self.client.get(f"/api/listings/{self.listing(self.service, '80.00').pk}/").status_code, 200)

    def test_search_leaves_out_unpriced(self):
        self.listing(self.service, None, name="Zebra suite")
        self.listing(self.service, "90.00", name="Zebra villa")
        body = self.client.get("/api/storefront/search/?q=zebra").json()
        names = [row.get("name") or row.get("title") for rows in body.values() if isinstance(rows, list) for row in rows]
        self.assertIn("Zebra villa", names)
        self.assertNotIn("Zebra suite", names)

    def test_a_category_holding_only_unpriced_items_is_not_in_the_tree(self):
        self.listing(self.service, None)
        slugs = {node["slug"] for node in build_tree()}
        self.assertNotIn("hotels", slugs)
        self.listing(self.service, "50.00")
        self.assertIn("hotels", {node["slug"] for node in build_tree()})

    def test_submit_refuses_a_listing_with_no_price(self):
        draft = self.listing(self.service, None, status=Listing.DRAFT)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.owner, 'business_owner')}")
        response = self.client.post(f"/api/listings/mine/{draft.pk}/submit/")
        self.assertEqual(response.status_code, 400, response.content)
        self.assertEqual(response.json()["code"], "price_required")
        draft.refresh_from_db()
        self.assertEqual(draft.status, Listing.DRAFT)
        draft.price_amount = "40.00"
        draft.save()
        self.assertEqual(self.client.post(f"/api/listings/mine/{draft.pk}/submit/").status_code, 200)

    def test_staff_cannot_approve_an_unpriced_listing(self):
        staff = StaffUser.objects.create(
            full_name="Ops", email="ops-price@example.com", password_hash="x", role=Role.objects.get(name="operations"),
        )
        waiting = self.listing(self.service, None, status=Listing.PENDING_REVIEW)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(staff, 'staff')}")
        response = self.client.post(f"/api/listings/moderation/{waiting.pk}/approve/")
        self.assertEqual(response.status_code, 400, response.content)
        self.assertEqual(response.json()["code"], "price_required")

    def test_a_live_listing_cannot_have_its_price_blanked(self):
        live = self.listing(self.product, "20.00")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.owner, 'business_owner')}")
        for bad in (None, "0"):
            response = self.client.patch(f"/api/listings/mine/{live.pk}/manage/", {"price_amount": bad}, format="json")
            self.assertEqual(response.status_code, 400, response.content)
            self.assertIn("price_amount", response.json())
        live.refresh_from_db()
        self.assertEqual(str(live.price_amount), "20.00")
