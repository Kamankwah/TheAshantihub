from datetime import datetime
from decimal import Decimal
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


FEE = {"total": "15.00", "lines": [], "distance_km": "3", "distance_basis": "test"}
PIN = "&lat=6.69&lng=-1.62"


def fee_patch():
    return mock.patch("delivery.rates.checkout_fee", lambda items, lat, lng, **kw: (None, dict(FEE)))


class DeliveryPreviewFeeTests(AfterHoursStampTests):
    """The preview also says the delivery fee checkout will add, with promotions off (3F follow-up)."""

    def preview(self, query="fulfilment=door_to_door" + PIN):
        cart, _ = Cart.objects.get_or_create(customer=self.customer)
        if not cart.items.exists():
            CartItem.objects.create(cart=cart, listing=self.listing_a, quantity=1, unit_price_snapshot="150.00")
        with mock.patch("django.utils.timezone.now", return_value=accra(19, 12)):
            return self.client.get(f"/api/orders/delivery-preview/?{query}")

    @override_settings(DELIVERY_FEE_ENABLED=True)
    def test_preview_gives_the_fee_checkout_will_add(self):
        with fee_patch():
            delivery = self.preview().data["delivery"]
            self.assertEqual((delivery["fee"], delivery["fee_status"], delivery["waived"]), ("15.00", "ok", False))
            Cart.objects.get(customer=self.customer).items.all().delete()
            CartItem.objects.create(cart=Cart.objects.get(customer=self.customer), listing=self.listing_a, quantity=1, unit_price_snapshot="150.00")
            with mock.patch("django.utils.timezone.now", return_value=accra(19, 12)):
                response = self.client.post("/api/orders/checkout/", {
                    "delivery_method": "door_to_door", "delivery_address": "12 Ash Road", "delivery_phone": "+233200662001",
                    "delivery_lat": 6.69, "delivery_lng": -1.62}, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(Decimal(str(response.data["delivery_fee"])), Decimal(delivery["fee"]))
        self.assertEqual(Decimal(str(response.data["total_amount"])), Decimal("150.00") + Decimal(delivery["fee"]))

    @override_settings(DELIVERY_FEE_ENABLED=True)
    def test_preview_delivery_is_null_for_store_pickup_or_with_fees_off(self):
        with fee_patch():
            self.assertIsNone(self.preview("fulfilment=store_pickup" + PIN).data["delivery"])
        with override_settings(DELIVERY_FEE_ENABLED=False), fee_patch():
            response = self.preview()
        self.assertIsNone(response.data["delivery"])
        self.assertIn("deferred", response.data)

    @override_settings(DELIVERY_FEE_ENABLED=True)
    def test_preview_without_a_pin_says_needs_location(self):
        # A rate card is in force but the cart has no delivery pin to measure to.
        with mock.patch("delivery.rates.checkout_fee", return_value=None), mock.patch("delivery.config.live", return_value=object()):
            response = self.preview("fulfilment=door_to_door")
        self.assertEqual(response.data["delivery"]["fee"], None)
        self.assertEqual(response.data["delivery"]["fee_status"], "needs_location")

    @override_settings(DELIVERY_FEE_ENABLED=True, MARKETING_PROMOS_ENABLED=True)
    def test_cart_quote_delivery_block_is_unchanged_by_the_move(self):
        cart, _ = Cart.objects.get_or_create(customer=self.customer)
        CartItem.objects.create(cart=cart, listing=self.listing_a, quantity=1, unit_price_snapshot="150.00")
        body = {"delivery_method": "door_to_door", "delivery_lat": 6.69, "delivery_lng": -1.62}
        with fee_patch():
            block = self.client.post("/api/marketing/cart/quote/", body, format="json").data["delivery"]
        self.assertEqual(list(block), ["fee", "fee_status", "waived", "waiver_name", "waived_fee", "mixed_note", "lines", "route"])
        self.assertEqual(dict(block), {"fee": "15.00", "fee_status": "ok", "waived": False, "waiver_name": None,
                                       "waived_fee": None, "mixed_note": None, "lines": [], "route": None})
        out = self.client.post("/api/marketing/cart/quote/", {**body, "delivery_lat": 0, "delivery_lng": 0}, format="json").data["delivery"]
        self.assertEqual((out["fee"], out["fee_status"]), (None, "out_of_area"))
        self.assertEqual(list(out), ["fee", "fee_status", "waived", "waiver_name", "waived_fee", "mixed_note", "message"])
