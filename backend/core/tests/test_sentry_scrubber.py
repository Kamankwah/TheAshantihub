"""What Sentry may see of a failed request (staff phase 2A final review): the
claim and reset forms' secrets are scrubbed wherever they sit in an event."""
from django.test import SimpleTestCase
from sentry_sdk.scrubber import DEFAULT_DENYLIST

from ashantihub.sentry import EXTRA_DENYLIST, event_scrubber


class SentryScrubberTests(SimpleTestCase):
    def test_the_default_denylist_plus_the_claim_secrets(self):
        scrubber = event_scrubber()
        self.assertTrue({key.lower() for key in DEFAULT_DENYLIST} <= set(scrubber.denylist))
        for key in ("password_confirm", "raw", "token", "claim_link"):
            self.assertIn(key, EXTRA_DENYLIST)
            self.assertIn(key, scrubber.denylist)
        self.assertTrue(scrubber.recursive)

    def test_secrets_are_scrubbed_however_deep_they_are(self):
        event = {
            "request": {"data": {
                "password": "Akwaaba-Asafo-2026", "password_confirm": "Akwaaba-Asafo-2026",
                "token": "raw-claim-token", "email": "gifty@example.com",
            }},
            "extra": {"claim": {"raw": "raw-claim-token", "claim_link": "https://example.com/business/claim?token=x"}},
        }
        event_scrubber().scrub_event(event)
        data = event["request"]["data"]
        for key in ("password", "password_confirm", "token"):
            self.assertEqual(shown(data[key]), "[Filtered]", key)
        self.assertEqual(data["email"], "gifty@example.com")
        claim = event["extra"]["claim"]
        self.assertEqual({key: shown(value) for key, value in claim.items()}, {"raw": "[Filtered]", "claim_link": "[Filtered]"})


def shown(value):
    """What Sentry would send: a scrubbed value is an AnnotatedValue."""
    return getattr(value, "value", value)
