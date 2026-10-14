"""routing.client.table_between and routing.service.legs_between: many origins to many destinations in one OSRM call
(the cart guard's near-shop map)."""
from unittest import mock

from django.core.cache import cache
from django.test import SimpleTestCase, override_settings

from delivery import services as delivery_services
from routing import client, service

A, B, C = (6.69, -1.62), (6.70, -1.61), (6.71, -1.60)
X, Y = (6.72, -1.59), (6.73, -1.58)


@override_settings(OSRM_URL="http://osrm:5000", OSRM_TIMEOUT_S=2.0)
class ClientTableBetweenTests(SimpleTestCase):
    def test_sources_then_destinations_in_one_call(self):
        body = {"code": "Ok", "durations": [[60.0, 70.0], [None, 80.0]], "distances": [[1000.0, 1100.0], [None, 1200.0]]}
        with mock.patch("routing.client._http_get_json", return_value=body) as get:
            out = client.table_between([A, B], [X, Y])
        get.assert_called_once()
        url = get.call_args[0][0]
        self.assertIn("/table/v1/driving/-1.62,6.69;-1.61,6.7;-1.59,6.72;-1.58,6.73?", url)
        self.assertIn("sources=0;1", url)
        self.assertIn("destinations=2;3", url)
        self.assertEqual(out, [
            [{"distance_m": 1000.0, "duration_s": 60.0}, {"distance_m": 1100.0, "duration_s": 70.0}],
            [None, {"distance_m": 1200.0, "duration_s": 80.0}],
        ])

    def test_nothing_to_measure_makes_no_call(self):
        with mock.patch("routing.client._http_get_json") as get:
            self.assertEqual(client.table_between([], [X]), [])
            self.assertEqual(client.table_between([A], []), [[]])
        get.assert_not_called()

    def test_a_malformed_answer_is_an_error(self):
        with mock.patch("routing.client._http_get_json", return_value={"code": "Ok", "durations": "x", "distances": []}):
            with self.assertRaises(client.OsrmError):
                client.table_between([A], [X])


class ServiceLegsBetweenTests(SimpleTestCase):
    def setUp(self):
        cache.clear()

    def estimate(self, a, b):
        return delivery_services.distance_estimate_km(a[0], a[1], b[0], b[1])

    @override_settings(OSRM_URL="http://osrm:5000")
    def test_road_cells_and_an_unroutable_cell_estimated_on_its_own(self):
        rows = [[{"distance_m": 2500.0, "duration_s": 300.0}, None]]
        with mock.patch("routing.client.table_between", return_value=rows):
            out = service.legs_between([A], [X, Y])
        self.assertEqual(out[0][0], {"distance_km": 2.5, "duration_s": 300, "basis": service.BASIS_ROAD, "geometry": None})
        self.assertEqual((out[0][1]["distance_km"], out[0][1]["basis"]), (self.estimate(A, Y), service.BASIS_ESTIMATE))

    @override_settings(OSRM_URL="")
    def test_unconfigured_gives_labelled_estimates_without_a_call(self):
        with mock.patch("routing.client.table_between") as call:
            out = service.legs_between([A, B], [X])
        call.assert_not_called()
        self.assertEqual([[c["basis"] for c in row] for row in out], [[service.BASIS_ESTIMATE], [service.BASIS_ESTIMATE]])
        self.assertEqual(out[1][0]["distance_km"], self.estimate(B, X))

    @override_settings(OSRM_URL="http://osrm:5000")
    def test_osrm_down_is_remembered_and_estimated(self):
        with mock.patch("routing.client.table_between", side_effect=client.OsrmUnavailable("timed out")), self.assertLogs("routing.service", "INFO"):
            out = service.legs_between([A], [X])
        self.assertEqual(out[0][0]["basis"], service.BASIS_ESTIMATE)
        self.assertIs(cache.get(service.HEALTH_KEY), False)
        with mock.patch("routing.client.table_between") as call:
            service.legs_between([A], [X])
        call.assert_not_called()

    @override_settings(OSRM_URL="http://osrm:5000")
    def test_a_refused_table_is_estimated_but_osrm_is_not_marked_down(self):
        with mock.patch("routing.client.table_between", side_effect=client.OsrmError("TooBig")), self.assertLogs("routing.service", "INFO"):
            out = service.legs_between([A], [X])
        self.assertEqual(out[0][0]["basis"], service.BASIS_ESTIMATE)
        self.assertIsNone(cache.get(service.HEALTH_KEY))

    @override_settings(OSRM_URL="http://osrm:5000")
    def test_origins_beyond_the_table_limit_are_estimated_in_the_same_single_call(self):
        road = {"distance_m": 1000.0, "duration_s": 100.0}
        with mock.patch.object(service, "TABLE_MAX_ORIGINS", 2), \
                mock.patch("routing.client.table_between", side_effect=lambda o, d: [[road] * len(d) for _ in o]) as call:
            out = service.legs_between([A, B, C], [X])
        call.assert_called_once()
        self.assertEqual(call.call_args[0][0], [A, B])
        self.assertEqual([row[0]["basis"] for row in out], [service.BASIS_ROAD, service.BASIS_ROAD, service.BASIS_ESTIMATE])

    def test_no_origins_or_no_destinations(self):
        self.assertEqual(service.legs_between([], [X]), [])
        self.assertEqual(service.legs_between([A], []), [[]])
