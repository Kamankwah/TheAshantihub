"""Guessing limits that hold under parallel requests, and the notices that tell the account holder (final review F4)."""
import threading
import time
from datetime import timedelta
from unittest import mock

import pyotp
from django.core import mail
from django.core.cache import cache
from django.db import connection
from django.test import TestCase, TransactionTestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.two_factor import _hash_code, _normalise_code, encrypt_secret
from otp import notices, senders, service, signin
from otp.models import SIGN_IN, SMS, AccountAuthenticator, OtpEvent
from otp.service import OtpError

from .helpers import PASSWORD, last_sms_code, make_customer, make_owner, wrong_code

ON = override_settings(OTP_SIGNIN_ENFORCED=True)
VERIFY = "/api/otp/sign-in/verify/"
RECOVERY_CODES = ["abcde-fghij", "klmno-pqrst"]


def enrol(account, kind, secret):
    return AccountAuthenticator.objects.create(
        account_type=kind, account_id=account.pk, secret_encrypted=encrypt_secret(secret), confirmed_at=timezone.now(),
        recovery_code_hashes=[_hash_code(_normalise_code(c)) for c in RECOVERY_CODES],
    )


def wrong_totp(secret, t0):
    """A six-digit code no step of the ±1 drift window around t0 accepts."""
    near = {pyotp.TOTP(secret).at(t0 + 30 * k) for k in (-1, 0, 1)}
    return next(c for c in ("000000", "111111", "222222", "333333") if c not in near)


def notice_rows(note=notices.LOCKED_NOTE):
    return OtpEvent.objects.filter(kind__in=service.SEND_KINDS, note=note)


class ParallelWrongGuessTests(TransactionTestCase):
    """Wrong guesses racing on one account end with exactly five counted and the account locked, by text code or
    authenticator."""

    serialized_rollback = True

    def setUp(self):
        cache.clear()
        senders.sms_outbox.clear()
        mail.outbox = []

    def race(self, count, guess):
        barrier = threading.Barrier(count)
        results = []

        def run(i):
            try:
                barrier.wait(timeout=10)
                results.append(guess(i))
            except Exception as exc:  # noqa: BLE001 - reported as a result, so the assertion shows it
                results.append(type(exc).__name__)
            finally:
                connection.close()

        threads = [threading.Thread(target=run, args=(i,)) for i in range(count)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=30)
            self.assertFalse(thread.is_alive(), "a racing thread hung")
        return results

    def test_parallel_wrong_texted_codes_count_five_and_lock(self):
        customer = make_customer()
        tickets, codes = ["t0", "t1", "t2", "t3"], {}
        for ticket in tickets:  # four codes in flight: 20 tries between them, so only the account lock can stop at 5
            service.send(customer, SIGN_IN, SMS, ticket=ticket)
            codes[ticket] = last_sms_code()

        def guess(i):
            ticket = tickets[i % len(tickets)]
            try:
                service.verify(customer, SIGN_IN, wrong_code(codes[ticket]), ticket=ticket)
            except OtpError as exc:
                return exc.code
            return "accepted"

        results = self.race(16, guess)
        self.assertEqual(sorted(results), ["try_later"] * 11 + ["wrong_code"] * 5, results)
        self.assertEqual(OtpEvent.objects.filter(kind=OtpEvent.FAILED).count(), 5)
        self.assertEqual(OtpEvent.objects.filter(kind=OtpEvent.LOCKED).count(), 1)
        self.assertTrue(service.is_locked(customer))
        self.assertEqual(notice_rows().count(), 2)  # one text, one email: the lock engaged once

    def test_parallel_wrong_authenticator_codes_count_five_and_lock(self):
        owner = make_owner()
        secret, t0 = pyotp.random_base32(), int(time.time())
        enrol(owner, "business_owner", secret)
        tickets = [signin.make_ticket(owner, signin.AUTHENTICATOR_STAGE, SIGN_IN) for _ in range(8)]
        wrong = wrong_totp(secret, t0)

        def guess(i):
            return APIClient().post(VERIFY, {"mfa_token": tickets[i], "code": wrong}, format="json").json().get("code")

        with ON, mock.patch("accounts.two_factor._clock", return_value=t0):
            results = self.race(8, guess)
        self.assertEqual(sorted(results), ["try_later"] * 3 + ["wrong_code"] * 5, results)
        self.assertEqual(OtpEvent.objects.filter(kind=OtpEvent.FAILED, channel="authenticator").count(), 5)
        self.assertTrue(service.is_locked(owner))


class LockNoticeTests(TestCase):
    def setUp(self):
        cache.clear()
        senders.sms_outbox.clear()
        self.customer = make_customer()

    def five_wrong(self, ticket):
        service.send(self.customer, SIGN_IN, SMS, ticket=ticket)
        code = last_sms_code()
        before = (notice_rows().count(), len(mail.outbox))
        for n in range(5):
            with self.assertRaises(OtpError) as caught:
                service.verify(self.customer, SIGN_IN, wrong_code(code), ticket=ticket)
            self.assertEqual(caught.exception.code, "wrong_code")
            if n < 4:
                self.assertEqual((notice_rows().count(), len(mail.outbox)), before)  # nothing until the 5th
        return code

    def test_the_holder_hears_the_moment_wrong_codes_lock_the_account(self):
        code = self.five_wrong("a")
        self.assertTrue(service.is_locked(self.customer))
        text, email = senders.sms_outbox[-1], mail.outbox[-1]
        self.assertEqual((text.to, email.to), ("+233241234567", ["ama@example.com"]))
        for body in (text.body, email.body):
            self.assertIn("Someone entered wrong sign-in codes for your AshantiHub account several times", body)
            self.assertIn("If this wasn't you, change your password and contact Support.", body)
            self.assertNotIn(code, body)
            self.assertNotIn("http", body)
        self.assertEqual(set(notice_rows().values_list("kind", "channel")), {(OtpEvent.SENT, "sms"), (OtpEvent.SENT, "email")})

    def test_a_lock_notice_goes_at_most_once_an_hour(self):
        self.five_wrong("a")
        OtpEvent.objects.filter(kind=OtpEvent.FAILED).update(at=timezone.now() - timedelta(minutes=16))
        self.five_wrong("b")
        self.assertEqual(OtpEvent.objects.filter(kind=OtpEvent.LOCKED).count(), 2)
        self.assertEqual(notice_rows().count(), 2)
        OtpEvent.objects.update(at=timezone.now() - timedelta(minutes=61))
        self.five_wrong("c")
        self.assertEqual(notice_rows().count(), 4)

    def test_a_notice_that_cannot_go_changes_nothing_else(self):
        with mock.patch("otp.notices.contacts", side_effect=RuntimeError("boom")), self.assertLogs("otp.notices", "WARNING") as logs:
            self.five_wrong("a")
        self.assertTrue(service.is_locked(self.customer))
        self.assertIn("RuntimeError", "\n".join(logs.output))
        self.assertNotIn("boom", "\n".join(logs.output))
        OtpEvent.objects.update(at=timezone.now() - timedelta(minutes=61))
        service.send(self.customer, SIGN_IN, SMS, ticket="b")
        code = last_sms_code()
        with mock.patch("otp.senders.deliver", return_value=senders.Delivery(ok=False, provider="hubtel")):
            for _ in range(5):
                with self.assertRaises(OtpError) as caught:
                    service.verify(self.customer, SIGN_IN, wrong_code(code), ticket="b")
                self.assertEqual(caught.exception.code, "wrong_code")
        self.assertEqual(sorted(notice_rows().values_list("kind", "channel")), [(OtpEvent.SEND_FAILED, "email"), (OtpEvent.SEND_FAILED, "sms")])


@ON
class AuthenticatorNoticeTests(TestCase):
    def setUp(self):
        cache.clear()
        senders.sms_outbox.clear()
        self.owner = make_owner()
        self.secret, self.t0 = pyotp.random_base32(), int(time.time())
        enrol(self.owner, "business_owner", self.secret)

    def ticket(self):
        body = APIClient().post("/api/accounts/business-owners/login/", {"identifier": "+233201112233", "password": PASSWORD}, format="json").json()
        return body["mfa_token"]

    def test_wrong_authenticator_codes_that_lock_the_account_tell_the_holder(self):
        ticket = self.ticket()
        with mock.patch("accounts.two_factor._clock", return_value=self.t0):
            for _ in range(5):
                self.assertEqual(APIClient().post(VERIFY, {"mfa_token": ticket, "code": wrong_totp(self.secret, self.t0)}, format="json").json()["code"], "wrong_code")
        self.assertEqual((senders.sms_outbox[-1].to, mail.outbox[-1].to), ("+233201112233", ["kwame@example.com"]))
        self.assertIn("wrong sign-in codes", mail.outbox[-1].body)
        self.assertEqual(notice_rows().count(), 2)

    def test_signing_in_with_a_recovery_code_tells_the_holder(self):
        response = APIClient().post(VERIFY, {"mfa_token": self.ticket(), "recovery_code": RECOVERY_CODES[0]}, format="json")
        self.assertIn("token", response.json())
        text, email = senders.sms_outbox[-1], mail.outbox[-1]
        self.assertEqual((text.to, email.to), ("+233201112233", ["kwame@example.com"]))
        for body in (text.body, email.body):
            self.assertIn("A recovery code was used to sign in to your AshantiHub account", body)
            self.assertIn("If this wasn't you, change your password and contact Support.", body)
            self.assertNotIn(RECOVERY_CODES[0], body)
            self.assertNotIn(_normalise_code(RECOVERY_CODES[0]), body)
            self.assertNotIn("http", body)
        self.assertEqual(notice_rows(notices.RECOVERY_CODE_NOTE).count(), 2)

    def test_a_wrong_recovery_code_sends_no_recovery_notice(self):
        response = APIClient().post(VERIFY, {"mfa_token": self.ticket(), "recovery_code": "zzzzz-zzzzz"}, format="json")
        self.assertEqual(response.json()["code"], "wrong_code")
        self.assertEqual((senders.sms_outbox, mail.outbox), ([], []))
