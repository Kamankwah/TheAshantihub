from django.test import override_settings
from rest_framework.test import APITestCase


class HealthCheckTests(APITestCase):
    @override_settings(REDIS_URL="")
    def test_health_check_returns_ok(self):
        response = self.client.get("/api/health/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ok", "redis": "not_configured"})

    @override_settings(REDIS_URL="redis://127.0.0.1:1/0")
    def test_redis_down_is_reported_but_the_api_stays_healthy(self):
        response = self.client.get("/api/health/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ok", "redis": "down"})


class ReadinessCheckTests(APITestCase):
    @override_settings(REDIS_URL="")
    def test_ready_when_the_database_answers(self):
        response = self.client.get("/api/readyz/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ok", "database": "ok", "redis": "not_configured"})

    @override_settings(REDIS_URL="redis://127.0.0.1:1/0")
    def test_redis_down_does_not_make_it_unready(self):
        response = self.client.get("/api/readyz/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["redis"], "down")

    @override_settings(REDIS_URL="")
    def test_database_down_is_503(self):
        from unittest import mock

        with mock.patch("django.db.backends.utils.CursorWrapper.execute", side_effect=Exception("db gone")):
            response = self.client.get("/api/readyz/")
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["database"], "down")
