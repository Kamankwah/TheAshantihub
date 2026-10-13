from datetime import timedelta

from django.utils import timezone

from accounts.testing import make_staff
from activity.models import ActivityEvent

from .base import PeopleTestCase

URL = "/api/people/invites/"


class InviteListTests(PeopleTestCase):
    def setUp(self):
        super().setUp()
        now = timezone.now()
        self.fresh = make_staff("scout", "afua@example.com", invite_token="a", invite_sent_at=now - timedelta(days=1),
                                invite_expires_at=now + timedelta(days=6), invited_by=self.kojo, manager=self.kojo)
        self.opened = make_staff("dispatch", "kweku@example.com", invite_token="b", invite_sent_at=now - timedelta(days=2),
                                 invite_expires_at=now + timedelta(days=5), invite_opened_at=now - timedelta(days=1), invited_by=self.boss)
        self.expired = make_staff("support", "abenaa@example.com", invite_token="c", invite_sent_at=now - timedelta(days=10),
                                  invite_expires_at=now - timedelta(days=3), invited_by=self.ama)

    def test_lists_every_role_with_who_sent_it_and_its_state(self):
        self.sign_in()
        data = self.client.get(URL).json()
        states = {i["full_name"]: i["state"] for i in data["invites"]}
        self.assertEqual(states, {"Afua": "not_opened", "Kweku": "opened", "Abenaa": "expired"})
        afua = next(i for i in data["invites"] if i["full_name"] == "Afua")
        self.assertEqual((afua["invited_by"]["name"], afua["manager"]["name"]), ("Kojo", "Kojo"))
        self.assertEqual(data["kpis"]["open"], 2)
        self.assertEqual(data["kpis"]["opened_unfinished"], 1)
        self.assertEqual(data["kpis"]["expired"], 1)
        self.assertEqual(data["link_days"], 7)

    def test_accepted_and_revoked_in_the_last_30_days(self):
        accepted = make_staff("dispatch", "ama.k@example.com", invited_by=self.boss, activated_at=timezone.now() - timedelta(hours=3), invite_sent_at=timezone.now() - timedelta(days=1))
        self.sign_in(sudo=True)
        self.assertEqual(self.client.post(f"/api/accounts/staff/{self.expired.pk}/cancel-invite/", {}, format="json").status_code, 204)
        data = self.client.get(URL).json()
        recent = {(r["state"], r["name"]) for r in data["recent"]}
        self.assertIn(("accepted", accepted.full_name), recent)
        self.assertIn(("revoked", "Abenaa"), recent)
        self.assertEqual(data["kpis"]["accepted_30_days"], 1)
        self.assertAlmostEqual(data["kpis"]["median_days_to_accept"], 0.9, places=1)
        self.assertEqual(ActivityEvent.objects.filter(verb="staff.invite_cancelled").count(), 1)

    def test_lists_roles_leads_and_who_can_invite_whom(self):
        self.sign_in()
        data = self.client.get(URL).json()
        self.assertIn("scout", [r["name"] for r in data["roles"]])
        self.assertIn("Ama", [l["name"] for l in data["leads"]])
        self.assertEqual(data["who_can_invite"][0], {"who": "Super Admin", "can": "Any role"})

    def test_needs_staff_manage(self):
        self.sign_in(self.ama)
        self.assertEqual(self.client.get(URL).status_code, 403)

    def test_super_admin_can_invite_any_role_with_a_manager_and_start_date(self):
        self.sign_in(sudo=True)
        start = (timezone.localdate() + timedelta(days=3)).isoformat()
        response = self.client.post("/api/accounts/staff/invite/", {
            "full_name": "Yaa Co", "email": "yaa@example.com", "role": "accountant", "manager": self.kojo.pk, "start_date": start,
        }, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        invite = next(i for i in self.client.get(URL).json()["invites"] if i["full_name"] == "Yaa Co")
        self.assertEqual((invite["role"], invite["manager"]["name"], invite["invited_by"]["name"], invite["start_date"]), ("accountant", "Kojo", "Boss", start))
