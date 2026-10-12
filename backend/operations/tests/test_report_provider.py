from datetime import date, datetime, time, timedelta
from unittest import mock

from django.test import TestCase
from django.utils import timezone

from accounts.testing import make_staff
from approvals.models import ApprovalRequest
from fraud.models import FraudFlag
from portfolio.tests.health_fixtures import make_business
from reports import providers, services
from reports.models import StaffReport
from targets.models import TargetPlan

TODAY = date(2026, 10, 7)


def at(day, hour, minute=0):
    return timezone.make_aware(datetime.combine(day, time(hour, minute)))


class OperationsProviderTests(TestCase):
    def setUp(self):
        self.lead = make_staff("operations", "ama@example.com")
        self.kwame = make_staff("scout", "kwame@example.com", manager=self.lead)
        self.efua = make_staff("scout", "efua@example.com", manager=self.lead)
        self.kwaku = make_staff("scout", "kwaku@example.com", manager=make_staff("operations", "kojo@example.com"))
        for patch in (
            mock.patch("django.utils.timezone.localdate", return_value=TODAY),
            mock.patch("django.utils.timezone.now", return_value=at(TODAY, 18)),
        ):
            patch.start()
            self.addCleanup(patch.stop)
        for scout in (self.kwame, self.efua, self.kwaku):
            TargetPlan.objects.create(staff=scout, metric="registrations", daily_value=3, effective_from=date(2026, 10, 1), set_by=self.lead)

    def sections(self, start=TODAY, end=TODAY):
        return {s["key"]: s for s in providers.system_sections(self.lead, start, end)}

    def rows(self, key, **kw):
        return {r["label"]: r["value"] for r in self.sections(**kw)[key]["rows"]}

    def test_registered_for_operations_only(self):
        self.assertIn("team_targets", self.sections())
        self.assertNotIn("team_targets", {s["key"] for s in providers.system_sections(self.kwame, TODAY, TODAY)})

    def test_team_totals_use_the_sum_of_the_teams_plans_not_other_teams(self):
        row = next(r for r in self.sections()["team_targets"]["rows"] if r["label"] == "Registrations")
        self.assertEqual((row["value"], row["target"]), (0, 6))
        # No plan for a measure: the number shows, no target is made up.
        visits = next(r for r in self.sections()["team_targets"]["rows"] if r["label"] == "Visits")
        self.assertNotIn("target", visits)

    def test_per_scout_table_has_a_row_for_each_scout_and_the_day_report(self):
        StaffReport.objects.create(staff=self.kwame, period="day", period_start=TODAY, period_end=TODAY, status=StaffReport.SUBMITTED)
        section = self.sections()["team_scouts"]
        self.assertEqual(section["columns"], ["Registrations", "Visits", "Calls", "Renewals", "Day reports"])
        cells = {r["label"]: r["cells"] for r in section["rows"]}
        self.assertEqual(set(cells), {"Kwame", "Efua"})
        self.assertEqual(cells["Kwame"][0], "0 / 3")
        self.assertEqual((cells["Kwame"][-1], cells["Efua"][-1]), ("Submitted", "Not yet"))

    def test_approvals_decided_with_median_time(self):
        for hours, status in ((2, "approved"), (4, "approved"), (9, "rejected")):
            ApprovalRequest.objects.create(
                kind="business.kyc", title="x", maker=self.kwame, status=status, decided_by=self.lead,
                decided_at=at(TODAY, 12), created_at=at(TODAY, 12) - timedelta(hours=hours), due_at=at(TODAY, 20),
            )
        rows = self.rows("ops_approvals")
        self.assertEqual((rows["Decided"], rows["Approved"], rows["Returned"]), (3, 2, 1))
        self.assertEqual(rows["Median time to decide (clock time)"], "4 h")

    def test_no_median_when_nothing_was_decided(self):
        self.assertNotIn("Median time to decide (clock time)", self.rows("ops_approvals"))

    def test_fraud_and_report_reviews(self):
        owner = make_business("Suame Auto Parts", manager=self.kwame)
        FraudFlag.objects.create(kind=FraudFlag.DUPLICATE, title="a", business_owner=owner, source=FraudFlag.SYSTEM)
        FraudFlag.objects.create(
            kind=FraudFlag.DUPLICATE, title="b", business_owner=owner, source=FraudFlag.SYSTEM, status=FraudFlag.CONFIRMED,
            resolved_by=self.lead, resolved_at=at(TODAY, 9),
        )
        fraud = self.rows("ops_fraud")
        self.assertEqual((fraud["Confirmed"], fraud["Still open now"]), (1, 1))
        StaffReport.objects.create(
            staff=self.kwame, period="day", period_start=TODAY - timedelta(days=1), period_end=TODAY - timedelta(days=1),
            status=StaffReport.ACKNOWLEDGED, reviewer=self.lead, reviewed_at=at(TODAY, 9),
        )
        StaffReport.objects.create(staff=self.efua, period="day", period_start=TODAY, period_end=TODAY, status=StaffReport.SUBMITTED)
        reports = self.rows("ops_reports")
        self.assertEqual((reports["Acknowledged"], reports["Waiting for you now"]), (1, 1))

    def test_no_support_or_delivery_rows_are_invented(self):
        text = " ".join(r["label"].lower() for s in self.sections().values() for r in s["rows"])
        self.assertNotIn("support", text)
        self.assertNotIn("deliver", text)

    def test_submitting_freezes_the_sections_in_the_snapshot(self):
        report = services.build(self.lead, "day", TODAY)
        report = services.save_draft(self.lead, "day", TODAY, {"achievements": "Cleared the queue", "blockers": "", "plan_next": []})
        services.submit(report)
        report.refresh_from_db()
        self.assertIn("team_scouts", {s["key"] for s in report.system_snapshot})
