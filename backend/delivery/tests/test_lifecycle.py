from datetime import timedelta

from django.utils import timezone

from delivery.models import DeliveryCall, DeliveryEvent, LocationPing, ShiftSession
from delivery import services
from disputes.models import Dispute
from orders.models import DeliveryAssignment, Order

from .base import DROP, PICKUP, DeliveryCase


class AssignmentTests(DeliveryCase):
    def test_assigning_makes_two_distinct_codes_and_an_event(self):
        assignment = self.assign()
        self.assertEqual(len(assignment.pickup_code), 4)
        self.assertEqual(len(assignment.drop_code), 4)
        self.assertEqual(assignment.status, DeliveryAssignment.ASSIGNED)
        self.assertEqual(assignment.assignment_mode, DeliveryAssignment.MANUAL)
        self.assertEqual(list(assignment.events.values_list("step", flat=True)), [DeliveryEvent.ASSIGNED])

    def test_reassigning_before_pickup_swaps_the_rider_and_keeps_the_codes(self):
        assignment = self.assign()
        codes = (assignment.pickup_code, assignment.drop_code)
        again = self.assign(assignment.order, self.other_staff)
        self.assertEqual(again.pk, assignment.pk)
        self.assertEqual(again.dispatch, self.other_staff)
        self.assertEqual((again.pickup_code, again.drop_code), codes)

    def test_a_job_on_the_road_cannot_be_reassigned(self):
        assignment = self.assign()
        self.run_to(assignment, "pickup")
        self.as_staff(self.manager)
        response = self.client.post(f"/api/orders/{assignment.order_id}/assign-dispatch/", {"dispatch": self.other_staff.id}, format="json")
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["code"], "not_reassignable")


class StepTests(DeliveryCase):
    def test_the_whole_job_stamps_each_step_with_distance_and_syncs_the_order(self):
        assignment = self.assign()
        self.run_to(assignment, "deliver")
        self.assertEqual(assignment.status, DeliveryAssignment.DELIVERED)
        steps = list(assignment.events.values_list("step", flat=True))
        self.assertEqual(steps, ["assigned", "accepted", "arrived_pickup", "picked_up", "arrived_drop", "delivered"])
        stamped = assignment.events.get(step="arrived_pickup")
        self.assertLess(stamped.distance_m, 30)
        self.assertFalse(stamped.flagged)
        assignment.order.refresh_from_db()
        self.assertEqual(assignment.order.delivery_status, Order.DELIVERED)

    def test_steps_must_come_in_order(self):
        assignment = self.assign()
        response = self.step(assignment, "pickup", {**self.at(PICKUP), "code": assignment.pickup_code})
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["code"], "wrong_step")
        response = self.step(assignment, "deliver", {**self.at(DROP), "code": assignment.drop_code})
        self.assertEqual(response.status_code, 409)

    def test_a_step_needs_a_location(self):
        assignment = self.assign()
        response = self.step(assignment, "arrive-pickup", {})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["code"], "location_needed")

    def test_a_tap_over_150_m_from_the_stop_works_but_is_flagged_and_tells_the_manager(self):
        assignment = self.assign()
        response = self.step(assignment, "arrive-pickup", self.at((PICKUP[0] + 0.002, PICKUP[1])))  # about 220 m
        self.assertEqual(response.status_code, 200)
        event = assignment.events.get(step="arrived_pickup")
        self.assertTrue(event.flagged)
        self.assertGreater(event.distance_m, 150)
        self.assertTrue(self.manager.notifications.filter(kind="delivery_alert").exists())

    def test_a_business_without_a_pin_has_no_distance_and_no_flag(self):
        self.listing.lat = self.listing.lng = None
        self.listing.save()
        assignment = self.assign()
        self.step(assignment, "arrive-pickup", self.at((0.5, 0.5)))
        event = assignment.events.get(step="arrived_pickup")
        self.assertIsNone(event.distance_m)
        self.assertFalse(event.flagged)

    def test_the_pickup_code_is_checked_and_wrong_tries_are_counted_then_locked(self):
        assignment = self.assign()
        self.run_to(assignment, "arrive-pickup")
        wrong = "0000" if assignment.pickup_code != "0000" else "1111"
        for tries_left in (4, 3, 2, 1, 0):
            response = self.step(assignment, "pickup", {**self.at(PICKUP), "code": wrong})
            self.assertEqual(response.status_code, 400)
            self.assertEqual(response.json()["attempts_left"], tries_left)
        locked = self.step(assignment, "pickup", {**self.at(PICKUP), "code": assignment.pickup_code})
        self.assertEqual(locked.status_code, 423)
        assignment.refresh_from_db()
        self.assertEqual(assignment.pickup_code_attempts, 5)
        self.assertTrue(self.manager.notifications.filter(title__contains="wrongly").exists())

    def test_another_rider_cannot_touch_the_job(self):
        assignment = self.assign()
        self.as_staff(self.other_staff)
        self.assertEqual(self.client.post(f"/api/delivery/rider/jobs/{assignment.id}/accept/").status_code, 404)
        self.assertEqual(self.client.get(f"/api/delivery/rider/jobs/{assignment.id}/").status_code, 404)

    def test_the_rider_never_sees_either_code_or_the_customers_phone(self):
        assignment = self.assign()
        self.as_staff(self.rider_staff)
        job = self.client.get(f"/api/delivery/rider/jobs/{assignment.id}/").json()
        text = str(job)
        self.assertNotIn(assignment.pickup_code + "'", text.replace('"', "'"))
        self.assertNotIn("pickup_code", job)
        self.assertNotIn("drop_code", job)
        self.assertNotIn("233200882200", text)
        self.assertEqual(job["customer_name"], "Ama B.")

    def test_the_drop_code_reaches_the_customer_and_the_pickup_code_only_the_collecting_business(self):
        assignment = self.assign()
        self.client.credentials()
        from accounts.authentication import issue_token

        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.customer, 'customer')}")
        order = self.client.get(f"/api/orders/{assignment.order_id}/").json()
        self.assertEqual(order["delivery_code"], assignment.drop_code)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.owner, 'business_owner')}")
        owned = self.client.get("/api/orders/owner/").json()["results"][0]
        self.assertEqual(owned["pickup_code"], assignment.pickup_code)
        self.assertNotIn("drop_code", owned)
        rival = type(self.owner).objects.create(full_name="Rival", login_phone="+233207882211", password_hash="x")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(rival, 'business_owner')}")
        self.assertEqual(self.client.get("/api/orders/owner/").json()["count"], 0)

    def test_the_drop_code_disappears_once_delivered(self):
        assignment = self.assign()
        self.run_to(assignment, "deliver")
        from accounts.authentication import issue_token

        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.customer, 'customer')}")
        self.assertIsNone(self.client.get(f"/api/orders/{assignment.order_id}/").json()["delivery_code"])

    def test_the_older_pickup_and_deliver_buttons_still_work_and_still_need_the_code(self):
        assignment = self.assign()
        self.as_staff(self.rider_staff)
        bad = self.client.post(f"/api/orders/delivery/{assignment.id}/pickup/", {"code": "x"}, format="json")
        self.assertEqual(bad.status_code, 400)
        ok = self.client.post(f"/api/orders/delivery/{assignment.id}/pickup/", {"code": assignment.pickup_code}, format="json")
        self.assertEqual(ok.status_code, 200)
        done = self.client.post(f"/api/orders/delivery/{assignment.id}/deliver/", {"code": assignment.drop_code}, format="json")
        self.assertEqual(done.status_code, 200)
        assignment.refresh_from_db()
        self.assertEqual(assignment.status, DeliveryAssignment.DELIVERED)


class CantDeliverTests(DeliveryCase):
    def test_a_failed_delivery_opens_a_dispute_and_a_task_and_requeues_the_order(self):
        from staff_tasks.models import Task

        assignment = self.assign()
        self.run_to(assignment, "arrive-drop")
        response = self.step(assignment, "cant-deliver", {**self.at(DROP), "reason": "wrong_address", "note": "No such street"})
        self.assertEqual(response.status_code, 200, response.content)
        assignment.refresh_from_db()
        self.assertEqual(assignment.status, DeliveryAssignment.FAILED)
        self.assertTrue(Dispute.objects.filter(order=assignment.order, reason=Dispute.DELIVERY_ISSUE).exists())
        self.assertTrue(Task.objects.filter(owner=self.manager, kind=Task.DELIVERY_PROBLEM).exists())
        from delivery import board

        self.assertIn(assignment.order, list(board.waiting_orders()))

    def test_no_answer_needs_the_ten_minute_wait_and_two_logged_calls(self):
        assignment = self.assign()
        self.run_to(assignment, "arrive-drop")
        body = {**self.at(DROP), "reason": "no_answer"}
        self.assertEqual(self.step(assignment, "cant-deliver", body).json()["code"], "wait_not_over")
        assignment.arrived_drop_at = timezone.now() - timedelta(minutes=11)
        assignment.save()
        self.assertEqual(self.step(assignment, "cant-deliver", body).json()["code"], "calls_needed")
        self.step(assignment, "call")
        self.step(assignment, "call")
        self.assertEqual(self.step(assignment, "cant-deliver", body).status_code, 200)

    def test_the_call_hands_over_the_phone_only_through_the_logged_action(self):
        assignment = self.assign()
        response = self.step(assignment, "call")
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["phone"], "+233200882200")
        self.assertEqual(DeliveryCall.objects.filter(assignment=assignment, caller=self.rider_staff).count(), 1)

    def test_cannot_report_failure_before_collecting_the_order(self):
        assignment = self.assign()
        response = self.step(assignment, "cant-deliver", {**self.at(DROP), "reason": "refused"})
        self.assertEqual(response.status_code, 409)


class ShiftTests(DeliveryCase):
    def test_papers_must_be_approved_before_a_shift_starts(self):
        self.as_staff(self.rider_staff)
        response = self.client.post("/api/delivery/rider/shift/start/", {"lat": 6.7, "lng": -1.62}, format="json")
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["code"], "papers_missing")
        self.assertEqual(len(response.json()["missing"]), 5)

    def test_shift_ping_break_and_end(self):
        self.approve_papers()
        self.as_staff(self.rider_staff)
        start = self.client.post("/api/delivery/rider/shift/start/", {"lat": 6.7, "lng": -1.62, "accuracy_m": 12}, format="json")
        self.assertEqual(start.status_code, 201, start.content)
        self.assertFalse(start.json()["stale"])
        ping = self.client.post("/api/delivery/rider/ping/", {"lat": 6.701, "lng": -1.621, "accuracy_m": 9}, format="json")
        self.assertEqual(ping.status_code, 200)
        shift = ShiftSession.objects.get(rider=self.rider, ended_at__isnull=True)
        self.assertEqual(shift.last_lat, 6.701)
        self.assertEqual(LocationPing.objects.filter(rider=self.rider).count(), 2)
        self.assertTrue(self.client.post("/api/delivery/rider/shift/break/", {"on": True}, format="json").json()["on_break"])
        self.assertTrue(self.client.post("/api/delivery/rider/shift/end/").json()["ended"])
        self.assertEqual(self.client.post("/api/delivery/rider/ping/", {"lat": 6.7, "lng": -1.62}, format="json").status_code, 409)

    def test_a_ping_is_not_written_to_the_activity_log(self):
        from activity.models import ActivityEvent

        self.approve_papers()
        self.as_staff(self.rider_staff)
        self.client.post("/api/delivery/rider/shift/start/", {"lat": 6.7, "lng": -1.62}, format="json")
        before = ActivityEvent.objects.filter(verb="delivery-rider-ping").count()
        self.client.post("/api/delivery/rider/ping/", {"lat": 6.7, "lng": -1.62}, format="json")
        self.assertEqual(ActivityEvent.objects.filter(verb="delivery-rider-ping").count(), before)

    def test_cannot_go_off_shift_mid_job(self):
        self.approve_papers()
        assignment = self.assign()
        self.as_staff(self.rider_staff)
        self.client.post("/api/delivery/rider/shift/start/", {"lat": 6.7, "lng": -1.62}, format="json")
        response = self.client.post("/api/delivery/rider/shift/end/")
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["code"], "job_in_progress")

    def test_old_pings_are_purged_after_48_hours(self):
        self.approve_papers()
        self.as_staff(self.rider_staff)
        self.client.post("/api/delivery/rider/shift/start/", {"lat": 6.7, "lng": -1.62}, format="json")
        LocationPing.objects.update(at=timezone.now() - timedelta(hours=49))
        self.client.post("/api/delivery/rider/ping/", {"lat": 6.7, "lng": -1.62}, format="json")
        self.assertEqual(services.purge_old_pings(), 1)
        self.assertEqual(LocationPing.objects.count(), 1)

    def test_a_suspended_rider_cannot_start_a_shift(self):
        self.approve_papers()
        self.rider_staff.is_suspended = True
        self.rider_staff.save()
        with self.assertRaises(services.DeliveryError):
            services.start_shift(self.rider, lat=6.7, lng=-1.62, accuracy=5)


class RiderPermissionTests(DeliveryCase):
    def test_only_dispatch_may_use_the_rider_endpoints(self):
        self.as_staff(self.manager)
        self.assertEqual(self.client.get("/api/delivery/rider/me/").status_code, 403)
        self.assertEqual(self.client.get("/api/delivery/rider/jobs/").status_code, 403)

    def test_a_rider_cannot_read_the_manager_screens(self):
        self.as_staff(self.rider_staff)
        for path in ("live/", "active/", "riders/", "documents/", "vehicles/", "zones/", "invites/"):
            self.assertEqual(self.client.get(f"/api/delivery/{path}").status_code, 403, path)

    def test_me_describes_the_rider_their_manager_and_what_blocks_a_shift(self):
        self.as_staff(self.rider_staff)
        me = self.client.get("/api/delivery/rider/me/").json()
        self.assertEqual(me["rider"]["manager"]["phone"], "+233244000001")
        self.assertFalse(me["papers"]["can_start_shift"])
        self.assertIsNone(me["shift"])
        self.assertEqual(me["push"], "not_connected")

    def test_the_job_list_scopes_and_counts(self):
        assignment = self.assign()
        self.run_to(assignment, "deliver")
        self.assign(self.make_order())
        self.as_staff(self.rider_staff)
        active = self.client.get("/api/delivery/rider/jobs/?scope=active").json()
        self.assertEqual(len(active["results"]), 1)
        today = self.client.get("/api/delivery/rider/jobs/?scope=today").json()
        self.assertEqual(len(today["results"]), 2)
        self.assertEqual(today["counts"]["delivered"], 1)
