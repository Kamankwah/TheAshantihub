"""Checkout refuses a cart line whose listing is no longer on sale, before reserving any stock."""
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, Customer
from cart.models import Cart, CartItem
from listings.models import Category, Listing, Zone
from orders.models import Order


class CheckoutUnavailableLineTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.owner = BusinessOwner.objects.create(full_name="Kofi", login_phone="+233207772001", password_hash="x")
        self.customer = Customer.objects.create(full_name="Ama", phone="+233200772001", password_hash="x")
        self.listing = Listing.objects.create(
            business_owner=self.owner, category=Category.objects.get(slug="shops"),
            zone=Zone.objects.get(name="Manhyia"), name="Kente Cloth", description="D.",
            contact_phone="+233207772001", price_amount="50.00", status=Listing.PUBLISHED, stock_quantity=5,
        )
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.customer, 'customer')}")
        cart = Cart.objects.create(customer=self.customer)
        CartItem.objects.create(cart=cart, listing=self.listing, quantity=2, unit_price_snapshot="50.00")

    def checkout(self):
        return self.client.post("/api/orders/checkout/", {}, format="json")

    def test_checkout_refuses_a_dropped_line_with_listing_unavailable_and_reserves_no_stock(self):
        Listing.objects.filter(pk=self.listing.pk).update(status=Listing.DROPPED)
        response = self.checkout()
        self.assertEqual(response.status_code, 400, response.content)
        self.assertEqual(response.json(), {
            "detail": "“Kente Cloth” is no longer available. Remove it from your cart.",
            "code": "listing_unavailable",
        })
        self.assertEqual(Listing.objects.get(pk=self.listing.pk).stock_quantity, 5)
        self.assertFalse(Order.objects.exists())
        self.assertEqual(CartItem.objects.count(), 1)

    def test_checkout_refuses_a_discontinued_line(self):
        Listing.objects.filter(pk=self.listing.pk).update(status=Listing.DISCONTINUED)
        self.assertEqual(self.checkout().json()["code"], "listing_unavailable")

    def test_checkout_refuses_a_hidden_business_line(self):
        BusinessOwner.objects.filter(pk=self.owner.pk).update(is_suspended=True)
        response = self.checkout()
        self.assertEqual(response.status_code, 400, response.content)
        self.assertEqual(response.json()["code"], "listing_unavailable")
        self.assertEqual(Listing.objects.get(pk=self.listing.pk).stock_quantity, 5)
