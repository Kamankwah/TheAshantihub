"""Coupons and flash sales: the checkout correctness core and the staff/owner/public endpoints."""
import threading
from datetime import timedelta
from decimal import Decimal

from django.db import connection
from django.test import TestCase, TransactionTestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, Customer
from accounts.testing import make_staff, staff_token
from approvals import services as approvals
from approvals.models import ApprovalRequest, ApprovalSettings
from billing.models import Transaction
from cart.models import Cart, CartItem
from fraud.models import FraudFlag
from listings.models import Category, Listing, Zone
from marketing import checkout as promo_checkout
from marketing import coupons as coupon_rules
from marketing import flash_sales as flash
from marketing.models_promos import Coupon, CouponCode, CouponRedemption, FlashSale, FlashSaleListing
from notifications.models import Notification
from orders.models import Order, OrderItem
from orders.serializers import OwnerOrderSerializer
from payments.models import CheckoutSession
from payments.services import finalize_failure

ON = override_settings(MARKETING_PROMOS_ENABLED=True)


class PromoBase(TestCase):
    def setUp(self):
        from django.core.cache import cache

        cache.clear()
        self.client = APIClient()
        self.boss = make_staff("super_admin", "boss@example.com")
        self.akua = make_staff("marketing", "akua@example.com")
        self.scout = make_staff("scout", "kwame@example.com")
        self.owner = self.make_owner("+233207660001", "Kente House")
        self.owner2 = self.make_owner("+233207660002", "Bonwire Looms")
        self.ama = Customer.objects.create(full_name="Ama", phone="+233200660001", password_hash="x")
        self.yaw = Customer.objects.create(full_name="Yaw", phone="+233200660002", password_hash="x")
        self.cat = Category.objects.get(slug="hotels")
        self.zone = Zone.objects.get(name="Manhyia")
        self.stole = self.listing(self.owner, "Stole", "100.00", 50)
        self.cloth = self.listing(self.owner2, "Cloth", "200.00", 50)

    def make_owner(self, phone, name):
        return BusinessOwner.objects.create(full_name=name, login_phone=phone, password_hash="x", kyc_status="verified")

    def listing(self, owner, name, price, stock):
        row = Listing.objects.create(
            business_owner=owner, category=self.cat, zone=self.zone, name=name, description="D.", contact_phone=owner.login_phone,
            price_amount=price, status=Listing.PUBLISHED, stock_quantity=stock,
        )
        row.refresh_from_db()
        return row

    def as_customer(self, c):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(c, 'customer')}")

    def as_owner(self, o):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(o, 'business_owner')}")

    def as_staff(self, s, sudo=False):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(s, sudo=sudo)}")

    def add(self, customer, listing, qty):
        cart, _ = Cart.objects.get_or_create(customer=customer)
        CartItem.objects.create(cart=cart, listing=listing, quantity=qty, unit_price_snapshot=listing.price_amount)

    def coupon(self, code="SAVE10", **kw):
        d = dict(code=code, kind=Coupon.FIXED, value=Decimal("10.00"), usage_limit=100, budget_cap=Decimal("1000.00"),
                 status=Coupon.ACTIVE, min_spend=Decimal("0"), per_customer_limit=1)
        d.update(kw)
        return Coupon.objects.create(**d)

    def live_sale(self, listings=None, pct=20, cap=10, per=2, **kw):
        now = timezone.now()
        sale = FlashSale.objects.create(name="Kente Friday", starts_at=now - timedelta(hours=1), ends_at=now + timedelta(hours=5),
                                        discount_pct=pct, stock_cap=cap, per_customer_limit=per, status=FlashSale.LIVE, **kw)
        for l in listings if listings is not None else [self.stole]:
            FlashSaleListing.objects.create(sale=sale, listing=l, normal_price=l.price_amount, sale_price=flash.sale_price(l.price_amount, pct),
                                            asked_at=now, agreed_at=now)
        return sale

    def checkout(self, customer, **body):
        self.as_customer(customer)
        return self.client.post("/api/orders/checkout/", body, format="json")


class FlagOffRegression(PromoBase):
    """With the switch off, checkout is exactly what it was, even with live promotions in the database."""

    def run_checkout(self, with_promos):
        if with_promos:
            self.coupon("SAVE10")
            self.live_sale()
        self.add(self.ama, self.stole, 3)
        self.add(self.ama, self.cloth, 1)
        response = self.checkout(self.ama, coupon_code="SAVE10")
        order = Order.objects.get(pk=response.json()["id"])
        return response, order

    def snapshot(self, response, order):
        self.stole.refresh_from_db(), self.cloth.refresh_from_db()
        body = response.json()
        return {
            "status": response.status_code, "total": body["total_amount"], "order_status": order.status,
            "discount": str(order.discount_amount), "coupon": order.coupon_id, "keys": sorted(body),
            "items": sorted((i.listing.name, i.quantity, str(i.unit_price), str(i.line_total), i.flash_sale_id) for i in order.items.all()),
            "stock": (self.stole.stock_quantity, self.cloth.stock_quantity), "price": (str(self.stole.price_amount), str(self.cloth.price_amount)),
            "txn": [str(t.amount) for t in Transaction.objects.filter(customer=self.ama)], "redemptions": CouponRedemption.objects.count(),
        }

    def test_totals_stock_and_orders_are_identical_with_the_flag_off(self):
        self.assertFalse(__import__("django.conf", fromlist=["settings"]).settings.MARKETING_PROMOS_ENABLED)
        plain = self.snapshot(*self.run_checkout(False))
        # Wipe and repeat with active coupon + live flash sale present.
        Order.objects.all().delete()
        Transaction.objects.all().delete()
        CheckoutSession.objects.all().delete()
        Listing.objects.filter(pk=self.stole.pk).update(stock_quantity=50)
        Listing.objects.filter(pk=self.cloth.pk).update(stock_quantity=50)
        with_promos = self.snapshot(*self.run_checkout(True))
        self.assertEqual(plain, with_promos)
        self.assertEqual(plain["total"], "500.00")  # 3*100 + 200, no discount
        self.assertEqual(plain["stock"], (47, 49))
        self.assertNotIn("discount_amount", plain["keys"])

    def test_public_endpoint_and_quote_show_nothing_while_off(self):
        self.live_sale()
        self.coupon("SAVE10")
        self.assertEqual(self.client.get("/api/marketing/promos/public/").json(), {"enabled": False, "flash_sales": []})
        self.add(self.ama, self.stole, 1)
        self.as_customer(self.ama)
        self.assertEqual(self.client.post("/api/marketing/cart/quote/", {"coupon_code": "SAVE10"}, format="json").json(), {"enabled": False})

    def test_staff_screens_still_work_and_say_discounts_are_not_applied(self):
        self.as_staff(self.akua)
        data = self.client.get("/api/marketing/coupons/").json()
        self.assertFalse(data["promos_enabled"])
        self.assertIn("not applied at checkout", data["off_notice"])
        created = self.client.post("/api/marketing/flash-sales/", {
            "name": "Draft", "starts_at": (timezone.now() + timedelta(days=3)).isoformat(), "ends_at": (timezone.now() + timedelta(days=3, hours=4)).isoformat(),
            "discount_pct": 10, "stock_cap": 5, "per_customer_limit": 1}, format="json")
        self.assertEqual(created.status_code, 201, created.content)
        self.assertIn("not applied at checkout", self.client.get("/api/marketing/flash-sales/").json()["off_notice"])


@ON
class FlashSaleCheckout(PromoBase):
    def test_sale_price_snapshot_stock_and_listing_price_untouched(self):
        sale = self.live_sale()
        self.add(self.ama, self.stole, 2)
        response = self.checkout(self.ama)
        self.assertEqual(response.status_code, 201, response.content)
        order = Order.objects.get()
        item = order.items.get()
        self.assertEqual((item.unit_price, item.line_total, item.flash_sale_id), (Decimal("80.00"), Decimal("160.00"), sale.pk))
        self.assertEqual(order.total_amount, Decimal("160.00"))
        self.assertEqual(Transaction.objects.get().amount, Decimal("160.00"))
        self.stole.refresh_from_db()
        self.assertEqual((self.stole.price_amount, self.stole.stock_quantity), (Decimal("100.00"), 48))

    def test_cap_and_per_customer_limit_split_the_line(self):
        self.live_sale(cap=3, per=2)
        self.add(self.ama, self.stole, 5)
        self.checkout(self.ama)
        rows = sorted((i.quantity, str(i.unit_price)) for i in Order.objects.get().items.all())
        self.assertEqual(rows, [(2, "80.00"), (3, "100.00")])  # per-customer 2 at the sale price
        self.add(self.yaw, self.stole, 5)
        self.checkout(self.yaw)
        sold = sum(i.quantity for i in OrderItem.objects.filter(flash_sale__isnull=False))
        self.assertEqual(sold, 3)  # the sale's cap of 3 is never passed
        self.stole.refresh_from_db()
        self.assertEqual(self.stole.stock_quantity, 40)  # the oversell guard still sees every unit

    def test_sold_out_sale_falls_back_to_normal_price(self):
        self.live_sale(cap=1, per=5)
        self.add(self.ama, self.stole, 1)
        self.checkout(self.ama)
        self.add(self.yaw, self.stole, 1)
        self.checkout(self.yaw)
        self.assertEqual(Order.objects.get(customer=self.yaw).total_amount, Decimal("100.00"))

    def test_listing_that_stops_qualifying_gets_the_normal_price(self):
        for change in (
            lambda: Listing.objects.filter(pk=self.stole.pk).update(price_amount="120.00"),
            lambda: Listing.objects.filter(pk=self.stole.pk).update(stock_quantity=None),
            lambda: BusinessOwner.objects.filter(pk=self.owner.pk).update(is_suspended=True),
            lambda: FraudFlag.objects.create(kind=FraudFlag.OTHER, source=FraudFlag.STAFF, title="x", business_owner=self.owner),
        ):
            Order.objects.all().delete()
            Cart.objects.all().delete()
            FlashSale.objects.all().delete()
            Listing.objects.filter(pk=self.stole.pk).update(price_amount="100.00", stock_quantity=50)
            BusinessOwner.objects.filter(pk=self.owner.pk).update(is_suspended=False)
            FraudFlag.objects.all().delete()
            self.live_sale()
            change()
            self.add(self.ama, Listing.objects.get(pk=self.stole.pk), 1)
            priced = promo_checkout.price(self.ama, list(Cart.objects.get(customer=self.ama).items.select_related("listing")))
            self.assertTrue(all(l.flash_sale is None for l in priced.lines))

    def test_unagreed_or_ended_sales_never_apply(self):
        sale = self.live_sale()
        FlashSaleListing.objects.update(agreed_at=None)
        self.add(self.ama, self.stole, 1)
        items = list(Cart.objects.get(customer=self.ama).items.select_related("listing"))
        self.assertIsNone(promo_checkout.price(self.ama, items).lines[0].flash_sale)
        FlashSaleListing.objects.update(agreed_at=timezone.now())
        sale.status = FlashSale.ENDED
        sale.save()
        self.assertIsNone(promo_checkout.price(self.ama, items).lines[0].flash_sale)

    def test_failed_payment_rolls_back_stock_coupon_and_sale_stock(self):
        self.live_sale(cap=2, per=2)
        coupon = self.coupon("SAVE10")
        self.add(self.ama, self.stole, 1)
        self.add(self.ama, self.cloth, 1)
        self.checkout(self.ama, coupon_code="SAVE10")
        order = Order.objects.get()
        session = CheckoutSession.objects.get(kind=CheckoutSession.ORDER_CHECKOUT)
        self.assertTrue(session.metadata["promos"])
        Order.objects.filter(pk=order.pk).update(status=Order.PENDING)  # a Hubtel order is pending until paid
        finalize_failure(session)
        session.refresh_from_db()
        self.stole.refresh_from_db(), self.cloth.refresh_from_db()
        self.assertEqual((self.stole.stock_quantity, self.cloth.stock_quantity), (50, 50))
        order.refresh_from_db()
        self.assertEqual(order.status, Order.CANCELLED)
        self.assertEqual(CouponRedemption.objects.get().released_at is not None, True)
        self.assertEqual(coupon.cost_to_date(), Decimal("0.00"))
        self.assertEqual(promo_checkout._sold(FlashSale.objects.get()), 0)
        finalize_failure(session)  # idempotent
        self.stole.refresh_from_db()
        self.assertEqual(self.stole.stock_quantity, 50)


@ON
class CouponCheckout(PromoBase):
    def apply(self, code, customer=None, listings=((None, 1),)):
        customer = customer or self.ama
        Cart.objects.filter(customer=customer).delete()
        for listing, qty in [(l or self.stole, q) for l, q in listings]:
            self.add(customer, listing, qty)
        return self.checkout(customer, coupon_code=code)

    def test_fixed_discount_is_net_total_and_seller_lines_are_unchanged(self):
        coupon = self.coupon("SAVE10")
        response = self.apply("save10 ", listings=((self.stole, 2), (self.cloth, 1)))
        self.assertEqual(response.status_code, 201, response.content)
        order = Order.objects.get()
        self.assertEqual((order.total_amount, order.discount_amount, order.coupon_id), (Decimal("390.00"), Decimal("10.00"), coupon.pk))
        self.assertEqual(sum(i.line_total for i in order.items.all()), Decimal("400.00"))
        self.assertEqual(Transaction.objects.get().amount, Decimal("390.00"))
        self.assertEqual(response.json()["discount_amount"], "10.00")
        self.assertEqual(coupon.cost_to_date(), Decimal("10.00"))

    def test_percent_with_cap_and_min_spend(self):
        self.coupon("PCT", kind=Coupon.PERCENT, value=Decimal("15"), max_discount=Decimal("20.00"), min_spend=Decimal("150.00"))
        self.assertEqual(self.apply("PCT").status_code, 400)  # 100 < 150 minimum
        response = self.apply("PCT", listings=((self.cloth, 1),))
        self.assertEqual(Order.objects.get().discount_amount, Decimal("20.00"))  # 15% of 200 = 30, capped at 20
        self.assertEqual(response.json()["total_amount"], "180.00")

    def test_single_use_codes_are_long_enough_to_be_unguessable(self):
        self.assertGreaterEqual(coupon_rules.CODE_SUFFIX_LENGTH, 13)
        self.assertGreaterEqual(len(coupon_rules.ALPHABET) ** coupon_rules.CODE_SUFFIX_LENGTH, 2 ** 64)

    def test_every_failure_answers_the_same_words(self):
        from django.core.cache import cache

        self.coupon("DRAFTY", status=Coupon.DRAFT)
        self.coupon("OLD", expires_at=timezone.now() - timedelta(days=1))
        self.coupon("LATER", starts_at=timezone.now() + timedelta(days=1))
        self.coupon("BIG", min_spend=Decimal("9999"))
        self.coupon("SPENT", usage_limit=1)
        answers = set()
        for code in ("NOPE", "DRAFTY", "OLD", "LATER", "BIG"):
            cache.clear()
            Cart.objects.filter(customer=self.ama).delete()
            self.add(self.ama, self.stole, 1)
            self.as_customer(self.ama)
            quote = self.client.post("/api/marketing/cart/quote/", {"coupon_code": code}, format="json").json()
            answers.add(quote["coupon_error"])
            answers.add(self.checkout(self.ama, coupon_code=code).json()["detail"])
        self.assertEqual(answers, {"That code can't be used."})

    def test_failed_lookups_are_throttled_at_quote_and_checkout(self):
        from django.core.cache import cache

        cache.clear()
        self.add(self.ama, self.stole, 1)
        self.as_customer(self.ama)
        for i in range(10):
            self.client.post("/api/marketing/cart/quote/", {"coupon_code": f"GUESS{i}"}, format="json")
        self.assertEqual(self.client.post("/api/marketing/cart/quote/", {"coupon_code": "GUESS99"}, format="json").status_code, 429)
        self.assertEqual(self.checkout(self.ama, coupon_code="GUESS98").status_code, 429)
        # a different customer from the same address is held by the per-address count
        self.add(self.yaw, self.stole, 1)
        self.as_customer(self.yaw)
        self.assertEqual(self.client.post("/api/marketing/cart/quote/", {"coupon_code": "GUESS97"}, format="json").status_code, 429)
        # a cart with no code is not affected
        self.assertEqual(self.checkout(self.yaw).status_code, 201)

    def test_invalid_codes_are_refused_and_create_nothing(self):
        self.coupon("DRAFTY", status=Coupon.DRAFT)
        self.coupon("OLD", expires_at=timezone.now() - timedelta(days=1))
        self.coupon("LATER", starts_at=timezone.now() + timedelta(days=1))
        self.coupon("STOPPED", status=Coupon.PAUSED)
        for code in ("NOPE", "DRAFTY", "OLD", "LATER", "STOPPED"):
            response = self.apply(code)
            self.assertEqual(response.status_code, 400, code)
        self.assertFalse(Order.objects.exists())
        self.stole.refresh_from_db()
        self.assertEqual(self.stole.stock_quantity, 50)

    def test_no_stacking_one_coupon_and_never_on_a_flash_price(self):
        self.coupon("A10")
        self.coupon("B10")
        self.live_sale()
        # a cart of only flash items cannot use a coupon
        response = self.apply("A10")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["detail"], "That code can't be used.")
        # mixed cart: the coupon applies to the non-flash line only
        response = self.apply("A10", listings=((self.stole, 1), (self.cloth, 1)))
        self.assertEqual(response.status_code, 201, response.content)
        order = Order.objects.get()
        self.assertEqual(order.total_amount, Decimal("80.00") + Decimal("200.00") - Decimal("10.00"))
        # exactly one redemption per order whatever is sent (a list is not a code)
        self.assertEqual(CouponRedemption.objects.count(), 1)
        self.assertEqual(self.checkout(self.yaw, coupon_code=["A10", "B10"]).status_code, 400)

    def test_per_customer_limit_counts_the_same_phone(self):
        self.coupon("ONCE")
        self.assertEqual(self.apply("ONCE").status_code, 201)
        self.assertEqual(self.apply("ONCE").status_code, 400)  # Ama again
        twin = Customer.objects.create(full_name="Ama Two", phone="0200 660 001", password_hash="x")  # same phone, other spelling
        self.assertEqual(self.apply("ONCE", twin).status_code, 400)
        self.assertEqual(self.apply("ONCE", self.yaw).status_code, 201)  # a different person

    def test_total_uses_and_used_up_status(self):
        coupon = self.coupon("TWO", usage_limit=2)
        self.assertEqual(self.apply("TWO").status_code, 201)
        self.assertEqual(self.apply("TWO", self.yaw).status_code, 201)
        coupon.refresh_from_db()
        self.assertEqual(coupon.status, Coupon.EXPIRED)
        third = Customer.objects.create(full_name="Kojo", phone="+233200660003", password_hash="x")
        self.assertEqual(self.apply("TWO", third).status_code, 400)

    def test_budget_cap_pauses_the_coupon_and_is_never_passed(self):
        coupon = self.coupon("CAP", budget_cap=Decimal("15.00"), per_customer_limit=5)
        self.assertEqual(self.apply("CAP").status_code, 201)  # 10 of 15
        self.assertEqual(self.apply("CAP").status_code, 400)  # another 10 would pass the cap
        coupon.refresh_from_db()
        self.assertEqual(coupon.cost_to_date(), Decimal("10.00"))
        exact = self.coupon("EXACT", budget_cap=Decimal("10.00"))
        self.assertEqual(self.apply("EXACT", self.yaw).status_code, 201)
        exact.refresh_from_db()
        self.assertEqual((exact.status, exact.paused_reason), (Coupon.PAUSED, "Budget cap reached"))
        self.assertTrue(Notification.objects.filter(kind="coupon_paused", staff=self.akua).exists())

    def test_single_use_codes_work_once_and_the_prefix_does_not(self):
        self.as_staff(self.akua)
        made = self.client.post("/api/marketing/coupons/", {
            "code": "WB", "code_mode": "single_use", "kind": "fixed", "value": "15.00", "usage_limit": 3, "min_spend": "0"}, format="json")
        self.assertEqual(made.status_code, 201, made.content)
        codes = list(CouponCode.objects.values_list("code", flat=True))
        self.assertEqual(len(codes), 3)
        self.assertTrue(all(c.startswith("WB-") and len(c) == 3 + coupon_rules.CODE_SUFFIX_LENGTH for c in codes))
        Coupon.objects.update(status=Coupon.ACTIVE)
        self.assertEqual(self.apply("WB").status_code, 400)
        self.assertEqual(self.apply(codes[0].lower()).status_code, 201)
        self.assertEqual(self.apply(codes[0], self.yaw).status_code, 400)  # already used by someone else
        self.assertEqual(self.apply(codes[1], self.yaw).status_code, 201)

    def test_owner_views_never_show_the_discount_or_other_businesses_lines(self):
        self.coupon("SAVE10")
        self.apply("SAVE10", listings=((self.stole, 1), (self.cloth, 1)))
        order = Order.objects.get()
        data = OwnerOrderSerializer(order, context={"owner": self.owner}).data
        self.assertEqual([i["listing_name"] for i in data["items"]], ["Stole"])
        self.assertEqual(data["owner_subtotal"], "100.00")  # the seller is paid the full price
        self.assertFalse({"discount_amount", "coupon", "total_amount"} & set(data))
        self.as_owner(self.owner2)
        rows = self.client.get("/api/orders/owner/").json()["results"]
        self.assertEqual(rows[0]["owner_subtotal"], "200.00")
        self.assertEqual([i["listing_name"] for i in rows[0]["items"]], ["Cloth"])
        report = self.client.get("/api/orders/owner/report/").json()
        self.assertEqual(report["summary"]["total_sales"], "200.00")

    def test_quote_matches_checkout_and_writes_nothing(self):
        self.coupon("SAVE10")
        self.live_sale()
        self.add(self.ama, self.stole, 1)
        self.add(self.ama, self.cloth, 1)
        self.as_customer(self.ama)
        quote = self.client.post("/api/marketing/cart/quote/", {"coupon_code": "SAVE10"}, format="json").json()
        self.assertEqual((quote["items_subtotal"], quote["discount"], quote["total"]), ("280.00", "10.00", "270.00"))
        self.assertEqual(CouponRedemption.objects.count(), 0)
        self.assertEqual(Order.objects.count(), 0)
        bad = self.client.post("/api/marketing/cart/quote/", {"coupon_code": "NOPE"}, format="json").json()
        self.assertEqual(bad["coupon_error"], "That code can't be used.")
        self.assertEqual(bad["total"], "280.00")
        self.assertEqual(self.checkout(self.ama, coupon_code="SAVE10").json()["total_amount"], quote["total"])

    def test_public_endpoint_lists_only_sales_that_may_show(self):
        sale = self.live_sale()
        body = self.client.get("/api/marketing/promos/public/").json()
        self.assertTrue(body["enabled"])
        self.assertEqual(body["flash_sales"][0]["listings"], [{"listing": self.stole.pk, "normal_price": "100.00", "sale_price": "80.00"}])
        self.assertNotIn("business", str(body))
        FlashSale.objects.filter(pk=sale.pk).update(status=FlashSale.ENDED)
        self.assertEqual(self.client.get("/api/marketing/promos/public/").json()["flash_sales"], [])


class SingleUseRace(TransactionTestCase):
    """Two customers, one single-use code, at the same moment: exactly one order gets it."""

    serialized_rollback = True

    def setUp(self):
        from django.core.cache import cache

        cache.clear()

    @ON
    def test_a_single_use_code_cannot_be_redeemed_twice_concurrently(self):
        owner = BusinessOwner.objects.create(full_name="K", login_phone="+233207669991", password_hash="x", kyc_status="verified")
        cat, zone = Category.objects.get(slug="hotels"), Zone.objects.get(name="Manhyia")
        listing = Listing.objects.create(business_owner=owner, category=cat, zone=zone, name="Stole", description="D.", contact_phone="1",
                                         price_amount="100.00", status=Listing.PUBLISHED, stock_quantity=20)
        coupon = Coupon.objects.create(code="WB", code_mode=Coupon.SINGLE_USE, kind=Coupon.FIXED, value=10, usage_limit=1, budget_cap=10, status=Coupon.ACTIVE)
        CouponCode.objects.create(coupon=coupon, code="WB-AAAAA")
        customers = [Customer.objects.create(full_name=f"C{i}", phone=f"+23320066999{i}", password_hash="x") for i in range(4)]
        for c in customers:
            cart = Cart.objects.create(customer=c)
            CartItem.objects.create(cart=cart, listing=listing, quantity=1, unit_price_snapshot="100.00")
        results, barrier = [], threading.Barrier(len(customers))

        def go(customer):
            client = APIClient()
            client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(customer, 'customer')}")
            barrier.wait()
            try:
                results.append(client.post("/api/orders/checkout/", {"coupon_code": "WB-AAAAA"}, format="json").status_code)
            finally:
                connection.close()

        threads = [threading.Thread(target=go, args=(c,)) for c in customers]
        [t.start() for t in threads]
        [t.join() for t in threads]
        self.assertEqual(sorted(results), [201, 400, 400, 400])
        self.assertEqual(CouponRedemption.objects.filter(released_at__isnull=True).count(), 1)
        self.assertEqual(Order.objects.filter(discount_amount__gt=0).count(), 1)

    @ON
    def test_a_flash_sale_cap_holds_under_concurrent_checkouts(self):
        owner = BusinessOwner.objects.create(full_name="K", login_phone="+233207669992", password_hash="x", kyc_status="verified")
        cat, zone = Category.objects.get(slug="hotels"), Zone.objects.get(name="Manhyia")
        listing = Listing.objects.create(business_owner=owner, category=cat, zone=zone, name="Stole", description="D.", contact_phone="1",
                                         price_amount="100.00", status=Listing.PUBLISHED, stock_quantity=20)
        now = timezone.now()
        sale = FlashSale.objects.create(name="S", starts_at=now - timedelta(hours=1), ends_at=now + timedelta(hours=1), discount_pct=20,
                                        stock_cap=2, per_customer_limit=5, status=FlashSale.LIVE)
        FlashSaleListing.objects.create(sale=sale, listing=listing, normal_price="100.00", sale_price="80.00", asked_at=now, agreed_at=now)
        customers = [Customer.objects.create(full_name=f"D{i}", phone=f"+23320066888{i}", password_hash="x") for i in range(4)]
        for c in customers:
            cart = Cart.objects.create(customer=c)
            CartItem.objects.create(cart=cart, listing=listing, quantity=1, unit_price_snapshot="100.00")
        barrier = threading.Barrier(len(customers))

        def go(customer):
            client = APIClient()
            client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(customer, 'customer')}")
            barrier.wait()
            try:
                client.post("/api/orders/checkout/", {}, format="json")
            finally:
                connection.close()

        threads = [threading.Thread(target=go, args=(c,)) for c in customers]
        [t.start() for t in threads]
        [t.join() for t in threads]
        self.assertEqual(sum(i.quantity for i in OrderItem.objects.filter(flash_sale=sale)), 2)
        self.assertEqual(OrderItem.objects.count(), 4)


class CouponStaffFlow(PromoBase):
    body = {"code": "HAIR15", "kind": "percent", "value": "15", "max_discount": "30.00", "usage_limit": 100, "min_spend": "100"}

    def test_small_budget_activates_directly(self):
        self.as_staff(self.akua)
        made = self.client.post("/api/marketing/coupons/", {**self.body, "budget_cap": "20.00"}, format="json").json()
        done = self.client.post(f"/api/marketing/coupons/{made['id']}/activate/").json()
        self.assertEqual((done["status"], done["approval_id"]), ("active", None))

    def test_over_threshold_waits_for_super_admin_and_only_then_goes_live(self):
        self.as_staff(self.akua)
        made = self.client.post("/api/marketing/coupons/", self.body, format="json").json()
        self.assertEqual(made["budget_cap"], "3000.00")  # 100 uses x GH₵ 30
        self.assertTrue(made["needs_approval"])
        done = self.client.post(f"/api/marketing/coupons/{made['id']}/activate/").json()
        self.assertEqual(done["status"], "waiting_approval")
        approval = ApprovalRequest.objects.get(kind="marketing.coupon")
        self.assertEqual(approval.amount, Decimal("3000.00"))
        self.assertEqual(approval.status, ApprovalRequest.PENDING)
        with self.assertRaises(approvals.ApprovalError):
            approvals.approve(approval.pk, self.akua)  # the maker never decides
        approvals.approve(approval.pk, self.boss)
        self.assertEqual(Coupon.objects.get().status, Coupon.ACTIVE)

    def test_rejection_returns_it_to_draft(self):
        self.as_staff(self.akua)
        made = self.client.post("/api/marketing/coupons/", self.body, format="json").json()
        self.client.post(f"/api/marketing/coupons/{made['id']}/activate/")
        approvals.reject(ApprovalRequest.objects.get(kind="marketing.coupon").pk, self.boss, "Too generous")
        self.assertEqual(Coupon.objects.get().status, Coupon.DRAFT)

    def test_threshold_is_the_approval_rule_setting(self):
        ApprovalSettings.objects.update_or_create(pk=1, defaults={"campaign_threshold": Decimal("5000.00")})
        self.as_staff(self.akua)
        made = self.client.post("/api/marketing/coupons/", self.body, format="json").json()
        self.assertEqual(self.client.post(f"/api/marketing/coupons/{made['id']}/activate/").json()["status"], "active")

    def test_super_admin_own_coupon_applies_at_once(self):
        self.as_staff(self.boss)
        made = self.client.post("/api/marketing/coupons/", self.body, format="json").json()
        self.assertEqual(self.client.post(f"/api/marketing/coupons/{made['id']}/activate/").json()["status"], "active")

    def test_codes_are_unique_ignoring_case_and_percent_needs_a_bound(self):
        self.as_staff(self.akua)
        self.assertEqual(self.client.post("/api/marketing/coupons/", {**self.body, "budget_cap": "20"}, format="json").status_code, 201)
        self.assertEqual(self.client.post("/api/marketing/coupons/", {**self.body, "code": "hair15", "budget_cap": "20"}, format="json").status_code, 409)
        unbounded = {**self.body, "code": "NOBOUND"}
        unbounded.pop("max_discount")
        self.assertEqual(self.client.post("/api/marketing/coupons/", unbounded, format="json").status_code, 400)

    def test_pause_resume_end_and_edit_rules(self):
        self.as_staff(self.akua)
        made = self.client.post("/api/marketing/coupons/", {**self.body, "budget_cap": "20.00"}, format="json").json()
        url = f"/api/marketing/coupons/{made['id']}/"
        self.client.post(url + "activate/")
        self.assertEqual(self.client.patch(url, {"value": "20"}, format="json").status_code, 409)  # live coupons are not edited
        self.assertEqual(self.client.post(url + "pause/").json()["status"], "paused")
        self.assertEqual(self.client.post(url + "resume/").json()["status"], "active")
        self.assertEqual(self.client.post(url + "end/").json()["effective_status"], "expired")
        self.assertEqual(self.client.post(url + "nonsense/").status_code, 404)

    def test_permissions(self):
        self.as_staff(self.scout)
        self.assertEqual(self.client.get("/api/marketing/coupons/").status_code, 403)
        self.assertEqual(self.client.post("/api/marketing/coupons/", self.body, format="json").status_code, 403)
        self.assertEqual(self.client.get("/api/marketing/flash-sales/").status_code, 403)
        self.client.credentials()
        self.assertEqual(self.client.get("/api/marketing/coupons/").status_code, 401)
        self.as_customer(self.ama)
        self.assertEqual(self.client.get("/api/marketing/flash-sales/").status_code, 403)


class FlashSaleFlow(PromoBase):
    def make_sale(self, listings=None, hours_ahead=72):
        self.as_staff(self.akua)
        start = timezone.now() + timedelta(hours=hours_ahead)
        r = self.client.post("/api/marketing/flash-sales/", {
            "name": "Kente Friday", "starts_at": start.isoformat(), "ends_at": (start + timedelta(hours=8)).isoformat(),
            "discount_pct": 20, "stock_cap": 40, "per_customer_limit": 2,
            "listing_ids": [l.pk for l in (listings or [self.stole, self.cloth])]}, format="json")
        self.assertEqual(r.status_code, 201, r.content)
        return r.json()["id"]

    def test_eligibility_rules(self):
        untracked = self.listing(self.owner, "Service", "50.00", None)
        draft = self.listing(self.owner, "Draft", "50.00", 5)
        Listing.objects.filter(pk=draft.pk).update(status=Listing.DRAFT)
        draft.refresh_from_db()
        unverified = self.make_owner("+233207660003", "New Biz")
        BusinessOwner.objects.filter(pk=unverified.pk).update(kyc_status="pending")
        pending = self.listing(unverified, "Unverified", "50.00", 5)
        flagged_owner = self.make_owner("+233207660004", "Flagged")
        flagged = self.listing(flagged_owner, "Flagged item", "50.00", 5)
        FraudFlag.objects.create(kind=FraudFlag.OTHER, source=FraudFlag.STAFF, title="x", business_owner=flagged_owner)
        self.assertIsNone(flash.eligibility_problem(self.stole))
        for bad in (untracked, draft, pending, flagged):
            self.assertIsNotNone(flash.eligibility_problem(bad), bad.name)
        self.as_staff(self.akua)
        names = [r["name"] for r in self.client.get("/api/marketing/flash-sales/eligible/").json()["results"]]
        self.assertEqual(sorted(names), ["Cloth", "Stole"])
        sale = self.make_sale()
        r = self.client.post(f"/api/marketing/flash-sales/{sale}/listings/", {"listing_ids": [untracked.pk]}, format="json")
        self.assertEqual(r.status_code, 400)

    def test_listing_cannot_be_in_two_overlapping_sales(self):
        self.make_sale([self.stole])
        self.as_staff(self.akua)
        start = timezone.now() + timedelta(hours=74)
        r = self.client.post("/api/marketing/flash-sales/", {
            "name": "Other", "starts_at": start.isoformat(), "ends_at": (start + timedelta(hours=2)).isoformat(), "discount_pct": 10,
            "stock_cap": 5, "per_customer_limit": 1, "listing_ids": [self.stole.pk]}, format="json")
        self.assertEqual(r.status_code, 400)
        self.assertIn("Already in", r.json()["detail"])

    def test_asking_sellers_notifies_each_owner_once_in_app_only(self):
        sale = self.make_sale()
        r = self.client.post(f"/api/marketing/flash-sales/{sale}/ask/")
        self.assertEqual(r.json()["status"], "waiting_sellers")
        notes = Notification.objects.filter(kind="flash_sale_invite")
        self.assertEqual(notes.count(), 2)
        self.assertIn("AshantiHub is asking you to take part", notes.first().title)
        self.assertEqual(sorted(n.business_owner_id for n in notes), sorted([self.owner.pk, self.owner2.pk]))

    def test_sellers_answer_and_the_sale_becomes_scheduled_only_when_nobody_is_pending(self):
        sale = self.make_sale()
        self.client.post(f"/api/marketing/flash-sales/{sale}/ask/")
        self.as_owner(self.owner)
        inv = self.client.get("/api/marketing/owner/flash-sales/").json()["results"]
        self.assertEqual([i["name"] for i in inv], ["Kente Friday"])
        self.assertEqual([l["name"] for l in inv[0]["listings"]], ["Stole"])  # only their own listing
        self.assertEqual(self.client.post(f"/api/marketing/owner/flash-sales/{sale}/respond/", {"accept": True}, format="json").status_code, 200)
        self.assertEqual(FlashSale.objects.get().status, "waiting_sellers")
        self.as_owner(self.owner2)
        self.client.post(f"/api/marketing/owner/flash-sales/{sale}/respond/", {"accept": True}, format="json")
        self.assertEqual(FlashSale.objects.get().status, "scheduled")

    def test_an_owner_cannot_answer_for_another_business_or_without_an_invitation(self):
        sale = self.make_sale([self.stole])
        self.client.post(f"/api/marketing/flash-sales/{sale}/ask/")
        self.as_owner(self.owner2)
        self.assertEqual(self.client.post(f"/api/marketing/owner/flash-sales/{sale}/respond/", {"accept": True}, format="json").status_code, 404)
        self.assertEqual(self.client.get("/api/marketing/owner/flash-sales/").json()["results"], [])
        self.as_customer(self.ama)
        self.assertEqual(self.client.get("/api/marketing/owner/flash-sales/").status_code, 403)

    def test_decline_and_withdraw_until_the_cutoff(self):
        sale = self.make_sale([self.stole], hours_ahead=72)
        self.client.post(f"/api/marketing/flash-sales/{sale}/ask/")
        self.as_owner(self.owner)
        url = f"/api/marketing/owner/flash-sales/{sale}/respond/"
        self.client.post(url, {"accept": True}, format="json")
        self.assertEqual(FlashSale.objects.get().status, "scheduled")
        self.assertEqual(self.client.post(url, {"accept": False}, format="json").status_code, 200)  # withdrawn before the cutoff
        row = FlashSaleListing.objects.get()
        self.assertEqual((row.state, FlashSale.objects.get().status), ("withdrawn", "waiting_sellers"))
        # inside the cutoff a yes cannot be taken back
        sale2 = self.make_sale([self.cloth], hours_ahead=10)
        self.client.post(f"/api/marketing/flash-sales/{sale2}/ask/")
        self.as_owner(self.owner2)
        url2 = f"/api/marketing/owner/flash-sales/{sale2}/respond/"
        self.client.post(url2, {"accept": True}, format="json")
        self.assertEqual(self.client.post(url2, {"accept": False}, format="json").status_code, 409)
        self.assertEqual(FlashSaleListing.objects.get(sale_id=sale2).state, "agreed")

    def test_changing_discount_dates_or_listings_asks_sellers_again(self):
        sale = self.make_sale([self.stole])
        self.client.post(f"/api/marketing/flash-sales/{sale}/ask/")
        self.as_owner(self.owner)
        self.client.post(f"/api/marketing/owner/flash-sales/{sale}/respond/", {"accept": True}, format="json")
        self.assertEqual(FlashSale.objects.get().status, "scheduled")
        before = Notification.objects.filter(kind="flash_sale_invite").count()
        self.as_staff(self.akua)
        self.client.patch(f"/api/marketing/flash-sales/{sale}/", {"discount_pct": 30}, format="json")
        row = FlashSaleListing.objects.get()
        self.assertEqual((row.state, str(row.sale_price), FlashSale.objects.get().status), ("asked", "70.00", "waiting_sellers"))
        self.assertEqual(Notification.objects.filter(kind="flash_sale_invite").count(), before + 1)
        self.client.patch(f"/api/marketing/flash-sales/{sale}/", {"stock_cap": 99}, format="json")  # not a seller term
        self.assertEqual(FlashSaleListing.objects.get().state, "asked")
        self.client.post(f"/api/marketing/flash-sales/{sale}/listings/", {"listing_ids": [self.cloth.pk]}, format="json")
        self.assertEqual(Notification.objects.filter(kind="flash_sale_invite").count(), before + 3)

    def test_the_clock_flips_scheduled_to_live_to_ended_and_end_early(self):
        sale_id = self.make_sale([self.stole], hours_ahead=1)
        self.client.post(f"/api/marketing/flash-sales/{sale_id}/ask/")
        self.as_owner(self.owner)
        self.client.post(f"/api/marketing/owner/flash-sales/{sale_id}/respond/", {"accept": True}, format="json")
        sale = FlashSale.objects.get()
        self.assertEqual(flash.tick(sale.starts_at - timedelta(minutes=1)), (0, 0))
        self.assertEqual(flash.tick(sale.starts_at + timedelta(minutes=1)), (1, 0))
        self.assertEqual(FlashSale.objects.get().status, "live")
        self.as_staff(self.akua)
        ended = self.client.post(f"/api/marketing/flash-sales/{sale_id}/end/").json()
        self.assertEqual(ended["status"], "ended")
        self.assertEqual(self.client.post(f"/api/marketing/flash-sales/{sale_id}/end/").status_code, 409)
        self.assertEqual(flash.tick(sale.ends_at + timedelta(hours=1)), (0, 0))

    def test_ended_early_sale_no_longer_prices_but_old_orders_keep_the_price(self):
        with override_settings(MARKETING_PROMOS_ENABLED=True):
            sale = self.live_sale()
            self.add(self.ama, self.stole, 1)
            self.checkout(self.ama)
            flash.end_early(sale.pk, self.akua)
            self.add(self.yaw, self.stole, 1)
            self.checkout(self.yaw)
        self.assertEqual(Order.objects.get(customer=self.ama).total_amount, Decimal("80.00"))
        self.assertEqual(Order.objects.get(customer=self.yaw).total_amount, Decimal("100.00"))

    def test_cancel_only_before_start_and_edit_locks_once_live(self):
        sale_id = self.make_sale([self.stole])
        self.assertEqual(self.client.post(f"/api/marketing/flash-sales/{sale_id}/cancel/").json()["status"], "cancelled")
        live = self.live_sale([self.cloth])
        self.assertEqual(self.client.post(f"/api/marketing/flash-sales/{live.pk}/cancel/").status_code, 409)
        self.assertEqual(self.client.patch(f"/api/marketing/flash-sales/{live.pk}/", {"discount_pct": 5}, format="json").status_code, 409)

    def test_validation(self):
        self.as_staff(self.akua)
        now = timezone.now()
        bad = {"name": "X", "starts_at": (now + timedelta(days=1)).isoformat(), "ends_at": now.isoformat(), "discount_pct": 20, "stock_cap": 1, "per_customer_limit": 1}
        self.assertEqual(self.client.post("/api/marketing/flash-sales/", bad, format="json").status_code, 400)
        ok = {**bad, "ends_at": (now + timedelta(days=2)).isoformat()}
        for patch in ({"discount_pct": 0}, {"discount_pct": 95}, {"stock_cap": 0}, {"name": " "}):
            self.assertEqual(self.client.post("/api/marketing/flash-sales/", {**ok, **patch}, format="json").status_code, 400, patch)

    def test_payer_is_always_sellers(self):
        sale = self.make_sale([self.stole])
        self.assertEqual(self.client.get(f"/api/marketing/flash-sales/{sale}/").json()["payer"], "sellers")

    def test_calendar_and_overview_feed(self):
        sale_id = self.make_sale([self.stole])
        from marketing.calendar_sources import flash_sale_entries

        s = FlashSale.objects.get()
        entries = flash_sale_entries(s.starts_at - timedelta(days=1), s.ends_at + timedelta(days=1))
        self.assertEqual(entries, [{"id": sale_id, "kind": "flash_sale", "title": "Kente Friday", "starts_at": s.starts_at, "ends_at": s.ends_at, "status": "draft"}])
        self.assertEqual(flash_sale_entries(s.ends_at + timedelta(days=1), s.ends_at + timedelta(days=2)), [])
        FlashSale.objects.update(status=FlashSale.SCHEDULED)
        self.as_staff(self.akua)
        nxt = self.client.get("/api/marketing/overview/").json()["scheduled_next"]
        self.assertIn("Flash sale: Kente Friday", [n["what"] for n in nxt])
        coupons = self.client.get("/api/marketing/overview/").json()["coupons"]
        self.assertEqual(coupons["state"], "not_tracked")
