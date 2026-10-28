"""Checkout with variants: stock split per variant, label snapshot, oversell guard, rollback, fees, isolation."""
import threading
from decimal import Decimal

from django.core.cache import cache
from django.db import connection
from django.test import TestCase, TransactionTestCase, override_settings
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, Customer
from cart.models import Cart, CartItem
from ledger.models import OrderFeeSnapshot
from listings import variants
from listings.models import Category, Listing, ListingVariant, Zone
from orders.models import Order, OrderItem
from payments.models import CheckoutSession
from payments.services import finalize_failure


class VariantCheckoutBase:
    def setup_world(self):
        cache.clear()
        self.client = APIClient()
        self.owner = BusinessOwner.objects.create(full_name="Ama Bakes", login_phone="+233207884001", password_hash="x")
        self.customer = Customer.objects.create(full_name="Yaw", phone="+233200884001", password_hash="x")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.customer, 'customer')}")
        self.cake = self.make(self.owner, "Cake")
        self.vanilla = self.variant(self.cake, "Vanilla / 500 g", "25.00", 5)
        self.choc = self.variant(self.cake, "Chocolate / 500 g", "30.00", 4)

    def make(self, owner, name, price="10.00", stock=None):
        return Listing.objects.create(
            business_owner=owner, category=Category.objects.get(slug="shops"), zone=Zone.objects.get(name="Manhyia"),
            name=name, description="D.", contact_phone=owner.login_phone, price_amount=price, status=Listing.PUBLISHED,
            stock_quantity=stock,
        )

    def variant(self, listing, label, price, stock):
        row = ListingVariant.objects.create(listing=listing, label=label, price_amount=price, stock_quantity=stock)
        variants.sync_listing(listing)
        return row

    def put(self, row, quantity, customer=None):
        cart, _ = Cart.objects.get_or_create(customer=customer or self.customer)
        CartItem.objects.create(
            cart=cart, listing=row.listing, variant=row, quantity=quantity, unit_price_snapshot=row.effective_price,
        )

    def checkout(self, **body):
        return self.client.post("/api/orders/checkout/", body, format="json")


class VariantCheckoutTests(VariantCheckoutBase, TestCase):
    def setUp(self):
        self.setup_world()

    def test_checkout_splits_stock_per_variant_and_snapshots_the_label(self):
        self.put(self.vanilla, 2)
        self.put(self.choc, 1)
        response = self.checkout()
        self.assertEqual(response.status_code, 201, response.content)
        for row, left in ((self.vanilla, 3), (self.choc, 3)):
            row.refresh_from_db()
            self.assertEqual(row.stock_quantity, left)
        self.cake.refresh_from_db()
        self.assertEqual(self.cake.stock_quantity, 6)
        lines = {i.variant_id: i for i in OrderItem.objects.all()}
        self.assertEqual(lines[self.vanilla.pk].variant_label, "Vanilla / 500 g")
        self.assertEqual(str(lines[self.vanilla.pk].unit_price), "25.00")
        self.assertEqual(lines[self.choc.pk].variant_label, "Chocolate / 500 g")
        self.assertEqual(str(Order.objects.get().total_amount), "80.00")
        body = response.json()
        self.assertEqual({i["variant_label"] for i in body["items"]}, {"Vanilla / 500 g", "Chocolate / 500 g"})

    def test_an_untracked_variant_is_never_decremented(self):
        loose = self.variant(self.cake, "Mini", "5.00", None)
        self.put(loose, 3)
        self.assertEqual(self.checkout().status_code, 201)
        loose.refresh_from_db()
        self.assertIsNone(loose.stock_quantity)

    def test_oversell_guard_names_the_variant(self):
        self.put(self.vanilla, 6)
        response = self.checkout()
        self.assertEqual(response.status_code, 400, response.content)
        self.assertEqual(response.json()["detail"], "Only 5 of “Cake (Vanilla / 500 g)” left in stock.")
        self.vanilla.refresh_from_db()
        self.assertEqual(self.vanilla.stock_quantity, 5)
        self.assertFalse(Order.objects.exists())

    def test_failed_payment_returns_variant_stock_and_the_listing_total(self):
        self.put(self.vanilla, 2)
        self.put(self.choc, 1)
        self.assertEqual(self.checkout().status_code, 201)
        order = Order.objects.get()
        session = CheckoutSession.objects.get(metadata__order_id=order.pk)
        self.assertEqual(
            sorted((r["variant_id"], r["quantity"]) for r in session.metadata["stock_reservations"]),
            sorted([(self.vanilla.pk, 2), (self.choc.pk, 1)]),
        )
        finalize_failure(session)
        for row, stock in ((self.vanilla, 5), (self.choc, 4)):
            row.refresh_from_db()
            self.assertEqual(row.stock_quantity, stock)
        self.cake.refresh_from_db()
        self.assertEqual(self.cake.stock_quantity, 9)

    def test_old_reservation_without_variant_id_still_rolls_back(self):
        plain = self.make(self.owner, "Plain", stock=5)
        Listing.objects.filter(pk=plain.pk).update(stock_quantity=3)
        session = CheckoutSession.objects.create(
            kind=CheckoutSession.ORDER_CHECKOUT, customer=self.customer, amount=Decimal("10.00"), reference="old-1",
            metadata={"order_id": 0, "stock_reservations": [{"listing_id": plain.pk, "quantity": 2}]},
        )
        finalize_failure(session)
        plain.refresh_from_db()
        self.assertEqual(plain.stock_quantity, 5)

    def test_owner_orders_show_only_the_callers_variant_lines(self):
        other = BusinessOwner.objects.create(full_name="Kofi", login_phone="+233207884002", password_hash="x")
        pie = self.make(other, "Pie")
        slice_ = self.variant(pie, "Slice", "8.00", 10)
        self.put(self.vanilla, 1)
        self.put(slice_, 2)
        self.assertEqual(self.checkout().status_code, 201)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.owner, 'business_owner')}")
        rows = self.client.get("/api/orders/owner/").json()["results"]
        self.assertEqual(len(rows), 1)
        items = rows[0]["items"]
        self.assertEqual([(i["variant_label"], i["variant"]) for i in items], [("Vanilla / 500 g", self.vanilla.pk)])
        self.assertEqual(rows[0]["owner_subtotal"], "25.00")

    @override_settings(MARKETING_PROMOS_ENABLED=True)
    def test_promo_pricing_keeps_the_variant_on_the_order_line(self):
        self.put(self.vanilla, 2)
        response = self.checkout()
        self.assertEqual(response.status_code, 201, response.content)
        item = OrderItem.objects.get()
        self.assertEqual((item.variant_id, item.variant_label, str(item.unit_price)), (self.vanilla.pk, "Vanilla / 500 g", "25.00"))

    @override_settings(MARKETPLACE_GATE_ENABLED=True)
    def test_review_focus_the_opening_gate_still_refuses_shoppers(self):
        from storefront.testing import close_marketplace

        close_marketplace()
        self.put(self.vanilla, 1)
        response = self.checkout()
        self.assertEqual(response.status_code, 403, response.content)
        self.assertEqual(response.json()["code"], "not_open")
        self.vanilla.refresh_from_db()
        self.assertEqual(self.vanilla.stock_quantity, 5)
        self.assertFalse(Order.objects.exists())


@override_settings(LEDGER_ENABLED=True)
class VariantFeeTests(VariantCheckoutBase, TestCase):
    def setUp(self):
        self.setup_world()

    def snapshot_base(self, order):
        from collections import defaultdict

        sums = defaultdict(int)
        for snap in OrderFeeSnapshot.objects.filter(order=order):
            sums[(snap.business_owner_id, snap.category)] += snap.base_pesewas
        return dict(sums)

    def test_review_focus_fee_snapshot_for_two_variants_equals_one_line_of_the_same_total(self):
        self.put(self.vanilla, 2)   # 50.00
        self.put(self.choc, 1)      # 30.00  -> 80.00
        self.assertEqual(self.checkout().status_code, 201)
        first = Order.objects.get()
        with_variants = self.snapshot_base(first)
        solo = self.make(self.owner, "Solo", price="80.00")
        cart, _ = Cart.objects.get_or_create(customer=self.customer)
        CartItem.objects.create(cart=cart, listing=solo, quantity=1, unit_price_snapshot="80.00")
        self.assertEqual(self.checkout().status_code, 201)
        second = Order.objects.exclude(pk=first.pk).get()
        self.assertEqual(self.snapshot_base(second), with_variants)
        self.assertEqual(list(with_variants.values()), [8000])


class VariantRaceTests(VariantCheckoutBase, TransactionTestCase):
    serialized_rollback = True

    def setUp(self):
        self.setup_world()
        ListingVariant.objects.filter(pk=self.vanilla.pk).update(stock_quantity=1)
        self.second = Customer.objects.create(full_name="Esi", phone="+233200884002", password_hash="x")
        self.put(self.vanilla, 1)
        self.put(self.vanilla, 1, customer=self.second)

    def test_review_focus_two_checkouts_of_the_last_unit_one_wins(self):
        results, barrier = [], threading.Barrier(2)

        def run(customer):
            try:
                client = APIClient()
                client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(customer, 'customer')}")
                barrier.wait()
                results.append(client.post("/api/orders/checkout/", {}, format="json").status_code)
            finally:
                connection.close()

        threads = [threading.Thread(target=run, args=(c,)) for c in (self.customer, self.second)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=30)
            self.assertFalse(thread.is_alive(), "a racing checkout hung")
        self.assertEqual(sorted(results), [201, 400])
        self.vanilla.refresh_from_db()
        self.assertEqual(self.vanilla.stock_quantity, 0)
        self.assertEqual(Order.objects.count(), 1)
