"""Discounts (Plan M2 Task 8, ruling R6): a discount is a sale price on a listing or a variant plus an optional end date.
It goes live at once, expires at read time, and the "was" price needs 7 full days of the same regular price."""
import pathlib
from datetime import timedelta
from decimal import Decimal

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, Customer
from cart.models import CartItem
from listings import pricing
from listings.models import Category, Listing, ListingPriceHistory, ListingVariant, Zone
from storefront.testing import open_marketplace


class DiscountBase(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.zone = Zone.objects.get(name="Manhyia")
        self.owner = BusinessOwner.objects.create(full_name="Disc Owner", login_phone="+233207881001", password_hash="x")
        self.other = BusinessOwner.objects.create(full_name="Disc Other", login_phone="+233207881002", password_hash="x")
        self.cat = Category.objects.create(slug="zz-disc", label="ZZ Disc", icon="x", color="#000", kind=Category.PRODUCT)
        self.service = Category.objects.create(slug="zz-disc-svc", label="ZZ Svc", icon="x", color="#000", kind=Category.SERVICE)
        self.listing = self.make("Kente")
        self.auth(self.owner)

    def make(self, name, status=Listing.PUBLISHED, category=None, **extra):
        fields = dict(business_owner=self.owner, category=category or self.cat, zone=self.zone, name=name, description="D.",
                      contact_phone="+233207881999", price_amount="100.00", status=status)
        fields.update(extra)
        return Listing.objects.create(**fields)

    def auth(self, who, kind="business_owner"):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(who, kind)}")

    def url(self, listing=None, suffix=""):
        return f"/api/listings/mine/{(listing or self.listing).pk}/discounts/{suffix}"

    def start(self, body, listing=None):
        return self.client.post(self.url(listing), body, format="json")

    def age(self, listing=None, variant=None, days=10):
        rows = ListingPriceHistory.objects.filter(listing=listing or self.listing, variant=variant)
        rows.update(started_at=timezone.now() - timedelta(days=days))

    def variants(self, listing=None):
        listing = listing or self.listing
        a = ListingVariant.objects.create(listing=listing, label="Small", price_amount="50.00", stock_quantity=5)
        b = ListingVariant.objects.create(listing=listing, label="Large", price_amount="80.00", stock_quantity=5, position=1)
        from listings import variants as v
        v.sync_listing(listing)
        return a, b


class StartAndShowTests(DiscountBase):
    def test_discount_goes_live_at_once_and_shows_on_the_public_listing(self):
        response = self.start({"sale_price": "80.00"})
        self.assertEqual(response.status_code, 201, response.content)
        body = self.client.get(f"/api/listings/{self.listing.pk}/").json()
        self.assertEqual(body["sale_price"], "80.00")
        self.assertEqual(body["effective_price"], "80.00")
        self.assertIsNone(body["was_price"])  # held less than 7 days
        self.assertIsNone(body["sale_ends_at"])
        listed = self.client.get(self.url()).json()
        self.assertEqual(listed, [{
            "target": "listing", "variant": None, "label": None, "regular_price": "100.00", "sale_price": "80.00",
            "percent_off": 20, "ends_at": None,
        }])

    def test_review_focus_was_price_needs_seven_held_days(self):
        self.start({"sale_price": "80.00"})
        self.age(days=10)
        body = self.client.get(f"/api/listings/{self.listing.pk}/").json()
        self.assertEqual(body["was_price"], "100.00")
        self.age(days=6)
        self.assertIsNone(self.client.get(f"/api/listings/{self.listing.pk}/").json()["was_price"])

    def test_review_focus_was_price_absent_when_price_changed_inside_the_window(self):
        self.age(days=10)
        self.listing.price_amount = Decimal("120.00")
        self.listing.save()
        self.start({"sale_price": "90.00"})
        self.assertIsNone(pricing.was_price(Listing.objects.get(pk=self.listing.pk)))

    def test_was_price_absent_without_history_for_the_full_window(self):
        ListingPriceHistory.objects.filter(listing=self.listing).delete()  # a listing older than the history
        self.start({"sale_price": "80.00"})
        self.assertIsNone(pricing.was_price(Listing.objects.get(pk=self.listing.pk)))

    def test_percent_off_computes_the_sale_price_to_the_cent(self):
        listing = self.make("Odd", price_amount="33.33")
        response = self.start({"percent_off": "15"}, listing)
        self.assertEqual(response.status_code, 201, response.content)
        listing.refresh_from_db()
        self.assertEqual(listing.sale_price, Decimal("28.33"))  # 28.3305 rounds half up
        half = self.make("Half", price_amount="0.50")
        self.start({"percent_off": 10}, half)
        half.refresh_from_db()
        self.assertEqual(half.sale_price, Decimal("0.45"))
        tie = self.make("Tie", price_amount="10.50")
        self.start({"percent_off": "5"}, tie)
        tie.refresh_from_db()
        self.assertEqual(tie.sale_price, Decimal("9.98"))  # 9.975 rounds half up

    def test_sale_price_must_be_below_regular_and_within_ninety_percent(self):
        for body in ({"sale_price": "100.00"}, {"sale_price": "120"}, {"sale_price": "9.99"}, {"sale_price": "99.95"},
                     {"sale_price": "0"}, {"sale_price": "abc"}, {"percent_off": "0"}, {"percent_off": "0.5"},
                     {"percent_off": "91"}, {"percent_off": "x"}, {"percent_off": "20", "sale_price": "80"}, {}):
            response = self.start(body)
            self.assertEqual(response.status_code, 400, (body, response.content))
            self.assertIn("detail", response.json())
        self.assertEqual(self.start({"sale_price": "10.00"}).status_code, 201)  # exactly 90% off
        self.listing.refresh_from_db()
        self.assertEqual(self.listing.sale_price, Decimal("10.00"))

    def test_ends_at_must_be_in_the_future(self):
        past = (timezone.now() - timedelta(hours=1)).isoformat()
        response = self.start({"sale_price": "80", "ends_at": past})
        self.assertEqual(response.status_code, 400, response.content)
        self.assertEqual(self.start({"sale_price": "80", "ends_at": "not a date"}).status_code, 400)
        future = (timezone.now() + timedelta(days=2)).isoformat()
        self.assertEqual(self.start({"sale_price": "80", "ends_at": future}).status_code, 201)
        row = self.client.get(self.url()).json()[0]
        self.assertIsNotNone(row["ends_at"])
        self.assertIsNotNone(self.client.get(f"/api/listings/{self.listing.pk}/").json()["sale_ends_at"])

    def test_an_expired_discount_is_not_live_and_the_regular_price_applies(self):
        self.start({"sale_price": "80", "ends_at": (timezone.now() + timedelta(days=1)).isoformat()})
        Listing.objects.filter(pk=self.listing.pk).update(sale_ends_at=timezone.now() - timedelta(minutes=1))
        fresh = Listing.objects.get(pk=self.listing.pk)
        self.assertFalse(pricing.is_discounted(fresh))
        self.assertEqual(fresh.effective_price, Decimal("100.00"))
        body = self.client.get(f"/api/listings/{self.listing.pk}/").json()
        self.assertIsNone(body["sale_price"])
        self.assertIsNone(body["sale_ends_at"])
        self.assertEqual(body["effective_price"], "100.00")
        self.assertEqual(self.client.get(self.url()).json(), [])
        self.assertFalse(Listing.objects.filter(pricing.live_discount_q()).filter(pk=self.listing.pk).exists())
        # An expired sale does not block a new one.
        self.assertEqual(self.start({"sale_price": "70"}).status_code, 201)

    def test_one_live_discount_per_listing_and_per_variant(self):
        self.assertEqual(self.start({"sale_price": "80"}).status_code, 201)
        again = self.start({"percent_off": 10})
        self.assertEqual(again.status_code, 409)
        self.assertIn("detail", again.json())
        listing = self.make("Cake")
        a, b = self.variants(listing)
        self.assertEqual(self.start({"variant": a.pk, "percent_off": 10}, listing).status_code, 201)
        self.assertEqual(self.start({"variant": a.pk, "percent_off": 20}, listing).status_code, 409)
        self.assertEqual(self.start({"variant": b.pk, "percent_off": 20}, listing).status_code, 201)

    def test_a_variant_discount_prices_only_that_variant(self):
        listing = self.make("Cake")
        a, b = self.variants(listing)
        self.assertEqual(self.start({"sale_price": "40"}, listing).status_code, 400)  # discount each variant
        self.assertEqual(self.start({"variant": a.pk, "percent_off": 20}, listing).status_code, 201)
        a.refresh_from_db(), b.refresh_from_db()
        self.assertEqual(a.effective_price, Decimal("40.00"))
        self.assertEqual(b.effective_price, Decimal("80.00"))
        body = self.client.get(f"/api/listings/{listing.pk}/").json()
        rows = {row["label"]: row for row in body["variants"]}
        self.assertEqual(rows["Small"]["sale_price"], "40.00")
        self.assertEqual(rows["Small"]["effective_price"], "40.00")
        self.assertIsNone(rows["Small"]["was_price"])
        self.assertIsNone(rows["Small"]["sale_ends_at"])
        self.assertIsNone(rows["Large"]["sale_price"])
        self.assertEqual(rows["Large"]["effective_price"], "80.00")
        listed = self.client.get(self.url(listing)).json()
        self.assertEqual([(r["target"], r["variant"], r["label"], r["sale_price"]) for r in listed],
                         [("variant", a.pk, "Small", "40.00")])
        mine = self.client.get("/api/listings/mine/").json()
        mine = mine if isinstance(mine, list) else mine["results"]
        owner_rows = {row["label"]: row for item in mine if item["id"] == listing.pk for row in item["variants"]}
        self.assertEqual(owner_rows["Small"]["sale_price"], "40.00")
        # The variant's own 7-day rule.
        self.age(listing, variant=a, days=9)
        body = self.client.get(f"/api/listings/{listing.pk}/").json()
        self.assertEqual({r["label"]: r["was_price"] for r in body["variants"]}["Small"], "50.00")
        # The listing itself keeps no sale price.
        listing.refresh_from_db()
        self.assertIsNone(listing.sale_price)

    def test_cannot_discount_with_a_variant_that_is_not_on_the_listing(self):
        listing = self.make("Cake")
        a, _ = self.variants(listing)
        self.assertEqual(self.start({"variant": a.pk, "percent_off": 10}).status_code, 400)  # on another listing
        self.assertEqual(self.start({"variant": 999999, "percent_off": 10}, listing).status_code, 400)

    def test_goods_and_food_only(self):
        listing = self.make("Haircut", category=self.service)
        response = self.start({"sale_price": "80"}, listing)
        self.assertEqual(response.status_code, 400)
        self.assertIn("goods", response.json()["detail"])

    def test_cannot_discount_a_dropped_listing(self):
        for status in (Listing.DROPPED, Listing.DISCONTINUED, Listing.DRAFT, Listing.PENDING_REVIEW):
            listing = self.make(f"L {status}", status=status)
            self.assertEqual(self.start({"sale_price": "80"}, listing).status_code, 400, status)
            listing.refresh_from_db()
            self.assertIsNone(listing.sale_price)

    def test_another_owner_cannot_discount_my_listing(self):
        self.auth(self.other)
        self.assertEqual(self.start({"sale_price": "80"}).status_code, 404)
        self.assertEqual(self.client.get(self.url()).status_code, 404)
        self.assertEqual(self.client.post(self.url(suffix="end/"), {}, format="json").status_code, 404)
        self.listing.refresh_from_db()
        self.assertIsNone(self.listing.sale_price)

    def test_signed_out_and_customers_are_refused(self):
        self.client.credentials()
        self.assertIn(self.client.get(self.url()).status_code, (401, 403))
        customer = Customer.objects.create(full_name="B", phone="+233200881001", password_hash="x")
        self.auth(customer, "customer")
        self.assertEqual(self.start({"sale_price": "80"}).status_code, 403)


class EndTests(DiscountBase):
    def test_ending_clears_the_sale_and_the_end_date(self):
        self.start({"sale_price": "80", "ends_at": (timezone.now() + timedelta(days=1)).isoformat()})
        response = self.client.post(self.url(suffix="end/"), {}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        self.listing.refresh_from_db()
        self.assertIsNone(self.listing.sale_price)
        self.assertIsNone(self.listing.sale_ends_at)
        self.assertEqual(self.client.get(self.url()).json(), [])
        self.assertEqual(self.client.post(self.url(suffix="end/"), {}, format="json").status_code, 404)

    def test_ending_a_variant_discount_leaves_the_others(self):
        listing = self.make("Cake")
        a, b = self.variants(listing)
        self.start({"variant": a.pk, "percent_off": 10}, listing)
        self.start({"variant": b.pk, "percent_off": 10}, listing)
        self.assertEqual(self.client.post(self.url(listing, "end/"), {"variant": a.pk}, format="json").status_code, 200)
        a.refresh_from_db(), b.refresh_from_db()
        self.assertIsNone(a.sale_price)
        self.assertIsNotNone(b.sale_price)

    def test_ending_a_discount_stops_new_carts_but_not_existing_lines(self):
        open_marketplace()
        self.start({"sale_price": "80"})
        customer = Customer.objects.create(full_name="Buyer", phone="+233200881002", password_hash="x")
        self.auth(customer, "customer")
        post = lambda: self.client.post("/api/cart/items/", {"listing": self.listing.pk, "quantity": 1}, format="json")
        self.assertEqual(post().status_code, 201)
        self.assertEqual(CartItem.objects.get().unit_price_snapshot, Decimal("80.00"))
        self.auth(self.owner)
        self.client.post(self.url(suffix="end/"), {}, format="json")
        self.assertEqual(CartItem.objects.get().unit_price_snapshot, Decimal("80.00"))  # the existing line keeps its price
        other = self.make("Second")
        self.auth(customer, "customer")
        self.client.post("/api/cart/items/", {"listing": other.pk, "quantity": 1}, format="json")
        self.assertEqual(CartItem.objects.get(listing=other).unit_price_snapshot, Decimal("100.00"))

    def test_a_variant_discount_is_the_cart_price_of_that_variant(self):
        open_marketplace()
        listing = self.make("Cake")
        a, _ = self.variants(listing)
        self.start({"variant": a.pk, "percent_off": 50}, listing)
        customer = Customer.objects.create(full_name="Buyer", phone="+233200881003", password_hash="x")
        self.auth(customer, "customer")
        response = self.client.post("/api/cart/items/", {"listing": listing.pk, "variant": a.pk, "quantity": 1}, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(CartItem.objects.get().unit_price_snapshot, Decimal("25.00"))


class HistoryTests(DiscountBase):
    def test_regular_price_edit_writes_history_and_manage_sale_clears_the_end_date(self):
        self.listing.price_amount = Decimal("120.00")
        self.listing.save()
        self.assertEqual([r.price for r in self.listing.price_history.order_by("pk")], [Decimal("100.00"), Decimal("120.00")])
        self.start({"sale_price": "90", "ends_at": (timezone.now() + timedelta(days=1)).isoformat()})
        response = self.client.patch(f"/api/listings/mine/{self.listing.pk}/manage/", {"sale_price": "95"}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        self.listing.refresh_from_db()
        self.assertEqual(self.listing.sale_price, Decimal("95.00"))
        self.assertIsNone(self.listing.sale_ends_at)

    def test_variant_price_changes_write_variant_history_only(self):
        listing = self.make("Cake")
        a, _ = self.variants(listing)
        self.assertEqual(list(a.price_history.values_list("price", flat=True)), [Decimal("50.00")])
        self.client.patch(f"/api/listings/mine/{listing.pk}/variants/{a.pk}/live/", {"price_amount": "60"}, format="json")
        rows = list(a.price_history.order_by("pk"))
        self.assertEqual([r.price for r in rows], [Decimal("50.00"), Decimal("60.00")])
        self.assertIsNotNone(rows[0].ended_at)
        self.assertIsNone(rows[1].ended_at)
        # Listing-level history never holds a variant row.
        self.assertTrue(all(r.variant_id is None for r in listing.price_history.filter(variant__isnull=True)))
        self.assertEqual(listing.price_history.filter(variant__isnull=True, ended_at__isnull=True).count(), 1)
        self.assertEqual(pricing.was_price(Listing.objects.get(pk=listing.pk)), None)

    def test_a_variant_price_at_or_under_its_sale_ends_the_sale(self):
        listing = self.make("Cake")
        a, _ = self.variants(listing)
        self.start({"variant": a.pk, "sale_price": "40"}, listing)
        self.client.patch(f"/api/listings/mine/{listing.pk}/variants/{a.pk}/live/", {"price_amount": "40"}, format="json")
        a.refresh_from_db()
        self.assertIsNone(a.sale_price)
        self.assertIsNone(a.sale_ends_at)

    def test_price_history_is_append_only(self):
        listing = self.make("Cake")
        a, _ = self.variants(listing)
        self.listing.price_amount = Decimal("120.00")
        self.listing.save()
        first = list(ListingPriceHistory.objects.filter(listing=self.listing).order_by("pk").values("pk", "price", "started_at"))
        self.listing.price_amount = Decimal("130.00")
        self.listing.save()
        after = list(ListingPriceHistory.objects.filter(listing=self.listing).order_by("pk").values("pk", "price", "started_at"))
        self.assertEqual(after[:len(first)], first)  # earlier rows keep price and start
        self.assertEqual(len(after), len(first) + 1)
        closed = ListingPriceHistory.objects.get(pk=first[-1]["pk"])
        self.assertIsNotNone(closed.ended_at)
        # No code deletes or bulk-updates history rows.
        package = pathlib.Path(__file__).resolve().parents[1]
        for path in package.glob("*.py"):
            text = path.read_text()
            self.assertNotIn("price_history.all().delete", text, path.name)
            self.assertNotIn("ListingPriceHistory.objects.update", text, path.name)
            for line in text.splitlines():
                if "ListingPriceHistory" in line or "price_history" in line:
                    self.assertNotIn(".delete(", line, f"{path.name}: {line}")
                    self.assertNotIn(".update(", line, f"{path.name}: {line}")

    def test_a_discount_is_a_live_discount_for_the_deals_helper(self):
        self.start({"sale_price": "80"})
        plain = self.make("Plain")
        ids = set(Listing.objects.filter(pricing.live_discount_q()).values_list("pk", flat=True))
        self.assertIn(self.listing.pk, ids)
        self.assertNotIn(plain.pk, ids)
        deals = self.client.get("/api/storefront/deals/").json()
        rows = deals if isinstance(deals, list) else deals.get("results", deals)
        self.assertIn(self.listing.pk, [row["id"] for row in rows])
        # Expired discounts leave the feed.
        Listing.objects.filter(pk=self.listing.pk).update(sale_ends_at=timezone.now() - timedelta(minutes=1))
        deals = self.client.get("/api/storefront/deals/").json()
        rows = deals if isinstance(deals, list) else deals.get("results", deals)
        self.assertNotIn(self.listing.pk, [row["id"] for row in rows])
