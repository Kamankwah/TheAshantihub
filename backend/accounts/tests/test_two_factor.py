import io
import time
from datetime import timedelta
from unittest import mock

import pyotp
from django.contrib.auth.hashers import make_password
from django.core import mail
from django.core.cache import cache
from django.core.management import call_command
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import AccessToken

from accounts import two_factor
from accounts.models import PasswordResetToken, StaffSession, StaffTwoFactor, StaffUser
from accounts.testing import make_staff as _make_staff
from accounts.testing import staff_token
from activity.models import ActivityEvent

PASSWORD = "correct-horse-1"
HASHED = make_password(PASSWORD)


def make_staff(role, email):
    return _make_staff(role, email, password_hash=HASHED)


class TwoFactorBase(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.boss = make_staff("super_admin", "boss@example.com")
        self.esi = make_staff("support", "esi@example.com")
        self.t0 = int(time.time())

    def clock(self, offset=0):
        return mock.patch("accounts.two_factor._clock", return_value=self.t0 + offset)

    def enrol(self, staff):
        secret, _ = two_factor.begin_enrolment(staff)
        with self.clock():
            codes = two_factor.confirm_enrolment(staff, pyotp.TOTP(secret).at(self.t0))
        return secret, codes

    def password_step(self, email):
        return self.client.post("/api/accounts/staff/login/", {"identifier": email, "password": PASSWORD}, format="json")

    def second_step(self, mfa_token, **body):
        return self.client.post("/api/accounts/staff/login/two-factor/", {"mfa_token": mfa_token, **body}, format="json")


class TwoFactorSignInTests(TwoFactorBase):
    def test_staff_without_two_factor_sign_in_with_a_password(self):
        self.assertIn("token", self.password_step("esi@example.com").json())

    def test_a_super_admin_sets_it_up_at_the_next_sign_in(self):
        body = self.password_step("boss@example.com").json()
        self.assertEqual(set(body), {"two_factor_setup_required", "mfa_token"})
        start = self.client.post(
            "/api/accounts/staff/two-factor/enrol/start/", {"mfa_token": body["mfa_token"]}, format="json"
        ).json()
        self.assertTrue(start["otpauth_uri"].startswith("otpauth://totp/AshantiHub:"))
        with self.clock():
            done = self.client.post(
                "/api/accounts/staff/two-factor/enrol/confirm/",
                {"mfa_token": body["mfa_token"], "code": pyotp.TOTP(start["secret"]).at(self.t0)}, format="json",
            )
        self.assertEqual(done.status_code, 200)
        self.assertEqual(len(done.json()["recovery_codes"]), 10)
        self.assertTrue(StaffSession.objects.get(jti=AccessToken(done.json()["token"])["jti"]).two_factor)
        self.assertEqual(mail.outbox[-1].to, ["boss@example.com"])

    def test_the_secret_is_encrypted_at_rest(self):
        secret, _ = two_factor.begin_enrolment(self.esi)
        stored = StaffTwoFactor.objects.get(staff=self.esi).pending_secret_encrypted
        self.assertNotIn(secret, stored)
        self.assertEqual(two_factor.decrypt_secret(stored), secret)

    def test_enrolled_staff_need_their_code(self):
        secret, _ = self.enrol(self.esi)
        body = self.password_step("esi@example.com").json()
        self.assertEqual(set(body), {"two_factor_required", "mfa_token"})
        with self.clock(60):
            self.assertEqual(self.second_step(body["mfa_token"], code="000000").status_code, 400)
            response = self.second_step(body["mfa_token"], code=pyotp.TOTP(secret).at(self.t0 + 60))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(set(response.json()), {"token", "account_type", "id", "full_name", "role", "permissions"})

    def test_a_code_works_only_once(self):
        secret, _ = self.enrol(self.esi)
        token = self.password_step("esi@example.com").json()["mfa_token"]
        code = pyotp.TOTP(secret).at(self.t0 + 60)
        with self.clock(60):
            self.assertEqual(self.second_step(token, code=code).status_code, 200)
            self.assertEqual(self.second_step(token, code=code).status_code, 400)

    def test_the_enrolment_code_cannot_be_reused_to_sign_in(self):
        secret, _ = self.enrol(self.esi)
        token = self.password_step("esi@example.com").json()["mfa_token"]
        with self.clock():
            self.assertEqual(self.second_step(token, code=pyotp.TOTP(secret).at(self.t0)).status_code, 400)

    def test_a_recovery_code_works_once(self):
        _, codes = self.enrol(self.esi)
        token = self.password_step("esi@example.com").json()["mfa_token"]
        self.assertEqual(self.second_step(token, recovery_code=codes[0].upper()).status_code, 200)
        self.assertEqual(self.second_step(token, recovery_code=codes[0]).status_code, 400)
        self.assertEqual(two_factor.status(self.esi)["recovery_codes_left"], 9)

    def test_a_wrong_stage_or_expired_challenge_is_refused(self):
        self.enrol(self.esi)
        token = self.password_step("esi@example.com").json()["mfa_token"]
        self.assertEqual(
            self.client.post("/api/accounts/staff/two-factor/enrol/start/", {"mfa_token": token}, format="json").status_code,
            400,
        )
        with mock.patch("accounts.two_factor.CHALLENGE_MAX_AGE", -1):
            self.assertEqual(self.second_step(token, code="123456").status_code, 400)

    def test_a_timed_out_step_says_so_with_a_code_the_screen_can_act_on(self):
        self.enrol(self.esi)
        token = self.password_step("esi@example.com").json()["mfa_token"]
        with mock.patch("accounts.two_factor.CHALLENGE_MAX_AGE", -1):
            response = self.second_step(token, code="123456")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["code"], "challenge_expired")
        for path in ("enrol/start/", "enrol/confirm/"):
            response = self.client.post(f"/api/accounts/staff/two-factor/{path}", {"mfa_token": "junk", "code": "123456"}, format="json")
            self.assertEqual(response.status_code, 400, path)
            self.assertEqual(response.json()["code"], "challenge_expired", path)

    def test_failed_codes_are_recorded(self):
        self.enrol(self.esi)
        token = self.password_step("esi@example.com").json()["mfa_token"]
        self.second_step(token, code="123456")
        self.assertTrue(ActivityEvent.objects.filter(verb="staff.two_factor_failed", actor_id=self.esi.id).exists())

    def test_a_suspended_staffer_cannot_finish_signing_in(self):
        secret, _ = self.enrol(self.esi)
        token = self.password_step("esi@example.com").json()["mfa_token"]
        StaffUser.objects.filter(pk=self.esi.pk).update(is_suspended=True)
        with self.clock(60):
            self.assertEqual(self.second_step(token, code=pyotp.TOTP(secret).at(self.t0 + 60)).status_code, 400)


class TwoFactorFailureCapTests(TwoFactorBase):
    def fail_five_times(self):
        token = self.password_step("esi@example.com").json()["mfa_token"]
        for _ in range(two_factor.FAILURE_LIMIT):
            self.assertEqual(self.second_step(token, code="123456").status_code, 400)
        return token

    def test_five_wrong_codes_lock_out_even_a_correct_one(self):
        secret, _ = self.enrol(self.esi)
        token = self.fail_five_times()
        with self.clock(60):
            response = self.second_step(token, code=pyotp.TOTP(secret).at(self.t0 + 60))
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["detail"], "Too many wrong codes. Wait 15 minutes, then sign in again.")

    def test_recovery_codes_are_locked_out_too(self):
        _, codes = self.enrol(self.esi)
        token = self.fail_five_times()
        response = self.second_step(token, recovery_code=codes[0])
        self.assertEqual(response.status_code, 400)
        self.assertIn("Too many wrong codes", response.json()["detail"])
        self.assertEqual(two_factor.status(self.esi)["recovery_codes_left"], 10)

    def test_old_failures_do_not_count(self):
        # activity rows are append-only (Postgres triggers refuse UPDATE), so
        # the clock two_factor compares against is moved forward instead.
        secret, _ = self.enrol(self.esi)
        self.fail_five_times()
        self.assertTrue(two_factor.too_many_failures(self.esi))
        later = timezone.now() + two_factor.FAILURE_WINDOW + timedelta(seconds=1)
        self.assertFalse(two_factor.too_many_failures(self.esi, now=later))
        token = self.password_step("esi@example.com").json()["mfa_token"]
        fake_timezone = mock.Mock(now=mock.Mock(return_value=later))
        with mock.patch("accounts.two_factor.timezone", fake_timezone), self.clock(60):
            response = self.second_step(token, code=pyotp.TOTP(secret).at(self.t0 + 60))
        self.assertEqual(response.status_code, 200)

    def test_other_staffers_failures_do_not_count(self):
        self.enrol(self.esi)
        self.fail_five_times()
        self.assertFalse(two_factor.too_many_failures(self.boss))

    def test_the_second_step_codes_never_reach_the_activity_log(self):
        _, codes = self.enrol(self.esi)
        token = self.password_step("esi@example.com").json()["mfa_token"]
        self.second_step(token, code="654321")
        self.second_step(token, recovery_code="zzzzz-zzzzz")
        dump = "".join(
            f"{e.before}{e.after}{e.summary}" for e in ActivityEvent.objects.all()
        )
        self.assertNotIn("654321", dump)
        self.assertNotIn("zzzzz-zzzzz", dump)


class TwoFactorSettingsTests(TwoFactorBase):
    def setUp(self):
        super().setUp()
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(self.esi, sudo=True)}")

    def test_other_staff_can_turn_it_on_and_off(self):
        setup = self.client.post("/api/accounts/staff/two-factor/setup/", {}, format="json").json()
        with self.clock():
            confirm = self.client.post(
                "/api/accounts/staff/two-factor/setup/confirm/",
                {"code": pyotp.TOTP(setup["secret"]).at(self.t0)}, format="json",
            )
        self.assertEqual(len(confirm.json()["recovery_codes"]), 10)
        self.assertTrue(self.client.get("/api/accounts/staff/two-factor/").json()["enabled"])
        self.assertEqual(self.client.post("/api/accounts/staff/two-factor/disable/", {}, format="json").status_code, 204)
        self.assertFalse(two_factor.is_enabled(self.esi))

    def test_setup_needs_a_recent_password(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(self.esi)}")
        response = self.client.post("/api/accounts/staff/two-factor/setup/", {}, format="json")
        self.assertEqual(response.json()["code"], "sudo_required")

    def test_moving_to_a_new_phone_keeps_the_old_one_working_until_confirmed(self):
        old_secret, _ = self.enrol(self.esi)
        self.client.post("/api/accounts/staff/two-factor/setup/", {}, format="json")
        self.assertTrue(two_factor.is_enabled(self.esi))
        with self.clock(60):
            self.assertTrue(two_factor.verify(self.esi, pyotp.TOTP(old_secret).at(self.t0 + 60)))

    def test_new_recovery_codes_cancel_the_old_ones(self):
        _, old = self.enrol(self.esi)
        new = self.client.post("/api/accounts/staff/two-factor/recovery-codes/", {}, format="json").json()["recovery_codes"]
        self.assertFalse(two_factor.use_recovery_code(self.esi, old[0]))
        self.assertTrue(two_factor.use_recovery_code(self.esi, new[0]))

    def test_a_super_admin_cannot_turn_it_off(self):
        self.enrol(self.boss)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(self.boss, sudo=True)}")
        self.assertEqual(self.client.post("/api/accounts/staff/two-factor/disable/", {}, format="json").status_code, 400)
        self.assertTrue(two_factor.is_enabled(self.boss))

    def test_a_super_admin_resets_someone_who_lost_their_phone(self):
        self.enrol(self.esi)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(self.boss, sudo=True)}")
        response = self.client.post(f"/api/accounts/staff/{self.esi.id}/two-factor/reset/", {}, format="json")
        self.assertEqual(response.status_code, 204)
        self.assertFalse(two_factor.is_enabled(self.esi))

    def test_the_server_command_resets_a_locked_out_super_admin(self):
        self.enrol(self.boss)
        call_command("reset_staff_two_factor", "boss@example.com", stdout=io.StringIO())
        self.assertFalse(two_factor.is_enabled(self.boss))
        self.assertEqual(two_factor.challenge_for(self.boss), two_factor.ENROL)


class TwoFactorThrottleTests(TwoFactorBase):
    def test_two_factor_endpoints_have_their_own_throttle_scope(self):
        from accounts import views

        for name in (
            "StaffLoginTwoFactorView", "StaffTwoFactorEnrolStartView", "StaffTwoFactorEnrolConfirmView",
            "StaffTwoFactorSetupView", "StaffTwoFactorSetupConfirmView", "StaffRecoveryCodesView",
            "StaffTwoFactorDisableView", "StaffTwoFactorResetView",
        ):
            self.assertEqual(getattr(views, name).throttle_scope, "two_factor", name)
        self.assertEqual(views.StaffLoginView.throttle_scope, "login")


class ChallengeBindingTests(TwoFactorBase):
    URL_START = "/api/accounts/staff/two-factor/enrol/start/"
    URL_CONFIRM = "/api/accounts/staff/two-factor/enrol/confirm/"

    def test_an_enrol_token_is_dead_once_enrolment_is_confirmed(self):
        enrol_token = self.password_step("boss@example.com").json()["mfa_token"]
        secret, _ = self.enrol(self.boss)
        sessions_before = StaffSession.objects.count()
        start = self.client.post(self.URL_START, {"mfa_token": enrol_token}, format="json")
        with self.clock(60):
            confirm = self.client.post(
                self.URL_CONFIRM, {"mfa_token": enrol_token, "code": pyotp.TOTP(secret).at(self.t0 + 60)}, format="json"
            )
        self.assertEqual(start.status_code, 400)
        self.assertEqual(confirm.status_code, 400)
        self.assertEqual(StaffSession.objects.count(), sessions_before)

    def test_a_verify_token_is_dead_once_two_factor_is_off(self):
        self.enrol(self.esi)
        token = self.password_step("esi@example.com").json()["mfa_token"]
        two_factor.disable(self.esi)
        self.assertEqual(self.second_step(token, code="123456").status_code, 400)
        self.assertIsNone(two_factor.read_challenge(token, two_factor.VERIFY))

    def test_a_verify_token_is_dead_after_a_password_change(self):
        secret, _ = self.enrol(self.esi)
        token = self.password_step("esi@example.com").json()["mfa_token"]
        StaffUser.objects.filter(pk=self.esi.pk).update(password_hash=make_password("another-pass-9"))
        with self.clock(60):
            response = self.second_step(token, code=pyotp.TOTP(secret).at(self.t0 + 60))
        self.assertEqual(response.status_code, 400)

    def test_tokens_are_dead_after_a_password_reset_confirm(self):
        secret, _ = self.enrol(self.esi)
        verify_token = self.password_step("esi@example.com").json()["mfa_token"]
        enrol_token = self.password_step("boss@example.com").json()["mfa_token"]
        for staff in (self.esi, self.boss):
            PasswordResetToken.objects.create(
                token=f"reset-{staff.pk}", account_type="staff", account_id=staff.pk,
                expires_at=timezone.now() + timedelta(hours=1),
            )
            done = self.client.post(
                "/api/accounts/password-reset/confirm/",
                {"token": f"reset-{staff.pk}", "account_type": "staff", "password": "brand-new-pass-1"}, format="json",
            )
            self.assertEqual(done.status_code, 200, done.content)
        with self.clock(60):
            self.assertEqual(
                self.second_step(verify_token, code=pyotp.TOTP(secret).at(self.t0 + 60)).status_code, 400
            )
        self.assertEqual(self.client.post(self.URL_START, {"mfa_token": enrol_token}, format="json").status_code, 400)


class ActivationTwoFactorTests(TwoFactorBase):
    def invitee(self, role, email):
        return _make_staff(
            role, email, password_hash="", invite_token=f"inv-{role}",
            invite_expires_at=timezone.now() + timedelta(days=1),
        )

    def activate(self, role):
        return self.client.post(
            "/api/accounts/staff/activate/", {"token": f"inv-{role}", "password": PASSWORD}, format="json"
        )

    def test_a_super_admin_invitee_gets_no_session_until_two_factor_is_set_up(self):
        self.invitee("super_admin", "newboss@example.com")
        before = StaffSession.objects.count()
        body = self.activate("super_admin").json()
        self.assertNotIn("token", body)
        self.assertEqual(body["status"], "activated")
        self.assertTrue(body["two_factor_setup_required"])
        self.assertEqual(StaffSession.objects.count(), before)
        start = self.client.post(
            "/api/accounts/staff/two-factor/enrol/start/", {"mfa_token": body["mfa_token"]}, format="json"
        )
        self.assertEqual(start.status_code, 200)

    def test_other_invitees_activate_as_before(self):
        self.invitee("support", "newsupport@example.com")
        body = self.activate("support").json()
        self.assertEqual(set(body), {"status", "token"})
        self.assertEqual(body["status"], "activated")


class DecryptFailureTests(TwoFactorBase):
    DETAIL = "Your 2-step sign-in can't be checked right now. Ask a Super Admin to reset it."
    OTHER_KEY = "Zm9vYmFyZm9vYmFyZm9vYmFyZm9vYmFyZm9vYmFyMTI="

    def test_a_changed_key_answers_400_not_500(self):
        secret, _ = self.enrol(self.esi)
        token = self.password_step("esi@example.com").json()["mfa_token"]
        with override_settings(STAFF_SECRETS_KEY=self.OTHER_KEY), self.clock(60):
            with self.assertLogs("accounts.two_factor", level="CRITICAL"):
                response = self.second_step(token, code=pyotp.TOTP(secret).at(self.t0 + 60))
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["detail"], self.DETAIL)

    def test_a_changed_key_answers_400_when_confirming_a_pending_secret(self):
        two_factor.begin_enrolment(self.esi)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(self.esi, sudo=True)}")
        with override_settings(STAFF_SECRETS_KEY=self.OTHER_KEY), self.assertLogs("accounts.two_factor", level="CRITICAL"):
            response = self.client.post("/api/accounts/staff/two-factor/setup/confirm/", {"code": "123456"}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["detail"], self.DETAIL)

    def test_the_settings_reject_a_key_that_is_not_a_fernet_key(self):
        from cryptography.fernet import Fernet

        with self.assertRaises(ValueError):
            Fernet(b"not-a-key")  # the shape settings.py now turns into ImproperlyConfigured


class MinorTests(TwoFactorBase):
    def test_non_string_inputs_are_a_400_not_a_500(self):
        self.enrol(self.esi)
        token = self.password_step("esi@example.com").json()["mfa_token"]
        self.assertEqual(self.second_step(1).status_code, 400)
        self.assertEqual(self.second_step(token, recovery_code=12345).status_code, 400)
        self.assertEqual(self.second_step(token, code=["1"]).status_code, 400)
        self.assertEqual(self.second_step(token, code={"a": 1}).status_code, 400)

    def test_the_command_emails_the_staffer(self):
        self.enrol(self.boss)
        mail.outbox.clear()
        with self.captureOnCommitCallbacks(execute=True):
            call_command("reset_staff_two_factor", "BOSS@example.com", stdout=io.StringIO())
        self.assertEqual([m.to for m in mail.outbox], [["boss@example.com"]])
        self.assertTrue(ActivityEvent.objects.filter(verb="staff.two_factor_reset").exists())

    def test_changes_email_the_staffer_once_committed(self):
        self.enrol(self.esi)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(self.esi, sudo=True)}")
        mail.outbox.clear()
        with self.captureOnCommitCallbacks(execute=True):
            self.client.post("/api/accounts/staff/two-factor/disable/", {}, format="json")
        self.assertEqual([m.to for m in mail.outbox], [["esi@example.com"]])


class ResetGuardTests(TwoFactorBase):
    def url(self, staff):
        return f"/api/accounts/staff/{staff.id}/two-factor/reset/"

    def test_resetting_yourself_is_refused(self):
        self.enrol(self.boss)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(self.boss, sudo=True)}")
        self.assertEqual(self.client.post(self.url(self.boss), {}, format="json").status_code, 400)
        self.assertTrue(two_factor.is_enabled(self.boss))

    def test_without_staff_manage_it_is_forbidden(self):
        other = make_staff("support", "other@example.com")
        self.enrol(other)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(self.esi, sudo=True)}")
        self.assertEqual(self.client.post(self.url(other), {}, format="json").status_code, 403)
        self.assertTrue(two_factor.is_enabled(other))

    def test_without_a_recent_password_it_is_sudo_required(self):
        self.enrol(self.esi)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(self.boss)}")
        response = self.client.post(self.url(self.esi), {}, format="json")
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["code"], "sudo_required")
        self.assertTrue(two_factor.is_enabled(self.esi))
