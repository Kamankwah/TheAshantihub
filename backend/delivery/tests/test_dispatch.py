from datetime import timedelta
from decimal import Decimal
from unittest import mock

from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone

from accounts.testing import make_staff
from approvals import services as approvals
from approvals.models import ApprovalRequest
from delivery import config, dispatching, rates
from delivery.models import AutoAssignRules, DeliverySettings, Offer, QueueHold, RateCard, Rider, RiderDocument, ShiftSession, TimeLimits
from disputes.models import Dispute
from orders.models import DeliveryAssignment
from routing import service as routing_service

from .base import DROP, PICKUP, PNG, DeliveryCase

RULES = {"w_distance": 50, "w_fairness": 30, "w_idle": 20, "offer_timeout_s": 45, "max_declines": 2, "force_slack_min": 10, "radius_km": "5", "max_active_jobs": 2, "stale_s": 120, "batch_radius_km": "2", "cash_cap": "500"}
CARD = {
    "customer_base": "5", "customer_per_km": "1.5", "customer_min_fee": "8", "extra_pickup": "2", "express_multiplier": "1.5", "round_up_to": "0.5",
    "vehicle_multipliers": {"motorbike": "1", "car": "1.5"}, "rider_per_job": "3", "rider_per_km": "1", "wait_after_min": 10, "wait_per_min": "0.2",
}
LIMITS = {"promise_standard_min": 90, "promise_express_min": 45, "opens_at": "07:00", "closes_at": "20:00", "assign_within_min": 10, "pickup_within_min": 30, "first_response_hours": 2, "dispute_answer_hours": 24}


class EngineCase(DeliveryCase):
    def setUp(self):
        super().setUp()
        self.admin = make_staff("super_admin", "sa@example.com")
        self.approve_papers()
        self.approve_papers(Rider.objects.get(staff=self.other_staff))
        self.other = Rider.objects.get(staff=self.other_staff)

    def on_shift(self, rider, point=PICKUP, age=5):
        return ShiftSession.objects.create(rider=rider, last_lat=point[0], last_lng=point[1], last_fix_at=timezone.now() - timedelta(seconds=age))

    def set_rules(self, **over):
        self.as_staff(self.admin, sudo=True)
        r = self.client.post("/api/delivery/rules/auto-assign/", {"values": {**RULES, **over}}, format="json")
        assert r.status_code == 201, r.content
        return r

    def switch(self, on=True):
        self.as_staff(self.manager, sudo=True)
        # the manager holds delivery.rates; the switch is theirs
        r = self.client.post("/api/delivery/auto-assign/switch/", {"on": on}, format="json")
        assert r.status_code == 200, r.content


class RankingTests(EngineCase):
    def test_nearest_rider_scores_best_and_ineligible_ones_say_why(self):
        near = self.on_shift(self.rider, (PICKUP[0] + 0.002, PICKUP[1]))
        self.on_shift(self.other, (PICKUP[0] + 0.03, PICKUP[1]))  # about 4.3 km, inside the 5 km radius
        order = self.make_order()
        ranked = dispatching.rank(order)
        self.assertEqual([r["rider_id"] for r in ranked["eligible"]], [self.rider.pk, self.other.pk])
        self.assertEqual(sum(p["weight"] for p in ranked["eligible"][0]["parts"]), 100)
        self.assertGreater(ranked["eligible"][0]["total"], ranked["eligible"][1]["total"])
        self.assertTrue(ranked["pickup_located"])

    def test_reasons_for_leaving_a_rider_out(self):
        order = self.make_order()
        reasons = lambda: {r["full_name"]: r["reason"] for r in dispatching.rank(order)["left_out"]}
        self.assertEqual(reasons()[self.rider_staff.full_name], "Not on shift")
        shift = self.on_shift(self.rider, age=300)
        self.assertEqual(reasons()[self.rider_staff.full_name], "Location is stale")
        shift.last_fix_at = timezone.now()
        shift.on_break = True
        shift.save()
        self.assertEqual(reasons()[self.rider_staff.full_name], "On a break")
        shift.on_break = False
        shift.save()
        self.rider.job_hold = True
        self.rider.save()
        self.assertEqual(reasons()[self.rider_staff.full_name], "Stopped from new jobs")
        self.rider.job_hold = False
        self.rider.save()
        shift.last_lat = PICKUP[0] + 0.2
        shift.save()
        self.assertIn("km away", reasons()[self.rider_staff.full_name])

    def test_an_order_whose_business_has_no_pin_cannot_be_auto_assigned(self):
        self.listing.lat = self.listing.lng = None
        self.listing.save()
        self.on_shift(self.rider)
        ranked = dispatching.rank(self.make_order())
        self.assertFalse(ranked["pickup_located"])
        self.assertEqual(ranked["eligible"], [])
        self.assertEqual(ranked["left_out"][0]["reason"], "Pickup location missing")

    def test_a_rider_with_the_maximum_jobs_is_left_out(self):
        self.on_shift(self.rider)
        for _ in range(2):
            self.assign(self.make_order())
        self.assertEqual({r["full_name"]: r["reason"] for r in dispatching.rank(self.make_order())["left_out"]}[self.rider_staff.full_name], "Already has 2 jobs")

    def test_the_queue_and_ranking_endpoints(self):
        self.on_shift(self.rider)
        order = self.make_order()
        self.as_staff(self.manager)
        queue = self.client.get("/api/delivery/queue/").json()
        self.assertEqual(queue["results"][0]["order_id"], order.pk)
        self.assertEqual(queue["results"][0]["suggested"]["rider_id"], self.rider.pk)
        self.assertFalse(queue["auto_assign"]["on"])
        self.assertEqual(queue["auto_assign"]["rules"]["source"], "defaults")
        self.assertEqual(queue["deadlines"], "none")
        self.assertIsNone(queue["results"][0]["deadline_at"])
        ranking = self.client.get(f"/api/delivery/queue/{order.pk}/ranking/").json()
        self.assertEqual(ranking["eligible"][0]["rider_id"], self.rider.pk)


class OfferTests(EngineCase):
    def test_offer_accept_makes_the_assignment_and_acceptance_in_one_step(self):
        self.on_shift(self.rider)
        order = self.make_order()
        self.as_staff(self.manager)
        offer_id = self.client.post(f"/api/delivery/queue/{order.pk}/offer/", {"rider": self.rider.pk}, format="json").json()["offer_id"]
        self.as_staff(self.rider_staff)
        mine = self.client.get("/api/delivery/rider/offers/").json()
        self.assertEqual(mine["results"][0]["order_id"], order.pk)
        self.assertLessEqual(mine["results"][0]["seconds_left"], 45)
        job = self.client.post(f"/api/delivery/rider/offers/{offer_id}/accept/").json()
        self.assertEqual(job["status"], "accepted")
        assignment = DeliveryAssignment.objects.get(order=order)
        self.assertEqual(assignment.assignment_mode, "offer")
        self.assertEqual(Offer.objects.get(pk=offer_id).status, Offer.ACCEPTED)
        self.assertEqual(self.client.get("/api/delivery/rider/offers/").json()["acceptance_30d"], {"accepted": 1, "of": 1})

    def test_a_late_accept_and_a_second_accept_are_refused(self):
        order = self.make_order()
        offer = dispatching.make_offer(order, self.rider, source=Offer.MANAGER, by=self.manager)
        Offer.objects.filter(pk=offer.pk).update(expires_at=timezone.now() - timedelta(seconds=1))
        self.as_staff(self.rider_staff)
        late = self.client.post(f"/api/delivery/rider/offers/{offer.pk}/accept/")
        self.assertEqual((late.status_code, late.json()["code"]), (409, "offer_expired"))
        fresh = dispatching.make_offer(order, self.rider, source=Offer.MANAGER, by=self.manager)
        self.assertEqual(self.client.post(f"/api/delivery/rider/offers/{fresh.pk}/accept/").status_code, 200)
        self.assertEqual(self.client.post(f"/api/delivery/rider/offers/{fresh.pk}/accept/").json()["code"], "offer_closed")

    def test_someone_elses_offer_is_404_and_a_taken_order_closes_the_offer(self):
        order = self.make_order()
        offer = dispatching.make_offer(order, self.rider, source=Offer.MANAGER, by=self.manager)
        self.as_staff(self.other_staff)
        self.assertEqual(self.client.post(f"/api/delivery/rider/offers/{offer.pk}/accept/").status_code, 404)
        self.assign(order, self.other_staff)
        self.as_staff(self.rider_staff)
        self.assertEqual(self.client.post(f"/api/delivery/rider/offers/{offer.pk}/accept/").json()["code"], "offer_closed")

    def test_decline_then_engine_moves_to_the_next_rider(self):
        self.on_shift(self.rider)
        self.on_shift(self.other, (PICKUP[0] + 0.02, PICKUP[1]))
        order = self.make_order()
        self.switch(True)
        self.assertEqual(dispatching.run_engine()["offered"], 1)
        first = Offer.objects.get(order=order)
        self.assertEqual(first.rider, self.rider)
        self.assertEqual(dispatching.run_engine()["offered"], 0)  # one live offer at a time
        self.as_staff(self.rider_staff)
        self.client.post(f"/api/delivery/rider/offers/{first.pk}/decline/", {"reason": "Too far"}, format="json")
        self.assertEqual(dispatching.run_engine()["offered"], 1)
        self.assertEqual(Offer.objects.filter(order=order, status=Offer.OFFERED).get().rider, self.other)

    def test_a_timed_out_offer_is_expired_and_enough_refusals_force_the_job(self):
        self.on_shift(self.rider)
        self.on_shift(self.other, (PICKUP[0] + 0.02, PICKUP[1]))
        third = self.rider  # max_declines is 2 in the rules below
        self.set_rules()
        order = self.make_order()
        self.switch(True)
        dispatching.run_engine()
        Offer.objects.filter(order=order).update(expires_at=timezone.now() - timedelta(seconds=1))
        out = dispatching.run_engine()
        self.assertEqual(out["expired"], 1)
        Offer.objects.filter(order=order, status=Offer.OFFERED).update(expires_at=timezone.now() - timedelta(seconds=1))
        dispatching.run_engine()
        self.assertEqual(Offer.objects.filter(order=order, status=Offer.EXPIRED).count(), 2)
        # Both riders have now timed out on it: nobody is eligible, so it stays in the queue for a person.
        self.assertFalse(DeliveryAssignment.objects.filter(order=order).exists())

    def test_with_the_switch_off_the_engine_offers_nothing(self):
        self.on_shift(self.rider)
        self.make_order()
        self.assertEqual(dispatching.run_engine()["offered"], 0)
        self.assertFalse(Offer.objects.exists())

    def test_force_assign_and_schedule(self):
        self.on_shift(self.rider)
        order = self.make_order()
        self.as_staff(self.manager)
        when = (timezone.now() + timedelta(hours=1)).isoformat()
        self.assertEqual(self.client.post(f"/api/delivery/queue/{order.pk}/schedule/", {"release_at": when}, format="json").status_code, 200)
        self.assertTrue(QueueHold.objects.filter(order=order).exists())
        self.switch(True)
        self.assertEqual(dispatching.run_engine()["offered"], 0)  # held
        self.as_staff(self.manager)
        forced = self.client.post(f"/api/delivery/queue/{order.pk}/force-assign/", {"rider": self.rider.pk}, format="json")
        self.assertEqual(forced.status_code, 201, forced.content)
        self.assertEqual(DeliveryAssignment.objects.get(order=order).assignment_mode, "forced")
        self.assertFalse(QueueHold.objects.filter(order=order).exists())
        self.assertEqual(self.client.post(f"/api/delivery/queue/{order.pk}/force-assign/", {"rider": self.other.pk}, format="json").status_code, 404)

    def test_short_time_forces_the_best_rider_without_asking(self):
        self.on_shift(self.rider)
        self.set_rules()
        self.as_staff(self.admin, sudo=True)
        self.client.post("/api/delivery/rules/time-limits/", {"values": {**LIMITS, "promise_standard_min": 10, "promise_express_min": 10}}, format="json")
        order = self.make_order()
        Offer.objects.all().delete()
        self.switch(True)
        out = dispatching.run_engine()
        self.assertEqual(out["forced"], 1)
        a = DeliveryAssignment.objects.get(order=order)
        self.assertEqual(a.assignment_mode, "auto")
        self.assertIsNotNone(a.deadline_at)

    def test_the_switch_is_logged_and_tells_super_admin(self):
        self.as_staff(self.manager, sudo=True)
        self.client.post("/api/delivery/auto-assign/switch/", {"on": True}, format="json")
        self.assertTrue(DeliverySettings.get().auto_assign_on)
        self.assertTrue(self.admin.notifications.filter(kind="delivery_alert").exists())
        from activity.models import ActivityEvent

        self.assertTrue(ActivityEvent.objects.filter(verb="delivery-auto-assign-switch").exists())


class ConfigTests(EngineCase):
    def test_a_manager_proposes_and_super_admin_approves_a_new_version(self):
        self.as_staff(self.manager)
        r = self.client.post("/api/delivery/rules/auto-assign/", {"values": RULES, "note": "More rider fairness"}, format="json")
        self.assertEqual(r.status_code, 201, r.content)
        self.assertFalse(r.json()["applied"])
        self.assertIsNone(self.client.get("/api/delivery/rules/auto-assign/").json()["current"])
        self.assertEqual(self.client.get("/api/delivery/rules/auto-assign/").json()["pending"]["values"]["max_declines"], 2)
        again = self.client.post("/api/delivery/rules/auto-assign/", {"values": RULES}, format="json")
        self.assertEqual(again.status_code, 409)
        approvals.approve(r.json()["approval_id"], self.admin)
        current = self.client.get("/api/delivery/rules/auto-assign/").json()["current"]
        self.assertEqual((current["version"], current["max_declines"]), (1, 2))
        self.assertEqual(config.effective_rules()["source"], "version")

    def test_a_manager_cannot_approve_their_own_proposal(self):
        self.as_staff(self.manager)
        r = self.client.post("/api/delivery/rules/time-limits/", {"values": LIMITS}, format="json")
        with self.assertRaises(approvals.ApprovalError):
            approvals.approve(r.json()["approval_id"], self.manager)

    def test_a_super_admins_own_proposal_applies_at_once_and_replaces_the_old_version(self):
        self.set_rules()
        r = self.set_rules(max_declines=4)
        self.assertTrue(r.json()["applied"])
        versions = list(AutoAssignRules.objects.order_by("version").values_list("version", "status"))
        self.assertEqual(versions, [(1, "superseded"), (2, "live")])

    def test_bad_values_are_refused_with_the_field(self):
        self.as_staff(self.manager)
        bad = self.client.post("/api/delivery/rules/auto-assign/", {"values": {**RULES, "w_idle": 5}}, format="json")
        self.assertEqual((bad.status_code, bad.json()["field"]), (400, "w_distance"))
        bad = self.client.post("/api/delivery/rules/time-limits/", {"values": {**LIMITS, "promise_express_min": 120}}, format="json")
        self.assertEqual(bad.status_code, 400)
        bad = self.client.post("/api/delivery/rules/rate-card/", {"values": {**CARD, "customer_base": "abc"}}, format="json")
        self.assertEqual(bad.json()["field"], "customer_base")

    def test_withdrawing_a_waiting_change(self):
        self.as_staff(self.manager)
        r = self.client.post("/api/delivery/rules/rate-card/", {"values": CARD}, format="json").json()
        self.assertEqual(self.client.post("/api/delivery/rules/withdraw/", {"approval_id": r["approval_id"]}, format="json").status_code, 200)
        self.assertIsNone(self.client.get("/api/delivery/rules/rate-card/").json()["pending"])

    def test_the_rate_card_screen_reads_the_live_distance_basis(self):
        self.as_staff(self.manager)
        for mode, basis in (("road", routing_service.BASIS_ROAD), ("straight_line_estimate", routing_service.BASIS_ESTIMATE)):
            with mock.patch("routing.service.status", return_value={"mode": mode, "factor": 1.3, "healthy": mode == "road"}):
                page = self.client.get("/api/delivery/rules/rate-card/").json()
            self.assertEqual(page["distance_basis"], basis)

    def test_there_is_no_rate_card_until_one_is_approved_and_nothing_is_charged(self):
        self.as_staff(self.manager)
        page = self.client.get("/api/delivery/rules/rate-card/").json()
        self.assertIsNone(page["current"])
        self.assertFalse(page["fee_charging"]["enabled"])
        self.assertEqual(self.client.post("/api/delivery/rules/rate-card/quote/", {"km": 3}, format="json").json()["code"], "no_card")

    def test_deadline_waits_for_the_opening_time_and_none_without_limits(self):
        order = self.make_order()
        self.assertIsNone(dispatching.deadline_for(order))
        tz = timezone.get_current_timezone()
        day = timezone.localdate()
        late = timezone.make_aware(timezone.datetime(day.year, day.month, day.day, 21, 0), tz)
        type(order).objects.filter(pk=order.pk).update(placed_at=late)
        order.refresh_from_db()
        limits = TimeLimits(promise_standard_min=90, promise_express_min=45)
        deadline = timezone.localtime(dispatching.deadline_for(order, limits=limits), tz)
        self.assertEqual((deadline.date(), deadline.hour, deadline.minute), (day + timedelta(days=1), 8, 30))


class RateTests(EngineCase):
    def card(self):
        return RateCard(**{k: (Decimal(v) if isinstance(v, str) else v) for k, v in CARD.items()})

    def test_customer_fee_lines_minimum_multipliers_and_rounding(self):
        fee = rates.customer_fee(self.card(), 4, vehicle="motorbike")
        self.assertEqual(fee["total"], "11.00")  # 5 + 1.5*4
        self.assertEqual(rates.customer_fee(self.card(), 0.5)["total"], "8.00")  # minimum fee
        self.assertEqual(rates.customer_fee(self.card(), 4, vehicle="car")["total"], "16.50")
        self.assertEqual(rates.customer_fee(self.card(), 4, express=True)["total"], "16.50")
        self.assertEqual(rates.customer_fee(self.card(), 3.3)["total"], "10.00")  # 9.95 rounded up to 0.50
        self.assertEqual(fee["distance_basis"], rates.BASIS)

    def test_rider_pay_waiting_and_hold(self):
        pay = rates.rider_pay(self.card(), 4, wait_minutes=15)
        self.assertEqual(pay["total"], "8.00")  # 3 + 4 + 5 min x 0.20
        self.assertEqual(rates.rider_pay(self.card(), 4, wait_minutes=15, hold_wait=True)["total"], "7.00")

    def test_delivering_records_the_riders_pay_only_when_a_card_is_in_force(self):
        a = self.assign()
        self.run_to(a, "deliver")
        a.refresh_from_db()
        self.assertIsNone(a.rider_pay)
        self.as_staff(self.admin, sudo=True)
        self.client.post("/api/delivery/rules/rate-card/", {"values": CARD}, format="json")
        b = self.assign(self.make_order())
        self.run_to(b, "deliver")
        b.refresh_from_db()
        self.assertIsNotNone(b.rider_pay)
        self.assertEqual(b.rider_pay_breakdown["rate_card_version"], 1)
        self.as_staff(self.manager)
        payouts = self.client.get("/api/delivery/payouts/").json()
        row = next(r for r in payouts["riders"] if r["staff_id"] == self.rider_staff.pk)
        self.assertEqual((row["jobs"], row["jobs_with_pay"]), (2, 1))
        self.assertEqual(payouts["payout"]["status"], "not_connected")

    def test_checkout_adds_a_fee_only_when_switched_on(self):
        from django.test import override_settings

        from accounts.authentication import issue_token
        from cart.models import Cart, CartItem

        self.as_staff(self.admin, sudo=True)
        self.client.post("/api/delivery/rules/rate-card/", {"values": CARD}, format="json")

        def checkout():
            cart, _ = Cart.objects.get_or_create(customer=self.customer)
            cart.items.all().delete()
            CartItem.objects.create(cart=cart, listing=self.listing, quantity=1, unit_price_snapshot="100.00")
            self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.customer, 'customer')}")
            return self.client.post("/api/orders/checkout/", {"delivery_method": "door_to_door", "delivery_address": "1 Road", "delivery_phone": "+233200000000", "delivery_lat": DROP[0], "delivery_lng": DROP[1]}, format="json").json()

        off = checkout()
        self.assertEqual(Decimal(str(off["total_amount"])), Decimal("100.00"))
        self.assertIsNone(off["delivery_fee"])
        with override_settings(DELIVERY_FEE_ENABLED=True):
            on = checkout()
        self.assertGreater(Decimal(str(on["total_amount"])), Decimal("100.00"))
        self.assertEqual(Decimal(str(on["total_amount"])) - Decimal("100.00"), Decimal(str(on["delivery_fee"])))


class MenuBadgeTests(DeliveryCase):
    """The Delivery Manager's menu badges count live queues and are gated by the permission that opens the screen."""

    def test_counts_for_the_manager_and_zeroes_for_a_rider(self):
        self.make_order()
        RiderDocument.objects.create(
            rider=self.rider, kind="insurance", file=SimpleUploadedFile("i.png", PNG, "image/png"), status=RiderDocument.UPLOADED,
        )
        client = self.as_staff(self.manager)
        data = client.get("/api/notifications/staff-badges/").json()
        self.assertEqual(data["delivery_queue"], 1)
        self.assertEqual(data["delivery_documents"], 1)
        self.assertEqual(data["delivery_cases"], 0)
        self.assertEqual(data["delivery_cash"], 0)
        rider = self.as_staff(self.rider_staff).get("/api/notifications/staff-badges/").json()
        self.assertEqual((rider["delivery_queue"], rider["delivery_documents"], rider["delivery_cases"]), (0, 0, 0))


class RiderMoneyTests(DeliveryCase):
    """The rider's own pay and cash: a record of what was earned, honest about what does not exist."""

    def test_earnings_total_only_jobs_with_recorded_pay_and_never_show_a_made_up_figure(self):
        a = self.assign()
        self.run_to(a, "deliver")
        data = self.as_staff(self.rider_staff).get("/api/delivery/rider/earnings/?period=today").json()
        self.assertEqual((data["jobs"], data["jobs_without_pay"]), (1, 1))  # no rate card was in force
        self.assertIsNone(data["total"])
        self.assertIsNone(data["rates"])
        self.assertEqual(data["payouts"]["status"], "not_connected")
        DeliveryAssignment.objects.filter(pk=a.pk).update(rider_pay="19.16", rider_pay_breakdown={"distance_km": "6.2", "lines": [{"label": "Per job", "amount": "8.00"}]})
        data = self.as_staff(self.rider_staff).get("/api/delivery/rider/earnings/?period=week").json()
        self.assertEqual((data["total"], data["jobs_without_pay"]), ("19.16", 0))
        self.assertEqual(data["results"][0]["lines"][0]["label"], "Per job")

    def test_another_riders_pay_is_never_included(self):
        a = self.assign()
        self.run_to(a, "deliver")
        DeliveryAssignment.objects.filter(pk=a.pk).update(rider_pay="19.16")
        data = self.as_staff(self.other_staff).get("/api/delivery/rider/earnings/?period=week").json()
        self.assertEqual((data["jobs"], data["total"]), (0, None))

    def test_cash_says_it_is_not_offered_instead_of_showing_zero(self):
        data = self.as_staff(self.rider_staff).get("/api/delivery/rider/cash/").json()
        self.assertFalse(data["cod"]["offered"])
        self.assertIsNone(data["holding"])
        self.assertEqual(data["cap"], "500.00")

    def test_cash_holding_and_room_once_a_job_carries_cash(self):
        a = self.assign()
        DeliveryAssignment.objects.filter(pk=a.pk).update(cod_amount="180.00", cash_collected_at=timezone.now())
        data = self.as_staff(self.rider_staff).get("/api/delivery/rider/cash/").json()
        self.assertTrue(data["cod"]["offered"])
        self.assertEqual((data["holding"], data["room"], data["collected_today"]), ("180.00", "320.00", "180.00"))
        self.assertEqual(self.as_staff(self.manager).get("/api/delivery/rider/cash/").status_code, 403)
