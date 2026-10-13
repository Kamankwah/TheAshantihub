from unittest import mock

from django.test import SimpleTestCase

from delivery import board, dispatching
from delivery.models import Offer
from delivery.views_queue import offer_payload

from .test_dispatch import EngineCase
from .base import DROP, PICKUP


class RoutingBlockTests(SimpleTestCase):
    def test_board_routing_block_reflects_status(self):
        with mock.patch("delivery.board.routing_service.status", return_value={"mode": "road", "factor": 1.3, "healthy": True, "configured": True}):
            block = board.routing_block()
        self.assertEqual(block["mode"], "road")
        self.assertIn("road", block["note"].lower())

    def test_estimate_mode_note_says_estimate(self):
        with mock.patch("delivery.board.routing_service.status", return_value={"mode": "straight_line_estimate", "factor": 1.3, "healthy": False, "configured": True}):
            block = board.routing_block()
        self.assertEqual(block["mode"], "straight_line_estimate")
        self.assertIn("estimate", block["note"].lower())
        self.assertIn("not answering", block["note"])

    def test_not_configured_note_says_not_connected(self):
        with mock.patch("delivery.board.routing_service.status", return_value={"mode": "straight_line_estimate", "factor": 1.3, "healthy": False, "configured": False}):
            block = board.routing_block()
        self.assertEqual(block["note"], "Straight-line estimate. A road route service is not connected.")

    def test_road_note(self):
        with mock.patch("delivery.board.routing_service.status", return_value={"mode": "road", "factor": 1.3, "healthy": True, "configured": True}):
            self.assertEqual(board.routing_block()["note"], "Distances and times are road routes.")

    def test_estimate_figures_block_never_claims_road_routes(self):
        with mock.patch("delivery.board.routing_service.status", return_value={"mode": "road", "factor": 1.3, "healthy": True, "configured": True}):
            block = board.routing_block(estimate_figures=True)
        self.assertEqual(block["distance_basis"], "straight-line estimate x 1.3")
        self.assertNotIn("are road routes", block["note"])
        self.assertIn("estimate", block["note"])


class RankingBasisTests(EngineCase):
    ROAD = {"mode": "road", "factor": 1.3, "healthy": True, "configured": True}

    def test_rank_payload_is_an_estimate_even_when_routing_status_is_road(self):
        self.on_shift(self.rider, (PICKUP[0] + 0.002, PICKUP[1]))
        with mock.patch("routing.service.status", return_value=self.ROAD):
            ranked = dispatching.rank(self.make_order())
        self.assertEqual(ranked["distance_basis"], "straight-line estimate x 1.3")

    def test_queue_and_ranking_endpoints_label_estimate_figures_in_road_mode(self):
        self.on_shift(self.rider, (PICKUP[0] + 0.002, PICKUP[1]))
        order = self.make_order()
        self.as_staff(self.manager)
        with mock.patch("routing.service.status", return_value=self.ROAD):
            queue = self.client.get("/api/delivery/queue/").json()
            ranking = self.client.get(f"/api/delivery/queue/{order.pk}/ranking/").json()
        self.assertEqual(queue["routing"]["distance_basis"], "straight-line estimate x 1.3")
        self.assertNotIn("are road routes", queue["routing"]["note"])
        self.assertEqual(ranking["distance_basis"], "straight-line estimate x 1.3")


class OfferPayloadRoutingTests(EngineCase):
    def test_offer_payload_uses_the_road_leg_and_its_basis(self):
        self.on_shift(self.rider)
        order = self.make_order()
        offer = dispatching.make_offer(order, self.rider, source=Offer.MANAGER, by=self.manager)
        road = {"distance_km": 7.7, "duration_s": 600, "basis": "road route", "geometry": None}
        with mock.patch("routing.service.leg", return_value=road):
            payload = offer_payload(offer)
        self.assertEqual(payload["distance_basis"], "road route")
        self.assertEqual(payload["trip_km"], 7.7)
        self.assertEqual(payload["to_pickup_km"], 7.7)

    def _payload_with(self, *legs):
        self.on_shift(self.rider)
        order = self.make_order()
        offer = dispatching.make_offer(order, self.rider, source=Offer.MANAGER, by=self.manager)
        with mock.patch("routing.service.leg", side_effect=list(legs)):
            return offer_payload(offer)

    def test_basis_is_road_only_when_every_leg_is_road(self):
        road = {"distance_km": 3.0, "duration_s": 300, "basis": "road route", "geometry": None}
        self.assertEqual(self._payload_with(road, road)["distance_basis"], "road route")

    def test_basis_is_the_estimate_when_one_leg_fell_back(self):
        road = {"distance_km": 3.0, "duration_s": 300, "basis": "road route", "geometry": None}
        est = {"distance_km": 4.0, "duration_s": 400, "basis": "straight-line estimate x 1.3", "geometry": None}
        self.assertEqual(self._payload_with(road, est)["distance_basis"], "straight-line estimate x 1.3")

    def test_basis_is_the_estimate_when_the_trip_leg_is_the_one_that_fell_back(self):
        road = {"distance_km": 3.0, "duration_s": 300, "basis": "road route", "geometry": None}
        est = {"distance_km": 4.0, "duration_s": 400, "basis": "straight-line estimate x 1.3", "geometry": None}
        self.assertEqual(self._payload_with(est, road)["distance_basis"], "straight-line estimate x 1.3")

    def test_basis_is_the_estimate_when_both_legs_are_estimates(self):
        est = {"distance_km": 4.0, "duration_s": 400, "basis": "straight-line estimate x 1.3", "geometry": None}
        self.assertEqual(self._payload_with(est, est)["distance_basis"], "straight-line estimate x 1.3")
