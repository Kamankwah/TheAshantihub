"""Texts to each business when an order is paid and when it is released, through the real checkout and Support's call
(vendor plan 4, Task 6). Review Focus 1 (each business its own, no customer detail, the fee never to the customer), 2 (a
text never stops the money) and 5 (ledger off)."""
from unittest import mock

from django.test import override_settings

from ledger import escrow, posting
from ledger.models import Account, Journal
from notifications.models import Notification
from orders.models import Order
from otp import senders
from wallets.models import VendorText

from .vendor_helpers import VendorBase, paid_order, release, signed_in, waived

DOWN = senders.Delivery(ok=False, provider="hubtel")


def paid_body(order_id, items, fee, due):
    return (f"AshantiHub: order #{order_id} paid. Items GHS {items}, platform fee GHS {fee}, due to you GHS {due} after "
            "hand-over and Support's check.")


class CheckoutBase(VendorBase):
    def setUp(self):
        super().setUp()
        self.kofi_item = self.kofi.listing("120.00")
        self.esi_item = self.esi.listing("600.00")
        self.shopper = signed_in(self.buyer, "customer")

    def checkout(self, *lines):
        for listing, quantity in lines:
            added = self.shopper.post("/api/cart/items/", {"listing": listing.id, "quantity": quantity}, format="json")
            self.assertIn(added.status_code, (200, 201), added.content)
        with self.captureOnCommitCallbacks(execute=True):
            response = self.shopper.post("/api/orders/checkout/", {}, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        return response


class LedgerOffTests(CheckoutBase):
    def test_review_focus_with_the_ledger_off_nothing_is_texted_and_the_notice_is_as_before(self):
        self.checkout((self.kofi_item, 1))
        self.assertEqual(senders.sms_outbox, [])
        self.assertFalse(VendorText.objects.exists())
        self.assertNotIn("Platform fee", Notification.objects.get(business_owner=self.kofi.owner).body)


@override_settings(LEDGER_ENABLED=True)
class PaidTextTests(CheckoutBase):
    def test_review_focus_each_business_is_texted_its_own_subtotal_fee_and_amount_due(self):
        order_id = self.checkout((self.kofi_item, 1), (self.esi_item, 1)).json()["id"]
        self.assertEqual(sorted((text.to, text.body) for text in senders.sms_outbox), [
            ("+233201110001", paid_body(order_id, "120.00", "5.00", "115.00")),
            ("+233201110002", paid_body(order_id, "600.00", "6.00", "594.00")),
        ])
        for text in senders.sms_outbox:
            for detail in ("Ama Buyer", "241110001"):
                self.assertNotIn(detail, text.body)

    def test_the_new_order_notice_is_the_in_app_copy(self):
        self.checkout((self.kofi_item, 1))
        notice = Notification.objects.get(business_owner=self.kofi.owner)                       # one notice, not two
        self.assertEqual(notice.kind, Notification.NEW_ORDER)
        self.assertIn("Platform fee GHS 5.00; due to you GHS 115.00", notice.body)
        self.assertEqual(VendorText.objects.get(business_owner=self.kofi.owner).notification_id, notice.pk)

    def test_review_focus_the_customer_never_sees_the_platform_fee(self):
        response = self.checkout((self.kofi_item, 1))
        order_id = response.json()["id"]
        self.assertNotIn("platform", response.content.decode().lower())
        self.assertNotIn("platform", self.shopper.get(f"/api/orders/{order_id}/").content.decode().lower())
        self.assertFalse(Notification.objects.filter(customer=self.buyer, body__icontains="platform").exists())
        self.assertNotIn("+233241110001", [text.to for text in senders.sms_outbox])

    def test_review_focus_a_text_that_cannot_be_queued_never_stops_the_payment(self):
        with mock.patch.object(VendorText.objects, "get_or_create", side_effect=RuntimeError("down")), \
                self.assertLogs("wallets.vendor_texts", "ERROR"):
            response = self.checkout((self.kofi_item, 1))
        order = Order.objects.get(pk=response.json()["id"])
        self.assertEqual(order.status, Order.PAID)
        self.assertTrue(Journal.objects.filter(key=escrow.pay_key(order)).exists())
        self.assertIn("Platform fee", Notification.objects.get(business_owner=self.kofi.owner).body)   # the copy stays

    def test_review_focus_a_provider_that_is_down_leaves_the_text_queued_for_a_retry(self):
        with mock.patch("wallets.vendor_texts.senders.deliver", return_value=DOWN):
            self.checkout((self.kofi_item, 1))
        text = VendorText.objects.get()
        self.assertEqual((text.status, text.attempts), (VendorText.QUEUED, 1))


@override_settings(LEDGER_ENABLED=True)
class ReleaseTextTests(VendorBase):
    def released(self, order):
        with self.captureOnCommitCallbacks(execute=True):
            release(order)

    def test_review_focus_the_release_text_says_what_reached_available(self):
        order = paid_order(self.buyer, [(self.kofi.listing("120.00"), 1)])
        self.released(order)
        body = f"AshantiHub: order #{order.pk} released. GHS 115.00 added to your Available balance after the GHS 5.00 platform fee."
        self.assertEqual([(text.to, text.body) for text in senders.sms_outbox], [("+233201110001", body)])
        notice = Notification.objects.get(business_owner=self.kofi.owner, kind="vendor_money")
        self.assertEqual((notice.title, notice.body), (f"Order #{order.pk} released", body))

    def test_a_free_delivery_promo_taken_at_release_is_in_the_text(self):
        order = paid_order(self.buyer, [(self.kofi.listing("120.00"), 1)], delivery="0.00")
        waived(self.kofi.owner, order, "15.00")
        self.released(order)
        self.assertTrue(senders.sms_outbox[-1].body.endswith(
            "after the GHS 5.00 platform fee. GHS 15.00 free-delivery promo was then taken from it."
        ))

    def test_review_focus_a_shared_order_texts_each_business_its_own_release(self):
        order = paid_order(self.buyer, [(self.kofi.listing("120.00"), 1), (self.esi.listing("600.00"), 1)])
        self.released(order)
        by_phone = {text.to: text.body for text in senders.sms_outbox}
        self.assertIn("GHS 115.00 added", by_phone["+233201110001"])
        self.assertIn("GHS 594.00 added", by_phone["+233201110002"])
        self.assertNotIn("594.00", by_phone["+233201110001"])

    def test_review_focus_a_text_that_cannot_be_queued_never_stops_a_release(self):
        order = paid_order(self.buyer, [(self.kofi.listing("120.00"), 1)])
        with mock.patch.object(VendorText.objects, "get_or_create", side_effect=RuntimeError("down")), \
                self.assertLogs("wallets.vendor_texts", "ERROR"):
            self.released(order)
        self.assertTrue(Journal.objects.filter(key=escrow.release_key(order)).exists())
        self.assertEqual(posting.balance_of(Account.VENDOR_AVAILABLE, self.kofi.owner), 11500)
        self.assertTrue(Notification.objects.filter(business_owner=self.kofi.owner, kind="vendor_money").exists())

    def test_a_release_is_texted_once(self):
        order = paid_order(self.buyer, [(self.kofi.listing("120.00"), 1)])
        self.released(order)
        self.assertIsNone(escrow.release_verified(order))
        self.assertEqual(VendorText.objects.filter(kind=VendorText.ORDER_RELEASED).count(), 1)
        self.assertEqual(len(senders.sms_outbox), 1)
