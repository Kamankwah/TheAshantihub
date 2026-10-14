from datetime import timedelta
from unittest import mock

from django.utils import timezone

from delivery import board, services, stops, tracking
from delivery.models import PickupStop, ShiftSession
from disputes.models import Dispute
from notifications.models import Notification
from orders.models import DeliveryAssignment as DA, Order
from routing import service as routing_service

from .base import DROP, DeliveryCase

A, B, C = (6.70, -1.62), (6.705, -1.615), (6.71, -1.61)


def near(point):
    return (point[0] + 0.0001, point[1])


class MultiStopRiderCase(DeliveryCase):
    def setUp(self):
        super().setUp()
        self.shop_a, self.item_a = self.make_shop("Shop A", "+233207000301", A)
        self.shop_b, self.item_b = self.make_shop("Shop B", "+233207000302", B)
        self.shop_c, self.item_c = self.make_shop("Shop C", "+233207000303", C)
        self.order = self.multi_order(self.item_a, self.item_b, self.item_c)
        self.job = self.assign(self.order)
        self.first, self.second, self.third = self.job.stops.all()

    def code_of(self, stop):
        stop.refresh_from_db()
        return stop.code

    def collect(self, stop, point):
        self.assertEqual(self.step(self.job, "arrive-pickup", self.at(near(point))).status_code, 200)
        r = self.step(self.job, "pickup", {**self.at(near(point)), "code": self.code_of(stop)})
        self.assertEqual(r.status_code, 200, r.content)
        return r.json()

    def skip(self, note="Shop closed early", **extra):
        """A rider's skip: the rider's pin is required, so one is sent unless `extra` brings its own."""
        return self.step(self.job, "skip-stop", {"note": note, **self.at(near(A)), **extra})


class StopByStopTests(MultiStopRiderCase):
    def test_the_rider_collects_each_shop_in_turn_then_heads_to_the_customer(self):
        self.step(self.job, "accept")
        body = self.collect(self.first, A)
        self.assertEqual(body["status"], "accepted")
        self.assertEqual(body["current_stop"]["business_name"], "Shop B")
        self.assertEqual(body["progress"], {"total": 3, "done": 1, "skipped": 0, "current": 2})
        self.order.refresh_from_db()
        self.assertEqual(self.order.delivery_status, Order.PROCESSING)
        self.collect(self.second, B)
        body = self.collect(self.third, C)
        self.assertEqual(body["status"], "picked_up")
        self.assertIsNone(body["current_stop"])
        self.assertEqual(list(self.job.events.values_list("step", flat=True)), [
            "assigned", "accepted", "arrived_pickup", "collected_stop", "arrived_pickup", "collected_stop", "arrived_pickup", "picked_up",
        ])
        self.assertEqual(list(self.job.events.exclude(stop=None).values_list("stop__sequence", flat=True)), [1, 1, 2, 2, 3, 3])
        self.order.refresh_from_db()
        self.assertEqual(self.order.delivery_status, Order.OUT_FOR_DELIVERY)

    def test_each_shop_has_its_own_code_and_its_own_wrong_tries(self):
        self.step(self.job, "accept")
        self.collect(self.first, A)
        self.step(self.job, "arrive-pickup", self.at(near(B)))
        wrong = self.code_of(self.first)
        r = self.step(self.job, "pickup", {**self.at(near(B)), "code": wrong})
        self.assertEqual((r.status_code, r.json()["attempts_left"]), (400, 4))
        self.first.refresh_from_db()
        self.second.refresh_from_db()
        self.job.refresh_from_db()
        self.assertEqual((self.first.code_attempts, self.second.code_attempts, self.job.pickup_code_attempts), (0, 1, 0))
        for _ in range(4):
            self.step(self.job, "pickup", {**self.at(near(B)), "code": wrong})
        locked = self.step(self.job, "pickup", {**self.at(near(B)), "code": self.code_of(self.second)})
        self.assertEqual(locked.status_code, 423)

    def test_the_rider_payload_lists_every_stop_and_never_a_code(self):
        for stop, code in zip((self.first, self.second, self.third), ("QA11", "QB22", "QC33")):
            PickupStop.objects.filter(pk=stop.pk).update(code=code)
        DA.objects.filter(pk=self.job.pk).update(drop_code="QD44")
        r = self.as_staff(self.rider_staff).get(f"/api/delivery/rider/jobs/{self.job.pk}/")
        body = r.json()
        self.assertEqual([p["business_name"] for p in body["pickups"]], ["Shop A", "Shop B", "Shop C"])
        self.assertEqual(body["pickups"][1]["items"], ["Shop B item × 1"])
        self.assertTrue(body["multi_pickup"])
        self.assertEqual(body["current_stop"]["sequence"], 1)
        for code in ("QA11", "QB22", "QC33", "QD44"):
            self.assertNotIn(code, r.content.decode())

    def test_an_offer_says_how_many_shops(self):
        from delivery.models import Offer
        from delivery.views_queue import offer_payload

        order = self.multi_order(self.item_a, self.item_b)
        offer = Offer.objects.create(order=order, rider=self.rider, expires_at=timezone.now() + timedelta(seconds=45))
        self.assertEqual(offer_payload(offer)["stop_count"], 2)

    def test_the_maps_and_the_board_follow_the_stop_being_worked(self):
        ShiftSession.objects.create(rider=self.rider, last_lat=6.69, last_lng=-1.62, last_fix_at=timezone.now())
        self.step(self.job, "accept")
        self.collect(self.first, A)
        job = DA.objects.get(pk=self.job.pk)
        self.assertEqual(tracking.manager_job_map(job)["pickup"]["name"], "Shop B")
        heading, done = tracking.business_map(job, self.shop_b), tracking.business_map(job, self.shop_a)
        self.assertIsNotNone(heading["rider"])
        self.assertEqual((heading["pickup"]["lat"], heading["pickup"]["lng"]), B)
        self.assertEqual((done["rider"], done["pickup"]), (None, None))  # its stop is collected: it no longer watches the rider
        self.assertIsNone(tracking.business_map(job, self.shop_c)["rider"])  # not its turn yet
        row = next(r for r in board.active()["results"] if r["id"] == job.pk)
        self.assertEqual(row["route"]["from"], "Shop B")

    def test_the_step_answers_and_the_job_list_carry_no_code_either(self):
        self.step(self.job, "accept")
        self.step(self.job, "arrive-pickup", self.at(near(A)))
        codes = [self.code_of(s) for s in (self.first, self.second, self.third)]
        self.job.refresh_from_db()
        codes.append(self.job.drop_code)
        answer = self.step(self.job, "pickup", {**self.at(near(A)), "code": codes[0]})
        listing = self.as_staff(self.rider_staff).get("/api/delivery/rider/jobs/")
        for body in (answer.content.decode(), listing.content.decode()):
            for code in codes:
                self.assertNotIn(f'"{code}"', body)


class SkipTests(MultiStopRiderCase):
    def test_a_skip_needs_a_note_and_opens_one_case_for_that_shop_only(self):
        self.step(self.job, "accept")
        self.collect(self.first, A)
        self.step(self.job, "arrive-pickup", self.at(near(B)))
        self.assertEqual(self.skip("  ").status_code, 400)
        r = self.skip(**self.at(near(B)))
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()["status"], "accepted")
        self.assertEqual(r.json()["current_stop"]["business_name"], "Shop C")
        case = Dispute.objects.get(order=self.order)
        self.assertEqual((case.case_type, case.reason, case.raised_by_id), (Dispute.NOT_RECEIVED, Dispute.DELIVERY_ISSUE, self.customer.pk))
        self.assertIn("Shop B item × 1", case.description)
        self.assertIn("GH₵ 10.00", case.description)
        self.assertNotIn("Shop A item", case.description)
        self.assertNotIn("Shop C item", case.description)
        self.second.refresh_from_db()
        self.assertEqual((self.second.status, self.second.dispute_id, self.second.skip_note), (PickupStop.SKIPPED, case.pk, "Shop closed early"))
        self.assertTrue(Notification.objects.filter(customer=self.customer, title="A shop could not hand over your items").exists())

    def test_skipping_the_last_open_shop_sends_the_rider_to_the_customer(self):
        self.step(self.job, "accept")
        self.collect(self.first, A)
        self.collect(self.second, B)
        r = self.skip()
        self.assertEqual(r.json()["status"], "picked_up")
        self.assertEqual(list(self.job.events.values_list("step", flat=True))[-2:], ["skipped_stop", "picked_up"])

    def test_when_every_shop_is_skipped_the_order_goes_back_to_the_queue(self):
        self.step(self.job, "accept")
        for _ in range(3):
            self.assertEqual(self.skip().status_code, 200)
        self.job.refresh_from_db()
        self.assertEqual((self.job.status, self.job.failed_reason), (DA.FAILED, "all_stops_skipped"))
        self.assertEqual(Dispute.objects.filter(order=self.order).count(), 3)  # one refund case per shop, as planned
        self.assertIn(self.order.pk, set(board.waiting_orders().values_list("pk", flat=True)))
        row = next(board.queue_row(o, timezone.now()) for o in board.waiting_orders() if o.pk == self.order.pk)
        self.assertEqual((row["returned"], row["returned_reason"]), (True, "all_stops_skipped"))
        self.assertEqual(len(row["skips"]), 3)

    def test_a_returned_order_can_be_given_to_a_new_rider_and_the_evidence_survives(self):
        self.step(self.job, "accept")
        for _ in range(3):
            self.skip(note="Closed")
        codes = {s.pk: s.code for s in self.job.stops.all()}
        again = self.assign(self.order, self.other_staff)
        self.assertEqual(DA.objects.filter(order=self.order).count(), 1)  # one row per order: the failed attempt is reset, not replaced
        self.assertEqual((again.pk, again.status, again.dispatch_id, again.failed_reason, again.failed_at),
                         (self.job.pk, DA.ASSIGNED, self.other_staff.pk, "", None))
        rows = list(again.stops.all())
        self.assertEqual({s.status for s in rows}, {PickupStop.PENDING})
        self.assertEqual({s.pk: s.code for s in rows}, codes)
        self.assertEqual({(s.skip_note, s.dispute_id) for s in rows}, {("", None)})
        self.assertEqual(Dispute.objects.filter(order=self.order).count(), 3)  # the refund cases stay for the manager to settle
        self.assertEqual(self.job.events.filter(step="skipped_stop").count(), 3)
        self.assertEqual([h["note"] for h in stops.skip_history(again)], ["Closed"] * 3)
        self.assertNotIn(self.order.pk, set(board.waiting_orders().values_list("pk", flat=True)))

    def test_a_skip_keeps_the_riders_pin_time_and_note(self):
        self.step(self.job, "accept")
        refused = self.step(self.job, "skip-stop", {"note": "Door locked"})  # no location sent
        self.assertEqual((refused.status_code, refused.json()["code"]), (400, "location_needed"))
        before = timezone.now()
        self.assertEqual(self.skip(note="Door locked", lat=A[0] + 0.0001, lng=A[1], accuracy_m=7).status_code, 200)
        event = self.job.events.get(step="skipped_stop")
        self.assertEqual((event.stop_id, event.note, event.accuracy_m), (self.first.pk, "Door locked", 7.0))
        self.assertEqual((round(event.lat, 4), round(event.lng, 4)), (round(A[0] + 0.0001, 4), round(A[1], 4)))
        self.assertGreaterEqual(event.at, before)
        history = stops.skip_history(self.job)
        self.assertEqual([(h["business_name"], h["note"], h["pinned"], h["by"], h["at_shop"]) for h in history], [("Shop A", "Door locked", True, "rider", True)])
        self.assertFalse(self.skip(note="x" * 301).status_code == 200)  # the note is capped at 300 characters

    def test_a_later_can_t_deliver_still_opens_its_own_case(self):
        self.step(self.job, "accept")
        self.collect(self.first, A)
        self.skip()
        self.collect(self.third, C)
        self.step(self.job, "arrive-drop", self.at(near(DROP)))
        r = self.step(self.job, "cant-deliver", {**self.at(near(DROP)), "reason": "wrong_address", "note": "No such house"})
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(Dispute.objects.filter(order=self.order).count(), 2)

    def test_a_rider_skips_only_after_accepting_and_a_done_shop_cannot_be_skipped(self):
        refused = self.skip()
        self.assertEqual((refused.status_code, refused.json()["code"]), (409, "wrong_step"))
        self.step(self.job, "accept")
        self.collect(self.first, A)
        with self.assertRaises(services.DeliveryError) as done:
            services.skip_stop(DA.objects.get(pk=self.job.pk), self.manager, "Closed", stop=PickupStop.objects.get(pk=self.first.pk))
        self.assertEqual((done.exception.status_code, done.exception.code), (409, "stop_done"))
        self.assertFalse(Dispute.objects.filter(order=self.order).exists())

    def test_a_managers_skip_carries_no_pin_and_reads_as_the_managers(self):
        services.skip_stop(DA.objects.get(pk=self.job.pk), self.manager, "Shop cancelled by phone", stop=PickupStop.objects.get(pk=self.second.pk))
        event = self.job.events.get(step="skipped_stop")
        self.assertEqual((event.lat, event.lng, event.accuracy_m, event.by_id), (None, None, None, self.manager.pk))
        history = stops.skip_history(self.job)
        self.assertEqual([(h["business_name"], h["pinned"], h["by"], h["at_shop"]) for h in history], [("Shop B", False, "manager", False)])
        self.job.refresh_from_db()
        self.assertEqual(self.job.status, DA.ASSIGNED)  # the rider still collects Shop A and Shop C
        self.assertEqual(stops.current_stop(self.job).pk, self.first.pk)

    def test_the_rider_payload_carries_no_pin_of_a_skip_but_the_managers_does(self):
        self.step(self.job, "accept")
        self.skip(note="Door locked", lat=A[0] + 0.0002, lng=A[1], accuracy_m=7)
        rider = self.as_staff(self.rider_staff).get(f"/api/delivery/rider/jobs/{self.job.pk}/").json()
        self.assertNotIn("skips", rider["pickups"][0])
        self.assertNotIn("skip_history", rider)
        from delivery import payloads

        block = payloads.stops_block(DA.objects.get(pk=self.job.pk), evidence=True)
        self.assertEqual(len(block["all"][0]["skips"]), 1)
        self.assertEqual(round(block["skip_history"][0]["lat"], 4), round(A[0] + 0.0002, 4))


class LegacyTests(DeliveryCase):
    def test_a_job_from_before_stops_carries_on_with_its_one_pickup_and_code(self):
        _, item_a = self.make_shop("Shop A", "+233207000311", (6.70, -1.62))
        _, item_b = self.make_shop("Shop B", "+233207000312", (6.705, -1.615))
        job = self.assign(self.multi_order(item_a, item_b))
        job.stops.all().delete()
        DA.objects.filter(pk=job.pk).update(pickup_code="4321", status=DA.ACCEPTED)
        body = self.as_staff(self.rider_staff).get(f"/api/delivery/rider/jobs/{job.pk}/").json()
        self.assertEqual([(p["id"], p["business_name"]) for p in body["pickups"]], [(None, "Shop A")])
        self.assertEqual(PickupStop.objects.filter(assignment=job).count(), 0)  # a read writes nothing
        self.assertEqual(self.step(job, "arrive-pickup", self.at((6.7001, -1.62))).status_code, 200)
        self.assertEqual(PickupStop.objects.filter(assignment=job).count(), 1)
        r = self.step(job, "pickup", {**self.at((6.7001, -1.62)), "code": "4321"})
        self.assertEqual((r.status_code, r.json()["status"]), (200, "picked_up"))

    def test_a_job_from_before_codes_keeps_one_uncoded_pickup(self):
        """A job made before delivery codes existed (no pickup or drop code, no stops) is collected as it was served:
        one pickup at its first item's shop, with nothing to check. No new code is minted that no shop was ever given."""
        _, item_a = self.make_shop("Shop A", "+233207000317", (6.70, -1.62))
        _, item_b = self.make_shop("Shop B", "+233207000318", (6.705, -1.615))
        job = DA.objects.create(order=self.multi_order(item_a, item_b), dispatch=self.rider_staff, assigned_by=self.manager, status=DA.ACCEPTED)
        self.assertEqual(self.step(job, "arrive-pickup", self.at((6.7001, -1.62))).status_code, 200)
        r = self.step(job, "pickup", self.at((6.7001, -1.62)))
        self.assertEqual((r.status_code, r.json()["status"]), (200, "picked_up"), r.content)
        self.assertEqual([(s.sequence, s.code) for s in job.stops.all()], [(1, "")])
        job.refresh_from_db()
        self.assertEqual(job.pickup_code, "")

    def test_the_old_pickup_button_refuses_a_multi_shop_job(self):
        _, item_a = self.make_shop("Shop A", "+233207000313", (6.70, -1.62))
        _, item_b = self.make_shop("Shop B", "+233207000314", (6.705, -1.615))
        job = self.assign(self.multi_order(item_a, item_b))
        r = self.as_staff(self.rider_staff).post(f"/api/orders/delivery/{job.id}/pickup/", {"code": job.pickup_code}, format="json")
        self.assertEqual((r.status_code, r.json()["code"]), (409, "multi_stop"))

    def legacy_order(self):
        """Two shops where the plan's first shop is NOT the first item's: the first item is a chop bar, and food goes last."""
        self.chop, item_chop = self.make_shop("Chop A", "+233207000315", (6.70, -1.62), slug="food")
        self.shop_b, item_b = self.make_shop("Shop B", "+233207000316", (6.705, -1.615))
        order = self.multi_order(item_chop, item_b)
        self.assertEqual(services.pickup_stop(order)[2], "Shop B")  # what a plan-derived reader would send the rider to
        return order

    def test_a_job_from_before_stops_reads_its_saved_shop_not_the_plan(self):
        order = self.legacy_order()
        job = DA.objects.create(order=order, dispatch=self.rider_staff, assigned_by=self.manager, status=DA.ACCEPTED,
                                pickup_code="4321", drop_code="8765", accepted_at=timezone.now())
        body = self.as_staff(self.rider_staff).get(f"/api/delivery/rider/jobs/{job.pk}/").json()
        self.assertEqual([(p["id"], p["business_name"], p["lat"], p["lng"]) for p in body["pickups"]], [(None, "Chop A", 6.70, -1.62)])
        self.assertEqual((body["current_stop"]["business_name"], body["multi_pickup"], body["pickup_attempts_left"]), ("Chop A", False, 5))
        self.assertNotIn("4321", self.client.get(f"/api/delivery/rider/jobs/{job.pk}/").content.decode())
        self.assertEqual(self.step(job, "arrive-pickup", self.at((6.7001, -1.62))).status_code, 200)
        arrived = job.events.get(step="arrived_pickup")
        self.assertFalse(arrived.flagged)  # measured from Chop A, where the rider is; Shop B is ~780 m away
        self.assertLess(arrived.distance_m, 50)
        self.assertEqual([(s.business_owner_id, s.code) for s in job.stops.all()], [(self.chop.pk, "4321")])
        r = self.step(job, "pickup", {**self.at((6.7001, -1.62)), "code": "4321"})
        self.assertEqual((r.status_code, r.json()["status"]), (200, "picked_up"))

    def test_the_maps_and_the_board_show_a_job_from_before_stops_at_its_saved_shop(self):
        order = self.legacy_order()
        job = DA.objects.create(order=order, dispatch=self.rider_staff, assigned_by=self.manager, status=DA.ACCEPTED,
                                pickup_code="4321", drop_code="8765", accepted_at=timezone.now())
        ShiftSession.objects.create(rider=self.rider, last_lat=6.69, last_lng=-1.62, last_fix_at=timezone.now())
        self.assertEqual(tracking.manager_job_map(job)["pickup"]["name"], "Chop A")
        self.assertIsNotNone(tracking.business_map(job, self.chop)["rider"])
        other = tracking.business_map(job, self.shop_b)
        self.assertEqual((other["rider"], other["pickup"]), (None, None))
        row = next(r for r in board.active()["results"] if r["id"] == job.pk)
        self.assertEqual(row["route"]["from"], "Chop A")
        self.assertEqual(PickupStop.objects.filter(assignment=job).count(), 0)  # reads write nothing

    def test_a_failed_job_from_before_stops_is_given_again_with_its_one_saved_shop(self):
        order = self.legacy_order()
        now = timezone.now()
        DA.objects.create(order=order, dispatch=self.rider_staff, assigned_by=self.manager, status=DA.FAILED, failed_at=now,
                          failed_reason="wrong_address", picked_up_at=now, pickup_code="4321", drop_code="8765")
        self.assertIn(order.pk, set(board.waiting_orders().values_list("pk", flat=True)))
        again = self.assign(order, self.other_staff)
        self.assertEqual([(s.business_owner_id, s.code, s.status) for s in again.stops.all()], [(self.chop.pk, "4321", PickupStop.PENDING)])
        body = self.as_staff(self.other_staff).get(f"/api/delivery/rider/jobs/{again.pk}/").json()
        self.assertEqual([p["business_name"] for p in body["pickups"]], ["Chop A"])
        self.assertEqual(body["current_stop"]["business_name"], "Chop A")


class PlannedArrivalTests(DeliveryCase):
    def test_accepting_plans_an_arrival_per_shop_along_the_sequence(self):
        _, item_a = self.make_shop("Shop A", "+233207000321", (6.70, -1.62))
        _, item_b = self.make_shop("Shop B", "+233207000322", (6.705, -1.615))
        _, item_c = self.make_shop("Shop C", "+233207000323", None)
        job = self.assign(self.multi_order(item_a, item_b, item_c))
        ShiftSession.objects.create(rider=self.rider, last_lat=6.69, last_lng=-1.62, last_fix_at=timezone.now())
        road = {"distance_km": 1.0, "duration_s": 300, "basis": routing_service.BASIS_ROAD, "geometry": None}
        with mock.patch("delivery.stops.routing_service.leg", return_value=road):
            self.step(job, "accept")
        job.refresh_from_db()
        a, b, c = job.stops.all()
        self.assertEqual(a.planned_arrival, job.accepted_at + timedelta(seconds=300))
        self.assertEqual(b.planned_arrival - a.planned_arrival, timedelta(seconds=300))
        self.assertIsNone(c.planned_arrival)  # no location, so no time is made up

    def test_without_a_rider_location_no_time_is_made_up(self):
        _, item_a = self.make_shop("Shop A", "+233207000324", (6.70, -1.62))
        job = self.assign(self.multi_order(item_a))
        self.step(job, "accept")
        self.assertIsNone(job.stops.get().planned_arrival)
