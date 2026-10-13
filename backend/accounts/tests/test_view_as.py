"""Step-in ("view as", SA-6): substitution, the read-only guard, the audit
trail and who may be opened. The no-write sweep over every GET endpoint is in
test_view_as_sweep.py."""
from datetime import timedelta

from django.contrib.auth.hashers import make_password
from django.core.cache import caches
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import Permission, Role, StaffSession
from accounts.testing import make_staff, session_of
from activity.models import ActivityEvent
from notifications.models import Notification

PASSWORD = "correct-horse-1"


HASHED = make_password(PASSWORD)


def staff(role, email, full_name=None, **extra):
    person = make_staff(role, email, password_hash=HASHED, **extra)
    if full_name:
        person.full_name = full_name
        person.save(update_fields=["full_name"])
    return person


class ViewAsBase(TestCase):
    def setUp(self):
        caches["realtime"].clear()
        self.client = APIClient()
        self.simon = staff("super_admin", "simon@example.com", full_name="Simon Peter")
        self.ama = staff("operations", "ama@example.com", full_name="Ama Boateng")
        self.kwame = staff("scout", "kwame@example.com", full_name="Kwame Asante", manager=self.ama)
        self.esi = staff("support", "esi@example.com", full_name="Esi Nyarko")
        self.token = issue_token(self.simon, "staff", two_factor=True)
        self.session = session_of(self.token)

    def as_simon(self, token=None):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token or self.token}")

    def start(self, person, token=None):
        self.as_simon(token)
        return self.client.post("/api/accounts/staff/view-as/", {"staff": person.pk}, format="json")

    def get_as(self, person, path, **extra):
        return self.client.get(path, HTTP_X_VIEW_AS=str(person.pk), **extra)

    def events(self, verb):
        return ActivityEvent.objects.filter(verb=verb).order_by("id")


class SubstitutionTests(ViewAsBase):
    def test_a_started_view_sees_the_target_as_request_user(self):
        self.assertEqual(self.start(self.ama).status_code, 201)
        me = self.get_as(self.ama, "/api/accounts/me/").json()
        self.assertEqual(me["id"], self.ama.pk)
        self.assertEqual(me["role"], "operations")
        self.assertEqual(me["full_name"], "Ama Boateng")
        self.assertEqual(set(me["permissions"]), self.ama.effective_permission_codenames())
        # Without the header the same session is the Super Admin again.
        self.assertEqual(self.client.get("/api/accounts/me/").json()["id"], self.simon.pk)

    def test_lists_scope_as_the_target_sees_them(self):
        Notification.objects.create(staff=self.ama, kind="approval_waiting", title="For Ama")
        Notification.objects.create(staff=self.simon, kind="approval_waiting", title="For Simon")
        self.start(self.ama)
        titles = [n["title"] for n in self.get_as(self.ama, "/api/notifications/").json()["results"]]
        self.assertEqual(titles, ["For Ama"])

    def test_a_scout_can_be_opened(self):
        self.assertEqual(self.start(self.kwame).status_code, 201)
        self.assertEqual(self.get_as(self.kwame, "/api/accounts/me/").json()["role"], "scout")

    def test_head_and_options_are_allowed(self):
        self.start(self.ama)
        self.assertEqual(self.client.head("/api/notifications/", HTTP_X_VIEW_AS=str(self.ama.pk)).status_code, 200)
        self.assertEqual(self.client.options("/api/notifications/", HTTP_X_VIEW_AS=str(self.ama.pk)).status_code, 200)

    def test_the_header_needs_a_started_view_for_that_person(self):
        self.as_simon()
        response = self.get_as(self.ama, "/api/accounts/me/")
        self.assertEqual(response.status_code, 403)  # never 401: the client would sign out
        self.assertEqual(response.json()["code"], "view_as_not_started")
        self.start(self.ama)
        response = self.get_as(self.esi, "/api/accounts/me/")
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["code"], "view_as_not_started")

    def test_a_garbage_header_is_refused(self):
        self.start(self.ama)
        for value in ("abc", "-1", f"{self.ama.pk} ", "9" * 30):
            response = self.client.get("/api/accounts/me/", HTTP_X_VIEW_AS=value)
            if value.strip() == str(self.ama.pk):
                self.assertEqual(response.status_code, 200)
            else:
                self.assertEqual(response.status_code, 403, value)

    def test_the_header_is_ignored_for_everyone_but_a_super_admin(self):
        ama_token = issue_token(self.ama, "staff", two_factor=True)
        StaffSession.objects.filter(pk=session_of(ama_token).pk).update(view_as_target=self.kwame)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {ama_token}")
        self.assertEqual(self.get_as(self.kwame, "/api/accounts/me/").json()["id"], self.ama.pk)
        # ... and a write carrying it goes ahead as Ama herself.
        response = self.client.post("/api/notifications/read-all/", {}, format="json", HTTP_X_VIEW_AS=str(self.kwame.pk))
        self.assertEqual(response.status_code, 200)

    def test_a_target_suspended_mid_view_closes_it(self):
        self.start(self.ama)
        self.ama.is_suspended = True
        self.ama.save(update_fields=["is_suspended"])
        response = self.get_as(self.ama, "/api/accounts/me/")
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["code"], "view_as_refused")

    def test_an_ended_session_is_still_a_401(self):
        self.start(self.ama)
        StaffSession.objects.filter(pk=self.session.pk).update(revoked_at=timezone.now(), revoked_reason="signed_out")
        self.assertEqual(self.get_as(self.ama, "/api/accounts/me/").status_code, 401)

    def test_the_super_admins_own_session_is_kept_alive_and_the_targets_untouched(self):
        ama_token = issue_token(self.ama, "staff")
        long_ago = timezone.now() - timedelta(minutes=10)
        StaffSession.objects.filter(pk__in=[self.session.pk, session_of(ama_token).pk]).update(last_seen_at=long_ago)
        self.start(self.ama)
        self.get_as(self.ama, "/api/accounts/me/")
        self.session.refresh_from_db()
        self.assertGreater(self.session.last_seen_at, long_ago)
        self.assertEqual(session_of(ama_token).last_seen_at, long_ago)


class CrossOriginTests(TestCase):
    @override_settings(CORS_ALLOW_ALL_ORIGINS=False, CORS_ALLOWED_ORIGINS=["https://theashantihub.com"])
    def test_the_browser_may_send_the_step_in_headers_from_the_site(self):
        response = APIClient().options(
            "/api/accounts/me/", HTTP_ORIGIN="https://theashantihub.com", HTTP_ACCESS_CONTROL_REQUEST_METHOD="GET",
            HTTP_ACCESS_CONTROL_REQUEST_HEADERS="authorization, x-view-as, x-view-as-screen",
        )
        allowed = {h.strip() for h in response["Access-Control-Allow-Headers"].lower().split(",")}
        self.assertTrue({"authorization", "x-view-as", "x-view-as-screen"} <= allowed)


class SudoInsideAViewTests(ViewAsBase):
    def test_the_super_admins_password_window_does_not_reach_into_a_view(self):
        from rest_framework.request import Request
        from rest_framework.test import APIRequestFactory

        from accounts import sessions
        from accounts.authentication import MultiAccountJWTAuthentication

        sessions.grant_sudo(self.session)
        self.start(self.ama)

        def request(**headers):
            raw = APIRequestFactory().get("/api/accounts/me/", HTTP_AUTHORIZATION=f"Bearer {self.token}", **headers)
            drf = Request(raw, authenticators=[MultiAccountJWTAuthentication()])
            drf.user  # authenticate
            return drf

        viewing = request(HTTP_X_VIEW_AS=str(self.ama.pk))
        self.assertEqual(viewing.user.pk, self.ama.pk)
        self.assertFalse(sessions.has_sudo(viewing))
        self.assertTrue(sessions.has_sudo(request()))


class ReadOnlyGuardTests(ViewAsBase):
    WRITES = [
        ("post", "/api/accounts/staff/logout/"),
        ("post", "/api/accounts/staff/reauth/"),
        ("post", "/api/accounts/staff/view-as/end/"),
        ("post", "/api/accounts/staff/view-as/"),
        ("post", "/api/notifications/read-all/"),
        ("post", "/api/notifications/1/read/"),
        ("post", "/api/reports/"),
        ("post", "/api/realtime/ticket/"),
        ("post", "/api/approvals/1/approve/"),
        ("post", "/api/accounts/staff/login/"),
        ("patch", "/api/reports/1/"),
        ("put", "/api/targets/limits/"),
        ("delete", "/api/accounts/staff/sessions/1/end/"),
        ("post", "/api/does-not-exist/"),
    ]

    def test_every_write_is_refused_view_only_and_changes_nothing(self):
        self.start(self.ama)
        before = ActivityEvent.objects.count()
        for method, path in self.WRITES:
            response = getattr(self.client, method)(
                path, {"password": PASSWORD, "staff": self.ama.pk}, format="json", HTTP_X_VIEW_AS=str(self.ama.pk)
            )
            self.assertEqual(response.status_code, 403, (method, path))
            self.assertEqual(response.json()["code"], "view_only", (method, path))
        self.assertEqual(ActivityEvent.objects.count(), before)
        self.session.refresh_from_db()
        self.assertIsNone(self.session.revoked_at)  # the refused logout ended nothing
        self.assertIsNone(self.session.sudo_until)  # the refused reauth granted nothing
        self.assertEqual(self.session.view_as_target_id, self.ama.pk)

    def test_a_write_is_refused_even_when_the_view_was_never_started(self):
        self.as_simon()
        response = self.client.post("/api/accounts/staff/logout/", {}, format="json", HTTP_X_VIEW_AS=str(self.ama.pk))
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["code"], "view_only")

    def test_exports_are_refused(self):
        self.start(self.ama)
        for path in ("/api/activity/export/", "/api/reports/export/?period=day", "/api/commission/accruals/?format=csv"):
            response = self.get_as(self.ama, path)
            self.assertEqual(response.status_code, 403, path)
            self.assertEqual(response.json()["code"], "view_only", path)

    def test_without_the_header_the_super_admin_still_writes_as_themselves(self):
        self.start(self.ama)
        self.assertEqual(self.client.post("/api/notifications/read-all/", {}, format="json").status_code, 200)


class AuditTrailTests(ViewAsBase):
    def test_start_and_end_are_recorded_on_behalf_of_the_target(self):
        self.start(self.ama)
        started = self.events("view_as.started").get()
        self.assertEqual((started.actor_id, started.on_behalf_of_id), (self.simon.pk, self.ama.pk))
        self.assertEqual(started.target_id, str(self.ama.pk))
        self.assertEqual(self.client.post("/api/accounts/staff/view-as/end/", {}, format="json").status_code, 200)
        ended = self.events("view_as.ended").get()
        self.assertEqual((ended.actor_id, ended.on_behalf_of_id), (self.simon.pk, self.ama.pk))
        self.session.refresh_from_db()
        self.assertIsNone(self.session.view_as_target_id)
        self.assertEqual(self.get_as(self.ama, "/api/accounts/me/").json()["code"], "view_as_not_started")
        # Ending twice records nothing more.
        self.client.post("/api/accounts/staff/view-as/end/", {}, format="json")
        self.assertEqual(self.events("view_as.ended").count(), 1)

    def test_starting_the_same_view_again_records_nothing_new(self):
        self.start(self.ama)
        self.assertEqual(self.start(self.ama).status_code, 200)
        self.assertEqual(self.events("view_as.started").count(), 1)

    def test_switching_person_ends_one_view_and_starts_the_next(self):
        self.start(self.ama)
        self.start(self.esi)
        self.assertEqual(self.events("view_as.ended").get().on_behalf_of_id, self.ama.pk)
        self.assertEqual([e.on_behalf_of_id for e in self.events("view_as.started")], [self.ama.pk, self.esi.pk])

    def test_one_event_per_screen_opened(self):
        self.start(self.ama)
        for _ in range(3):
            self.get_as(self.ama, "/api/accounts/me/", HTTP_X_VIEW_AS_SCREEN="approvals")
            self.get_as(self.ama, "/api/notifications/staff-badges/", HTTP_X_VIEW_AS_SCREEN="approvals")
        self.get_as(self.ama, "/api/accounts/me/", HTTP_X_VIEW_AS_SCREEN="overview")
        # Back within the minute: not logged twice.
        self.get_as(self.ama, "/api/accounts/me/", HTTP_X_VIEW_AS_SCREEN="approvals")
        pages = list(self.events("view_as.page"))
        self.assertEqual([p.after["screen"] for p in pages], ["approvals", "overview"])
        for page in pages:
            self.assertEqual((page.actor_id, page.on_behalf_of_id, page.method), (self.simon.pk, self.ama.pk, "GET"))

    def test_a_screen_is_logged_again_after_the_minute(self):
        self.start(self.ama)
        self.get_as(self.ama, "/api/accounts/me/", HTTP_X_VIEW_AS_SCREEN="approvals")
        self.get_as(self.ama, "/api/accounts/me/", HTTP_X_VIEW_AS_SCREEN="overview")
        caches["realtime"].delete(f"view-as:page:{self.session.pk}:{self.ama.pk}:approvals")  # the minute passed
        self.get_as(self.ama, "/api/accounts/me/", HTTP_X_VIEW_AS_SCREEN="approvals")
        self.assertEqual([p.after["screen"] for p in self.events("view_as.page")], ["approvals", "overview", "approvals"])

    def test_without_a_screen_name_the_api_area_is_logged(self):
        self.start(self.ama)
        self.get_as(self.ama, "/api/approvals/counts/", HTTP_X_VIEW_AS_SCREEN="<script>")
        self.assertEqual(self.events("view_as.page").get().after["screen"], "approvals")

    def test_a_refused_request_logs_no_page(self):
        self.start(self.ama)
        self.get_as(self.ama, "/api/activity/export/")
        self.assertFalse(self.events("view_as.page").exists())


class WhoMayStepInTests(ViewAsBase):
    def test_only_team_workspaces_can_be_opened(self):
        other_admin = staff("super_admin", "other@example.com")
        rider = staff("dispatch", "rider@example.com")
        suspended = staff("marketing", "akua@example.com", is_suspended=True)
        gone = staff("accountant", "kwabena@example.com", is_active=False)
        invited = staff("delivery_manager", "adwoa@example.com", invite_token="t" * 43)
        for target in (other_admin, self.simon, rider, suspended, gone, invited):
            response = self.start(target)
            self.assertEqual(response.status_code, 400, target.email)
            self.assertEqual(response.json()["code"], "view_as_refused")
        for bad in ({"staff": 0}, {"staff": "x"}, {"staff": True}, {}, {"staff": 10**20}):
            self.as_simon()
            self.assertEqual(self.client.post("/api/accounts/staff/view-as/", bad, format="json").status_code, 400, bad)
        self.assertFalse(self.events("view_as.started").exists())

    def test_cosigners_cannot_be_opened(self):
        if not Role.objects.filter(name="cosigner").exists():
            self.skipTest("no co-signer role seeded")
        cosigner = staff("cosigner", "cosign@example.com")
        self.assertEqual(self.start(cosigner).status_code, 400)

    def test_a_header_naming_another_super_admin_is_refused_even_on_the_session(self):
        other_admin = staff("super_admin", "other@example.com")
        StaffSession.objects.filter(pk=self.session.pk).update(view_as_target=other_admin)
        self.as_simon()
        response = self.get_as(other_admin, "/api/accounts/me/")
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["code"], "view_as_refused")

    def test_two_step_sign_in_is_required(self):
        token = issue_token(self.simon, "staff", two_factor=False)
        response = self.start(self.ama, token=token)
        self.assertEqual(response.status_code, 403)
        StaffSession.objects.filter(pk=session_of(token).pk).update(view_as_target=self.ama)
        self.assertEqual(self.get_as(self.ama, "/api/accounts/me/").status_code, 403)

    def test_the_permission_is_required(self):
        self.simon.revoked_permissions.add(Permission.objects.get(codename="staff.view_as"))
        self.assertEqual(self.start(self.ama).status_code, 403)
        StaffSession.objects.filter(pk=self.session.pk).update(view_as_target=self.ama)
        response = self.get_as(self.ama, "/api/accounts/me/")
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["code"], "view_as_refused")

    def test_granting_the_code_to_anyone_else_does_nothing(self):
        self.ama.extra_permissions.add(Permission.objects.get(codename="staff.view_as"))
        ama_token = issue_token(self.ama, "staff", two_factor=True)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {ama_token}")
        self.assertEqual(self.client.post("/api/accounts/staff/view-as/", {"staff": self.kwame.pk}, format="json").status_code, 403)
        self.assertEqual(self.client.get("/api/accounts/staff/view-as/").status_code, 403)

    def test_only_super_admin_holds_the_permission(self):
        holders = Role.objects.filter(permissions__codename="staff.view_as").values_list("name", flat=True)
        self.assertEqual(list(holders), ["super_admin"])

    def test_the_people_list(self):
        staff("dispatch", "rider@example.com")
        staff("marketing", "gone@example.com", is_active=False)
        self.as_simon()
        body = self.client.get("/api/accounts/staff/view-as/").json()
        self.assertIsNone(body["current"])
        names = [(p["full_name"], p["team"]) for p in body["people"]]
        self.assertEqual(names, [("Ama Boateng", "operations"), ("Kwame Asante", "operations"), ("Esi Nyarko", "support")])
        self.assertEqual(body["people"][1]["manager"], "Ama Boateng")
        self.start(self.ama)
        current = self.client.get("/api/accounts/staff/view-as/").json()["current"]
        self.assertEqual(current["staff"]["id"], self.ama.pk)
        self.assertIsNotNone(current["started_at"])

    def test_the_step_in_endpoints_are_not_reachable_through_a_view(self):
        self.start(self.ama)
        self.assertEqual(self.get_as(self.ama, "/api/accounts/staff/view-as/").status_code, 403)
