from orders.serializers import DispatchDeliverySerializer

from .test_tracking import TrackingCase


class GhanaPostReachesTheRiderTests(TrackingCase):
    """The GhanaPost code and landmark the shopper gave at checkout must reach the people who run the delivery.
    An order from before they existed reads blank, never a missing key. The customer's phone is not added anywhere."""

    CODE, LANDMARK = "AK-039-5028", "Blue gate opposite the pharmacy"

    def stamp(self, order):
        order.delivery_gps_address, order.delivery_landmark = self.CODE, self.LANDMARK
        order.save()

    def test_rider_job_carries_the_code_and_landmark_and_blank_on_old_orders(self):
        a = self.job()
        self.stamp(a.order)
        self.as_staff(self.rider_staff)
        body = self.client.get(f"/api/delivery/rider/jobs/{a.pk}/").json()
        self.assertEqual((body["delivery_gps_address"], body["delivery_landmark"]), (self.CODE, self.LANDMARK))
        old = self.job(fix=None)
        self.as_staff(self.rider_staff)
        body = self.client.get(f"/api/delivery/rider/jobs/{old.pk}/").json()
        self.assertEqual((body["delivery_gps_address"], body["delivery_landmark"]), ("", ""))

    def test_dispatch_serializer_fields(self):
        a = self.job()
        self.stamp(a.order)
        data = DispatchDeliverySerializer(a).data
        self.assertEqual((data["delivery_gps_address"], data["delivery_landmark"]), (self.CODE, self.LANDMARK))
        self.assertEqual(
            set(data),
            {"id", "order_id", "status", "customer_name", "delivery_address", "delivery_gps_address", "delivery_landmark",
             "delivery_phone", "delivery_lat", "delivery_lng", "pickups", "assigned_at", "picked_up_at", "delivered_at", "confirmed_at"},
        )
        old = DispatchDeliverySerializer(self.job(fix=None)).data
        self.assertEqual((old["delivery_gps_address"], old["delivery_landmark"]), ("", ""))

    def test_manager_job_detail_carries_them(self):
        a = self.job()
        self.stamp(a.order)
        self.as_staff(self.manager)
        body = self.client.get(f"/api/delivery/jobs/{a.pk}/").json()
        self.assertEqual((body["delivery_gps_address"], body["delivery_landmark"]), (self.CODE, self.LANDMARK))
        self.assertNotIn("+233200882200", str(body))  # the phone stays masked
