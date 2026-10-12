from datetime import timedelta

from django.core import mail
from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import StaffUser
from accounts.testing import make_staff, staff_token
from activity.models import ActivityEvent
from listings.models import Zone
from portfolio.areas import scout_areas
from portfolio.tests.health_fixtures import make_business

URL = "/api/operations/invites/"


class InviteScreenTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.admin = make_staff("super_admin", "root@example.com")
        self.lead = make_staff("operations", "ama@example.com")
        self.other_lead = make_staff("operations", "kojo@example.com")

    def as_(self, who, sudo=True):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(who, sudo=sudo)}")

    def invite(self, **extra):
        body = {"full_name": "Akwasi Bonsu", "email": "akwasi@example.com", "role": "scout", **extra}
        return self.client.post("/api/accounts/staff/invite/", body, format="json")

    def zone(self, name):
        return Zone.objects.get(name=name)

    def test_an_invite_can_carry_a_start_date_and_areas_for_a_scout(self):
        self.as_(self.lead)
        start = (timezone.localdate() + timedelta(days=5)).isoformat()
        response = self.invite(start_date=start, areas=[self.zone("Bantama").pk, self.zone("Suame").pk])
        self.assertEqual(response.status_code, 201, response.content)
        staff = StaffUser.objects.get(email="akwasi@example.com")
        self.assertEqual(staff.start_date.isoformat(), start)
        self.assertEqual(sorted(z.name for z in staff.areas.all()), ["Bantama", "Suame"])
        self.assertEqual(staff.manager, self.lead)
        self.assertIsNotNone(staff.invite_sent_at)
        self.assertEqual(len(mail.outbox), 1)

    def test_areas_are_for_scouts_and_the_start_cannot_be_past(self):
        self.as_(self.lead)
        self.assertEqual(self.invite(role="support", areas=[self.zone("Bantama").pk]).status_code, 400)
        self.assertEqual(self.invite(start_date=(timezone.localdate() - timedelta(days=1)).isoformat()).status_code, 400)
        self.assertEqual(self.invite(areas=[999999]).status_code, 400)
        self.assertEqual(self.invite(role="support").status_code, 201)  # neither field is required

    def test_areas_become_the_scouts_areas_until_they_have_businesses(self):
        self.as_(self.lead)
        self.invite(areas=[self.zone("Bantama").pk, self.zone("Suame").pk])
        scout = StaffUser.objects.get(email="akwasi@example.com")
        self.assertEqual(scout_areas([scout])[scout.pk], ["Bantama", "Suame"])
        make_business("A", manager=scout, zone="Adum")
        make_business("B", manager=scout, zone="Adum")
        # the zone holding most of their businesses leads; an invited zone fills the second place
        self.assertEqual(scout_areas([scout])[scout.pk], ["Adum", "Bantama"])

    def test_pending_invites_show_not_opened_opened_and_expired(self):
        self.as_(self.lead)
        self.invite(email="a@example.com")
        self.invite(email="b@example.com")
        self.invite(email="c@example.com", role="support")
        token = StaffUser.objects.get(email="b@example.com").invite_token
        self.client.credentials()
        self.assertEqual(self.client.post("/api/accounts/staff/activate/opened/", {"token": token}, format="json").data["state"], "valid")
        StaffUser.objects.filter(email="c@example.com").update(invite_expires_at=timezone.now() - timedelta(hours=1))
        self.as_(self.lead)
        rows = {r["email"]: r for r in self.client.get(URL).data["pending"]}
        self.assertEqual({e: r["state"] for e, r in rows.items()}, {"a@example.com": "not_opened", "b@example.com": "opened", "c@example.com": "expired"})
        self.assertEqual(rows["c@example.com"]["role"], "support")

    def test_only_the_leads_own_invites_are_listed(self):
        self.as_(self.other_lead)
        self.invite(email="theirs@example.com")
        self.as_(self.lead)
        self.assertEqual(self.client.get(URL).data["pending"], [])
        self.as_(make_staff("scout", "s@example.com", manager=self.lead))
        self.assertEqual(self.client.get(URL).status_code, 403)

    def test_resend_makes_a_new_link_and_clears_opened(self):
        self.as_(self.lead)
        self.invite()
        staff = StaffUser.objects.get(email="akwasi@example.com")
        old = staff.invite_token
        self.client.credentials()
        self.client.post("/api/accounts/staff/activate/opened/", {"token": old}, format="json")
        self.as_(self.lead)
        self.assertEqual(self.client.post(f"/api/accounts/staff/{staff.pk}/resend-invite/").status_code, 200)
        staff.refresh_from_db()
        self.assertNotEqual(staff.invite_token, old)
        self.assertIsNone(staff.invite_opened_at)
        self.client.credentials()
        self.assertEqual(self.client.post("/api/accounts/staff/activate/opened/", {"token": old}, format="json").data["state"], "invalid")

    def test_cancel_removes_the_unused_account_and_is_recorded(self):
        self.as_(self.lead)
        self.invite(areas=[self.zone("Bantama").pk])
        staff = StaffUser.objects.get(email="akwasi@example.com")
        response = self.client.post(f"/api/accounts/staff/{staff.pk}/cancel-invite/")
        self.assertEqual(response.status_code, 204)
        self.assertFalse(StaffUser.objects.filter(email="akwasi@example.com").exists())
        event = ActivityEvent.objects.get(verb="staff.invite_cancelled")
        self.assertEqual(event.before["email"], "akwasi@example.com")
        self.assertEqual(self.invite().status_code, 201)  # the same email can be invited again

    def test_cancel_is_for_your_own_team_and_unused_invites_only(self):
        self.as_(self.other_lead)
        self.invite(email="theirs@example.com")
        theirs = StaffUser.objects.get(email="theirs@example.com")
        self.as_(self.lead)
        self.assertEqual(self.client.post(f"/api/accounts/staff/{theirs.pk}/cancel-invite/").status_code, 403)
        active = make_staff("scout", "active@example.com", manager=self.lead)
        self.assertEqual(self.client.post(f"/api/accounts/staff/{active.pk}/cancel-invite/").status_code, 400)
        self.assertTrue(StaffUser.objects.filter(pk=active.pk).exists())
        self.as_(self.admin)
        self.assertEqual(self.client.post(f"/api/accounts/staff/{theirs.pk}/cancel-invite/").status_code, 204)

    def test_the_opened_check_says_nothing_about_the_account(self):
        self.client.credentials()
        self.assertEqual(self.client.post("/api/accounts/staff/activate/opened/", {"token": "nope"}, format="json").data, {"state": "invalid"})
        self.assertEqual(self.client.post("/api/accounts/staff/activate/opened/", {}, format="json").data, {"state": "invalid"})
        make_staff("scout", "old@example.com", manager=self.lead, invite_token="tok", invite_expires_at=timezone.now() - timedelta(minutes=1))
        self.assertEqual(self.client.post("/api/accounts/staff/activate/opened/", {"token": "tok"}, format="json").data, {"state": "expired"})

    def test_activation_stamps_the_join_date_and_lists_the_person_as_joined(self):
        self.as_(self.lead)
        self.invite()
        staff = StaffUser.objects.get(email="akwasi@example.com")
        self.client.credentials()
        done = self.client.post("/api/accounts/staff/activate/", {"token": staff.invite_token, "password": "a-strong-pass-1"}, format="json")
        self.assertEqual(done.status_code, 200, done.content)
        staff.refresh_from_db()
        self.assertIsNotNone(staff.activated_at)
        self.as_(self.lead)
        data = self.client.get(URL).data
        self.assertEqual(data["pending"], [])
        self.assertEqual([j["full_name"] for j in data["joined"]], ["Akwasi"] if staff.full_name == "Akwasi" else [staff.full_name])
        self.assertTrue(data["joined"][0]["invited_by_me"])

    def test_joined_is_the_last_60_days_only(self):
        old = make_staff("scout", "old@example.com", manager=self.lead, invited_by=self.lead)
        StaffUser.objects.filter(pk=old.pk).update(activated_at=timezone.now() - timedelta(days=61))
        recent = make_staff("support", "recent@example.com", manager=self.lead, invited_by=self.lead)
        StaffUser.objects.filter(pk=recent.pk).update(activated_at=timezone.now() - timedelta(days=59))
        self.as_(self.lead)
        self.assertEqual([j["full_name"] for j in self.client.get(URL).data["joined"]], ["Recent"])

    def test_zones_list_who_already_works_them(self):
        scout = make_staff("scout", "efua@example.com", manager=self.lead)
        make_business("A", manager=scout, zone="Adum")
        self.as_(self.lead)
        zones = {z["name"]: z for z in self.client.get(URL).data["zones"]}
        self.assertEqual(zones["Adum"]["scouts"], ["Efua"])
        self.assertEqual(zones["Bantama"]["scouts"], [])
