"""Catalogue plan 6, Task 4: other sellers of the same product for customers (spec §10), and sold-out offers leaving
search (spec §1 row 15). Read-only. Review Focus 4 (no leaks, nothing made up)."""
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from catalogue.models import CatalogueProduct
from catalogue.tests.helpers import BARCODE, business, product, service
from listings.models import Listing


def sellers_url(listing, query=""):
    return f"/api/catalogue/listings/{listing.pk}/other-sellers/{query}"


class OtherSellersTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.entry = CatalogueProduct.objects.create(brand="Nestle", name="Milo 400g", barcode=BARCODE)
        self.mine = product(business("Adepa Ventures"), price="26.00", stock=4, catalogue_product=self.entry)
        self.cheap = product(business("Kumasi Mart"), price="24.00", stock=2, catalogue_product=self.entry)
        self.plenty = product(business("Bantama Stores"), price="25.00", stock=40, catalogue_product=self.entry)

    def body(self, listing=None, query=""):
        response = self.client.get(sellers_url(listing or self.mine, query))
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()

    def test_other_offers_cheapest_first_with_the_featured_offer(self):
        body = self.body()
        self.assertEqual(
            body["catalogue_product"], {"id": self.entry.pk, "brand": "Nestle", "name": "Milo 400g", "barcode": BARCODE},
        )
        self.assertEqual([o["listing_id"] for o in body["offers"]], [self.cheap.pk, self.plenty.pk])   # not the one asked
        self.assertEqual(body["featured_offer_id"], self.cheap.pk)
        self.assertEqual(
            (body["offers"][0]["price_amount"], body["offers"][0]["business_name"], body["offers"][0]["available_quantity"]),
            ("24.00", "Kumasi Mart", 2),
        )

    def test_the_featured_offer_may_be_the_listing_itself(self):
        self.assertEqual(self.body(self.cheap)["featured_offer_id"], self.cheap.pk)

    def test_ordering_by_availability(self):
        body = self.body(query="?ordering=availability")
        self.assertEqual([o["listing_id"] for o in body["offers"]], [self.plenty.pk, self.cheap.pk])
        self.assertEqual(self.body(query="?ordering=nonsense")["ordering"], "price")

    def test_review_focus_hidden_unpublished_sold_out_and_unpriced_offers_never_show(self):
        product(business("Suspended Shop", suspended=True), price="1.00", catalogue_product=self.entry)
        product(business("Draft Shop"), price="1.00", status=Listing.DRAFT, catalogue_product=self.entry)
        product(business("Empty Shop"), price="1.00", stock=0, catalogue_product=self.entry)
        product(business("No Price Shop"), price=None, catalogue_product=self.entry)
        uncounted = product(business("Uncounted Shop"), price="30.00", stock=None, catalogue_product=self.entry)
        body = self.body()
        self.assertEqual([o["listing_id"] for o in body["offers"]], [self.cheap.pk, self.plenty.pk, uncounted.pk])
        self.assertIsNone(body["offers"][-1]["available_quantity"])            # not counted: said, never guessed
        self.assertEqual(body["featured_offer_id"], self.cheap.pk)

    def test_review_focus_no_contact_details_in_any_offer(self):
        body = self.body()
        self.assertEqual(set(body["offers"][0]), {
            "listing_id", "name", "price_amount", "price_unit", "condition", "business_name", "verified", "zone",
            "available_quantity",
        })
        self.assertNotIn("+233", self.client.get(sellers_url(self.mine)).content.decode())

    def test_review_focus_an_ungrouped_listing_answers_an_honest_empty_list(self):
        empty = {"catalogue_product": None, "featured_offer_id": None, "ordering": "price", "offers": []}
        self.assertEqual(self.body(product(business("Solo Shop"))), empty)
        self.assertEqual(self.body(service(business("Salon"))), empty)

    def test_a_listing_customers_cannot_see_is_404(self):
        draft = product(business("Draft"), status=Listing.DRAFT, catalogue_product=self.entry)
        hidden = product(business("Hidden", suspended=True), catalogue_product=self.entry)
        for listing in (draft, hidden):
            self.assertEqual(self.client.get(sellers_url(listing)).status_code, 404)

    def test_query_count_does_not_grow_with_the_number_of_offers(self):
        self.client.get(sellers_url(self.mine))  # warm caches (content types etc.)
        with self.assertNumQueries(2):
            self.body()
        for i in range(5):
            product(business(f"Extra {i}", lat="6.69", lng="-1.62"), price="27.00", catalogue_product=self.entry)
        with self.assertNumQueries(2):
            self.body(query="?lat=6.6885&lng=-1.6244")


class FeaturedOfferTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.entry = CatalogueProduct.objects.create(brand="Nestle", name="Milo 400g", barcode=BARCODE)
        self.anchor = product(business("Adepa Ventures"), price="30.00", catalogue_product=self.entry)

    def featured(self, query=""):
        return self.client.get(sellers_url(self.anchor, query)).json()["featured_offer_id"]

    def test_an_unverified_business_is_never_featured_even_when_cheapest(self):
        product(business("New Shop", verified=False), price="10.00", catalogue_product=self.entry)
        verified = product(business("Old Shop"), price="20.00", catalogue_product=self.entry)
        self.assertEqual(self.featured(), verified.pk)

    def test_a_tie_goes_to_the_shop_nearest_the_customer(self):
        far = product(business("Far Shop", lat="6.700000", lng="-1.600000"), price="20.00", catalogue_product=self.entry)
        near = product(business("Near Shop", lat="6.690000", lng="-1.620000"), price="20.00", catalogue_product=self.entry)
        self.assertEqual(self.featured("?lat=6.6885&lng=-1.6244"), near.pk)
        self.assertEqual(self.featured(), far.pk)                            # no position: the oldest offer
        self.assertEqual(self.featured("?lat=abc&lng=-1.62"), far.pk)       # a position that is not one is ignored


@override_settings(SOLD_OUT_HIDDEN_ENABLED=True)
class SoldOutBrowseTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        owner = business()
        self.counted = product(owner, "Counted", stock=3)
        self.uncounted = product(owner, "Uncounted", stock=None)
        self.empty = product(owner, "Empty", stock=0)

    def test_search_and_related_lists_hide_sold_out_offers(self):
        ids = {row["id"] for row in self.client.get("/api/listings/").json()["results"]}
        self.assertEqual(ids, {self.counted.pk, self.uncounted.pk})
        related = {row["id"] for row in self.client.get(f"/api/listings/{self.counted.pk}/related/").json()}
        self.assertEqual(related, {self.uncounted.pk})

    def test_a_sold_out_offers_own_page_still_opens(self):
        response = self.client.get(f"/api/listings/{self.empty.pk}/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["stock_quantity"], 0)

    @override_settings(SOLD_OUT_HIDDEN_ENABLED=False)
    def test_with_the_switch_off_search_is_as_before(self):
        ids = {row["id"] for row in self.client.get("/api/listings/").json()["results"]}
        self.assertEqual(ids, {self.counted.pk, self.uncounted.pk, self.empty.pk})

    def test_a_service_at_zero_is_never_hidden(self):
        salon = service(business("Salon"))
        Listing.objects.filter(pk=salon.pk).update(stock_quantity=0)
        self.assertIn(salon.pk, {row["id"] for row in self.client.get("/api/listings/").json()["results"]})
