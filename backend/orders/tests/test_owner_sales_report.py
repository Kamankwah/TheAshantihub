from decimal import Decimal

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, Customer
from listings.models import Category, Listing, Zone
from orders.models import Order, OrderItem


class OwnerSalesReportTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.owner = BusinessOwner.objects.create(
            full_name="Kwame Trader", login_phone="+233207886600", password_hash="x",
        )
        self.other_owner = BusinessOwner.objects.create(
            full_name="Ama Trader", login_phone="+233207886699", password_hash="x",
        )
        self.customer = Customer.objects.create(
            full_name="Yaa Buyer", phone="+233200886600", password_hash="x",
        )
        self.manhyia = Zone.objects.get(name="Manhyia")
        self.product = Listing.objects.create(
            business_owner=self.owner, category=Category.objects.filter(kind="product").first(),
            zone=self.manhyia, name="Kente Cloth", description="D.", contact_phone="+233207886600",
            price_amount="100.00", status=Listing.PUBLISHED,
        )
        self.service = Listing.objects.create(
            business_owner=self.owner, category=Category.objects.filter(kind="service").first(),
            zone=self.manhyia, name="Cleaning", description="D.", contact_phone="+233207886600",
            price_amount="50.00", status=Listing.PUBLISHED,
        )
        # Another business's product in a shared order.
        self.other_product = Listing.objects.create(
            business_owner=self.other_owner, category=Category.objects.filter(kind="product").first(),
            zone=self.manhyia, name="Other Thing", description="D.", contact_phone="+233207886699",
            price_amount="200.00", status=Listing.PUBLISHED,
        )

    def _auth(self, owner):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(owner, 'business_owner')}")

    def _paid_order(self, *lines):
        order = Order.objects.create(customer=self.customer, status=Order.PAID, total_amount="0.00")
        for listing, qty in lines:
            price = Decimal(str(listing.price_amount))
            OrderItem.objects.create(
                order=order, listing=listing, quantity=qty,
                unit_price=price, line_total=price * qty,
            )
        return order

    def test_report_sums_only_the_owners_own_sales(self):
        self._paid_order((self.product, 2), (self.other_product, 1))  # shared order
        self._auth(self.owner)
        report = self.client.get("/api/orders/owner/report/").json()
        # Owner's own line only: 100 × 2 = 200 (not the other business's 200).
        self.assertEqual(report["summary"]["total_sales"], "200.00")
        self.assertEqual(report["summary"]["item_count"], 1)

    def test_pending_orders_are_excluded(self):
        pending = Order.objects.create(customer=self.customer, status=Order.PENDING, total_amount="0.00")
        OrderItem.objects.create(order=pending, listing=self.product, quantity=1, unit_price="100.00", line_total="100.00")
        self._auth(self.owner)
        report = self.client.get("/api/orders/owner/report/").json()
        self.assertEqual(report["summary"]["item_count"], 0)

    def test_kind_filter(self):
        self._paid_order((self.product, 1), (self.service, 1))
        self._auth(self.owner)
        products = self.client.get("/api/orders/owner/report/?kind=product").json()
        self.assertEqual(products["summary"]["total_sales"], "100.00")
        services = self.client.get("/api/orders/owner/report/?kind=service").json()
        self.assertEqual(services["summary"]["total_sales"], "50.00")

    def test_date_filter(self):
        old = self._paid_order((self.product, 1))
        Order.objects.filter(pk=old.pk).update(placed_at=timezone.now() - timezone.timedelta(days=60))
        self._paid_order((self.product, 1))  # recent
        self._auth(self.owner)
        cutoff = (timezone.now() - timezone.timedelta(days=7)).date().isoformat()
        recent = self.client.get(f"/api/orders/owner/report/?date_from={cutoff}").json()
        self.assertEqual(recent["summary"]["item_count"], 1)

    def test_csv_export(self):
        self._paid_order((self.product, 2))
        self._auth(self.owner)
        response = self.client.get("/api/orders/owner/report/export/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "text/csv")
        self.assertIn("attachment", response["Content-Disposition"])
        body = response.content.decode()
        self.assertIn("Kente Cloth", body)
        self.assertIn("Line total (GHS)", body)

    def test_report_requires_a_business_owner(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.customer, 'customer')}")
        self.assertEqual(self.client.get("/api/orders/owner/report/").status_code, 403)
