from datetime import timedelta

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import BusinessOwner
from listings.models import Category, Listing, Promotion, Zone


class PromotionSearchRankingTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.owner = BusinessOwner.objects.create(
            full_name="Ama Trader", login_phone="+233207881122", password_hash="x",
        )
        self.hotels = Category.objects.get(slug="hotels")
        self.manhyia = Zone.objects.get(name="Manhyia")
        self.adum = Zone.objects.get(name="Adum")
        self.now = timezone.now()

        self.plain = Listing.objects.create(
            business_owner=self.owner, category=self.hotels, zone=self.manhyia,
            name="Plain Lodge", description="A regular hotel.",
            contact_phone="+233207881122", price_amount="100.00", status=Listing.PUBLISHED,
        )
        self.featured = Listing.objects.create(
            business_owner=self.owner, category=self.hotels, zone=self.adum,
            name="Golden Stool Inn", description="A boutique hotel.",
            contact_phone="+233207881122", price_amount="200.00", status=Listing.PUBLISHED,
        )
        self.boosted = Listing.objects.create(
            business_owner=self.owner, category=self.hotels, zone=self.manhyia,
            name="Kente House", description="A crafts shop.",
            contact_phone="+233207881122", price_amount="50.00", status=Listing.PUBLISHED,
        )
        self.expired_promo_listing = Listing.objects.create(
            business_owner=self.owner, category=self.hotels, zone=self.manhyia,
            name="Was Featured Lodge", description="Used to be featured.",
            contact_phone="+233207881122", price_amount="150.00", status=Listing.PUBLISHED,
        )

    def _promo(self, listing, kind, keywords="", starts_at=None, ends_at=None, status=Promotion.ACTIVE):
        return Promotion.objects.create(
            listing=listing, kind=kind,
            starts_at=starts_at or self.now - timedelta(hours=1),
            ends_at=ends_at or self.now + timedelta(days=7),
            keywords=keywords, amount_paid="35.00", status=status,
        )

    def test_featured_listing_ranks_first(self):
        self._promo(self.featured, Promotion.FEATURED)
        response = self.client.get("/api/listings/")
        ids = [item["id"] for item in response.json()["results"]]
        self.assertEqual(ids[0], self.featured.id)

    def test_featured_listing_marked_is_promoted_true(self):
        self._promo(self.featured, Promotion.FEATURED)
        response = self.client.get("/api/listings/")
        by_id = {item["id"]: item for item in response.json()["results"]}
        self.assertTrue(by_id[self.featured.id]["is_promoted"])
        self.assertFalse(by_id[self.plain.id]["is_promoted"])

    def test_expired_promotion_does_not_rank_or_flag_listing(self):
        self._promo(
            self.expired_promo_listing, Promotion.FEATURED,
            starts_at=self.now - timedelta(days=10), ends_at=self.now - timedelta(days=1),
        )
        # A live, currently-active promotion on a different listing, so a
        # true "ranked first" would have to come from that one, not the
        # expired one — isolates "expired promotions don't count" from
        # "newest listing happens to sort first anyway".
        self._promo(self.featured, Promotion.FEATURED)
        response = self.client.get("/api/listings/")
        ids = [item["id"] for item in response.json()["results"]]
        by_id = {item["id"]: item for item in response.json()["results"]}
        self.assertFalse(by_id[self.expired_promo_listing.id]["is_promoted"])
        self.assertEqual(ids[0], self.featured.id)

    def test_cancelled_promotion_does_not_rank_or_flag_listing(self):
        self._promo(self.expired_promo_listing, Promotion.FEATURED, status=Promotion.CANCELLED)
        response = self.client.get("/api/listings/")
        by_id = {item["id"]: item for item in response.json()["results"]}
        self.assertFalse(by_id[self.expired_promo_listing.id]["is_promoted"])

    def test_boost_ranks_first_only_when_keywords_match_search(self):
        self._promo(self.boosted, Promotion.BOOST, keywords="kente wedding gifts")
        response = self.client.get("/api/listings/?search=kente")
        ids = [item["id"] for item in response.json()["results"]]
        self.assertEqual(ids[0], self.boosted.id)

    def test_boost_does_not_rank_first_without_matching_search(self):
        self._promo(self.boosted, Promotion.BOOST, keywords="kente wedding gifts")
        response = self.client.get("/api/listings/")
        by_id = {item["id"]: item for item in response.json()["results"]}
        self.assertFalse(by_id[self.boosted.id]["is_promoted"])

    def test_boost_does_not_rank_first_for_non_matching_search(self):
        self._promo(self.boosted, Promotion.BOOST, keywords="kente wedding gifts")
        # "house" matches self.boosted's name ("Kente House", so it's still
        # present in the results) but not its keywords ("kente wedding
        # gifts" has no "house"), isolating "boost present but keywords
        # don't match this search" from "excluded by search entirely".
        response = self.client.get("/api/listings/?search=house")
        ids = [item["id"] for item in response.json()["results"]]
        self.assertIn(self.boosted.id, ids)
        by_id = {item["id"]: item for item in response.json()["results"]}
        self.assertFalse(by_id[self.boosted.id]["is_promoted"])

    def test_existing_ordering_param_still_respected_as_secondary_sort(self):
        self._promo(self.featured, Promotion.FEATURED)
        response = self.client.get("/api/listings/?ordering=price_amount")
        ids = [item["id"] for item in response.json()["results"]]
        # Featured (promoted) still first...
        self.assertEqual(ids[0], self.featured.id)
        # ...but the remaining, non-promoted listings are still sorted by
        # price_amount ascending as requested.
        rest = ids[1:]
        non_promoted_by_price = [
            self.boosted.id, self.plain.id, self.expired_promo_listing.id,
        ]
        self.assertEqual(rest, non_promoted_by_price)

    def test_existing_filters_and_pagination_unaffected(self):
        response = self.client.get("/api/listings/?zone=Adum")
        ids = [item["id"] for item in response.json()["results"]]
        self.assertEqual(ids, [self.featured.id])

        response = self.client.get("/api/listings/")
        body = response.json()
        self.assertIn("count", body)
        self.assertIn("results", body)
        self.assertEqual(body["count"], 4)
