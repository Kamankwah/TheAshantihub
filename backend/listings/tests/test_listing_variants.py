"""Product variants: each has its own price and stock; the listing's price and stock are derived from them."""
from decimal import Decimal

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, BusinessOwnerProfile
from listings import variants
from listings.models import Category, Listing, ListingPriceHistory, ListingVariant, Zone


def make_owner(name, phone):
    owner = BusinessOwner.objects.create(full_name=name, login_phone=phone, password_hash="x")
    BusinessOwnerProfile.objects.create(
        business_owner=owner, ghana_card_number=f"GHA-{phone[-9:]}-1", gps_address="AK-039-7001",
        business_contact_phone=phone, is_formal=False, default_payout_method="momo", payout_momo_network="MTN",
        payout_momo_number=phone, payout_momo_name=name,
    )
    return owner


class VariantTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.owner = make_owner("Ama Bakes", "+233207772001")
        self.other = make_owner("Kofi Other", "+233207772002")
        self.shops = Category.objects.get(slug="shops")
        self.zone = Zone.objects.get(name="Manhyia")
        self.listing = self.make("Cake", Listing.DRAFT)
        self.auth(self.owner)

    def make(self, name, status, **extra):
        return Listing.objects.create(
            business_owner=self.owner, category=self.shops, zone=self.zone, name=name, description="D.",
            contact_phone="+233207772001", price_amount="10.00", status=status, **extra,
        )

    def auth(self, who):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(who, 'business_owner')}")

    def url(self, listing=None, suffix=""):
        return f"/api/listings/mine/{(listing or self.listing).pk}/variants/{suffix}"

    def add(self, label="Vanilla", price="25.00", stock=5, listing=None, **extra):
        body = {"label": label, "price_amount": price, "stock_quantity": stock, **extra}
        return self.client.post(self.url(listing), body, format="json")

    def refresh(self):
        self.listing.refresh_from_db()
        return self.listing

    def test_owner_adds_variants_to_a_draft_listing(self):
        first = self.add("Vanilla", "25.00", 5)
        self.assertEqual(first.status_code, 201, first.content)
        self.assertEqual(first.json()["label"], "Vanilla")
        self.assertEqual(first.json()["price_amount"], "25.00")
        self.assertEqual(first.json()["effective_price"], "25.00")
        built = self.client.post(
            self.url(), {"attributes": {"flavour": "Lemon", "size": "500 g"}, "price_amount": "30"}, format="json",
        )
        self.assertEqual(built.status_code, 201, built.content)
        self.assertEqual(built.json()["label"], "Lemon / 500 g")
        self.assertIsNone(built.json()["stock_quantity"])
        listed = self.client.get(self.url()).json()
        self.assertEqual([row["label"] for row in listed], ["Vanilla", "Lemon / 500 g"])
        self.assertTrue(ListingVariant.objects.filter(listing=self.listing, label="Vanilla").exists())

    def test_listing_price_and_stock_are_derived_from_variants(self):
        self.add("Vanilla", "25.00", 5)
        self.add("Lemon", "18.50", 3)
        listing = self.refresh()
        self.assertEqual(listing.price_amount, Decimal("18.50"))
        self.assertEqual(listing.stock_quantity, 8)
        self.add("Plain", "40.00", None)
        self.assertIsNone(self.refresh().stock_quantity)
        self.assertEqual(self.refresh().price_amount, Decimal("18.50"))

    def test_variant_price_must_be_positive_and_labels_unique(self):
        for bad in ("0", "-3", "abc", None):
            response = self.add("Zero", bad)
            self.assertEqual(response.status_code, 400, (bad, response.content))
            self.assertIn("price_amount", response.json())
        self.assertEqual(self.add("Vanilla").status_code, 201)
        dup = self.add("  vanilla ", "9.00")
        self.assertEqual(dup.status_code, 400, dup.content)
        self.assertIn("label", dup.json())
        self.assertEqual(self.add("", "9.00").status_code, 400)
        self.assertEqual(self.add("A", "9.00", -1).status_code, 400)
        many = self.add("B", "9.00", attributes={str(i): "x" for i in range(5)})
        self.assertEqual(many.status_code, 400, many.content)
        nonstring = self.add("C", "9.00", attributes={"size": 5})
        self.assertEqual(nonstring.status_code, 400, nonstring.content)

    def test_a_label_can_be_reused_once_its_variant_is_deactivated(self):
        first = self.add("Vanilla").json()
        self.assertEqual(self.client.delete(self.url(suffix=f"{first['id']}/")).status_code, 204)
        self.assertEqual(self.add("Vanilla").status_code, 201)

    def test_at_most_forty_variants(self):
        for i in range(40):
            self.assertEqual(self.add(f"V{i}", "5.00").status_code, 201)
        over = self.add("V40", "5.00")
        self.assertEqual(over.status_code, 400, over.content)
        self.assertEqual(ListingVariant.objects.filter(listing=self.listing).count(), 40)

    def test_variants_post_only_on_a_draft_or_rejected_listing(self):
        live = "Changes to a live listing are sent for approval."
        for status in (Listing.PUBLISHED, Listing.DROPPED):
            target = self.make(f"L {status}", status)
            response = self.add("X", listing=target)
            self.assertEqual(response.status_code, 400)
            self.assertEqual(response.json(), {"detail": live})
        for status in (Listing.DISCONTINUED, Listing.PENDING_REVIEW):
            target = self.make(f"L {status}", status)
            response = self.add("X", listing=target)
            self.assertEqual(response.status_code, 400)
            self.assertNotEqual(response.json()["detail"], live)
        rejected = self.make("Rejected", Listing.REJECTED)
        self.assertEqual(self.add("X", listing=rejected).status_code, 201)

    def test_public_detail_lists_only_active_variants_and_hides_none_staged(self):
        self.add("Vanilla", "25.00", 5)
        gone = self.add("Lemon", "18.50", 3).json()
        self.client.delete(self.url(suffix=f"{gone['id']}/"))
        Listing.objects.filter(pk=self.listing.pk).update(status=Listing.PUBLISHED)
        self.client.credentials()
        body = self.client.get(f"/api/listings/{self.listing.pk}/").json()
        self.assertTrue(body["has_variants"])
        self.assertEqual([row["label"] for row in body["variants"]], ["Vanilla"])
        self.assertNotIn("is_active", body["variants"][0])
        self.assertEqual(body["price_amount"], "25.00")
        plain = self.make("Plain", Listing.PUBLISHED)
        body = self.client.get(f"/api/listings/{plain.pk}/").json()
        self.assertFalse(body["has_variants"])
        self.assertEqual(body["variants"], [])

    def test_removing_the_last_variant_keeps_values_and_ends_has_variants(self):
        only = self.add("Vanilla", "25.00", 5).json()
        self.client.delete(self.url(suffix=f"{only['id']}/"))
        listing = self.refresh()
        self.assertEqual((listing.price_amount, listing.stock_quantity), (Decimal("25.00"), 5))
        self.assertFalse(variants.has_variants(listing))

    def live(self, variant_id, body, listing=None):
        listing = listing or self.listing
        return self.client.patch(f"/api/listings/mine/{listing.pk}/variants/{variant_id}/live/", body, format="json")

    def published_with_variants(self):
        a = self.add("Vanilla", "25.00", 5).json()
        b = self.add("Lemon", "18.50", 3).json()
        Listing.objects.filter(pk=self.listing.pk).update(status=Listing.PUBLISHED)
        return a, b

    def test_review_focus_live_edit_changes_only_price_and_stock_and_resyncs_the_listing(self):
        a, b = self.published_with_variants()
        response = self.live(b["id"], {"price_amount": "30.00", "stock_quantity": 10})
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["price_amount"], "30.00")
        listing = self.refresh()
        self.assertEqual(listing.price_amount, Decimal("25.00"))  # min(25, 30)
        self.assertEqual(listing.stock_quantity, 15)
        row = ListingVariant.objects.get(pk=b["id"])
        self.assertEqual((row.label, row.is_active), ("Lemon", True))
        added = self.live(a["id"], {"add": 4})
        self.assertEqual(added.status_code, 200, added.content)
        self.assertEqual(ListingVariant.objects.get(pk=a["id"]).stock_quantity, 9)
        self.assertEqual(self.refresh().stock_quantity, 19)
        # Plan 1's history hook saw the derived from-price move 18.50 -> 25.00.
        prices = list(ListingPriceHistory.objects.filter(listing=self.listing).order_by("started_at", "pk").values_list("price", flat=True))
        self.assertEqual(prices[-1], Decimal("25.00"))
        self.assertIn(Decimal("18.50"), prices)

    def test_live_edit_works_on_a_dropped_listing_and_is_refused_on_a_discontinued_one(self):
        a, _ = self.published_with_variants()
        Listing.objects.filter(pk=self.listing.pk).update(status=Listing.DROPPED)
        self.assertEqual(self.live(a["id"], {"stock_quantity": 2}).status_code, 200)
        Listing.objects.filter(pk=self.listing.pk).update(status=Listing.DISCONTINUED)
        self.assertEqual(self.live(a["id"], {"stock_quantity": 3}).status_code, 400)
        self.assertEqual(ListingVariant.objects.get(pk=a["id"]).stock_quantity, 2)

    def test_live_edit_refuses_any_other_field(self):
        a, _ = self.published_with_variants()
        for body in ({"label": "New"}, {"price_amount": "20", "is_active": False}, {"attributes": {}}, {},
                     {"stock_quantity": 1, "add": 1}, {"price_amount": "0"}, {"stock_quantity": -1}, {"add": 0}):
            response = self.live(a["id"], body)
            self.assertEqual(response.status_code, 400, (body, response.content))
        row = ListingVariant.objects.get(pk=a["id"])
        self.assertEqual((row.label, row.price_amount, row.stock_quantity), ("Vanilla", Decimal("25.00"), 5))

    def test_manage_and_restock_refuse_a_variant_listing(self):
        self.published_with_variants()
        message = {"detail": "Edit each variant's price and stock."}
        manage = self.client.patch(f"/api/listings/mine/{self.listing.pk}/manage/", {"price_amount": "99"}, format="json")
        self.assertEqual((manage.status_code, manage.json()), (400, message))
        restock = self.client.post(f"/api/listings/mine/{self.listing.pk}/restock/", {"add": 5}, format="json")
        self.assertEqual((restock.status_code, restock.json()), (400, message))
        plain = self.make("Plain", Listing.PUBLISHED)
        ok = self.client.post(f"/api/listings/mine/{plain.pk}/restock/", {"add": 5}, format="json")
        self.assertEqual(ok.status_code, 200, ok.content)

    def test_full_edit_of_a_variant_draft_keeps_the_derived_values(self):
        self.add("Vanilla", "25.00", 5)
        response = self.client.patch(
            f"/api/listings/mine/{self.listing.pk}/", {"price_amount": "99.00", "stock_quantity": 1}, format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        listing = self.refresh()
        self.assertEqual((listing.price_amount, listing.stock_quantity), (Decimal("25.00"), 5))

    def test_owner_listing_shows_variants_and_has_variants(self):
        self.add("Vanilla", "25.00", 5)
        body = self.client.get("/api/listings/mine/").json()
        rows = body["results"] if isinstance(body, dict) else body
        row = next(r for r in rows if r["id"] == self.listing.pk)
        self.assertTrue(row["has_variants"])
        self.assertEqual(row["variants"][0]["label"], "Vanilla")
        self.assertIn("is_active", row["variants"][0])

    def test_another_owner_cannot_touch_a_variant(self):
        a, _ = self.published_with_variants()
        self.auth(self.other)
        self.assertEqual(self.client.get(self.url()).status_code, 404)
        self.assertEqual(self.add("Hack").status_code, 404)
        self.assertEqual(self.live(a["id"], {"stock_quantity": 0}).status_code, 404)
        self.assertEqual(self.client.delete(self.url(suffix=f"{a['id']}/")).status_code, 404)
        # A variant of another listing is not reachable through my listing either.
        mine = Listing.objects.create(
            business_owner=self.other, category=self.shops, zone=self.zone, name="Mine", description="D.",
            contact_phone="+233207772002", price_amount="1.00", status=Listing.PUBLISHED,
        )
        self.assertEqual(self.live(a["id"], {"stock_quantity": 0}, listing=mine).status_code, 404)
        self.assertEqual(ListingVariant.objects.get(pk=a["id"]).stock_quantity, 5)

    @override_settings(SOLD_OUT_HIDDEN_ENABLED=True)
    def test_sold_out_hiding_uses_the_derived_stock(self):
        a, b = self.published_with_variants()
        self.client.credentials()
        ids = lambda: {r["id"] for r in (lambda d: d["results"] if isinstance(d, dict) else d)(self.client.get("/api/listings/").json())}
        self.assertIn(self.listing.pk, ids())
        self.auth(self.owner)
        self.live(a["id"], {"stock_quantity": 0})
        self.live(b["id"], {"stock_quantity": 0})
        self.assertEqual(self.refresh().stock_quantity, 0)
        self.client.credentials()
        self.assertNotIn(self.listing.pk, ids())
