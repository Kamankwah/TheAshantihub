from django.test import SimpleTestCase, override_settings

from core.checks import check_open_dev_defaults

PROD = dict(DEBUG=False, TESTING=False)


class OpenDevDefaultsCheckTests(SimpleTestCase):
    def ids(self):
        return sorted(e.id for e in check_open_dev_defaults(None))

    @override_settings(**PROD, ALLOWED_HOSTS=["*"], CORS_ALLOW_ALL_ORIGINS=True, CORS_ALLOWED_ORIGINS=[])
    def test_wildcard_host_and_open_cors_are_errors_in_production(self):
        self.assertEqual(self.ids(), ["core.E001", "core.E002"])

    @override_settings(**PROD, ALLOWED_HOSTS=["api.example.com"], CORS_ALLOW_ALL_ORIGINS=False, CORS_ALLOWED_ORIGINS=[])
    def test_closed_cors_with_no_origins_is_an_error(self):
        self.assertEqual(self.ids(), ["core.E003"])

    @override_settings(**PROD, ALLOWED_HOSTS=["api.example.com"], CORS_ALLOW_ALL_ORIGINS=False, CORS_ALLOWED_ORIGINS=["https://example.com"])
    def test_a_closed_configuration_passes(self):
        self.assertEqual(self.ids(), [])

    @override_settings(DEBUG=True, TESTING=False, ALLOWED_HOSTS=["*"], CORS_ALLOW_ALL_ORIGINS=True)
    def test_debug_keeps_the_dev_defaults(self):
        self.assertEqual(self.ids(), [])
