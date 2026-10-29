"""The public listing detail's extra contract (Marketplace Plan 4, Task 3b): category ancestors, variant axes,
per-variant availability and discount percent."""
from datetime import timedelta

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import BusinessOwner
from listings import variants as v
from listings.models import Category, Listing, ListingPriceHistory, ListingVariant, Zone


class DetailContractBase(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.owner = BusinessOwner.objects.create(full_name="Det Owner", login_phone="+233207661001", password_hash="x")
        self.zone = Zone.objects.get(name="Manhyia")
        self.cat = Category.objects.create(slug="zz-det", label="ZZ Det", icon="x", color="#000", kind=Category.PRODUCT)
        self.listing = self.make("Kente")

    def make(self, name, category=None):
        return Listing.objects.create(
            business_owner=self.owner, category=category or self.cat, zone=self.zone, name=name, description="D.",
            contact_phone="+233207661999", price_amount="100.00", status=Listing.PUBLISHED,
        )

    def detail(self, listing=None):
        response = self.client.get(f"/api/listings/{(listing or self.listing).pk}/")
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()

    def variant(self, listing=None, **kw):
        listing = listing or self.listing
        row = ListingVariant.objects.create(listing=listing, price_amount=kw.pop("price", "50.00"), **kw)
        v.sync_listing(listing)
        return row


class AncestorTests(DetailContractBase):
    def test_ancestors_root_first_and_empty_for_top_level(self):
        self.assertEqual(self.detail()["category"]["ancestors"], [])
        mid = Category.objects.create(slug="zz-det-mid", label="Mid", icon="x", color="#000", kind=Category.PRODUCT, parent=self.cat)
        leaf = Category.objects.create(slug="zz-det-leaf", label="Leaf", icon="x", color="#000", kind=Category.PRODUCT, parent=mid)
        body = self.detail(self.make("Deep", category=leaf))
        self.assertEqual(body["category"]["ancestors"], [
            {"id": self.cat.pk, "slug": "zz-det", "label": "ZZ Det"},
            {"id": mid.pk, "slug": "zz-det-mid", "label": "Mid"},
        ])
        self.assertEqual(body["category"]["id"], leaf.pk)

    def test_a_parent_cycle_does_not_hang(self):
        a = Category.objects.create(slug="zz-cyc-a", label="A", icon="x", color="#000", kind=Category.PRODUCT)
        b = Category.objects.create(slug="zz-cyc-b", label="B", icon="x", color="#000", kind=Category.PRODUCT, parent=a)
        Category.objects.filter(pk=a.pk).update(parent=b)
        body = self.detail(self.make("Cyc", category=a))
        self.assertLessEqual(len(body["category"]["ancestors"]), 10)

    def test_other_category_endpoints_unchanged(self):
        body = self.client.get("/api/listings/categories/")
        self.assertEqual(body.status_code, 200)
        rows = body.json()
        rows = rows if isinstance(rows, list) else rows["results"]
        self.assertTrue(rows)
        self.assertTrue(all("ancestors" not in row for row in rows))
        listed = self.client.get("/api/listings/").json()
        listed = listed["results"] if isinstance(listed, dict) else listed
        self.assertTrue(all("ancestors" not in row["category"] for row in listed))
        self.assertTrue(all("variant_axes" not in row and "discount_percent" not in row for row in listed))


class VariantContractTests(DetailContractBase):
    def test_variant_axes_derived_in_position_order(self):
        # Created out of order on purpose: position decides, and an axis is ordered by where it first appears.
        self.variant(label="Blue / M", attributes={"Size": "M", "Colour": "Blue"}, stock_quantity=1, position=2)
        self.variant(label="Small", attributes={"Size": "S"}, stock_quantity=1, position=0)
        self.variant(label="Red / S", attributes={"Colour": "Red", "Size": "S"}, stock_quantity=1, position=1)
        self.assertEqual(self.detail()["variant_axes"], [
            {"name": "Size", "values": ["S", "M"]},
            {"name": "Colour", "values": ["Red", "Blue"]},
        ])

    def test_listing_without_variants_has_empty_axes(self):
        body = self.detail()
        self.assertEqual(body["variant_axes"], [])
        self.assertEqual(body["variants"], [])

    def test_inactive_variants_are_left_out_of_axes(self):
        self.variant(label="Red", attributes={"Colour": "Red"}, stock_quantity=1, position=0)
        self.variant(label="Gone", attributes={"Colour": "Gone"}, stock_quantity=1, position=1, is_active=False)
        self.assertEqual(self.detail()["variant_axes"], [{"name": "Colour", "values": ["Red"]}])

    def test_variant_available_flag_for_counted_untracked_and_zero_stock(self):
        self.variant(label="Counted", stock_quantity=3, position=0)
        self.variant(label="Untracked", stock_quantity=None, position=1)
        self.variant(label="Zero", stock_quantity=0, position=2)
        rows = {r["label"]: r for r in self.detail()["variants"]}
        self.assertTrue(rows["Counted"]["available"])
        self.assertTrue(rows["Untracked"]["available"])
        self.assertFalse(rows["Zero"]["available"])
        self.assertNotIn("image", rows["Zero"])


class DiscountPercentTests(DetailContractBase):
    def test_discount_percent_only_with_a_was_price(self):
        small = self.variant(label="Small", price="50.00", stock_quantity=5, position=0)
        self.variant(label="Large", price="80.00", stock_quantity=5, position=1)
        now = timezone.now()
        ListingVariant.objects.filter(pk=small.pk).update(sale_price="40.00", sale_started_at=now)
        ListingPriceHistory.objects.filter(variant=small).update(started_at=now - timedelta(days=10))
        rows = {r["label"]: r for r in self.detail()["variants"]}
        self.assertEqual(rows["Small"]["was_price"], "50.00")
        self.assertEqual(rows["Small"]["discount_percent"], 20)
        self.assertIsNone(rows["Large"]["discount_percent"])

    def test_listing_discount_percent_needs_the_seven_day_was_price(self):
        now = timezone.now()
        Listing.objects.filter(pk=self.listing.pk).update(sale_price="75.00", sale_started_at=now)
        body = self.detail()
        self.assertEqual(body["sale_price"], "75.00")
        self.assertIsNone(body["was_price"])  # held less than 7 days
        self.assertIsNone(body["discount_percent"])
        ListingPriceHistory.objects.filter(listing=self.listing, variant__isnull=True).update(started_at=now - timedelta(days=10))
        body = self.detail()
        self.assertEqual(body["was_price"], "100.00")
        self.assertEqual(body["discount_percent"], 25)
