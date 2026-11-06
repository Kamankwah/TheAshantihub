"""Review findings BE-07, BE-08, BE-17: what happens to a Hubtel checkout that is paid late, paid after cancel, or never paid."""
from datetime import timedelta

from django.test import override_settings
from django.utils import timezone

from accounts.models import BusinessOwner
from cart.models import Cart, CartItem
from listings.models import Category, Listing, Zone
from orders.models import Order, OrderItem
from payments.models import CheckoutSession, WebhookEvent
from payments.tasks import expire_stale_checkouts
from payments.tests.test_webhook import WEBHOOK_SECRET, WebhookProcessingTests


@override_settings(HUBTEL_WEBHOOK_SECRET=WEBHOOK_SECRET)
class CheckoutLifecycleTests(WebhookProcessingTests):
    def setUp(self):
        super().setUp()
        owner = BusinessOwner.objects.create(full_name="Kofi", login_phone="+233207661001", password_hash="x")
        shops = Category.objects.get(slug="shops")
        zone = Zone.objects.get(name="Manhyia")
        self.listing = Listing.objects.create(
            business_owner=owner, category=shops, zone=zone, name="Lamp", description="D.",
            contact_phone="+233207661001", price_amount="150.00", status=Listing.PUBLISHED, stock_quantity=5,
        )
        self.other = Listing.objects.create(
            business_owner=owner, category=shops, zone=zone, name="Desk", description="D.",
            contact_phone="+233207661001", price_amount="80.00", status=Listing.PUBLISHED,
        )

    def _order_session(self, reserved=2):
        order, session = self._make_pending_order_session()
        OrderItem.objects.create(
            order=order, listing=self.listing, quantity=reserved, unit_price="75.00", line_total=f"{reserved * 75}.00",
        )
        # Checkout reserved the stock up front.
        Listing.objects.filter(pk=self.listing.pk).update(stock_quantity=5 - reserved)
        session.metadata = {
            "order_id": order.id,
            "stock_reservations": [{"listing_id": self.listing.pk, "variant_id": None, "quantity": reserved}],
        }
        session.save(update_fields=["metadata"])
        return order, session

    def _pay(self, session):
        return self._post({"ClientReference": session.reference, "Status": "Success", "Amount": 150.00})

    # BE-08
    def test_a_paid_order_clears_the_lines_it_bought_and_keeps_the_rest(self):
        order, session = self._order_session()
        cart = Cart.objects.create(customer=self.customer)
        CartItem.objects.create(cart=cart, listing=self.listing, quantity=2, unit_price_snapshot="75.00")
        CartItem.objects.create(cart=cart, listing=self.other, quantity=1, unit_price_snapshot="80.00")
        self.assertEqual(self._pay(session).status_code, 200)
        self.assertEqual(list(cart.items.values_list("listing_id", flat=True)), [self.other.pk])

    # BE-17
    def test_payment_for_a_cancelled_order_does_not_revive_it_or_return_stock_twice(self):
        order, session = self._order_session(reserved=2)
        # The cancel already put the 2 units back.
        Order.objects.filter(pk=order.pk).update(status=Order.CANCELLED)
        Listing.objects.filter(pk=self.listing.pk).update(stock_quantity=5)
        response = self._pay(session)
        self.assertEqual(response.status_code, 200, response.content)
        order.refresh_from_db(); session.refresh_from_db(); self.listing.refresh_from_db()
        self.assertEqual(order.status, Order.CANCELLED)
        self.assertEqual(session.status, CheckoutSession.FAILED)
        self.assertEqual(session.metadata["not_applied"], "order_cancelled")
        self.assertEqual(self.listing.stock_quantity, 5)  # not 7
        self.assertIn("refund by hand", WebhookEvent.objects.latest("pk").processing_note)

    # BE-07
    def test_a_late_payment_on_an_expired_session_is_flagged_and_changes_nothing(self):
        order, session = self._order_session()
        CheckoutSession.objects.filter(pk=session.pk).update(status=CheckoutSession.EXPIRED)
        with self.assertLogs("payments.views", level="ERROR"):
            response = self._pay(session)
        self.assertEqual(response.status_code, 200)
        order.refresh_from_db()
        self.assertEqual(order.status, Order.PENDING)
        self.assertIn("PAID LATE", WebhookEvent.objects.latest("pk").processing_note)

    def test_the_reaper_expires_old_pending_sessions_and_returns_their_stock_once(self):
        order, session = self._order_session(reserved=2)
        CheckoutSession.objects.filter(pk=session.pk).update(created_at=timezone.now() - timedelta(hours=3))
        self.assertEqual(expire_stale_checkouts(), 1)
        session.refresh_from_db(); self.listing.refresh_from_db()
        self.assertEqual(session.status, CheckoutSession.EXPIRED)
        self.assertEqual(self.listing.stock_quantity, 5)
        self.assertEqual(expire_stale_checkouts(), 0)  # a second run is a no-op
        self.listing.refresh_from_db()
        self.assertEqual(self.listing.stock_quantity, 5)

    def test_the_reaper_leaves_recent_and_resolved_sessions_alone(self):
        _, recent = self._order_session()
        _, paid = self._make_pending_order_session()
        CheckoutSession.objects.filter(pk=paid.pk).update(
            status=CheckoutSession.SUCCESS, created_at=timezone.now() - timedelta(hours=9),
        )
        self.assertEqual(expire_stale_checkouts(), 0)
        recent.refresh_from_db()
        self.assertEqual(recent.status, CheckoutSession.PENDING)


class HubtelStartOutsideTransactionTests(CheckoutLifecycleTests.__bases__[0]):
    """BE-06: the Hubtel HTTP call is made after the checkout transaction commits, and a failure puts the stock back."""

    def setUp(self):
        from rest_framework.test import APIClient

        from accounts.authentication import issue_token

        super().setUp()
        owner = BusinessOwner.objects.create(full_name="Kofi", login_phone="+233207661009", password_hash="x")
        self.listing = Listing.objects.create(
            business_owner=owner, category=Category.objects.get(slug="shops"), zone=Zone.objects.get(name="Manhyia"),
            name="Lamp", description="D.", contact_phone="+233207661009", price_amount="150.00",
            status=Listing.PUBLISHED, stock_quantity=5,
        )
        self.api = APIClient()
        self.api.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.customer, 'customer')}")
        self.api.post("/api/cart/items/", {"listing": self.listing.pk, "quantity": 2}, format="json")

    @override_settings(PAYMENTS_PROVIDER="hubtel", HUBTEL_CLIENT_ID="id", HUBTEL_CLIENT_SECRET="secret")
    def test_hubtel_is_called_with_no_open_transaction_and_returns_the_link(self):
        from django.db import connection
        from unittest import mock

        seen = {}

        def fake(session):
            seen["depth"] = len(connection.savepoint_ids)
            return {"checkout_url": "https://pay.example/x", "checkout_id": "c1"}

        baseline = len(connection.savepoint_ids)  # TestCase holds its own outer transaction
        with mock.patch("payments.hubtel_client.create_checkout", side_effect=fake):
            response = self.api.post("/api/orders/checkout/", {}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["checkout_url"], "https://pay.example/x")
        self.assertEqual(seen["depth"], baseline, "Hubtel was called inside the checkout's own atomic block")
        self.assertEqual(Order.objects.get().status, Order.PENDING)
        self.assertTrue(CartItem.objects.exists())  # the cart is cleared when the payment lands, not now

    @override_settings(PAYMENTS_PROVIDER="hubtel", HUBTEL_CLIENT_ID="id", HUBTEL_CLIENT_SECRET="secret")
    def test_a_hubtel_failure_returns_503_cancels_the_order_and_restores_stock(self):
        from unittest import mock

        with mock.patch("payments.hubtel_client.create_checkout", side_effect=ConnectionError("down")):
            response = self.api.post("/api/orders/checkout/", {}, format="json")
        self.assertEqual(response.status_code, 503, response.content)
        self.assertEqual(response.json()["code"], "payment_unavailable")
        order = Order.objects.get()
        session = CheckoutSession.objects.get()
        self.listing.refresh_from_db()
        self.assertEqual(order.status, Order.CANCELLED)
        self.assertEqual(session.status, CheckoutSession.FAILED)
        self.assertEqual(self.listing.stock_quantity, 5)
