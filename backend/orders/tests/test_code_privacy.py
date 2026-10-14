from datetime import datetime, timezone

from delivery.models import ShiftSession
from listings.models import Listing
from orders.models import DeliveryAssignment as DA, OrderItem

from .test_tracking_privacy import TrackingPrivacyCase

PICKUP_CODE = "1357"
DROP_CODE = "2468"
FIXED_TIME = datetime(2026, 10, 13, 9, 0, 0, tzinfo=timezone.utc)
# Fields whose value is a timestamp, an id or a money figure: digits there are not a leak.
NEUTRAL_KEYS = {"id", "placed_at", "listing", "order", "quantity", "owner_subtotal", "total_amount", "unit_price", "line_total",
                "delivery_fee", "delivery_lat", "delivery_lng"}


def values(node, key=None):
    """Every leaf value in parsed JSON, with the key it sits under, skipping neutral keys."""
    if isinstance(node, dict):
        for k, v in node.items():
            yield from values(v, k)
    elif isinstance(node, list):
        for v in node:
            yield from values(v, key)
    elif key not in NEUTRAL_KEYS:
        yield key, node


class CodePrivacyTests(TrackingPrivacyCase):
    """The pickup code is the business's, the delivery code is the customer's; neither payload may carry the other."""

    def coded(self, status):
        a = self.tracked(status)
        a.pickup_code, a.drop_code = PICKUP_CODE, DROP_CODE
        a.save()
        a.order.placed_at = FIXED_TIME
        a.order.save()
        return a

    def reset(self):
        DA.objects.all().delete()
        ShiftSession.objects.all().delete()

    def get_json(self, account, kind, url):
        self.login(account, kind)
        response = self.client.get(url)
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()

    def assert_code_absent(self, payload, code, *key_names):
        raw = repr(payload)
        for name in key_names:
            self.assertNotIn(f"'{name}'", raw)
        for key, value in values(payload):
            self.assertNotIn(code, str(value), f"{code} found under {key}")

    def test_owner_payload_never_holds_the_delivery_code(self):
        for status in (DA.ASSIGNED, DA.ACCEPTED, DA.AT_PICKUP, DA.PICKED_UP, DA.AT_CUSTOMER, DA.DELIVERED):
            with self.subTest(status=status):
                self.reset()
                a = self.coded(status)
                payload = self.get_json(self.owner, "business_owner", "/api/orders/owner/")
                self.assert_code_absent(payload, DROP_CODE, "drop_code", "delivery_code")
                row = {o["id"]: o for o in payload["results"]}[a.order_id]
                if status in (DA.ASSIGNED, DA.ACCEPTED, DA.AT_PICKUP):
                    self.assertEqual(row["pickup_code"], PICKUP_CODE)
                else:
                    self.assertIsNone(row["pickup_code"])

    def test_customer_payload_never_holds_the_pickup_code(self):
        for status in (DA.ASSIGNED, DA.ACCEPTED, DA.AT_PICKUP, DA.PICKED_UP, DA.AT_CUSTOMER, DA.DELIVERED):
            with self.subTest(status=status):
                self.reset()
                self.coded(status)
                payload = self.get_json(self.customer, "customer", "/api/orders/")
                self.assert_code_absent(payload, PICKUP_CODE, "pickup_code")

    def test_customer_delivery_code_is_null_once_delivered(self):
        a = self.coded(DA.AT_CUSTOMER)
        row = {o["id"]: o for o in self.get_json(self.customer, "customer", "/api/orders/")}[a.order_id]
        self.assertEqual(row["delivery_code"], DROP_CODE)
        a.status = DA.DELIVERED
        a.save()
        payload = self.get_json(self.customer, "customer", "/api/orders/")
        row = {o["id"]: o for o in payload}[a.order_id]
        self.assertIsNone(row["delivery_code"])
        self.assert_code_absent(payload, DROP_CODE)

    def test_a_second_business_on_a_shared_order_gets_no_pickup_code(self):
        a = self.coded(DA.AT_PICKUP)
        OrderItem.objects.create(order=a.order, listing=Listing.objects.get(business_owner=self.other_owner),
                                 quantity=1, unit_price="5.00", line_total="5.00")
        other = self.get_json(self.other_owner, "business_owner", "/api/orders/owner/")
        self.assertIsNone({o["id"]: o for o in other["results"]}[a.order_id]["pickup_code"])
        self.assert_code_absent(other, PICKUP_CODE, "drop_code", "delivery_code")
        first = self.get_json(self.owner, "business_owner", "/api/orders/owner/")
        self.assertEqual({o["id"]: o for o in first["results"]}[a.order_id]["pickup_code"], PICKUP_CODE)
