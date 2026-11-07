from django.test import SimpleTestCase, TestCase, override_settings

from core.app_version import is_too_old, parse_version

MOBILE = {"HTTP_X_CLIENT": "mobile"}


class VersionParsingTests(SimpleTestCase):
    def test_reads_common_shapes(self):
        self.assertEqual(parse_version("1.2.3"), (1, 2, 3))
        self.assertEqual(parse_version("1.2"), (1, 2, 0))
        self.assertEqual(parse_version("v2"), (2, 0, 0))
        self.assertEqual(parse_version("1.4.0-rc1"), (1, 4, 0))
        self.assertIsNone(parse_version("beta"))
        self.assertIsNone(parse_version(""))

    def test_compares_numerically_not_as_text(self):
        self.assertTrue(is_too_old("1.9.0", "1.10.0"))
        self.assertFalse(is_too_old("1.10.0", "1.9.0"))
        self.assertFalse(is_too_old("1.2.3", "1.2.3"))

    def test_missing_or_unreadable_version_counts_as_oldest(self):
        self.assertTrue(is_too_old("", "1.0.0"))
        self.assertTrue(is_too_old("junk", "1.0.0"))

    def test_blank_or_bad_minimum_never_blocks(self):
        self.assertFalse(is_too_old("0.0.1", ""))
        self.assertFalse(is_too_old("0.0.1", "soon"))


@override_settings(MOBILE_MIN_VERSION="1.2.0", MOBILE_STORE_URL="https://play.google.com/store/apps/details?id=com.ashantihub.app")
class MobileMinVersionGateTests(TestCase):
    def test_old_mobile_build_gets_426_with_the_minimum_and_store_link(self):
        response = self.client.get("/api/listings/", **MOBILE, HTTP_X_APP_VERSION="1.1.9")
        self.assertEqual(response.status_code, 426)
        body = response.json()
        self.assertEqual(body["code"], "upgrade_required")
        self.assertEqual(body["min_supported_version"], "1.2.0")
        self.assertIn("play.google.com", body["store_url"])

    def test_build_without_a_version_header_is_refused_once_a_minimum_is_set(self):
        self.assertEqual(self.client.get("/api/listings/", **MOBILE).status_code, 426)

    def test_current_build_passes_through(self):
        self.assertNotEqual(self.client.get("/api/listings/", **MOBILE, HTTP_X_APP_VERSION="1.2.0").status_code, 426)
        self.assertNotEqual(self.client.get("/api/listings/", **MOBILE, HTTP_X_APP_VERSION="2.0.0").status_code, 426)

    def test_web_and_headerless_clients_are_never_gated(self):
        self.assertNotEqual(self.client.get("/api/listings/").status_code, 426)
        self.assertNotEqual(self.client.get("/api/listings/", HTTP_X_CLIENT="web").status_code, 426)

    def test_health_check_stays_reachable_for_an_old_build(self):
        self.assertNotEqual(self.client.get("/api/core/health/", **MOBILE, HTTP_X_APP_VERSION="0.1.0").status_code, 426)

    @override_settings(MOBILE_MIN_VERSION="")
    def test_gate_is_off_by_default(self):
        self.assertNotEqual(self.client.get("/api/listings/", **MOBILE, HTTP_X_APP_VERSION="0.0.1").status_code, 426)
