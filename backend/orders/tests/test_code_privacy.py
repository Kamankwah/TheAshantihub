from delivery.models import ShiftSession
from orders.models import DeliveryAssignment as DA

from .test_tracking_privacy import TrackingPrivacyCase

PICKUP_CODE = "1357"
DROP_CODE = "2468"


class CodePrivacyTests(TrackingPrivacyCase):
    """The pickup code is the business's, the delivery code is the customer's; neither payload may carry the other."""

    def coded(self, status):
        a = self.tracked(status)
        a.pickup_code, a.drop_code = PICKUP_CODE, DROP_CODE
        a.save()
        return a

    def owner_body(self):
        self.login(self.owner, "business_owner")
        response = self.client.get("/api/orders/owner/")
        self.assertEqual(response.status_code, 200, response.content)
        return response.content.decode()

    def customer_response(self):
        self.login(self.customer, "customer")
        response = self.client.get("/api/orders/")
        self.assertEqual(response.status_code, 200, response.content)
        return response

    def test_owner_payload_never_holds_the_delivery_code(self):
        for status in (DA.ASSIGNED, DA.ACCEPTED, DA.AT_PICKUP, DA.PICKED_UP, DA.AT_CUSTOMER, DA.DELIVERED):
            with self.subTest(status=status):
                DA.objects.all().delete()
                ShiftSession.objects.all().delete()
                a = self.coded(status)
                body = self.owner_body()
                self.assertNotIn(DROP_CODE, body)
                self.assertNotIn("drop_code", body)
                self.assertNotIn("delivery_code", body)
                owner_row = {o["id"]: o for o in self.client.get("/api/orders/owner/").json()["results"]}[a.order_id]
                if status in (DA.ASSIGNED, DA.ACCEPTED, DA.AT_PICKUP):
                    self.assertEqual(owner_row["pickup_code"], PICKUP_CODE)
                else:
                    self.assertIsNone(owner_row["pickup_code"])

    def test_customer_payload_never_holds_the_pickup_code(self):
        for status in (DA.ASSIGNED, DA.ACCEPTED, DA.AT_PICKUP, DA.PICKED_UP, DA.AT_CUSTOMER, DA.DELIVERED):
            with self.subTest(status=status):
                DA.objects.all().delete()
                ShiftSession.objects.all().delete()
                self.coded(status)
                response = self.customer_response()
                body = response.content.decode()
                self.assertNotIn(PICKUP_CODE, body)
                self.assertNotIn("pickup_code", body)

    def test_customer_delivery_code_is_null_once_delivered(self):
        a = self.coded(DA.AT_CUSTOMER)
        row = {o["id"]: o for o in self.customer_response().json()}[a.order_id]
        self.assertEqual(row["delivery_code"], DROP_CODE)
        a.status = DA.DELIVERED
        a.save()
        response = self.customer_response()
        row = {o["id"]: o for o in response.json()}[a.order_id]
        self.assertIsNone(row["delivery_code"])
        self.assertNotIn(DROP_CODE, response.content.decode())
