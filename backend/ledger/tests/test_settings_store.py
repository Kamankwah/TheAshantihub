from datetime import timedelta

from django.test import SimpleTestCase, TestCase
from django.utils import timezone

from ledger import settings_store as store
from ledger.models import MoneySetting


class DefaultsTests(TestCase):
    def test_defaults_when_nothing_is_set(self):
        self.assertIsNone(store.current("fee_cap_pesewas"))
        self.assertEqual(store.current("pickup_window_hours"), 24)
        self.assertEqual(store.current("verification_overdue_hours"), 72)
        self.assertEqual(store.current("rider_commission_bp"), 1000)

    def test_the_latest_row_in_force_wins_and_a_future_row_waits(self):
        now = timezone.now()
        MoneySetting.objects.create(key="pickup_window_hours", value=48, effective_from=now - timedelta(hours=2))
        MoneySetting.objects.create(key="pickup_window_hours", value=12, effective_from=now - timedelta(hours=1))
        MoneySetting.objects.create(key="pickup_window_hours", value=1, effective_from=now + timedelta(days=1))
        self.assertEqual(store.current("pickup_window_hours", now), 12)

    def test_a_blank_cap_row_means_no_cap(self):
        now = timezone.now()
        MoneySetting.objects.create(key="fee_cap_pesewas", value=100000, effective_from=now - timedelta(hours=2))
        MoneySetting.objects.create(key="fee_cap_pesewas", value=None, effective_from=now - timedelta(hours=1))
        self.assertIsNone(store.current("fee_cap_pesewas", now))

    def test_an_unknown_key_raises(self):
        with self.assertRaises(store.SettingError):
            store.current("nope")


class CleanTests(SimpleTestCase):
    def test_accepts_whole_numbers_in_range(self):
        self.assertEqual(store.clean("pickup_window_hours", "36"), 36)
        self.assertEqual(store.clean("pickup_window_hours", 1), 1)

    def test_blank_is_allowed_only_for_nullable_keys(self):
        self.assertIsNone(store.clean("fee_cap_pesewas", ""))
        self.assertIsNone(store.clean("fee_cap_pesewas", None))
        with self.assertRaises(store.SettingError):
            store.clean("pickup_window_hours", None)

    def test_rejects_out_of_range_and_non_integers(self):
        for key, raw in [("pickup_window_hours", -1), ("pickup_window_hours", 721), ("rider_commission_bp", 10001),
                         ("fee_cap_pesewas", 0), ("pickup_window_hours", "abc"), ("pickup_window_hours", 1.5), ("pickup_window_hours", True)]:
            with self.assertRaises(store.SettingError, msg=f"{key}={raw!r}"):
                store.clean(key, raw)


class WalletRulingsSettingsTests(SimpleTestCase):
    """Plan 7A T1: the numbers the owner left open are governed settings with a default and bounds."""

    KEYS = {
        # key: (default, minimum, maximum)
        "wallet_topup_hold_minutes": (60, 60, 10080),
        "vendor_low_balance_pesewas": (10_000, 0, 10**10),
        "digest_batch_size": (200, 10, 5000),
        "digest_time_budget_seconds": (600, 30, 3600),
        "otp_daily_failure_cap": (20, 5, 200),
        "service_auto_accept_hours": (48, 1, 720),
        "stay_issue_window_hours": (24, 1, 168),
        "event_release_delay_hours": (48, 1, 720),
    }

    def test_defaults_and_bounds(self):
        for key, (default, low, high) in self.KEYS.items():
            with self.subTest(key=key):
                self.assertEqual(store.DEFINITIONS[key].default, default)
                self.assertEqual(store.clean(key, str(low)), low)
                self.assertEqual(store.clean(key, high), high)
                with self.assertRaises(store.SettingError):
                    store.clean(key, low - 1)
                with self.assertRaises(store.SettingError):
                    store.clean(key, high + 1)

    def test_topup_hold_cannot_go_below_sixty_minutes(self):
        with self.assertRaises(store.SettingError):
            store.clean("wallet_topup_hold_minutes", 59)

    def test_the_overdue_label_now_says_products_only(self):
        self.assertIn("product", store.DEFINITIONS["verification_overdue_hours"].label.lower())
        self.assertNotIn("hand-over", store.DEFINITIONS["verification_overdue_hours"].label)
