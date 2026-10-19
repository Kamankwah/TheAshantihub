"""The server refuses shopper (Customer) checkout, booking, ticket purchase and service/event charge before opening.
Real time is before the 6 Nov 2026 opening, so no clock freezing is needed; "after opening" moves the row into the past."""
from datetime import timedelta

from django.test import override_settings
from django.utils import timezone

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, Customer
from accounts.testing import make_staff
from bookings.models import Booking
from bookings.tests.test_bookings import BookingTestsBase
from cart.models import CartItem
from events.models import Event, EventTicketType, Ticket
from listings.models import Category, Listing, Zone
from orders.models import Order
from orders.tests.test_checkout import CheckoutTestsBase
from storefront.models import TestAccount
from storefront import opening
from storefront.testing import close_marketplace, open_marketplace

GATE_ON = override_settings(MARKETPLACE_GATE_ENABLED=True)


def assert_not_open(test, response):
    test.assertEqual(response.status_code, 403, response.content)
    body = response.json()
    test.assertEqual(body["code"], "not_open")
    test.assertEqual(body["detail"], opening.opening_message(opening.opens_at()))
    test.assertEqual(body["opens_at"], opening.opens_at().isoformat())


@GATE_ON
class CheckoutGateTests(CheckoutTestsBase):
    def setUp(self):
        super().setUp()
        close_marketplace()

    def test_customer_checkout_refused_before_opening(self):
        self.listing_a.stock_quantity = 5
        self.listing_a.save(update_fields=["stock_quantity"])
        self._auth(self.customer)
        self.assertEqual(self._add_to_cart(self.listing_a, 2).status_code, 201)  # cart add is browse state
        response = self.client.post("/api/orders/checkout/")
        assert_not_open(self, response)
        self.assertFalse(Order.objects.exists())
        self.listing_a.refresh_from_db()
        self.assertEqual(self.listing_a.stock_quantity, 5)  # no stock decrement
        self.assertTrue(CartItem.objects.filter(cart__customer=self.customer).exists())

    def test_cart_add_still_allowed_before_opening(self):
        self._auth(self.customer)
        self.assertEqual(self._add_to_cart(self.listing_a, 1).status_code, 201)

    def test_anonymous_still_gets_401_first(self):
        self.assertEqual(self.client.post("/api/orders/checkout/").status_code, 401)

    def test_allowlisted_customer_can_checkout_before_opening(self):
        admin = make_staff("super_admin", "root-gate@example.com")
        TestAccount.objects.create(customer=self.customer, added_by=admin)
        self._auth(self.customer)
        self._add_to_cart(self.listing_a, 1)
        self.assertEqual(self.client.post("/api/orders/checkout/").status_code, 201)

    def test_customer_checkout_works_after_opening(self):
        open_marketplace()
        self._auth(self.customer)
        self._add_to_cart(self.listing_a, 1)
        self.assertEqual(self.client.post("/api/orders/checkout/").status_code, 201)

    def test_business_owner_and_staff_unaffected(self):
        # Owners and staff hit the customer-only permission class, not the gate: the answer is the usual 403
        # for the wrong account type, never the not_open body.
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.owner, 'business_owner')}")
        response = self.client.post("/api/orders/checkout/")
        self.assertNotIn("not_open", response.content.decode())
        staff = make_staff("support", "esi-gate@example.com")
        self.assertTrue(opening.can_buy(self.owner))
        self.assertTrue(opening.can_buy(staff))


@GATE_ON
class BookingGateTests(BookingTestsBase):
    def setUp(self):
        super().setUp()
        close_marketplace()

    def test_customer_booking_refused_before_opening(self):
        response = self._book(self.customer, self._d(1), self._d(3))
        assert_not_open(self, response)
        self.assertFalse(Booking.objects.exists())

    def test_customer_booking_works_after_opening(self):
        open_marketplace()
        self.assertEqual(self._book(self.customer, self._d(1), self._d(3)).status_code, 201)


@GATE_ON
class TicketGateTests(CheckoutTestsBase):
    def setUp(self):
        super().setUp()
        close_marketplace()
        self.event = Event.objects.create(
            category=Category.objects.get(slug="festivals"), zone=Zone.objects.get(name="Manhyia"),
            submitted_by_customer=self.other_customer, name="Akwasidae", description="D.", address="Manhyia",
            event_date=timezone.now() + timedelta(days=30), visibility_days=14, status=Event.APPROVED,
            paid_at=timezone.now(), expires_at=timezone.now() + timedelta(days=14),
        )
        self.ticket_type = EventTicketType.objects.create(
            event=self.event, name="Regular", price="50.00", quantity_total=10,
            delivery_method=EventTicketType.DELIVERY_METHOD_CHOICES[0][0],
        )

    def _buy(self):
        return self.client.post(
            f"/api/events/{self.event.id}/tickets/purchase/",
            {"ticket_type": self.ticket_type.id, "quantity": 1}, format="json",
        )

    def test_customer_ticket_purchase_refused_before_opening(self):
        self._auth(self.customer)
        assert_not_open(self, self._buy())
        self.assertFalse(Ticket.objects.exists())
        self.ticket_type.refresh_from_db()
        self.assertEqual(self.ticket_type.quantity_sold, 0)

    def test_customer_ticket_purchase_works_after_opening(self):
        open_marketplace()
        self._auth(self.customer)
        self.assertEqual(self._buy().status_code, 201)


@GATE_ON
class ServicePayGateTests(CheckoutTestsBase):
    def setUp(self):
        super().setUp()
        close_marketplace()

    def test_service_request_pay_refused_before_opening(self):
        # The gate runs before the object lookup, so even an unknown id answers not_open.
        self._auth(self.customer)
        assert_not_open(self, self.client.post("/api/services/requests/999999/pay/"))


class MeCanBuyTests(CheckoutTestsBase):
    def setUp(self):
        super().setUp()
        close_marketplace()

    def _me(self, account, kind):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(account, kind)}")
        return self.client.get("/api/accounts/me/").json()

    @GATE_ON
    def test_me_reports_can_buy(self):
        self.assertFalse(self._me(self.customer, "customer")["can_buy"])
        admin = make_staff("super_admin", "root-me@example.com")
        TestAccount.objects.create(customer=self.other_customer, added_by=admin)
        self.assertTrue(self._me(self.other_customer, "customer")["can_buy"])
        self.assertTrue(self._me(self.owner, "business_owner")["can_buy"])
        open_marketplace()
        self.assertTrue(self._me(self.customer, "customer")["can_buy"])

    def test_me_can_buy_true_while_gate_off(self):
        self.assertTrue(self._me(self.customer, "customer")["can_buy"])
