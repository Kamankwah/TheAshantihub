"""Review finding BE-05: a repeated or racing checkout must not buy the same cart twice."""
from unittest import mock

from cart.models import CartItem
from orders.models import Order, OrderItem
from orders.tests.test_checkout import CheckoutTestsBase
from orders.views import OrderCheckoutView


class CheckoutIdempotencyTests(CheckoutTestsBase):
    def checkout(self, **body):
        return self.client.post("/api/orders/checkout/", body, format="json")

    def test_the_same_request_id_returns_the_first_order_and_makes_no_second(self):
        self._auth(self.customer)
        self._add_to_cart(self.listing_a, 1)
        first = self.checkout(request_id="req-1")
        self.assertEqual(first.status_code, 201, first.content)
        # The shopper's retry arrives after the cart was refilled (or the response was lost): still one order.
        self._add_to_cart(self.listing_b, 1)
        second = self.checkout(request_id="req-1")
        self.assertEqual(second.status_code, 200, second.content)
        self.assertEqual(second.json()["id"], first.json()["id"])
        self.assertEqual(Order.objects.filter(customer=self.customer).count(), 1)
        self.assertTrue(CartItem.objects.filter(cart__customer=self.customer, listing=self.listing_b).exists())

    def test_a_different_request_id_is_a_new_checkout(self):
        self._auth(self.customer)
        self._add_to_cart(self.listing_a, 1)
        self.assertEqual(self.checkout(request_id="req-1").status_code, 201)
        self._add_to_cart(self.listing_b, 1)
        self.assertEqual(self.checkout(request_id="req-2").status_code, 201)
        self.assertEqual(Order.objects.filter(customer=self.customer).count(), 2)

    def test_request_ids_are_per_customer(self):
        self._auth(self.customer)
        self._add_to_cart(self.listing_a, 1)
        self.assertEqual(self.checkout(request_id="same").status_code, 201)
        self._auth(self.other_customer)
        self._add_to_cart(self.listing_b, 1)
        other = self.checkout(request_id="same")
        self.assertEqual(other.status_code, 201, other.content)
        self.assertEqual(Order.objects.count(), 2)

    def test_a_race_lost_at_the_unique_constraint_replays_the_winner(self):
        # Two copies pass the "already exists?" look-up together; the second insert hits the constraint.
        self._auth(self.customer)
        self._add_to_cart(self.listing_a, 1)
        first = self.checkout(request_id="req-race")
        self.assertEqual(first.status_code, 201)
        self._add_to_cart(self.listing_a, 1)
        real_filter = Order.objects.filter
        calls = {"n": 0}

        def blind_first_lookup(*a, **kw):
            calls["n"] += 1
            return Order.objects.none() if calls["n"] == 1 else real_filter(*a, **kw)

        with mock.patch.object(Order.objects, "filter", side_effect=blind_first_lookup):
            second = self.checkout(request_id="req-race")
        self.assertEqual(second.status_code, 200, second.content)
        self.assertEqual(second.json()["id"], first.json()["id"])
        self.assertEqual(Order.objects.filter(customer=self.customer).count(), 1)

    def test_no_request_id_still_works(self):
        self._auth(self.customer)
        self._add_to_cart(self.listing_a, 1)
        self.assertEqual(self.checkout().status_code, 201)

    def test_a_cart_emptied_between_the_read_and_the_lock_is_refused(self):
        # Another tab checked out the same cart after this request read it.
        self._auth(self.customer)
        self._add_to_cart(self.listing_a, 1)
        original = OrderCheckoutView._signature

        def emptied_after_read(items):
            sig = original(items)
            CartItem.objects.filter(cart__customer=self.customer).delete()
            return sig

        with mock.patch.object(OrderCheckoutView, "_signature", staticmethod(emptied_after_read)):
            response = self.checkout()
        self.assertEqual(response.status_code, 400, response.content)
        self.assertFalse(Order.objects.exists())

    def test_a_cart_changed_between_the_read_and_the_lock_is_refused(self):
        self._auth(self.customer)
        self._add_to_cart(self.listing_a, 1)
        original = OrderCheckoutView._signature
        seen = {"n": 0}

        def changed_after_read(items):
            seen["n"] += 1
            sig = original(items)
            if seen["n"] == 1:
                CartItem.objects.filter(cart__customer=self.customer).update(quantity=5)
            return sig

        with mock.patch.object(OrderCheckoutView, "_signature", staticmethod(changed_after_read)):
            response = self.checkout()
        self.assertEqual(response.status_code, 409, response.content)
        self.assertEqual(response.json()["code"], "cart_changed")
        self.assertFalse(Order.objects.exists())
        self.assertFalse(OrderItem.objects.exists())


class CheckoutPriceRevalidationTests(CheckoutTestsBase):
    """Review BE-11: a price that moved since the line was added is shown to the shopper, never silently charged."""

    def checkout(self):
        return self.client.post("/api/orders/checkout/", {}, format="json")

    def test_a_price_that_rose_is_refused_once_then_charged_at_the_new_price(self):
        from listings.models import Listing

        self._auth(self.customer)
        self._add_to_cart(self.listing_a, 1)
        Listing.objects.filter(pk=self.listing_a.pk).update(price_amount="200.00")
        first = self.checkout()
        self.assertEqual(first.status_code, 409, first.content)
        body = first.json()
        self.assertEqual(body["code"], "price_changed")
        self.assertEqual((body["changes"][0]["was"], body["changes"][0]["now"]), ("150.00", "200.00"))
        self.assertFalse(Order.objects.exists())
        second = self.checkout()
        self.assertEqual(second.status_code, 201, second.content)
        self.assertEqual(str(Order.objects.get().total_amount), "200.00")

    def test_an_unchanged_price_checks_out_straight_away(self):
        self._auth(self.customer)
        self._add_to_cart(self.listing_a, 2)
        self.assertEqual(self.checkout().status_code, 201)
