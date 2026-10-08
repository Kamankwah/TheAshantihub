import json
from datetime import timedelta

from django.contrib.auth.hashers import make_password
from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import AccessToken

from accounts import sessions
from accounts.authentication import issue_token
from accounts.models import StaffSession
from accounts.testing import make_staff, session_of
from activity.models import ActivityEvent

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


class SessionScopingTests(Base):
    def end(self, session):
        return self.client.post(f"/api/accounts/staff/sessions/{session.pk}/end/", {}, format="json")

    def test_staff_manage_can_end_another_staffers_session(self):
        esi_session = session_of(issue_token(self.esi, "staff"))
        boss_token = self.use(issue_token(self.boss, "staff"))
        response = self.end(esi_session)
        self.assertEqual(response.status_code, 200)
        esi_session.refresh_from_db()
        self.assertIsNotNone(esi_session.revoked_at)
        self.assertIsNone(session_of(boss_token).revoked_at)

    def test_ending_my_own_current_session(self):
        token = self.use(issue_token(self.esi, "staff"))
        response = self.end(session_of(token))
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["is_current"])
        self.assertFalse(response.json()["is_active"])
        self.assertEqual(self.client.get("/api/accounts/me/").status_code, 401)

    def test_end_others_leaves_other_staffers_sessions_live(self):
        boss_session = session_of(issue_token(self.boss, "staff"))
        issue_token(self.esi, "staff")
        self.use(issue_token(self.esi, "staff"))
        self.client.post("/api/accounts/staff/sessions/end-others/", {}, format="json")
        boss_session.refresh_from_db()
        self.assertIsNone(boss_session.revoked_at)

    def test_my_list_excludes_other_staffers_sessions(self):
        boss_session = session_of(issue_token(self.boss, "staff"))
        self.use(issue_token(self.esi, "staff"))
        ids = [row["id"] for row in self.client.get("/api/accounts/staff/sessions/").json()]
        self.assertEqual(len(ids), 1)
        self.assertNotIn(boss_session.pk, ids)

    def test_non_manager_cannot_end_others_and_the_404_is_indistinguishable(self):
        boss_session = session_of(issue_token(self.boss, "staff"))
        self.use(issue_token(self.esi, "staff"))
        real = self.end(boss_session)
        missing = self.client.post("/api/accounts/staff/sessions/999999999/end/", {}, format="json")
        self.assertEqual(real.status_code, 404)
        self.assertEqual(real.json(), missing.json())
        boss_session.refresh_from_db()
        self.assertIsNone(boss_session.revoked_at)


class LiveSessionBoundaryTests(Base):
    def test_live_and_end_reason_agree_at_the_limits(self):
        now = timezone.now()
        for field, limit in (("last_seen_at", sessions.IDLE_LIMIT), ("created_at", sessions.ABSOLUTE_LIMIT)):
            for offset, expect_live in ((timedelta(0), True), (timedelta(seconds=1), False)):
                session = session_of(issue_token(self.esi, "staff"))
                values = {"created_at": now, "last_seen_at": now}
                values[field] = now - limit - offset
                StaffSession.objects.filter(pk=session.pk).update(**values)
                session.refresh_from_db()
                listed = sessions.live(StaffSession.objects.filter(pk=session.pk), now).exists()
                accepted = sessions.end_reason_if_invalid(session, now) is None
                self.assertEqual((listed, accepted), (expect_live, expect_live), (field, offset))


class ReauthRedactionTests(Base):
    def test_reauth_is_logged_without_the_password(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.boss, 'staff')}")
        self.client.post("/api/accounts/staff/reauth/", {"password": PASSWORD}, format="json")
        event = ActivityEvent.objects.get(verb="staff-reauth")
        self.assertNotIn(PASSWORD, json.dumps([event.before, event.after, event.summary]))
