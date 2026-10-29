from django.core import mail
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, Customer, Role, StaffUser
from listings.models import Category, Listing, Zone
from notifications.models import Notification
from orders.models import DeliveryAssignment, Order, OrderItem, OrderSupportNote
from orders.support import delivery_events_for


class SupportOrderTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.owner = BusinessOwner.objects.create(full_name="Kofi Trader", login_phone="+233207883320", password_hash="x")
        self.customer = Customer.objects.create(
            full_name="Yaw Mensah", phone="+233245550123", email="yaw@example.com", password_hash="x",
        )
        self.listing = Listing.objects.create(
            business_owner=self.owner, category=Category.objects.get(slug="hotels"), zone=Zone.objects.get(name="Manhyia"),
            name="Kente stole", description="A stole.", contact_phone="+233207112233",
            price_amount="420.00", status=Listing.PUBLISHED, stock_quantity=4,
        )
        self.order = Order.objects.create(
            customer=self.customer, status=Order.PAID, total_amount="420.00",
            delivery_method=Order.DOOR_TO_DOOR, delivery_address="Ahodwo, Kumasi", delivery_phone="0245550123",
        )
        OrderItem.objects.create(order=self.order, listing=self.listing, quantity=1, unit_price="420.00", line_total="420.00")
        self.support = StaffUser.objects.create(
            full_name="Esi Nyarko", email="support-so@example.com", password_hash="x", role=Role.objects.get(name="support"),
        )
        self.marketing = StaffUser.objects.create(
            full_name="Mark Eting", email="mkt-so@example.com", password_hash="x", role=Role.objects.get(name="marketing"),
        )

    def auth(self, staff):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(staff, 'staff')}")

    def post(self, **body):
        return self.client.post(f"/api/orders/{self.order.pk}/support-status/", body, format="json")

    # search and detail
    def test_search_by_number_name_and_phone_with_masked_phone(self):
        self.auth(self.support)
        for q in (str(self.order.pk), f"#{self.order.pk}", "yaw", "024 555 0123"):
            results = self.client.get("/api/orders/support/", {"q": q}).json()["results"]
            self.assertEqual([r["id"] for r in results], [self.order.pk], q)
        row = self.client.get("/api/orders/support/", {"q": "yaw"}).json()["results"][0]
        self.assertEqual(row["customer_phone"], "024 *** 0123")
        self.assertNotIn("245550123", str(row))

    def test_detail_carries_the_ghanapost_code_and_landmark_blank_on_old_orders(self):
        self.auth(self.support)
        body = self.client.get(f"/api/orders/support/{self.order.pk}/").json()
        self.assertEqual((body["delivery_gps_address"], body["delivery_landmark"]), ("", ""))
        Order.objects.filter(pk=self.order.pk).update(delivery_gps_address="AK-039-5028", delivery_landmark="Blue gate")
        body = self.client.get(f"/api/orders/support/{self.order.pk}/").json()
        self.assertEqual((body["delivery_gps_address"], body["delivery_landmark"]), ("AK-039-5028", "Blue gate"))

    def test_search_finds_nothing_for_an_unknown_term(self):
        self.auth(self.support)
        self.assertEqual(self.client.get("/api/orders/support/", {"q": "nobody"}).json()["results"], [])

    def test_detail_masks_phones_and_email_and_lists_only_stamped_steps(self):
        DeliveryAssignment.objects.create(order=self.order, status=DeliveryAssignment.ASSIGNED)
        self.auth(self.support)
        data = self.client.get(f"/api/orders/support/{self.order.pk}/").json()
        self.assertEqual(data["delivery_phone"], "024 *** 0123")
        self.assertEqual(data["customer_phone"], "024 *** 0123")
        self.assertNotIn("yaw@example.com", str(data))
        self.assertEqual([e["key"] for e in data["timeline"]], ["placed", "assigned"])
        self.assertIn("Delivery", data["delivery_note"])
        self.assertEqual(data["actions"], ["running_late", "cancelled_by_customer"])
        self.assertIsNone(data["refundable"])                     # the ledger is off: no figure is invented

    @override_settings(LEDGER_ENABLED=True)
    def test_detail_carries_what_can_still_be_refunded(self):
        from ledger import escrow

        escrow.record_order_payment(self.order)
        self.auth(self.support)
        self.assertEqual(self.client.get(f"/api/orders/support/{self.order.pk}/").json()["refundable"], "420.00")

    def test_the_payments_banner_comes_from_the_provider_setting(self):
        self.auth(self.support)
        with override_settings(PAYMENTS_PROVIDER="simulated"):
            payments = self.client.get(f"/api/orders/support/{self.order.pk}/").json()["payments"]
        self.assertEqual(payments["provider"], "simulated")
        self.assertIn("simulated", payments["text"])
        with override_settings(PAYMENTS_PROVIDER="hubtel"):
            payments = self.client.get(f"/api/orders/support/{self.order.pk}/").json()["payments"]
        self.assertEqual(payments, {"provider": "hubtel", "text": ""})

    def test_search_and_detail_need_the_permission(self):
        self.auth(self.marketing)
        self.assertEqual(self.client.get("/api/orders/support/").status_code, 403)
        self.assertEqual(self.client.get(f"/api/orders/support/{self.order.pk}/").status_code, 403)
        self.client.credentials()
        self.assertEqual(self.client.get("/api/orders/support/").status_code, 401)

    def test_delivery_events_for_lists_support_notes_in_order(self):
        OrderSupportNote.objects.create(order=self.order, staff=self.support, kind="running_late", reason="Traffic", expected_time="12:15")
        events = delivery_events_for(self.order)
        self.assertEqual([e["key"] for e in events], ["placed", "running_late"])
        self.assertIn("12:15", events[1]["detail"])

    # actions
    def test_running_late_keeps_a_note_and_the_delivery_status_and_tells_the_customer(self):
        self.auth(self.support)
        response = self.post(status="running_late", reason="Rider stuck in traffic", expected_time="about 12:15")
        self.assertEqual(response.status_code, 200, response.content)
        self.order.refresh_from_db()
        self.assertEqual(self.order.delivery_status, Order.PROCESSING)
        self.assertEqual(self.order.status, Order.PAID)
        note = OrderSupportNote.objects.get()
        self.assertEqual((note.staff, note.expected_time), (self.support, "about 12:15"))
        self.assertTrue(Notification.objects.filter(customer=self.customer, kind="order_status").exists())
        self.assertEqual(mail.outbox[0].to, ["yaw@example.com"])
        self.assertIn("about 12:15", mail.outbox[0].body)

    def test_running_late_needs_a_reason_and_a_new_time(self):
        self.auth(self.support)
        self.assertEqual(self.post(status="running_late", expected_time="12:15").status_code, 400)
        self.assertEqual(self.post(status="running_late", reason="Traffic").status_code, 400)
        self.assertEqual(OrderSupportNote.objects.count(), 0)

    def test_support_can_never_set_delivered_through_the_endpoint(self):
        self.auth(self.support)
        for status in ("delivered", "Delivered", "out_for_delivery", "shipped", "processing", "arrived", "paid", ""):
            response = self.post(status=status, reason="x", expected_time="x", delivery_status="delivered")
            self.assertEqual(response.status_code, 400, status)
        self.order.refresh_from_db()
        self.assertEqual(self.order.delivery_status, Order.PROCESSING)
        self.assertEqual(OrderSupportNote.objects.count(), 0)
        # An extra delivery_status field next to a valid status is ignored too.
        self.post(status="running_late", reason="x", expected_time="x", delivery_status="delivered")
        self.order.refresh_from_db()
        self.assertEqual(self.order.delivery_status, Order.PROCESSING)

    def test_support_no_longer_has_the_legacy_delivery_status_patch(self):
        self.auth(self.support)
        response = self.client.patch(f"/api/orders/{self.order.pk}/delivery-status/", {"delivery_status": "delivered"}, format="json")
        self.assertEqual(response.status_code, 403)
        self.order.refresh_from_db()
        self.assertEqual(self.order.delivery_status, Order.PROCESSING)

    def test_cancel_before_pickup_cancels_restocks_and_notifies(self):
        DeliveryAssignment.objects.create(order=self.order, status=DeliveryAssignment.ASSIGNED)
        self.auth(self.support)
        response = self.post(status="cancelled_by_customer", reason="Customer changed their mind")
        self.assertEqual(response.status_code, 200, response.content)
        self.order.refresh_from_db()
        self.listing.refresh_from_db()
        self.assertEqual(self.order.status, Order.CANCELLED)
        self.assertEqual(self.listing.stock_quantity, 5)
        self.assertFalse(DeliveryAssignment.objects.filter(order=self.order).exists())
        self.assertEqual(response.json()["actions"], [])
        self.assertIn("cancelled", Notification.objects.get(customer=self.customer).title.lower())
        self.assertEqual(self.post(status="cancelled_by_customer", reason="again").status_code, 409)
        self.listing.refresh_from_db()
        self.assertEqual(self.listing.stock_quantity, 5)  # not restocked twice

    def test_cancel_after_pickup_is_refused(self):
        DeliveryAssignment.objects.create(order=self.order, status=DeliveryAssignment.PICKED_UP, picked_up_at=timezone.now())
        self.order.delivery_status = Order.OUT_FOR_DELIVERY
        self.order.save()
        self.auth(self.support)
        self.assertEqual(self.post(status="cancelled_by_customer", reason="x").status_code, 409)
        self.order.refresh_from_db()
        self.assertEqual(self.order.status, Order.PAID)

    def test_support_screen_still_refuses_cancel_after_pickup(self):
        DeliveryAssignment.objects.create(order=self.order, status=DeliveryAssignment.PICKED_UP, picked_up_at=timezone.now())
        self.order.delivery_status = Order.OUT_FOR_DELIVERY
        self.order.save()
        self.auth(self.support)
        response = self.post(status="cancelled_by_customer", reason="x")
        self.assertEqual(response.status_code, 409)
        self.assertEqual(DeliveryAssignment.objects.get(order=self.order).status, DeliveryAssignment.PICKED_UP)

    def test_a_delivered_order_accepts_neither_action(self):
        self.order.delivery_status = Order.DELIVERED
        self.order.save()
        self.auth(self.support)
        self.assertEqual(self.post(status="running_late", reason="x", expected_time="x").status_code, 409)
        self.assertEqual(self.post(status="cancelled_by_customer", reason="x").status_code, 409)

    def test_the_status_endpoint_needs_the_permission(self):
        self.auth(self.marketing)
        self.assertEqual(self.post(status="running_late", reason="x", expected_time="x").status_code, 403)
        self.client.credentials()
        self.assertEqual(self.post(status="running_late", reason="x", expected_time="x").status_code, 401)
