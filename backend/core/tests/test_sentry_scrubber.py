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


class RedactClaimTokenTests(SimpleTestCase):
    def test_a_token_in_the_url_and_query_string_is_filtered(self):
        from ashantihub.sentry import redact_claim_token

        event = {"request": {
            "url": "https://api.example.com/api/accounts/claim/?token=abc123&x=1",
            "query_string": "token=abc123&x=1",
        }}
        out = redact_claim_token(event, {})
        self.assertEqual(out["request"]["url"], "https://api.example.com/api/accounts/claim/?token=[Filtered]&x=1")
        self.assertEqual(out["request"]["query_string"], "token=[Filtered]&x=1")

    def test_list_and_dict_query_strings_and_missing_keys(self):
        from ashantihub.sentry import redact_claim_token

        out = redact_claim_token({"request": {"query_string": [["token", "abc"], ["x", "1"]]}}, {})
        self.assertEqual(out["request"]["query_string"], [["token", "[Filtered]"], ["x", "1"]])
        out = redact_claim_token({"request": {"query_string": {"token": "abc", "x": "1"}}}, {})
        self.assertEqual(out["request"]["query_string"], {"token": "[Filtered]", "x": "1"})
        self.assertEqual(redact_claim_token({}, {}), {})
        self.assertEqual(redact_claim_token({"request": {}}, {}), {"request": {}})
        self.assertEqual(redact_claim_token({"request": {"url": "https://a/b", "query_string": ""}}, {})["request"],
                         {"url": "https://a/b", "query_string": ""})


class RedactFrameVarsTests(SimpleTestCase):
    def test_a_token_in_stack_frame_variables_is_filtered(self):
        from ashantihub.sentry import redact_claim_token

        repr_ = "<Request: GET '/api/accounts/business-owners/claim/?token=abc123'>"
        frame = {"vars": {
            "request": repr_, "n": 3,
            "nested": {"urls": ["/claim/?token=abc123&x=1", {"deep": "?token=zzz"}]},
        }}
        event = {
            "exception": {"values": [{"stacktrace": {"frames": [frame]}}, {"stacktrace": None}, {}]},
            "threads": {"values": [{"stacktrace": {"frames": [{"vars": {"u": "/c/?token=abc123"}}, {}]}}]},
        }
        for hook in (redact_claim_token,):
            out = hook(event, {})
        vars_ = out["exception"]["values"][0]["stacktrace"]["frames"][0]["vars"]
        self.assertEqual(vars_["request"], "<Request: GET '/api/accounts/business-owners/claim/?token=[Filtered]'>")
        self.assertEqual(vars_["n"], 3)
        self.assertEqual(vars_["nested"]["urls"][0], "/claim/?token=[Filtered]&x=1")
        self.assertEqual(vars_["nested"]["urls"][1], {"deep": "?token=[Filtered]"})
        self.assertEqual(out["threads"]["values"][0]["stacktrace"]["frames"][0]["vars"]["u"], "/c/?token=[Filtered]")

    def test_it_never_raises(self):
        from ashantihub.sentry import redact_claim_token

        for event in ({"exception": "x"}, {"exception": {"values": None}}, {"threads": {"values": [1, None]}},
                      {"exception": {"values": [{"stacktrace": {"frames": [{"vars": 5}, 7]}}]}}):
            redact_claim_token(event, {})
