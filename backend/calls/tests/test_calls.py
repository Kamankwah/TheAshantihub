import datetime as dt

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import Role, StaffUser
from calls.models import CallLog
from staff_tasks.models import Task


def make_staff(role, email, **extra):
    return StaffUser.objects.create(
        full_name=email.split("@")[0].title(), email=email, password_hash="x",
        role=Role.objects.get(name=role), **extra,
    )


class CallLogTests(TestCase):
    def setUp(self):
        self.ops = make_staff("operations", "ama@example.com")
        self.scout = make_staff("scout", "kwame@example.com", manager=self.ops)
        self.boss = make_staff("super_admin", "boss@example.com")
        self.client = APIClient()

    def as_(self, staff):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(staff, 'staff')}")

    def payload(self, **overrides):
        data = {
            "direction": "out", "channel": "phone", "counterpart_type": "business_owner",
            "counterpart_name": "Adwoa Fabrics", "counterpart_phone": "0244123118",
            "related_type": "accounts.businessowner", "related_id": "7", "related_label": "Adwoa Fabrics",
            "purpose": "subscription_payment", "outcome": "promised_to_pay", "sentiment": "positive",
            "notes": "Will pay Friday", "started_at": (timezone.now() - dt.timedelta(minutes=10)).isoformat(),
            "duration_seconds": 180,
        }
        data.update(overrides)
        return data

    def test_scout_logs_a_call_with_a_follow_up_task(self):
        self.as_(self.scout)
        follow_up = (timezone.now() + dt.timedelta(days=2)).isoformat()
        response = self.client.post("/api/calls/", self.payload(follow_up_at=follow_up), format="json")
        self.assertEqual(response.status_code, 201)
        call = CallLog.objects.get()
        self.assertEqual(call.staff, self.scout)
        task = Task.objects.get()
        self.assertEqual((task.owner, task.source_type, task.source_id), (self.scout, "calls.calllog", str(call.id)))
        self.assertEqual(response.json()["counterpart_phone"], "0244123118")

    def test_follow_up_in_the_past_is_refused(self):
        self.as_(self.scout)
        past = (timezone.now() - dt.timedelta(hours=1)).isoformat()
        self.assertEqual(self.client.post("/api/calls/", self.payload(follow_up_at=past), format="json").status_code, 400)

    def test_call_in_the_future_is_refused(self):
        self.as_(self.scout)
        future = (timezone.now() + dt.timedelta(hours=1)).isoformat()
        self.assertEqual(self.client.post("/api/calls/", self.payload(started_at=future), format="json").status_code, 400)

    def test_purpose_must_belong_to_the_role(self):
        self.as_(self.scout)
        self.assertEqual(self.client.post("/api/calls/", self.payload(purpose="refund_return"), format="json").status_code, 400)

    def test_roles_without_calls_log_cannot_log(self):
        self.as_(make_staff("dispatch", "kofi@example.com"))
        self.assertEqual(self.client.post("/api/calls/", self.payload(), format="json").status_code, 403)

    def test_visibility_and_phone_masking(self):
        self.as_(self.scout)
        self.client.post("/api/calls/", self.payload(), format="json")
        self.as_(self.ops)
        rows = self.client.get("/api/calls/").json()["results"]
        self.assertEqual(len(rows), 1)
        self.assertNotEqual(rows[0]["counterpart_phone"], "0244123118")
        self.assertTrue(rows[0]["counterpart_phone"].endswith("118"))
        self.as_(self.boss)
        self.assertEqual(self.client.get("/api/calls/").json()["results"][0]["counterpart_phone"], "0244123118")
        self.as_(make_staff("support", "esi@example.com"))
        self.assertEqual(self.client.get("/api/calls/").json()["results"], [])

    def test_author_edits_within_24_hours_only(self):
        self.as_(self.scout)
        call_id = self.client.post("/api/calls/", self.payload(), format="json").json()["id"]
        self.assertEqual(self.client.patch(f"/api/calls/{call_id}/", {"notes": "Paid"}, format="json").status_code, 200)
        CallLog.objects.filter(pk=call_id).update(created_at=timezone.now() - dt.timedelta(hours=25))
        self.assertEqual(self.client.patch(f"/api/calls/{call_id}/", {"notes": "Late edit"}, format="json").status_code, 403)
        self.as_(self.ops)
        self.assertEqual(self.client.patch(f"/api/calls/{call_id}/", {"notes": "Not mine"}, format="json").status_code, 403)

    def test_purposes_endpoint(self):
        self.as_(self.scout)
        values = [p["value"] for p in self.client.get("/api/calls/purposes/").json()]
        self.assertIn("subscription_payment", values)
        self.assertNotIn("refund_return", values)
