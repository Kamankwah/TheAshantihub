"""Variants in the cart: several variants of one listing, one line per variant, all-or-none adds."""
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, Customer
from cart.models import CartItem
from listings import variants
from listings.models import Category, Listing, ListingVariant, Zone


class VariantCartBase(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.owner = BusinessOwner.objects.create(full_name="Ama Bakes", login_phone="+233207883001", password_hash="x")
        self.customer = Customer.objects.create(full_name="Yaw", phone="+233200883001", password_hash="x")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.customer, 'customer')}")
        self.cake = self.make("Cake")
        self.vanilla = self.variant(self.cake, "Vanilla / 500 g", "25.00", 5)
        self.choc = self.variant(self.cake, "Chocolate / 500 g", "30.00", 4)

    def make(self, name):
        return Listing.objects.create(
            business_owner=self.owner, category=Category.objects.get(slug="shops"), zone=Zone.objects.get(name="Manhyia"),
            name=name, description="D.", contact_phone=self.owner.login_phone, price_amount="10.00", status=Listing.PUBLISHED,
        )

    def variant(self, listing, label, price, stock):
        row = ListingVariant.objects.create(listing=listing, label=label, price_amount=price, stock_quantity=stock)
        variants.sync_listing(listing)
        return row

    def post(self, body):
        return self.client.post("/api/cart/items/", body, format="json")


class VariantCartTests(VariantCartBase):
    def test_add_several_variants_of_one_listing_in_one_request(self):
        response = self.post({"listing": self.cake.pk, "lines": [
            {"variant": self.vanilla.pk, "quantity": 2}, {"variant": self.choc.pk, "quantity": 1},
        ]})
        self.assertEqual(response.status_code, 201, response.content)
        rows = list(CartItem.objects.order_by("pk"))
        self.assertEqual([(r.variant_id, r.quantity, str(r.unit_price_snapshot)) for r in rows],
                         [(self.vanilla.pk, 2, "25.00"), (self.choc.pk, 1, "30.00")])
        body = response.json()
        self.assertEqual(sorted(i["variant_label"] for i in body), ["Chocolate / 500 g", "Vanilla / 500 g"])
        self.assertEqual({i["variant"] for i in body}, {self.vanilla.pk, self.choc.pk})
        cart = self.client.get("/api/cart/").json()
        self.assertEqual(cart["total"], "80.00")
        self.assertEqual({i["variant_label"] for i in cart["items"]}, {"Chocolate / 500 g", "Vanilla / 500 g"})

    def test_adding_the_same_variant_again_increments_its_line(self):
        self.assertEqual(self.post({"listing": self.cake.pk, "variant": self.vanilla.pk, "quantity": 1}).status_code, 201)
        again = self.post({"listing": self.cake.pk, "variant": self.vanilla.pk, "quantity": 2})
        self.assertEqual(again.status_code, 200, again.content)
        self.assertEqual(CartItem.objects.count(), 1)
        self.assertEqual(CartItem.objects.get().quantity, 3)

    def test_a_variant_listing_requires_a_variant(self):
        response = self.post({"listing": self.cake.pk, "quantity": 1})
        self.assertEqual(response.status_code, 400, response.content)
        self.assertFalse(CartItem.objects.exists())

    def test_a_variant_of_another_listing_is_refused(self):
        other = self.make("Bread")
        bread = self.variant(other, "Large", "12.00", 3)
        response = self.post({"listing": self.cake.pk, "variant": bread.pk, "quantity": 1})
        self.assertEqual(response.status_code, 400, response.content)
        self.assertFalse(CartItem.objects.exists())

    def test_an_inactive_variant_is_refused(self):
        ListingVariant.objects.filter(pk=self.choc.pk).update(is_active=False)
        response = self.post({"listing": self.cake.pk, "variant": self.choc.pk, "quantity": 1})
        self.assertEqual(response.status_code, 400, response.content)

    def test_all_lines_or_none(self):
        other = self.make("Bread")
        bread = self.variant(other, "Large", "12.00", 3)
        response = self.post({"listing": self.cake.pk, "lines": [
            {"variant": self.vanilla.pk, "quantity": 1}, {"variant": bread.pk, "quantity": 1},
        ]})
        self.assertEqual(response.status_code, 400, response.content)
        self.assertFalse(CartItem.objects.exists())

    def test_a_plain_listing_still_adds_without_a_variant(self):
        plain = self.make("Plain")
        response = self.post({"listing": plain.pk, "quantity": 2})
        self.assertEqual(response.status_code, 201, response.content)
        self.assertIsNone(CartItem.objects.get().variant_id)
        self.assertIsNone(response.json()["variant"])
        self.assertEqual(response.json()["variant_label"], "")

    def test_a_plain_listing_refuses_a_variant(self):
        plain = self.make("Plain")
        response = self.post({"listing": plain.pk, "variant": self.vanilla.pk, "quantity": 1})
        self.assertEqual(response.status_code, 400, response.content)

    def test_a_quantity_change_rereads_the_variants_price(self):
        self.post({"listing": self.cake.pk, "variant": self.vanilla.pk, "quantity": 1})
        ListingVariant.objects.filter(pk=self.vanilla.pk).update(price_amount="27.00")
        item = CartItem.objects.get()
        response = self.client.patch(f"/api/cart/items/{item.pk}/", {"quantity": 2}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        item.refresh_from_db()
        self.assertEqual(str(item.unit_price_snapshot), "27.00")
