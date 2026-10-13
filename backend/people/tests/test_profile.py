from datetime import timedelta

from django.utils import timezone

from accounts.models import Permission
from accounts.testing import make_staff, staff_token
from approvals.models import ApprovalRequest
from reports.models import StaffReport
from targets.models import Leave

from .base import PeopleTestCase


class ProfileTests(PeopleTestCase):
    def url(self, staff):
        return f"/api/people/staff/{staff.pk}/"

    def test_identity_manager_team_and_masked_phone(self):
        self.kwame.phone = "0241234567"
        self.kwame.save()
        self.sign_in()
        data = self.client.get(self.url(self.kwame)).json()
        self.assertEqual((data["full_name"], data["role"], data["status"]), ("Kwame", "scout", "active"))
        self.assertEqual(data["manager"]["name"], "Ama")
        self.assertEqual(data["phone"], "024 *** 4567")
        self.assertNotIn("0241234567", str(data))
        self.assertEqual(data["pay"], {"commission": None, "pay_profile": None})

    def test_a_team_lead_lists_who_reports_to_them(self):
        self.sign_in()
        data = self.client.get(self.url(self.ama)).json()
        self.assertEqual({p["name"] for p in data["reports_to_them"]}, {"Kwame", "Esi"})
        self.assertIsNone(data["performance"])  # targets and check-ins are a scout's

    def test_a_scout_has_the_scoreboard_row(self):
        self.sign_in()
        data = self.client.get(self.url(self.kwame)).json()
        self.assertEqual(data["performance"]["id"], self.kwame.pk)
        self.assertIn("month", data["performance"])

    def test_permissions_split_role_individual_and_taken_away(self):
        self.kwame.extra_permissions.add(Permission.objects.get(codename="orders.manage_delivery"))
        self.kwame.revoked_permissions.add(Permission.objects.get(codename="calls.log"))
        self.sign_in()
        perms = self.client.get(self.url(self.kwame)).json()["permissions"]
        self.assertEqual(perms["extra"], ["orders.manage_delivery"])
        self.assertEqual(perms["revoked"], ["calls.log"])
        self.assertIn("orders.manage_delivery", perms["effective"])
        self.assertNotIn("calls.log", perms["effective"])

    def test_live_status_sessions_leave_reports_and_approvals(self):
        staff_token(self.kwame)
        today = timezone.localdate()
        Leave.objects.create(staff=self.kwame, start=today, end=today + timedelta(days=2), recorded_by=self.ama)
        StaffReport.objects.create(staff=self.kwame, period="day", period_start=today - timedelta(days=1), period_end=today - timedelta(days=1), status="acknowledged")
        StaffReport.objects.create(staff=self.kwame, period="day", period_start=today, period_end=today, status="draft")
        ApprovalRequest.objects.create(kind="business.update", title="Change phone", maker=self.kwame, assigned_to=self.ama, due_at=timezone.now() + timedelta(hours=4))
        self.sign_in()
        data = self.client.get(self.url(self.kwame)).json()
        self.assertTrue(data["live"]["signed_in"])
        self.assertEqual(data["live"]["on_leave_to"], str(today + timedelta(days=2)))
        self.assertEqual(len(data["sessions"]), 1)
        self.assertEqual([r["status"] for r in data["reports"]], ["acknowledged"])  # drafts are not shown
        self.assertEqual(data["approvals"]["made"][0]["title"], "Change phone")
        ama = self.client.get(self.url(self.ama)).json()
        self.assertEqual(ama["approvals"]["waiting"][0]["title"], "Change phone")

    def test_needs_staff_manage_and_404s_unknown(self):
        self.sign_in(self.ama)
        self.assertEqual(self.client.get(self.url(self.kwame)).status_code, 403)
        self.sign_in()
        self.assertEqual(self.client.get("/api/people/staff/99999/").status_code, 404)
