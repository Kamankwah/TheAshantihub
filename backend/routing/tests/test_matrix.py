from unittest import mock

from django.core.cache import cache
from django.test import SimpleTestCase, override_settings

from delivery import services as delivery_services
from routing import client, service

A, B = (6.69, -1.62), (6.70, -1.60)


@override_settings(OSRM_URL="http://osrm:5000", OSRM_TIMEOUT_S=2.0)
class ClientMatrixTests(SimpleTestCase):
    def test_every_pair_in_one_call(self):
        body = {"code": "Ok", "durations": [[0, 60], [70, 0]], "distances": [[0, 1000], [1100, 0]]}
        with mock.patch("routing.client._http_get_json", return_value=body) as get:
            out = client.matrix([A, B])
        url = get.call_args[0][0]
        self.assertIn("/table/v1/driving/-1.62,6.69;-1.6,6.7?annotations=duration,distance", url)
        self.assertNotIn("sources=", url)
        self.assertEqual(out[0][1], {"distance_m": 1000.0, "duration_s": 60.0})
        self.assertEqual(out[1][0], {"distance_m": 1100.0, "duration_s": 70.0})

    def test_an_unroutable_pair_is_none(self):
        body = {"code": "Ok", "durations": [[0, None], [70, 0]], "distances": [[0, None], [1100, 0]]}
        with mock.patch("routing.client._http_get_json", return_value=body):
            self.assertIsNone(client.matrix([A, B])[0][1])

    def test_a_malformed_answer_is_an_error(self):
        with mock.patch("routing.client._http_get_json", return_value={"code": "Ok", "durations": "x", "distances": []}):
            with self.assertRaises(client.OsrmError):
                client.matrix([A, B])


class ServiceMatrixTests(SimpleTestCase):
    def setUp(self):
        cache.clear()

    @override_settings(OSRM_URL="http://osrm:5000")
    def test_road_table_in_km(self):
        rows = [[{"distance_m": 0.0, "duration_s": 0.0}, {"distance_m": 2500.0, "duration_s": 300.0}],
                [{"distance_m": 2600.0, "duration_s": 310.0}, {"distance_m": 0.0, "duration_s": 0.0}]]
        with mock.patch("routing.client.matrix", return_value=rows):
            self.assertEqual(service.matrix([A, B]), {"km": [[0.0, 2.5], [2.6, 0.0]], "basis": service.BASIS_ROAD})

    @override_settings(OSRM_URL="")
    def test_unconfigured_gives_the_labelled_estimate(self):
        with mock.patch("routing.client.matrix") as call:
            out = service.matrix([A, B])
        call.assert_not_called()
        self.assertEqual(out["basis"], service.BASIS_ESTIMATE)
        self.assertEqual(out["km"][0][1], delivery_services.distance_estimate_km(A[0], A[1], B[0], B[1]))
        self.assertEqual(out["km"][1][1], 0.0)

    @override_settings(OSRM_URL="http://osrm:5000")
    def test_one_missing_pair_is_estimated_and_labels_the_table(self):
        rows = [[{"distance_m": 0.0, "duration_s": 0.0}, None], [{"distance_m": 2600.0, "duration_s": 310.0}, {"distance_m": 0.0, "duration_s": 0.0}]]
        with mock.patch("routing.client.matrix", return_value=rows):
            out = service.matrix([A, B])
        self.assertEqual(out["basis"], service.BASIS_ESTIMATE)
        self.assertEqual(out["km"][1][0], 2.6)
        self.assertEqual(out["km"][0][1], delivery_services.distance_estimate_km(A[0], A[1], B[0], B[1]))

    @override_settings(OSRM_URL="http://osrm:5000")
    def test_osrm_down_is_remembered_and_estimated(self):
        with mock.patch("routing.client.matrix", side_effect=client.OsrmUnavailable("timed out")), self.assertLogs("routing.service", "INFO"):
            out = service.matrix([A, B])
        self.assertEqual(out["basis"], service.BASIS_ESTIMATE)
        self.assertIs(cache.get(service.HEALTH_KEY), False)
