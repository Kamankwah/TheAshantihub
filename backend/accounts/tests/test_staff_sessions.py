from datetime import timedelta

from django.contrib.auth.hashers import make_password
from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import AccessToken

from accounts import sessions
from accounts.authentication import issue_token
from accounts.models import Customer, PasswordResetToken, StaffSession
from accounts.tasks import cleanup_staff_sessions
from accounts.testing import make_staff, session_of, staff_token

PASSWORD = "correct-horse-1"
HASHED = make_password(PASSWORD)


def staff(role, email, **extra):
    return make_staff(role, email, password_hash=HASHED, **extra)


class StaffSessionTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.esi = staff("support", "esi@example.com")
        self.boss = staff("super_admin", "boss@example.com")

    def use(self, token):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")

    def me(self):
        return self.client.get("/api/accounts/me/")

    def test_sign_in_opens_a_session_named_by_the_token(self):
        response = self.client.post(
            "/api/accounts/staff/login/", {"identifier": "esi@example.com", "password": PASSWORD}, format="json",
            HTTP_USER_AGENT="Mozilla/5.0 (Linux; Android 14; SM-A146B) AppleWebKit/537.36 Chrome/129.0 Mobile Safari/537.36",
            HTTP_X_REAL_IP="154.160.24.91",
        )
        session = session_of(response.json()["token"])
        self.assertEqual(session.staff, self.esi)
        self.assertEqual(session.device_label, "Chrome on Android device")
        self.assertEqual(session.ip, "154.160.24.91")
        self.assertIsNone(session.revoked_at)

    def test_customer_tokens_open_no_session(self):
        customer = Customer.objects.create(full_name="Yaw Mensah", phone="0240000001", password_hash="x")
        issue_token(customer, "customer")
        self.assertFalse(StaffSession.objects.exists())

    def test_a_token_with_no_session_is_refused(self):
        # Review Focus 2: every staff token minted before this release has no
        # session row behind it.
        token = AccessToken()
        token["sub"] = str(self.esi.pk)
        token["account_type"] = "staff"
        self.use(str(token))
        self.assertEqual(self.me().status_code, 401)

    def test_a_refused_token_says_why(self):
        token = issue_token(self.esi, "staff")
        self.use(token)
        session = session_of(token)
        sessions.revoke(session, StaffSession.SIGNED_OUT)
        response = self.me()
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["detail"], sessions.ENDED_MESSAGE)

    def test_a_token_with_no_session_row_says_the_session_ended(self):
        token = AccessToken()
        token["sub"] = str(self.esi.pk)
        token["account_type"] = "staff"
        self.use(str(token))
        response = self.me()
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["detail"], sessions.ENDED_MESSAGE)

    def test_no_credentials_keeps_the_generic_message(self):
        response = self.client.get("/api/accounts/staff/")
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["detail"], "Authentication credentials were not provided.")

    def test_thirty_minutes_idle_ends_the_session(self):
        token = issue_token(self.esi, "staff")
        StaffSession.objects.update(last_seen_at=timezone.now() - timedelta(minutes=31))
        self.use(token)
        self.assertEqual(self.me().status_code, 401)
        self.assertEqual(session_of(token).revoked_reason, StaffSession.IDLE)

    def test_twelve_hours_ends_even_an_active_session(self):
        token = issue_token(self.esi, "staff")
        StaffSession.objects.update(created_at=timezone.now() - timedelta(hours=12, minutes=1))
        self.use(token)
        self.assertEqual(self.me().status_code, 401)
        self.assertEqual(session_of(token).revoked_reason, StaffSession.EXPIRED)

    def test_last_seen_is_written_at_most_once_a_minute(self):
        token = issue_token(self.esi, "staff")
        recent = timezone.now() - timedelta(seconds=30)
        StaffSession.objects.update(last_seen_at=recent)
        self.use(token)
        self.me()
        self.assertEqual(session_of(token).last_seen_at, recent)
        StaffSession.objects.update(last_seen_at=timezone.now() - timedelta(seconds=90))
        self.me()
        self.assertGreater(session_of(token).last_seen_at, timezone.now() - timedelta(seconds=10))

    def test_sign_out_ends_this_session_only(self):
        first, second = issue_token(self.esi, "staff"), issue_token(self.esi, "staff")
        self.use(first)
        self.assertEqual(self.client.post("/api/accounts/staff/logout/", {}, format="json").status_code, 204)
        self.assertEqual(self.me().status_code, 401)
        self.assertEqual(session_of(first).revoked_reason, StaffSession.SIGNED_OUT)
        self.use(second)
        self.assertEqual(self.me().status_code, 200)

    def test_suspension_and_deactivation_end_every_session(self):
        tokens = [issue_token(self.esi, "staff") for _ in range(2)]
        self.use(staff_token(self.boss, sudo=True))
        self.client.post(f"/api/accounts/staff/{self.esi.id}/suspend/", {"reason": "investigation"}, format="json")
        self.assertEqual({session_of(t).revoked_reason for t in tokens}, {StaffSession.SUSPENDED})
        self.client.post(f"/api/accounts/staff/{self.esi.id}/unsuspend/", {}, format="json")
        token = issue_token(self.esi, "staff")
        self.client.post(f"/api/accounts/staff/{self.esi.id}/deactivate/", {}, format="json")
        self.assertEqual(session_of(token).revoked_reason, StaffSession.DEACTIVATED)

    def test_a_password_reset_ends_every_staff_session(self):
        token = issue_token(self.esi, "staff")
        PasswordResetToken.objects.create(
            account_type="staff", account_id=self.esi.id, token="r" * 43,
            expires_at=timezone.now() + timedelta(hours=1),
        )
        response = APIClient().post(
            "/api/accounts/password-reset/confirm/",
            {"token": "r" * 43, "account_type": "staff", "password": "a-new-password-9"}, format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(session_of(token).revoked_reason, StaffSession.PASSWORD_RESET)

    def test_the_test_helper_can_unlock_sudo(self):
        self.assertGreater(session_of(staff_token(self.esi, sudo=True)).sudo_until, timezone.now())
        self.assertIsNone(session_of(staff_token(self.esi)).sudo_until)

    def test_the_roster_shows_last_sign_in(self):
        issue_token(self.esi, "staff")
        self.use(staff_token(self.boss))
        rows = {row["id"]: row for row in self.client.get("/api/accounts/staff/").json()["results"]}
        self.assertIsNotNone(rows[self.esi.id]["last_sign_in_at"])


class SessionCleanupTests(TestCase):
    def test_cleanup_ends_stale_sessions_and_forgets_old_ones(self):
        member = staff("support", "esi@example.com")
        now = timezone.now()
        idle = StaffSession.objects.create(staff=member, jti="a" * 32, last_seen_at=now - timedelta(hours=1))
        old = StaffSession.objects.create(
            staff=member, jti="b" * 32, created_at=now - timedelta(days=91), last_seen_at=now - timedelta(days=91)
        )
        live = StaffSession.objects.create(staff=member, jti="c" * 32)
        cleanup_staff_sessions()
        idle.refresh_from_db()
        live.refresh_from_db()
        self.assertEqual(idle.revoked_reason, StaffSession.IDLE)
        self.assertIsNone(live.revoked_at)
        self.assertFalse(StaffSession.objects.filter(pk=old.pk).exists())

    def test_cleanup_ends_a_session_past_twelve_hours_even_if_recently_seen(self):
        member = staff("support", "kojo@example.com")
        now = timezone.now()
        long_lived = StaffSession.objects.create(
            staff=member, jti="d" * 32, created_at=now - timedelta(hours=13), last_seen_at=now
        )
        cleanup_staff_sessions()
        long_lived.refresh_from_db()
        self.assertEqual(long_lived.revoked_reason, StaffSession.EXPIRED)
