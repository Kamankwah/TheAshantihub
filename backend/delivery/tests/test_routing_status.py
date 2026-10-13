from unittest import mock

from django.test import SimpleTestCase

from delivery import board, dispatching
from delivery.models import Offer
from delivery.views_queue import offer_payload

from .test_dispatch import EngineCase
from .base import DROP, PICKUP


class RoutingBlockTests(SimpleTestCase):
    def test_board_routing_block_reflects_status(self):
        with mock.patch("delivery.board.routing_service.status", return_value={"mode": "road", "factor": 1.3, "healthy": True}):
            block = board.routing_block()
        self.assertEqual(block["mode"], "road")
        self.assertIn("road", block["note"].lower())

    def test_estimate_mode_note_says_estimate(self):
        with mock.patch("delivery.board.routing_service.status", return_value={"mode": "straight_line_estimate", "factor": 1.3, "healthy": False}):
            block = board.routing_block()
        self.assertEqual(block["mode"], "straight_line_estimate")
        self.assertIn("estimate", block["note"].lower())


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
