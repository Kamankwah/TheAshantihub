from datetime import timedelta

from django.contrib.auth.hashers import make_password
from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import AccessToken

from accounts.authentication import issue_token
from accounts.models import StaffSession
from accounts.testing import make_staff, session_of

PASSWORD = "correct-horse-1"
HASHED = make_password(PASSWORD)


def staff(role, email, **extra):
    return make_staff(role, email, password_hash=HASHED, **extra)


class Base(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.boss = staff("super_admin", "boss@example.com")
        self.esi = staff("support", "esi@example.com")
        self.ama = staff("operations", "ama@example.com")

    def use(self, token):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        return token


class SudoTests(Base):
    def setUp(self):
        super().setUp()
        self.token = self.use(issue_token(self.boss, "staff"))

    def reauth(self, password=PASSWORD):
        return self.client.post("/api/accounts/staff/reauth/", {"password": password}, format="json")

    def suspend(self):
        return self.client.post(f"/api/accounts/staff/{self.esi.id}/suspend/", {"reason": "x"}, format="json")

    def test_suspending_staff_needs_a_recent_password(self):
        refused = self.suspend()
        self.assertEqual(refused.status_code, 403)
        self.assertEqual(refused.json(), {"detail": "Re-enter your password to continue.", "code": "sudo_required"})
        self.assertEqual(self.reauth().status_code, 200)
        self.assertEqual(self.suspend().status_code, 200)

    def test_a_wrong_password_unlocks_nothing(self):
        self.assertEqual(self.reauth("wrong-password").json(), {"password": ["That password isn't right."]})
        self.assertEqual(self.suspend().status_code, 403)

    def test_the_unlock_lasts_ten_minutes(self):
        self.reauth()
        StaffSession.objects.filter(jti=AccessToken(self.token)["jti"]).update(
            sudo_until=timezone.now() - timedelta(seconds=1)
        )
        self.assertEqual(self.suspend().status_code, 403)

    def test_the_unlock_belongs_to_one_session(self):
        self.reauth()
        self.use(issue_token(self.boss, "staff"))
        self.assertEqual(self.suspend().status_code, 403)

    def test_permission_manager_and_deactivation_changes_need_it_too(self):
        cases = [
            (f"/api/accounts/staff/{self.esi.id}/permissions/", {"grant": [], "revoke": []}),
            (f"/api/accounts/staff/{self.esi.id}/manager/", {"manager": self.ama.id}),
            (f"/api/accounts/staff/{self.esi.id}/deactivate/", {}),
        ]
        for url, body in cases:
            self.assertEqual(self.client.post(url, body, format="json").json().get("code"), "sudo_required", url)
        self.reauth()
        for url, body in cases:
            self.assertEqual(self.client.post(url, body, format="json").status_code, 200, url)

    def test_a_missing_role_permission_is_reported_before_sudo(self):
        self.use(issue_token(staff("marketing", "akua@example.com"), "staff"))
        response = self.suspend()
        self.assertEqual(response.status_code, 403)
        self.assertNotIn("code", response.json())


class SessionsApiTests(Base):
    def test_my_sessions_list_marks_this_device(self):
        issue_token(self.esi, "staff")
        self.use(issue_token(self.esi, "staff"))
        rows = self.client.get("/api/accounts/staff/sessions/").json()
        self.assertEqual(len(rows), 2)
        self.assertEqual([row["is_current"] for row in rows].count(True), 1)
        self.assertTrue(all(row["is_active"] for row in rows))

    def test_ending_one_of_my_sessions(self):
        other = issue_token(self.esi, "staff")
        self.use(issue_token(self.esi, "staff"))
        response = self.client.post(f"/api/accounts/staff/sessions/{session_of(other).pk}/end/", {}, format="json")
        self.assertEqual(response.json()["revoked_reason"], StaffSession.ENDED)
        self.use(other)
        self.assertEqual(self.client.get("/api/accounts/me/").status_code, 401)

    def test_cannot_end_someone_elses_session(self):
        boss_session = session_of(issue_token(self.boss, "staff"))
        self.use(issue_token(self.esi, "staff"))
        self.assertEqual(
            self.client.post(f"/api/accounts/staff/sessions/{boss_session.pk}/end/", {}, format="json").status_code, 404
        )

    def test_sign_out_other_devices_keeps_this_one(self):
        for _ in range(2):
            issue_token(self.esi, "staff")
        self.use(issue_token(self.esi, "staff"))
        self.assertEqual(self.client.post("/api/accounts/staff/sessions/end-others/", {}, format="json").json(), {"ended": 2})
        self.assertEqual(self.client.get("/api/accounts/me/").status_code, 200)

    def test_only_staff_manage_sees_someone_elses_sessions(self):
        self.use(issue_token(self.esi, "staff"))
        self.assertEqual(self.client.get(f"/api/accounts/staff/sessions/?staff={self.boss.id}").status_code, 403)
        self.use(issue_token(self.boss, "staff"))
        self.assertEqual(self.client.get(f"/api/accounts/staff/sessions/?staff={self.esi.id}").status_code, 200)

    def test_super_admin_sees_everyone_signed_in_now(self):
        live = issue_token(self.esi, "staff")
        idle = issue_token(self.esi, "staff")
        StaffSession.objects.filter(jti=AccessToken(idle)["jti"]).update(last_seen_at=timezone.now() - timedelta(hours=1))
        self.use(issue_token(self.boss, "staff"))
        rows = self.client.get("/api/accounts/staff/sessions/active/").json()
        self.assertEqual({(row["staff"]["full_name"], row["is_current"]) for row in rows}, {("Esi", False), ("Boss", True)})
        self.use(live)
        self.assertEqual(self.client.get("/api/accounts/staff/sessions/active/").status_code, 403)

    def test_super_admin_signs_someone_out_everywhere(self):
        tokens = [issue_token(self.esi, "staff") for _ in range(2)]
        self.use(issue_token(self.boss, "staff"))
        response = self.client.post(f"/api/accounts/staff/{self.esi.id}/sign-out-everywhere/", {}, format="json")
        self.assertEqual(response.json(), {"ended": 2})
        self.assertEqual({session_of(t).revoked_reason for t in tokens}, {StaffSession.SIGNED_OUT_EVERYWHERE})
        self.assertEqual(
            self.client.post(f"/api/accounts/staff/{self.boss.id}/sign-out-everywhere/", {}, format="json").status_code, 400
        )
