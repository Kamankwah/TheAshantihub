from unittest import mock

from django.test import SimpleTestCase, override_settings

from routing import client


@override_settings(OSRM_URL="http://osrm:5000", OSRM_TIMEOUT_S=2.0)
class RouteTests(SimpleTestCase):
    def test_route_converts_lat_lng_to_lng_lat_and_parses(self):
        body = {"code": "Ok", "routes": [{"distance": 5321.4, "duration": 612.0, "geometry": {"coordinates": [[-1.62, 6.69], [-1.60, 6.70]]}}]}
        with mock.patch("routing.client._http_get_json", return_value=body) as get:
            out = client.route((6.69, -1.62), (6.70, -1.60))
        url = get.call_args[0][0]
        self.assertIn("/route/v1/driving/-1.62,6.69;-1.6,6.7", url)
        self.assertIn("overview=full", url)
        self.assertEqual(out["distance_m"], 5321.4)
        self.assertEqual(out["duration_s"], 612.0)
        self.assertEqual(out["geometry"], [[-1.62, 6.69], [-1.60, 6.70]])

    def test_no_route_raises(self):
        with mock.patch("routing.client._http_get_json", return_value={"code": "NoRoute", "message": "x"}):
            with self.assertRaises(client.OsrmError):
                client.route((6.69, -1.62), (6.70, -1.60))

    def test_network_failure_raises_osrm_error(self):
        with mock.patch("routing.client._http_get_json", side_effect=OSError("boom")):
            with self.assertRaises(client.OsrmError):
                client.route((6.69, -1.62), (6.70, -1.60))

    @override_settings(OSRM_URL="")
    def test_blank_url_raises_without_calling_network(self):
        with mock.patch("routing.client._http_get_json") as get:
            with self.assertRaises(client.OsrmError):
                client.route((6.69, -1.62), (6.70, -1.60))
        get.assert_not_called()


@override_settings(OSRM_URL="http://osrm:5000", OSRM_TIMEOUT_S=2.0)
class TableTests(SimpleTestCase):
    def test_table_returns_one_result_per_origin_and_none_for_unroutable(self):
        body = {"code": "Ok", "durations": [[300.0], [None], [90.0]], "distances": [[2500.0], [None], [700.0]]}
        origins = [(6.69, -1.62), (6.70, -1.61), (6.71, -1.60)]
        with mock.patch("routing.client._http_get_json", return_value=body) as get:
            out = client.table(origins, (6.72, -1.59))
        url = get.call_args[0][0]
        self.assertIn("/table/v1/driving/-1.62,6.69;-1.61,6.7;-1.6,6.71;-1.59,6.72", url)
        self.assertIn("sources=0;1;2", url)
        self.assertIn("destinations=3", url)
        self.assertEqual(out, [{"distance_m": 2500.0, "duration_s": 300.0}, None, {"distance_m": 700.0, "duration_s": 90.0}])

    def test_table_with_no_origins_makes_no_call(self):
        with mock.patch("routing.client._http_get_json") as get:
            self.assertEqual(client.table([], (6.72, -1.59)), [])
        get.assert_not_called()


@override_settings(OSRM_URL="http://osrm:5000")
class HealthTests(SimpleTestCase):
    def test_health_true_when_nearest_answers_ok(self):
        with mock.patch("routing.client._http_get_json", return_value={"code": "Ok"}):
            self.assertTrue(client.health())

    def test_health_false_on_error(self):
        with mock.patch("routing.client._http_get_json", side_effect=OSError("down")):
            self.assertFalse(client.health())

    @override_settings(OSRM_URL="")
    def test_health_false_when_unconfigured(self):
        self.assertFalse(client.health())
