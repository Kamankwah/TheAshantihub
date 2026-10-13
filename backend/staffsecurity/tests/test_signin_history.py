from datetime import timedelta

import pyotp
from django.utils import timezone

from accounts import sessions, two_factor
from accounts.models import StaffSession
from activity.models import ActivityEvent
from staffsecurity import signin
from staffsecurity.models import StaffSignInRecord as Line

from .base import PASSWORD, SecurityBase

PHONE = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36"


class WritingTests(SecurityBase):
    def test_a_sign_in_and_a_sign_out_are_written_with_device_and_address(self):
        response = self.login("esi@example.com", HTTP_USER_AGENT=PHONE, HTTP_X_REAL_IP="154.160.24.91")
        self.assertEqual(response.status_code, 200)
        line = Line.objects.get()
        self.assertEqual((line.kind, line.staff, line.ip, line.two_factor), ("signed_in", self.esi, "154.160.24.91", False))
        self.assertEqual(line.device_label, "Chrome on Android device")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {response.json()['token']}")
        self.client.post("/api/accounts/staff/logout/")
        self.assertEqual(list(Line.objects.order_by("id").values_list("kind", flat=True)), ["signed_in", "signed_out"])

    def test_a_wrong_password_is_written_without_the_password_or_the_full_address(self):
        response = self.login("esi@example.com", "not-the-password-9")
        self.assertEqual(response.status_code, 400)
        line = Line.objects.get()
        self.assertEqual((line.kind, line.staff), ("sign_in_failed", self.esi))
        self.assertEqual(line.identifier_masked, "es***@example.com")
        stored = " ".join(str(v) for v in Line.objects.values().get().values())
        self.assertNotIn("not-the-password-9", stored)
        self.assertNotIn("esi@example.com", stored)

    def test_the_answer_is_the_same_for_an_address_nobody_holds(self):
        known = self.login("esi@example.com", "wrong-password-1")
        unknown = self.login("nobody@example.com", "wrong-password-1")
        self.assertEqual((known.status_code, known.json()), (unknown.status_code, unknown.json()))
        self.assertEqual(Line.objects.count(), 2)
        self.assertEqual(Line.objects.filter(staff__isnull=True).get().identifier_masked, "no***@example.com")

    def test_a_suspended_account_with_the_right_password_is_written_as_refused(self):
        self.esi.is_suspended = True
        self.esi.save()
        self.assertEqual(self.login("esi@example.com").status_code, 400)
        self.assertEqual(Line.objects.get().note, "Account suspended")

    def test_a_non_text_address_does_not_break_the_sign_in(self):
        response = self.client.post("/api/accounts/staff/login/", {"identifier": ["a"], "password": 1}, format="json")
        self.assertEqual(response.status_code, 400)

    def test_two_step_results_are_written(self):
        secret, _ = two_factor.begin_enrolment(self.esi)
        with self.clock():
            two_factor.confirm_enrolment(self.esi, pyotp.TOTP(secret).at(self.t0))
        challenge = self.login("esi@example.com").json()["mfa_token"]
        self.client.post("/api/accounts/staff/login/two-factor/", {"mfa_token": challenge, "code": "000000"}, format="json")
        with self.clock(60):
            ok = self.client.post("/api/accounts/staff/login/two-factor/", {"mfa_token": challenge, "code": pyotp.TOTP(secret).at(self.t0 + 60)}, format="json")
        self.assertEqual(ok.status_code, 200, ok.content)
        kinds = list(Line.objects.order_by("id").values_list("kind", "two_factor"))
        self.assertEqual(kinds, [("two_step_failed", False), ("signed_in", True)])

    def test_password_re_entry_is_written_both_ways(self):
        self.as_staff(self.boss)
        self.client.post("/api/accounts/staff/reauth/", {"password": "wrong"}, format="json")
        self.client.post("/api/accounts/staff/reauth/", {"password": PASSWORD}, format="json")
        self.assertEqual(list(Line.objects.order_by("id").values_list("kind", flat=True)), ["password_reentry_failed", "password_reentered"])

    def test_a_timeout_is_written_once(self):
        self.as_staff(self.esi)
        StaffSession.objects.update(last_seen_at=timezone.now() - timedelta(minutes=31))
        self.assertEqual(self.client.get("/api/accounts/staff/sessions/").status_code, 401)
        self.client.get("/api/accounts/staff/sessions/")
        sessions.cleanup()
        line = Line.objects.get()
        self.assertEqual((line.kind, line.note, line.staff), ("timed_out", "30 minutes without activity", self.esi))

    def test_the_sweep_writes_the_timeouts_it_ends(self):
        self.as_staff(self.esi)
        StaffSession.objects.update(created_at=timezone.now() - timedelta(hours=13))
        sessions.cleanup()
        self.assertEqual(Line.objects.get().note, "12-hour limit reached")

    def test_a_failed_write_never_breaks_the_caller(self):
        self.assertIsNone(signin.log("not-a-kind" * 20, None))

    def test_masking(self):
        self.assertEqual(signin.mask_identifier("kofi@example.com"), "ko***@example.com")
        self.assertEqual(signin.mask_identifier("a@b.co"), "a***@b.co")
        self.assertEqual(signin.mask_identifier(None), "")
        self.assertEqual(signin.mask_identifier("x" * 500), "xx***")


class ReadingTests(SecurityBase):
    def test_only_a_holder_of_the_permission_reads_it(self):
        for staff in (self.esi, self.ama):
            self.as_staff(staff)
            self.assertEqual(self.client.get("/api/staff-security/sign-ins/").status_code, 403)
        self.assertEqual(self.client.get("/api/staff-security/sign-ins/").status_code, 403)

    def test_it_lists_filters_and_summarises(self):
        self.login("esi@example.com")
        self.login("esi@example.com", "wrong-password-1")
        self.login("ghost@example.com", "wrong-password-1")
        self.as_staff(self.boss)
        body = self.client.get("/api/staff-security/sign-ins/").json()
        self.assertEqual(body["count"], 3)
        self.assertEqual((body["summary"]["signed_in_24h"], body["summary"]["refused_24h"]), (1, 2))
        self.assertIsNotNone(body["history_starts"])
        self.assertEqual(sorted(a["attempts"] for a in body["failed_recent"]), [1, 1])
        only = self.client.get("/api/staff-security/sign-ins/?kind=sign_in_failed").json()
        self.assertEqual(only["count"], 2)
        mine = self.client.get(f"/api/staff-security/sign-ins/?staff={self.esi.pk}").json()
        self.assertEqual(mine["count"], 2)
        self.assertEqual(self.client.get("/api/staff-security/sign-ins/?since=2000-01-01").json()["count"], 3)
        self.assertEqual(self.client.get("/api/staff-security/sign-ins/?since=2999-01-01").json()["count"], 0)
        self.assertEqual(self.client.get("/api/staff-security/sign-ins/?staff=abc").status_code, 400)
        self.assertEqual(self.client.get("/api/staff-security/sign-ins/?since=nope").status_code, 400)

    def test_with_no_lines_the_history_has_not_started(self):
        self.as_staff(self.boss)
        body = self.client.get("/api/staff-security/sign-ins/").json()
        self.assertEqual((body["count"], body["history_starts"]), (0, None))

    def test_no_endpoint_edits_or_removes_a_line(self):
        self.login("esi@example.com")
        line = Line.objects.get()
        self.as_staff(self.boss, sudo=True)
        for method in (self.client.post, self.client.put, self.client.patch, self.client.delete):
            self.assertEqual(method(f"/api/staff-security/sign-ins/{line.pk}/").status_code, 404)
        self.assertEqual(self.client.delete("/api/staff-security/sign-ins/").status_code, 405)
        self.assertEqual(Line.objects.count(), 1)
        self.assertFalse(ActivityEvent.objects.filter(verb="staff.signed_in").exclude(actor_id=self.esi.pk).exists())


class CoalesceAndRetentionTests(SecurityBase):
    def test_repeated_failures_from_one_identifier_and_address_become_one_counted_line(self):
        for _ in range(3):
            self.login("esi@example.com", "wrong-password-1", HTTP_X_REAL_IP="154.160.24.91")
        line = Line.objects.get()
        self.assertEqual((line.kind, line.attempts), ("sign_in_failed", 3))
        # a different address (or identifier) is its own line
        self.login("esi@example.com", "wrong-password-1", HTTP_X_REAL_IP="154.160.24.92")
        self.login("kojo@example.com", "wrong-password-1", HTTP_X_REAL_IP="154.160.24.91")
        self.assertEqual(Line.objects.count(), 3)

    def test_a_failure_after_the_window_starts_a_new_line(self):
        self.login("esi@example.com", "wrong-password-1", HTTP_X_REAL_IP="154.160.24.91")
        Line.objects.update(at=timezone.now() - signin.COALESCE_WINDOW - timedelta(minutes=1))
        self.login("esi@example.com", "wrong-password-1", HTTP_X_REAL_IP="154.160.24.91")
        self.assertEqual(Line.objects.count(), 2)

    def test_successes_are_never_coalesced(self):
        self.login("esi@example.com", HTTP_X_REAL_IP="154.160.24.91")
        self.login("esi@example.com", HTTP_X_REAL_IP="154.160.24.91")
        self.assertEqual(Line.objects.filter(kind="signed_in").count(), 2)

    def test_the_nightly_job_purges_lines_older_than_400_days_only(self):
        from staffsecurity.tasks import purge_old_sign_in_records

        old = Line.objects.create(kind="signed_in", at=timezone.now() - timedelta(days=401))
        edge = Line.objects.create(kind="signed_in", at=timezone.now() - timedelta(days=399))
        self.assertEqual(purge_old_sign_in_records(), 1)
        self.assertFalse(Line.objects.filter(pk=old.pk).exists())
        self.assertTrue(Line.objects.filter(pk=edge.pk).exists())

    def test_the_purge_is_a_scheduled_job_so_it_gets_a_heartbeat(self):
        from core.jobs import scheduled_task_names

        self.assertIn("staffsecurity.tasks.purge_old_sign_in_records", scheduled_task_names())
