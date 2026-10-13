import datetime as dt

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.testing import make_staff
from activity.models import ActivityEvent
from staff_tasks.models import Task
from staff_tasks.services import KIND_LABELS, create_task


class SupportTaskTests(TestCase):
    def setUp(self):
        self.lead = make_staff("operations", "ama@example.com")
        self.agent = make_staff("support", "esi@example.com", manager=self.lead)
        self.peer = make_staff("support", "kojo@example.com", manager=self.lead)
        self.other_lead = make_staff("operations", "yaw@example.com")

    def api(self, who):
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(who, 'staff')}")
        return client

    def test_support_kinds_have_labels(self):
        for kind in (Task.SNOOZE_WAKE, Task.HANDOVER, Task.ESCALATION_FOLLOW_UP, Task.LEAD_ASSIGNED):
            self.assertTrue(KIND_LABELS[kind])
            task = create_task(self.agent, "t", timezone.now(), kind=kind)
            row = self.api(self.agent).get("/api/tasks/").json()[0]
            self.assertEqual(row["kind"], kind)
            self.assertEqual(row["kind_label"], KIND_LABELS[kind])
            task.delete()

    def test_source_links_resolve_for_conversation_call_dispute(self):
        for source_type, tab in (
            ("messaging.conversation", "support-all-open"), ("calls.calllog", "calls"), ("disputes.dispute", "disputes"),
        ):
            Task.objects.create(owner=self.agent, title=source_type, due_at=timezone.now(), source_type=source_type, source_id="7")
        Task.objects.create(owner=self.agent, title="bad", due_at=timezone.now(), source_type="messaging.conversation", source_id="x")
        Task.objects.create(owner=self.agent, title="none", due_at=timezone.now())
        rows = {r["title"]: r for r in self.api(self.agent).get("/api/tasks/").json()}
        self.assertEqual(rows["messaging.conversation"]["source_link"]["tab"], "support-all-open")
        self.assertEqual(rows["messaging.conversation"]["source_link"]["id"], 7)
        self.assertEqual(rows["calls.calllog"]["source_link"]["param"], "call")
        self.assertEqual(rows["disputes.dispute"]["source_link"]["tab"], "disputes")
        self.assertIsNone(rows["bad"]["source_link"])
        self.assertIsNone(rows["none"]["source_link"])

    def test_done_today_view(self):
        now = timezone.now()
        a = create_task(self.agent, "today", now)
        b = create_task(self.agent, "old", now)
        Task.objects.filter(pk=a.pk).update(status=Task.DONE, done_at=now)
        Task.objects.filter(pk=b.pk).update(status=Task.DONE, done_at=now - dt.timedelta(days=3))
        rows = self.api(self.agent).get("/api/tasks/?view=done_today").json()
        self.assertEqual([r["title"] for r in rows], ["today"])

    def test_owner_moves_due_date_and_it_is_logged(self):
        task = create_task(self.agent, "t", timezone.now())
        new = (timezone.now() + dt.timedelta(days=2)).replace(microsecond=0)
        response = self.api(self.agent).patch(f"/api/tasks/{task.pk}/", {"due_at": new.isoformat()}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        task.refresh_from_db()
        self.assertEqual(task.due_at, new)
        event = ActivityEvent.objects.filter(verb="task.due_moved").get()
        self.assertEqual(event.target_id, str(task.pk))
        self.assertIn("due_at", event.before)

    def test_lead_may_move_a_reports_task_peer_and_other_lead_may_not(self):
        task = create_task(self.agent, "t", timezone.now())
        body = {"due_at": (timezone.now() + dt.timedelta(days=1)).isoformat()}
        self.assertEqual(self.api(self.lead).patch(f"/api/tasks/{task.pk}/", body, format="json").status_code, 200)
        self.assertEqual(self.api(self.peer).patch(f"/api/tasks/{task.pk}/", body, format="json").status_code, 404)
        self.assertEqual(self.api(self.other_lead).patch(f"/api/tasks/{task.pk}/", body, format="json").status_code, 404)

    def test_only_due_at_and_only_open(self):
        task = create_task(self.agent, "t", timezone.now())
        client = self.api(self.agent)
        due = (timezone.now() + dt.timedelta(days=1)).isoformat()
        self.assertEqual(client.patch(f"/api/tasks/{task.pk}/", {"due_at": due, "title": "x"}, format="json").status_code, 400)
        self.assertEqual(client.patch(f"/api/tasks/{task.pk}/", {"due_at": "nope"}, format="json").status_code, 400)
        Task.objects.filter(pk=task.pk).update(status=Task.DONE)
        self.assertEqual(client.patch(f"/api/tasks/{task.pk}/", {"due_at": due}, format="json").status_code, 400)
