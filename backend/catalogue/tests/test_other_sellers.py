"""Catalogue plan 6, Task 4: other sellers of the same product for customers (spec §10), and sold-out offers leaving
search (spec §1 row 15). Read-only. Review Focus 4 (no leaks, nothing made up)."""
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from catalogue.models import CatalogueProduct
from datetime import timedelta
from decimal import Decimal

from django.utils import timezone

from billing.models import Subscription, SubscriptionPlan
from accounts.models import BusinessOwner
from catalogue.tests.helpers import BARCODE, buyer, business, product, service, stay
from listings.models import Category, Listing
from marketing.models_promos import FlashSale, FlashSaleListing
from orders.models import Order, OrderItem


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
            "available_quantity", "price_now", "price_basis",
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

    def test_query_count_stays_flat_with_offers_on_sale(self):
        # effective_price reads the listing's category when a sale price is set; live_offers must select it.
        for listing in (self.cheap, self.plenty):
            listing.sale_price = "20.00"
            listing.save(update_fields=["sale_price"])
        self.client.get(sellers_url(self.mine))
        with self.assertNumQueries(2):
            self.body()
        for i in range(5):
            extra = product(business(f"Sale {i}"), price="27.00", catalogue_product=self.entry)
            extra.sale_price = "21.00"
            extra.save(update_fields=["sale_price"])
        with self.assertNumQueries(2):
            self.body()


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

    def _at(self, listing, lat, lng):
        Listing.objects.filter(pk=listing.pk).update(lat=lat, lng=lng)

    def test_a_tie_goes_to_the_shop_nearest_the_customer(self):
        far = product(business("Far Shop"), price="20.00", catalogue_product=self.entry)
        near = product(business("Near Shop"), price="20.00", catalogue_product=self.entry)
        self._at(far, "6.700000", "-1.600000")
        self._at(near, "6.690000", "-1.620000")
        self.assertEqual(self.featured("?lat=6.6885&lng=-1.6244"), near.pk)
        self.assertEqual(self.featured(), far.pk)                            # no position: the oldest offer
        self.assertEqual(self.featured("?lat=abc&lng=-1.62"), far.pk)       # a position that is not one is ignored
        self.assertEqual(self.featured("?lat=0&lng=0"), far.pk)             # 0,0 is not a position

    def test_the_staff_only_business_pin_never_decides_a_tie(self):
        far = product(business("Far Shop", lat="6.700000", lng="-1.600000"), price="20.00", catalogue_product=self.entry)
        near = product(business("Near Shop", lat="6.690000", lng="-1.620000"), price="20.00", catalogue_product=self.entry)
        for query in ("?lat=6.6885&lng=-1.6244", "?lat=6.7&lng=-1.6", "?lat=6.0&lng=-1.0"):
            self.assertEqual(self.featured(query), far.pk, query)           # always the oldest: no listing point

    def test_unverified_businesses_are_left_out(self):
        new = product(business("New Shop", verified=False), price="10.00", catalogue_product=self.entry)
        body = self.client.get(sellers_url(self.anchor)).json()
        self.assertNotIn(new.pk, [o["listing_id"] for o in body["offers"]])
        self.assertNotEqual(body["featured_offer_id"], new.pk)


class OfferVisibilityTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.entry = CatalogueProduct.objects.create(brand="Nestle", name="Milo 400g", barcode=BARCODE)
        self.mine = product(business("Adepa Ventures"), price="26.00", catalogue_product=self.entry)

    def ids(self, query=""):
        response = self.client.get(sellers_url(self.mine, query))
        self.assertEqual(response.status_code, 200)
        return [o["listing_id"] for o in response.json()["offers"]]

    def test_a_blank_business_name_is_null_never_the_owners_own_name(self):
        owner = business("   ")
        owner.full_name = "Kwame Secretname"
        owner.save()
        other = product(owner, price="24.00", catalogue_product=self.entry)
        response = self.client.get(sellers_url(self.mine))
        self.assertNotIn("Kwame Secretname", response.content.decode())
        self.assertIsNone(response.json()["offers"][0]["business_name"])
        self.assertEqual(response.json()["offers"][0]["listing_id"], other.pk)

    def test_a_zero_or_negative_price_is_never_listed_or_featured(self):
        product(business("Free Shop"), price="0.00", catalogue_product=self.entry)
        product(business("Odd Shop"), price="-5.00", catalogue_product=self.entry)
        body = self.client.get(sellers_url(self.mine)).json()
        self.assertEqual(body["offers"], [])
        self.assertEqual(body["featured_offer_id"], self.mine.pk)

    def test_the_same_business_other_offers_are_not_other_sellers(self):
        sibling = product(self.mine.business_owner, "Milo 200g", price="1.00", catalogue_product=self.entry)
        rival = product(business("Rival"), price="27.00", catalogue_product=self.entry)
        body = self.client.get(sellers_url(self.mine)).json()
        self.assertEqual([o["listing_id"] for o in body["offers"]], [rival.pk])
        self.assertNotEqual(body["featured_offer_id"], sibling.pk)
        self.assertEqual(body["featured_offer_id"], self.mine.pk)            # 26 beats 27; the sibling is not a rival

    def test_a_listing_moved_to_a_service_or_stay_category_drops_out(self):
        moved = product(business("Mover"), price="20.00", catalogue_product=self.entry)
        Listing.objects.filter(pk=moved.pk).update(category=Category.objects.get(slug="lifestyle"))
        stayed = product(business("Stayer"), price="21.00", catalogue_product=self.entry)
        Listing.objects.filter(pk=stayed.pk).update(category=stay(business("X")).category)
        self.assertEqual(self.ids(), [])

    def test_moderation_states_never_show(self):
        for state in (Listing.PENDING_REVIEW, Listing.REJECTED):
            product(business(f"S {state}"), price="1.00", status=state, catalogue_product=self.entry)
        self.assertEqual(self.ids(), [])

    @override_settings(SUBSCRIPTION_PAUSE_ENABLED=True)
    def test_a_paused_subscription_business_is_excluded(self):
        paused = product(business("Paused"), price="1.00", catalogue_product=self.entry)
        now = timezone.now()
        Subscription.objects.create(
            business_owner=paused.business_owner, plan=SubscriptionPlan.objects.get(tier="product_basic"),
            current_period_start=now - timedelta(days=46), current_period_end=now - timedelta(days=16),
            overdue_since=now - timedelta(days=16), paused_at=now - timedelta(days=2),
        )
        self.assertEqual(self.ids(), [])

    def test_at_most_fifty_offers(self):
        for i in range(55):
            product(business(f"Bulk {i}"), price="30.00", catalogue_product=self.entry)
        self.assertEqual(len(self.ids()), 49)   # 50 read, the asked listing is one of them


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

    def test_food_at_zero_is_hidden_and_a_stay_at_zero_is_kept(self):
        eatery = product(business("Chop Bar"), "Waakye", stock=0, category="food")
        room = stay(business("Guesthouse"))
        Listing.objects.filter(pk=room.pk).update(stock_quantity=0)
        ids = {row["id"] for row in self.client.get("/api/listings/").json()["results"]}
        self.assertNotIn(eatery.pk, ids)
        self.assertIn(room.pk, ids)

    @override_settings(SOLD_OUT_HIDDEN_ENABLED=False)
    def test_with_the_switch_off_the_related_list_is_as_before(self):
        related = {row["id"] for row in self.client.get(f"/api/listings/{self.counted.pk}/related/").json()}
        self.assertEqual(related, {self.uncounted.pk, self.empty.pk})

    def test_a_service_at_zero_is_never_hidden(self):
        salon = service(business("Salon"))
        Listing.objects.filter(pk=salon.pk).update(stock_quantity=0)
        self.assertIn(salon.pk, {row["id"] for row in self.client.get("/api/listings/").json()["results"]})


def flash_sale(listing, sale_price, *, stock_cap=10, live=True):
    now = timezone.now()
    sale = FlashSale.objects.create(
        name="Sale", starts_at=now - timedelta(hours=1), ends_at=now + timedelta(hours=1), discount_pct=30,
        stock_cap=stock_cap, per_customer_limit=1, status=FlashSale.LIVE if live else FlashSale.SCHEDULED,
    )
    FlashSaleListing.objects.create(
        sale=sale, listing=listing, normal_price=listing.price_amount, sale_price=Decimal(sale_price), agreed_at=now,
    )
    return sale


@override_settings(MARKETING_PROMOS_ENABLED=True)
class PriceNowTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.entry = CatalogueProduct.objects.create(brand="Nestle", name="Milo 400g", barcode=BARCODE)
        self.mine = product(business("Adepa Ventures"), price="30.00", catalogue_product=self.entry)
        self.regular = product(business("Regular Shop"), price="8.00", catalogue_product=self.entry)
        self.sale = product(business("Sale Shop"), price="10.00", catalogue_product=self.entry)

    def body(self):
        response = self.client.get(sellers_url(self.mine))
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()

    def test_review_focus_a_live_flash_sale_price_orders_and_features_the_offer(self):
        flash_sale(self.sale, "7.00")
        body = self.body()
        self.assertEqual([o["listing_id"] for o in body["offers"]], [self.sale.pk, self.regular.pk])
        self.assertEqual((body["offers"][0]["price_now"], body["offers"][0]["price_basis"]), ("7.00", "flash_sale"))
        self.assertEqual((body["offers"][1]["price_now"], body["offers"][1]["price_basis"]), ("8.00", "regular"))
        self.assertEqual(body["featured_offer_id"], self.sale.pk)

    def test_a_flash_sale_sold_out_at_its_cap_does_not_lower_the_price(self):
        sale = flash_sale(self.sale, "7.00", stock_cap=2)
        order = Order.objects.create(customer=buyer(), status=Order.PAID, total_amount=Decimal("14.00"))
        OrderItem.objects.create(
            order=order, listing=self.sale, quantity=2, unit_price=Decimal("7.00"), line_total=Decimal("14.00"), flash_sale=sale,
        )
        body = self.body()
        self.assertEqual([o["listing_id"] for o in body["offers"]], [self.regular.pk, self.sale.pk])
        self.assertEqual(body["offers"][1]["price_now"], "10.00")
        self.assertEqual(body["featured_offer_id"], self.regular.pk)

    @override_settings(MARKETING_PROMOS_ENABLED=False)
    def test_with_promos_off_the_regular_price_orders(self):
        flash_sale(self.sale, "7.00")
        body = self.body()
        self.assertEqual([o["listing_id"] for o in body["offers"]], [self.regular.pk, self.sale.pk])
        self.assertEqual((body["offers"][1]["price_now"], body["offers"][1]["price_basis"]), ("10.00", "regular"))

    def test_a_live_discount_orders_the_offer(self):
        Listing.objects.filter(pk=self.sale.pk).update(sale_price=Decimal("6.00"))
        body = self.body()
        self.assertEqual([o["listing_id"] for o in body["offers"]], [self.sale.pk, self.regular.pk])
        self.assertEqual((body["offers"][0]["price_now"], body["offers"][0]["price_basis"]), ("6.00", "discount"))
        self.assertEqual(body["featured_offer_id"], self.sale.pk)

    def test_rows_keep_price_amount_and_add_price_now(self):
        row = self.body()["offers"][0]
        self.assertEqual((row["price_amount"], row["price_now"], row["price_basis"]), ("8.00", "8.00", "regular"))


class VerifiedOnlyTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.entry = CatalogueProduct.objects.create(brand="Nestle", name="Milo 400g", barcode=BARCODE)
        self.mine = product(business("Adepa Ventures"), price="30.00", catalogue_product=self.entry)
        self.shop = business("New Shop", verified=False)
        self.new = product(self.shop, price="5.00", catalogue_product=self.entry)

    def seen(self):
        sellers = self.client.get(sellers_url(self.mine)).json()
        found = self.client.get("/api/catalogue/products/?q=milo")
        sourced = self.client.get(f"/api/catalogue/products/{self.entry.pk}/offers/")
        return sellers, found, sourced

    def test_review_focus_unverified_sellers_are_left_out_everywhere(self):
        from catalogue.tests.helpers import as_account

        as_account(self.client, self.mine.business_owner, "business_owner")
        sellers, found, sourced = self.seen()
        self.assertEqual((sellers["offers"], sellers["featured_offer_id"]), ([], self.mine.pk))
        row = found.json()["results"][0] if "results" in found.json() else found.json()[0]
        self.assertEqual((row["offer_count"], row["lowest_price"]), (1, "30.00"))
        self.assertEqual(sourced.json()["offers"], [])
        self.shop.kyc_status = BusinessOwner.VERIFIED
        self.shop.save()
        sellers, found, sourced = self.seen()
        self.assertEqual([o["listing_id"] for o in sellers["offers"]], [self.new.pk])
        row = found.json()["results"][0] if "results" in found.json() else found.json()[0]
        self.assertEqual((row["offer_count"], row["lowest_price"]), (2, "5.00"))
        self.assertEqual([o["listing_id"] for o in sourced.json()["offers"]], [self.new.pk])

    def test_a_product_with_only_unverified_offers_shows_no_other_sellers(self):
        Listing.objects.filter(pk=self.mine.pk).update(business_owner=business("Other New", verified=False))
        body = self.client.get(sellers_url(self.new)).json()
        self.assertEqual((body["offers"], body["featured_offer_id"]), ([], None))
