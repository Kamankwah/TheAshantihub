"""Catalogue plan 6, Task 5: a business looks up a product other businesses sell. Read-only: no contact details and no
ordering between businesses."""
from django.core.cache import cache
from django.test import TestCase
from rest_framework.test import APIClient

from catalogue.models import CatalogueProduct
from catalogue.tests.helpers import BARCODE, as_account, as_staff, business, buyer, product, service


class SearchTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        as_account(self.client, business("Adepa Ventures"), "business_owner")
        self.milo = CatalogueProduct.objects.create(brand="Nestlé", name="Milo 400g", barcode=BARCODE)
        self.bournvita = CatalogueProduct.objects.create(brand="Cadbury", name="Bournvita 500g")
        product(business("Kumasi Mart"), price="24.00", catalogue_product=self.milo)
        product(business("Bantama Stores"), price="25.00", catalogue_product=self.milo)
        product(business("Empty Shop"), price="1.00", stock=0, catalogue_product=self.milo)
        product(business("Suspended Shop", suspended=True), price="2.00", catalogue_product=self.milo)

    def search(self, query):
        return self.client.get(f"/api/catalogue/products/{query}")

    def test_by_barcode_in_any_spelling(self):
        response = self.search("?barcode=4006-3813-3393-1")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["results"], [{
            "id": self.milo.pk, "brand": "Nestlé", "name": "Milo 400g", "barcode": BARCODE,
            "offer_count": 2, "lowest_price": "24.00",
        }])

    def test_by_every_word_in_any_case_or_accent(self):
        self.assertEqual([row["id"] for row in self.search("?q=NESTLE milo").json()["results"]], [self.milo.pk])
        self.assertEqual(self.search("?q=milo bournvita").json()["results"], [])

    def test_review_focus_a_product_nobody_sells_now_has_no_price(self):
        row = self.search("?q=bournvita").json()["results"][0]
        self.assertEqual((row["id"], row["offer_count"], row["lowest_price"]), (self.bournvita.pk, 0, None))

    def test_a_query_or_a_valid_barcode_is_needed(self):
        for query, code in (("", "query_required"), ("?q=m", "query_required"), ("?q=a%20b", "query_required"), ("?barcode=123", "invalid_barcode")):
            response = self.search(query)
            self.assertEqual((response.status_code, response.json()["code"]), (400, code), query)

    def test_junk_input_has_a_pinned_status_never_a_500(self):
        expected = {
            "?barcode=%00%00": 400, "?barcode=abc": 400, "?barcode=" + "9" * 400: 400, "?q=%00%00": 400,
            "?q=" + "a" * 5000: 200, "?q=%25%5F": 400, "?q=a%20b%20c%20d%20e%20f%20g%20h%20i%20j%20k%20l": 400,
            "?q=a%20b": 400, "?q=ab": 200,
        }
        for query, status in expected.items():
            self.assertEqual(self.search(query).status_code, status, query)
        self.assertEqual(self.search("?barcode=abc").json()["code"], "invalid_barcode")
        self.assertEqual(self.search("?q=m").json()["code"], "query_required")

    def test_no_match_is_an_honest_empty_list(self):
        response = self.search("?q=zzzzz")
        self.assertEqual((response.status_code, response.json()), (200, {"results": [], "truncated": False}))

    def test_a_service_listing_is_not_an_offer(self):
        listing = service(business("Salon"))
        listing.catalogue_product = self.bournvita
        listing.save()
        self.assertEqual(self.search("?q=bournvita").json()["results"][0]["offer_count"], 0)

    def test_the_result_list_is_capped(self):
        for n in range(30):
            CatalogueProduct.objects.create(brand="Bulk", name=f"Item {n}")
        self.assertEqual(len(self.search("?q=bulk").json()["results"]), 20)

    def test_a_capped_list_says_it_was_cut(self):
        for n in range(20):
            CatalogueProduct.objects.create(brand="Bulk", name=f"Item {n}")
        self.assertFalse(self.search("?q=bulk").json()["truncated"])                 # exactly the cap: nothing cut
        CatalogueProduct.objects.create(brand="Bulk", name="Item 21")
        body = self.search("?q=bulk").json()
        self.assertEqual((len(body["results"]), body["truncated"]), (20, True))

    def test_query_count_does_not_grow_with_results(self):
        few = self.queries("?q=bulk")                                              # no match yet
        for n in range(15):
            CatalogueProduct.objects.create(brand="Bulk", name=f"Item {n}")
        for p in CatalogueProduct.objects.filter(brand="Bulk")[:5]:
            product(business(f"Seller {p.pk}"), catalogue_product=p)
        self.assertEqual(self.queries("?q=bulk"), few)

    def queries(self, query):
        from django.db import connection
        from django.test.utils import CaptureQueriesContext
        with CaptureQueriesContext(connection) as ctx:
            self.assertEqual(self.search(query).status_code, 200)
        return len(ctx)

    def test_only_business_owners(self):
        as_account(self.client, buyer(), "customer")
        self.assertEqual(self.search("?q=milo").status_code, 403)

    def test_staff_and_anonymous_are_refused(self):
        as_staff(self.client, "support", "s@example.com")
        self.assertEqual(self.search("?q=milo").status_code, 403)
        self.client.credentials()
        self.assertIn(self.search("?q=milo").status_code, (401, 403))

    def test_a_suspended_owner_is_refused(self):
        as_account(self.client, business("Gone", suspended=True), "business_owner")
        response = self.search("?q=milo")
        self.assertEqual((response.status_code, response.json()["code"]), (403, "account_suspended"))

    def test_lookups_are_throttled(self):
        statuses = {self.search("?q=milo").status_code for _ in range(130)}
        self.assertIn(429, statuses)


class SourcingOffersTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.owner = business("Adepa Ventures")
        as_account(self.client, self.owner, "business_owner")
        self.milo = CatalogueProduct.objects.create(brand="Nestle", name="Milo 400g", barcode=BARCODE)
        self.mine = product(self.owner, price="26.00", catalogue_product=self.milo)
        self.dearer = product(business("Bantama Stores"), price="27.00", catalogue_product=self.milo)
        self.rival = product(business("Kumasi Mart"), price="24.00", catalogue_product=self.milo)

    def test_other_businesses_offers_cheapest_first_never_mine_no_contact(self):
        response = self.client.get(f"/api/catalogue/products/{self.milo.pk}/offers/")
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        self.assertEqual([offer["listing_id"] for offer in body["offers"]], [self.rival.pk, self.dearer.pk])
        self.assertEqual(body["your_listings"], [self.mine.pk])
        self.assertEqual(body["catalogue_product"]["id"], self.milo.pk)
        self.assertNotIn("+233", response.content.decode())

    def test_read_only_and_an_unknown_product_is_404(self):
        self.assertEqual(self.client.post(f"/api/catalogue/products/{self.milo.pk}/offers/").status_code, 405)
        self.assertEqual(self.client.get("/api/catalogue/products/999999/offers/").status_code, 404)

    def test_owner_only_and_suspended_refused(self):
        url = f"/api/catalogue/products/{self.milo.pk}/offers/"
        as_account(self.client, buyer(), "customer")
        self.assertEqual(self.client.get(url).status_code, 403)
        as_staff(self.client, "support", "s2@example.com")
        self.assertEqual(self.client.get(url).status_code, 403)
        as_account(self.client, business("Gone", suspended=True), "business_owner")
        self.assertEqual(self.client.get(url).json()["code"], "account_suspended")

    def test_nobody_else_sells_it_is_an_empty_list(self):
        lonely = CatalogueProduct.objects.create(brand="X", name="Lonely thing")
        body = self.client.get(f"/api/catalogue/products/{lonely.pk}/offers/").json()
        self.assertEqual((body["offers"], body["your_listings"]), ([], []))

    def test_no_contact_or_owner_fields_in_a_row(self):
        row = self.client.get(f"/api/catalogue/products/{self.milo.pk}/offers/").json()["offers"][0]
        self.assertFalse({"contact_phone", "phone", "email", "address", "lat", "lng", "business_owner"} & set(row))

    def test_my_own_many_listings_do_not_crowd_out_others(self):
        for _ in range(55):
            product(self.owner, price="1.00", catalogue_product=self.milo)
        body = self.client.get(f"/api/catalogue/products/{self.milo.pk}/offers/").json()
        self.assertEqual(len(body["offers"]), 2)

    def test_a_capped_offer_list_says_it_was_cut(self):
        url = f"/api/catalogue/products/{self.milo.pk}/offers/"
        self.assertFalse(self.client.get(url).json()["truncated"])
        for n in range(50):
            product(business(f"Many {n}"), price="30.00", catalogue_product=self.milo)
        body = self.client.get(url).json()
        self.assertEqual((len(body["offers"]), body["truncated"]), (50, True))

    def test_query_count_is_flat(self):
        url = f"/api/catalogue/products/{self.milo.pk}/offers/"
        from django.db import connection
        from django.test.utils import CaptureQueriesContext
        with CaptureQueriesContext(connection) as small:
            self.client.get(url)
        for n in range(8):
            product(business(f"Shop {n}"), price="30.00", catalogue_product=self.milo)
        with CaptureQueriesContext(connection) as big:
            self.client.get(url)
        self.assertEqual(len(small), len(big))
