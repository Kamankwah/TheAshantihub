from unittest import mock

from django.core.cache import cache
from django.test import SimpleTestCase, override_settings

from routing import client, service

KUMASI = (6.6885, -1.6244)
NEARBY = (6.7000, -1.6000)


class LegTests(SimpleTestCase):
    def setUp(self):
        cache.clear()

    @override_settings(OSRM_URL="http://osrm:5000")
    def test_road_result_is_labelled_road(self):
        with mock.patch("routing.client.route", return_value={"distance_m": 5400.0, "duration_s": 700.0, "geometry": [[-1.62, 6.68]]}):
            out = service.leg(KUMASI, NEARBY, geometry=True)
        self.assertEqual(out["basis"], service.BASIS_ROAD)
        self.assertEqual(out["distance_km"], 5.4)
        self.assertEqual(out["duration_s"], 700)
        self.assertEqual(out["geometry"], [[-1.62, 6.68]])

    @override_settings(OSRM_URL="http://osrm:5000")
    def test_geometry_omitted_unless_asked(self):
        with mock.patch("routing.client.route", return_value={"distance_m": 5400.0, "duration_s": 700.0, "geometry": [[1, 2]]}):
            self.assertIsNone(service.leg(KUMASI, NEARBY)["geometry"])

    @override_settings(OSRM_URL="http://osrm:5000")
    def test_no_route_falls_back_to_labelled_estimate(self):
        with mock.patch("routing.client.route", side_effect=client.OsrmError("NoRoute")):
            with self.assertLogs("routing.service", "INFO") as logs:
                out = service.leg(KUMASI, NEARBY)
        self.assertEqual({r.levelname for r in logs.records}, {"INFO"})
        self.assertIsNone(logs.records[0].exc_info)
        self.assertEqual(out["basis"], service.BASIS_ESTIMATE)
        self.assertGreater(out["distance_km"], 0)
        self.assertGreater(out["duration_s"], 0)
        self.assertIsNone(out["geometry"])

    @override_settings(OSRM_URL="http://osrm:5000")
    def test_unexpected_error_from_client_falls_back_to_estimate(self):
        with mock.patch("routing.client.route", side_effect=ValueError("bad value")), self.assertLogs("routing.service", "ERROR") as logs:
            out = service.leg(KUMASI, NEARBY)
        self.assertIsNotNone(logs.records[0].exc_info)
        self.assertEqual(out["basis"], service.BASIS_ESTIMATE)
        self.assertGreater(out["distance_km"], 0)

    @override_settings(OSRM_URL="")
    def test_unconfigured_never_touches_the_client(self):
        with mock.patch("routing.client.route") as route:
            out = service.leg(KUMASI, NEARBY)
        route.assert_not_called()
        self.assertEqual(out["basis"], service.BASIS_ESTIMATE)

    @override_settings(OSRM_URL="http://osrm:5000")
    def test_repeat_call_is_served_from_cache(self):
        with mock.patch("routing.client.route", return_value={"distance_m": 1000.0, "duration_s": 100.0, "geometry": []}) as route:
            service.leg(KUMASI, NEARBY)
            service.leg(KUMASI, NEARBY)
        self.assertEqual(route.call_count, 1)

    @override_settings(OSRM_URL="http://osrm:5000")
    def test_estimate_duration_uses_fallback_speed(self):
        with mock.patch("routing.client.route", side_effect=client.OsrmError("down")), self.assertLogs("routing.service", "INFO"):
            out = service.leg(KUMASI, NEARBY)
        self.assertAlmostEqual(out["duration_s"], out["distance_km"] / service.FALLBACK_KMH * 3600, delta=1)


class UnavailableTests(SimpleTestCase):
    def setUp(self):
        cache.clear()

    @override_settings(OSRM_URL="http://osrm:5000")
    def test_unavailable_once_skips_the_client_until_the_flag_expires(self):
        with mock.patch("routing.client.route", side_effect=client.OsrmUnavailable("timed out")) as route, self.assertLogs("routing.service", "INFO"):
            first = service.leg(KUMASI, NEARBY)
            second = service.leg(KUMASI, (6.71, -1.61))
        self.assertEqual(route.call_count, 1)
        self.assertEqual({first["basis"], second["basis"]}, {service.BASIS_ESTIMATE})
        self.assertFalse(cache.get("routing:healthy"))
        self.assertEqual(service.status()["mode"], "straight_line_estimate")
        cache.delete("routing:healthy")  # the TTL running out
        with mock.patch("routing.client.route", return_value={"distance_m": 1000.0, "duration_s": 100.0, "geometry": []}) as route:
            self.assertEqual(service.leg(KUMASI, NEARBY)["basis"], service.BASIS_ROAD)
        self.assertEqual(route.call_count, 1)

    @override_settings(OSRM_URL="http://osrm:5000")
    def test_legs_from_also_skips_the_client_while_down(self):
        with mock.patch("routing.client.table", side_effect=client.OsrmUnavailable("refused")) as table, self.assertLogs("routing.service", "INFO"):
            service.legs_from([KUMASI], NEARBY)
            out = service.legs_from([KUMASI], NEARBY)
        self.assertEqual(table.call_count, 1)
        self.assertEqual(out[0]["basis"], service.BASIS_ESTIMATE)

    @override_settings(OSRM_URL="http://osrm:5000")
    def test_no_route_does_not_trip_the_flag(self):
        with mock.patch("routing.client.route", side_effect=client.OsrmError("NoRoute")) as route, self.assertLogs("routing.service", "INFO"):
            service.leg(KUMASI, NEARBY)
            service.leg(KUMASI, (6.71, -1.61))
        self.assertEqual(route.call_count, 2)
        self.assertIsNone(cache.get("routing:healthy"))


class LegsFromTests(SimpleTestCase):
    def setUp(self):
        cache.clear()

    @override_settings(OSRM_URL="http://osrm:5000")
    def test_unroutable_origin_gets_estimate_and_order_is_kept(self):
        rows = [{"distance_m": 2500.0, "duration_s": 300.0}, None]
        with mock.patch("routing.client.table", return_value=rows):
            out = service.legs_from([KUMASI, (6.71, -1.61)], NEARBY)
        self.assertEqual([o["basis"] for o in out], [service.BASIS_ROAD, service.BASIS_ESTIMATE])
        self.assertEqual(out[0]["distance_km"], 2.5)

    @override_settings(OSRM_URL="http://osrm:5000")
    def test_table_failure_makes_every_origin_an_estimate(self):
        with mock.patch("routing.client.table", side_effect=client.OsrmError("down")), self.assertLogs("routing.service", "INFO") as logs:
            out = service.legs_from([KUMASI, (6.71, -1.61)], NEARBY)
        self.assertEqual({r.levelname for r in logs.records}, {"INFO"})
        self.assertEqual({o["basis"] for o in out}, {service.BASIS_ESTIMATE})
        self.assertEqual(len(out), 2)

    @override_settings(OSRM_URL="http://osrm:5000")
    def test_unexpected_table_error_falls_back_to_estimates(self):
        with mock.patch("routing.client.table", side_effect=KeyError("durations")), self.assertLogs("routing.service", "ERROR"):
            out = service.legs_from([KUMASI, (6.71, -1.61)], NEARBY)
        self.assertEqual({o["basis"] for o in out}, {service.BASIS_ESTIMATE})
        self.assertEqual(len(out), 2)

    def test_no_origins(self):
        self.assertEqual(service.legs_from([], NEARBY), [])


class StatusTests(SimpleTestCase):
    def setUp(self):
        cache.clear()

    @override_settings(OSRM_URL="")
    def test_off(self):
        s = service.status()
        self.assertEqual(s["mode"], "straight_line_estimate")
        self.assertFalse(s["configured"])

    @override_settings(OSRM_URL="http://osrm:5000")
    def test_configured_is_reported_whether_or_not_it_answers(self):
        with mock.patch("routing.client.health", return_value=False):
            self.assertTrue(service.status()["configured"])
        cache.clear()
        with mock.patch("routing.client.health", return_value=True):
            self.assertTrue(service.status()["configured"])

    def test_estimate_label_matches_rates_label(self):
        from delivery import rates

        self.assertEqual(rates.BASIS, service.BASIS_ESTIMATE)

    @override_settings(OSRM_URL="http://osrm:5000")
    def test_road_when_healthy_estimate_when_not(self):
        cache.clear()
        with mock.patch("routing.client.health", return_value=True):
            self.assertEqual(service.status()["mode"], "road")
        cache.clear()
        with mock.patch("routing.client.health", return_value=False):
            s = service.status()
        self.assertEqual(s["mode"], "straight_line_estimate")
        self.assertFalse(s["healthy"])

    @override_settings(OSRM_URL="http://osrm:5000")
    def test_exception_from_health_counts_as_unhealthy(self):
        with mock.patch("routing.client.health", side_effect=RuntimeError("boom")), self.assertLogs("routing.service", "ERROR"):
            s = service.status()
        self.assertEqual(s["mode"], "straight_line_estimate")
        self.assertFalse(s["healthy"])
