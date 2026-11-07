import re
from pathlib import Path

from django.conf import settings
from django.test import SimpleTestCase, TestCase

from accounts import business_terms

WEB_COPY = Path(settings.BASE_DIR).parent / "frontend" / "components" / "businessTerms.js"


class BusinessTermsEndpointTests(TestCase):
    def test_public_endpoint_serves_the_version_the_server_records(self):
        response = self.client.get("/api/accounts/business-terms/")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["version"], settings.OWNER_TERMS_VERSION)
        self.assertTrue(body["text"].startswith("AshantiHub Business Agreement"))
        self.assertIn("Listing Accuracy", body["text"])


class WebCopyStaysInStepTests(SimpleTestCase):
    """The web app still ships the text in its bundle; it must never drift from what the API serves and records."""

    def test_web_copy_matches_the_served_text_and_version(self):
        if not WEB_COPY.exists():
            self.skipTest("frontend/ is not mounted in this environment")
        source = WEB_COPY.read_text()
        version = re.search(r'BUSINESS_TERMS_VERSION = "([^"]+)"', source).group(1)
        copy = re.search(r"BUSINESS_TERMS_COPY = `(.*?)`", source, re.S).group(1)
        self.assertEqual(version, settings.OWNER_TERMS_VERSION)
        self.assertEqual(copy, business_terms.TEXT)
