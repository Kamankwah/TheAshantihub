from django.test import TestCase
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, Customer
from billing.models import Transaction
from cart.models import Cart, CartItem
from listings.models import Category, Listing, Zone
from orders.models import Order, OrderItem


class CheckoutTestsBase(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.owner = BusinessOwner.objects.create(
            full_name="Kofi Trader", login_phone="+233207662001", password_hash="x",
        )
        self.customer = Customer.objects.create(
            full_name="Ama Buyer", phone="+233200662001", password_hash="x",
        )
        self.other_customer = Customer.objects.create(
            full_name="Yaw Buyer", phone="+233200662002", password_hash="x",
        )
        self.hotels = Category.objects.get(slug="hotels")
        self.manhyia = Zone.objects.get(name="Manhyia")

        self.listing_a = Listing.objects.create(
            business_owner=self.owner, category=self.hotels, zone=self.manhyia,
            name="Room A", description="D.", contact_phone="+233207662001",
            price_amount="150.00", status=Listing.PUBLISHED,
        )
        self.listing_b = Listing.objects.create(
            business_owner=self.owner, category=self.hotels, zone=self.manhyia,
            name="Room B", description="D.", contact_phone="+233207662001",
            price_amount="75.50", status=Listing.PUBLISHED,
        )

    def _auth(self, customer):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(customer, 'customer')}")

    def _add_to_cart(self, listing, quantity):
        return self.client.post(
            "/api/cart/items/", {"listing": listing.id, "quantity": quantity}, format="json",
        )


class OrderCheckoutTests(CheckoutTestsBase):
    def test_empty_cart_checkout_is_rejected(self):
        self._auth(self.customer)
        response = self.client.post("/api/orders/checkout/")
        self.assertEqual(response.status_code, 400, response.content)
        self.assertFalse(Order.objects.exists())

    def test_checkout_with_no_cart_at_all_is_rejected(self):
        # Never even hit GET /api/cart/, so no Cart row exists yet.
        self._auth(self.customer)
        self.assertFalse(Cart.objects.filter(customer=self.customer).exists())
        response = self.client.post("/api/orders/checkout/")
        self.assertEqual(response.status_code, 400, response.content)

    def test_checkout_creates_order_and_items_and_empties_cart(self):
        self._auth(self.customer)
        self._add_to_cart(self.listing_a, 2)
        self._add_to_cart(self.listing_b, 1)

        response = self.client.post("/api/orders/checkout/")
        self.assertEqual(response.status_code, 201, response.content)
        data = response.json()

        order = Order.objects.get(id=data["id"])
        self.assertEqual(order.customer, self.customer)
        self.assertEqual(order.status, Order.PAID)
        self.assertEqual(str(order.total_amount), "375.50")  # 150*2 + 75.50

        items = OrderItem.objects.filter(order=order).order_by("listing__name")
        self.assertEqual(items.count(), 2)
        item_a = items.get(listing=self.listing_a)
        self.assertEqual(item_a.quantity, 2)
        self.assertEqual(str(item_a.unit_price), "150.00")
        self.assertEqual(str(item_a.line_total), "300.00")

        self.assertFalse(CartItem.objects.filter(cart__customer=self.customer).exists())

    def test_checkout_creates_a_transaction(self):
        self._auth(self.customer)
        self._add_to_cart(self.listing_a, 1)
        response = self.client.post("/api/orders/checkout/")
        order_id = response.json()["id"]

        transaction = Transaction.objects.get(customer=self.customer)
        self.assertIsNone(transaction.business_owner)
        self.assertEqual(str(transaction.amount), "150.00")
        self.assertEqual(transaction.status, Transaction.SUCCESS)
        self.assertIn(str(order_id), transaction.purpose)

    def test_checkout_uses_price_snapshot_not_current_listing_price(self):
        self._auth(self.customer)
        self._add_to_cart(self.listing_a, 1)
        self.listing_a.price_amount = "999.00"
        self.listing_a.save(update_fields=["price_amount"])

        response = self.client.post("/api/orders/checkout/")
        self.assertEqual(str(response.json()["total_amount"]), "150.00")

    def test_business_owner_cannot_checkout(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.owner, 'business_owner')}")
        response = self.client.post("/api/orders/checkout/")
        self.assertEqual(response.status_code, 403)

    def test_unauthenticated_cannot_checkout(self):
        response = self.client.post("/api/orders/checkout/")
        self.assertEqual(response.status_code, 401)


class OrderHistoryTests(CheckoutTestsBase):
    def setUp(self):
        super().setUp()
        self._auth(self.customer)
        self._add_to_cart(self.listing_a, 1)
        self.order = Order.objects.get(id=self.client.post("/api/orders/checkout/").json()["id"])

        self._auth(self.other_customer)
        self._add_to_cart(self.listing_b, 1)
        self.other_order = Order.objects.get(id=self.client.post("/api/orders/checkout/").json()["id"])

    def test_list_returns_only_own_orders(self):
        self._auth(self.customer)
        response = self.client.get("/api/orders/")
        self.assertEqual(response.status_code, 200, response.content)
        ids = [o["id"] for o in response.json()]
        self.assertEqual(ids, [self.order.id])

    def test_detail_returns_own_order(self):
        self._auth(self.customer)
        response = self.client.get(f"/api/orders/{self.order.id}/")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["id"], self.order.id)
        self.assertEqual(len(response.json()["items"]), 1)

    def test_detail_of_other_customers_order_is_404(self):
        self._auth(self.customer)
        response = self.client.get(f"/api/orders/{self.other_order.id}/")
        self.assertEqual(response.status_code, 404)

    def test_unauthenticated_cannot_list_orders(self):
        self.client.credentials()
        response = self.client.get("/api/orders/")
        self.assertEqual(response.status_code, 401)
