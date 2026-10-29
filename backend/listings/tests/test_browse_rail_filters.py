from datetime import timedelta

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import BusinessOwner, Customer
from listings.models import Category, Listing, Zone
from reviews.models import Review


class BrowseRailListingFilterTests(TestCase):
    """GET /api/listings/?min_rating= and ?on_sale= (the browse rail's Customer reviews and Deals sections)."""

    def setUp(self):
        self.client = APIClient()
        self.owner = BusinessOwner.objects.create(
            full_name="Rail Owner", login_phone="+233207991001", password_hash="x",
            kyc_status=BusinessOwner.VERIFIED,
        )
        self.cat = Category.objects.create(slug="zz-rail", label="ZZ Rail", icon="x", color="#000", kind=Category.PRODUCT)
        self.zone = Zone.objects.get(name="Manhyia")
        self.reviewers = [
            Customer.objects.create(full_name=f"R{i}", phone=f"+23320099100{i}", password_hash="x") for i in range(3)
        ]
        self.four = self.listing("Four Stars")
        self.three = self.listing("Three Stars")
        self.unrated = self.listing("Unrated")
        self.pending = self.listing("Pending Only")
        self.rate(self.four, [5, 4, 3])  # exactly 4.0
        self.rate(self.three, [3, 3, 3])
        # A pending (unmoderated) 5 must not count: the default status is PENDING.
        Review.objects.create(target_type=Review.LISTING, listing=self.pending, author=self.reviewers[0], rating=5)

    def listing(self, name, **extra):
        fields = dict(business_owner=self.owner, category=self.cat, zone=self.zone, name=name, description="D.",
                      contact_phone="+233207991999", price_amount="100.00", status=Listing.PUBLISHED)
        fields.update(extra)
        return Listing.objects.create(**fields)

    def rate(self, listing, ratings):
        for author, rating in zip(self.reviewers, ratings):
            Review.objects.create(target_type=Review.LISTING, listing=listing, author=author, rating=rating,
                                  verified=True, status=Review.PUBLISHED)

    def names(self, query):
        response = self.client.get(f"/api/listings/?{query}")
        self.assertEqual(response.status_code, 200)
        return {r["name"] for r in response.json()["results"]}

    def test_min_rating_four_keeps_only_listings_averaging_four_or_more(self):
        self.assertEqual(self.names("min_rating=4"), {"Four Stars"})

    def test_min_rating_three_includes_both_rated_and_excludes_unrated_and_pending(self):
        self.assertEqual(self.names("min_rating=3"), {"Four Stars", "Three Stars"})

    def test_min_rating_accepts_a_decimal(self):
        self.assertEqual(self.names("min_rating=3.5"), {"Four Stars"})

    def test_min_rating_bad_or_out_of_range_is_ignored(self):
        everything = self.names("")
        for bad in ("abc", "0", "6", "-1", "nan", "inf", ""):
            self.assertEqual(self.names(f"min_rating={bad}"), everything, bad)

    def test_min_rating_keeps_pagination_count_and_ordering(self):
        body = self.client.get("/api/listings/?min_rating=3&ordering=created_at").json()
        self.assertEqual(body["count"], 2)
        self.assertEqual([r["name"] for r in body["results"]], ["Four Stars", "Three Stars"])
        self.assertIn("next", body)

    def test_on_sale_returns_only_live_discounts(self):
        self.listing("Cheap Now", sale_price="80.00")
        self.listing("Expired Sale", sale_price="80.00", sale_ends_at=timezone.now() - timedelta(days=1))
        self.listing("Sale Not Lower", sale_price="100.00")
        self.listing("Sale Ends Later", sale_price="90.00", sale_ends_at=timezone.now() + timedelta(days=1))
        self.assertEqual(self.names("on_sale=1"), {"Cheap Now", "Sale Ends Later"})
        self.assertEqual(self.names("on_sale=TRUE"), {"Cheap Now", "Sale Ends Later"})

    def test_on_sale_other_values_are_ignored(self):
        self.listing("Cheap Now", sale_price="80.00")
        everything = self.names("")
        for other in ("0", "false", "yes", ""):
            self.assertEqual(self.names(f"on_sale={other}"), everything, other)

    def test_on_sale_and_min_rating_combine(self):
        self.listing("Cheap Now", sale_price="80.00")
        self.four.sale_price = "70.00"
        self.four.save()
        self.assertEqual(self.names("on_sale=1&min_rating=4"), {"Four Stars"})
