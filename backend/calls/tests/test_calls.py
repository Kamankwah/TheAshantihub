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

    def test_counterpart_phone_is_masked_in_the_activity_log_and_api(self):
        from activity.models import ActivityEvent

        self.as_(self.scout)
        self.assertEqual(self.client.post("/api/calls/", self.payload(), format="json").status_code, 201)
        event = ActivityEvent.objects.get(verb__startswith="call")
        masked = event.after["request"]["counterpart_phone"]
        self.assertTrue(masked.endswith("118"))
        self.assertNotEqual(masked, "0244123118")
        self.as_(self.ops)
        rows = self.client.get("/api/activity/").json()["results"]
        shown = [r for r in rows if r["id"] == event.id][0]
        self.assertEqual(shown["after"]["request"]["counterpart_phone"], masked)

    def test_non_numeric_staff_filter_is_400(self):
        self.as_(self.boss)
        response = self.client.get("/api/calls/?staff=abc")
        self.assertEqual(response.status_code, 400)
        self.assertIn("staff", response.json())

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


class ScoutCallSheetTests(TestCase):
    def setUp(self):
        from field.models import Prospect
        from portfolio.tests.health_fixtures import make_business

        self.ops = make_staff("operations", "ama@example.com")
        self.scout = make_staff("scout", "kwame@example.com", manager=self.ops)
        self.other = make_staff("scout", "efua@example.com", manager=self.ops)
        self.business = make_business("Adwoa Fabrics", manager=self.scout, phone="+233244123118")
        self.prospect = Prospect.objects.create(scout=self.scout, name="Ohemaa Waakye", phone="+233241234567")
        self.client = APIClient()
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.scout, 'staff')}")

    def sheet(self, **overrides):
        data = {"direction": "out", "channel": "visit", "counterpart_type": "business_owner",
                "counterpart_id": self.business.pk, "purpose": "subscription_payment", "outcome": "connected",
                "sentiment": "positive", "notes": "", "duration_seconds": 360}
        data.update(overrides)
        return self.client.post("/api/calls/", data, format="json")

    def test_the_server_stamps_the_start_as_now_minus_the_duration(self):
        before = timezone.now()
        response = self.sheet()
        self.assertEqual(response.status_code, 201, response.content)
        call = CallLog.objects.get()
        expected = before - dt.timedelta(minutes=6)
        self.assertLess(abs((call.started_at - expected).total_seconds()), 5)
        self.assertEqual(call.channel, "visit")

    def test_the_name_phone_and_business_come_from_the_record(self):
        self.sheet(counterpart_name="Someone else", counterpart_phone="0200000000")
        call = CallLog.objects.get()
        self.assertEqual(call.counterpart_name, self.business.full_name)
        self.assertEqual(call.counterpart_phone, "+233244123118")
        self.assertEqual((call.related_type, call.related_id, call.related_label), ("business_owner", str(self.business.pk), "Adwoa Fabrics"))

    def test_another_scouts_business_is_refused(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.other, 'staff')}")
        response = self.sheet()
        self.assertEqual(response.status_code, 400)
        self.assertIn("counterpart_id", response.json())
        self.assertFalse(CallLog.objects.exists())

    def test_a_prospect_call_is_filed_under_the_prospect_and_must_be_the_scouts_own(self):
        response = self.sheet(counterpart_type="prospect", counterpart_id=self.prospect.pk, purpose="prospecting")
        self.assertEqual(response.status_code, 201, response.content)
        call = CallLog.objects.get()
        self.assertEqual((call.counterpart_name, call.related_type, call.related_id), ("Ohemaa Waakye", "prospect", str(self.prospect.pk)))
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.other, 'staff')}")
        refused = self.sheet(counterpart_type="prospect", counterpart_id=self.prospect.pk, purpose="prospecting")
        self.assertEqual(refused.status_code, 400)

    def test_the_day_filter_has_a_summary(self):
        self.sheet()
        self.sheet(outcome="no_answer", duration_seconds=0)
        CallLog.objects.create(
            staff=self.scout, direction="out", counterpart_type="other", purpose="other", outcome="connected",
            started_at=timezone.now() - dt.timedelta(days=3),
        )
        data = self.client.get("/api/calls/?day=today").json()
        self.assertEqual(data["summary"], {"logged": 2, "connected": 1})
        self.assertEqual(len(data["results"]), 2)
        self.assertNotIn("summary", self.client.get("/api/calls/").json())

    def test_scope_splits_mine_from_my_teams_and_the_strip_counts_both(self):
        CallLog.objects.create(staff=self.scout, direction="out", counterpart_type="other", purpose="other", outcome="connected", started_at=timezone.now())
        CallLog.objects.create(staff=self.ops, direction="in", counterpart_type="other", purpose="other", outcome="no_answer", started_at=timezone.now())
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.ops, 'staff')}")
        mine = self.client.get("/api/calls/?scope=mine&day=today").json()
        team = self.client.get("/api/calls/?scope=team&day=today").json()
        self.assertEqual([c["staff_name"] for c in mine["results"]], ["Ama"])
        self.assertEqual([c["staff_name"] for c in team["results"]], ["Kwame"])
        self.assertEqual(mine["strip"], {"mine": 1, "out": 0, "in": 1, "connected": 0, "no_answer": 1, "follow_ups": 0, "team": 1})
        # A scout holds no team permission: the team number is unknown, not zero.
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.scout, 'staff')}")
        self.assertIsNone(self.client.get("/api/calls/?day=today").json()["strip"]["team"])

    def test_the_scout_purposes_use_the_canvas_words(self):
        labels = [row["label"] for row in self.client.get("/api/calls/purposes/").json()]
        self.assertEqual(labels, ["Subscription reminder", "Onboarding help", "Photos & listings",
                                  "Delivery follow-up", "Info update", "Prospecting", "Other"])

    def test_editing_moves_the_follow_up_task_and_clearing_it_cancels(self):
        future = timezone.now() + dt.timedelta(days=2)
        call_id = self.sheet(follow_up_at=future.isoformat()).json()["id"]
        task = Task.objects.get()
        self.assertEqual((task.kind, task.business_owner), (Task.CALL_FOLLOW_UP, self.business))
        later = timezone.now() + dt.timedelta(days=4)
        self.assertEqual(self.client.patch(f"/api/calls/{call_id}/", {"follow_up_at": later.isoformat()}, format="json").status_code, 200)
        task.refresh_from_db()
        self.assertEqual(task.due_at, later)
        self.client.patch(f"/api/calls/{call_id}/", {"follow_up_at": None}, format="json")
        task.refresh_from_db()
        self.assertEqual(task.status, Task.CANCELLED)

    def test_counterparts_lists_my_businesses_masked_and_my_prospects(self):
        data = self.client.get("/api/calls/counterparts/").json()
        self.assertEqual(data["businesses"][0]["phone_masked"], "024 *** 118")
        self.assertNotIn("+233244123118", str(data))
        self.assertEqual([p["name"] for p in data["prospects"]], ["Ohemaa Waakye"])
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.other, 'staff')}")
        self.assertEqual(self.client.get("/api/calls/counterparts/").json(), {"businesses": [], "prospects": []})


class ManagerLogsProspectCallTests(TestCase):
    """Post-review fix A2: Operations and Super Admin log a call on any scout's prospect; a scout only on their own;
    the General Manager (a checker with no prospect rights) not at all."""

    def setUp(self):
        from field.models import Prospect

        self.ops = make_staff("operations", "ama@example.com")
        self.admin = make_staff("super_admin", "root@example.com")
        self.gm = make_staff("general_manager", "gm@example.com")
        self.scout = make_staff("scout", "kwame@example.com", manager=self.ops)
        self.other = make_staff("scout", "efua@example.com", manager=self.ops)
        self.prospect = Prospect.objects.create(scout=self.scout, name="Ohemaa Waakye", phone="+233241234567")
        self.client = APIClient()

    def log(self, who, **overrides):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(who, 'staff')}")
        data = {"direction": "out", "channel": "phone", "counterpart_type": "prospect", "counterpart_id": self.prospect.pk,
                "purpose": "prospecting", "outcome": "connected", "sentiment": "neutral", "notes": "", "duration_seconds": 60}
        data.update(overrides)
        return self.client.post("/api/calls/", data, format="json")

    def test_operations_and_super_admin_log_a_call_filed_under_the_prospect_with_the_manager_as_caller(self):
        for who in (self.ops, self.admin):
            response = self.log(who)
            self.assertEqual(response.status_code, 201, response.content)
        calls = list(CallLog.objects.order_by("pk"))
        self.assertEqual([c.staff for c in calls], [self.ops, self.admin])
        self.assertEqual({(c.related_type, c.related_id, c.counterpart_name) for c in calls},
                         {("prospect", str(self.prospect.pk), "Ohemaa Waakye")})

    def test_a_scout_cannot_log_on_another_scouts_prospect(self):
        self.assertEqual(self.log(self.other).status_code, 400)
        self.assertFalse(CallLog.objects.exists())

    def test_the_gm_may_log_on_any_scouts_prospect_since_2026_10_30(self):
        # The GM holds businesses.register and portfolio.manage now, so it works every scout's prospects like Operations.
        response = self.log(self.gm, purpose="other")
        self.assertEqual(response.status_code, 201, response.content)
        self.assertTrue(CallLog.objects.exists())

    def test_a_registered_prospect_still_refuses_a_manager(self):
        from field.models import Prospect

        Prospect.objects.filter(pk=self.prospect.pk).update(status=Prospect.REGISTERED)
        self.assertEqual(self.log(self.ops).status_code, 400)
