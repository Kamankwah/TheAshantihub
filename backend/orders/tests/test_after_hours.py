from datetime import datetime
from unittest import mock

from django.test import override_settings

from accounts import hours
from accounts.hours import ACCRA
from accounts.models import BusinessOwner
from cart.models import Cart, CartItem
from listings.models import Listing
from orders.models import Order

from .test_checkout import CheckoutTestsBase

DAYS = [{"weekday": d, "closed": False, "opens": "09:00", "closes": "17:00"} for d in range(7)]


def accra(d, hh, mm=0):
    return datetime(2026, 10, d, hh, mm, tzinfo=ACCRA)


class AfterHoursStampTests(CheckoutTestsBase):
    def setUp(self):
        super().setUp()
        self.owner2 = BusinessOwner.objects.create(full_name="Esi Trader", login_phone="+233207662009", password_hash="x")
        self.listing_c = Listing.objects.create(
            business_owner=self.owner2, category=self.shops, zone=self.manhyia, name="Item C", description="D.",
            contact_phone="+233207662009", price_amount="10.00", status=Listing.PUBLISHED,
        )
        hours.set_week(self.owner, DAYS)
        self._auth(self.customer)

    def checkout(self, now, listings=None, method="door_to_door"):
        cart, _ = Cart.objects.get_or_create(customer=self.customer)
        for listing in listings or [self.listing_a]:
            CartItem.objects.create(cart=cart, listing=listing, quantity=1, unit_price_snapshot=listing.price_amount)
        body = {"delivery_method": method}
        if method == "door_to_door":
            body.update(delivery_address="12 Ash Road", delivery_phone="+233200662001")
        with mock.patch("django.utils.timezone.now", return_value=now):
            response = self.client.post("/api/orders/checkout/", body, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        return Order.objects.get(pk=response.data["id"]), response

    def test_order_after_closing_is_stamped_next_open(self):
        order, response = self.checkout(accra(19, 20))
        self.assertEqual(order.ready_not_before, accra(20, 9))
        self.assertIsNotNone(response.data["ready_not_before"])

    def test_multi_vendor_uses_latest_open(self):
        hours.set_week(self.owner2, [{**d, "opens": "11:00", "closes": "17:00"} for d in DAYS])
        order, _ = self.checkout(accra(19, 20), [self.listing_a, self.listing_c])
        self.assertEqual(order.ready_not_before, accra(20, 11))

    def test_open_order_not_stamped(self):
        order, response = self.checkout(accra(19, 12))
        self.assertIsNone(order.ready_not_before)
        self.assertIsNone(response.data["ready_not_before"])

    def test_vendor_with_no_hours_and_platform_open_is_not_stamped(self):
        order, _ = self.checkout(accra(19, 12), [self.listing_c])
        self.assertIsNone(order.ready_not_before)

    def test_vendor_hours_edit_does_not_move_placed_order(self):
        order, _ = self.checkout(accra(19, 20))
        hours.set_week(self.owner, [{**d, "opens": "06:00", "closes": "23:00"} for d in DAYS])
        order.refresh_from_db()
        self.assertEqual(order.ready_not_before, accra(20, 9))

    def test_store_pickup_is_stamped_for_the_pickup_clock(self):
        order, _ = self.checkout(accra(19, 20), method="store_pickup")
        self.assertEqual(order.ready_not_before, accra(20, 9))

    @override_settings(MARKETING_PROMOS_ENABLED=True)
    def test_quote_reports_delivery_from(self):
        cart, _ = Cart.objects.get_or_create(customer=self.customer)
        CartItem.objects.create(cart=cart, listing=self.listing_a, quantity=1, unit_price_snapshot="150.00")
        with mock.patch("django.utils.timezone.now", return_value=accra(19, 20)):
            r = self.client.post("/api/marketing/cart/quote/", {"delivery_method": "door_to_door"}, format="json")
            pickup = self.client.post("/api/marketing/cart/quote/", {"delivery_method": "store_pickup"}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertTrue(r.data["deferred"])
        self.assertEqual(r.data["delivery_from"], "2026-10-20T09:00:00+00:00")
        self.assertFalse(pickup.data["deferred"])
        self.assertIsNone(pickup.data["delivery_from"])
        with mock.patch("django.utils.timezone.now", return_value=accra(19, 12)):
            r = self.client.post("/api/marketing/cart/quote/", {"delivery_method": "door_to_door"}, format="json")
        self.assertFalse(r.data["deferred"])
        self.assertIsNone(r.data["delivery_from"])


class AfterHoursBoundaryAndPreviewTests(AfterHoursStampTests):
    def preview(self, now, method="door_to_door"):
        cart, _ = Cart.objects.get_or_create(customer=self.customer)
        if not cart.items.exists():
            CartItem.objects.create(cart=cart, listing=self.listing_a, quantity=1, unit_price_snapshot="150.00")
        with mock.patch("django.utils.timezone.now", return_value=now):
            return self.client.get(f"/api/orders/delivery-preview/?fulfilment={method}")

    def test_exactly_at_opening_not_stamped(self):
        order, _ = self.checkout(accra(19, 9))
        self.assertIsNone(order.ready_not_before)

    def test_exactly_at_closing_stamped_to_next_opening(self):
        order, _ = self.checkout(accra(19, 17))
        self.assertEqual(order.ready_not_before, accra(20, 9))

    def test_hourless_business_after_platform_close_held_on_fallback(self):
        order, _ = self.checkout(accra(19, 21), [self.listing_c])
        self.assertEqual(order.ready_not_before, accra(20, 7))
        cart, _ = Cart.objects.get_or_create(customer=self.customer)
        CartItem.objects.create(cart=cart, listing=self.listing_c, quantity=1, unit_price_snapshot="10.00")
        with mock.patch("django.utils.timezone.now", return_value=accra(19, 21)):
            r = self.client.get("/api/orders/delivery-preview/?fulfilment=door_to_door")
        self.assertEqual(r.data["source"], "platform")
        self.assertTrue(r.data["deferred"])

    def test_preview_works_with_promos_off(self):
        r = self.preview(accra(19, 20))
        self.assertEqual(r.status_code, 200, r.content)
        self.assertTrue(r.data["deferred"])
        self.assertEqual(r.data["delivery_from"], "2026-10-20T09:00:00+00:00")
        self.assertEqual(r.data["delivered_from"], r.data["delivery_from"])
        self.assertEqual(r.data["source"], "business_hours")

    def test_preview_not_deferred_when_open_or_pickup(self):
        r = self.preview(accra(19, 12))
        self.assertFalse(r.data["deferred"])
        self.assertIsNone(r.data["delivery_from"])
        self.assertFalse(self.preview(accra(19, 20), "store_pickup").data["deferred"])

    def test_source_follows_the_vendor_that_sets_the_latest_time(self):
        # owner opens 09:00 tomorrow; owner2 has no hours (platform 07:00): owner sets the latest -> business_hours
        cart, _ = Cart.objects.get_or_create(customer=self.customer)
        CartItem.objects.create(cart=cart, listing=self.listing_a, quantity=1, unit_price_snapshot="150.00")
        CartItem.objects.create(cart=cart, listing=self.listing_c, quantity=1, unit_price_snapshot="10.00")
        r = self.preview(accra(19, 21))
        self.assertEqual(r.data["source"], "business_hours")
        # reverse: owner opens at 06:00 (earlier than platform 07:00) -> the hourless vendor sets it
        hours.set_week(self.owner, [{**d, "opens": "06:00", "closes": "17:00"} for d in DAYS])
        r = self.preview(accra(19, 21))
        self.assertEqual(r.data["source"], "platform")
        self.assertEqual(r.data["delivery_from"], "2026-10-20T07:00:00+00:00")

    def test_quote_carries_source(self):
        with override_settings(MARKETING_PROMOS_ENABLED=True), mock.patch("django.utils.timezone.now", return_value=accra(19, 20)):
            cart, _ = Cart.objects.get_or_create(customer=self.customer)
            CartItem.objects.create(cart=cart, listing=self.listing_a, quantity=1, unit_price_snapshot="150.00")
            r = self.client.post("/api/marketing/cart/quote/", {"delivery_method": "door_to_door"}, format="json")
        self.assertEqual(r.data["source"], "business_hours")
