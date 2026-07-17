from django.test import TestCase
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, Customer, Role, StaffUser
from listings.models import Category, Listing, Zone
from orders.models import DeliveryAssignment, Order, OrderItem


class DeliveryTestsBase(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.manager = StaffUser.objects.create(
            full_name="Manager Person", email="dm@example.com", password_hash="x",
            role=Role.objects.get(name="delivery_manager"),
        )
        self.dispatch = StaffUser.objects.create(
            full_name="Dispatch Kofi", email="dispatch@example.com", password_hash="x",
            role=Role.objects.get(name="dispatch"),
        )
        self.other_dispatch = StaffUser.objects.create(
            full_name="Dispatch Ama", email="dispatch2@example.com", password_hash="x",
            role=Role.objects.get(name="dispatch"),
        )
        self.owner = BusinessOwner.objects.create(
            full_name="Kwame Trader", login_phone="+233207882200", password_hash="x",
        )
        self.customer = Customer.objects.create(
            full_name="Ama Buyer", phone="+233200882200", password_hash="x",
        )
        self.listing = Listing.objects.create(
            business_owner=self.owner, category=Category.objects.get(slug="hotels"),
            zone=Zone.objects.get(name="Manhyia"), name="Kente Cloth", description="D.",
            contact_phone="+233207882200", price_amount="100.00", status=Listing.PUBLISHED,
            lat="6.700000", lng="-1.620000",
        )

    def _auth(self, account, kind="staff"):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(account, kind)}")

    def _make_order(self, method=Order.DOOR_TO_DOOR, status=Order.PAID):
        order = Order.objects.create(
            customer=self.customer, status=status, total_amount="100.00",
            delivery_method=method, delivery_address="12 Ash Road", delivery_phone="+233200882200",
            delivery_lat=6.69, delivery_lng=-1.62,
        )
        OrderItem.objects.create(
            order=order, listing=self.listing, quantity=1, unit_price="100.00", line_total="100.00",
        )
        return order


class DeliveryManagerTests(DeliveryTestsBase):
    def test_manager_sees_paid_door_to_door_orders_only(self):
        self._make_order(method=Order.DOOR_TO_DOOR, status=Order.PAID)
        self._make_order(method=Order.STORE_PICKUP, status=Order.PAID)
        self._make_order(method=Order.DOOR_TO_DOOR, status=Order.PENDING)
        self._auth(self.manager)
        response = self.client.get("/api/orders/delivery/")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["count"], 1)

    def test_delivery_list_requires_delivery_manage(self):
        self._auth(self.dispatch)
        self.assertEqual(self.client.get("/api/orders/delivery/").status_code, 403)

    def test_manager_assigns_a_dispatch(self):
        order = self._make_order()
        self._auth(self.manager)
        response = self.client.post(
            f"/api/orders/{order.id}/assign-dispatch/", {"dispatch": self.dispatch.id}, format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertTrue(DeliveryAssignment.objects.filter(order=order, dispatch=self.dispatch).exists())

    def test_cannot_assign_a_non_dispatch(self):
        order = self._make_order()
        self._auth(self.manager)
        response = self.client.post(
            f"/api/orders/{order.id}/assign-dispatch/", {"dispatch": self.manager.id}, format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_cannot_assign_a_store_pickup_order(self):
        order = self._make_order(method=Order.STORE_PICKUP)
        self._auth(self.manager)
        response = self.client.post(
            f"/api/orders/{order.id}/assign-dispatch/", {"dispatch": self.dispatch.id}, format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_dispatch_staff_list(self):
        self._auth(self.manager)
        names = [d["full_name"] for d in self.client.get("/api/orders/dispatches/").json()]
        self.assertIn("Dispatch Kofi", names)
        self.assertNotIn("Manager Person", names)


class DispatchWorkflowTests(DeliveryTestsBase):
    def setUp(self):
        super().setUp()
        self.order = self._make_order()
        self.assignment = DeliveryAssignment.objects.create(
            order=self.order, dispatch=self.dispatch, assigned_by=self.manager,
        )

    def test_dispatch_sees_pickup_and_dropoff_locations(self):
        self._auth(self.dispatch)
        response = self.client.get("/api/orders/dispatch/")
        self.assertEqual(response.status_code, 200, response.content)
        row = response.json()["results"][0]
        self.assertEqual(row["delivery_address"], "12 Ash Road")
        self.assertEqual(len(row["pickups"]), 1)
        self.assertEqual(row["pickups"][0]["business_name"], "Kwame Trader")
        self.assertEqual(row["pickups"][0]["lat"], 6.7)

    def test_dispatch_sees_only_their_own_deliveries(self):
        self._auth(self.other_dispatch)
        self.assertEqual(self.client.get("/api/orders/dispatch/").json()["count"], 0)

    def test_pickup_then_deliver_then_customer_confirms(self):
        self._auth(self.dispatch)
        pickup = self.client.post(f"/api/orders/delivery/{self.assignment.id}/pickup/")
        self.assertEqual(pickup.status_code, 200, pickup.content)
        self.assignment.refresh_from_db()
        self.order.refresh_from_db()
        self.assertEqual(self.assignment.status, DeliveryAssignment.PICKED_UP)
        self.assertEqual(self.order.delivery_status, Order.OUT_FOR_DELIVERY)

        deliver = self.client.post(f"/api/orders/delivery/{self.assignment.id}/deliver/")
        self.assertEqual(deliver.status_code, 200, deliver.content)
        self.assignment.refresh_from_db()
        self.assertEqual(self.assignment.status, DeliveryAssignment.DELIVERED)

        # Customer confirms receipt.
        self._auth(self.customer, "customer")
        confirm = self.client.post(f"/api/orders/{self.order.id}/confirm-receipt/")
        self.assertEqual(confirm.status_code, 200, confirm.content)
        self.assignment.refresh_from_db()
        self.assertEqual(self.assignment.status, DeliveryAssignment.CONFIRMED)

    def test_cannot_deliver_before_pickup(self):
        self._auth(self.dispatch)
        response = self.client.post(f"/api/orders/delivery/{self.assignment.id}/deliver/")
        self.assertEqual(response.status_code, 400)

    def test_customer_cannot_confirm_before_delivered(self):
        self._auth(self.customer, "customer")
        response = self.client.post(f"/api/orders/{self.order.id}/confirm-receipt/")
        self.assertEqual(response.status_code, 400)

    def test_another_dispatch_cannot_action_your_delivery(self):
        self._auth(self.other_dispatch)
        response = self.client.post(f"/api/orders/delivery/{self.assignment.id}/pickup/")
        self.assertEqual(response.status_code, 404)

    def test_a_different_customer_cannot_confirm_your_order(self):
        self.assignment.status = DeliveryAssignment.DELIVERED
        self.assignment.save()
        stranger = Customer.objects.create(
            full_name="Yaw Stranger", phone="+233200882299", password_hash="x",
        )
        self._auth(stranger, "customer")
        response = self.client.post(f"/api/orders/{self.order.id}/confirm-receipt/")
        self.assertEqual(response.status_code, 404)
