"""The one OTP service (otp.service): codes, expiry, tries, resends, hourly limits and the lock.
Review Focus 1, 2, 3, 6 and 8."""
import threading
from datetime import timedelta
from unittest import mock

from django.db import connection
from django.test import RequestFactory, TestCase, TransactionTestCase
from django.utils import timezone

from otp import senders, service
from otp.models import EMAIL, SIGN_IN, SMS, STEP_UP, OtpChallenge, OtpEvent, VerifiedContact
from otp.service import OtpError

from .helpers import SIX_DIGITS, last_email_code, last_sms_code, make_customer, make_owner, wrong_code


class ServiceBase(TestCase):
    def setUp(self):
        senders.sms_outbox.clear()
        self.customer = make_customer()

    def send(self, channel=SMS, ticket="t1", **kwargs):
        return service.send(self.customer, SIGN_IN, channel, ticket=ticket, **kwargs)

    def verify(self, code, ticket="t1", **kwargs):
        return service.verify(self.customer, SIGN_IN, code, ticket=ticket, **kwargs)

    def refused(self, call, *args, **kwargs):
        with self.assertRaises(OtpError) as caught:
            call(*args, **kwargs)
        return caught.exception

    def age_last_send(self, seconds=61):
        OtpChallenge.objects.update(last_sent_at=timezone.now() - timedelta(seconds=seconds))


class CodeTests(ServiceBase):
    def test_a_code_is_six_digits_and_stored_only_as_a_salted_hash(self):
        challenge = self.send()
        code = last_sms_code()
        self.assertRegex(code, r"^\d{6}$")
        self.assertEqual((len(challenge.code_hash), len(challenge.salt)), (40, 32))  # salted_hmac defaults to SHA-1
        self.assertEqual(challenge.code_hash, service.hash_code(challenge.salt, code))
        # No text column of any OTP row holds the code (the phone number and the hex hash/salt are left out
        # only because a run of six digits could appear in them by chance).
        for row in (*OtpChallenge.objects.all(), *OtpEvent.objects.all()):
            for field in row._meta.concrete_fields:
                value = getattr(row, field.attname)
                if isinstance(value, str) and field.name not in ("destination", "salt", "code_hash"):
                    self.assertNotIn(code, value, f"{type(row).__name__}.{field.name}")

    def test_codes_come_from_secrets(self):
        with mock.patch("otp.service.secrets.randbelow", return_value=42) as randbelow:
            self.assertEqual(service.new_code(), "000042")
        randbelow.assert_called_once_with(1000000)

    def test_the_text_says_what_it_is_for_and_never_to_share_it(self):
        self.send()
        body = senders.sms_outbox[-1].body
        self.assertIn("to sign in", body)
        self.assertIn("5 minutes", body)
        self.assertIn("Never share it", body)

    def test_the_right_code_works_once(self):
        self.send()
        code = last_sms_code()
        self.assertIsNotNone(self.verify(code).consumed_at)
        self.assertEqual(self.refused(self.verify, code).code, "code_expired")

    def test_typing_spaces_or_a_hyphen_is_fine(self):
        self.send()
        code = last_sms_code()
        self.verify(f"{code[:3]} - {code[3:]}")

    def test_a_code_expires_after_five_minutes(self):
        self.send()
        code = last_sms_code()
        OtpChallenge.objects.update(expires_at=timezone.now() - timedelta(seconds=1))
        self.assertEqual(self.refused(self.verify, code).code, "code_expired")

    def test_a_code_for_one_ticket_or_purpose_never_completes_another(self):
        self.send(ticket="t1")
        code = last_sms_code()
        self.assertEqual(self.refused(self.verify, code, ticket="t2").code, "code_expired")
        self.assertEqual(self.refused(service.verify, self.customer, STEP_UP, code, ticket="t1").code, "code_expired")
        self.verify(code, ticket="t1")

    def test_an_accepted_code_marks_the_contact_verified(self):
        self.send(channel=EMAIL)
        self.verify(last_email_code())
        self.assertTrue(VerifiedContact.objects.filter(
            account_type="customer", account_id=self.customer.pk, channel=EMAIL, destination="ama@example.com",
        ).exists())
        self.assertTrue(OtpEvent.objects.filter(kind=OtpEvent.VERIFIED, channel=EMAIL).exists())

    def test_a_channel_the_account_lacks_is_refused(self):
        # `no_channel` is kept for the login's 409 "no phone or email on file"; this is "not that way".
        owner = make_owner(email=None)
        error = self.refused(service.send, owner, SIGN_IN, EMAIL, ticket="t")
        self.assertEqual((error.code, error.status_code), ("channel_unavailable", 400))
        self.assertEqual(self.refused(service.send, owner, SIGN_IN, ["sms"], ticket="t").code, "channel_unavailable")


class GuessingTests(ServiceBase):
    def test_wrong_codes_count_and_the_sixth_try_is_refused_even_when_right(self):
        self.send()
        code = last_sms_code()
        for _ in range(5):
            self.assertEqual(self.refused(self.verify, wrong_code(code)).code, "wrong_code")
        error = self.refused(self.verify, code)
        self.assertEqual((error.code, error.status_code), ("try_later", 429))
        self.assertEqual(OtpEvent.objects.filter(kind=OtpEvent.LOCKED).count(), 1)

    def test_a_resend_never_buys_more_guesses(self):
        self.send()
        for _ in range(3):
            self.refused(self.verify, wrong_code(last_sms_code()))
        self.age_last_send()
        self.send()
        code = last_sms_code()
        for _ in range(2):
            self.refused(self.verify, wrong_code(code))
        self.assertEqual(OtpChallenge.objects.get().attempts, 5)
        # Even once the lock has passed, this challenge has used its five tries.
        OtpEvent.objects.update(at=timezone.now() - timedelta(minutes=16))
        self.assertEqual(self.refused(self.verify, code).code, "code_expired")

    def test_the_lock_covers_every_challenge_and_sending_and_passes_after_fifteen_minutes(self):
        for ticket in ("a", "b", "c", "d", "e"):
            self.send(ticket=ticket)
            self.refused(self.verify, wrong_code(last_sms_code()), ticket=ticket)
        self.assertTrue(service.is_locked(self.customer))
        error = self.refused(self.send, ticket="f")
        self.assertEqual((error.code, error.status_code), ("try_later", 429))
        self.assertTrue(OtpEvent.objects.filter(kind=OtpEvent.SEND_REFUSED, note="locked").exists())
        OtpEvent.objects.update(at=timezone.now() - timedelta(minutes=61))
        self.assertFalse(service.is_locked(self.customer))
        self.send(ticket="f")
        self.verify(last_sms_code(), ticket="f")

    def test_a_staff_assisted_recovery_restarts_the_count(self):
        for _ in range(5):
            OtpEvent.objects.create(kind=OtpEvent.FAILED, account_type="customer", account_id=self.customer.pk)
        self.assertTrue(service.is_locked(self.customer))
        OtpEvent.objects.create(kind=OtpEvent.RECOVERED, account_type="customer", account_id=self.customer.pk)
        self.assertFalse(service.is_locked(self.customer))


class ResendAndLimitTests(ServiceBase):
    def test_a_resend_inside_a_minute_waits_and_says_how_long(self):
        self.send()
        error = self.refused(self.send)
        self.assertEqual((error.code, error.status_code), ("resend_cooldown", 429))
        self.assertTrue(1 <= error.retry_after <= 61)
        self.assertEqual(error.body()["retry_after"], error.retry_after)
        self.assertEqual(len(senders.sms_outbox), 1)

    def test_a_resend_rotates_the_code_and_may_switch_channel(self):
        self.send()
        first = last_sms_code()
        self.age_last_send()
        challenge = self.send(channel=EMAIL)
        self.assertEqual((challenge.channel, challenge.sends), (EMAIL, 2))
        second = last_email_code()
        if first != second:
            self.assertEqual(self.refused(self.verify, first).code, "wrong_code")
        self.verify(second)

    def test_five_texts_an_hour_to_one_phone_then_try_later(self):
        for ticket in "abcde":
            self.send(ticket=ticket)
        error = self.refused(self.send, ticket="f")
        self.assertEqual((error.code, error.status_code), ("try_later", 429))
        self.assertEqual(len(senders.sms_outbox), 5)
        OtpEvent.objects.update(at=timezone.now() - timedelta(minutes=61))
        self.send(ticket="f")

    def test_ten_codes_an_hour_per_account_whatever_the_destination(self):
        for n in range(10):
            OtpEvent.objects.create(kind=OtpEvent.SENT, account_type="customer", account_id=self.customer.pk, channel=SMS, destination=f"+23320000{n:04d}")
        self.assertEqual(self.refused(self.send).code, "try_later")

    def test_sixty_codes_an_hour_from_one_address(self):
        # Final review F7: carrier NAT puts many people behind one address; 60 is a guess to tune with traffic data.
        for n in range(59):
            OtpEvent.objects.create(kind=OtpEvent.SENT, ip="154.160.24.91", channel=SMS, destination=f"+23320000{n:04d}")
        here = RequestFactory().post("/", REMOTE_ADDR="154.160.24.91")
        self.send(ticket="a", request=here)
        self.assertEqual(self.refused(self.send, ticket="b", request=here).code, "try_later")
        self.send(ticket="b", request=RequestFactory().post("/", REMOTE_ADDR="154.160.24.92"))

    def test_another_accounts_codes_to_my_number_do_not_use_up_my_allowance(self):
        # Final review F3: an account registered with someone else's number (typed another way) cannot lock them out.
        attacker = make_customer(phone="0241234567", email="kofi@example.com")
        for ticket in "abcde":
            service.send(attacker, SIGN_IN, SMS, ticket=ticket)
        self.assertEqual(self.refused(service.send, attacker, SIGN_IN, SMS, ticket="f").code, "try_later")
        self.send(ticket="mine")
        self.assertEqual(senders.sms_outbox[-1].to, "+233241234567")

    def test_one_number_gets_at_most_twenty_codes_an_hour_from_every_account_together(self):
        for n in range(19):
            OtpEvent.objects.create(
                kind=OtpEvent.SENT if n % 2 else OtpEvent.SEND_FAILED, account_type="customer", account_id=100000 + n,
                channel=SMS, destination="+233241234567",
            )
        self.send(ticket="a")  # the 20th
        other = make_customer(phone="0241234567", email="kofi@example.com")
        error = self.refused(service.send, other, SIGN_IN, SMS, ticket="b")
        self.assertEqual((error.code, error.status_code), ("try_later", 429))
        self.assertEqual(len(senders.sms_outbox), 1)
        self.assertTrue(OtpEvent.objects.filter(kind=OtpEvent.SEND_REFUSED, note="hourly limit").exists())
        service.send(other, SIGN_IN, EMAIL, ticket="b")  # another destination is unaffected

    def test_a_lock_and_an_hourly_limit_give_the_same_answer(self):
        # Review Focus 3: nobody can tell "this account is locked" from "too many texts".
        owner = make_owner()
        for _ in range(5):
            OtpEvent.objects.create(kind=OtpEvent.SENT, account_type="business_owner", account_id=owner.pk, channel=SMS, destination="+233201112233")
        limited = self.refused(service.send, owner, SIGN_IN, SMS, ticket="x")
        for _ in range(5):
            OtpEvent.objects.create(kind=OtpEvent.FAILED, account_type="customer", account_id=self.customer.pk)
        locked = self.refused(self.send)
        self.assertEqual((limited.body(), limited.status_code), (locked.body(), locked.status_code))

    def test_a_failed_delivery_is_reported_and_counted(self):
        with mock.patch("otp.senders.deliver", return_value=senders.Delivery(ok=False, provider="hubtel")):
            error = self.refused(self.send)
        self.assertEqual((error.code, error.status_code), ("send_failed", 502))
        self.assertTrue(OtpEvent.objects.filter(kind=OtpEvent.SEND_FAILED, provider="hubtel").exists())

    def test_a_broken_spend_check_never_fails_a_code_already_sent(self):
        with mock.patch("otp.spend.check", side_effect=RuntimeError("db hiccup")), self.assertLogs("otp.spend", "WARNING") as logs:
            challenge = self.send()
        self.assertIsNotNone(challenge.pk)
        self.assertEqual(len(senders.sms_outbox), 1)
        self.assertIn("RuntimeError", "\n".join(logs.output))
        self.assertNotIn("db hiccup", "\n".join(logs.output))

    def test_every_text_and_no_email_is_checked_against_the_spend_alert(self):
        with mock.patch("otp.spend.check") as check:
            self.send()
            self.age_last_send()
            self.send(channel=EMAIL)
        check.assert_called_once()


FAILED_DELIVERY = mock.patch("otp.senders.deliver", return_value=senders.Delivery(ok=False, provider="hubtel"))


class DeliveryFailureTests(ServiceBase):
    """Final review F6: a send that fails is counted, never escapes, never kills the code already delivered and never
    starts the 60-second wait."""

    def test_an_exception_inside_a_sender_is_a_counted_failure_not_a_crash(self):
        with mock.patch("otp.senders.send_sms", side_effect=RuntimeError("socket said 123456")):
            error = self.refused(self.send)
        self.assertEqual((error.code, error.status_code), ("send_failed", 502))
        self.assertEqual(OtpEvent.objects.filter(kind=OtpEvent.SEND_FAILED).count(), 1)

    def test_a_failed_resend_keeps_the_code_already_delivered(self):
        self.send()
        first = last_sms_code()
        self.age_last_send()
        before = OtpChallenge.objects.values("code_hash", "salt", "last_sent_at", "expires_at", "channel", "destination", "sends").get()
        with FAILED_DELIVERY:
            self.assertEqual(self.refused(self.send, channel=EMAIL).code, "send_failed")
        self.assertEqual(
            OtpChallenge.objects.values("code_hash", "salt", "last_sent_at", "expires_at", "channel", "destination", "sends").get(), before,
        )
        self.verify(first)

    def test_a_failed_resend_starts_no_wait(self):
        self.send()
        self.age_last_send()
        with FAILED_DELIVERY:
            self.refused(self.send)
        challenge = self.send(channel=EMAIL)  # at once: the failure did not start the 60 seconds
        self.assertEqual(challenge.channel, EMAIL)
        self.verify(last_email_code())

    def test_a_failed_first_send_starts_no_wait_and_its_code_never_works(self):
        with mock.patch("otp.senders.deliver", side_effect=lambda *args: senders.Delivery(ok=False, provider="hubtel")) as failing:
            self.refused(self.send)
        undelivered_body = failing.call_args.args[3]
        undelivered = SIX_DIGITS.search(undelivered_body).group(1)
        self.assertEqual(self.refused(self.verify, undelivered).code, "code_expired")
        self.send(channel=EMAIL)
        self.verify(last_email_code())

    def test_failed_sends_still_count_towards_the_hourly_limits(self):
        with FAILED_DELIVERY:
            for _ in range(5):
                self.assertEqual(self.refused(self.send).code, "send_failed")
            self.assertEqual(self.refused(self.send).code, "try_later")
        self.assertEqual(OtpEvent.objects.filter(kind=OtpEvent.SEND_FAILED).count(), 5)


class ConcurrentUseTests(TransactionTestCase):
    """Review Focus 1: the same right code sent twice at once signs in once."""

    serialized_rollback = True

    def test_two_requests_with_the_right_code_at_once_succeed_once(self):
        senders.sms_outbox.clear()
        customer = make_customer()
        service.send(customer, SIGN_IN, SMS, ticket="t1")
        code = last_sms_code()
        results = []
        barrier = threading.Barrier(2)

        def run():
            try:
                barrier.wait()
                service.verify(customer, SIGN_IN, code, ticket="t1")
                results.append("ok")
            except OtpError as exc:
                results.append(exc.code)
            finally:
                connection.close()

        threads = [threading.Thread(target=run) for _ in range(2)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=10)
            self.assertFalse(thread.is_alive(), "a racing thread hung")
        self.assertEqual(sorted(results), ["code_expired", "ok"])
        self.assertEqual(OtpEvent.objects.filter(kind=OtpEvent.VERIFIED).count(), 1)
