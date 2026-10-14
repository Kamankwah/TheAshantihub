from datetime import timedelta
from unittest import mock

from django.db import connection
from django.test import SimpleTestCase
from django.test.utils import CaptureQueriesContext
from django.utils import timezone

from accounts.authentication import issue_token
from delivery.models import PickupStop, ShiftSession
from delivery.tests.base import DeliveryCase
from orders.models import DeliveryAssignment as DA
from routing import service as routing_service

A, B, C = (6.70, -1.62), (6.705, -1.615), (6.71, -1.61)
ROAD = {"distance_km": 1.2, "duration_s": 240, "basis": routing_service.BASIS_ROAD, "geometry": [[-1.62, 6.7], [-1.62, 6.69]]}
CODES = ("QA11", "QB22", "QC33")


class MultiStopPrivacyTests(DeliveryCase):
    def setUp(self):
        super().setUp()
        self.rider_staff.full_name = "Yaw Mensah"
        self.rider_staff.save()
        self.shop_a, item_a = self.make_shop("Shop A", "+233207000401", A)
        self.shop_b, item_b = self.make_shop("Shop B", "+233207000402", B)
        self.shop_c, item_c = self.make_shop("Shop C", "+233207000403", C)
        self.items = (item_a, item_b, item_c)
        self.a = self.assign(self.multi_order(item_a, item_b, item_c))
        DA.objects.filter(pk=self.a.pk).update(status=DA.ACCEPTED, drop_code="QD44")
        self.s1, self.s2, self.s3 = self.a.stops.all()
        for stop, code in zip((self.s1, self.s2, self.s3), CODES):
            PickupStop.objects.filter(pk=stop.pk).update(code=code)
        ShiftSession.objects.create(rider=self.rider, last_lat=6.701, last_lng=-1.62, last_fix_at=timezone.now())

    def set(self, stop, **fields):
        PickupStop.objects.filter(pk=stop.pk).update(**fields)

    def as_owner(self, owner):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(owner, 'business_owner')}")

    def owner_row(self, owner):
        self.as_owner(owner)
        return {o["id"]: o for o in self.client.get("/api/orders/owner/").json()["results"]}[self.a.order_id]

    def owner_map(self, owner):
        self.as_owner(owner)
        with mock.patch("delivery.tracking.routing_service.leg", return_value=dict(ROAD)):
            r = self.client.get(f"/api/orders/owner/{self.a.order_id}/tracking/")
        self.assertEqual(r.status_code, 200, r.content)
        return r

    def customer_map(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.customer, 'customer')}")
        with mock.patch("delivery.tracking.routing_service.leg", return_value=dict(ROAD)):
            return self.client.get(f"/api/orders/{self.a.order_id}/tracking/")

    def test_the_shop_being_worked_sees_the_rider_and_only_its_own_code(self):
        first = self.owner_map(self.shop_a).json()
        self.assertEqual(first["rider"]["first_name"], "Yaw")
        row = self.owner_row(self.shop_a)
        self.assertEqual((row["pickup_code"], row["rider_heading_here"]), ("QA11", True))
        later = self.owner_map(self.shop_b)
        body = later.json()
        self.assertIsNone(body["rider"])
        self.assertTrue(body["rider_elsewhere"])
        self.assertEqual((body["pickup"]["lat"], body["pickup"]["lng"]), B)
        for needle in ("QA11", "QC33", "QD44", "12 Ash Road", "Mensah"):
            self.assertNotIn(needle, later.content.decode())
        row = self.owner_row(self.shop_b)
        self.assertEqual((row["pickup_code"], row["rider_heading_here"]), ("QB22", False))
        self.assertNotIn("QA11", str(row))
        self.assertNotIn("QC33", str(row))

    def test_a_later_shop_is_told_when_the_rider_should_arrive(self):
        eta = (timezone.now() + timedelta(minutes=12)).replace(microsecond=0)  # DRF prints milliseconds only
        self.set(self.s2, planned_arrival=eta)
        self.assertEqual(self.owner_row(self.shop_b)["pickup_eta"], eta.isoformat().replace("+00:00", "Z"))
        self.assertIsNotNone(self.owner_map(self.shop_b).json()["stop"]["planned_arrival"])

    def test_a_shop_sees_the_riders_skip_report_for_its_own_stop_only(self):
        from delivery import services

        a = DA.objects.get(pk=self.a.pk)
        services.skip_stop(a, self.rider_staff, "Shop was shut", lat=A[0] + 0.0001, lng=A[1], accuracy=8)
        report = self.owner_row(self.shop_a)["rider_report"]
        self.assertEqual(set(report), {"at", "text"})
        self.assertRegex(report["text"], r"^Rider reported at your shop at \d{2}:\d{2}: Shop was shut$")
        shown = str(self.owner_row(self.shop_a))
        for needle in ("Yaw", "Mensah", "+233244000002", "6.7001", "accuracy"):
            self.assertNotIn(needle, shown)
        self.assertIsNone(self.owner_row(self.shop_b)["rider_report"])
        self.assertIsNone(self.owner_row(self.shop_c)["rider_report"])

    def test_a_managers_skip_is_not_shown_to_the_shop_as_a_rider_report(self):
        from delivery import services

        services.skip_stop(DA.objects.get(pk=self.a.pk), self.manager, "Shop closed for the day", stop=self.s2)
        self.assertIsNone(self.owner_row(self.shop_b)["rider_report"])

    def test_the_owner_order_row_has_no_customer_contact_details(self):
        row = self.owner_row(self.shop_a)

        def keys(value):  # every key at every depth
            if isinstance(value, dict):
                for key, inner in value.items():
                    yield key
                    yield from keys(inner)
            elif isinstance(value, list):
                for inner in value:
                    yield from keys(inner)

        contactish = [k for k in keys(row) if any(w in k.lower() for w in ("phone", "email", "contact", "mobile"))]
        self.assertEqual(contactish, [])
        self.assertNotIn("delivery_phone", row)
        self.assertNotIn("+233200882200", str(row))  # the customer's number on this order
        self.assertNotIn(self.customer.phone, str(row))
        # What the contract test pins stays: the address and the pin.
        self.assertEqual(row["delivery_address"], "12 Ash Road")
        self.assertIsNotNone(row["delivery_lat"])

    def test_a_collected_shop_sees_nothing_more(self):
        self.set(self.s1, status=PickupStop.COLLECTED)
        row = self.owner_row(self.shop_a)
        self.assertEqual((row["pickup_code"], row["rider_heading_here"], row["pickup_eta"], row["pickup_status"]), (None, False, None, "collected"))
        body = self.owner_map(self.shop_a).json()
        self.assertEqual((body["rider"], body["pickup"]), (None, None))
        self.assertEqual(self.owner_map(self.shop_b).json()["rider"]["first_name"], "Yaw")

    def test_a_skipped_shop_gets_no_code_or_rider(self):
        self.set(self.s2, status=PickupStop.SKIPPED)
        row = self.owner_row(self.shop_b)
        self.assertEqual((row["pickup_code"], row["pickup_status"]), (None, "skipped"))

    def test_the_customer_sees_the_rider_only_after_the_last_shop(self):
        self.set(self.s1, status=PickupStop.COLLECTED)
        self.set(self.s2, status=PickupStop.COLLECTED)
        r = self.customer_map()
        self.assertIsNone(r.json()["rider"])
        self.assertEqual(r.json()["stops"], {"total": 3, "done": 2, "skipped": 0})
        for needle in ("Shop A", "Shop B", *CODES):
            self.assertNotIn(needle, r.content.decode())
        self.set(self.s3, status=PickupStop.COLLECTED)
        DA.objects.filter(pk=self.a.pk).update(status=DA.PICKED_UP)
        self.assertEqual(self.customer_map().json()["rider"]["first_name"], "Yaw")

    def test_the_customer_order_counts_the_stops(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.customer, 'customer')}")
        order = self.client.get(f"/api/orders/{self.a.order_id}/").json()
        self.assertEqual(order["delivery_stops"], {"total": 3, "done": 0, "skipped": 0})
        single = self.assign(self.make_order())
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.customer, 'customer')}")  # assign() signs in as the manager
        self.assertIsNone(self.client.get(f"/api/orders/{single.order_id}/").json()["delivery_stops"])

    def test_the_manager_map_draws_every_shop(self):
        from delivery import tracking

        with mock.patch("delivery.tracking.routing_service.leg", return_value=dict(ROAD)):
            payload = tracking.manager_job_map(DA.objects.get(pk=self.a.pk))
        self.assertEqual([p["name"] for p in payload["pickups"]], ["Shop A", "Shop B", "Shop C"])
        self.assertEqual(payload["pickup"]["name"], "Shop A")

    # ── Beyond the plan's cases ─────────────────────────────────────────────────────────────────

    def test_another_shop_never_sees_this_shops_code_rider_or_report(self):
        """Cross-shop leak check: a shop never sees another shop's code, the rider's position while the rider is at
        another shop, or another shop's skip report, on its order row or its map."""
        from delivery import services

        ShiftSession.objects.filter(rider=self.rider).update(last_lat=6.69871, last_lng=-1.62431)  # distinctive, to search for
        own_and_rider = ("QA11", "QD44", "6.69871", "-1.62431", "Yaw", "Mensah")
        for shop, own_code in ((self.shop_b, "QB22"), (self.shop_c, "QC33")):  # Shop A is being worked
            for shown in (self.owner_map(shop).content.decode(), str(self.owner_row(shop))):
                for needle in own_and_rider + tuple(c for c in CODES if c != own_code):
                    self.assertNotIn(needle, shown, shop.full_name)
        services.skip_stop(DA.objects.get(pk=self.a.pk), self.rider_staff, "Shop was shut", lat=A[0] + 0.0001, lng=A[1], accuracy=8)
        self.assertIsNotNone(self.owner_row(self.shop_a)["rider_report"])  # Shop A's own report exists...
        b_map, b_row = self.owner_map(self.shop_b), self.owner_row(self.shop_b)
        self.assertEqual(b_map.json()["rider"]["first_name"], "Yaw")  # ...the rider moved on to Shop B
        self.assertEqual((b_row["pickup_code"], b_row["rider_heading_here"], b_row["rider_report"]), ("QB22", True, None))
        for shown in (b_map.content.decode(), str(b_row)):
            for needle in ("QA11", "QC33", "QD44", "Shop was shut", "Shop A"):
                self.assertNotIn(needle, shown)
        c_map, c_row = self.owner_map(self.shop_c), self.owner_row(self.shop_c)
        self.assertEqual((c_map.json()["rider"], c_map.json()["leg"], c_map.json()["route"]), (None, None, None))
        self.assertIsNone(c_row["rider_report"])
        for shown in (c_map.content.decode(), str(c_row)):
            for needle in ("QA11", "QB22", "QD44", "Shop was shut", "Shop A", "6.69871", "-1.62431", "Yaw"):
                self.assertNotIn(needle, shown)

    def test_a_skipped_shop_map_shows_no_rider_and_a_far_skip_is_not_reported_to_it(self):
        from delivery import services

        # A rider "skips" Shop A from about 1 km away: the event is flagged for the manager, and the shop is not told
        # the rider reported at its shop.
        services.skip_stop(DA.objects.get(pk=self.a.pk), self.rider_staff, "Shop was shut", lat=A[0] - 0.01, lng=A[1], accuracy=8)
        row = self.owner_row(self.shop_a)
        self.assertEqual((row["pickup_status"], row["pickup_code"], row["rider_report"]), ("skipped", None, None))
        body = self.owner_map(self.shop_a).json()
        self.assertEqual((body["rider"], body["pickup"], body["rider_elsewhere"], body["stop"]["status"]), (None, None, False, "skipped"))

    def test_the_customer_map_counts_skipped_shops_and_names_none(self):
        from delivery import services

        services.skip_stop(DA.objects.get(pk=self.a.pk), self.manager, "Shop closed for the day", stop=self.s1)
        self.set(self.s2, status=PickupStop.COLLECTED)
        r = self.customer_map()
        self.assertEqual(r.json()["stops"], {"total": 3, "done": 1, "skipped": 1})
        self.assertIsNone(r.json()["rider"])
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.customer, 'customer')}")
        self.assertEqual(self.client.get(f"/api/orders/{self.a.order_id}/").json()["delivery_stops"], {"total": 3, "done": 1, "skipped": 1})

    def test_the_queue_map_draws_the_planned_shops_in_order(self):
        from delivery import tracking

        order = self.multi_order(*self.items, route_plan={"owner_ids": [self.shop_c.pk, self.shop_a.pk, self.shop_b.pk], "planned": True})
        with mock.patch("delivery.tracking.routing_service.leg", return_value=dict(ROAD)):
            payload = tracking.queue_map(order)
        self.assertEqual([(p["sequence"], p["name"], p["lat"], p["lng"]) for p in payload["pickups"]],
                         [(1, "Shop C", *C), (2, "Shop A", *A), (3, "Shop B", *B)])

    def test_the_owner_list_costs_the_same_queries_however_many_deliveries(self):
        """Stops, skip events and the rider's current job are read once per page, not once per row (legacy rows too)."""
        from delivery import services

        item_a, item_b, item_c = self.items
        services.skip_stop(DA.objects.get(pk=self.a.pk), self.rider_staff, "Shop was shut", lat=A[0] + 0.0001, lng=A[1], accuracy=8)

        def more():
            heading = self.assign(self.multi_order(item_b, item_a))  # Shop B first: the stop being worked
            DA.objects.filter(pk=heading.pk).update(status=DA.ACCEPTED)
            self.assign(self.multi_order(item_a, item_c, item_b))  # Shop B last: a later shop
            legacy = self.assign(self.multi_order(item_b, item_c))  # a delivered job from before multi-stop delivery
            legacy.stops.all().delete()
            DA.objects.filter(pk=legacy.pk).update(status=DA.DELIVERED, pickup_code="4321")
            self.multi_order(item_b)  # not given to a rider yet

        def count():
            self.as_owner(self.shop_b)
            with CaptureQueriesContext(connection) as ctx:
                r = self.client.get("/api/orders/owner/")
            self.assertEqual(r.status_code, 200)
            return len(ctx.captured_queries), len(r.json()["results"])

        more()
        few, rows_few = count()
        more()
        more()
        many, rows_many = count()
        self.assertEqual(rows_many - rows_few, 8)
        self.assertEqual(many, few)

    def test_the_customer_order_list_costs_the_same_queries_however_many_orders(self):
        item_a, item_b, item_c = self.items

        def more():
            self.assign(self.multi_order(item_a, item_b))
            legacy = self.assign(self.multi_order(item_c, item_a))  # delivered before multi-stop delivery: no saved stops
            legacy.stops.all().delete()
            DA.objects.filter(pk=legacy.pk).update(status=DA.DELIVERED, pickup_code="4321")
            self.make_order()  # not given to a rider yet

        def count():
            self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.customer, 'customer')}")
            with CaptureQueriesContext(connection) as ctx:
                r = self.client.get("/api/orders/")
            self.assertEqual(r.status_code, 200)
            return len(ctx.captured_queries), len(r.json())

        more()
        few, rows_few = count()
        more()
        more()
        many, rows_many = count()
        self.assertEqual(rows_many - rows_few, 6)
        self.assertEqual(many, few)

    # ── Fix round 1: no contact details in the shop's copy, no stale report, no past time as upcoming ──────

    def test_the_shops_copy_of_a_report_has_no_number_or_email_and_the_managers_is_verbatim(self):
        from delivery import services, stops

        note = "Shut. Call +233 24 123 4567, 024-123-4567 or 0241234567, or a@b.com. Code 1234 failed at 14:30."
        services.skip_stop(DA.objects.get(pk=self.a.pk), self.rider_staff, note, lat=A[0] + 0.0001, lng=A[1], accuracy=8)
        text = self.owner_row(self.shop_a)["rider_report"]["text"]
        self.assertTrue(text.endswith(": Shut. Call [number removed], [number removed] or [number removed], or [email removed]. Code 1234 failed at 14:30."), text)
        self.assertEqual(stops.skip_history(DA.objects.get(pk=self.a.pk))[0]["note"], note)  # the manager's evidence is untouched

    def test_a_reopened_stop_does_not_show_the_old_report_next_to_a_live_code(self):
        from delivery import services

        for point in (A, B, C):  # the rider skips every shop at the shop: the job fails and returns to the queue
            services.skip_stop(DA.objects.get(pk=self.a.pk), self.rider_staff, "Shop was shut", lat=point[0] + 0.0001, lng=point[1], accuracy=8)
        self.assertEqual(DA.objects.get(pk=self.a.pk).status, DA.FAILED)
        self.assertIsNotNone(self.owner_row(self.shop_a)["rider_report"])
        self.assign(self.a.order)  # given out again: every skipped shop reopens with its code
        row = self.owner_row(self.shop_a)
        self.assertEqual((row["pickup_status"], row["pickup_code"], row["rider_report"]), ("pending", "QA11", None))
        # Skipped again, by a manager this time: the old rider report is not why it is skipped now.
        services.skip_stop(DA.objects.get(pk=self.a.pk), self.manager, "Shop closed for the day", stop=PickupStop.objects.get(pk=self.s1.pk))
        row = self.owner_row(self.shop_a)
        self.assertEqual((row["pickup_status"], row["rider_report"]), ("skipped", None))

    def test_a_passed_arrival_time_is_marked_late_never_shown_as_upcoming(self):
        from delivery import payloads, tracking

        past = (timezone.now() - timedelta(minutes=5)).replace(microsecond=0)
        soon = (timezone.now() + timedelta(minutes=20)).replace(microsecond=0)
        self.set(self.s2, planned_arrival=past)
        self.set(self.s3, planned_arrival=soon)
        late_row, on_time_row = self.owner_row(self.shop_b), self.owner_row(self.shop_c)
        self.assertEqual((late_row["pickup_eta"], late_row["pickup_eta_late"]), (past.isoformat().replace("+00:00", "Z"), True))
        self.assertEqual((on_time_row["pickup_eta"], on_time_row["pickup_eta_late"]), (soon.isoformat().replace("+00:00", "Z"), False))
        self.assertIs(self.owner_row(self.shop_a)["pickup_eta_late"], False)  # no planned time: not late either
        self.assertEqual(self.owner_map(self.shop_b).json()["stop"], {"status": "pending", "planned_arrival": past.isoformat().replace("+00:00", "Z"), "late": True})
        self.assertIs(self.owner_map(self.shop_c).json()["stop"]["late"], False)
        a = DA.objects.get(pk=self.a.pk)
        with mock.patch("delivery.tracking.routing_service.leg", return_value=dict(ROAD)):
            self.assertEqual([p["late"] for p in tracking.manager_job_map(a)["pickups"]], [False, True, False])
        self.assertEqual([r["late"] for r in payloads.stops_block(a)["all"]], [False, True, False])
        # A collected stop's old time is history, not a late arrival.
        self.set(self.s2, status=PickupStop.COLLECTED)
        self.assertEqual([r["late"] for r in payloads.stops_block(DA.objects.get(pk=self.a.pk))["all"]], [False, False, False])


class ScrubForShopTests(SimpleTestCase):
    def test_phone_numbers_in_any_common_format_are_removed(self):
        from orders.serializers import scrub_for_shop

        for raw in ("+233 24 123 4567", "024-123-4567", "0241234567", "(024) 123 4567", "024.123.4567", "+233-24-123-4567",
                    "+233(0)241234567", "00233 24 123 4567"):
            with self.subTest(raw=raw):
                self.assertEqual(scrub_for_shop(f"Call {raw} now"), "Call [number removed] now")

    def test_emails_are_removed(self):
        from orders.serializers import scrub_for_shop

        for raw in ("a@b.com", "kofi.mensah+shop@mail.example.com.gh", "Yaw_99@x.io"):
            with self.subTest(raw=raw):
                self.assertEqual(scrub_for_shop(f"Mail {raw} please"), "Mail [email removed] please")

    def test_short_numbers_codes_and_times_stay(self):
        from orders.serializers import scrub_for_shop

        for note in ("Code 1234 did not work", "Back at 14:30", "Shop 12, row 3", "Waited 25 min", "Ref 123456"):
            with self.subTest(note=note):
                self.assertEqual(scrub_for_shop(note), note)


class LegacyJobPrivacyTests(DeliveryCase):
    """A job made before multi-stop delivery collects from its first item's shop: that shop alone sees its code and the
    rider, whatever the order's plan says, both before and after its one stop is saved."""

    def setUp(self):
        super().setUp()
        self.rider_staff.full_name = "Yaw Mensah"
        self.rider_staff.save()
        self.chop, item_chop = self.make_shop("Chop A", "+233207000411", A, slug="food")
        self.shop_b, item_b = self.make_shop("Shop B", "+233207000412", B)
        order = self.multi_order(item_chop, item_b)  # food goes last, so the plan would send a new rider to Shop B first
        self.job = DA.objects.create(order=order, dispatch=self.rider_staff, assigned_by=self.manager, status=DA.ACCEPTED,
                                     pickup_code="4321", drop_code="8765", accepted_at=timezone.now())
        ShiftSession.objects.create(rider=self.rider, last_lat=6.701, last_lng=-1.62, last_fix_at=timezone.now())

    def look(self, owner):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(owner, 'business_owner')}")
        row = {o["id"]: o for o in self.client.get("/api/orders/owner/").json()["results"]}[self.job.order_id]
        with mock.patch("delivery.tracking.routing_service.leg", return_value=dict(ROAD)):
            body = self.client.get(f"/api/orders/owner/{self.job.order_id}/tracking/").json()
        return row, body

    def check(self):
        row, body = self.look(self.chop)
        self.assertEqual((row["pickup_code"], row["rider_heading_here"], row["pickup_status"]), ("4321", True, "pending"))
        self.assertEqual((body["rider"]["first_name"], body["pickup"]["name"]), ("Yaw", "Chop A"))
        row, body = self.look(self.shop_b)
        self.assertEqual((row["pickup_code"], row["rider_heading_here"], row["pickup_status"], row["rider_report"]), (None, False, None, None))
        self.assertEqual((body["rider"], body["pickup"], body["stop"]), (None, None, None))
        self.assertNotIn("4321", str(row))

    def test_unsaved_legacy_stop(self):
        self.check()
        self.assertEqual(PickupStop.objects.filter(assignment=self.job).count(), 0)  # reads write nothing

    def test_saved_legacy_stop(self):
        from delivery import stops

        stops.ensure_stops(self.job)
        self.assertEqual([(s.business_owner_id, s.code) for s in self.job.stops.all()], [(self.chop.pk, "4321")])
        self.check()
