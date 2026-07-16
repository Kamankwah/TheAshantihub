"""process_payment() simulated-mode behavior (PAYMENTS_PROVIDER unset/
"simulated", the only mode exercised until real Hubtel credentials exist) —
verifies each of the 4 converted call sites behaves identically to this
codebase's pre-existing direct-Transaction.objects.create() behavior.
"""
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, Customer
from billing.models import Subscription, SubscriptionPlan, Transaction
from cart.models import Cart, CartItem
from events.models import Event, EventTicketType, Ticket
from listings.models import Category, Listing, Zone
from orders.models import Order
from payments.models import CheckoutSession


class ProcessPaymentSimulatedModeBase(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.owner = BusinessOwner.objects.create(
            full_name="Kofi Trader", login_phone="+233207990001", password_hash="x",
        )
        self.customer = Customer.objects.create(
            full_name="Ama Buyer", phone="+233200990001", password_hash="x",
        )

    def _auth(self, account, account_type):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(account, account_type)}")


class OrderCheckoutSimulatedTests(ProcessPaymentSimulatedModeBase):
    def setUp(self):
        super().setUp()
        self.hotels = Category.objects.get(slug="hotels")
        self.zone = Zone.objects.get(name="Manhyia")
        self.listing = Listing.objects.create(
            business_owner=self.owner, category=self.hotels, zone=self.zone,
            name="Room A", description="D.", contact_phone="+233207990001",
            price_amount="150.00", status=Listing.PUBLISHED,
        )

    def test_checkout_creates_checkout_session_and_links_transaction(self):
        self._auth(self.customer, "customer")
        self.client.post("/api/cart/items/", {"listing": self.listing.id, "quantity": 1}, format="json")
        response = self.client.post("/api/orders/checkout/")
        self.assertEqual(response.status_code, 201, response.content)

        order = Order.objects.get(id=response.json()["id"])
        self.assertEqual(order.status, Order.PAID)

        session = CheckoutSession.objects.get(metadata__order_id=order.id)
        self.assertEqual(session.kind, CheckoutSession.ORDER_CHECKOUT)
        self.assertEqual(session.status, CheckoutSession.SUCCESS)
        self.assertEqual(session.provider, "simulated")
        self.assertIsNotNone(session.transaction)
        self.assertEqual(session.transaction.status, Transaction.SUCCESS)
        self.assertEqual(session.transaction.reference, session.reference)

    def test_response_is_not_a_redirect_in_simulated_mode(self):
        self._auth(self.customer, "customer")
        self.client.post("/api/cart/items/", {"listing": self.listing.id, "quantity": 1}, format="json")
        response = self.client.post("/api/orders/checkout/")
        self.assertNotIn("mode", response.json())


class EventPaySimulatedTests(ProcessPaymentSimulatedModeBase):
    def setUp(self):
        super().setUp()
        self.category = Category.objects.get(slug="festivals")
        self.zone = Zone.objects.get(name="Manhyia")

    def _make_event(self):
        return Event.objects.create(
            category=self.category, zone=self.zone, submitted_by_customer=self.customer,
            name="Akwasidae Festival", description="Royal durbar.", address="Manhyia Palace",
            event_date=timezone.now() + timezone.timedelta(days=30), visibility_days=14,
            status=Event.APPROVED,
        )

    def test_pay_creates_checkout_session_linked_to_transaction(self):
        event = self._make_event()
        self._auth(self.customer, "customer")
        response = self.client.post(f"/api/events/{event.id}/pay/")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertNotIn("mode", response.json())

        session = CheckoutSession.objects.get(metadata__event_id=event.id)
        self.assertEqual(session.kind, CheckoutSession.EVENT_PAY)
        self.assertEqual(session.status, CheckoutSession.SUCCESS)
        self.assertIsNotNone(session.transaction)
        event.refresh_from_db()
        self.assertIsNotNone(event.paid_at)


class TicketPurchaseSimulatedTests(ProcessPaymentSimulatedModeBase):
    def setUp(self):
        super().setUp()
        self.category = Category.objects.get(slug="festivals")
        self.zone = Zone.objects.get(name="Manhyia")
        self.event = Event.objects.create(
            category=self.category, zone=self.zone, submitted_by_customer=self.customer,
            name="Akwasidae Festival", description="Royal durbar.", address="Manhyia Palace",
            event_date=timezone.now() + timezone.timedelta(days=30), visibility_days=14,
            status=Event.APPROVED, paid_at=timezone.now(),
            expires_at=timezone.now() + timezone.timedelta(days=14),
        )
        self.ticket_type = EventTicketType.objects.create(
            event=self.event, name="General", price="25.00", quantity_total=10,
        )
        self.buyer = Customer.objects.create(
            full_name="Yaw Buyer", phone="+233200990002", password_hash="x",
        )

    def test_purchase_creates_tickets_transaction_and_reserves_inventory(self):
        self._auth(self.buyer, "customer")
        response = self.client.post(
            f"/api/events/{self.event.id}/tickets/purchase/",
            {"ticket_type": self.ticket_type.id, "quantity": 2},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        tickets = response.json()
        self.assertEqual(len(tickets), 2)

        self.ticket_type.refresh_from_db()
        self.assertEqual(self.ticket_type.quantity_sold, 2)

        session = CheckoutSession.objects.get(metadata__ticket_type_id=self.ticket_type.id)
        self.assertEqual(session.kind, CheckoutSession.TICKET_PURCHASE)
        self.assertEqual(session.status, CheckoutSession.SUCCESS)
        self.assertIsNotNone(session.transaction)
        self.assertEqual(str(session.amount), "50.00")

        db_tickets = Ticket.objects.filter(ticket_type=self.ticket_type)
        self.assertEqual(db_tickets.count(), 2)
        for ticket in db_tickets:
            self.assertEqual(ticket.transaction, session.transaction)
            self.assertEqual(ticket.escrow_status, Ticket.HELD)

    def test_purchase_exceeding_inventory_is_rejected_and_does_not_reserve(self):
        self._auth(self.buyer, "customer")
        response = self.client.post(
            f"/api/events/{self.event.id}/tickets/purchase/",
            {"ticket_type": self.ticket_type.id, "quantity": 11},
            format="json",
        )
        self.assertEqual(response.status_code, 400, response.content)
        self.ticket_type.refresh_from_db()
        self.assertEqual(self.ticket_type.quantity_sold, 0)
        self.assertFalse(CheckoutSession.objects.exists())


class TransactionMineSimulatedTests(ProcessPaymentSimulatedModeBase):
    def setUp(self):
        super().setUp()
        self.plan = SubscriptionPlan.objects.create(
            tier="product_basic_test", name="Basic", kind=SubscriptionPlan.KIND_PRODUCT,
            monthly_price="20.00", status=SubscriptionPlan.ACTIVE_STATUS,
        )

    def test_create_applies_subscription_via_metadata(self):
        self._auth(self.owner, "business_owner")
        response = self.client.post(
            "/api/billing/transactions/mine/",
            {
                "kind": "subscription",
                "amount": "20.00",
                "purpose": "AshantiHub Basic Plan — 1 month",
                "metadata": {"plan": self.plan.tier, "cycle_months": 1},
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)

        session = CheckoutSession.objects.get(business_owner=self.owner)
        self.assertEqual(session.kind, CheckoutSession.SUBSCRIPTION)
        self.assertEqual(session.status, CheckoutSession.SUCCESS)

        subscription = Subscription.objects.get(business_owner=self.owner)
        self.assertEqual(subscription.plan, self.plan)
        self.assertEqual(subscription.status, Subscription.ACTIVE)

    def test_create_without_metadata_still_books_transaction(self):
        # metadata is optional — a subscription-kind transaction with no
        # plan/cycle_months in metadata just doesn't activate a subscription
        # (the finalizer no-ops), but the Transaction itself is still booked.
        self._auth(self.owner, "business_owner")
        response = self.client.post(
            "/api/billing/transactions/mine/",
            {"kind": "subscription", "amount": "20.00", "purpose": "AshantiHub Basic Plan"},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        self.assertFalse(Subscription.objects.filter(business_owner=self.owner).exists())
