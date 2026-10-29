"""POST /api/cart/items/bulk/ - several variants of one listing, all or none, and the richer cart lines."""
import threading
from unittest import mock

from django.db import connection
from django.test import TestCase, TransactionTestCase
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, Customer, Role, StaffUser
from cart.models import Cart, CartItem
from listings import variants
from listings.models import Category, Listing, ListingVariant, Zone


def make_listing(owner, name, category="shops"):
    return Listing.objects.create(
        business_owner=owner, category=Category.objects.get(slug=category), zone=Zone.objects.get(name="Manhyia"),
        name=name, description="D.", contact_phone=owner.login_phone, price_amount="10.00", status=Listing.PUBLISHED,
    )


def make_variant(listing, label, price, stock):
    row = ListingVariant.objects.create(listing=listing, label=label, price_amount=price, stock_quantity=stock)
    variants.sync_listing(listing)
    return row


class BulkBase:
    def build(self):
        self.client = APIClient()
        self.owner = BusinessOwner.objects.create(full_name="Ama Bakes", login_phone="+233207993001", password_hash="x")
        self.customer = Customer.objects.create(full_name="Yaw", phone="+233200993001", password_hash="x")
        self.token = issue_token(self.customer, "customer")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.token}")
        self.cake = make_listing(self.owner, "Cake")
        self.vanilla = make_variant(self.cake, "Vanilla", "25.00", 5)
        self.choc = make_variant(self.cake, "Chocolate", "30.00", 4)

    def bulk(self, lines, listing=None, client=None):
        return (client or self.client).post(
            "/api/cart/items/bulk/", {"listing": (listing or self.cake).pk, "lines": lines}, format="json",
        )


class BulkAddTests(BulkBase, TestCase):
    def setUp(self):
        self.build()

    def test_adds_several_variants_in_one_call(self):
        response = self.bulk([{"variant": self.vanilla.pk, "quantity": 2}, {"variant": self.choc.pk, "quantity": 1}])
        self.assertEqual(response.status_code, 201, response.content)
        body = response.json()
        self.assertEqual(body["total"], "80.00")
        self.assertEqual({(i["variant"], i["quantity"]) for i in body["items"]}, {(self.vanilla.pk, 2), (self.choc.pk, 1)})
        self.assertEqual(body["items"][0]["seller_name"], self.owner.display_name)
        self.assertEqual(body, self.client.get("/api/cart/").json())

    def test_one_sold_out_variant_rejects_everything_and_writes_nothing(self):
        ListingVariant.objects.filter(pk=self.choc.pk).update(stock_quantity=0)
        response = self.bulk([{"variant": self.vanilla.pk, "quantity": 1}, {"variant": self.choc.pk, "quantity": 1}])
        self.assertEqual(response.status_code, 400, response.content)
        self.assertEqual([e["index"] for e in response.json()["lines"]], [1])
        self.assertFalse(CartItem.objects.exists())
        self.assertFalse(Cart.objects.exists())

    def test_quantity_over_counted_stock_is_refused_per_line(self):
        response = self.bulk([{"variant": self.vanilla.pk, "quantity": 6}, {"variant": self.choc.pk, "quantity": 5}])
        self.assertEqual(response.status_code, 400)
        lines = response.json()["lines"]
        self.assertEqual([e["index"] for e in lines], [0, 1])
        self.assertTrue(all(e["detail"] for e in lines))
        self.assertFalse(CartItem.objects.exists())

    def test_untracked_stock_has_no_cap(self):
        ListingVariant.objects.filter(pk=self.vanilla.pk).update(stock_quantity=None)
        self.assertEqual(self.bulk([{"variant": self.vanilla.pk, "quantity": 500}]).status_code, 201)
        self.assertEqual(CartItem.objects.get().quantity, 500)

    def test_merges_into_the_existing_variant_line(self):
        self.bulk([{"variant": self.vanilla.pk, "quantity": 2}])
        ListingVariant.objects.filter(pk=self.vanilla.pk).update(price_amount="27.00")
        response = self.bulk([{"variant": self.vanilla.pk, "quantity": 2}])
        self.assertEqual(response.status_code, 201, response.content)
        item = CartItem.objects.get()
        self.assertEqual((item.quantity, str(item.unit_price_snapshot)), (4, "27.00"))
        # what is already in the cart counts against the stock
        self.assertEqual(self.bulk([{"variant": self.vanilla.pk, "quantity": 2}]).status_code, 400)
        self.assertEqual(CartItem.objects.get().quantity, 4)

    def test_variant_of_another_listing_refused(self):
        bread = make_variant(make_listing(self.owner, "Bread"), "Large", "12.00", 3)
        response = self.bulk([{"variant": self.vanilla.pk, "quantity": 1}, {"variant": bread.pk, "quantity": 1}])
        self.assertEqual(response.status_code, 400)
        self.assertEqual([e["index"] for e in response.json()["lines"]], [1])
        self.assertFalse(CartItem.objects.exists())

    def test_inactive_variant_refused(self):
        ListingVariant.objects.filter(pk=self.choc.pk).update(is_active=False)
        response = self.bulk([{"variant": self.choc.pk, "quantity": 1}])
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["lines"][0]["index"], 0)

    def test_body_level_problems(self):
        plain = make_listing(self.owner, "Plain")
        self.assertEqual(self.bulk([{"variant": self.vanilla.pk, "quantity": 1}], listing=plain).status_code, 400)
        self.assertEqual(self.bulk([]).status_code, 400)
        dup = self.bulk([{"variant": self.vanilla.pk, "quantity": 1}, {"variant": self.vanilla.pk, "quantity": 1}])
        self.assertEqual(dup.status_code, 400)
        for quantity in (0, -1, "2", 1.5, True):
            response = self.bulk([{"variant": self.vanilla.pk, "quantity": quantity}])
            self.assertEqual(response.status_code, 400, quantity)
            self.assertEqual(response.json()["lines"][0]["index"], 0)
        self.assertFalse(CartItem.objects.exists())

    def test_cart_guard_refusal_writes_nothing(self):
        for n in range(4):  # 4 shops already in the cart: a 5th is over the limit
            other = BusinessOwner.objects.create(full_name=f"Shop {n}", login_phone=f"+23320799400{n}", password_hash="x")
            cart, _ = Cart.objects.get_or_create(customer=self.customer)
            CartItem.objects.create(cart=cart, listing=make_listing(other, f"Item {n}"), quantity=1, unit_price_snapshot="10.00")
        before = CartItem.objects.count()
        response = self.bulk([{"variant": self.vanilla.pk, "quantity": 1}])
        self.assertEqual(response.status_code, 400, response.content)
        self.assertIn("code", response.json())
        self.assertEqual(CartItem.objects.count(), before)

    def test_staff_forbidden(self):
        staff = StaffUser.objects.create(
            email="s@example.com", full_name="S", password_hash="x", role=Role.objects.get(name=Role.SUPPORT),
        )
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(staff, 'staff')}")
        self.assertEqual(self.bulk([{"variant": self.vanilla.pk, "quantity": 1}], client=client).status_code, 403)
        self.assertEqual(self.bulk([{"variant": self.vanilla.pk, "quantity": 1}], client=APIClient()).status_code, 401)

    def test_cart_lines_carry_the_extra_read_fields(self):
        self.bulk([{"variant": self.vanilla.pk, "quantity": 1}])
        plain = make_listing(self.owner, "Plain")
        Listing.objects.filter(pk=plain.pk).update(stock_quantity=0)
        self.client.post("/api/cart/items/", {"listing": plain.pk, "quantity": 1}, format="json")
        items = {i["listing_name"]: i for i in self.client.get("/api/cart/").json()["items"]}
        cake, plain_line = items["Cake"], items["Plain"]
        self.assertEqual((cake["in_stock"], cake["stock_quantity"], cake["is_ashanti_direct"]), (True, 5, False))
        self.assertIsNone(cake["listing_photo"])
        self.assertEqual(cake["seller_name"], self.owner.display_name)
        self.assertEqual((plain_line["in_stock"], plain_line["stock_quantity"]), (False, 0))
        ListingVariant.objects.filter(pk=self.vanilla.pk).update(stock_quantity=None)
        cake = next(i for i in self.client.get("/api/cart/").json()["items"] if i["listing_name"] == "Cake")
        self.assertEqual((cake["in_stock"], cake["stock_quantity"]), (True, None))

    def test_cart_read_does_not_query_per_line(self):
        self.bulk([{"variant": self.vanilla.pk, "quantity": 1}])
        for n in range(6):
            listing = make_listing(self.owner, f"P{n}")
            cart, _ = Cart.objects.get_or_create(customer=self.customer)
            CartItem.objects.create(cart=cart, listing=listing, quantity=1, unit_price_snapshot="10.00")
        with self.assertNumQueries(4):
            self.assertEqual(self.client.get("/api/cart/").status_code, 200)


class ConcurrentBulkTests(BulkBase, TransactionTestCase):
    serialized_rollback = True

    def test_two_simultaneous_bulk_adds_do_not_exceed_stock_or_duplicate_lines(self):
        self.build()
        ListingVariant.objects.filter(pk=self.vanilla.pk).update(stock_quantity=4)
        barrier, results = threading.Barrier(2, timeout=5), []
        from cart import guard
        real = guard.check_add
        local = threading.local()

        def together(lines, listing):
            local.n = getattr(local, "n", 0) + 1
            if local.n == 1:
                barrier.wait()
            return real(lines, listing)

        def go():
            try:
                client = APIClient()
                client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.token}")
                results.append(self.bulk([{"variant": self.vanilla.pk, "quantity": 3}], client=client).status_code)
            finally:
                connection.close()

        with mock.patch("cart.views.guard.check_add", side_effect=together):
            threads = [threading.Thread(target=go) for _ in range(2)]
            for t in threads:
                t.start()
            for t in threads:
                t.join(timeout=20)
                self.assertFalse(t.is_alive(), "a racing add hung")
        self.assertEqual(sorted(results), [201, 400])
        self.assertEqual(CartItem.objects.count(), 1)
        self.assertEqual(CartItem.objects.get().quantity, 3)
