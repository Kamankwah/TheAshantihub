from datetime import timedelta

from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APITestCase

from ledger.models import MoneySetting


class BookingTermsTests(APITestCase):
    URL = "/api/ledger/booking-terms/"

    @override_settings(LEDGER_ENABLED=True)
    def test_enabled_flag_is_true_with_the_ledger_on(self):
        self.assertTrue(self.client.get(self.URL).json()["enabled"])

    @override_settings(LEDGER_ENABLED=False)
    def test_ledger_off_makes_no_promises(self):
        data = self.client.get(self.URL).json()
        self.assertEqual(set(data), {"enabled", "policies"})
        self.assertFalse(data["enabled"])
        self.assertEqual(data["policies"]["strict"]["tiers"], [[168, 5000]])  # a vendor can still choose a policy

    @override_settings(LEDGER_ENABLED=True)
    def test_public_and_carries_the_governed_hours_and_the_policies(self):
        response = self.client.get(self.URL)
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["service_auto_accept_hours"], 48)
        self.assertEqual(data["stay_issue_window_hours"], 24)
        self.assertEqual(data["event_release_delay_hours"], 48)
        self.assertEqual(data["stay_check_in_time"], "14:00")
        self.assertEqual(data["policies"]["flexible"]["tiers"], [[24, 10000]])
        self.assertEqual(data["policies"]["strict"]["text"], "Half refunded until 7 days before the start, nothing after.")
        self.assertNotIn("none", data["policies"])

    @override_settings(LEDGER_ENABLED=True)
    def test_follows_a_changed_setting(self):
        MoneySetting.objects.create(key="stay_issue_window_hours", value=36, effective_from=timezone.now() - timedelta(hours=1))
        self.assertEqual(self.client.get(self.URL).json()["stay_issue_window_hours"], 36)
