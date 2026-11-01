from django.test import TestCase


class OpenApiSchemaTests(TestCase):
    def test_schema_endpoint_returns_openapi_json_with_login_path(self):
        response = self.client.get("/api/schema/?format=json")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertTrue(body["openapi"].startswith("3."))
        self.assertIn("/api/accounts/customers/login/", body["paths"])

    def test_schema_is_cached_for_an_hour(self):
        response = self.client.get("/api/schema/?format=json")
        self.assertIn("max-age=3600", response["Cache-Control"])
