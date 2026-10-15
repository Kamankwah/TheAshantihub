from datetime import timedelta
from decimal import Decimal

from django.db import transaction
from django.test import TestCase, override_settings
from django.utils import timezone

from accounts.models import BusinessOwner, Customer
from ledger import escrow, posting
from ledger.models import Account, Journal, MoneySetting, OrderFeeSnapshot
from listings.models import Category, Listing, Zone
from orders.models import Order, OrderItem


class OrderPaymentBase(TestCase):
    def setUp(self):
        self.customer = Customer.objects.create(full_name="Ama", phone="+233200990001", password_hash="x")
        self.shops = Category.objects.get(slug="shops")
        self.zone = Zone.objects.get(name="Manhyia")
        self.n = 0

    def owner(self, name):
        self.n += 1
        return BusinessOwner.objects.create(full_name=name, login_phone=f"+2332079900{self.n:02d}", password_hash="x")

    def listing(self, owner, price):
        self.n += 1
        return Listing.objects.create(
            business_owner=owner, category=self.shops, zone=self.zone, name=f"Item {self.n}", description="D.",
            contact_phone=owner.login_phone, price_amount=Decimal(price), status=Listing.PUBLISHED,
        )

    def order(self, lines, *, delivery=None, discount="0.00", total=None):
        """lines: [(listing, quantity)]. total defaults to a reconciling amount."""
        items_total = sum((l.price_amount * q for l, q in lines), Decimal("0.00"))
        paid = total if total is not None else items_total - Decimal(discount) + Decimal(delivery or "0.00")
        order = Order.objects.create(
            customer=self.customer, status=Order.PAID, total_amount=paid, discount_amount=discount,
            delivery_fee=delivery,
        )
        for listing, quantity in lines:
            OrderItem.objects.create(order=order, listing=listing, quantity=quantity, unit_price=listing.price_amount, line_total=listing.price_amount * quantity)
        return order

    def balance(self, kind, owner=None):
        return posting.account_for(kind, owner).balance


@override_settings(LEDGER_ENABLED=True)
class RecordOrderPaymentTests(OrderPaymentBase):
    def test_a_single_vendor_order_posts_pending_snapshot_and_clearing(self):
        kofi = self.owner("Kofi")
        order = self.order([(self.listing(kofi, "60.00"), 2)], delivery="10.00")        # items 120.00 + delivery 10.00
        journal = escrow.record_order_payment(order)
        self.assertEqual(journal.key, f"order-pay-{order.pk}")
        self.assertEqual(self.balance(Account.PROVIDER_CLEARING), 13000)
        self.assertEqual(self.balance(Account.VENDOR_PENDING, kofi), 12000)
        self.assertEqual(self.balance(Account.DELIVERY_PAYABLE, order), 1000)
        snap = OrderFeeSnapshot.objects.get(order=order)
        self.assertEqual((snap.base_pesewas, snap.computed_pesewas, snap.charged_pesewas), (12000, 500, 500))   # GHS 120 -> GHS 5 flat

    def test_each_vendor_in_a_mixed_cart_pays_their_own_fee(self):
        kofi, esi = self.owner("Kofi"), self.owner("Esi")
        order = self.order([(self.listing(kofi, "50.00"), 1), (self.listing(esi, "600.00"), 1)])
        escrow.record_order_payment(order)
        by_owner = {s.business_owner_id: s for s in OrderFeeSnapshot.objects.filter(order=order)}
        self.assertEqual(by_owner[kofi.pk].charged_pesewas, 50)       # 1% of GHS 50.00
        self.assertEqual(by_owner[esi.pk].charged_pesewas, 600)       # 1% of GHS 600.00
        self.assertEqual(self.balance(Account.VENDOR_PENDING, kofi), 5000)
        self.assertEqual(self.balance(Account.VENDOR_PENDING, esi), 60000)

    def test_a_coupon_is_a_platform_subsidy_not_a_vendor_cost(self):
        kofi = self.owner("Kofi")
        order = self.order([(self.listing(kofi, "100.00"), 1)], discount="10.00")        # customer pays 90.00
        escrow.record_order_payment(order)
        self.assertEqual(self.balance(Account.PROVIDER_CLEARING), 9000)
        self.assertEqual(self.balance(Account.PLATFORM_PROMO_SUBSIDY), 1000)
        self.assertEqual(self.balance(Account.VENDOR_PENDING, kofi), 10000)               # vendor still owed the full line
        self.assertEqual(OrderFeeSnapshot.objects.get(order=order).base_pesewas, 10000)

    def test_review_focus_an_order_that_does_not_reconcile_fails_and_leaves_nothing(self):
        kofi = self.owner("Kofi")
        order = self.order([(self.listing(kofi, "60.00"), 1)], total=Decimal("59.00"))    # short by GHS 1.00
        with self.assertRaises(posting.PostingError), transaction.atomic():
            escrow.record_order_payment(order)
        self.assertFalse(Journal.objects.exists())
        self.assertFalse(OrderFeeSnapshot.objects.exists())

    def test_review_focus_a_fully_discounted_order_writes_no_zero_lines(self):
        kofi = self.owner("Kofi")
        order = self.order([(self.listing(kofi, "20.00"), 1)], discount="20.00")           # customer pays 0.00
        escrow.record_order_payment(order)
        self.assertEqual(self.balance(Account.PLATFORM_PROMO_SUBSIDY), 2000)
        self.assertEqual(self.balance(Account.PROVIDER_CLEARING), 0)
        self.assertFalse(Journal.objects.get(key=f"order-pay-{order.pk}").lines.filter(amount=0).exists())

    def test_review_focus_recording_twice_posts_once(self):
        kofi = self.owner("Kofi")
        order = self.order([(self.listing(kofi, "60.00"), 1)])
        escrow.record_order_payment(order)
        self.assertIsNone(escrow.record_order_payment(order))
        self.assertEqual(Journal.objects.count(), 1)
        self.assertEqual(OrderFeeSnapshot.objects.filter(order=order).count(), 1)
        self.assertEqual(self.balance(Account.VENDOR_PENDING, kofi), 6000)

    def test_the_lifetime_cap_trims_and_then_stops_the_fee(self):
        MoneySetting.objects.create(key="fee_cap_pesewas", value=700, effective_from=timezone.now() - timedelta(days=1))
        kofi = self.owner("Kofi")
        listing = self.listing(kofi, "120.00")                                              # GHS 5.00 flat each
        charged = []
        for _ in range(3):
            order = self.order([(listing, 1)])
            escrow.record_order_payment(order)
            charged.append(OrderFeeSnapshot.objects.get(order=order).charged_pesewas)
        self.assertEqual(charged, [500, 200, 0])

    def test_review_focus_two_payments_for_one_vendor_never_exceed_the_cap(self):
        MoneySetting.objects.create(key="fee_cap_pesewas", value=500, effective_from=timezone.now() - timedelta(days=1))
        kofi = self.owner("Kofi")
        listing = self.listing(kofi, "120.00")
        for _ in range(2):
            escrow.record_order_payment(self.order([(listing, 1)]))
        total = sum(s.charged_pesewas for s in OrderFeeSnapshot.objects.filter(business_owner=kofi))
        self.assertEqual(total, 500)

    def test_a_zero_total_order_records_nothing_and_does_not_fail(self):
        kofi = self.owner("Kofi")
        order = self.order([(self.listing(kofi, "0.00"), 1)])
        self.assertIsNone(escrow.record_order_payment(order))
        self.assertIsNone(escrow.record_order_payment(order))
        self.assertFalse(Journal.objects.exists())
        self.assertFalse(OrderFeeSnapshot.objects.exists())


class DisabledTests(OrderPaymentBase):
    def test_nothing_is_recorded_while_the_ledger_is_off(self):
        kofi = self.owner("Kofi")
        order = self.order([(self.listing(kofi, "60.00"), 1)])
        self.assertIsNone(escrow.record_order_payment(order))
        self.assertFalse(Journal.objects.exists())
        self.assertFalse(OrderFeeSnapshot.objects.exists())


@override_settings(LEDGER_ENABLED=True)
class CheckoutHookTests(OrderPaymentBase):
    def test_a_simulated_checkout_records_the_payment(self):
        from rest_framework.test import APIClient

        from accounts.authentication import issue_token

        kofi = self.owner("Kofi")
        listing = self.listing(kofi, "60.00")
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.customer, 'customer')}")
        added = client.post("/api/cart/items/", {"listing": listing.id, "quantity": 2}, format="json")
        self.assertIn(added.status_code, (200, 201), added.content)
        response = client.post("/api/orders/checkout/")
        self.assertEqual(response.status_code, 201, response.content)
        order = Order.objects.get(pk=response.json()["id"])
        self.assertTrue(Journal.objects.filter(key=f"order-pay-{order.pk}").exists())
        self.assertEqual(self.balance(Account.VENDOR_PENDING, kofi), 12000)

    def test_a_free_pickup_checkout_still_succeeds(self):
        from rest_framework.test import APIClient

        from accounts.authentication import issue_token

        kofi = self.owner("Kofi")
        listing = self.listing(kofi, "0.00")
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.customer, 'customer')}")
        client.post("/api/cart/items/", {"listing": listing.id, "quantity": 1}, format="json")
        response = client.post("/api/orders/checkout/")
        self.assertEqual(response.status_code, 201, response.content)
        self.assertFalse(Journal.objects.exists())
