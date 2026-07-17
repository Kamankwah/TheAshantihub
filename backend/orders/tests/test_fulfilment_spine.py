from django.test import TestCase
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, Customer
from cart.models import CartItem
from listings.models import Category, Listing, Zone
from orders.models import Order


class FulfilmentSpineTestsBase(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.owner = BusinessOwner.objects.create(
            full_name="Kofi Trader", login_phone="+233207770001", password_hash="x",
        )
        self.other_owner = BusinessOwner.objects.create(
            full_name="Yaa Trader", login_phone="+233207770009", password_hash="x",
        )
        self.customer = Customer.objects.create(
            full_name="Ama Buyer", phone="+233200770001", password_hash="x",
        )
        self.hotels = Category.objects.get(slug="hotels")
        self.manhyia = Zone.objects.get(name="Manhyia")

        # A stock-tracked product (stock_quantity set) and an untracked one.
        self.tracked = Listing.objects.create(
            business_owner=self.owner, category=self.hotels, zone=self.manhyia,
            name="Kente Cloth", description="D.", contact_phone="+233207770001",
            price_amount="100.00", status=Listing.PUBLISHED, stock_quantity=5,
        )
        self.untracked = Listing.objects.create(
            business_owner=self.owner, category=self.hotels, zone=self.manhyia,
            name="Consulting", description="D.", contact_phone="+233207770001",
            price_amount="50.00", status=Listing.PUBLISHED, stock_quantity=None,
        )

    def _auth(self, account, kind="customer"):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(account, kind)}")

    def _add_to_cart(self, listing, quantity):
        return self.client.post(
            "/api/cart/items/", {"listing": listing.id, "quantity": quantity}, format="json",
        )


class DeliveryMethodTests(FulfilmentSpineTestsBase):
    def test_checkout_defaults_to_store_pickup(self):
        self._auth(self.customer)
        self._add_to_cart(self.untracked, 1)
        response = self.client.post("/api/orders/checkout/", {}, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.json()["delivery_method"], "store_pickup")

    def test_door_to_door_records_the_address(self):
        self._auth(self.customer)
        self._add_to_cart(self.untracked, 1)
        response = self.client.post(
            "/api/orders/checkout/",
            {"delivery_method": "door_to_door", "delivery_address": "12 Ash Road, Kumasi",
             "delivery_phone": "+233200770001"},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        order = Order.objects.get(id=response.json()["id"])
        self.assertEqual(order.delivery_method, "door_to_door")
        self.assertEqual(order.delivery_address, "12 Ash Road, Kumasi")

    def test_door_to_door_without_an_address_is_rejected(self):
        self._auth(self.customer)
        self._add_to_cart(self.untracked, 1)
        response = self.client.post(
            "/api/orders/checkout/", {"delivery_method": "door_to_door"}, format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertFalse(Order.objects.exists())

    def test_store_pickup_ignores_a_submitted_address(self):
        self._auth(self.customer)
        self._add_to_cart(self.untracked, 1)
        response = self.client.post(
            "/api/orders/checkout/",
            {"delivery_method": "store_pickup", "delivery_address": "should be dropped"},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(Order.objects.get(id=response.json()["id"]).delivery_address, "")

    def test_invalid_delivery_method_is_rejected(self):
        self._auth(self.customer)
        self._add_to_cart(self.untracked, 1)
        response = self.client.post(
            "/api/orders/checkout/", {"delivery_method": "teleport"}, format="json",
        )
        self.assertEqual(response.status_code, 400)


class StockDecrementTests(FulfilmentSpineTestsBase):
    def test_checkout_decrements_tracked_stock(self):
        self._auth(self.customer)
        self._add_to_cart(self.tracked, 3)
        response = self.client.post("/api/orders/checkout/", {}, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        self.tracked.refresh_from_db()
        self.assertEqual(self.tracked.stock_quantity, 2)

    def test_untracked_stock_is_left_alone(self):
        self._auth(self.customer)
        self._add_to_cart(self.untracked, 3)
        self.client.post("/api/orders/checkout/", {}, format="json")
        self.untracked.refresh_from_db()
        self.assertIsNone(self.untracked.stock_quantity)

    def test_oversell_is_rejected_and_nothing_is_charged(self):
        self._auth(self.customer)
        self._add_to_cart(self.tracked, 9)  # only 5 in stock
        response = self.client.post("/api/orders/checkout/", {}, format="json")
        self.assertEqual(response.status_code, 400, response.content)
        self.tracked.refresh_from_db()
        self.assertEqual(self.tracked.stock_quantity, 5)  # untouched
        self.assertFalse(Order.objects.exists())

    def test_can_buy_exactly_the_remaining_stock(self):
        self._auth(self.customer)
        self._add_to_cart(self.tracked, 5)
        response = self.client.post("/api/orders/checkout/", {}, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        self.tracked.refresh_from_db()
        self.assertEqual(self.tracked.stock_quantity, 0)


class RestockTests(FulfilmentSpineTestsBase):
    def test_owner_sets_absolute_stock_on_a_published_listing(self):
        self._auth(self.owner, "business_owner")
        response = self.client.post(
            f"/api/listings/mine/{self.tracked.id}/restock/", {"stock_quantity": 20}, format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.tracked.refresh_from_db()
        self.assertEqual(self.tracked.stock_quantity, 20)

    def test_owner_adds_to_stock(self):
        self._auth(self.owner, "business_owner")
        self.client.post(
            f"/api/listings/mine/{self.tracked.id}/restock/", {"add": 10}, format="json",
        )
        self.tracked.refresh_from_db()
        self.assertEqual(self.tracked.stock_quantity, 15)

    def test_add_starts_tracking_a_previously_untracked_listing(self):
        self._auth(self.owner, "business_owner")
        self.client.post(
            f"/api/listings/mine/{self.untracked.id}/restock/", {"add": 8}, format="json",
        )
        self.untracked.refresh_from_db()
        self.assertEqual(self.untracked.stock_quantity, 8)

    def test_another_owner_cannot_restock_your_listing(self):
        self._auth(self.other_owner, "business_owner")
        response = self.client.post(
            f"/api/listings/mine/{self.tracked.id}/restock/", {"add": 5}, format="json",
        )
        self.assertEqual(response.status_code, 403)

    def test_negative_absolute_stock_is_rejected(self):
        self._auth(self.owner, "business_owner")
        response = self.client.post(
            f"/api/listings/mine/{self.tracked.id}/restock/", {"stock_quantity": -3}, format="json",
        )
        self.assertEqual(response.status_code, 400)


class OwnerOrderTests(FulfilmentSpineTestsBase):
    def _place_paid_order(self, customer, lines):
        """lines = [(listing, qty)]. Uses the real checkout so stock/payment
        run; simulated mode marks the order PAID immediately.
        """
        self._auth(customer)
        for listing, qty in lines:
            self._add_to_cart(listing, qty)
        response = self.client.post("/api/orders/checkout/", {}, format="json")
        assert response.status_code == 201, response.content
        return response.json()["id"]

    def test_owner_sees_their_paid_orders(self):
        self._place_paid_order(self.customer, [(self.tracked, 2)])
        self._auth(self.owner, "business_owner")
        response = self.client.get("/api/orders/owner/")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["count"], 1)

    def test_owner_only_sees_their_own_line_items_in_a_shared_order(self):
        # A single customer order spanning two businesses.
        other_listing = Listing.objects.create(
            business_owner=self.other_owner, category=self.hotels, zone=self.manhyia,
            name="Other Product", description="D.", contact_phone="+233207770009",
            price_amount="200.00", status=Listing.PUBLISHED, stock_quantity=None,
        )
        self._place_paid_order(self.customer, [(self.untracked, 1), (other_listing, 1)])

        self._auth(self.owner, "business_owner")
        row = self.client.get("/api/orders/owner/").json()["results"][0]
        listing_ids = [i["listing"] for i in row["items"]]
        self.assertIn(self.untracked.id, listing_ids)
        self.assertNotIn(other_listing.id, listing_ids)
        # owner_subtotal covers only this owner's line (50.00), not the 250 total.
        self.assertEqual(row["owner_subtotal"], "50.00")

    def test_owner_endpoint_requires_a_business_owner(self):
        self._auth(self.customer)  # a customer, not a business owner
        self.assertEqual(self.client.get("/api/orders/owner/").status_code, 403)

    def test_pending_unpaid_orders_do_not_appear(self):
        # A door-to-door order with no cart won't checkout; instead make an
        # order and leave it pending by constructing it directly.
        order = Order.objects.create(
            customer=self.customer, status=Order.PENDING, total_amount="100.00",
        )
        from orders.models import OrderItem
        OrderItem.objects.create(
            order=order, listing=self.untracked, quantity=1,
            unit_price="50.00", line_total="50.00",
        )
        self._auth(self.owner, "business_owner")
        self.assertEqual(self.client.get("/api/orders/owner/").json()["count"], 0)
