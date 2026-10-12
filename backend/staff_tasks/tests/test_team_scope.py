import datetime as dt

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import Role, StaffUser
from notifications.models import Notification
from staff_tasks.models import Task
from staff_tasks.services import create_task


def make(role, email, manager=None):
    return StaffUser.objects.create(
        full_name=email.split("@")[0].title(), email=email, password_hash="x", role=Role.objects.get(name=role), manager=manager
    )


class TeamTasksTests(TestCase):
    def setUp(self):
        self.lead = make("operations", "ama@example.com")
        self.yaw = make("scout", "yaw@example.com", self.lead)
        self.efua = make("scout", "efua@example.com", self.lead)
        self.stranger = make("scout", "kwaku@example.com", make("operations", "kojo@example.com"))
        now = timezone.now()
        self.mine = create_task(self.lead, "My own", timezone.localtime(now).replace(hour=23, minute=59, second=0))
        self.old = create_task(self.yaw, "Old one", now - dt.timedelta(days=4))
        create_task(self.yaw, "Another", now - dt.timedelta(hours=3))
        create_task(self.efua, "On time", now + dt.timedelta(days=1))
        create_task(self.stranger, "Not my team", now - dt.timedelta(days=1))
        self.client = APIClient()
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.lead, 'staff')}")

    def titles(self, query):
        response = self.client.get(f"/api/tasks/?{query}")
        self.assertEqual(response.status_code, 200)
        return [row["title"] for row in response.json()]

    def test_default_is_mine_and_team_is_direct_reports_only(self):
        self.assertEqual(self.titles("view=open"), ["My own"])
        self.assertEqual(self.titles("scope=team&view=open"), ["Old one", "Another", "On time"])

    def test_team_scope_includes_the_teams_overdue_and_names_the_owner(self):
        rows = self.client.get("/api/tasks/?scope=team&view=overdue").json()
        self.assertEqual([(r["title"], r["owner"]["name"]) for r in rows], [("Old one", "Yaw"), ("Another", "Yaw")])

    def test_someone_who_leads_nobody_sees_an_empty_team(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.yaw, 'staff')}")
        self.assertEqual(self.titles("scope=team"), [])

    def test_summary_counts_overdue_per_person_oldest_first(self):
        rows = self.client.get("/api/tasks/team-summary/").json()
        self.assertEqual([(r["name"], r["overdue"]) for r in rows], [("Yaw", 2), ("Efua", 0)])
        self.assertEqual(rows[0]["oldest_days"], 4)
        self.assertIsNone(rows[1]["oldest_days"])

    def test_give_a_task_to_a_direct_report_notifies_them(self):
        due = (timezone.now() + dt.timedelta(days=1)).isoformat()
        response = self.client.post("/api/tasks/", {"title": "Call Adwoa", "due_at": due, "owner": self.efua.pk}, format="json")
        self.assertEqual(response.status_code, 201)
        task = Task.objects.get(title="Call Adwoa")
        self.assertEqual((task.owner, task.created_by), (self.efua, self.lead))
        self.assertTrue(Notification.objects.filter(staff=self.efua, kind="task_assigned").exists())

    def test_cannot_give_a_task_outside_the_team(self):
        due = (timezone.now() + dt.timedelta(days=1)).isoformat()
        for owner in (self.stranger.pk, "abc", 999999):
            response = self.client.post("/api/tasks/", {"title": "x", "due_at": due, "owner": owner}, format="json")
            self.assertEqual(response.status_code, 400, owner)
        self.assertFalse(Task.objects.filter(title="x").exists())

    def test_a_manager_can_close_a_reports_task_but_a_peer_cannot(self):
        self.assertEqual(self.client.post(f"/api/tasks/{self.old.id}/done/").status_code, 200)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.efua, 'staff')}")
        self.assertEqual(self.client.post(f"/api/tasks/{self.old.id}/cancel/").status_code, 404)

    def test_badge_counts_overdue_and_due_today_for_the_caller_only(self):
        create_task(self.lead, "Late", timezone.now() - dt.timedelta(hours=1))
        response = self.client.get("/api/notifications/staff-badges/").json()
        self.assertEqual(response["tasks_overdue"], 1)
        self.assertEqual(response["tasks_due"], 2)  # "Late" and "My own" (due 23:59 today)
