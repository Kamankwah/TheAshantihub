from accounts.authentication import issue_token
from accounts.models import BusinessOwner, Customer
from delivery.models import ShiftSession
from delivery.tests.test_tracking import TrackingCase
from listings.models import Category, Listing, Zone
from orders.models import DeliveryAssignment as DA

ADDRESS = "12 Ash Road"
PIN = ("6.6123", "-1.5987")  # distinctive, so it cannot collide with the pickup or rider coordinates
PHONE = "+233200882200"


class TrackingPrivacyCase(TrackingCase):
    def setUp(self):
        super().setUp()
        self.other_customer = Customer.objects.create(full_name="Kofi Other", phone="+233200990011", password_hash="x")
        self.other_owner = BusinessOwner.objects.create(full_name="Efua Rival", login_phone="+233207990011", password_hash="x")
        Listing.objects.create(
            business_owner=self.other_owner, category=Category.objects.get(slug="hotels"), zone=Zone.objects.get(name="Manhyia"),
            name="Rival Item", description="D.", contact_phone="+233207990011", price_amount="5.00", status=Listing.PUBLISHED,
        )

    def login(self, account, kind):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(account, kind)}")

    def tracked(self, status=DA.ACCEPTED):
        a = self.job(status)
        order = a.order
        order.delivery_lat, order.delivery_lng = PIN
        order.save()
        return a

    def assert_no_leak(self, response, *needles):
        body = response.content.decode()
        for needle in needles:
            self.assertNotIn(needle, body)


class CustomerTrackingTests(TrackingPrivacyCase):
    def url(self, a):
        return f"/api/orders/{a.order_id}/tracking/"

    def test_other_customer_gets_404(self):
        a = self.tracked(DA.PICKED_UP)
        self.login(self.other_customer, "customer")
        self.assertEqual(self.client.get(self.url(a)).status_code, 404)

    def test_business_owner_and_anonymous_refused(self):
        a = self.tracked(DA.PICKED_UP)
        self.client.credentials()
        self.assertIn(self.client.get(self.url(a)).status_code, (401, 403))
        self.login(self.owner, "business_owner")
        self.assertEqual(self.client.get(self.url(a)).status_code, 403)

    def test_no_assignment_is_not_assigned(self):
        order = self.make_order()
        self.login(self.customer, "customer")
        r = self.client.get(f"/api/orders/{order.pk}/tracking/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json(), {"stage": "not_assigned"})

    def test_rider_hidden_before_pickup(self):
        a = self.tracked(DA.ACCEPTED)
        self.login(self.customer, "customer")
        r = self.client.get(self.url(a))
        self.assertEqual(r.status_code, 200, r.content)
        self.assertIsNone(r.json()["rider"])
        self.assert_no_leak(r, "Yaw", "Mensah", "6.695")

    def test_rider_after_pickup_is_first_name_and_vehicle_only(self):
        a = self.tracked(DA.PICKED_UP)
        self.login(self.customer, "customer")
        r = self.client.get(self.url(a))
        self.assertEqual(r.status_code, 200, r.content)
        rider = r.json()["rider"]
        self.assertEqual(rider["first_name"], "Yaw")
        self.assertIn("vehicle_type", rider)
        self.assert_no_leak(r, "Mensah", self.rider_staff.phone, "phone", "staff_id", "full_name", "pickup_code", "drop_code", "pickup")

    def test_customer_payload_has_no_codes(self):
        a = self.tracked(DA.PICKED_UP)
        self.login(self.customer, "customer")
        body = self.client.get(self.url(a)).content.decode()
        self.assertNotIn(a.pickup_code, body)
        self.assertNotIn(a.drop_code, body)
        self.assertNotIn("code", body)


class OwnerTrackingTests(TrackingPrivacyCase):
    def url(self, a):
        return f"/api/orders/owner/{a.order_id}/tracking/"

    def test_owner_not_on_the_order_gets_404(self):
        a = self.tracked()
        self.login(self.other_owner, "business_owner")
        self.assertEqual(self.client.get(self.url(a)).status_code, 404)

    def test_customer_and_anonymous_refused(self):
        a = self.tracked()
        self.client.credentials()
        self.assertIn(self.client.get(self.url(a)).status_code, (401, 403))
        self.login(self.customer, "customer")
        self.assertEqual(self.client.get(self.url(a)).status_code, 403)

    def test_no_assignment_is_not_assigned(self):
        order = self.make_order()
        self.login(self.owner, "business_owner")
        r = self.client.get(f"/api/orders/owner/{order.pk}/tracking/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json(), {"stage": "not_assigned"})

    def test_owner_never_sees_the_customer_side(self):
        for status in (DA.ASSIGNED, DA.ACCEPTED, DA.AT_PICKUP, DA.PICKED_UP, DA.AT_CUSTOMER):
            with self.subTest(status=status):
                DA.objects.all().delete()
                ShiftSession.objects.all().delete()
                a = self.tracked(status)
                self.login(self.owner, "business_owner")
                r = self.client.get(self.url(a))
                self.assertEqual(r.status_code, 200, r.content)
                self.assertNotIn("drop", r.json())
                self.assert_no_leak(r, ADDRESS, PIN[0], PIN[1], "delivery_lat", "delivery_lng", "drop", PHONE,
                                    "Ama", "Buyer", a.pickup_code, a.drop_code)

    def test_rider_visible_only_on_the_way_to_the_business(self):
        a = self.tracked(DA.AT_PICKUP)
        self.login(self.owner, "business_owner")
        self.assertIsNotNone(self.client.get(self.url(a)).json()["rider"])
        a.status = DA.PICKED_UP
        a.save()
        r = self.client.get(self.url(a))
        self.assertIsNone(r.json()["rider"])
        self.assert_no_leak(r, "Mensah", "6.695")
