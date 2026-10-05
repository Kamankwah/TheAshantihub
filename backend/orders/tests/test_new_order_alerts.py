from django.core import mail
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, Customer
from listings.models import Category, Listing, Zone
from notifications.models import Notification
from orders.models import Order, OrderItem
from payments.models import CheckoutSession
from payments.services import _finalize_order_checkout


class NewOrderAlertTests(TestCase):
    """A paid order alerts each business owner with items in it, once, in-app
    and by email, and each owner sees only their own lines (an order can span
    several businesses — same isolation rule as GET /api/orders/owner/)."""

    def setUp(self):
        self.client = APIClient()
        self.weaver = BusinessOwner.objects.create(
            full_name="Akua Weaver", login_phone="+233207663001", password_hash="x",
            email="weaver@example.com",
        )
        self.tailor = BusinessOwner.objects.create(
            full_name="Kwame Tailor", login_phone="+233207663002", password_hash="x",
            email="tailor@example.com",
        )
        self.customer = Customer.objects.create(
            full_name="Ama Buyer", phone="+233200663001", password_hash="x",
        )
        category = Category.objects.get(slug="hotels")
        zone = Zone.objects.get(name="Manhyia")

        def listing(owner, name, price):
            return Listing.objects.create(
                business_owner=owner, category=category, zone=zone, name=name,
                description="D.", contact_phone=owner.login_phone,
                price_amount=price, status=Listing.PUBLISHED,
            )

        self.stole = listing(self.weaver, "Kente stole", "250.00")
        self.strip = listing(self.weaver, "Kente strip", "90.00")
        self.shirt = listing(self.tailor, "Smock shirt", "120.00")

    def _checkout(self, *lines):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.customer, 'customer')}")
        for item, quantity in lines:
            self.client.post("/api/cart/items/", {"listing": item.id, "quantity": quantity}, format="json")
        with self.captureOnCommitCallbacks(execute=True):
            response = self.client.post("/api/orders/checkout/")
        self.assertEqual(response.status_code, 201, response.content)
        return Order.objects.get(id=response.json()["id"])

    def test_paid_order_notifies_each_owner_once_with_only_their_lines(self):
        order = self._checkout((self.stole, 2), (self.strip, 1), (self.shirt, 1))

        weaver_alerts = Notification.objects.filter(business_owner=self.weaver)
        tailor_alerts = Notification.objects.filter(business_owner=self.tailor)
        self.assertEqual(weaver_alerts.count(), 1)
        self.assertEqual(tailor_alerts.count(), 1)

        weaver_alert = weaver_alerts.get()
        self.assertEqual(weaver_alert.kind, Notification.NEW_ORDER)
        self.assertEqual(weaver_alert.title, f"New order #{order.id}")
        self.assertEqual(weaver_alert.link, "/business-dashboard")
        self.assertIn("Kente stole", weaver_alert.body)
        self.assertIn("Kente strip", weaver_alert.body)
        self.assertNotIn("Smock shirt", weaver_alert.body)

        tailor_alert = tailor_alerts.get()
        self.assertIn("Smock shirt", tailor_alert.body)
        self.assertNotIn("Kente", tailor_alert.body)

    def test_paid_order_emails_each_owner_only_their_lines_and_subtotal(self):
        order = self._checkout((self.stole, 2), (self.strip, 1), (self.shirt, 1))

        self.assertEqual(len(mail.outbox), 2)
        by_recipient = {message.to[0]: message for message in mail.outbox}
        weaver_email = by_recipient["weaver@example.com"]
        tailor_email = by_recipient["tailor@example.com"]

        self.assertEqual(weaver_email.subject, f"New order #{order.id} on AshantiHub")
        self.assertIn("2 × Kente stole", weaver_email.body)
        self.assertIn("1 × Kente strip", weaver_email.body)
        self.assertIn("GHS 590.00", weaver_email.body)  # 250*2 + 90, the weaver's lines only
        self.assertIn("/business-dashboard", weaver_email.body)
        self.assertNotIn("Smock shirt", weaver_email.body)
        self.assertNotIn("Ama Buyer", weaver_email.body)  # no customer details in an owner email

        self.assertIn("1 × Smock shirt", tailor_email.body)
        self.assertIn("GHS 120.00", tailor_email.body)
        self.assertNotIn("Kente", tailor_email.body)

    def test_owner_without_an_email_still_gets_the_in_app_alert(self):
        self.tailor.email = None
        self.tailor.save(update_fields=["email"])

        self._checkout((self.shirt, 1))

        self.assertEqual(Notification.objects.filter(business_owner=self.tailor).count(), 1)
        self.assertEqual(len(mail.outbox), 0)

    def test_finalizing_an_already_paid_order_does_not_alert_again(self):
        order = Order.objects.create(customer=self.customer, status=Order.PENDING, total_amount="250.00")
        OrderItem.objects.create(
            order=order, listing=self.stole, quantity=1, unit_price="250.00", line_total="250.00",
        )
        session = CheckoutSession.objects.create(
            customer=self.customer, kind=CheckoutSession.ORDER_CHECKOUT, amount="250.00",
            purpose=f"AshantiHub Order #{order.id}", metadata={"order_id": order.id},
        )

        with self.captureOnCommitCallbacks(execute=True):
            _finalize_order_checkout(session)
        with self.captureOnCommitCallbacks(execute=True):
            _finalize_order_checkout(session)  # e.g. a replayed payment webhook

        order.refresh_from_db()
        self.assertEqual(order.status, Order.PAID)
        self.assertEqual(Notification.objects.filter(business_owner=self.weaver).count(), 1)
        self.assertEqual(len(mail.outbox), 1)

    def test_email_waits_for_the_transaction_to_commit(self):
        order = Order.objects.create(customer=self.customer, status=Order.PENDING, total_amount="90.00")
        OrderItem.objects.create(
            order=order, listing=self.strip, quantity=1, unit_price="90.00", line_total="90.00",
        )
        session = CheckoutSession.objects.create(
            customer=self.customer, kind=CheckoutSession.ORDER_CHECKOUT, amount="90.00",
            purpose=f"AshantiHub Order #{order.id}", metadata={"order_id": order.id},
        )

        with self.captureOnCommitCallbacks(execute=False) as callbacks:
            _finalize_order_checkout(session)
        self.assertEqual(len(mail.outbox), 0)  # nothing sent before commit

        for callback in callbacks:
            callback()
        self.assertEqual(len(mail.outbox), 1)
