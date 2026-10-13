from datetime import timedelta

from django.conf import settings
from django.test import override_settings
from django.utils import timezone

from activity.models import ActivityEvent, ChainCheck
from activity.services import record
from reports.models import ReportExport

from .base import SecurityBase


class AuditLogTests(SecurityBase):
    def setUp(self):
        super().setUp()
        record(self.esi, "visit.check_in", target_type="field.visit", target_id="4", target_label="Adwoa Fabrics", summary="Checked in")
        record(None, "approvals.escalated", target_label="Business info change")

    def test_super_admin_gets_the_seal_and_origin_others_do_not(self):
        self.as_staff(self.boss)
        row = self.client.get("/api/activity/").json()["results"][-1]
        self.assertEqual(len(row["hash"]), 64)
        self.assertEqual(len(row["prev_hash"]), 64)
        self.assertIn("ip", row)
        self.as_staff(self.esi)
        mine = self.client.get("/api/activity/").json()["results"]
        self.assertTrue(mine)
        self.assertNotIn("hash", mine[0])
        self.assertNotIn("ip", mine[0])

    def test_search_covers_person_action_and_target(self):
        self.as_staff(self.boss)
        for q, expected in (("Adwoa", 1), ("esi", 1), ("check_in", 1), ("nothing-like-this", 0)):
            self.assertEqual(self.client.get("/api/activity/", {"q": q}).json()["count"], expected, q)

    def test_the_system_actor_can_be_picked(self):
        self.as_staff(self.boss)
        body = self.client.get("/api/activity/?role=system").json()
        self.assertEqual([e["verb"] for e in body["results"]], ["approvals.escalated"])
        self.assertEqual(body["results"][0]["actor_label"], "System")

    def test_chain_status_says_whether_the_seal_is_emailed(self):
        ChainCheck.objects.create(checked_at=timezone.now(), ok=True, events=2)
        self.as_staff(self.boss)
        self.assertFalse(self.client.get("/api/activity/chain-status/").json()["seal_emailed"])
        with override_settings(ACTIVITY_SEAL_EMAIL=True):
            self.assertTrue(self.client.get("/api/activity/chain-status/").json()["seal_emailed"])


class ExportsLogTests(SecurityBase):
    def setUp(self):
        super().setUp()
        record(self.ama, "report.exported", summary="Exported businesses (12 rows)",
               after={"format": "csv", "kind": "businesses", "rows": 12, "personal_data": False, "filters": {"zone": "Manhyia"}})
        self.export = ReportExport.objects.create(requester=self.ama, filters={}, format="xlsx", status=ReportExport.READY, expires_at=timezone.now() + timedelta(hours=3))
        record(self.ama, "report.exported", after={"format": "xlsx", "rows": 40, "personal_data": True, "filters": {"from": "2026-09-01"}, "export": self.export.pk})
        record(None, "report.exported", summary="Scheduled export sent: Weekly", after={"source": "scheduled", "format": "xlsx", "rows": 9, "personal_data": True, "recipient": "Kofi"})
        record(self.ama, "report.exported", after={"format": "csv"})  # an older line that never said
        record(self.ama, "kyc.approved")

    def test_only_a_holder_of_activity_view_all_reads_it(self):
        self.as_staff(self.ama)
        self.assertEqual(self.client.get("/api/staff-security/exports/").status_code, 403)

    def test_every_export_is_listed_with_its_flag_filters_and_link(self):
        self.as_staff(self.boss)
        body = self.client.get("/api/staff-security/exports/").json()
        self.assertEqual(body["count"], 4)
        rows = body["results"]
        by_rows = {r["rows"]: r for r in rows}
        self.assertEqual(by_rows[12]["filters"], {"zone": "Manhyia"})
        self.assertFalse(by_rows[12]["personal_data"])
        self.assertEqual(by_rows[12]["link"], "Downloaded straight away, no link")
        self.assertEqual((by_rows[40]["personal_data"], by_rows[40]["link"]), (True, "Link ready"))
        self.assertTrue(by_rows[9]["scheduled"])
        self.assertEqual(by_rows[9]["who"], "System")
        self.assertEqual(by_rows[9]["link"], "Link sent to Kofi")
        unknown = next(r for r in rows if r["rows"] is None)
        self.assertIsNone(unknown["personal_data"])
        self.assertEqual(body["summary"], {"last_30_days": 4, "personal_30_days": 2, "scheduled_30_days": 1, "not_recorded_30_days": 1})

    def test_filters(self):
        self.as_staff(self.boss)
        get = lambda q: self.client.get(f"/api/staff-security/exports/?{q}").json()["count"]
        self.assertEqual(get("personal=yes"), 2)
        self.assertEqual(get("personal=no"), 1)
        self.assertEqual(get("personal=unknown"), 1)
        self.assertEqual(get(f"actor={self.ama.pk}"), 3)
        self.assertEqual(get("since=2999-01-01"), 0)

    def test_an_expired_link_is_said_to_have_expired(self):
        ReportExport.objects.filter(pk=self.export.pk).update(expires_at=timezone.now() - timedelta(minutes=1))
        self.as_staff(self.boss)
        row = next(r for r in self.client.get("/api/staff-security/exports/").json()["results"] if r["rows"] == 40)
        self.assertEqual(row["link"], "Link expired")

    def test_the_log_cannot_be_edited(self):
        self.as_staff(self.boss, sudo=True)
        for method in (self.client.post, self.client.patch, self.client.delete, self.client.put):
            self.assertEqual(method("/api/staff-security/exports/").status_code, 405)

    def test_the_activity_export_now_says_whether_it_held_personal_data(self):
        self.as_staff(self.boss, sudo=True)
        self.assertEqual(self.client.get("/api/activity/export/?format=csv").status_code, 200)
        event = ActivityEvent.objects.filter(verb="report.exported").order_by("-id").first()
        self.assertTrue(event.after["personal_data"])
