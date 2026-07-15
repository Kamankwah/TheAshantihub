from django.test import TestCase
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, Customer
from cart.models import Cart, CartItem
from listings.models import Category, Listing, Zone


class CartTestsBase(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.owner = BusinessOwner.objects.create(
            full_name="Kofi Trader", login_phone="+233207661001", password_hash="x",
        )
        self.customer = Customer.objects.create(
            full_name="Ama Buyer", phone="+233200661001", password_hash="x",
        )
        self.other_customer = Customer.objects.create(
            full_name="Yaw Buyer", phone="+233200661002", password_hash="x",
        )
        self.hotels = Category.objects.get(slug="hotels")
        self.manhyia = Zone.objects.get(name="Manhyia")

        self.published_listing = Listing.objects.create(
            business_owner=self.owner, category=self.hotels, zone=self.manhyia,
            name="Published Room", description="D.", contact_phone="+233207661001",
            price_amount="150.00", status=Listing.PUBLISHED,
        )
        self.draft_listing = Listing.objects.create(
            business_owner=self.owner, category=self.hotels, zone=self.manhyia,
            name="Draft Room", description="D.", contact_phone="+233207661001",
            price_amount="99.00", status=Listing.DRAFT,
        )
        self.no_price_listing = Listing.objects.create(
            business_owner=self.owner, category=self.hotels, zone=self.manhyia,
            name="Quote-only Service", description="D.", contact_phone="+233207661001",
            status=Listing.PUBLISHED,
        )

    def _auth(self, customer):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(customer, 'customer')}")


class CartMeViewTests(CartTestsBase):
    def test_get_creates_cart_lazily(self):
        self.assertFalse(Cart.objects.filter(customer=self.customer).exists())
        self._auth(self.customer)
        response = self.client.get("/api/cart/")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["items"], [])
        self.assertEqual(response.json()["total"], "0.00")
        self.assertTrue(Cart.objects.filter(customer=self.customer).exists())

    def test_get_is_idempotent_and_returns_same_cart(self):
        self._auth(self.customer)
        first = self.client.get("/api/cart/").json()["id"]
        second = self.client.get("/api/cart/").json()["id"]
        self.assertEqual(first, second)
        self.assertEqual(Cart.objects.filter(customer=self.customer).count(), 1)

    def test_business_owner_cannot_access_cart(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.owner, 'business_owner')}")
        response = self.client.get("/api/cart/")
        self.assertEqual(response.status_code, 403)

    def test_unauthenticated_cannot_access_cart(self):
        response = self.client.get("/api/cart/")
        self.assertEqual(response.status_code, 401)


class CartItemCreateTests(CartTestsBase):
    def test_add_published_listing_creates_item_with_price_snapshot(self):
        self._auth(self.customer)
        response = self.client.post(
            "/api/cart/items/", {"listing": self.published_listing.id, "quantity": 2}, format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        item = CartItem.objects.get(cart__customer=self.customer)
        self.assertEqual(item.listing, self.published_listing)
        self.assertEqual(item.quantity, 2)
        self.assertEqual(str(item.unit_price_snapshot), "150.00")

    def test_price_snapshot_is_not_retroactively_changed_by_later_price_edit(self):
        self._auth(self.customer)
        self.client.post(
            "/api/cart/items/", {"listing": self.published_listing.id, "quantity": 1}, format="json",
        )
        self.published_listing.price_amount = "500.00"
        self.published_listing.save(update_fields=["price_amount"])

        item = CartItem.objects.get(cart__customer=self.customer)
        self.assertEqual(str(item.unit_price_snapshot), "150.00")

    def test_adding_same_listing_again_increments_quantity_not_duplicates(self):
        self._auth(self.customer)
        self.client.post(
            "/api/cart/items/", {"listing": self.published_listing.id, "quantity": 1}, format="json",
        )
        response = self.client.post(
            "/api/cart/items/", {"listing": self.published_listing.id, "quantity": 3}, format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(CartItem.objects.filter(cart__customer=self.customer).count(), 1)
        item = CartItem.objects.get(cart__customer=self.customer)
        self.assertEqual(item.quantity, 4)

    def test_default_quantity_is_one(self):
        self._auth(self.customer)
        response = self.client.post("/api/cart/items/", {"listing": self.published_listing.id}, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.json()["quantity"], 1)

    def test_cannot_add_a_draft_listing(self):
        self._auth(self.customer)
        response = self.client.post(
            "/api/cart/items/", {"listing": self.draft_listing.id, "quantity": 1}, format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertFalse(CartItem.objects.exists())

    def test_cannot_add_a_listing_with_no_price(self):
        self._auth(self.customer)
        response = self.client.post(
            "/api/cart/items/", {"listing": self.no_price_listing.id, "quantity": 1}, format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertFalse(CartItem.objects.exists())

    def test_quantity_must_be_positive(self):
        self._auth(self.customer)
        response = self.client.post(
            "/api/cart/items/", {"listing": self.published_listing.id, "quantity": 0}, format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_business_owner_cannot_add_to_cart(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.owner, 'business_owner')}")
        response = self.client.post(
            "/api/cart/items/", {"listing": self.published_listing.id, "quantity": 1}, format="json",
        )
        self.assertEqual(response.status_code, 403)


class CartItemUpdateDeleteTests(CartTestsBase):
    def setUp(self):
        super().setUp()
        self._auth(self.customer)
        self.client.post(
            "/api/cart/items/", {"listing": self.published_listing.id, "quantity": 2}, format="json",
        )
        self.item = CartItem.objects.get(cart__customer=self.customer)

    def test_owner_can_update_quantity(self):
        response = self.client.patch(f"/api/cart/items/{self.item.id}/", {"quantity": 5}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        self.item.refresh_from_db()
        self.assertEqual(self.item.quantity, 5)

    def test_update_quantity_must_be_positive(self):
        response = self.client.patch(f"/api/cart/items/{self.item.id}/", {"quantity": 0}, format="json")
        self.assertEqual(response.status_code, 400)

    def test_owner_can_delete_item(self):
        response = self.client.delete(f"/api/cart/items/{self.item.id}/")
        self.assertEqual(response.status_code, 204)
        self.assertFalse(CartItem.objects.filter(id=self.item.id).exists())

    def test_other_customer_cannot_update_item(self):
        self._auth(self.other_customer)
        response = self.client.patch(f"/api/cart/items/{self.item.id}/", {"quantity": 9}, format="json")
        self.assertEqual(response.status_code, 403)
        self.item.refresh_from_db()
        self.assertEqual(self.item.quantity, 2)

    def test_other_customer_cannot_delete_item(self):
        self._auth(self.other_customer)
        response = self.client.delete(f"/api/cart/items/{self.item.id}/")
        self.assertEqual(response.status_code, 403)
        self.assertTrue(CartItem.objects.filter(id=self.item.id).exists())

    def test_nonexistent_item_returns_404(self):
        response = self.client.patch("/api/cart/items/999999/", {"quantity": 1}, format="json")
        self.assertEqual(response.status_code, 404)

    def test_unauthenticated_cannot_update_item(self):
        self.client.credentials()
        response = self.client.patch(f"/api/cart/items/{self.item.id}/", {"quantity": 1}, format="json")
        self.assertEqual(response.status_code, 401)
