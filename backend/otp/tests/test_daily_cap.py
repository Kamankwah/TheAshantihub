"""The daily wrong-code cap (Plan 7C Task 6, owner ruling 2026-10-18): on top of the sliding 15-minute lock, an account
whose wrong codes since Accra midnight reach ledger.settings_store "otp_daily_failure_cap" (default 20) stays locked
until the next Accra day, even with the right password and the right code. A staff recovery restarts the count.
Times are passed in explicitly; Africa/Accra is UTC all year, so one test moves TIME_ZONE to tell the two apart."""
import time
from datetime import datetime, timedelta
from unittest import mock
from zoneinfo import ZoneInfo

import pyotp
from django.core import mail
from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.two_factor import encrypt_secret
from ledger.models import MoneySetting
from otp import audit, notices, senders, service
from otp.models import AUTHENTICATOR, RECOVERY, SIGN_IN, SMS, AccountAuthenticator, OtpEvent
from otp.service import OtpError

from .helpers import PASSWORD, last_sms_code, make_customer, make_owner, wrong_code

ACCRA = ZoneInfo("Africa/Accra")
DAY = datetime(2026, 10, 19, 0, 0, tzinfo=ACCRA)  # an Accra midnight
GAP = timedelta(minutes=20)  # longer than the 15-minute window, so the sliding lock never engages


def notice_rows(note):
    return OtpEvent.objects.filter(kind__in=service.SEND_KINDS, note=note)


class DailyCapTests(TestCase):
    def setUp(self):
        cache.clear()
        senders.sms_outbox.clear()
        mail.outbox = []
        self.customer = make_customer()

    def fail(self, count, start):
        """`count` wrong codes from `start`, GAP apart (never 5 inside 15 minutes). Returns the time of the last."""
        at = start
        for i in range(count):
            at = start + i * GAP
            with service.guessing(self.customer):
                service.note_failure(self.customer, purpose=SIGN_IN, channel=SMS, now=at)
        return at

    def test_twenty_spread_out_wrong_codes_lock_but_nineteen_do_not(self):
        last = self.fail(19, DAY + timedelta(hours=1))
        self.assertEqual(service.daily_failures(self.customer, last), 19)
        self.assertEqual(service.failures(self.customer, last), 1)
        self.assertFalse(service.is_locked(self.customer, last + timedelta(minutes=1)))

    def test_locked_after_cap_even_after_window(self):
        last = self.fail(19, DAY + timedelta(hours=1))
        send_at = last + timedelta(minutes=1)
        service.send(self.customer, SIGN_IN, SMS, ticket="t", now=send_at)
        right = last_sms_code()
        with self.assertRaises(OtpError) as wrong:  # the 20th wrong code today reaches the cap
            service.verify(self.customer, SIGN_IN, wrong_code(right), ticket="t", now=send_at + timedelta(seconds=10))
        self.assertEqual(wrong.exception.code, "wrong_code")
        self.assertEqual(service.daily_failures(self.customer, send_at), 20)
        self.assertEqual(OtpEvent.objects.filter(kind=OtpEvent.LOCKED).count(), 1)
        self.assertEqual(notice_rows(notices.DAILY_LOCKED_NOTE).count(), 2)  # one text and one email, once
        # The right code is refused now ...
        with self.assertRaises(OtpError) as refused:
            service.verify(self.customer, SIGN_IN, right, ticket="t", now=send_at + timedelta(seconds=20))
        self.assertEqual(refused.exception.code, "try_later")
        # ... and long after the 15-minute window has emptied, for sending and checking alike.
        later = send_at + timedelta(hours=2)
        self.assertEqual(service.failures(self.customer, later), 0)
        self.assertTrue(service.is_locked(self.customer, later))
        with self.assertRaises(OtpError) as send_refused:
            service.send(self.customer, SIGN_IN, SMS, ticket="t2", now=later)
        self.assertEqual(send_refused.exception.code, "try_later")
        self.assertTrue(service.is_locked(self.customer, DAY + timedelta(hours=23, minutes=59)))
        # Later attempts neither add wrong codes nor repeat the notice.
        self.assertEqual(service.daily_failures(self.customer, later), 20)
        self.assertEqual(notice_rows(notices.DAILY_LOCKED_NOTE).count(), 2)

    def test_the_daily_notice_goes_even_within_an_hour_of_a_window_lock_notice(self):
        MoneySetting.objects.create(key="otp_daily_failure_cap", value=8, effective_from=DAY - timedelta(days=1))
        start = DAY + timedelta(hours=1)
        outcomes = []

        def wrong(at):
            with service.guessing(self.customer):
                locked = service.note_failure(self.customer, purpose=SIGN_IN, channel=SMS, now=at)
            if locked:  # what the callers do once the guess has committed
                notices.account_locked(self.customer, purpose=SIGN_IN, now=at, until_tomorrow=locked == service.DAILY_LOCK)
            outcomes.append(locked)

        for i in range(5):  # five in a row: the 15-minute lock and its notice
            wrong(start + timedelta(seconds=i))
        for i in range(3):  # three more once the window has emptied: the daily cap of 8
            wrong(start + timedelta(minutes=16, seconds=i))
        self.assertEqual(outcomes, [""] * 4 + [service.WINDOW_LOCK] + [""] * 2 + [service.DAILY_LOCK])
        self.assertEqual(notice_rows(notices.LOCKED_NOTE).count(), 2)
        self.assertEqual(notice_rows(notices.DAILY_LOCKED_NOTE).count(), 2)
        self.assertEqual(OtpEvent.objects.filter(kind=OtpEvent.LOCKED).count(), 2)

    def test_cap_resets_next_accra_day(self):
        self.fail(20, DAY + timedelta(hours=1))
        self.assertTrue(service.is_locked(self.customer, DAY + timedelta(hours=23, minutes=59, seconds=59)))
        tomorrow = DAY + timedelta(days=1)
        self.assertEqual(service.daily_failures(self.customer, tomorrow), 0)
        self.assertFalse(service.is_locked(self.customer, tomorrow))
        service.send(self.customer, SIGN_IN, SMS, ticket="t", now=tomorrow)
        challenge = service.verify(self.customer, SIGN_IN, last_sms_code(), ticket="t", now=tomorrow + timedelta(seconds=5))
        self.assertIsNotNone(challenge.consumed_at)

    @override_settings(TIME_ZONE="Africa/Lagos")  # UTC+1: its midnight is 23:00 UTC
    def test_the_day_is_the_local_day_not_the_utc_day(self):
        lagos = ZoneInfo("Africa/Lagos")
        midnight = datetime(2026, 10, 20, 0, 0, tzinfo=lagos)
        self.fail(20, midnight - timedelta(hours=7))  # all before local midnight (the last at 23:20 local)
        self.assertTrue(service.is_locked(self.customer, midnight - timedelta(seconds=1)))
        self.assertFalse(service.is_locked(self.customer, midnight + timedelta(seconds=1)))  # still 23:00 UTC

    def test_staff_recovery_resets_daily_count(self):
        last = self.fail(20, DAY + timedelta(hours=1))
        self.assertTrue(service.is_locked(self.customer, last + timedelta(hours=1)))
        audit.log(OtpEvent.RECOVERED, account=self.customer, purpose=RECOVERY, now=last + timedelta(minutes=30))
        after = last + timedelta(hours=1)
        self.assertEqual(service.daily_failures(self.customer, after), 0)
        self.assertFalse(service.is_locked(self.customer, after))

    def test_a_cap_lowered_mid_day_locks_the_next_wrong_code_with_its_notice(self):
        start = DAY + timedelta(hours=1)
        self.fail(12, start)
        at = start + 12 * GAP
        MoneySetting.objects.create(key="otp_daily_failure_cap", value=10, effective_from=start)
        # The guess path (verify) is not refused before it counts; note_failure must lock at >= cap, not == cap.
        with service.guessing(self.customer):
            outcome = service.note_failure(self.customer, purpose=SIGN_IN, channel=SMS, now=at)
        self.assertEqual(outcome, service.DAILY_LOCK)
        notices.account_locked(self.customer, purpose=SIGN_IN, now=at, until_tomorrow=True)
        self.assertEqual(notice_rows(notices.DAILY_LOCKED_NOTE).count(), 2)  # one text and one email, once
        self.assertEqual(service.daily_failures(self.customer, at), 13)
        self.assertEqual(OtpEvent.objects.filter(kind=OtpEvent.LOCKED).count(), 1)

    def test_the_cap_is_the_governed_setting(self):
        MoneySetting.objects.create(key="otp_daily_failure_cap", value=8, effective_from=DAY - timedelta(days=1))
        last = self.fail(7, DAY + timedelta(hours=1))
        self.assertFalse(service.is_locked(self.customer, last + timedelta(minutes=1)))
        self.fail(1, last + GAP)
        self.assertTrue(service.is_locked(self.customer, last + timedelta(hours=3)))

    def test_the_fifteen_minute_lock_still_holds_below_the_cap(self):
        at = DAY + timedelta(hours=1)
        for i in range(5):
            with service.guessing(self.customer):
                locked = service.note_failure(self.customer, purpose=SIGN_IN, channel=SMS, now=at + timedelta(seconds=i))
        self.assertEqual(locked, service.WINDOW_LOCK)
        self.assertTrue(service.is_locked(self.customer, at + timedelta(minutes=10)))
        self.assertFalse(service.is_locked(self.customer, at + timedelta(minutes=16)))


@override_settings(OTP_SIGNIN_ENFORCED=False)
class AuthenticatorCountsTowardsTheCapTests(TestCase):
    """Wrong authenticator codes count towards the daily cap, and the 21st try with the right password and a right
    authenticator code is refused, with the sign-in switch off."""

    def setUp(self):
        cache.clear()
        senders.sms_outbox.clear()
        mail.outbox = []
        self.owner = make_owner()
        self.secret = pyotp.random_base32()
        AccountAuthenticator.objects.create(
            account_type="business_owner", account_id=self.owner.pk, secret_encrypted=encrypt_secret(self.secret),
            confirmed_at=timezone.now(),
        )
        self.t0 = int(time.time())
        self.noon = DAY + timedelta(hours=12)

    def ticket(self):
        response = APIClient().post(
            "/api/accounts/business-owners/login/", {"identifier": "+233201112233", "password": PASSWORD}, format="json",
        )
        self.assertEqual(set(response.json()), {"two_factor_required", "mfa_token"})
        return response.json()["mfa_token"]

    def guess(self, ticket, code):
        return APIClient().post("/api/otp/sign-in/verify/", {"mfa_token": ticket, "code": code}, format="json")

    def test_wrong_authenticator_codes_reach_the_cap(self):
        for i in range(19):
            audit.log(OtpEvent.FAILED, account=self.owner, purpose=SIGN_IN, channel=AUTHENTICATOR,
                      now=self.noon - timedelta(hours=10) + i * GAP)
        right = pyotp.TOTP(self.secret).at(self.t0)
        ticket = self.ticket()
        with mock.patch("django.utils.timezone.now", return_value=self.noon), \
                mock.patch("accounts.two_factor._clock", return_value=self.t0):
            twentieth = self.guess(ticket, wrong_code(right))
            twenty_first = self.guess(ticket, right)
        self.assertEqual(twentieth.json()["code"], "wrong_code")
        self.assertEqual(notice_rows(notices.DAILY_LOCKED_NOTE).count(), 2)
        self.assertEqual(twenty_first.status_code, 429)
        self.assertEqual(twenty_first.json()["code"], "try_later")
        self.assertNotIn("token", twenty_first.json())
        self.assertTrue(service.is_locked(self.owner, self.noon + timedelta(hours=11)))
