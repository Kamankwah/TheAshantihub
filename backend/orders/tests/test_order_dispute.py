from django.test import TestCase
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, Customer
from disputes.models import Dispute
from listings.models import Category, Listing, Zone
from orders.models import Order, OrderItem


class OrderDisputeCreateTestsBase(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.owner = BusinessOwner.objects.create(
            full_name="Kofi Trader", login_phone="+233207663001", password_hash="x",
        )
        self.customer = Customer.objects.create(
            full_name="Ama Buyer", phone="+233200663001", password_hash="x",
        )
        self.other_customer = Customer.objects.create(
            full_name="Yaw Buyer", phone="+233200663002", password_hash="x",
        )
        self.hotels = Category.objects.get(slug="hotels")
        self.manhyia = Zone.objects.get(name="Manhyia")
        self.listing = Listing.objects.create(
            business_owner=self.owner, category=self.hotels, zone=self.manhyia,
            name="Room A", description="D.", contact_phone="+233207663001",
            price_amount="150.00", status=Listing.PUBLISHED,
        )
        self.order = Order.objects.create(
            customer=self.customer, status=Order.PAID, total_amount="150.00",
        )
        OrderItem.objects.create(
            order=self.order, listing=self.listing, quantity=1,
            unit_price="150.00", line_total="150.00",
        )

    def _auth_customer(self, customer):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(customer, 'customer')}")

    def _url(self, pk=None):
        return f"/api/orders/{pk or self.order.id}/dispute/"


class OrderDisputeCreateTests(OrderDisputeCreateTestsBase):
    def test_unauthenticated_cannot_raise_dispute(self):
        response = self.client.post(self._url(), {"reason": "delivery_issue", "description": "Never arrived."}, format="json")
        self.assertEqual(response.status_code, 401)

    def test_owner_raises_dispute_against_own_order(self):
        self._auth_customer(self.customer)
        response = self.client.post(
            self._url(), {"reason": "delivery_issue", "description": "Never arrived."}, format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        dispute = Dispute.objects.get(order=self.order)
        self.assertEqual(dispute.raised_by, self.customer)
        self.assertEqual(dispute.status, Dispute.OPEN)
        self.assertEqual(dispute.reason, "delivery_issue")
        self.assertEqual(dispute.description, "Never arrived.")
        self.assertIsNone(dispute.flagged_by)
        self.assertIsNone(dispute.resolved_by)

    def test_response_body_has_dispute_shape(self):
        self._auth_customer(self.customer)
        response = self.client.post(
            self._url(), {"reason": "quality_issue", "description": "Not as advertised."}, format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        data = response.json()
        self.assertEqual(data["status"], "open")
        self.assertEqual(data["order"], self.order.id)
        self.assertEqual(data["order_total_amount"], "150.00")

    def test_cannot_raise_dispute_against_another_customers_order(self):
        self._auth_customer(self.other_customer)
        response = self.client.post(
            self._url(), {"reason": "delivery_issue", "description": "Not mine."}, format="json",
        )
        self.assertEqual(response.status_code, 404)
        self.assertFalse(Dispute.objects.filter(order=self.order).exists())

    def test_missing_reason_is_400(self):
        self._auth_customer(self.customer)
        response = self.client.post(self._url(), {"description": "No reason given."}, format="json")
        self.assertEqual(response.status_code, 400, response.content)

    def test_invalid_reason_choice_is_400(self):
        self._auth_customer(self.customer)
        response = self.client.post(
            self._url(), {"reason": "not_a_real_reason", "description": "x"}, format="json",
        )
        self.assertEqual(response.status_code, 400, response.content)

    def test_business_owner_cannot_raise_dispute(self):
        self.client.credentials(
            HTTP_AUTHORIZATION=f"Bearer {issue_token(self.owner, 'business_owner')}"
        )
        response = self.client.post(
            self._url(), {"reason": "delivery_issue", "description": "x"}, format="json",
        )
        self.assertEqual(response.status_code, 403)

    def test_multiple_disputes_allowed_on_same_order(self):
        self._auth_customer(self.customer)
        first = self.client.post(
            self._url(), {"reason": "delivery_issue", "description": "First issue."}, format="json",
        )
        second = self.client.post(
            self._url(), {"reason": "quality_issue", "description": "Second issue."}, format="json",
        )
        self.assertEqual(first.status_code, 201, first.content)
        self.assertEqual(second.status_code, 201, second.content)
        self.assertEqual(Dispute.objects.filter(order=self.order).count(), 2)
