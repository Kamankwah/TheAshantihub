from datetime import timedelta

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import StaffUser
from accounts.testing import make_staff, staff_token
from activity.models import ActivityEvent
from approvals import registry, services
from approvals.models import ApprovalRequest
from approvals.tasks import escalate_due_approvals
from approvals.tests.kinds import RENAME_STAFF


class ApprovalApiTests(TestCase):
    def setUp(self):
        registry.register(RENAME_STAFF)
        self.addCleanup(registry.unregister, RENAME_STAFF.key)
        self.client = APIClient()
        self.boss = make_staff("super_admin", "boss@example.com")
        self.lead = make_staff("operations", "ama@example.com")
        self.other_ops = make_staff("operations", "kojo@example.com")
        self.scout = make_staff("scout", "kwame@example.com", manager=self.lead)
        self.esi = make_staff("support", "esi@example.com")

    def as_(self, staff):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(staff)}")

    def submit(self, maker=None):
        return services.submit(
            maker or self.scout, RENAME_STAFF.key, target=self.esi, title="Rename Esi",
            payload={"full_name": "Esi Nyarko"}, maker_note="She spelled it out at the office",
        )

    def ids(self, box):
        return [row["id"] for row in self.client.get(f"/api/approvals/?box={box}").json()["results"]]

    def test_the_inbox_boxes(self):
        approval = self.submit()
        self.as_(self.lead)
        self.assertEqual(self.ids("mine"), [approval.id])
        self.assertEqual(self.ids("team"), [approval.id])
        self.assertEqual(self.ids("made"), [])
        self.as_(self.scout)
        self.assertEqual(self.ids("made"), [approval.id])
        self.assertEqual(self.ids("mine"), [])
        self.assertEqual(self.client.get("/api/approvals/?box=all").status_code, 403)
        self.assertEqual(self.client.get("/api/approvals/?box=nope").status_code, 400)
        self.as_(self.boss)
        self.assertEqual(self.ids("all"), [approval.id])

    def test_a_row_carries_what_the_inbox_shows(self):
        self.submit()
        self.as_(self.lead)
        row = self.client.get("/api/approvals/?box=mine").json()["results"][0]
        self.assertEqual(row["kind_label"], "Rename a staff member (test only)")
        self.assertEqual(row["maker"], {"id": self.scout.id, "full_name": "Kwame", "role": "scout"})
        self.assertEqual(row["assigned_to"]["id"], self.lead.id)
        self.assertEqual(row["target"], {"type": "accounts.staffuser", "id": str(self.esi.id), "label": str(self.esi)})
        self.assertTrue(row["can_decide"])
        self.assertFalse(row["can_cancel"])

    def test_detail_shows_the_diff_and_whether_it_went_stale(self):
        approval = self.submit()
        self.as_(self.lead)
        detail = self.client.get(f"/api/approvals/{approval.id}/").json()
        self.assertEqual(detail["diff"], [{"field": "full_name", "before": "Esi", "after": "Esi Nyarko"}])
        self.assertFalse(detail["stale"])
        StaffUser.objects.filter(pk=self.esi.pk).update(full_name="Esi Changed")
        self.assertTrue(self.client.get(f"/api/approvals/{approval.id}/").json()["stale"])

    def test_outsiders_cannot_open_a_request(self):
        approval = self.submit()
        self.as_(make_staff("marketing", "akua@example.com"))
        self.assertEqual(self.client.get(f"/api/approvals/{approval.id}/").status_code, 404)

    def test_approve_through_the_api(self):
        approval = self.submit()
        self.as_(self.lead)
        response = self.client.post(f"/api/approvals/{approval.id}/approve/", {"note": "ok"}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "approved")
        self.esi.refresh_from_db()
        self.assertEqual(self.esi.full_name, "Esi Nyarko")
        # requested + approved; the middleware adds no "approval-approve" duplicate
        self.assertEqual(ActivityEvent.objects.filter(verb__startswith="approval").count(), 2)

    def test_the_maker_is_refused_with_a_clear_message(self):
        approval = self.submit(maker=self.other_ops)
        self.as_(self.other_ops)
        response = self.client.post(f"/api/approvals/{approval.id}/approve/", {}, format="json")
        self.assertEqual((response.status_code, response.json()["detail"]), (403, "You can't approve your own request."))

    def test_a_stale_request_answers_409(self):
        approval = self.submit()
        StaffUser.objects.filter(pk=self.esi.pk).update(full_name="Esi Changed")
        self.as_(self.lead)
        response = self.client.post(f"/api/approvals/{approval.id}/approve/", {}, format="json")
        self.assertEqual(
            (response.status_code, response.json()["detail"]),
            (409, "This changed since it was requested — ask for a fresh request."),
        )

    def test_return_needs_a_note(self):
        approval = self.submit()
        self.as_(self.lead)
        self.assertEqual(self.client.post(f"/api/approvals/{approval.id}/reject/", {}, format="json").status_code, 400)
        response = self.client.post(f"/api/approvals/{approval.id}/reject/", {"note": "Spelling"}, format="json")
        self.assertEqual(response.json()["status"], "rejected")

    def test_the_maker_cancels(self):
        approval = self.submit()
        self.as_(self.lead)
        self.assertEqual(self.client.post(f"/api/approvals/{approval.id}/cancel/", {}, format="json").status_code, 403)
        self.as_(self.scout)
        self.assertEqual(self.client.post(f"/api/approvals/{approval.id}/cancel/", {}, format="json").json()["status"], "cancelled")

    def test_counts_and_the_nav_badge(self):
        self.submit()
        self.as_(self.lead)
        self.assertEqual(
            self.client.get("/api/approvals/counts/").json(),
            {"mine": 1, "made": 0, "team": 1, "decided": 0, "can_view_all": False},
        )
        self.assertEqual(self.client.get("/api/notifications/staff-badges/").json()["approvals_waiting"], 1)

    def test_the_escalation_job(self):
        approval = self.submit()
        ApprovalRequest.objects.filter(pk=approval.pk).update(due_at=timezone.now() - timedelta(minutes=1))
        escalate_due_approvals()
        approval.refresh_from_db()
        self.assertEqual(approval.stage, "pool")

    def test_a_losing_pool_approver_hears_already_decided_not_404(self):
        approval = self.submit(maker=self.other_ops)  # no manager: pool stage
        self.assertEqual(approval.stage, "pool")
        loser = make_staff("operations", "yaw@example.com")
        self.as_(self.lead)
        self.assertEqual(self.client.post(f"/api/approvals/{approval.id}/approve/", {}, format="json").status_code, 200)
        self.as_(loser)
        response = self.client.post(f"/api/approvals/{approval.id}/approve/", {}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["detail"], "This request has already been decided.")
        self.as_(make_staff("marketing", "akua@example.com"))
        self.assertEqual(self.client.post(f"/api/approvals/{approval.id}/approve/", {}, format="json").status_code, 404)

    def test_a_non_object_body_is_refused_not_a_500(self):
        approval = self.submit()
        self.as_(self.lead)
        for action in ("approve", "reject"):
            response = self.client.post(f"/api/approvals/{approval.id}/{action}/", [], format="json")
            self.assertEqual(response.status_code, 400)
            self.assertEqual(response.json()["detail"], "Send the decision as a JSON object.")

    def test_an_unknown_status_filter_gives_an_empty_page(self):
        self.submit()
        self.as_(self.scout)
        response = self.client.get("/api/approvals/?box=made&status=bogus")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["results"], [])

    def test_the_team_box_is_empty_without_direct_reports(self):
        self.submit()
        self.as_(self.other_ops)
        self.assertEqual(self.ids("team"), [])
