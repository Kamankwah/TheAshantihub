from datetime import datetime, time, timedelta

from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.testing import make_staff, staff_token
from reports import services

NARRATIVE = "Visited three weavers in Bonwire; one wants to register on Wednesday. Network was poor."


class ReportApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.boss = make_staff("super_admin", "boss@example.com")
        self.lead = make_staff("operations", "ama@example.com")
        self.scout = make_staff("scout", "kwame@example.com", manager=self.lead)
        self.other_scout = make_staff("scout", "efua@example.com", manager=self.lead)
        self.today = timezone.localdate()

    def as_(self, staff):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(staff)}")

    def save(self, **body):
        return self.client.post("/api/reports/", {
            "period": "day", "date": str(self.today), "achievements": NARRATIVE,
            "plan_next": ["Register Bonwire Kente Looms"], **body,
        }, format="json")

    def submit_mine(self):
        report = self.save().json()
        self.client.post(f"/api/reports/{report['id']}/submit/", {}, format="json")
        return report

    def test_compose_save_and_submit_my_day_report(self):
        self.as_(self.scout)
        current = self.client.get("/api/reports/current/?period=day").json()
        self.assertEqual((current["id"], current["status"], current["system_is_live"]), (None, "draft", True))
        self.assertEqual([s["key"] for s in current["system"]], ["activity", "approvals", "calls", "tasks"])
        saved = self.save(blockers="Network").json()
        self.assertTrue(saved["can_edit"])
        patched = self.client.patch(f"/api/reports/{saved['id']}/", {"blockers": "Network was poor in Bonwire"}, format="json")
        self.assertEqual(patched.json()["blockers"], "Network was poor in Bonwire")
        submitted = self.client.post(f"/api/reports/{saved['id']}/submit/", {}, format="json").json()
        self.assertEqual((submitted["status"], submitted["can_edit"], submitted["system_is_live"]), ("submitted", False, False))
        self.assertEqual(self.client.patch(f"/api/reports/{saved['id']}/", {"blockers": "x"}, format="json").status_code, 400)
        history = self.client.get("/api/reports/?period=day").json()["results"]
        self.assertEqual(history[0]["id"], saved["id"])
        self.assertNotIn("system", history[0])

    def test_the_manager_sees_the_team_and_reviews(self):
        self.as_(self.scout)
        report = self.submit_mine()
        self.as_(self.lead)
        rows = {row["staff"]["id"]: row for row in self.client.get("/api/reports/team/?period=day").json()["rows"]}
        self.assertEqual(rows[self.scout.id]["report"]["status"], "submitted")
        self.assertTrue(rows[self.scout.id]["report"]["can_review"])
        self.assertIsNone(rows[self.other_scout.id]["report"])
        self.assertEqual(self.client.post(f"/api/reports/{report['id']}/return/", {}, format="json").status_code, 400)
        returned = self.client.post(f"/api/reports/{report['id']}/return/", {"note": "Which weavers?"}, format="json")
        self.assertEqual(returned.json()["status"], "returned")
        self.as_(self.scout)
        self.assertTrue(self.client.get(f"/api/reports/{report['id']}/").json()["can_edit"])
        self.client.post(f"/api/reports/{report['id']}/submit/", {}, format="json")
        self.as_(self.lead)
        acknowledged = self.client.post(f"/api/reports/{report['id']}/acknowledge/", {"note": "Thanks"}, format="json")
        self.assertEqual(acknowledged.json()["status"], "acknowledged")

    def test_drafts_stay_private_until_submitted(self):
        self.as_(self.scout)
        draft = self.save().json()
        self.as_(self.lead)
        self.assertEqual(self.client.get(f"/api/reports/{draft['id']}/").status_code, 404)
        rows = {row["staff"]["id"]: row for row in self.client.get("/api/reports/team/?period=day").json()["rows"]}
        self.assertIsNone(rows[self.scout.id]["report"])

    def test_a_scout_cannot_see_a_teammates_report(self):
        self.as_(self.other_scout)
        report = self.submit_mine()
        self.as_(self.scout)
        self.assertEqual(self.client.get(f"/api/reports/{report['id']}/").status_code, 404)
        self.assertEqual(self.client.post(f"/api/reports/{report['id']}/acknowledge/", {}, format="json").status_code, 404)

    def test_everyone_view_is_for_a_super_admin_only(self):
        self.as_(self.lead)
        self.assertEqual(self.client.get("/api/reports/team/?period=day&scope=all").status_code, 403)
        self.as_(self.boss)
        rows = self.client.get("/api/reports/team/?period=day&scope=all").json()["rows"]
        self.assertEqual({row["staff"]["full_name"] for row in rows}, {"Ama", "Kwame", "Efua"})

    def test_bad_input_is_explained(self):
        self.as_(self.scout)
        self.assertEqual(self.client.get("/api/reports/current/?period=year").status_code, 400)
        self.assertEqual(self.client.get("/api/reports/current/?period=day&date=07-10-2026").status_code, 400)
        tomorrow = self.today + timedelta(days=1)
        self.assertEqual(self.save(date=str(tomorrow)).status_code, 400)
        self.assertEqual(self.save(plan_next="not a list").status_code, 400)

    def test_the_copy_check_reaches_the_writer(self):
        yesterday = self.today - timedelta(days=1)
        earlier = services.save_draft(self.scout, "day", yesterday, {"achievements": NARRATIVE, "plan_next": ["Register Bonwire Kente Looms"]})
        services.submit(earlier, now=timezone.make_aware(datetime.combine(yesterday, time(18))))
        self.as_(self.scout)
        self.assertTrue(self.save().json()["similar_warning"])

    def test_a_body_that_is_not_an_object_is_a_400(self):
        self.as_(self.scout)
        report = self.submit_mine()
        expected = {"detail": "Send the report as a JSON object."}
        response = self.client.post("/api/reports/", [], format="json")
        self.assertEqual((response.status_code, response.json()), (400, expected))
        self.as_(self.lead)
        for action in ("acknowledge", "return"):
            response = self.client.post(f"/api/reports/{report['id']}/{action}/", [], format="json")
            self.assertEqual((response.status_code, response.json()), (400, expected))
        self.as_(self.scout)
        other = self.client.post("/api/reports/", {"period": "week", "date": str(self.today)}, format="json").json()
        response = self.client.patch(f"/api/reports/{other['id']}/", [], format="json")
        self.assertEqual((response.status_code, response.json()), (400, expected))

    def test_team_view_query_count_does_not_grow_per_row(self):
        def count():
            with CaptureQueriesContext(connection) as ctx:
                response = self.client.get("/api/reports/team/?period=day")
            self.assertEqual(response.status_code, 200)
            return len(ctx)

        for staff in (self.scout, self.other_scout):
            self.as_(staff)
            self.submit_mine()
        self.as_(self.lead)
        before = count()
        for i in range(4):
            member = make_staff("scout", f"extra{i}@example.com", manager=self.lead)
            self.as_(member)
            self.submit_mine()
        self.as_(self.lead)
        self.assertEqual(count(), before)

    def test_super_admin_everyone_view_query_count_does_not_grow_per_row(self):
        def count():
            with CaptureQueriesContext(connection) as ctx:
                response = self.client.get("/api/reports/team/?period=day&scope=all")
            self.assertEqual(response.status_code, 200)
            return len(ctx)

        for staff in (self.scout, self.other_scout):
            self.as_(staff)
            self.submit_mine()
        self.as_(self.boss)
        before = count()
        for i in range(4):
            member = make_staff("scout", f"far{i}@example.com", manager=self.lead)
            self.as_(member)
            self.submit_mine()
        self.as_(self.boss)
        self.assertEqual(count(), before)

    def test_unhashable_period_is_a_400(self):
        self.as_(self.scout)
        for bad in (["x"], {"a": 1}, 5):
            self.assertEqual(self.save(period=bad).status_code, 400)
        self.assertEqual(self.client.get("/api/reports/team/?period=%5B%5D").status_code, 400)

    def test_out_of_range_dates_are_a_400(self):
        self.as_(self.scout)
        response = self.save(period="week", date="9999-12-31")
        self.assertEqual((response.status_code, response.json()), (400, {"detail": "That date is out of range."}))
        self.as_(self.lead)
        response = self.client.get("/api/reports/team/?period=week&date=9999-12-31")
        self.assertEqual((response.status_code, response.json()), (400, {"detail": "That date is out of range."}))

    def test_nul_characters_are_stripped(self):
        self.as_(self.scout)
        saved = self.save(achievements="a\u0000b", blockers="x\u0000y", plan_next=["p\u0000q"]).json()
        self.assertEqual((saved["achievements"], saved["blockers"], saved["plan_next"]), ("ab", "xy", ["pq"]))
        saved = self.save(
            plan_results=[{"item": "i\u0000j", "result": "done"}],
            linked_targets=[{"type": "bu\u0000s", "id": "1\u00002", "label": "l\u0000m"}],
        ).json()
        self.assertEqual(saved["plan_results"][0]["item"], "ij")
        self.assertEqual(saved["linked_targets"][0], {"type": "bus", "id": "12", "label": "lm"})
        self.client.post(f"/api/reports/{saved['id']}/submit/", {}, format="json")
        self.as_(self.lead)
        returned = self.client.post(f"/api/reports/{saved['id']}/return/", {"note": "n\u0000o"}, format="json")
        self.assertEqual(returned.json()["review_note"], "no")

    def test_unknown_scope_is_a_400(self):
        self.as_(self.lead)
        response = self.client.get("/api/reports/team/?period=day&scope=everyone")
        self.assertEqual((response.status_code, response.json()), (400, {"detail": "Use scope=all or leave it out."}))
