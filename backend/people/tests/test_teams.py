from accounts.models import Role
from accounts.testing import make_staff
from activity.models import ActivityEvent
from notifications.models import Notification
from portfolio.tests.health_fixtures import make_business

from .base import PeopleTestCase

CHART = "/api/people/teams/"
REASSIGN = "/api/people/teams/reassign/"


class OrgChartTests(PeopleTestCase):
    def test_tree_runs_from_the_top_down_and_counts_people_and_teams(self):
        self.sign_in()
        data = self.client.get(CHART).json()
        self.assertEqual(data["people"], 5)
        self.assertEqual(data["teams"], 2)  # Boss and Ama have reports
        root = data["tree"][0]
        self.assertEqual(root["name"], "Boss")
        ama = next(c for c in root["children"] if c["name"] == "Ama")
        self.assertEqual({c["name"] for c in ama["children"]}, {"Kwame", "Esi"})
        self.assertIn("Ama", [lead["name"] for lead in data["leads"]])
        self.assertNotIn("Kwame", [lead["name"] for lead in data["leads"]])

    def test_needs_staff_manage(self):
        self.sign_in(self.ama)
        self.assertEqual(self.client.get(CHART).status_code, 403)


class ReassignTests(PeopleTestCase):
    def body(self, **extra):
        return {"staff": self.esi.pk, "manager": self.kojo.pk, "reason": "All support under one lead.", **extra}

    def test_needs_the_password(self):
        self.sign_in()
        response = self.client.post(REASSIGN, self.body(), format="json")
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["code"], "sudo_required")

    def test_moves_the_person_records_before_and_after_and_tells_everyone(self):
        self.sign_in(sudo=True)
        response = self.client.post(REASSIGN, self.body(), format="json")
        self.assertEqual(response.status_code, 200, response.content)
        self.esi.refresh_from_db()
        self.assertEqual(self.esi.manager_id, self.kojo.pk)
        event = ActivityEvent.objects.get(verb="staff.manager_changed")
        self.assertEqual(event.before["manager"]["name"], "Ama")
        self.assertEqual(event.after["manager"]["name"], "Kojo")
        self.assertEqual(event.after["reason"], "All support under one lead.")
        self.assertEqual(Notification.objects.filter(kind="reporting_line_changed").count(), 3)
        history = self.client.get(CHART).json()["history"]
        self.assertEqual(history[0]["verb"], "staff.manager_changed")

    def test_refuses_a_missing_reason_a_non_lead_a_cycle_and_a_no_op(self):
        self.sign_in(sudo=True)
        self.assertEqual(self.client.post(REASSIGN, self.body(reason=""), format="json").status_code, 400)
        self.assertEqual(self.client.post(REASSIGN, self.body(manager=self.kwame.pk), format="json").status_code, 400)
        self.assertEqual(self.client.post(REASSIGN, {"staff": self.ama.pk, "manager": self.esi.pk, "reason": "x"}, format="json").status_code, 400)
        self.assertEqual(self.client.post(REASSIGN, self.body(manager=self.ama.pk), format="json").status_code, 400)
        self.assertEqual(ActivityEvent.objects.filter(verb="staff.manager_changed").count(), 0)

    def test_a_team_lead_cannot_reassign(self):
        self.sign_in(self.ama, sudo=True)
        self.assertEqual(self.client.post(REASSIGN, self.body(), format="json").status_code, 403)


class ChangeRoleTests(PeopleTestCase):
    def url(self, staff):
        return f"/api/people/staff/{staff.pk}/role/"

    def test_changes_a_role_with_the_password_and_records_before_and_after(self):
        self.sign_in()
        self.assertEqual(self.client.post(self.url(self.esi), {"role": "marketing", "reason": "Moved"}, format="json").status_code, 403)
        self.sign_in(sudo=True)
        response = self.client.post(self.url(self.esi), {"role": "marketing", "reason": "Moved to campaigns"}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        self.esi.refresh_from_db()
        self.assertEqual(self.esi.role.name, Role.MARKETING)
        event = ActivityEvent.objects.get(verb="staff.role_changed")
        self.assertEqual((event.before["role"], event.after["role"]), ("support", "marketing"))

    def test_refusals(self):
        self.sign_in(sudo=True)
        post = lambda staff, role, reason="why": self.client.post(self.url(staff), {"role": role, "reason": reason}, format="json")
        self.assertEqual(post(self.boss, "operations").status_code, 400)  # yourself
        self.assertEqual(post(self.esi, "nonsense").status_code, 400)
        self.assertEqual(post(self.esi, "marketing", "").status_code, 400)
        self.assertEqual(post(self.esi, "support").status_code, 400)  # already
        self.assertEqual(post(self.ama, "marketing").status_code, 400)  # has a team and marketing cannot lead
        make_business("Nana Chop Bar", manager=self.kwame)
        self.assertEqual(post(self.kwame, "support").status_code, 400)  # portfolio first
        self.assertEqual(ActivityEvent.objects.filter(verb="staff.role_changed").count(), 0)

    def test_another_super_admin_can_be_moved_by_a_super_admin(self):
        second = make_staff("super_admin", "second@example.com")
        self.sign_in(sudo=True)
        response = self.client.post(self.url(second), {"role": "operations", "reason": "Handing over"}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        second.refresh_from_db()
        self.assertEqual(second.role.name, "operations")
