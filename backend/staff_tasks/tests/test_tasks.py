import datetime as dt

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import Role, StaffUser
from staff_tasks.models import Task
from staff_tasks.services import create_task


def make_staff(role, email):
    return StaffUser.objects.create(
        full_name=email.split("@")[0].title(), email=email, password_hash="x", role=Role.objects.get(name=role)
    )


class TaskTests(TestCase):
    def setUp(self):
        self.scout = make_staff("scout", "kwame@example.com")
        self.other = make_staff("scout", "efua@example.com")
        self.client = APIClient()
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.scout, 'staff')}")
        now = timezone.now()
        self.overdue = create_task(self.scout, "Call Adwoa Fabrics", now - dt.timedelta(hours=2))
        self.today = create_task(self.scout, "Photos at Bonwire", now + dt.timedelta(minutes=1))
        self.later = create_task(self.scout, "Visit Kejetia", now + dt.timedelta(days=3))
        self.not_mine = create_task(self.other, "Someone else's", now + dt.timedelta(hours=1))

    def titles(self, view):
        response = self.client.get(f"/api/tasks/?view={view}")
        self.assertEqual(response.status_code, 200)
        return [row["title"] for row in response.json()]

    def test_views_filter_my_tasks(self):
        self.assertEqual(self.titles("open"), ["Call Adwoa Fabrics", "Photos at Bonwire", "Visit Kejetia"])
        self.assertEqual(self.titles("overdue"), ["Call Adwoa Fabrics"])
        self.assertEqual(self.titles("upcoming"), ["Visit Kejetia"])
        today = self.titles("today")  # open and due before midnight, overdue included
        self.assertIn("Call Adwoa Fabrics", today)
        self.assertNotIn("Visit Kejetia", today)

    def test_create_complete_and_cancel(self):
        due = (timezone.now() + dt.timedelta(days=1)).isoformat()
        response = self.client.post("/api/tasks/", {"title": "Resend claim link", "due_at": due}, format="json")
        self.assertEqual(response.status_code, 201)
        task = Task.objects.get(title="Resend claim link")
        self.assertEqual((task.owner, task.created_by), (self.scout, self.scout))
        self.assertEqual(self.client.post(f"/api/tasks/{task.id}/done/").status_code, 200)
        task.refresh_from_db()
        self.assertEqual(task.status, Task.DONE)
        self.assertIsNotNone(task.done_at)
        self.assertEqual(self.client.post(f"/api/tasks/{self.later.id}/cancel/").status_code, 200)
        self.assertEqual(self.titles("done"), ["Resend claim link"])

    def test_cannot_touch_someone_elses_task(self):
        self.assertEqual(self.client.post(f"/api/tasks/{self.not_mine.id}/done/").status_code, 404)

    def test_due_at_is_required(self):
        self.assertEqual(self.client.post("/api/tasks/", {"title": "No date"}, format="json").status_code, 400)

    def test_overdue_badge(self):
        self.assertEqual(self.client.get("/api/notifications/staff-badges/").json()["tasks_overdue"], 1)
