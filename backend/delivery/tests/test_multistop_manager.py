from django.utils import timezone

from delivery.models import PickupStop
from disputes.models import Dispute
from orders.models import DeliveryAssignment as DA

from .base import DeliveryCase

A, B, C = (6.70, -1.62), (6.705, -1.615), (6.71, -1.61)
OVER = {"owner_ids": None, "planned": True, "total_km": 10.0, "direct_km": 5.0, "detour_pct": 100.0, "limit_pct": 40,
        "over_limit": True, "basis": "road route", "legs_km": [4, 3, 3]}


class ManagerStopTests(DeliveryCase):
    def setUp(self):
        super().setUp()
        self.shop_a, self.item_a = self.make_shop("Shop A", "+233207000501", A)
        self.shop_b, self.item_b = self.make_shop("Shop B", "+233207000502", B)
        self.shop_c, self.item_c = self.make_shop("Shop C", "+233207000503", C)
        self.job = self.assign(self.multi_order(self.item_a, self.item_b, self.item_c))
        self.first, self.second, self.third = self.job.stops.all()
        for stop, code in zip((self.first, self.second, self.third), ("QA11", "QB22", "QC33")):
            PickupStop.objects.filter(pk=stop.pk).update(code=code)

    def detail(self):
        r = self.as_staff(self.manager).get(f"/api/delivery/jobs/{self.job.pk}/")
        self.assertEqual(r.status_code, 200, r.content)
        return r

    def test_the_job_record_lists_each_stop_and_never_a_code(self):
        PickupStop.objects.filter(pk=self.second.pk).update(code_attempts=2)
        r = self.detail()
        rows = r.json()["stops"]
        self.assertEqual([(s["sequence"], s["business_name"], s["status"], s["wrong_tries"]) for s in rows],
                         [(1, "Shop A", "pending", 0), (2, "Shop B", "pending", 2), (3, "Shop C", "pending", 0)])
        self.assertEqual(r.json()["progress"]["total"], 3)
        for code in ("QA11", "QB22", "QC33"):
            self.assertNotIn(code, r.content.decode())

    def test_unlock_reopens_only_the_stop_named(self):
        PickupStop.objects.filter(pk__in=[self.second.pk, self.third.pk]).update(code_attempts=5)
        r = self.as_staff(self.manager, sudo=True).post(f"/api/delivery/jobs/{self.job.pk}/unlock-code/",
                                                        {"which": "pickup", "stop": self.second.pk, "note": "Shop confirmed"}, format="json")
        self.assertEqual((r.status_code, r.json()), (200, {"which": "pickup", "attempts": 0}))
        self.assertEqual([s.code_attempts for s in self.job.stops.all()], [0, 0, 5])
        missing = self.client.post(f"/api/delivery/jobs/{self.job.pk}/unlock-code/", {"which": "pickup", "stop": 999999, "note": "x"}, format="json")
        self.assertEqual(missing.status_code, 404)

    def test_unlock_without_a_stop_takes_the_current_one(self):
        PickupStop.objects.filter(pk=self.first.pk).update(status=PickupStop.COLLECTED)
        PickupStop.objects.filter(pk=self.second.pk).update(code_attempts=5)
        r = self.as_staff(self.manager, sudo=True).post(f"/api/delivery/jobs/{self.job.pk}/unlock-code/", {"which": "pickup", "note": "ok"}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.second.refresh_from_db()
        self.assertEqual(self.second.code_attempts, 0)

    def test_the_manager_sees_skip_evidence_in_the_queue_and_the_job(self):
        from delivery import services

        DA.objects.filter(pk=self.job.pk).update(status=DA.ACCEPTED)
        for stop, point in ((self.first, A), (self.second, B), (self.third, C)):
            services.skip_stop(DA.objects.get(pk=self.job.pk), self.rider_staff, f"Closed {stop.sequence}", lat=point[0] + 0.0001, lng=point[1], accuracy=9)
        self.as_staff(self.manager)
        row = {r["order_id"]: r for r in self.client.get("/api/delivery/queue/").json()["results"]}[self.job.order_id]
        self.assertEqual((row["returned"], row["returned_reason"]), (True, "all_stops_skipped"))
        self.assertEqual([(s["business_name"], s["note"], s["pinned"], s["accuracy_m"]) for s in row["skips"]],
                         [("Shop A", "Closed 1", True, 9.0), ("Shop B", "Closed 2", True, 9.0), ("Shop C", "Closed 3", True, 9.0)])
        self.assertEqual((round(row["skips"][1]["lat"], 4), round(row["skips"][1]["lng"], 4)), (round(B[0] + 0.0001, 4), round(B[1], 4)))
        self.assertIsNotNone(row["skips"][0]["at"])
        job = self.detail().json()
        self.assertEqual([h["note"] for h in job["skip_history"]], ["Closed 1", "Closed 2", "Closed 3"])
        self.assertEqual(job["stops"][2]["skips"][0]["note"], "Closed 3")

    def test_a_manager_skips_a_shop_that_closed(self):
        url = f"/api/delivery/jobs/{self.job.pk}/stops/{self.third.pk}/skip/"
        self.assertEqual(self.as_staff(self.manager).post(url, {"note": ""}, format="json").status_code, 400)
        r = self.client.post(url, {"note": "Shop C closed for the day"}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()["status"], "skipped")
        self.third.refresh_from_db()
        self.assertEqual((self.third.status, self.third.skipped_by_id), (PickupStop.SKIPPED, self.manager.pk))
        self.assertEqual(self.client.get(f"/api/delivery/jobs/{self.job.pk}/").json()["skip_history"][0]["by"], "manager")  # no rider pin
        self.assertIn("Shop C item", Dispute.objects.get(order=self.job.order).description)
        self.job.refresh_from_db()
        self.assertEqual(self.job.status, DA.ASSIGNED)  # the rider still starts at stop 1
        self.assertTrue(self.rider_staff.notifications.filter(kind="delivery_alert").exists())
        again = self.client.post(url, {"note": "again"}, format="json")
        self.assertEqual((again.status_code, again.json()["code"]), (409, "stop_done"))

    def test_a_stop_of_another_job_is_404(self):
        other = self.assign(self.multi_order(*[self.make_shop(f"X{n}", f"+23320700060{n}", A)[1] for n in (1, 2)]), rider_staff=self.other_staff)
        url = f"/api/delivery/jobs/{self.job.pk}/stops/{other.stops.first().pk}/skip/"
        self.assertEqual(self.as_staff(self.manager).post(url, {"note": "x"}, format="json").status_code, 404)

    def test_an_unmeasured_skip_distance_is_not_called_far(self):
        from delivery import services

        DA.objects.filter(pk=self.job.pk).update(status=DA.ACCEPTED)
        PickupStop.objects.filter(pk=self.first.pk).update(lat=None, lng=None)
        services.skip_stop(DA.objects.get(pk=self.job.pk), self.rider_staff, "Closed", lat=A[0], lng=A[1], accuracy=9)
        entry = self.detail().json()["skip_history"][0]
        self.assertEqual((entry["at_shop"], entry["distance_m"]), (False, None))
        self.assertIs(entry["distance_measured"], False)

    def test_a_measured_skip_says_so(self):
        from delivery import services

        DA.objects.filter(pk=self.job.pk).update(status=DA.ACCEPTED)
        services.skip_stop(DA.objects.get(pk=self.job.pk), self.rider_staff, "Closed", lat=A[0], lng=A[1], accuracy=9)
        entry = self.detail().json()["skip_history"][0]
        self.assertIs(entry["distance_measured"], True)
        self.assertIs(entry["at_shop"], True)


class DetourWarningTests(DeliveryCase):
    def test_a_waiting_order_over_the_detour_limit_warns_the_manager(self):
        _, item_a = self.make_shop("Shop A", "+233207000511", A)
        owner_b, item_b = self.make_shop("Shop B", "+233207000512", B)
        order = self.multi_order(item_a, item_b, route_plan={**OVER, "owner_ids": [item_a.business_owner_id, owner_b.pk]})
        self.as_staff(self.manager)
        rows = {r["order_id"]: r for r in self.client.get("/api/delivery/queue/").json()["results"]}
        row = rows[order.pk]
        self.assertEqual(row["stops"], 2)
        self.assertEqual(row["detour_warning"], "Planned route is 100% longer than going direct from the first shop (allowance 40%).")
        needs = self.client.get("/api/delivery/live/").json()["needs_you"]
        self.assertIn({"kind": "detour", "order_id": order.pk, "text": f"Order #{order.pk}: {row['detour_warning']}"}, needs)

    def test_an_estimated_plan_says_so(self):
        from delivery import board

        text = board.detour_warning({**OVER, "basis": "straight-line estimate x 1.3"})
        self.assertTrue(text.endswith("(straight-line estimate)."))
        self.assertIsNone(board.detour_warning({**OVER, "over_limit": False}))
        self.assertIsNone(board.detour_warning(None))

    def test_a_plan_with_no_percentage_still_warns(self):
        from delivery import board

        text = board.detour_warning({**OVER, "detour_pct": None})
        self.assertEqual(text, "Planned route is longer than going direct from the first shop (allowance 40%).")


class ReturnedLegacyJobTests(DeliveryCase):
    """A job from before multi-stop delivery that failed and is waiting again is read from its saved stop, not the plan."""

    def setUp(self):
        super().setUp()
        _, item_chop = self.make_shop("Chop A", "+233207000521", A, slug="food")
        _, item_b = self.make_shop("Shop B", "+233207000522", B)
        self.order = self.multi_order(item_chop, item_b)  # the plan sends food last: Shop B first
        DA.objects.create(order=self.order, dispatch=self.rider_staff, assigned_by=self.manager, status=DA.FAILED, pickup_code="4321",
                          drop_code="8765", failed_at=timezone.now(), failed_reason="rider_unavailable")

    def test_the_queue_row_route_and_count_use_the_saved_stop(self):
        self.as_staff(self.manager)
        row = {r["order_id"]: r for r in self.client.get("/api/delivery/queue/").json()["results"]}[self.order.pk]
        self.assertEqual((row["route"]["from"], row["stops"]), ("Chop A", 1))

    def test_the_queue_map_pins_the_saved_stop(self):
        from delivery import tracking

        body = tracking.queue_map(self.order)
        self.assertEqual(body["pickup"]["name"], "Chop A")

    def test_ranking_measures_to_the_saved_stop(self):
        from delivery import dispatching

        self.assertTrue(dispatching.rank(self.order)["pickup_located"])
        from delivery import services

        self.assertEqual(services.dispatch_point(self.order)[:3], (A[0], A[1], "Chop A"))


class FixRoundTests(DeliveryCase):
    def test_a_queue_of_returned_multishop_jobs_does_not_cost_queries_per_row(self):
        from django.db import connection
        from django.test.utils import CaptureQueriesContext

        def returned(n):
            owners = [self.make_shop(f"R{n}{k}", f"+2332070{n:02d}{k}1", (6.70 + k / 1000, -1.62))[1] for k in range(3)]
            job = self.assign(self.multi_order(*owners), rider_staff=self.rider_staff)
            self.client.post(f"/api/delivery/jobs/{job.pk}/stops/{job.stops.first().pk}/skip/", {"note": "closed"}, format="json")
            DA.objects.filter(pk=job.pk).update(status=DA.FAILED, failed_at=timezone.now(), failed_reason="rider_unavailable")

        def cost():
            self.as_staff(self.manager)
            with CaptureQueriesContext(connection) as ctx:
                self.assertEqual(self.client.get("/api/delivery/live/").status_code, 200)
            return len(ctx)

        for n in range(2):
            returned(n)
        two = cost()
        for n in range(2, 6):
            returned(n)
        n = cost()
        self.assertEqual(n, two)

    def test_a_manager_skip_that_ends_the_delivery_tells_the_rider_so(self):
        shop_a, item_a = self.make_shop("Only A", "+233207000701", A)
        shop_b, item_b = self.make_shop("Only B", "+233207000702", B)
        job = self.assign(self.multi_order(item_a, item_b))
        for stop in job.stops.all():
            r = self.client.post(f"/api/delivery/jobs/{job.pk}/stops/{stop.pk}/skip/", {"note": "closed"}, format="json")
            self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()["assignment_status"], DA.FAILED)
        bodies = list(self.rider_staff.notifications.filter(kind="delivery_alert").values_list("body", flat=True))
        self.assertTrue(any("has ended" in b for b in bodies))
        self.assertFalse(any("Open the job for the next stop" in b and "Only B" in b for b in bodies))

    def test_a_manager_can_skip_the_stop_of_a_job_from_before_stops(self):
        _, item = self.make_shop("Old shop", "+233207000711", A)
        order = self.multi_order(item)
        job = DA.objects.create(order=order, dispatch=self.rider_staff, assigned_by=self.manager, status=DA.ACCEPTED,
                                pickup_code="4321", drop_code="8765", accepted_at=timezone.now())
        body = self.as_staff(self.manager).get(f"/api/delivery/jobs/{job.pk}/").json()
        stop_id = body["stops"][0]["id"]
        self.assertEqual((stop_id, job.stops.count()), (0, 0))  # a GET saves nothing; 0 names the first, unsaved stop
        r = self.client.post(f"/api/delivery/jobs/{job.pk}/stops/{stop_id}/skip/", {"note": "closed"}, format="json")
        self.assertEqual((r.status_code, r.json()["status"]), (200, "skipped"))

    def test_a_returned_job_does_not_carry_a_stale_detour_warning(self):
        _, item_a = self.make_shop("Shop A", "+233207000721", A)
        owner_b, item_b = self.make_shop("Shop B", "+233207000722", B)
        order = self.multi_order(item_a, item_b, route_plan={**OVER, "owner_ids": [item_a.business_owner_id, owner_b.pk]})
        job = self.assign(order)
        self.as_staff(self.manager)
        stop = job.stops.first()
        self.client.post(f"/api/delivery/jobs/{job.pk}/stops/{stop.pk}/skip/", {"note": "closed"}, format="json")
        DA.objects.filter(pk=job.pk).update(status=DA.FAILED, failed_at=timezone.now(), failed_reason="rider_unavailable")
        row = {r["order_id"]: r for r in self.client.get("/api/delivery/queue/").json()["results"]}[order.pk]
        self.assertEqual((row["stops"], row["detour_warning"]), (1, None))
