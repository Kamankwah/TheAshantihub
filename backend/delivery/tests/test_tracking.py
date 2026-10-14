import json
from datetime import timedelta
from unittest import mock

from django.core.cache import cache
from django.utils import timezone

from accounts.models import BusinessOwnerProfile
from delivery import tracking
from delivery.models import Offer, ShiftSession
from orders.models import DeliveryAssignment as DA
from routing import service as routing_service
from routing.client import OsrmUnavailable

from .base import DROP, PICKUP
from .test_dispatch import EngineCase

ROAD = {"distance_km": 1.2, "duration_s": 240, "basis": routing_service.BASIS_ROAD, "geometry": [[-1.62, 6.7], [-1.62, 6.69]]}


class TrackingCase(EngineCase):
    def setUp(self):
        super().setUp()
        self.rider_staff.full_name = "Yaw Mensah"
        self.rider_staff.save()
        cache.clear()

    def job(self, status=DA.ACCEPTED, fix=(6.695, -1.62), age=5):
        order = self.make_order()
        a = self.assign(order)
        a.status = status
        a.save()
        if fix:
            self.on_shift(self.rider, fix, age=age)
        return a


class HelperTests(TrackingCase):
    def test_line_swaps_geojson_order(self):
        self.assertEqual(tracking.line([[-1.6, 6.7], [-1.5, 6.8]]), [[6.7, -1.6], [6.8, -1.5]])
        self.assertIsNone(tracking.line(None))
        self.assertIsNone(tracking.line([]))

    def test_rider_fix_none_without_shift_and_stale_flag(self):
        a = self.job(fix=None)
        self.assertIsNone(tracking.rider_fix(a))
        self.on_shift(self.rider, (6.69, -1.62), age=5)
        fix = tracking.rider_fix(a)
        self.assertFalse(fix["stale"])
        self.assertEqual((fix["lat"], fix["lng"]), (6.69, -1.62))
        ShiftSession.objects.filter(rider=self.rider).update(last_fix_at=timezone.now() - timedelta(seconds=500))
        self.assertTrue(tracking.rider_fix(a)["stale"])

    def test_rider_fix_ignores_a_fix_looser_than_the_accuracy_limit(self):
        from delivery import services
        a = self.job()
        ShiftSession.objects.filter(rider=self.rider).update(last_accuracy_m=services.MAX_ACCURACY_M + 1)
        self.assertIsNone(tracking.rider_fix(a))
        ShiftSession.objects.filter(rider=self.rider).update(last_accuracy_m=services.MAX_ACCURACY_M)
        self.assertIsNotNone(tracking.rider_fix(a))

    def test_rider_fix_none_when_shift_has_no_fix(self):
        a = self.job(fix=None)
        ShiftSession.objects.create(rider=self.rider)
        self.assertIsNone(tracking.rider_fix(a))

    def test_next_stop_per_status(self):
        a = self.job()
        got = {}
        for s in (DA.ASSIGNED, DA.ACCEPTED, DA.AT_PICKUP, DA.PICKED_UP, DA.AT_CUSTOMER, DA.DELIVERED):
            a.status = s
            got[s] = tracking.next_stop(a)
        self.assertEqual(got, {DA.ASSIGNED: "pickup", DA.ACCEPTED: "pickup", DA.AT_PICKUP: "pickup",
                               DA.PICKED_UP: "drop", DA.AT_CUSTOMER: "drop", DA.DELIVERED: None})


class ManagerTests(TrackingCase):
    def test_manager_map_has_everything(self):
        a = self.job(DA.PICKED_UP)
        with mock.patch("delivery.tracking.routing_service.leg", return_value=dict(ROAD)):
            p = tracking.manager_job_map(a)
        self.assertEqual(p["stage"], DA.PICKED_UP)
        self.assertEqual(p["leg"]["to"], "drop")
        self.assertEqual(p["leg"]["basis"], routing_service.BASIS_ROAD)
        self.assertNotIn("geometry", p["leg"])
        self.assertEqual(p["route"], [[6.7, -1.62], [6.69, -1.62]])
        self.assertEqual(p["rider"]["name"], "Yaw Mensah")
        self.assertEqual(p["drop"], {"lat": DROP[0], "lng": DROP[1]})
        json.dumps(p)

    def test_osrm_down_gives_estimate_and_no_route(self):
        a = self.job(DA.ACCEPTED)
        with mock.patch("routing.client.route", side_effect=OsrmUnavailable("down")), self.settings(OSRM_URL="http://osrm"):
            p = tracking.manager_job_map(a)
        self.assertEqual(p["leg"]["basis"], routing_service.BASIS_ESTIMATE)
        self.assertIsNone(p["route"])
        self.assertEqual(p["leg"]["to"], "pickup")

    def test_no_fix_no_rider_no_leg(self):
        a = self.job(fix=None)
        p = tracking.manager_job_map(a)
        self.assertIsNone(p["rider"])
        self.assertIsNone(p["leg"])
        self.assertIsNone(p["route"])


class CustomerTests(TrackingCase):
    def test_no_rider_before_pickup(self):
        a = self.job(DA.ACCEPTED)
        p = tracking.customer_map(a)
        self.assertIsNone(p["rider"])
        self.assertIsNone(p["leg"])
        self.assertIsNone(p["route"])

    def test_first_name_only_after_pickup(self):
        a = self.job(DA.PICKED_UP)
        with mock.patch("delivery.tracking.routing_service.leg", return_value=dict(ROAD)):
            p = tracking.customer_map(a)
        self.assertEqual(p["rider"]["first_name"], "Yaw")
        self.assertEqual(p["rider"]["vehicle_type"], self.rider.vehicle_type)
        text = json.dumps(p)
        self.assertNotIn("Mensah", text)
        self.assertNotIn(self.rider_staff.phone, text)
        self.assertNotIn(a.pickup_code, text)
        self.assertNotIn(a.drop_code, text)
        self.assertNotIn("pickup", p)


    def test_no_drop_pin_means_no_drop_and_no_leg(self):
        a = self.job(DA.PICKED_UP)
        type(a.order).objects.filter(pk=a.order_id).update(delivery_lat=None, delivery_lng=None)
        a = DA.objects.get(pk=a.pk)
        p = tracking.customer_map(a)
        self.assertIsNone(p["drop"])
        self.assertIsNotNone(p["rider"])
        self.assertIsNone(p["leg"])
        self.assertIsNone(p["route"])


class BusyRiderTests(TrackingCase):
    """A rider can hold two jobs; they work the oldest first. The newer job's watchers see no rider."""

    def two_jobs(self, status=DA.PICKED_UP):
        BusinessOwnerProfile.objects.update_or_create(business_owner=self.owner, defaults={"lat": PICKUP[0], "lng": PICKUP[1]})
        older = self.job(status)
        newer = self.assign(self.make_order())
        newer.status = status
        newer.save()
        DA.objects.filter(pk=older.pk).update(assigned_at=timezone.now() - timedelta(hours=1))
        return DA.objects.get(pk=older.pk), DA.objects.get(pk=newer.pk)

    def test_customer_of_the_second_parcel_does_not_see_the_rider_until_the_first_is_done(self):
        a, b = self.two_jobs(DA.PICKED_UP)
        with mock.patch("delivery.tracking.routing_service.leg", return_value=dict(ROAD)):
            pa, pb = tracking.customer_map(a), tracking.customer_map(b)
            self.assertIsNotNone(pa["rider"])
            self.assertFalse(pa["rider_busy"])
            self.assertIsNone(pb["rider"])
            self.assertIsNone(pb["leg"])
            self.assertIsNone(pb["route"])
            self.assertTrue(pb["rider_busy"])
            DA.objects.filter(pk=a.pk).update(status=DA.DELIVERED)
            pb = tracking.customer_map(DA.objects.get(pk=b.pk))
        self.assertIsNotNone(pb["rider"])
        self.assertFalse(pb["rider_busy"])

    def test_vendor_of_the_second_order_does_not_see_the_rider_until_the_first_is_done(self):
        a, b = self.two_jobs(DA.ACCEPTED)
        with mock.patch("delivery.tracking.routing_service.leg", return_value=dict(ROAD)):
            pa, pb = tracking.business_map(a, self.owner), tracking.business_map(b, self.owner)
            self.assertIsNotNone(pa["rider"])
            self.assertFalse(pa["rider_busy"])
            self.assertIsNone(pb["rider"])
            self.assertIsNone(pb["leg"])
            self.assertIsNone(pb["route"])
            self.assertTrue(pb["rider_busy"])
            DA.objects.filter(pk=a.pk).update(status=DA.DELIVERED)
            pb = tracking.business_map(DA.objects.get(pk=b.pk), self.owner)
        self.assertIsNotNone(pb["rider"])
        self.assertFalse(pb["rider_busy"])

    def test_manager_still_sees_the_rider_on_either_job(self):
        a, b = self.two_jobs(DA.ACCEPTED)
        with mock.patch("delivery.tracking.routing_service.leg", return_value=dict(ROAD)):
            self.assertIsNotNone(tracking.manager_job_map(b)["rider"])

    def test_owner_list_flag_follows_the_current_job(self):
        from orders.serializers import OwnerOrderSerializer
        a, b = self.two_jobs(DA.ACCEPTED)
        flag = lambda x: OwnerOrderSerializer(x.order, context={"owner": self.owner}).data["rider_heading_here"]
        self.assertTrue(flag(DA.objects.select_related("order").get(pk=a.pk)))
        self.assertFalse(flag(DA.objects.select_related("order").get(pk=b.pk)))
        DA.objects.filter(pk=a.pk).update(status=DA.DELIVERED)
        self.assertTrue(flag(DA.objects.select_related("order").get(pk=b.pk)))


class BusinessTests(TrackingCase):
    def test_shop_pin_falls_back_to_the_listing_coordinates_the_rider_navigates_to(self):
        BusinessOwnerProfile.objects.filter(business_owner=self.owner).update(lat=None, lng=None)
        self.listing.lat, self.listing.lng = PICKUP
        self.listing.save()
        a = self.job(DA.ACCEPTED)
        with mock.patch("delivery.tracking.routing_service.leg", return_value=dict(ROAD)):
            p = tracking.business_map(a, self.owner)
        self.assertEqual((p["pickup"]["lat"], p["pickup"]["lng"]), tuple(float(x) for x in PICKUP))

    def test_no_shop_pin_means_no_pickup_and_no_leg(self):
        BusinessOwnerProfile.objects.filter(business_owner=self.owner).update(lat=None, lng=None)
        self.listing.lat = self.listing.lng = None
        self.listing.save()
        a = self.job(DA.ACCEPTED)
        p = tracking.business_map(a, self.owner)
        self.assertIsNone(p["pickup"])
        self.assertIsNone(p["leg"])
        self.assertIsNotNone(p["rider"])

    def test_business_never_sees_customer_and_only_before_pickup(self):
        BusinessOwnerProfile.objects.update_or_create(business_owner=self.owner, defaults={"lat": PICKUP[0], "lng": PICKUP[1]})
        a = self.job(DA.AT_PICKUP)
        with mock.patch("delivery.tracking.routing_service.leg", return_value=dict(ROAD)):
            p = tracking.business_map(a, self.owner)
        self.assertIsNotNone(p["rider"])
        for key in ("drop", "delivery_lat", "delivery_lng", "delivery_address"):
            self.assertNotIn(key, p)
        text = json.dumps(p)
        self.assertNotIn("12 Ash Road", text)
        self.assertNotIn(a.pickup_code, text)
        self.assertNotIn(a.drop_code, text)
        a.status = DA.PICKED_UP
        a.save()
        p = tracking.business_map(a, self.owner)
        self.assertIsNone(p["rider"])
        self.assertIsNone(p["leg"])

    def test_second_business_on_a_shared_order_does_not_see_the_rider(self):
        from accounts.models import BusinessOwner
        from listings.models import Category, Listing, Zone
        from orders.models import OrderItem
        second = BusinessOwner.objects.create(full_name="Second Shop", login_phone="+233207000099", password_hash="x")
        BusinessOwnerProfile.objects.update_or_create(business_owner=second, defaults={"lat": PICKUP[0], "lng": PICKUP[1]})
        listing = Listing.objects.create(
            business_owner=second, category=Category.objects.get(slug="hotels"), zone=Zone.objects.get(name="Manhyia"),
            name="Other", description="D.", contact_phone="+233207000099", price_amount="5.00", status=Listing.PUBLISHED)
        a = self.job(DA.AT_PICKUP)
        OrderItem.objects.create(order=a.order, listing=listing, quantity=1, unit_price="5.00", line_total="5.00")
        with mock.patch("delivery.tracking.routing_service.leg", return_value=dict(ROAD)):
            theirs = tracking.business_map(a, second)
            first = tracking.business_map(a, self.owner)
        self.assertIsNone(theirs["rider"])
        self.assertIsNone(theirs["leg"])
        self.assertIsNone(theirs["route"])
        self.assertNotIn("6.695", json.dumps(theirs))


class QueueTests(TrackingCase):
    def test_no_drop_pin_means_no_trip_and_no_route(self):
        order = self.make_order()
        type(order).objects.filter(pk=order.pk).update(delivery_lat=None, delivery_lng=None)
        order.refresh_from_db()
        p = tracking.queue_map(order)
        self.assertIsNone(p["drop"])
        self.assertIsNone(p["trip"])
        self.assertIsNone(p["route"])

    def test_declined_rider_marked_ineligible_with_reason(self):
        order = self.make_order()
        self.on_shift(self.rider, (PICKUP[0] + 0.002, PICKUP[1]))
        self.on_shift(self.other, (PICKUP[0] + 0.01, PICKUP[1]))
        Offer.objects.create(order=order, rider=self.other, status=Offer.DECLINED, expires_at=timezone.now())
        with mock.patch("delivery.tracking.routing_service.legs_from", side_effect=lambda origins, dest: [
            {"distance_km": 1.0, "duration_s": 180, "basis": routing_service.BASIS_ROAD, "geometry": None} for _ in origins]), \
                mock.patch("delivery.tracking.routing_service.leg", return_value=dict(ROAD)):
            p = tracking.queue_map(order)
        by = {r["rider_id"]: r for r in p["riders"]}
        self.assertTrue(by[self.rider.pk]["eligible"])
        self.assertFalse(by[self.other.pk]["eligible"])
        self.assertEqual(by[self.other.pk]["reason"], "Declined or timed out on this order")
        self.assertEqual(by[self.rider.pk]["minutes_to_pickup"], 3)
        self.assertEqual(p["trip"]["basis"], routing_service.BASIS_ROAD)
        self.assertEqual(p["route"], [[6.7, -1.62], [6.69, -1.62]])
        json.dumps(p)

    def test_osrm_down_still_returns_estimates(self):
        order = self.make_order()
        self.on_shift(self.rider, (PICKUP[0] + 0.002, PICKUP[1]))
        with mock.patch("routing.client.route", side_effect=OsrmUnavailable("x")), \
                mock.patch("routing.client.table", side_effect=OsrmUnavailable("x")), self.settings(OSRM_URL="http://osrm"):
            p = tracking.queue_map(order)
        self.assertEqual(p["riders"][0]["basis"], routing_service.BASIS_ESTIMATE)
        self.assertEqual(p["trip"]["basis"], routing_service.BASIS_ESTIMATE)
        self.assertIsNone(p["route"])

    def test_off_shift_riders_absent(self):
        order = self.make_order()
        self.assertEqual(tracking.queue_map(order)["riders"], [])
