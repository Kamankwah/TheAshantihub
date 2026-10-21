"""The Operations inbox (OP-2): list filters and ordering, the escalated count,
today's decisions, and the timeline / next move a request carries."""
from datetime import timedelta

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.testing import make_staff, staff_token
from approvals import registry, services
from approvals.models import ApprovalRequest
from approvals.tests.kinds import RENAME_STAFF


class OpsInboxTests(TestCase):
    def setUp(self):
        registry.register(RENAME_STAFF)
        self.addCleanup(registry.unregister, RENAME_STAFF.key)
        self.client = APIClient()
        self.boss = make_staff("super_admin", "boss@example.com")
        self.lead = make_staff("operations", "ama@example.com")
        self.other_ops = make_staff("operations", "kojo@example.com")
        self.kwame = make_staff("scout", "kwame@example.com", manager=self.lead)
        self.efua = make_staff("scout", "efua@example.com", manager=self.lead)
        self.esi = make_staff("support", "esi@example.com")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(self.lead)}")

    def submit(self, maker, hours_old=0):
        approval = services.submit(
            maker, RENAME_STAFF.key, target=self.esi, title=f"Rename by {maker.full_name}", payload={"full_name": "Esi N"},
        )
        if hours_old:
            ApprovalRequest.objects.filter(pk=approval.pk).update(created_at=timezone.now() - timedelta(hours=hours_old))
        return approval

    def ids(self, query):
        return [row["id"] for row in self.client.get(f"/api/approvals/?{query}").json()["results"]]

    def test_filter_by_maker_and_wait(self):
        old = self.submit(self.kwame, hours_old=20)
        fresh = self.submit(self.efua)
        self.assertCountEqual(self.ids("box=mine"), [old.id, fresh.id])
        self.assertEqual(self.ids(f"box=mine&maker={self.efua.id}"), [fresh.id])
        self.assertEqual(self.ids("box=mine&min_wait_hours=18"), [old.id])
        self.assertEqual(self.client.get("/api/approvals/?box=mine&maker=abc").status_code, 400)
        self.assertEqual(self.client.get("/api/approvals/?box=mine&min_wait_hours=lots").status_code, 400)

    def test_ordering_and_escalated_only(self):
        first = self.submit(self.kwame, hours_old=2)
        second = self.submit(self.efua)
        ApprovalRequest.objects.filter(pk=second.pk).update(due_at=timezone.now() + timedelta(hours=1))
        self.assertEqual(self.ids("box=mine&ordering=due"), [second.id, first.id])
        self.assertEqual(self.ids("box=mine&ordering=newest"), [second.id, first.id])
        ApprovalRequest.objects.filter(pk=first.pk).update(escalation_level=1)
        self.assertEqual(self.ids("box=mine&escalated=1"), [first.id])
        counts = self.client.get("/api/approvals/counts/").json()
        self.assertEqual(counts["escalated_to_me"], 1)
        self.assertEqual({m["id"] for m in counts["makers"]}, {self.kwame.id, self.efua.id})

    def test_a_row_says_whose_team_and_where_it_moves_next(self):
        self.submit(self.kwame)
        row = self.client.get("/api/approvals/?box=mine").json()["results"][0]
        self.assertEqual(row["maker_team"], {"mine": True, "manager": "Ama"})
        self.assertFalse(row["escalated"])
        self.assertEqual(row["next_move"]["stage"], "pool")
        self.assertEqual(row["next_move"]["label"], "any General Manager or any Operations")

    def test_the_detail_timeline_projects_the_reminder_and_each_level(self):
        approval = self.submit(self.kwame)
        detail = self.client.get(f"/api/approvals/{approval.id}/").json()
        self.assertEqual([t["kind"] for t in detail["timeline"]], ["sent", "reminder", "move", "move"])
        self.assertEqual([t["what"] for t in detail["timeline"]][2:], ["Moves to any General Manager or any Operations", "Moves to a Super Admin"])
        self.assertEqual(detail["consequences"], [])  # the test kind states none

    def test_the_decided_timeline_ends_with_the_decision(self):
        approval = self.submit(self.kwame)
        self.client.post(f"/api/approvals/{approval.id}/approve/", {"note": "ok"}, format="json")
        detail = self.client.get(f"/api/approvals/{approval.id}/").json()
        self.assertEqual([t["kind"] for t in detail["timeline"]], ["sent", "decided"])
        self.assertEqual(detail["timeline"][-1]["what"], "Approved by Ama")

    def test_stats_count_only_my_decisions_today(self):
        mine = self.submit(self.kwame, hours_old=3)
        returned = self.submit(self.efua, hours_old=1)
        yesterday = self.submit(self.kwame)
        self.client.post(f"/api/approvals/{mine.id}/approve/", {}, format="json")
        self.client.post(f"/api/approvals/{returned.id}/reject/", {"note": "Retake"}, format="json")
        self.client.post(f"/api/approvals/{yesterday.id}/reject/", {"note": "no"}, format="json")
        ApprovalRequest.objects.filter(pk=yesterday.pk).update(decided_at=timezone.now() - timedelta(days=2))
        stats = self.client.get("/api/approvals/stats/").json()
        self.assertEqual((stats["decided_today"], stats["approved_today"], stats["returned_today"]), (2, 1, 1))
        self.assertEqual(stats["median_minutes"], 120)  # median of 180 and 60

    def test_stats_are_empty_without_decisions(self):
        self.assertEqual(
            self.client.get("/api/approvals/stats/").json(),
            {"decided_today": 0, "approved_today": 0, "returned_today": 0, "median_minutes": None},
        )

    def test_decided_ordering_is_newest_decision_first(self):
        a = self.submit(self.kwame)
        b = self.submit(self.efua)
        self.client.post(f"/api/approvals/{a.id}/reject/", {"note": "no"}, format="json")
        self.client.post(f"/api/approvals/{b.id}/reject/", {"note": "no"}, format="json")
        self.assertEqual(self.ids("box=decided&ordering=decided"), [b.id, a.id])
