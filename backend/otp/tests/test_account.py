"""The account security overview, removing trusted devices and the nightly clean-up (otp plan Task 10)."""
import hashlib
from datetime import timedelta
from unittest.mock import patch

from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.testing import staff_token
from otp import devices
from otp.models import SMS, OtpChallenge, OtpEvent, StepUpToken, TrustedDevice, VerifiedContact
from otp.tasks import purge_old_otp_rows

from .helpers import make_customer, make_support


class AccountBase(TestCase):
    def setUp(self):
        cache.clear()
        self.customer = make_customer()
        self.client = APIClient()
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.customer, 'customer')}")

    def other_customer(self):
        return make_customer(phone="+233249999999", email="yaw@example.com")


class OverviewTests(AccountBase):
    def test_it_shows_the_ways_a_code_can_come_and_which_are_verified(self):
        VerifiedContact.objects.create(account_type="customer", account_id=self.customer.pk, channel=SMS, destination="+233241234567")
        body = self.client.get("/api/otp/me/").json()
        self.assertEqual(body["channels"], [
            {"channel": "sms", "hint": "024 *** 4567", "verified": True},
            {"channel": "email", "hint": "am•••@example.com", "verified": False},
        ])
        self.assertEqual(body["authenticator"], {"enabled": False, "enabled_at": None, "recovery_codes_left": 0})
        self.assertEqual(body["switches"], {"sign_in": False, "step_up": False, "sign_up": False})
        self.assertEqual(body["customer_gap_days"], 30)

    def test_it_lists_only_live_devices_of_this_account(self):
        devices.trust(self.customer, None)
        old = devices.trust(self.customer, None)
        TrustedDevice.objects.filter(token_hash=hashlib.sha256(old.encode()).hexdigest()).update(verified_at=timezone.now() - timedelta(days=31))
        devices.trust(self.other_customer(), None)
        rows = self.client.get("/api/otp/me/").json()["trusted_devices"]
        self.assertEqual(len(rows), 1)
        self.assertEqual(set(rows[0]), {"id", "label", "trusted_since", "last_code_at", "last_seen_at"})

    def test_staff_see_no_customer_authenticator(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(make_support())}")
        body = self.client.get("/api/otp/me/").json()
        self.assertIsNone(body["authenticator"])
        self.assertEqual(body["channels"], [{"channel": "email", "hint": "es•••@example.com", "verified": False}])

    def test_signed_out_is_401(self):
        self.assertEqual(APIClient().get("/api/otp/me/").status_code, 401)


class RemoveDeviceTests(AccountBase):
    def test_removing_one_of_your_own(self):
        devices.trust(self.customer, None)
        device = TrustedDevice.objects.get()
        self.assertEqual(self.client.post(f"/api/otp/devices/{device.pk}/remove/").status_code, 204)
        device.refresh_from_db()
        self.assertEqual(device.revoked_reason, TrustedDevice.REMOVED)
        self.assertTrue(OtpEvent.objects.filter(kind=OtpEvent.DEVICE_REVOKED).exists())

    def test_someone_elses_is_not_found(self):
        devices.trust(self.other_customer(), None)
        device = TrustedDevice.objects.get()
        self.assertEqual(self.client.post(f"/api/otp/devices/{device.pk}/remove/").status_code, 404)
        device.refresh_from_db()
        self.assertIsNone(device.revoked_at)

    def test_removing_all(self):
        devices.trust(self.customer, None)
        devices.trust(self.customer, None)
        self.assertEqual(self.client.post("/api/otp/devices/remove-all/").json(), {"removed": 2})
        self.assertEqual(devices.live(self.customer), [])


class RetentionTests(TestCase):
    def test_spent_rows_go_and_recent_ones_stay(self):
        now = timezone.now()
        long_ago = now - timedelta(days=2)
        challenge = {"account_type": "customer", "account_id": 1, "purpose": "sign_in", "channel": "sms",
                     "destination": "+233241234567", "salt": "s", "code_hash": "h"}
        OtpChallenge.objects.create(created_at=long_ago, last_sent_at=long_ago, expires_at=long_ago, **challenge)
        OtpChallenge.objects.create(created_at=now, last_sent_at=now, expires_at=now + timedelta(minutes=5), **challenge)
        token = {"account_type": "customer", "account_id": 1, "action": "payout_destination", "jti": "j"}
        StepUpToken.objects.create(token_hash="a" * 64, created_at=long_ago, expires_at=long_ago, **token)
        StepUpToken.objects.create(token_hash="b" * 64, created_at=now, expires_at=now + timedelta(minutes=5), **token)
        OtpEvent.objects.create(kind=OtpEvent.SENT, at=now - timedelta(days=401))
        OtpEvent.objects.create(kind=OtpEvent.SENT, at=now - timedelta(days=399))
        device = {"account_type": "customer", "account_id": 1, "password_fingerprint": "f"}
        TrustedDevice.objects.create(token_hash="c" * 64, revoked_at=now - timedelta(days=91), **device)
        TrustedDevice.objects.create(token_hash="d" * 64, revoked_at=now - timedelta(days=10), **device)
        TrustedDevice.objects.create(token_hash="e" * 64, **device)
        self.assertEqual(purge_old_otp_rows(), {"challenges": 1, "step_up_tokens": 1, "devices": 1, "events": 1})
        self.assertEqual((OtpChallenge.objects.count(), StepUpToken.objects.count(), OtpEvent.objects.count(), TrustedDevice.objects.count()), (1, 1, 1, 2))

    def test_expired_devices_go_and_live_ones_are_capped_per_account(self):
        now = timezone.now()
        device = {"account_type": "customer", "account_id": 1, "password_fingerprint": "f"}
        TrustedDevice.objects.create(token_hash="x" * 64, verified_at=now - timedelta(days=100), **device)
        for i in range(12):
            TrustedDevice.objects.create(token_hash=f"{i:064d}", last_seen_at=now - timedelta(minutes=i), **device)
        TrustedDevice.objects.create(token_hash="y" * 64, **{**device, "account_id": 2})
        self.assertEqual(purge_old_otp_rows()["devices"], 3)
        mine = TrustedDevice.objects.filter(account_id=1)
        self.assertEqual(mine.count(), 10)
        self.assertFalse(mine.filter(token_hash=f"{11:064d}").exists())
        self.assertEqual(TrustedDevice.objects.filter(account_id=2).count(), 1)

    def _device(self, key, days_ago, now, **extra):
        extra.setdefault("token_hash", key * 64)
        return TrustedDevice.objects.create(
            account_type="customer", account_id=1, password_fingerprint="f",
            verified_at=now - timedelta(days=days_ago), **extra,
        )

    def _survivors(self, gap, *ages):
        now = timezone.now()
        for i, age in enumerate(ages):
            self._device(str(i), age, now)
        with patch("staffsecurity.policy.otp_customer_gap_days", return_value=gap):
            purge_old_otp_rows()
        return sorted(TrustedDevice.objects.values_list("token_hash", flat=True))

    def test_stale_means_older_than_the_configured_gap(self):
        self.assertEqual(self._survivors(180, 100, 181), ["0" * 64])
        TrustedDevice.objects.all().delete()
        self.assertEqual(self._survivors(30, 31, 29), ["1" * 64])

    def test_a_device_exactly_at_the_gap_survives(self):
        now = timezone.now()
        self._device("a", 30, now)
        with patch("staffsecurity.policy.otp_customer_gap_days", return_value=30), patch("otp.retention.timezone.now", return_value=now):
            purge_old_otp_rows()
        self.assertEqual(TrustedDevice.objects.count(), 1)

    def test_the_cap_keeps_the_ten_most_recently_seen_and_ignores_revoked(self):
        now = timezone.now()
        for i in range(12):
            self._device(f"{i:x}", 1, now, last_seen_at=now - timedelta(minutes=i), token_hash=f"{i:064d}")
        for i in range(3):
            self._device("r", 1, now, token_hash=f"{100 + i:064d}", revoked_at=now, last_seen_at=now)
        purge_old_otp_rows()
        live = TrustedDevice.objects.filter(revoked_at__isnull=True)
        self.assertEqual(sorted(live.values_list("token_hash", flat=True)), [f"{i:064d}" for i in range(10)])
        self.assertEqual(TrustedDevice.objects.filter(revoked_at__isnull=False).count(), 3)

    def test_it_is_a_scheduled_job(self):
        from core.jobs import scheduled_task_names

        self.assertIn("otp.tasks.purge_old_otp_rows", scheduled_task_names())
