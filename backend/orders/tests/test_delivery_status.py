from django.test import TestCase
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, Customer, Role, StaffUser
from listings.models import Category, Listing, Zone
from orders.models import Order, OrderItem


class OrderDeliveryStatusTestsBase(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.owner = BusinessOwner.objects.create(
            full_name="Kofi Trader", login_phone="+233207662099", password_hash="x",
        )
        self.customer = Customer.objects.create(
            full_name="Ama Buyer", phone="+233200662099", password_hash="x",
        )
        self.hotels = Category.objects.get(slug="hotels")
        self.manhyia = Zone.objects.get(name="Manhyia")
        self.listing = Listing.objects.create(
            business_owner=self.owner, category=self.hotels, zone=self.manhyia,
            name="Room A", description="D.", contact_phone="+233207662099",
            price_amount="150.00", status=Listing.PUBLISHED,
        )
        self.order = Order.objects.create(
            customer=self.customer, status=Order.PAID, total_amount="150.00",
        )
        OrderItem.objects.create(
            order=self.order, listing=self.listing, quantity=1,
            unit_price="150.00", line_total="150.00",
        )

        self.admin = StaffUser.objects.create(
            full_name="Admin Person", email="admin-delivery@example.com", password_hash="x",
            role=Role.objects.get(name="admin"),
        )
        self.marketing = StaffUser.objects.create(
            full_name="Marketing Person", email="marketing-delivery@example.com", password_hash="x",
            role=Role.objects.get(name="marketing"),
        )

    def _auth_staff(self, staff):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(staff, 'staff')}")

    def _auth_customer(self, customer):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(customer, 'customer')}")


class OrderDeliveryStatusDefaultTests(OrderDeliveryStatusTestsBase):
    def test_new_order_defaults_to_processing(self):
        self.assertEqual(self.order.delivery_status, Order.PROCESSING)

    def test_delivery_status_is_exposed_on_customer_order_serializer(self):
        self._auth_customer(self.customer)
        response = self.client.get(f"/api/orders/{self.order.id}/")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["delivery_status"], "processing")


class OrderStaffListViewTests(OrderDeliveryStatusTestsBase):
    def test_list_without_permission_is_403(self):
        self._auth_staff(self.marketing)
        response = self.client.get("/api/orders/staff/")
        self.assertEqual(response.status_code, 403)

    def test_customer_cannot_access_staff_list(self):
        self._auth_customer(self.customer)
        response = self.client.get("/api/orders/staff/")
        self.assertEqual(response.status_code, 403)

    def test_unauthenticated_cannot_access_staff_list(self):
        response = self.client.get("/api/orders/staff/")
        self.assertEqual(response.status_code, 401)

    def test_list_with_permission_returns_paginated_envelope_with_customer_name(self):
        self._auth_staff(self.admin)
        response = self.client.get("/api/orders/staff/")
        self.assertEqual(response.status_code, 200, response.content)
        data = response.json()
        self.assertIn("results", data)
        self.assertIn("count", data)
        result = next(r for r in data["results"] if r["id"] == self.order.id)
        self.assertEqual(result["customer_name"], "Ama Buyer")
        self.assertEqual(result["customer"], self.customer.id)
        self.assertEqual(result["delivery_status"], "processing")
        self.assertEqual(len(result["items"]), 1)


class OrderDeliveryStatusUpdateViewTests(OrderDeliveryStatusTestsBase):
    def test_update_without_permission_is_403(self):
        self._auth_staff(self.marketing)
        response = self.client.patch(
            f"/api/orders/{self.order.id}/delivery-status/", {"delivery_status": "shipped"}, format="json",
        )
        self.assertEqual(response.status_code, 403)

    def test_customer_cannot_update_delivery_status(self):
        self._auth_customer(self.customer)
        response = self.client.patch(
            f"/api/orders/{self.order.id}/delivery-status/", {"delivery_status": "shipped"}, format="json",
        )
        self.assertEqual(response.status_code, 403)

    def test_unauthenticated_cannot_update_delivery_status(self):
        response = self.client.patch(
            f"/api/orders/{self.order.id}/delivery-status/", {"delivery_status": "shipped"}, format="json",
        )
        self.assertEqual(response.status_code, 401)

    def test_valid_update_succeeds(self):
        self._auth_staff(self.admin)
        response = self.client.patch(
            f"/api/orders/{self.order.id}/delivery-status/", {"delivery_status": "shipped"}, format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.order.refresh_from_db()
        self.assertEqual(self.order.delivery_status, Order.SHIPPED)

    def test_invalid_choice_is_rejected(self):
        self._auth_staff(self.admin)
        response = self.client.patch(
            f"/api/orders/{self.order.id}/delivery-status/", {"delivery_status": "teleported"}, format="json",
        )
        self.assertEqual(response.status_code, 400, response.content)
        self.assertIn("delivery_status", response.json())
        self.order.refresh_from_db()
        self.assertEqual(self.order.delivery_status, Order.PROCESSING)

    def test_update_does_not_touch_payment_status(self):
        self._auth_staff(self.admin)
        response = self.client.patch(
            f"/api/orders/{self.order.id}/delivery-status/", {"delivery_status": "delivered"}, format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.order.refresh_from_db()
        self.assertEqual(self.order.status, Order.PAID)
        self.assertEqual(self.order.delivery_status, Order.DELIVERED)
