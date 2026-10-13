from datetime import timedelta

from django.utils import timezone

from accounts.models import StaffSession
from accounts.testing import session_of, staff_token

from .base import PeopleTestCase

URL = "/api/people/sessions/"


class SessionsOverviewTests(PeopleTestCase):
    def test_lists_live_sessions_of_everyone_with_the_kpis(self):
        mine = staff_token(self.boss)
        theirs = staff_token(self.ama)
        staff_token(self.kojo)
        StaffSession.objects.filter(pk=session_of(theirs).pk).update(two_factor=True)
        stale = staff_token(self.esi)
        StaffSession.objects.filter(pk=session_of(stale).pk).update(last_seen_at=timezone.now() - timedelta(hours=1))
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {mine}")
        data = self.client.get(URL).json()
        self.assertEqual(data["kpis"]["sessions"], 3)
        self.assertEqual(data["kpis"]["people"], 3)
        self.assertEqual(data["kpis"]["with_two_step"], 1)
        self.assertEqual(sum(1 for s in data["sessions"] if s["is_current"]), 1)
        self.assertEqual(data["rules"]["idle_minutes"], 30)
        self.assertEqual(data["rules"]["longest_hours"], 12)
        self.assertNotIn("Esi", [s["staff"]["full_name"] for s in data["sessions"]])

    def test_flags_a_new_kind_of_device_only_when_there_is_history(self):
        StaffSession.objects.create(staff=self.kwame, jti="old", device_label="Chrome on Android device", created_at=timezone.now() - timedelta(days=3))
        StaffSession.objects.create(staff=self.kwame, jti="new", device_label="Safari on iPhone")
        StaffSession.objects.create(staff=self.esi, jti="first", device_label="Chrome on Windows computer")
        self.sign_in()
        sessions = {s["staff"]["full_name"]: s for s in self.client.get(URL).json()["sessions"]}
        self.assertTrue(sessions["Kwame"]["new_device"])
        self.assertFalse(sessions["Esi"]["new_device"])

    def test_needs_staff_manage(self):
        self.sign_in(self.ama)
        self.assertEqual(self.client.get(URL).status_code, 403)


class SignOutEveryoneTests(PeopleTestCase):
    def test_needs_the_password_then_ends_everyone_else_but_keeps_this_session(self):
        other = session_of(staff_token(self.ama))
        self.sign_in()
        self.assertEqual(self.client.post(URL + "sign-out-all/", {}, format="json").json()["code"], "sudo_required")
        self.sign_in(sudo=True)
        mine = StaffSession.objects.filter(staff=self.boss, revoked_at__isnull=True).latest("id")
        response = self.client.post(URL + "sign-out-all/", {}, format="json")
        self.assertEqual(response.json(), {"ended": 1, "people": 1})
        other.refresh_from_db()
        self.assertEqual(other.revoked_reason, StaffSession.SIGNED_OUT_EVERYWHERE)
        mine.refresh_from_db()
        self.assertIsNone(mine.revoked_at)
