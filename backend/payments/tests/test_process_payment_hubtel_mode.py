"""process_payment() in "hubtel" mode (PAYMENTS_PROVIDER="hubtel") — verifies
the redirect branch and the resulting CheckoutSession state, with
hubtel_client.create_checkout() mocked out (no real Hubtel credentials exist
to call against). Does NOT exercise the real HTTP request in
hubtel_client.create_checkout() itself, or the webhook signature scheme —
both are explicitly UNVERIFIED against real Hubtel docs (see
payments/hubtel_client.py's module docstring) and untestable without a real
sandbox account.
"""
from unittest.mock import patch

from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, Customer
from billing.models import Transaction
from events.models import Event, EventTicketType
from listings.models import Category, Listing, Zone
from orders.models import Order
from payments.models import CheckoutSession

FAKE_CHECKOUT_RESPONSE = {"checkout_url": "https://checkout.hubtel.com/fake-session", "checkout_id": "hb-123"}


@override_settings(PAYMENTS_PROVIDER="hubtel")
class OrderCheckoutHubtelModeTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.owner = BusinessOwner.objects.create(
            full_name="Kofi Trader", login_phone="+233207992001", password_hash="x",
        )
        self.customer = Customer.objects.create(
            full_name="Ama Buyer", phone="+233200992001", password_hash="x",
        )
        self.hotels = Category.objects.get(slug="hotels")
        self.zone = Zone.objects.get(name="Manhyia")
        self.listing = Listing.objects.create(
            business_owner=self.owner, category=self.hotels, zone=self.zone,
            name="Room A", description="D.", contact_phone="+233207992001",
            price_amount="150.00", status=Listing.PUBLISHED,
        )
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.customer, 'customer')}")
        self.client.post("/api/cart/items/", {"listing": self.listing.id, "quantity": 1}, format="json")

    @patch("payments.services.hubtel_client.create_checkout", return_value=FAKE_CHECKOUT_RESPONSE)
    def test_checkout_returns_redirect_and_leaves_order_pending(self, mock_create_checkout):
        response = self.client.post("/api/orders/checkout/")
        self.assertEqual(response.status_code, 200, response.content)
        data = response.json()
        self.assertEqual(data["mode"], "redirect")
        self.assertEqual(data["checkout_url"], FAKE_CHECKOUT_RESPONSE["checkout_url"])
        self.assertTrue(data["reference"])
        mock_create_checkout.assert_called_once()

        order = Order.objects.get(customer=self.customer)
        self.assertEqual(order.status, Order.PENDING)
        self.assertFalse(Transaction.objects.filter(customer=self.customer).exists())

        session = CheckoutSession.objects.get(reference=data["reference"])
        self.assertEqual(session.status, CheckoutSession.PENDING)
        self.assertEqual(session.provider, "hubtel")
        self.assertEqual(session.checkout_url, FAKE_CHECKOUT_RESPONSE["checkout_url"])

        # Cart is NOT emptied yet in redirect mode — nothing has been paid
        # for; only a confirmed webhook (or, in simulated mode, the
        # synchronous immediate path) empties it.
        cart_response = self.client.get("/api/cart/")
        self.assertTrue(len(cart_response.json().get("items", [])) >= 1)


@override_settings(PAYMENTS_PROVIDER="hubtel")
class TicketPurchaseHubtelModeTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.buyer = Customer.objects.create(
            full_name="Yaw Buyer", phone="+233200992002", password_hash="x",
        )
        self.category = Category.objects.get(slug="festivals")
        self.zone = Zone.objects.get(name="Manhyia")
        self.event = Event.objects.create(
            category=self.category, zone=self.zone, submitted_by_customer=self.buyer,
            name="Akwasidae Festival", description="Royal durbar.", address="Manhyia Palace",
            event_date=timezone.now() + timezone.timedelta(days=30), visibility_days=14,
            status=Event.APPROVED, paid_at=timezone.now(),
            expires_at=timezone.now() + timezone.timedelta(days=14),
        )
        self.ticket_type = EventTicketType.objects.create(
            event=self.event, name="General", price="25.00", quantity_total=10,
        )
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.buyer, 'customer')}")

    @patch("payments.services.hubtel_client.create_checkout", return_value=FAKE_CHECKOUT_RESPONSE)
    def test_purchase_reserves_inventory_optimistically_before_redirect(self, mock_create_checkout):
        response = self.client.post(
            f"/api/events/{self.event.id}/tickets/purchase/",
            {"ticket_type": self.ticket_type.id, "quantity": 3},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["mode"], "redirect")

        # Inventory is reserved immediately, before payment is confirmed —
        # see events.views.TicketPurchaseView's docstring for why.
        self.ticket_type.refresh_from_db()
        self.assertEqual(self.ticket_type.quantity_sold, 3)
        # No Ticket rows yet — those are only created by
        # payments.services._finalize_ticket_purchase once the webhook
        # confirms success.
        self.assertEqual(self.ticket_type.tickets.count(), 0)
